use rusqlite::{Connection, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

const SCHEMA: &str = "
CREATE TABLE recordings (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  speaker INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  words TEXT NOT NULL
);
CREATE INDEX segments_recording ON segments(recording_id, start_ms);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE recording_tags (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (recording_id, tag_id)
);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  at_ms INTEGER NOT NULL,
  body TEXT NOT NULL
);
";

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
    pub duration_ms: i64,
    pub status: String,
    pub error: Option<String>,
    pub note: String,
    pub tags: Vec<String>,
    pub languages: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub start_ms: i64,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub speaker: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub lang: String,
    pub words: Vec<Word>,
}

impl Segment {
    pub fn text(&self) -> String {
        self.words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    pub at_ms: i64,
    pub body: String,
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(SCHEMA)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    if version < 2 {
        conn.execute_batch(
            "ALTER TABLE recordings ADD COLUMN languages TEXT NOT NULL DEFAULT 'en,uk,ru'",
        )?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    Ok(conn)
}

const SELECT_RECORDING: &str = "
SELECT r.id, r.title, r.created_at, r.duration_ms, r.status, r.error, r.note, r.languages,
  (SELECT group_concat(t.name, char(31)) FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recording_id = r.id)
FROM recordings r";

fn row_to_recording(row: &rusqlite::Row) -> Result<Recording> {
    let tags: Option<String> = row.get(8)?;
    let languages: String = row.get(7)?;
    let mut tags: Vec<String> = tags
        .map(|t| t.split('\u{1f}').map(String::from).collect())
        .unwrap_or_default();
    tags.sort_by_key(|t| t.to_lowercase());
    Ok(Recording {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        duration_ms: row.get(3)?,
        status: row.get(4)?,
        error: row.get(5)?,
        note: row.get(6)?,
        tags,
        languages: languages
            .split(',')
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect(),
    })
}

pub fn create_recording(
    conn: &Connection,
    title: &str,
    created_at: i64,
    languages: &[String],
) -> Result<i64> {
    conn.execute(
        "INSERT INTO recordings (title, created_at, status, languages) VALUES (?1, ?2, 'recording', ?3)",
        params![title, created_at, languages.join(",")],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn set_languages(conn: &Connection, id: i64, languages: &[String]) -> Result<()> {
    conn.execute(
        "UPDATE recordings SET languages = ?2 WHERE id = ?1",
        params![id, languages.join(",")],
    )?;
    Ok(())
}

pub fn get_recording(conn: &Connection, id: i64) -> Result<Option<Recording>> {
    conn.query_row(
        &format!("{SELECT_RECORDING} WHERE r.id = ?1"),
        [id],
        row_to_recording,
    )
    .optional()
}

pub fn list_recordings(
    conn: &Connection,
    query: &str,
    tag: Option<&str>,
) -> Result<Vec<Recording>> {
    let like = format!("%{}%", query.trim());
    let sql = format!(
        "{SELECT_RECORDING}
        WHERE (?1 = '%%' OR r.title LIKE ?1 OR r.note LIKE ?1
          OR EXISTS (SELECT 1 FROM segments s WHERE s.recording_id = r.id AND s.text LIKE ?1)
          OR EXISTS (SELECT 1 FROM notes n WHERE n.recording_id = r.id AND n.body LIKE ?1)
          OR EXISTS (SELECT 1 FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.recording_id = r.id AND t.name LIKE ?1))
        AND (?2 IS NULL OR EXISTS (SELECT 1 FROM recording_tags rt JOIN tags t ON t.id = rt.tag_id
          WHERE rt.recording_id = r.id AND t.name = ?2))
        ORDER BY r.created_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![like, tag], row_to_recording)?;
    rows.collect()
}

pub fn ids_with_status(conn: &Connection, statuses: &[&str]) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT id, status FROM recordings ORDER BY created_at")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    Ok(rows
        .filter_map(Result::ok)
        .filter(|(_, s)| statuses.contains(&s.as_str()))
        .map(|(id, _)| id)
        .collect())
}

pub fn set_title(conn: &Connection, id: i64, title: &str) -> Result<()> {
    conn.execute(
        "UPDATE recordings SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    Ok(())
}

pub fn set_note(conn: &Connection, id: i64, note: &str) -> Result<()> {
    conn.execute(
        "UPDATE recordings SET note = ?2 WHERE id = ?1",
        params![id, note],
    )?;
    Ok(())
}

pub fn set_status(conn: &Connection, id: i64, status: &str, error: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE recordings SET status = ?2, error = ?3 WHERE id = ?1",
        params![id, status, error],
    )?;
    Ok(())
}

pub fn set_duration(conn: &Connection, id: i64, duration_ms: i64) -> Result<()> {
    conn.execute(
        "UPDATE recordings SET duration_ms = ?2 WHERE id = ?1",
        params![id, duration_ms],
    )?;
    Ok(())
}

pub fn delete_recording(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM recordings WHERE id = ?1", [id])?;
    conn.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM recording_tags)",
        [],
    )?;
    Ok(())
}

pub fn set_tags(conn: &mut Connection, id: i64, tags: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM recording_tags WHERE recording_id = ?1", [id])?;
    for tag in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        tx.execute("INSERT OR IGNORE INTO tags (name) VALUES (?1)", [tag])?;
        tx.execute(
            "INSERT OR IGNORE INTO recording_tags (recording_id, tag_id) SELECT ?1, id FROM tags WHERE name = ?2",
            params![id, tag],
        )?;
    }
    tx.execute(
        "DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM recording_tags)",
        [],
    )?;
    tx.commit()
}

pub fn all_tags(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM tags ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn replace_segments(conn: &mut Connection, id: i64, segments: &[Segment]) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM segments WHERE recording_id = ?1", [id])?;
    for s in segments {
        tx.execute(
            "INSERT INTO segments (recording_id, speaker, start_ms, end_ms, lang, text, words) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, s.speaker, s.start_ms, s.end_ms, s.lang, s.text(), serde_json::to_string(&s.words).unwrap()],
        )?;
    }
    tx.commit()
}

pub fn get_segments(conn: &Connection, id: i64) -> Result<Vec<Segment>> {
    let mut stmt = conn.prepare(
        "SELECT speaker, start_ms, end_ms, lang, words FROM segments WHERE recording_id = ?1 ORDER BY start_ms, id",
    )?;
    let rows = stmt.query_map([id], |r| {
        let words: String = r.get(4)?;
        Ok(Segment {
            speaker: r.get(0)?,
            start_ms: r.get(1)?,
            end_ms: r.get(2)?,
            lang: r.get(3)?,
            words: serde_json::from_str(&words).unwrap_or_default(),
        })
    })?;
    rows.collect()
}

pub fn add_note(conn: &Connection, id: i64, at_ms: i64, body: &str) -> Result<Note> {
    conn.execute(
        "INSERT INTO notes (recording_id, at_ms, body) VALUES (?1, ?2, ?3)",
        params![id, at_ms, body],
    )?;
    Ok(Note {
        id: conn.last_insert_rowid(),
        at_ms,
        body: body.to_string(),
    })
}

pub fn delete_note(conn: &Connection, note_id: i64) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", [note_id])?;
    Ok(())
}

pub fn list_notes(conn: &Connection, id: i64) -> Result<Vec<Note>> {
    let mut stmt = conn
        .prepare("SELECT id, at_ms, body FROM notes WHERE recording_id = ?1 ORDER BY at_ms, id")?;
    let rows = stmt.query_map([id], |r| {
        Ok(Note {
            id: r.get(0)?,
            at_ms: r.get(1)?,
            body: r.get(2)?,
        })
    })?;
    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn word(start_ms: i64, text: &str) -> Word {
        Word {
            start_ms,
            text: text.into(),
        }
    }

    #[test]
    fn recordings_roundtrip_search_tags_and_cascade() {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = open(&dir.path().join("t.db")).unwrap();
        let langs = |l: &[&str]| l.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let a = create_recording(&conn, "Weekly sync", 1, &langs(&["en", "uk", "ru"])).unwrap();
        let b = create_recording(&conn, "1:1", 2, &langs(&["uk"])).unwrap();
        set_languages(&conn, a, &langs(&["en", "ru"])).unwrap();
        assert_eq!(
            get_recording(&conn, a).unwrap().unwrap().languages,
            langs(&["en", "ru"])
        );
        assert_eq!(
            get_recording(&conn, b).unwrap().unwrap().languages,
            langs(&["uk"])
        );
        set_tags(&mut conn, a, &["work".into(), " Team ".into(), "".into()]).unwrap();
        set_tags(&mut conn, b, &["work".into()]).unwrap();
        replace_segments(
            &mut conn,
            b,
            &[Segment {
                speaker: 1,
                start_ms: 0,
                end_ms: 900,
                lang: "uk".into(),
                words: vec![word(0, "Привіт"), word(400, "світ")],
            }],
        )
        .unwrap();
        add_note(&conn, a, 5000, "ask about budget").unwrap();

        assert_eq!(
            get_recording(&conn, a).unwrap().unwrap().tags,
            vec!["Team", "work"]
        );
        assert_eq!(
            list_recordings(&conn, "", None)
                .unwrap()
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            vec![b, a]
        );
        assert_eq!(list_recordings(&conn, "світ", None).unwrap()[0].id, b);
        assert_eq!(list_recordings(&conn, "budget", None).unwrap()[0].id, a);
        assert_eq!(
            list_recordings(&conn, "tea", None)
                .unwrap()
                .iter()
                .map(|r| r.id)
                .collect::<Vec<_>>(),
            vec![a]
        );
        assert_eq!(list_recordings(&conn, "", Some("team")).unwrap().len(), 1);
        assert_eq!(get_segments(&conn, b).unwrap()[0].text(), "Привіт світ");

        delete_recording(&conn, a).unwrap();
        assert_eq!(all_tags(&conn).unwrap(), vec!["work"]);
        assert!(list_notes(&conn, a).unwrap().is_empty());
    }
}
