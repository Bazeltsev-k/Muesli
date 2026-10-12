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
