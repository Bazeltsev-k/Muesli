use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=recorder/main.swift");
    std::fs::create_dir_all("binaries").unwrap();
    let status = Command::new("swiftc")
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

    let runtime = Command::new("clang")
        .arg("--print-runtime-dir")
        .output()
        .expect("clang is required");
    println!(
        "cargo:rustc-link-search=native={}",
        String::from_utf8_lossy(&runtime.stdout).trim()
    );
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
    tauri_build::build()
}
