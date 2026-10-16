use muesli_lib::recorder;
use std::path::Path;

#[test]
fn finalizes_high_sample_rate_recordings() {
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    for rate in [44100, 96000] {
        let dir = tempfile::tempdir().unwrap();
        let pcm: Vec<u8> = (0..rate * 2)
            .flat_map(|i| [((i as f32 / 20.0).sin() * 8000.0) as i16, 0])
            .flat_map(i16::to_le_bytes)
            .collect();
        std::fs::write(dir.path().join("raw.pcm"), pcm).unwrap();
        std::fs::write(dir.path().join("raw.json"), format!("{{\"rate\": {rate}}}")).unwrap();
        let done = recorder::run(&bin, &["finalize", &dir.path().to_string_lossy()]).unwrap();
        assert_eq!(done["ms"], 2000, "rate {rate}");
        assert!(!dir.path().join("raw.pcm").exists());
    }
}

#[test]
fn mixes_both_channels_into_both_ears_for_playback() {
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/conversation.m4a");
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("playback.m4a");
    recorder::run(
        &bin,
        &[
            "mixdown",
            &fixture.to_string_lossy(),
            &out.to_string_lossy(),
        ],
    )
    .unwrap();
    let [left, right] = recorder::decode(&bin, &out, &dir.path().join("decoded.f32")).unwrap();
    let rms = |s: &[f32]| (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt();
    let [mic, system] = recorder::decode(&bin, &fixture, &dir.path().join("orig.f32")).unwrap();
    let (a, b) = (left.len() / 2, right.len());
    assert!(rms(&left[..a]) > 0.01 && rms(&right[..a]) > 0.01);
    assert!((rms(&left) - rms(&right)).abs() < 0.002);
    assert!((b as i64 - mic.len() as i64).abs() < 1600 && rms(&system) > 0.0);
}

#[test]
fn splices_pieces_of_recordings_with_silence_between() {
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/conversation.m4a");
    let file = fixture.to_string_lossy();
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("audio.m4a");
    let ms = recorder::splice(
        &bin,
        &out,
        &[
            serde_json::json!({"file": file, "start": 1000, "end": 2000}),
            serde_json::json!({"silence": 500}),
            serde_json::json!({"file": file, "start": 3000, "end": 4000}),
        ],
    )
    .unwrap();
    assert!((ms - 2500).abs() < 30, "{ms}");
    let [mic, sys] = recorder::decode(&bin, &out, &dir.path().join("d.f32")).unwrap();
    let rms = |s: &[f32]| (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt();
    let gap = 16_000 * 1100 / 1000..16_000 * 1400 / 1000;
    assert!(rms(&mic[gap.clone()]) < 1e-4 && rms(&sys[gap]) < 1e-4);
    assert!((mic.len() as i64 - 40_000).abs() < 800);
}

#[test]
fn playback_lifts_a_mic_that_another_app_turned_down() {
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    let dir = tempfile::tempdir().unwrap();
    let rate = 48_000;
    let pcm: Vec<u8> = (0..rate * 12)
        .flat_map(|i| {
            let speaking = (i / (rate / 2)) % 3 == 0;
            let mic = if speaking {
                (i as f32 / 20.0).sin() * 70.0
            } else {
                0.0
            };
            [mic as i16, 0]
        })
        .flat_map(i16::to_le_bytes)
        .collect();
    std::fs::write(dir.path().join("raw.pcm"), pcm).unwrap();
    std::fs::write(dir.path().join("raw.json"), format!("{{\"rate\": {rate}}}")).unwrap();
    recorder::run(&bin, &["finalize", &dir.path().to_string_lossy()]).unwrap();
    let out = dir.path().join("playback.m4a");
    recorder::run(
        &bin,
        &[
            "mixdown",
            &dir.path().join("audio.m4a").to_string_lossy(),
            &out.to_string_lossy(),
        ],
    )
    .unwrap();
    let [left, _] = recorder::decode(&bin, &out, &dir.path().join("d.f32")).unwrap();
    let peak = left.iter().fold(0f32, |m, x| m.max(x.abs()));
    assert!(peak > 0.03, "{peak}");
}
