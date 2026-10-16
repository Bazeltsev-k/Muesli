use muesli_lib::db::{self, Segment, Word};
use muesli_lib::{moving, recorder};
use std::path::Path;
use std::sync::Mutex;

fn seg(speaker: i64, start: i64, end: i64, text: &str) -> Segment {
    Segment {
        speaker,
        start_ms: start,
        end_ms: end,
        lang: "en".into(),
        words: text
            .split(' ')
            .enumerate()
            .map(|(i, w)| Word {
                start_ms: start + i as i64 * 300,
                text: w.into(),
            })
            .collect(),
    }
}

fn texts(conn: &rusqlite::Connection, id: i64) -> Vec<(i64, String)> {
    db::get_segments(conn, id)
        .unwrap()
        .iter()
        .map(|s| (s.start_ms, s.text()))
        .collect()
}

#[test]
fn moves_blocks_with_their_audio_and_undoes_it() {
    let bin =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries/muesli-recorder-aarch64-apple-darwin");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/conversation.m4a");
    let dir = tempfile::tempdir().unwrap();
    let mut conn = db::open(&dir.path().join("muesli.db")).unwrap();
    let langs = vec!["en".to_string()];
    let a = db::create_recording(&conn, "Sync", 1_000_000, "done", &langs, "Olena").unwrap();
    let b = db::create_recording(&conn, "1:1", 1_003_500, "done", &langs, "Max").unwrap();
    for (id, from, to) in [(a, 0, 6000), (b, 6000, 10_000)] {
        let rec_dir = dir.path().join("recordings").join(id.to_string());
        std::fs::create_dir_all(&rec_dir).unwrap();
        let ms = recorder::splice(
            &bin,
            &rec_dir.join("audio.m4a"),
            &[serde_json::json!({"file": fixture, "start": from, "end": to})],
        )
        .unwrap();
        db::set_duration(&conn, id, ms).unwrap();
        std::fs::write(rec_dir.join("playback2.m4a"), b"stale").unwrap();
    }
    db::replace_segments(
        &mut conn,
        a,
        &[seg(0, 0, 2000, "a b"), seg(1, 3000, 5000, "c d")],
    )
    .unwrap();
    db::replace_segments(&mut conn, b, &[seg(0, 0, 1000, "x")]).unwrap();
    db::add_note(&conn, a, 4000, "moves").unwrap();
    db::add_comment(&conn, a, 2, 3, "on c d").unwrap();
    let db = Mutex::new(conn);
    let store = moving::Store {
        db: &db,
        dir: dir.path(),
        bin: &bin,
    };
    let frames = |id: i64| {
        let rec_dir = dir.path().join("recordings").join(id.to_string());
        recorder::decode(&bin, &rec_dir.join("audio.m4a"), &rec_dir.join("d.f32")).unwrap()[0].len()
            as i64
            / 16
    };

    let (target, undo) =
        moving::apply(&store, a, &[(3000, 5000)], Some(b), false, true, "").unwrap();
    assert_eq!(target, b);
    {
        let conn = db.lock().unwrap();
        assert_eq!(texts(&conn, a), [(0, "a b".to_string())]);
        assert_eq!(
            texts(&conn, b),
            [(0, "c d".to_string()), (2000, "x".to_string())]
        );
        assert_eq!(db::list_notes(&conn, b).unwrap()[0].at_ms, 1000);
        let c = &db::list_comments(&conn, b).unwrap()[0];
        assert_eq!((c.word, c.end, c.body.as_str()), (0, 1, "on c d"));
        assert!((db::get_recording(&conn, a).unwrap().unwrap().duration_ms - 4000).abs() < 60);
        assert!((db::get_recording(&conn, b).unwrap().unwrap().duration_ms - 6000).abs() < 60);
    }
    assert!((frames(a) - 4000).abs() < 60 && (frames(b) - 6000).abs() < 60);
    assert!(
        !dir.path()
            .join(format!("recordings/{b}/playback2.m4a"))
            .exists()
    );

    moving::undo(&store, undo).unwrap();
    {
        let conn = db.lock().unwrap();
        assert_eq!(texts(&conn, a).len(), 2);
        assert_eq!(texts(&conn, b), [(0, "x".to_string())]);
        assert!(db::list_notes(&conn, b).unwrap().is_empty());
    }
    assert!((frames(a) - 6000).abs() < 60 && (frames(b) - 4000).abs() < 60);

    let (fresh, undo) =
        moving::apply(&store, a, &[(0, 2000)], None, true, false, "Sync (part 2)").unwrap();
    {
        let conn = db.lock().unwrap();
        let rec = db::get_recording(&conn, fresh).unwrap().unwrap();
        assert_eq!(
            (rec.title.as_str(), rec.status.as_str(), rec.created_at),
            ("Sync (part 2)", "done", 1_000_000)
        );
        assert_eq!(texts(&conn, fresh), [(0, "a b".to_string())]);
        assert_eq!(texts(&conn, a).len(), 2);
    }
    moving::undo(&store, undo).unwrap();
    assert!(
        db::get_recording(&db.lock().unwrap(), fresh)
            .unwrap()
            .is_none()
    );
}
