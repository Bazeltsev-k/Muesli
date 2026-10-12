use muesli_lib::{model, recorder, settings::Settings, transcribe};
use std::path::{Path, PathBuf};

fn model_path() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap()
        .join("Library/Application Support/com.bazeltsev.muesli/models")
        .join(model::FILE)
}

#[test]
fn transcribes_both_channels_with_language_switching() {
    let model = model_path();
    if !model.exists() {
        eprintln!("skipping: model not downloaded");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/conversation.m4a");
    let channels = recorder::decode(&bin, &fixture, &dir.path().join("decoded.f32")).unwrap();

    let settings = Settings {
        primary_lang: "uk".into(),
        secondary_lang: Some("ru".into()),
        ..Settings::default()
    };
    let segments = transcribe::transcribe(&model, &channels, &settings, |_| {}).unwrap();
    let turns: Vec<(i64, &str)> = segments
        .iter()
        .map(|s| (s.speaker, s.lang.as_str()))
        .collect();
    assert_eq!(turns[1..], [(1, "ru"), (0, "uk"), (1, "ru")]);
    assert!(
        segments[3].text().to_lowercase().contains("четверг"),
        "{}",
        segments[3].text()
    );
    for s in &segments {
        assert!(s.words.windows(2).all(|w| w[0].start_ms <= w[1].start_ms));
        assert!(s.words[0].start_ms >= s.start_ms - 500 && s.words[0].start_ms <= s.end_ms);
    }
}
