use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub display_name: String,
    pub other_name: String,
    pub theme: String,
    pub hotkey: String,
    pub mic_device: Option<String>,
    pub capture_system: bool,
    pub languages: Vec<String>,
    pub auto_transcribe: bool,
    pub vocabulary: String,
    pub export_timestamps: bool,
    pub check_updates: bool,
    pub ui: serde_json::Value,
    pub demos_seeded: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display_name: "Me".into(),
            other_name: String::new(),
            theme: "system".into(),
            hotkey: "CommandOrControl+Shift+R".into(),
            mic_device: None,
            capture_system: true,
            languages: vec!["en".into(), "uk".into()],
            auto_transcribe: true,
            vocabulary: String::new(),
            export_timestamps: true,
            check_updates: true,
            ui: serde_json::Value::Null,
            demos_seeded: false,
        }
    }
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(settings).unwrap())?;
    std::fs::rename(tmp, path)
}
