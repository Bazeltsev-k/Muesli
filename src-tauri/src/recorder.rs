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
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(std::fs::File::create(dir.join("recorder.log"))?)
        .spawn()
}

pub fn send(stdin: &mut ChildStdin, command: &str) {
    use std::io::Write;
    let _ = writeln!(stdin, "{command}");
}

pub fn decode(bin: &Path, audio: &Path, tmp: &Path) -> Result<[Vec<f32>; 2], String> {
    let frames = decode_to(bin, audio, tmp)?;
    let channels = read_range(tmp, 0, frames);
    let _ = std::fs::remove_file(tmp);
    channels
}

pub fn decode_to(bin: &Path, audio: &Path, tmp: &Path) -> Result<usize, String> {
    run(
        bin,
        &["decode", &audio.to_string_lossy(), &tmp.to_string_lossy()],
    )?;
    std::fs::metadata(tmp)
        .map(|m| m.len() as usize / 8)
        .map_err(|e| e.to_string())
}

pub fn read_range(path: &Path, start: usize, end: usize) -> Result<[Vec<f32>; 2], String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start as u64 * 8))
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![0u8; end.saturating_sub(start) * 8];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    let mut channels = [
        Vec::with_capacity(bytes.len() / 8),
        Vec::with_capacity(bytes.len() / 8),
    ];
    for frame in bytes.as_chunks::<8>().0 {
        channels[0].push(f32::from_le_bytes(frame[..4].try_into().unwrap()));
        channels[1].push(f32::from_le_bytes(frame[4..].try_into().unwrap()));
    }
    Ok(channels)
}

pub fn splice(bin: &Path, out: &Path, pieces: &[Value]) -> Result<i64, String> {
    let spec = out.with_extension("splice.json");
    std::fs::write(&spec, Value::from(pieces.to_vec()).to_string()).map_err(|e| e.to_string())?;
    let result = run(
        bin,
        &["splice", &out.to_string_lossy(), &spec.to_string_lossy()],
    );
    let _ = std::fs::remove_file(&spec);
    result.map(|v| v["ms"].as_i64().unwrap_or(0))
}
