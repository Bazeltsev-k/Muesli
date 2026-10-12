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
    pub primary_lang: String,
    pub secondary_lang: Option<String>,
    pub auto_transcribe: bool,
    pub vocabulary: String,
    pub export_timestamps: bool,
    pub check_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            display_name: "Me".into(),
            other_name: "Them".into(),
            theme: "system".into(),
            hotkey: "Control+Alt+R".into(),
            mic_device: None,
            capture_system: true,
            primary_lang: "en".into(),
            secondary_lang: None,
            auto_transcribe: true,
            vocabulary: String::new(),
            export_timestamps: true,
            check_updates: true,
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
