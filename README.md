# Muesli

A local-first meeting recorder for macOS. Muesli records your microphone and your computer's audio into separate channels, transcribes them on-device with whisper.cpp, and keeps everything on your Mac.

- Mic and system audio in separate stereo channels, so every line is labelled with who said it
- On-device transcription (Whisper large-v3-turbo, Metal) in English, Ukrainian and Russian, with a primary and secondary language per speaker turn
- Playback with a karaoke transcript: the current word is highlighted, and clicking any word jumps there
- Titles, colored tags, general and timestamped notes, comments on any words, editable transcripts, full-text search
- Interface in English, Ukrainian and Russian, with a first-launch walkthrough and two demo recordings
- Themeable sidebar and background colors, grain and floating panels
- Export to `.txt`
- Menu bar recorder and a global hotkey
- Light, dark and system themes
- Automatic updates from GitHub Releases

Requires macOS 14.4+ on Apple Silicon.

## Install

Download the latest `.dmg` from [Releases](https://github.com/Bazeltsev-k/Muesli/releases), drag Muesli to Applications, then clear the quarantine flag once (the app isn't notarized):

```sh
xattr -cr /Applications/Muesli.app
```

On first launch, open **Settings → Transcription** to download the model (574 MB), and **Settings → Permissions** to allow the microphone and system audio. Use headphones during calls so your mic doesn't pick up the other side.

## Develop

Prerequisites: Xcode Command Line Tools, Rust, Bun and CMake (`brew install cmake`).

```sh
bun install
bun tauri dev
```

Tests:

```sh
bun run test
cd src-tauri && cargo test
```

The end-to-end transcription test runs only when the model is downloaded to `~/Library/Application Support/com.bazeltsev.muesli/models`.

### Layout

- `src/`: React UI
- `src-tauri/src/`: Rust core (SQLite, transcription queue, model download, commands)
- `src-tauri/recorder/main.swift`: audio helper (Core Audio process tap and mic capture, permissions, AAC encode and decode), built by `build.rs` and bundled as a sidecar

## Release

1. Bump `version` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.
2. Commit, then tag and push: `git tag v0.2.0 && git push --tags`.

The Release workflow builds the app, signs the update with `TAURI_SIGNING_PRIVATE_KEY`, and publishes a GitHub release with `latest.json` for the in-app updater. Running the workflow manually creates a draft release instead.
