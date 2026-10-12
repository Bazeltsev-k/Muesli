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
