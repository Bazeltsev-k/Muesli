use std::path::Path;

#[test]
fn hardened_runtime_bundle_is_entitled_to_record_audio() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("tauri.conf.json")).unwrap())
            .unwrap();
    let entitlements = config["bundle"]["macOS"]["entitlements"]
        .as_str()
        .expect("bundle.macOS.entitlements is not set");
    let plist = std::fs::read_to_string(root.join(entitlements)).unwrap();
    assert!(plist.contains("<key>com.apple.security.device.audio-input</key>\n  <true/>"));
}
