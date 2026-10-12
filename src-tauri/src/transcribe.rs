use crate::db::{Segment, Word};
use crate::settings::Settings;
use std::path::Path;
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters, get_lang_id,
};

pub const RATE: usize = 16000;
const FRAME: usize = RATE * 30 / 1000;
const MERGE_GAP: usize = 2000 / 30;
const MAX_WINDOW: usize = 27000 / 30;
const MIN_VOICED: usize = 300 / 30;
const PAD: usize = 200 / 30;
const DETECT_CTX: i32 = 500;
const DETECT_MIN: usize = RATE * 3 / 2;
const PACK_MAX: usize = RATE * 28;
const PACK_GAP: usize = RATE * 3 / 10;

pub fn speech_windows(samples: &[f32]) -> Vec<(usize, usize)> {
    let rms: Vec<f32> = samples
        .chunks(FRAME)
        .map(|c| (c.iter().map(|x| x * x).sum::<f32>() / c.len() as f32).sqrt())
        .collect();
    if rms.is_empty() {
        return vec![];
    }
    let mut sorted = rms.clone();
    sorted.sort_by(f32::total_cmp);
    let threshold = (sorted[sorted.len() / 10] * 3.0).clamp(0.004, 0.015);

    let mut regions: Vec<(usize, usize, usize)> = vec![];
    for (i, _) in rms.iter().enumerate().filter(|(_, v)| **v >= threshold) {
        match regions.last_mut() {
            Some(r) if i - r.1 <= MERGE_GAP && i - r.0 <= MAX_WINDOW => {
                r.1 = i + 1;
                r.2 += 1;
            }
            _ => regions.push((i, i + 1, 1)),
        }
    }
    regions
        .into_iter()
        .filter(|r| r.2 >= MIN_VOICED)
        .map(|(a, b, _)| {
            (
                a.saturating_sub(PAD) * FRAME,
                ((b + PAD) * FRAME).min(samples.len()),
            )
        })
        .collect()
}

pub fn words_from_tokens(tokens: &[(Vec<u8>, i64)]) -> Vec<Word> {
    let mut words = vec![];
    let mut current: Vec<u8> = vec![];
    let mut start = 0;
    let flush = |bytes: &[u8], start_ms: i64, words: &mut Vec<Word>| {
        let text = String::from_utf8_lossy(bytes).trim().to_string();
        if !text.is_empty() {
            words.push(Word { start_ms, text });
        }
    };
    for (bytes, ms) in tokens {
        if current.is_empty() || bytes.first() == Some(&b' ') {
            flush(&current, start, &mut words);
            current.clear();
            start = *ms;
        }
        current.extend_from_slice(bytes);
    }
    flush(&current, start, &mut words);
    words
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Piece {
    pub packed: usize,
    pub original: usize,
    pub len: usize,
}

pub fn pack(windows: &[(usize, usize)]) -> Vec<Vec<Piece>> {
    let mut packs: Vec<Vec<Piece>> = vec![];
    let mut cursor = 0;
    for &(original, b) in windows {
        let len = b - original;
        match packs.last_mut() {
            Some(pieces) if cursor + PACK_GAP + len <= PACK_MAX => {
                cursor += PACK_GAP;
                pieces.push(Piece {
                    packed: cursor,
                    original,
                    len,
                });
                cursor += len;
            }
            _ => {
                packs.push(vec![Piece {
                    packed: 0,
                    original,
                    len,
                }]);
                cursor = len;
            }
        }
    }
    packs
}

pub fn to_original(pieces: &[Piece], packed_ms: i64) -> (usize, i64) {
    let sample = packed_ms.max(0) as usize * RATE / 1000;
    let i = pieces.iter().rposition(|p| p.packed <= sample).unwrap_or(0);
    let piece = pieces[i];
    let (i, original) = if sample >= piece.packed + piece.len && i + 1 < pieces.len() {
        (i + 1, pieces[i + 1].original)
    } else {
        (
            i,
            piece.original + (sample - piece.packed.min(sample)).min(piece.len),
        )
    };
    (i, (original * 1000 / RATE) as i64)
}

pub fn transcribe(
    model: &Path,
    channels: &[Vec<f32>; 2],
    settings: &Settings,
    mut progress: impl FnMut(f32),
) -> Result<Vec<Segment>, String> {
    let mut params = WhisperContextParameters::default();
    params.dtw_parameters(DtwParameters {
        mode: DtwMode::ModelPreset {
            model_preset: DtwModelPreset::LargeV3Turbo,
        },
        dtw_mem_size: 128 * 1024 * 1024,
    });
    let ctx = WhisperContext::new_with_params(model, params).map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().min(8))
        .unwrap_or(4);
    let eot = ctx.token_eot();

    let primary = settings.primary_lang.as_str();
    let secondary = settings.secondary_lang.as_deref().filter(|s| *s != primary);
    let mut detector = match secondary {
        Some(_) => {
            let mut detector = ctx.create_state().map_err(|e| e.to_string())?;
            detector
                .full(params_for(primary, threads, DETECT_CTX), &vec![0.0; RATE])
                .map_err(|e| e.to_string())?;
            Some(detector)
        }
        None => None,
    };

    let mut jobs: Vec<(usize, &str, Vec<Piece>)> = vec![];
    for (speaker, samples) in channels.iter().enumerate() {
        let mut last = primary;
        let mut runs: Vec<(&str, Vec<(usize, usize)>)> = vec![];
        for (a, b) in speech_windows(samples) {
            let lang = match (secondary, detector.as_mut()) {
                (Some(secondary), Some(detector)) if b - a >= DETECT_MIN => {
                    detector
                        .pcm_to_mel(&samples[a..b.min(a + RATE * 10)], threads)
                        .map_err(|e| e.to_string())?;
                    let (_, probs) = detector
                        .lang_detect(0, threads)
                        .map_err(|e| e.to_string())?;
                    let p = |l: &str| get_lang_id(l).map(|i| probs[i as usize]).unwrap_or(0.0);
                    if p(secondary) > p(primary) {
                        secondary
                    } else {
                        primary
                    }
                }
                _ => last,
            };
            last = lang;
            match runs.last_mut() {
                Some((l, windows)) if *l == lang => windows.push((a, b)),
                _ => runs.push((lang, vec![(a, b)])),
            }
        }
        for (lang, windows) in runs {
            jobs.extend(
                pack(&windows)
                    .into_iter()
                    .map(|pieces| (speaker, lang, pieces)),
            );
        }
    }
    jobs.sort_by_key(|(_, _, pieces)| pieces[0].original);
    let packed_len = |pieces: &[Piece]| pieces.last().map(|p| p.packed + p.len).unwrap_or(0);
    let total: usize = jobs
        .iter()
        .map(|(_, _, p)| packed_len(p))
        .sum::<usize>()
        .max(1);
    let mut done = 0;

    let mut segments = vec![];
    for (speaker, lang, pieces) in jobs {
        let mut pcm = vec![0.0; packed_len(&pieces)];
        for p in &pieces {
            pcm[p.packed..p.packed + p.len]
                .copy_from_slice(&channels[speaker][p.original..p.original + p.len]);
        }

        let mut full = params_for(lang, threads, 0);
        if !settings.vocabulary.trim().is_empty() {
            full.set_initial_prompt(settings.vocabulary.trim());
        }
        state.full(full, &pcm).map_err(|e| e.to_string())?;

        for seg in state.as_iter() {
            if seg.no_speech_probability() > 0.6 {
                continue;
            }
            let tokens: Vec<(Vec<u8>, i64)> = (0..seg.n_tokens())
                .filter_map(|i| seg.get_token(i))
                .filter(|t| t.token_id() < eot)
                .map(|t| {
                    let d = t.token_data();
                    (
                        t.to_bytes().unwrap_or_default().to_vec(),
                        if d.t_dtw >= 0 { d.t_dtw } else { d.t0 } * 10,
                    )
                })
                .collect();
            let seg_end = to_original(&pieces, seg.end_timestamp() * 10);
            let mut groups: Vec<(usize, Vec<Word>)> = vec![];
            for word in words_from_tokens(&tokens) {
                let (piece, start_ms) = to_original(&pieces, word.start_ms);
                let word = Word {
                    start_ms,
                    text: word.text,
                };
                match groups.last_mut() {
                    Some((p, words)) if *p == piece => words.push(word),
                    _ => groups.push((piece, vec![word])),
                }
            }
            for (piece, words) in groups {
                let p = pieces[piece];
                let end_ms = if seg_end.0 == piece {
                    seg_end.1
                } else {
                    ((p.original + p.len) * 1000 / RATE) as i64
                };
                segments.push(Segment {
                    speaker: speaker as i64,
                    start_ms: words[0].start_ms,
                    end_ms: end_ms.max(words[0].start_ms),
                    lang: lang.to_string(),
                    words,
                });
            }
        }
        done += pcm.len();
        progress(done as f32 / total as f32);
    }
    segments.sort_by_key(|s| s.start_ms);
    Ok(segments)
}

fn params_for(lang: &str, threads: usize, audio_ctx: i32) -> FullParams<'_, '_> {
    let mut full = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    full.set_language(Some(lang));
    full.set_n_threads(threads as i32);
    full.set_audio_ctx(audio_ctx);
    full.set_token_timestamps(true);
    full.set_no_context(true);
    full.set_suppress_nst(true);
    full.set_print_progress(false);
    full.set_print_realtime(false);
    full.set_print_special(false);
    full.set_print_timestamps(false);
    full
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(secs: f32) -> Vec<f32> {
        (0..(secs * RATE as f32) as usize)
            .map(|i| (i as f32 * 0.05).sin() * 0.2)
            .collect()
    }

    fn silence(secs: f32) -> Vec<f32> {
        vec![0.0; (secs * RATE as f32) as usize]
    }

    fn seconds(windows: &[(usize, usize)]) -> Vec<(f32, f32)> {
        windows
            .iter()
            .map(|(a, b)| (*a as f32 / RATE as f32, *b as f32 / RATE as f32))
            .collect()
    }

    #[test]
    fn windows_merge_short_gaps_split_long_ones_and_drop_blips() {
        assert!(speech_windows(&silence(5.0)).is_empty());
        assert!(speech_windows(&[silence(2.0), tone(0.1), silence(2.0)].concat()).is_empty());

        let close = speech_windows(
            &[
                silence(1.0),
                tone(1.0),
                silence(1.0),
                tone(1.0),
                silence(1.0),
            ]
            .concat(),
        );
        assert_eq!(close.len(), 1);

        let far = seconds(&speech_windows(
            &[
                silence(1.0),
                tone(1.0),
                silence(4.0),
                tone(1.0),
                silence(1.0),
            ]
            .concat(),
        ));
        assert_eq!(far.len(), 2);
        assert!((far[0].0 - 0.8).abs() < 0.05 && (far[1].0 - 5.8).abs() < 0.05);

        let long = speech_windows(&[tone(40.0), silence(1.0), tone(10.0)].concat());
        assert_eq!(long.len(), 2);
        assert!(long.iter().all(|(a, b)| b - a <= RATE * 28));
    }

    #[test]
    fn packs_windows_and_maps_times_back() {
        let s = |secs: f32| (secs * RATE as f32) as usize;
        let packs = pack(&[(s(1.0), s(11.0)), (s(40.0), s(50.0)), (s(60.0), s(70.0))]);
        assert_eq!(packs.iter().map(Vec::len).collect::<Vec<_>>(), vec![2, 1]);
        let pieces = &packs[0];
        assert_eq!(
            pieces[1],
            Piece {
                packed: s(10.3),
                original: s(40.0),
                len: s(10.0)
            }
        );
        assert_eq!(to_original(pieces, 500), (0, 1500));
        assert_eq!(to_original(pieces, 10_100), (1, 40_000));
        assert_eq!(to_original(pieces, 12_300), (1, 42_000));
        assert_eq!(to_original(pieces, 99_000), (1, 50_000));
    }

    #[test]
    fn words_join_subword_tokens_including_split_utf8() {
        let pryvit = "Привіт".as_bytes();
        let tokens = vec![
            ([b" ", &pryvit[..3]].concat(), 100),
            (pryvit[3..].to_vec(), 150),
            (b",".to_vec(), 200),
            (b" wor".to_vec(), 400),
            (b"ld".to_vec(), 450),
            (b" ".to_vec(), 600),
        ];
        let words = words_from_tokens(&tokens);
        assert_eq!(
            words,
            vec![
                Word {
                    start_ms: 100,
                    text: "Привіт,".into()
                },
                Word {
                    start_ms: 400,
                    text: "world".into()
                }
            ]
        );
    }
}
