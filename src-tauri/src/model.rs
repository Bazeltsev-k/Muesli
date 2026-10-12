use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::Path;

pub const FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
const URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const SHA256: &str = "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2";
pub const SIZE: u64 = 574041195;

pub async fn download(path: &Path, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let response = reqwest::get(URL)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(SIZE);
    let part = path.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut reported = 0u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if received - reported > 2_000_000 || received == total {
            reported = received;
            progress(received, total);
        }
    }
    drop(file);
    let hash: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if hash != SHA256 {
        let _ = std::fs::remove_file(&part);
        return Err("Downloaded model is corrupted, please try again".into());
    }
    std::fs::rename(&part, path).map_err(|e| e.to_string())
}
