fn main() {
    println!("cargo:rerun-if-changed=recorder/main.swift");
    std::fs::create_dir_all("binaries").unwrap();
    let status = std::process::Command::new("swiftc")
        .args([
            "-O",
            "-target",
            "arm64-apple-macos14.4",
            "recorder/main.swift",
            "-o",
            "binaries/muesli-recorder-aarch64-apple-darwin",
        ])
        .status()
        .expect("swiftc is required to build the recorder");
    assert!(status.success(), "building the recorder failed");
    tauri_build::build()
}
