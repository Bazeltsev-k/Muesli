use crate::blocks::{Doc, Piece, plan, ranges};
use crate::db::{self, Recording};
use crate::recorder;
use rusqlite::Connection;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Undo {
    pub created: Option<i64>,
    pub docs: Vec<(i64, Doc)>,
}

pub struct Store<'a> {
    pub db: &'a Mutex<Connection>,
    pub dir: &'a Path,
    pub bin: &'a Path,
}

impl Store<'_> {
    fn recording_dir(&self, id: i64) -> PathBuf {
        self.dir.join("recordings").join(id.to_string())
    }
}

pub fn load_doc(conn: &Connection, id: i64) -> Result<Doc, String> {
    let rec = db::get_recording(conn, id)
        .map_err(|e| e.to_string())?
        .ok_or("Recording not found")?;
    Ok(Doc {
        duration: rec.duration_ms,
        segments: db::get_segments(conn, id).map_err(|e| e.to_string())?,
        notes: db::list_notes(conn, id).map_err(|e| e.to_string())?,
        comments: db::list_comments(conn, id).map_err(|e| e.to_string())?,
    })
}

pub fn save_doc(conn: &mut Connection, id: i64, doc: &Doc) -> Result<(), String> {
    db::replace_segments(conn, id, &doc.segments).map_err(|e| e.to_string())?;
    db::replace_notes(conn, id, &doc.notes).map_err(|e| e.to_string())?;
    db::replace_comments(conn, id, &doc.comments).map_err(|e| e.to_string())?;
    db::set_duration(conn, id, doc.duration).map_err(|e| e.to_string())
}

fn movable(rec: &Recording) -> Result<(), String> {
    match rec.status.as_str() {
        "done" => Ok(()),
        _ => Err("Only transcribed recordings can be changed".into()),
    }
}

pub fn apply(
    store: &Store,
    id: i64,
    picked: &[(i64, i64)],
    target: Option<i64>,
    copy: bool,
    at_start: bool,
    title: &str,
) -> Result<(i64, Undo), String> {
    let (src, source, dst, old_target) = {
        let db = store.db.lock().unwrap();
        let src = db::get_recording(&db, id)
            .map_err(|e| e.to_string())?
            .ok_or("Recording not found")?;
        movable(&src)?;
        let source = load_doc(&db, id)?;
        let dst = match target {
            Some(t) => {
                let rec = db::get_recording(&db, t)
                    .map_err(|e| e.to_string())?
                    .ok_or("Recording not found")?;
                movable(&rec)?;
                Some((rec, load_doc(&db, t)?))
            }
            None => None,
        };
        (
            src,
            source,
            dst.as_ref().map(|d| d.0.clone()),
            dst.map(|d| d.1),
        )
    };
    let ranges = ranges(&source.segments, picked, source.duration);
    let first = ranges.first().ok_or("Nothing to move")?.0;
    let wanted = if at_start { 0 } else { i64::MAX };
    let plan = plan(&source, old_target.as_ref(), picked, wanted, copy);

    let target_id = match &dst {
        Some(t) => t.id,
        None => {
            let db = store.db.lock().unwrap();
            let t = db::create_recording(
                &db,
                title,
                src.created_at + first,
                "done",
                &src.languages,
                &src.them,
            )
            .map_err(|e| e.to_string())?;
            db::set_speakers(&db, t, &src.speakers).map_err(|e| e.to_string())?;
            t
        }
    };
    let src_dir = store.recording_dir(id);
    let dst_dir = store.recording_dir(target_id);
    std::fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
    let bin = store.bin;
    let pieces = |list: &[Piece]| -> Vec<Value> {
        list.iter()
            .map(|p| match p {
                Piece::Source(a, b) => {
                    serde_json::json!({"file": src_dir.join("audio.m4a"), "start": a, "end": b})
                }
                Piece::Target(a, b) => {
                    serde_json::json!({"file": dst_dir.join("audio.m4a"), "start": a, "end": b})
                }
                Piece::Silence(ms) => serde_json::json!({"silence": ms}),
            })
            .collect()
    };
    let target_ms = recorder::splice(
        bin,
        &dst_dir.join("audio.next.m4a"),
        &pieces(&plan.target_audio),
    )?;
    let source_ms = if copy {
        None
    } else {
        Some(recorder::splice(
            bin,
            &src_dir.join("audio.next.m4a"),
            &pieces(&plan.source_audio),
        )?)
    };

    let backup = store.dir.join("undo");
    let _ = std::fs::remove_dir_all(&backup);
    std::fs::create_dir_all(&backup).map_err(|e| e.to_string())?;
    let swap = |dir: &std::path::Path, rid: i64| -> Result<(), String> {
        let audio = dir.join("audio.m4a");
        if audio.exists() {
            std::fs::rename(&audio, backup.join(format!("{rid}.m4a")))
                .map_err(|e| e.to_string())?;
        }
        std::fs::rename(dir.join("audio.next.m4a"), &audio).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(dir.join("playback2.m4a"));
        Ok(())
    };
    swap(&dst_dir, target_id)?;
    if !copy {
        swap(&src_dir, id)?;
    }

    let mut db = store.db.lock().unwrap();
    let mut target_doc = plan.target;
    target_doc.duration = target_ms;
    save_doc(&mut db, target_id, &target_doc)?;
    let mut docs = vec![];
    if let Some(ms) = source_ms {
        let mut source_doc = plan.source;
        source_doc.duration = ms;
        save_doc(&mut db, id, &source_doc)?;
        docs.push((id, source));
    }
    if let Some(old) = old_target {
        docs.push((target_id, old));
    }
    Ok((
        target_id,
        Undo {
            created: dst.is_none().then_some(target_id),
            docs,
        },
    ))
}

pub fn undo(store: &Store, undo: Undo) -> Result<(), String> {
    let backup = store.dir.join("undo");
    let mut db = store.db.lock().unwrap();
    for (id, doc) in &undo.docs {
        let dir = store.recording_dir(*id);
        std::fs::rename(backup.join(format!("{id}.m4a")), dir.join("audio.m4a"))
            .map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(dir.join("playback2.m4a"));
        save_doc(&mut db, *id, doc)?;
    }
    if let Some(id) = undo.created {
        db::delete_recording(&db, id).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(store.recording_dir(id));
    }
    Ok(())
}
