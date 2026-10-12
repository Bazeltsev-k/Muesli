pub mod db;
pub mod demo;
pub mod model;
pub mod recorder;
pub mod settings;
pub mod transcribe;

use db::{Note, Recording, Segment};
use rusqlite::Connection;
use serde_json::Value;
use settings::Settings;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, mpsc};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

type Res<T> = Result<T, String>;

fn err(e: impl ToString) -> String {
    e.to_string()
}

struct Active {
    id: i64,
    stdin: ChildStdin,
}

struct AppState {
    db: Mutex<Connection>,
    dir: PathBuf,
    settings: Mutex<Settings>,
    active: Mutex<Option<Active>>,
    starting: AtomicBool,
    downloading: AtomicBool,
    jobs: mpsc::Sender<i64>,
    toggle_item: MenuItem<Wry>,
}

impl AppState {
    fn recording_dir(&self, id: i64) -> PathBuf {
        self.dir.join("recordings").join(id.to_string())
    }

    fn model_path(&self) -> PathBuf {
        self.dir.join("models").join(model::FILE)
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

fn changed(app: &AppHandle) {
    let _ = app.emit("recordings-changed", ());
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn set_recording_ui(app: &AppHandle, id: Option<i64>) {
    let state = app.state::<AppState>();
    let _ = state.toggle_item.set_text(if id.is_some() {
        "Stop recording"
    } else {
        "New recording"
    });
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_title(id.map(|_| "REC"));
    }
    let _ = app.emit("recorder-state", id);
    changed(app);
}

fn enqueue(app: &AppHandle, id: i64) {
    let state = app.state::<AppState>();
    let _ = db::set_status(&state.db.lock().unwrap(), id, "queued", None);
    let _ = state.jobs.send(id);
    changed(app);
}

fn toggle(app: &AppHandle) {
    let state = app.state::<AppState>();
    if !stop(&state) {
        show_main(app);
        let _ = app.emit("open-draft", ());
    }
}

fn stop(state: &AppState) -> bool {
    match state.active.lock().unwrap().as_mut() {
        Some(active) => {
            recorder::send(&mut active.stdin, "stop");
            true
        }
        None => false,
    }
}

fn start(app: &AppHandle, id: i64) {
    let state = app.state::<AppState>();
    if state.active.lock().unwrap().is_some() || state.starting.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let result = begin(&app, id);
        app.state::<AppState>()
            .starting
            .store(false, Ordering::SeqCst);
        if let Err(e) = result {
            let _ = app.emit("recorder-error", e);
        }
    });
}

fn begin(app: &AppHandle, id: i64) -> Res<()> {
    let state = app.state::<AppState>();
    let bin = recorder::binary();
    let settings = state.settings.lock().unwrap().clone();
    let mut perms = recorder::run(&bin, &["permissions"])?;
    if perms["microphone"] == "undetermined" {
        perms = recorder::run(&bin, &["request", "microphone"])?;
    }
    if perms["microphone"] != "granted" && perms["microphone"] != "unknown" {
        return Err("Microphone access isn't granted. Allow it in Settings → Permissions.".into());
    }
    let mut system = settings.capture_system;
    if system && perms["systemAudio"] == "undetermined" {
        perms = recorder::run(&bin, &["request", "systemAudio"])?;
    }
    if system && perms["systemAudio"] == "denied" {
        system = false;
        let _ = app.emit(
            "recorder-error",
            "System audio access is denied, recording your microphone only.",
        );
    }

    {
        let db = state.db.lock().unwrap();
        db::set_created_at(&db, id, now_ms()).map_err(err)?;
        db::set_status(&db, id, "recording", None).map_err(err)?;
    }
    let dir = state.recording_dir(id);
    let spawned = std::fs::create_dir_all(&dir)
        .and_then(|_| recorder::spawn(&dir, settings.mic_device.as_deref(), system));
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            let _ = db::set_status(
                &state.db.lock().unwrap(),
                id,
                "failed",
                Some(&e.to_string()),
            );
            changed(app);
            return Err(e.to_string());
        }
    };
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    *state.active.lock().unwrap() = Some(Active { id, stdin });
    set_recording_ui(app, Some(id));
    let app = app.clone();
    std::thread::spawn(move || watch(app, id, child, stdout));
    Ok(())
}

fn watch(app: AppHandle, id: i64, mut child: Child, stdout: ChildStdout) {
    let mut outcome = None;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        match recorder::parse_line(&line) {
            Ok(v) if v["type"] == "level" => {
                let _ = app.emit("recorder-level", v);
            }
            Ok(v) if v["type"] == "done" => outcome = Some(Ok(v["ms"].as_i64().unwrap_or(0))),
            Ok(_) => {}
            Err(e) => outcome = Some(Err(e)),
        }
    }
    let _ = child.wait();
    let state = app.state::<AppState>();
    state.active.lock().unwrap().take();
    let outcome = outcome.unwrap_or_else(|| finalize(&state, id));
    finish(&app, id, outcome);
    set_recording_ui(&app, None);
}

fn finalize(state: &AppState, id: i64) -> Res<i64> {
    let dir = state.recording_dir(id);
    recorder::run(&recorder::binary(), &["finalize", &dir.to_string_lossy()])
        .map(|v| v["ms"].as_i64().unwrap_or(0))
}

fn finish(app: &AppHandle, id: i64, outcome: Res<i64>) {
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    match outcome.and_then(|ms| match ms {
        0 => Err("No audio was captured. Check Settings → Permissions.".to_string()),
        ms => Ok(ms),
    }) {
        Ok(ms) => {
            let dir = state.recording_dir(id);
            std::thread::spawn(move || playback_file(&dir));
            let _ = db::set_duration(&db, id, ms);
            let _ = db::set_status(&db, id, "recorded", None);
            drop(db);
            if state.settings.lock().unwrap().auto_transcribe && state.model_path().exists() {
                enqueue(app, id);
            }
        }
        Err(e) => {
            let _ = db::set_status(&db, id, "failed", Some(&e));
            let _ = app.emit("recorder-error", e);
        }
    }
    changed(app);
}

fn worker(app: AppHandle, jobs: mpsc::Receiver<i64>) {
    for id in jobs {
        let state = app.state::<AppState>();
        let _ = db::set_status(&state.db.lock().unwrap(), id, "transcribing", None);
        changed(&app);
        let vocabulary = state.settings.lock().unwrap().vocabulary.clone();
        let languages = db::get_recording(&state.db.lock().unwrap(), id)
            .ok()
            .flatten()
            .map(|r| r.languages)
            .unwrap_or_default();
        let dir = state.recording_dir(id);
        let result = recorder::decode(
            &recorder::binary(),
            &dir.join("audio.m4a"),
            &dir.join("decoded.f32"),
        )
        .and_then(|channels| {
            transcribe::transcribe(
                &state.model_path(),
                &channels,
                &languages,
                &vocabulary,
                |p| {
                    let _ = app.emit("transcribe-progress", (id, p));
                },
            )
        });
        let mut db = state.db.lock().unwrap();
        let _ = match result {
            Ok(segments) => db::replace_segments(&mut db, id, &segments)
                .and_then(|_| db::set_status(&db, id, "done", None)),
            Err(e) => db::set_status(&db, id, "failed", Some(&e)),
        };
        drop(db);
        changed(&app);
    }
}

fn register_hotkey(app: &AppHandle, hotkey: &str) -> Res<()> {
    let shortcuts = app.global_shortcut();
    shortcuts.unregister_all().map_err(err)?;
    if hotkey.trim().is_empty() {
        return Ok(());
    }
    shortcuts
        .register(hotkey)
        .map_err(|e| format!("Can't use hotkey {hotkey}: {e}"))
}

#[tauri::command]
fn list_recordings(
    state: State<AppState>,
    query: String,
    tag: Option<String>,
) -> Res<Vec<Recording>> {
    db::list_recordings(&state.db.lock().unwrap(), &query, tag.as_deref()).map_err(err)
}

#[tauri::command]
fn get_recording(state: State<AppState>, id: i64) -> Res<Option<Recording>> {
    db::get_recording(&state.db.lock().unwrap(), id).map_err(err)
}

#[tauri::command]
fn get_segments(state: State<AppState>, id: i64) -> Res<Vec<Segment>> {
    db::get_segments(&state.db.lock().unwrap(), id).map_err(err)
}

#[tauri::command]
fn list_notes(state: State<AppState>, id: i64) -> Res<Vec<Note>> {
    db::list_notes(&state.db.lock().unwrap(), id).map_err(err)
}

#[tauri::command]
fn update_title(app: AppHandle, state: State<AppState>, id: i64, title: String) -> Res<()> {
    db::set_title(&state.db.lock().unwrap(), id, title.trim()).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn update_note(state: State<AppState>, id: i64, note: String) -> Res<()> {
    db::set_note(&state.db.lock().unwrap(), id, &note).map_err(err)
}

#[tauri::command]
fn set_tags(app: AppHandle, state: State<AppState>, id: i64, tags: Vec<String>) -> Res<()> {
    db::set_tags(&mut state.db.lock().unwrap(), id, &tags).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn set_languages(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    languages: Vec<String>,
) -> Res<()> {
    if languages.is_empty() {
        return Err("Pick at least one language".into());
    }
    db::set_languages(&state.db.lock().unwrap(), id, &languages).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn all_tags(state: State<AppState>) -> Res<Vec<db::Tag>> {
    db::all_tags(&state.db.lock().unwrap()).map_err(err)
}

#[tauri::command]
fn add_note(state: State<AppState>, id: i64, at_ms: i64, body: String) -> Res<Note> {
    db::add_note(&state.db.lock().unwrap(), id, at_ms, body.trim()).map_err(err)
}

#[tauri::command]
fn delete_note(state: State<AppState>, note_id: i64) -> Res<()> {
    db::delete_note(&state.db.lock().unwrap(), note_id).map_err(err)
}

#[tauri::command]
fn delete_recording(app: AppHandle, state: State<AppState>, id: i64) -> Res<()> {
    if state
        .active
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|a| a.id == id)
    {
        return Err("Stop the recording before deleting it".into());
    }
    db::delete_recording(&state.db.lock().unwrap(), id).map_err(err)?;
    let _ = std::fs::remove_dir_all(state.recording_dir(id));
    changed(&app);
    Ok(())
}

#[tauri::command]
async fn audio_path(state: State<'_, AppState>, id: i64) -> Res<String> {
    playback_file(&state.recording_dir(id))
}

fn playback_file(dir: &std::path::Path) -> Res<String> {
    let playback = dir.join("playback.m4a");
    if !playback.exists() {
        recorder::run(
            &recorder::binary(),
            &[
                "mixdown",
                &dir.join("audio.m4a").to_string_lossy(),
                &playback.to_string_lossy(),
            ],
        )?;
    }
    Ok(playback.to_string_lossy().into_owned())
}

#[tauri::command]
fn create_draft(app: AppHandle, state: State<AppState>) -> Res<i64> {
    if let Some(id) = db::ids_with_status(&state.db.lock().unwrap(), &["draft"])
        .map_err(err)?
        .first()
    {
        return Ok(*id);
    }
    let settings = state.settings.lock().unwrap().clone();
    let id = db::create_recording(
        &state.db.lock().unwrap(),
        "",
        now_ms(),
        "draft",
        &settings.languages,
        &settings.other_name,
    )
    .map_err(err)?;
    changed(&app);
    Ok(id)
}

#[tauri::command]
fn start_recording(app: AppHandle, id: i64) {
    start(&app, id);
}

#[tauri::command]
fn update_them(app: AppHandle, state: State<AppState>, id: i64, them: String) -> Res<()> {
    db::set_them(&state.db.lock().unwrap(), id, them.trim()).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn set_tag_color(app: AppHandle, state: State<AppState>, name: String, color: String) -> Res<()> {
    db::upsert_tag(&state.db.lock().unwrap(), &name, &color).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn rename_tag(app: AppHandle, state: State<AppState>, from: String, to: String) -> Res<()> {
    db::rename_tag(&state.db.lock().unwrap(), &from, to.trim())
        .map_err(|_| format!("A tag named “{}” already exists", to.trim()))?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_tag(app: AppHandle, state: State<AppState>, name: String) -> Res<()> {
    db::delete_tag(&state.db.lock().unwrap(), &name).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn list_comments(state: State<AppState>, id: i64) -> Res<Vec<db::Comment>> {
    db::list_comments(&state.db.lock().unwrap(), id).map_err(err)
}

#[tauri::command]
fn add_comment(
    state: State<AppState>,
    id: i64,
    word: i64,
    end: i64,
    body: String,
) -> Res<db::Comment> {
    db::add_comment(&state.db.lock().unwrap(), id, word, end, body.trim()).map_err(err)
}

#[tauri::command]
fn delete_comment(state: State<AppState>, comment_id: i64) -> Res<()> {
    db::delete_comment(&state.db.lock().unwrap(), comment_id).map_err(err)
}

#[tauri::command]
fn set_segments(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    segments: Vec<Segment>,
) -> Res<()> {
    db::replace_segments(&mut state.db.lock().unwrap(), id, &segments).map_err(err)?;
    changed(&app);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>) {
    stop(&state);
}

#[tauri::command]
fn pause_recording(state: State<AppState>, paused: bool) {
    if let Some(active) = state.active.lock().unwrap().as_mut() {
        recorder::send(&mut active.stdin, if paused { "pause" } else { "resume" });
    }
}

#[tauri::command]
fn active_recording(state: State<AppState>) -> Option<i64> {
    state.active.lock().unwrap().as_ref().map(|a| a.id)
}

#[tauri::command]
fn transcribe(app: AppHandle, state: State<AppState>, id: i64) -> Res<()> {
    if !state.model_path().exists() {
        return Err("Download the transcription model in Settings first".into());
    }
    enqueue(&app, id);
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Res<()> {
    let old = state.settings.lock().unwrap().hotkey.clone();
    if settings.hotkey != old
        && let Err(e) = register_hotkey(&app, &settings.hotkey)
    {
        let _ = register_hotkey(&app, &old);
        return Err(e);
    }
    settings::save(&state.dir.join("settings.json"), &settings).map_err(err)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
async fn list_devices() -> Res<Value> {
    recorder::run(&recorder::binary(), &["devices"])
}

#[tauri::command]
async fn permissions() -> Res<Value> {
    recorder::run(&recorder::binary(), &["permissions"])
}

#[tauri::command]
async fn request_permission(kind: String) -> Res<Value> {
    recorder::run(&recorder::binary(), &["request", &kind])
}

#[tauri::command]
fn open_privacy(kind: String) -> Res<()> {
    let pane = if kind == "microphone" {
        "Privacy_Microphone"
    } else {
        "Privacy_ScreenCapture"
    };
    std::process::Command::new("open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .spawn()
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
fn open_data_dir(state: State<AppState>) -> Res<()> {
    std::process::Command::new("open")
        .arg(&state.dir)
        .spawn()
        .map(|_| ())
        .map_err(err)
}

#[tauri::command]
fn model_installed(state: State<AppState>) -> bool {
    state.model_path().exists()
}

#[tauri::command]
async fn download_model(app: AppHandle, state: State<'_, AppState>) -> Res<()> {
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("Download already in progress".into());
    }
    let path = state.model_path();
    let result = match std::fs::create_dir_all(path.parent().unwrap()) {
        Ok(_) => {
            model::download(&path, |received, total| {
                let _ = app.emit("model-progress", (received, total));
            })
            .await
        }
        Err(e) => Err(e.to_string()),
    };
    state.downloading.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
fn delete_model(state: State<AppState>) -> Res<()> {
    std::fs::remove_file(state.model_path()).map_err(err)
}

#[tauri::command]
fn save_text(path: String, text: String) -> Res<()> {
    std::fs::write(path, text).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(dir.join("recordings"))?;
            let mut conn = db::open(&dir.join("muesli.db"))?;
            let mut settings = settings::load(&dir.join("settings.json"));
            if !settings.demos_seeded {
                match demo::seed(
                    &mut conn,
                    &app.path().resource_dir()?.join("demo"),
                    &dir.join("recordings"),
                    now_ms(),
                ) {
                    Ok(()) => {
                        settings.demos_seeded = true;
                        let _ = settings::save(&dir.join("settings.json"), &settings);
                    }
                    Err(e) => eprintln!("seeding demos failed: {e}"),
                }
            }

            let toggle_item =
                MenuItem::with_id(app, "toggle", "New recording", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "Open Muesli", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Muesli", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &toggle_item,
                    &open_item,
                    &PredefinedMenuItem::separator(app)?,
                    &quit_item,
                ],
            )?;
            TrayIconBuilder::with_id("main")
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .icon_as_template(true)
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle(app),
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let (jobs, rx) = mpsc::channel();
            let pending = db::ids_with_status(&conn, &["queued", "transcribing"])?;
            let mut interrupted = db::ids_with_status(&conn, &["recording"])?;
            interrupted.extend(
                db::ids_with_status(&conn, &["failed"])?
                    .into_iter()
                    .filter(|id| {
                        dir.join("recordings")
                            .join(id.to_string())
                            .join("raw.pcm")
                            .exists()
                    }),
            );
            let hotkey = settings.hotkey.clone();
            app.manage(AppState {
                db: Mutex::new(conn),
                dir,
                settings: Mutex::new(settings),
                active: Mutex::new(None),
                starting: AtomicBool::new(false),
                downloading: AtomicBool::new(false),
                jobs,
                toggle_item,
            });

            let handle = app.handle().clone();
            std::thread::spawn(move || worker(handle, rx));
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for id in interrupted {
                    let outcome = finalize(&handle.state::<AppState>(), id);
                    finish(&handle, id, outcome);
                }
                for id in pending {
                    enqueue(&handle, id);
                }
            });
            if let Err(e) = register_hotkey(app.handle(), &hotkey) {
                eprintln!("{e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_recordings,
            get_recording,
            get_segments,
            list_notes,
            update_title,
            update_note,
            set_tags,
            set_languages,
            all_tags,
            add_note,
            delete_note,
            delete_recording,
            audio_path,
            create_draft,
            start_recording,
            update_them,
            set_tag_color,
            rename_tag,
            delete_tag,
            list_comments,
            add_comment,
            delete_comment,
            set_segments,
            stop_recording,
            pause_recording,
            active_recording,
            transcribe,
            get_settings,
            save_settings,
            list_devices,
            permissions,
            request_permission,
            open_privacy,
            open_data_dir,
            model_installed,
            download_model,
            delete_model,
            save_text,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Reopen { .. } = event {
                show_main(app);
            }
        });
}
