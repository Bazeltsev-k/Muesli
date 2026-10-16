use crate::db::{Comment, Note, Segment, Word};

pub const GAP_MS: i64 = 600;

#[derive(Debug, Clone, PartialEq)]
pub enum Piece {
    Source(i64, i64),
    Target(i64, i64),
    Silence(i64),
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Doc {
    pub duration: i64,
    pub segments: Vec<Segment>,
    pub notes: Vec<Note>,
    pub comments: Vec<Comment>,
}

#[derive(Debug)]
pub struct Plan {
    pub source: Doc,
    pub target: Doc,
    pub source_audio: Vec<Piece>,
    pub target_audio: Vec<Piece>,
}

fn mid(s: &Segment) -> i64 {
    (s.start_ms + s.end_ms) / 2
}

fn inside(ranges: &[(i64, i64)], t: i64) -> Option<usize> {
    ranges.iter().position(|r| t >= r.0 && t < r.1)
}

pub fn ranges(segments: &[Segment], picked: &[(i64, i64)], duration: i64) -> Vec<(i64, i64)> {
    let mut out: Vec<(i64, i64)> = picked.to_vec();
    for s in segments.iter().filter(|s| inside(picked, mid(s)).is_some()) {
        out.push((s.start_ms, s.end_ms));
    }
    out.sort();
    let mut merged: Vec<(i64, i64)> = vec![];
    for (a, b) in out {
        let (a, b) = (a.clamp(0, duration), b.clamp(0, duration));
        match merged.last_mut() {
            Some(last) if a <= last.1 => last.1 = last.1.max(b),
            _ if b > a => merged.push((a, b)),
            _ => {}
        }
    }
    merged
}

pub fn insert_at(target: &Doc, wanted: i64) -> i64 {
    if wanted <= 0 {
        return 0;
    }
    if wanted >= target.duration {
        return target.duration;
    }
    target
        .segments
        .iter()
        .filter(|s| s.start_ms < wanted)
        .map(|s| s.end_ms)
        .fold(wanted, i64::max)
        .min(target.duration)
}

fn shift(s: &Segment, f: impl Fn(i64) -> i64) -> Segment {
    Segment {
        start_ms: f(s.start_ms),
        end_ms: f(s.end_ms),
        words: s
            .words
            .iter()
            .map(|w| Word {
                start_ms: f(w.start_ms),
                text: w.text.clone(),
            })
            .collect(),
        ..s.clone()
    }
}

fn word_indices(segments: &[Segment]) -> Vec<std::ops::Range<i64>> {
    let mut at = 0;
    segments
        .iter()
        .map(|s| {
            let r = at..at + s.words.len() as i64;
            at = r.end;
            r
        })
        .collect()
}

fn remap(comments: &[Comment], map: &dyn Fn(i64) -> Option<i64>) -> Vec<Comment> {
    comments
        .iter()
        .filter_map(|c| {
            let (word, end) = (map(c.word)?, map(c.end)?);
            (end >= word).then(|| Comment {
                word,
                end,
                ..c.clone()
            })
        })
        .collect()
}

pub fn plan(
    source: &Doc,
    target: Option<&Doc>,
    picked: &[(i64, i64)],
    wanted: i64,
    copy: bool,
) -> Plan {
    let ranges = ranges(&source.segments, picked, source.duration);
    let mut offsets = vec![];
    let mut length = 0;
    for (i, r) in ranges.iter().enumerate() {
        if i > 0 {
            length += GAP_MS;
        }
        offsets.push(length);
        length += r.1 - r.0;
    }
    let moved_time = |t: i64| {
        let k = inside(&ranges, t).unwrap_or(0);
        offsets[k] + t - ranges[k].0
    };
    let kept_time = |t: i64| {
        t - ranges
            .iter()
            .map(|r| (t.min(r.1) - r.0).max(0))
            .sum::<i64>()
    };

    let empty = Doc::default();
    let old_target = target.unwrap_or(&empty);
    let at = target.map_or(0, |t| insert_at(t, wanted));
    let target_time = |t: i64| if t >= at { t + length } else { t };

    let source_words = word_indices(&source.segments);
    let target_words = word_indices(&old_target.segments);
    let moving: Vec<bool> = source
        .segments
        .iter()
        .map(|s| inside(&ranges, mid(s)).is_some())
        .collect();

    let mut placed: Vec<(Segment, Option<usize>, Option<usize>)> = old_target
        .segments
        .iter()
        .enumerate()
        .map(|(i, s)| (shift(s, target_time), None, Some(i)))
        .chain(
            source
                .segments
                .iter()
                .enumerate()
                .filter(|(i, _)| moving[*i])
                .map(|(i, s)| (shift(s, |t| at + moved_time(t)), Some(i), None)),
        )
        .collect();
    placed.sort_by_key(|p| p.0.start_ms);
    let mut from_source = vec![None; source.segments.len()];
    let mut from_target = vec![None; old_target.segments.len()];
    let mut at_word = 0;
    for (s, src, tgt) in &placed {
        if let Some(i) = src {
            from_source[*i] = Some(at_word);
        }
        if let Some(i) = tgt {
            from_target[*i] = Some(at_word);
        }
        at_word += s.words.len() as i64;
    }
    let lookup = |words: &[std::ops::Range<i64>], starts: &[Option<i64>], w: i64| {
        let i = words.iter().position(|r| r.contains(&w))?;
        starts[i].map(|s| s + w - words[i].start)
    };

    let mut target_notes: Vec<Note> = old_target
        .notes
        .iter()
        .map(|n| Note {
            at_ms: target_time(n.at_ms),
            ..n.clone()
        })
        .chain(
            source
                .notes
                .iter()
                .filter(|n| inside(&ranges, n.at_ms).is_some())
                .map(|n| Note {
                    at_ms: at + moved_time(n.at_ms),
                    ..n.clone()
                }),
        )
        .collect();
    target_notes.sort_by_key(|n| n.at_ms);
    let mut target_comments = remap(&old_target.comments, &|w| {
        lookup(&target_words, &from_target, w)
    });
    target_comments.extend(remap(&source.comments, &|w| {
        lookup(&source_words, &from_source, w)
    }));

    let new_target = Doc {
        duration: old_target.duration + length,
        segments: placed.into_iter().map(|p| p.0).collect(),
        notes: target_notes,
        comments: target_comments,
    };

    let mut moved_audio = vec![];
    for (i, r) in ranges.iter().enumerate() {
        if i > 0 {
            moved_audio.push(Piece::Silence(GAP_MS));
        }
        moved_audio.push(Piece::Source(r.0, r.1));
    }
    let mut target_audio = vec![];
    if at > 0 {
        target_audio.push(Piece::Target(0, at));
    }
    target_audio.extend(moved_audio);
    if at < old_target.duration {
        target_audio.push(Piece::Target(at, old_target.duration));
    }

    if copy {
        return Plan {
            source: source.clone(),
            target: new_target,
            source_audio: vec![],
            target_audio,
        };
    }

    let mut kept_starts = vec![None; source.segments.len()];
    let mut at_word = 0;
    for (i, s) in source.segments.iter().enumerate() {
        if !moving[i] {
            kept_starts[i] = Some(at_word);
            at_word += s.words.len() as i64;
        }
    }
    let mut source_audio = vec![];
    let mut cursor = 0;
    for r in &ranges {
        if r.0 > cursor {
            source_audio.push(Piece::Source(cursor, r.0));
        }
        cursor = r.1;
    }
    if cursor < source.duration {
        source_audio.push(Piece::Source(cursor, source.duration));
    }
    if source_audio.is_empty() {
        source_audio.push(Piece::Silence(100));
    }
    Plan {
        source: Doc {
            duration: (source.duration - ranges.iter().map(|r| r.1 - r.0).sum::<i64>()).max(100),
            segments: source
                .segments
                .iter()
                .enumerate()
                .filter(|(i, _)| !moving[*i])
                .map(|(_, s)| shift(s, kept_time))
                .collect(),
            notes: source
                .notes
                .iter()
                .filter(|n| inside(&ranges, n.at_ms).is_none())
                .map(|n| Note {
                    at_ms: kept_time(n.at_ms),
                    ..n.clone()
                })
                .collect(),
            comments: remap(&source.comments, &|w| {
                lookup(&source_words, &kept_starts, w)
            }),
        },
        target: new_target,
        source_audio,
        target_audio,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(speaker: i64, start: i64, end: i64, text: &str) -> Segment {
        let words: Vec<&str> = text.split(' ').collect();
        Segment {
            speaker,
            start_ms: start,
            end_ms: end,
            lang: "en".into(),
            words: words
                .iter()
                .enumerate()
                .map(|(i, w)| Word {
                    start_ms: start + (end - start) * i as i64 / words.len() as i64,
                    text: w.to_string(),
                })
                .collect(),
        }
    }

    fn note(at_ms: i64, body: &str) -> Note {
        Note {
            id: 0,
            at_ms,
            body: body.into(),
        }
    }

    fn comment(word: i64, end: i64, body: &str) -> Comment {
        Comment {
            id: 0,
            word,
            end,
            body: body.into(),
        }
    }

    fn texts(d: &Doc) -> Vec<(i64, String)> {
        d.segments.iter().map(|s| (s.start_ms, s.text())).collect()
    }

    fn source() -> Doc {
        Doc {
            duration: 10_000,
            segments: vec![
                seg(0, 0, 2000, "a b"),
                seg(1, 3000, 5000, "c d"),
                seg(0, 6000, 8000, "e f"),
            ],
            notes: vec![
                note(1000, "first"),
                note(4000, "middle"),
                note(9000, "late"),
            ],
            comments: vec![
                comment(0, 1, "on a b"),
                comment(2, 3, "on c d"),
                comment(4, 5, "on e f"),
            ],
        }
    }

    #[test]
    fn moves_a_block_out_and_closes_the_gap_with_notes_and_comments() {
        let target = Doc {
            duration: 4000,
            segments: vec![seg(0, 0, 1000, "x"), seg(1, 2000, 3500, "y z")],
            notes: vec![note(2500, "target")],
            comments: vec![comment(1, 2, "on y z")],
        };
        let p = plan(&source(), Some(&target), &[(3000, 5000)], 1500, false);

        assert_eq!(texts(&p.source), [(0, "a b".into()), (4000, "e f".into())]);
        assert_eq!(p.source.duration, 8000);
        assert_eq!(
            p.source
                .notes
                .iter()
                .map(|n| (n.at_ms, n.body.as_str()))
                .collect::<Vec<_>>(),
            [(1000, "first"), (7000, "late")]
        );
        assert_eq!(
            p.source
                .comments
                .iter()
                .map(|c| (c.word, c.end, c.body.as_str()))
                .collect::<Vec<_>>(),
            [(0, 1, "on a b"), (2, 3, "on e f")]
        );
        assert_eq!(
            p.source_audio,
            [Piece::Source(0, 3000), Piece::Source(5000, 10_000)]
        );

        assert_eq!(
            texts(&p.target),
            [(0, "x".into()), (1500, "c d".into()), (4000, "y z".into())]
        );
        assert_eq!(p.target.duration, 6000);
        assert_eq!(
            p.target
                .notes
                .iter()
                .map(|n| (n.at_ms, n.body.as_str()))
                .collect::<Vec<_>>(),
            [(2500, "middle"), (4500, "target")]
        );
        let mut cs: Vec<_> = p
            .target
            .comments
            .iter()
            .map(|c| (c.word, c.end, c.body.as_str()))
            .collect();
        cs.sort();
        assert_eq!(cs, [(1, 2, "on c d"), (3, 4, "on y z")]);
        assert_eq!(
            p.target_audio,
            [
                Piece::Target(0, 1500),
                Piece::Source(3000, 5000),
                Piece::Target(1500, 4000)
            ]
        );
    }

    #[test]
    fn separate_blocks_join_with_a_short_gap_and_copy_leaves_the_source() {
        let p = plan(&source(), None, &[(0, 2000), (6000, 8000)], 0, true);
        assert_eq!(
            texts(&p.target),
            [(0, "a b".into()), (2000 + GAP_MS, "e f".into())]
        );
        assert_eq!(p.target.duration, 4000 + GAP_MS);
        assert_eq!(
            p.target_audio,
            [
                Piece::Source(0, 2000),
                Piece::Silence(GAP_MS),
                Piece::Source(6000, 8000)
            ]
        );
        assert_eq!(p.source, source());
        assert!(p.source_audio.is_empty());
    }

    #[test]
    fn inserts_by_time_without_splitting_a_target_segment() {
        let target = Doc {
            duration: 5000,
            segments: vec![seg(0, 1000, 3000, "x")],
            ..Doc::default()
        };
        assert_eq!(insert_at(&target, 2000), 3000);
        assert_eq!(insert_at(&target, -50), 0);
        assert_eq!(insert_at(&target, 9000), 5000);
    }
}
