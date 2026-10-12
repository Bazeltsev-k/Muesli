use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

pub fn binary() -> PathBuf {
    std::env::current_exe()
        .unwrap()
        .with_file_name("muesli-recorder")
}

pub fn parse_line(line: &str) -> Result<Value, String> {
    let value: Value =
        serde_json::from_str(line).map_err(|_| format!("Unexpected recorder output: {line}"))?;
    match value["type"].as_str() {
        Some("error") => Err(value["message"]
            .as_str()
            .unwrap_or("Recorder failed")
            .to_string()),
        _ => Ok(value),
    }
}

pub fn run(bin: &Path, args: &[&str]) -> Result<Value, String> {
    let output = Command::new(bin)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_line(
        stdout
            .lines()
            .last()
            .unwrap_or("{\"type\":\"error\",\"message\":\"Recorder crashed\"}"),
    )
}

pub fn spawn(dir: &Path, mic: Option<&str>, system: bool) -> std::io::Result<Child> {
    let mut cmd = Command::new(binary());
    cmd.arg("record").arg(dir);
    if let Some(mic) = mic {
        cmd.args(["--mic", mic]);
    }
    if !system {
        cmd.arg("--no-system");
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).spawn()
}

pub fn send(stdin: &mut ChildStdin, command: &str) {
    use std::io::Write;
    let _ = writeln!(stdin, "{command}");
}

pub fn decode(bin: &Path, audio: &Path, tmp: &Path) -> Result<[Vec<f32>; 2], String> {
    run(
        bin,
        &["decode", &audio.to_string_lossy(), &tmp.to_string_lossy()],
    )?;
    let bytes = std::fs::read(tmp).map_err(|e| e.to_string());
    let _ = std::fs::remove_file(tmp);
    let samples: Vec<f32> = bytes?
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    Ok([
        samples.iter().step_by(2).copied().collect(),
        samples.iter().skip(1).step_by(2).copied().collect(),
    ])
}
