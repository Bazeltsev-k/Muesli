import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../lib/app";
import { api, type Comment, type Note, type Recording, type Segment } from "../lib/api";
import { flatWords, fmt, fmtDate, rewordRange, transcriptText, useTauriEvent } from "../lib/util";
import { AutoNote, HoldDelete, LangToggles, TagPicker } from "../components/Controls";
import { Player, Transcript } from "../components/Transcript";
import { LivePill } from "../components/Floating";

function useDebounced(save: (v: string) => void, ms = 500) {
  const timer = useRef<number>(undefined);
  const latest = useRef<string | null>(null);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (latest.current !== null) save(latest.current);
    latest.current = null;
  }, [save]);
  useEffect(() => flush, [flush]);
  return (v: string) => {
    latest.current = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, ms);
  };
}

export function RecordingView({ id }: { id: number }) {
  const app = useApp();
  const { t, lang, settings, tags, tagOps, notify, activeId, level, paused, setPaused, stop, progress, playback, time, play, toggle, seek, setRate, modelReady, remove } = app;
  const [rec, setRec] = useState<Recording | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [title, setTitle] = useState("");
  const [them, setThem] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState<number | null>(null);
  const [folded, setFolded] = useState({ notes: false, transcript: false });
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    api.getRecording(id).then((r) => (r ? setRec(r) : app.go({ name: "home" })));
    api.getSegments(id).then(setSegments);
    api.listNotes(id).then(setNotes);
    api.listComments(id).then(setComments);
  }, [id]);
  useEffect(load, [load]);
  useTauriEvent("recordings-changed", load);
  useTauriEvent<number | null>("recorder-state", () => setStarting(false));
  useTauriEvent<string>("recorder-error", () => setStarting(false));
  useEffect(() => {
    api.getRecording(id).then((r) => {
      if (!r) return;
      setTitle(r.title);
      setThem(r.them);
      setNote(r.note);
    });
    setEditing(false);
  }, [id]);

  const saveTitle = useDebounced(useCallback((v: string) => api.updateTitle(id, v.trim()).catch(notify), [id]));
  const saveThem = useDebounced(useCallback((v: string) => api.updateThem(id, v).catch(notify), [id]));
  const saveNote = useDebounced(useCallback((v: string) => api.updateNote(id, v).catch(notify), [id]));

  if (!rec) return null;
  const live = rec.status === "recording" && activeId === rec.id;
  const draft = rec.status === "draft";
  const hasAudio = !draft && rec.status !== "recording";
  const mine = playback?.id === rec.id;
  const now = mine ? time : 0;
  const names: [string, string] = [settings.displayName || t.me, them || t.them];
  const sect = (k: "notes" | "transcript", label: string, extra?: React.ReactNode) => (
    <div className="sect">
      <button className="fold" aria-expanded={!folded[k]} onClick={() => setFolded((f) => ({ ...f, [k]: !f[k] }))}>
        <span className="chev">▾</span>
        {label}
      </button>
      {extra}
    </div>
  );
  const goComment = (c: Comment) => {
    seek(rec.id, flatWords(segments)[c.word]?.startMs ?? 0);
    document.getElementById("c-" + c.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(c.id);
    window.setTimeout(() => setFlash(null), 1600);
  };
  const edit = async (first: number, last: number, text: string) => {
    const next = rewordRange(segments, first, last, text);
    const delta = flatWords(next).length - flatWords(segments).length;
    setSegments(next);
    try {
      await api.setSegments(rec.id, next);
      if (delta) {
        for (const c of comments.filter((c) => c.word > last)) {
          await api.deleteComment(c.id);
          await api.addComment(rec.id, c.word + delta, c.end + delta, c.body);
        }
        api.listComments(rec.id).then(setComments);
      }
    } catch (e) {
      notify(e);
    }
  };
  const exportTxt = async () => {
    const path = await save({ defaultPath: `${(rec.title || t.untitled).replace(/[/:\\]/g, "-")}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    api
      .saveText(path, transcriptText(rec, segments, names, settings.exportTimestamps, t.untitled))
      .then(() => notify(t.exported))
      .catch(notify);
  };
  const transcribe = () => api.transcribe(rec.id).catch(notify);

  return (
    <>
      <div className="page" key={rec.id}>
        <div className="eyebrow">
          <span>{fmtDate(rec.createdAt, lang)}</span>
          {!draft && <span className="mono">{fmt(live ? level.ms : rec.durationMs)}</span>}
          {live && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--rec)" }}>
              <i className="live-dot" />
              {paused ? t.paused : t.recording}
            </span>
          )}
          {rec.status === "transcribing" && (
            <span style={{ color: "var(--accent)" }}>
              {t.transcribing} {Math.round((progress[rec.id] ?? 0) * 100)}%
            </span>
          )}
          {!live && (
            <span style={{ marginLeft: "auto" }}>
              <HoldDelete t={t} onConfirm={() => remove(rec.id)} />
            </span>
          )}
        </div>
        <input
          className="title"
          placeholder={t.untitled}
          value={title}
          autoFocus={draft}
          onChange={(e) => {
            setTitle(e.target.value);
            saveTitle(e.target.value);
          }}
        />
        <div className="meta">
          <label className="field">
            {t.with}
            <input
              className="inline-input"
              value={them}
              placeholder={t.them}
              size={Math.max(6, (them || t.them).length)}
              onChange={(e) => {
                setThem(e.target.value);
                saveThem(e.target.value);
              }}
            />
          </label>
          <span className="field">
            {t.languages}
            <LangToggles value={rec.languages} onChange={(languages) => api.setLanguages(rec.id, languages).catch(notify)} />
          </span>
        </div>
        <TagPicker t={t} tags={rec.tags} allTags={tags} onChange={(next) => api.setTags(rec.id, next).catch(notify)} tagOps={tagOps} />

        {draft && (
          <div className="draft">
            <span className="hint">{t.langHint}</span>
            <div className="startrow">
              <button
                className="bigrec"
                disabled={starting || activeId !== null}
                onClick={() => {
                  setStarting(true);
                  api.startRecording(rec.id).catch((e) => {
                    setStarting(false);
                    notify(e);
                  });
                }}
              >
                <i />
                {starting ? "…" : t.start}
              </button>
              <span className="hint">{t.startHint}</span>
            </div>
          </div>
        )}

        {live && <span className="hint">{t.langLiveHint}</span>}

        {!draft && (
          <>
            {sect("notes", t.notes)}
            {!folded.notes && (
              <AutoNote
                className={"note" + (live ? " big" : "")}
                placeholder={live ? t.notesPh : t.generalPh}
                value={note}
                onChange={(v) => {
                  setNote(v);
                  saveNote(v);
                }}
              />
            )}
          </>
        )}

        {live &&
          notes.length > 0 &&
          notes.map((n) => (
            <div key={n.id} className="tnote" style={{ marginLeft: 0 }}>
              <span className="mono">{fmt(n.atMs)}</span>
              {n.body}
            </div>
          ))}

        {(rec.status === "transcribing" || rec.status === "queued") && (
          <div className="progress">
            {sect("transcript", t.transcript)}
            <div className="bar">
              <i style={{ width: (progress[rec.id] ?? 0) * 100 + "%" }} />
            </div>
            <div className="skel" style={{ width: "92%" }} />
            <div className="skel" style={{ width: "78%" }} />
            <div className="skel" style={{ width: "85%" }} />
          </div>
        )}

        {(rec.status === "recorded" || rec.status === "failed" || (rec.status === "done" && segments.length === 0)) && (
          <>
            {sect("transcript", t.transcript)}
            <div className="progress">
              {rec.status === "failed" && <p style={{ margin: 0, color: "var(--rec)", fontWeight: 700 }}>{rec.error}</p>}
              {rec.status === "done" && <p className="hint">{t.noSpeech}</p>}
              {!modelReady && <p className="hint">{t.needModel}</p>}
              {modelReady && rec.status !== "done" && (
                <button className="btn solid" style={{ alignSelf: "flex-start" }} onClick={transcribe}>
                  {t.transcribeNow}
                </button>
              )}
            </div>
          </>
        )}

        {rec.status === "done" && segments.length > 0 && (
          <>
            {sect(
              "transcript",
              t.transcript,
              <span className="act" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 2, marginLeft: "auto", order: 2 }}>
                <button className="btn" onClick={() => setEditing(!editing)}>
                  {editing ? t.doneEdit : t.edit}
                </button>
                <button className="btn" disabled={!modelReady} title={modelReady ? undefined : t.needModel} onClick={transcribe}>
                  {t.retranscribe}
                </button>
                <button className="btn" onClick={exportTxt}>
                  {t.export}
                </button>
              </span>,
            )}
            {!folded.transcript && (
              <Transcript
                t={t}
                segments={segments}
                comments={comments}
                notes={notes}
                names={names}
                time={now}
                seek={(ms) => {
                  seek(rec.id, ms);
                  if (!mine || !playback?.playing) play(rec.id);
                }}
                editing={editing}
                flash={flash}
                onEdit={edit}
                onComment={(word, end, body) =>
                  api
                    .addComment(rec.id, word, end, body)
                    .then((c) => setComments((cs) => [...cs, c]))
                    .catch(notify)
                }
                onDeleteComment={(cid) =>
                  api
                    .deleteComment(cid)
                    .then(() => setComments((cs) => cs.filter((c) => c.id !== cid)))
                    .catch(notify)
                }
              />
            )}
          </>
        )}
      </div>
      {live && (
        <LivePill
          t={t}
          level={level}
          paused={paused}
          setPaused={setPaused}
          onStop={stop}
          onMark={(body) =>
            api
              .addNote(rec.id, level.ms, body)
              .then((n) => setNotes((ns) => [...ns, n]))
              .catch(notify)
          }
        />
      )}
      {hasAudio && (
        <Player
          duration={rec.durationMs}
          time={now}
          playing={!!(mine && playback?.playing)}
          rate={mine ? playback!.rate : 1}
          onToggle={() => (mine ? toggle() : play(rec.id))}
          onSeek={(ms) => seek(rec.id, ms)}
          onRate={setRate}
          notes={notes}
          comments={comments}
          segments={segments}
          onComment={goComment}
        />
      )}
    </>
  );
}
