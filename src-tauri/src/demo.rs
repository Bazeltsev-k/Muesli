use crate::db::{self, Segment};
use rusqlite::Connection;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DemoTag {
    name: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DemoNote {
    at_ms: i64,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DemoComment {
    word: i64,
    end: i64,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Demo {
    title: String,
    them: String,
    languages: Vec<String>,
    minutes_ago: i64,
    tags: Vec<DemoTag>,
    note: String,
    notes: Vec<DemoNote>,
    comments: Vec<DemoComment>,
    segments: Vec<Segment>,
}

pub fn seed(
    conn: &mut Connection,
    demo_dir: &Path,
    recordings_dir: &Path,
    now_ms: i64,
) -> Result<(), String> {
    for name in ["demo2", "demo1"] {
        let json = std::fs::read_to_string(demo_dir.join(format!("{name}.json")))
            .map_err(|e| e.to_string())?;
        let demo: Demo = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        let duration = demo.segments.iter().map(|s| s.end_ms).max().unwrap_or(0) + 1500;
        let id = db::create_recording(
            conn,
            &demo.title,
            now_ms - demo.minutes_ago * 60_000,
            "done",
            &demo.languages,
            &demo.them,
        )
        .map_err(|e| e.to_string())?;
        let dir = recordings_dir.join(id.to_string());
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::copy(demo_dir.join(format!("{name}.m4a")), dir.join("audio.m4a"))
            .map_err(|e| e.to_string())?;
        db::set_duration(conn, id, duration).map_err(|e| e.to_string())?;
        db::set_note(conn, id, &demo.note).map_err(|e| e.to_string())?;
        for tag in &demo.tags {
            db::upsert_tag(conn, &tag.name, &tag.color).map_err(|e| e.to_string())?;
        }
        db::set_tags(
            conn,
            id,
            &demo.tags.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
        )
        .map_err(|e| e.to_string())?;
        db::replace_segments(conn, id, &demo.segments).map_err(|e| e.to_string())?;
        for n in &demo.notes {
            db::add_note(conn, id, n.at_ms, &n.body).map_err(|e| e.to_string())?;
        }
        for c in &demo.comments {
            db::add_comment(conn, id, c.word, c.end, &c.body).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_both_demos_with_audio_transcript_and_annotations() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = db::open(&dir.path().join("t.db")).unwrap();
        let demo_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("demo");
        seed(
            &mut conn,
            &demo_dir,
            &dir.path().join("recordings"),
            10_000_000,
        )
        .unwrap();
        let recs = db::list_recordings(&conn, "", None).unwrap();
        assert_eq!(
            recs.iter().map(|r| r.title.as_str()).collect::<Vec<_>>(),
            ["Demo: weekly sync", "Demo: one-on-one with Max"]
        );
        let sync = &recs[0];
        assert_eq!(
            (sync.them.as_str(), sync.status.as_str(), sync.tags.len()),
            ("Olena", "done", 2)
        );
        assert!(
            dir.path()
                .join("recordings")
                .join(sync.id.to_string())
                .join("audio.m4a")
                .exists()
        );
        assert_eq!(db::list_notes(&conn, sync.id).unwrap().len(), 2);
        assert_eq!(
            db::list_comments(&conn, sync.id).unwrap()[0].body,
            "Seek bug and the karaoke drift"
        );
        assert!(db::get_segments(&conn, sync.id).unwrap().len() >= 6);
        assert_eq!(
            db::all_tags(&conn)
                .unwrap()
                .iter()
                .find(|t| t.name == "release")
                .unwrap()
                .color,
            "#E5484D"
        );
    }
}
