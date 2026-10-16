import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../lib/app";
import { api, type Comment, type Folded, type Note, type Recording, type Segment } from "../lib/api";
import { flatWords, fmt, fmtDate, removeTurns, rewordRange, setTurnSpeaker, transcriptText, turnsOf, useStable, useTauriEvent } from "../lib/util";
import { AutoNote, HoldDelete, HomeFab, LangToggles, LiveClock, TagPicker } from "../components/Controls";
import { Player, Transcript } from "../components/Transcript";
import { LivePill } from "../components/Floating";
import { MoveBar, flyBlocks } from "../components/MoveBar";

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

const NO_NOTES: Note[] = [];

export function RecordingView({ id }: { id: number }) {
  const app = useApp();
  const { t, lang, settings, tags, tagOps, notify, activeId, paused, setPaused, stop, progress, playback, play, toggle, seek, setRate, modelReady, remove, bump } = app;
  const [rec, setRec] = useState<Recording | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [title, setTitle] = useState("");
  const [them, setThem] = useState("");
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [moving, setMoving] = useState(false);
  const [split, setSplit] = useState(settings.ui?.split ?? 0.36);
  const colsRef = useRef<HTMLDivElement>(null);
  const shown = useRef<Recording | null>(null);

  const loadContent = useCallback(() => {
    api.getSegments(id).then(setSegments);
    api.listNotes(id).then(setNotes);
    api.listComments(id).then(setComments);
  }, [id]);
  const load = useCallback(() => {
    api.getRecording(id).then((r) => {
      if (!r) return app.go({ name: "home" });
      const prev = shown.current;
      shown.current = r;
      setRec(r);
      if (!prev || prev.status !== r.status || prev.durationMs !== r.durationMs) loadContent();
    });
  }, [id]);
  useEffect(() => {
    shown.current = null;
    load();
  }, [load]);
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
  }, [id]);
  useEffect(() => setSelected(new Set()), [segments]);

  const saveTitle = useDebounced(useCallback((v: string) => api.updateTitle(id, v.trim()).catch(notify), [id]));
  const saveThem = useDebounced(useCallback((v: string) => api.updateThem(id, v).catch(notify), [id]));
  const saveNote = useDebounced(useCallback((v: string) => api.updateNote(id, v).catch(notify), [id]));

  const speakers = rec?.speakers;
  const names = useMemo(() => [speakers?.[0] || settings.displayName || t.me, them || t.them, ...(speakers ?? []).slice(2)], [speakers, settings.displayName, them, t]);
  const turns = useMemo(() => turnsOf(segments), [segments]);
  const selection = useMemo(() => {
    const picked = turns.filter((tn) => selected.has(tn.paras[0][0].i));
    return { picked, first: picked[0]?.start ?? 0, duration: picked.reduce((n, tn) => n + tn.end - tn.start, 0) };
  }, [turns, selected]);

  const reloadComments = () => api.listComments(id).then(setComments);
  const removeBlocks = (keys: number[]) => {
    const before = { segments, comments };
    const next = removeTurns(segments, comments, keys);
    setSegments(next.segments);
    setComments(next.comments);
    Promise.all([api.setSegments(id, next.segments), api.setComments(id, next.comments)])
      .then(reloadComments)
      .catch(notify);
    notify(keys.length === 1 ? t.deleted1 : t.deletedN.replace("{n}", String(keys.length)), {
      label: t.undo,
      run: () => {
        setSegments(before.segments);
        setComments(before.comments);
        Promise.all([api.setSegments(id, before.segments), api.setComments(id, before.comments)])
          .then(reloadComments)
          .catch(notify);
      },
    });
  };
  const moveTo = async (target: Recording | null, copy: boolean, atStart: boolean) => {
    if (!rec) return;
    const ranges = selection.picked.map((tn) => [tn.start, tn.end] as [number, number]);
    const what = ranges.length === 1 ? t.blocks1 : t.blocksN.replace("{n}", String(ranges.length));
    setMoving(true);
    const flight = flyBlocks(target?.id ?? null, copy);
    try {
      const [targetId] = await Promise.all([api.moveBlocks(rec.id, ranges, target?.id ?? null, copy, atStart, `${rec.title || t.untitled} ${t.part2}`), flight]);
      bump(targetId, ranges.length);
      setSelected(new Set());
      loadContent();
      notify((copy ? t.copiedTo : t.movedTo).replace("{what}", what).replace("{title}", target ? target.title || t.untitled : `${rec.title || t.untitled} ${t.part2}`), {
        label: t.undo,
        run: () => api.undoMove().then(loadContent).catch(notify),
      });
    } catch (e) {
      document.querySelectorAll(".turn.leaving").forEach((el) => {
        el.classList.remove("leaving");
        (el as HTMLElement).style.height = "";
      });
      notify(e);
    }
    setMoving(false);
  };
  useEffect(() => {
    if (!selected.size) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea")) return;
      if (e.key === "Escape") setSelected(new Set());
      else if ((e.key === "Backspace" || e.key === "Delete") && !moving) removeBlocks([...selected]);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });

  const mine = playback?.id === rec?.id;
  const handlers = useStable({
    seek: (ms: number) => {
      seek(id, ms);
      if (!mine || !playback?.playing) play(id);
    },
    onEdit: async (first: number, last: number, text: string) => {
      const next = rewordRange(segments, first, last, text);
      const delta = flatWords(next).length - flatWords(segments).length;
      setSegments(next);
      try {
        await api.setSegments(id, next);
        if (delta) {
          await api.setComments(id, comments.filter((c) => c.end < first || c.word > last).map((c) => (c.word > last ? { ...c, word: c.word + delta, end: c.end + delta } : c)));
          reloadComments();
        }
      } catch (e) {
        notify(e);
      }
    },
    onRemove: (keys: number[]) => removeBlocks(keys),
    onSpeaker: (first: number, speaker: number) => {
      const next = setTurnSpeaker(segments, first, speaker);
      setSegments(next);
      api.setSegments(id, next).catch(notify);
    },
    onRenameSpeaker: (i: number, name: string) => {
      if (!rec) return;
      if (i === 1) {
        setThem(name);
        api.updateThem(id, name).catch(notify);
        return;
      }
      const next = [...rec.speakers];
      while (next.length < i) next.push("");
      next[i] = name;
      setRec({ ...rec, speakers: next });
      api.setSpeakers(id, next).catch(notify);
    },
    onComment: (word: number, end: number, body: string) => {
      api
        .addComment(id, word, end, body)
        .then((c) => setComments((cs) => [...cs, c]))
        .catch(notify);
    },
    onDeleteComment: (cid: number) => {
      api
        .deleteComment(cid)
        .then(() => setComments((cs) => cs.filter((c) => c.id !== cid)))
        .catch(notify);
    },
    onSelect: (keys: Set<number>) => setSelected(keys),
    goComment: (c: Comment) => {
      seek(id, flatWords(segments)[c.word]?.startMs ?? 0);
      document.getElementById("c-" + c.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlash(c.id);
      window.setTimeout(() => setFlash(null), 1600);
    },
  });

  if (!rec) return null;
  const live = rec.status === "recording" && activeId === rec.id;
  const draft = rec.status === "draft";
  const hasAudio = !draft && rec.status !== "recording";
  const cols = (settings.ui?.layout ?? "columns") === "columns" && !draft && !live;
  const folded: Folded = { notes: false, transcript: false, ...settings.ui?.folded };
  const fold = (k: keyof Folded) => app.updateSettings({ ui: { ...settings.ui, folded: { ...folded, [k]: !folded[k] } } });
  const sect = (k: keyof Folded, label: React.ReactNode, extra?: React.ReactNode, lead?: React.ReactNode) => (
    <div className="sect">
      {lead}
      <button className="fold" aria-expanded={!folded[k]} onClick={() => fold(k)}>
        <span className="chev">▾</span>
        {label}
      </button>
      {extra}
    </div>
  );
  const counted = (label: string, n: number) =>
    cols ? (
      <>
        {label}
        {n > 0 && <span className="count">{n}</span>}
      </>
    ) : (
      label
    );
  const chip = (k: keyof Folded, label: string, trailing?: boolean) => (
    <button className="foldchip" style={trailing ? { order: 2 } : undefined} onClick={() => fold(k)} title={label}>
      <span className="chev">▸</span>
      {label}
    </button>
  );
  const startResize = (e: React.PointerEvent) => {
    const box = colsRef.current?.getBoundingClientRect();
    if (!box) return;
    e.preventDefault();
    let last = split;
    const move = (ev: PointerEvent) => {
      last = Math.min(0.62, Math.max(0.18, (ev.clientX - box.left) / box.width));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      app.updateSettings({ ui: { ...settings.ui, split: last } });
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
  const marks = live || cols;
  const notesBody = (
    <>
      <AutoNote
        className={"note" + (live ? " big" : "")}
        placeholder={live ? t.notesPh : t.generalPh}
        value={note}
        onChange={(v) => {
          setNote(v);
          saveNote(v);
        }}
      />
      {marks && notes.length > 0 && (
        <div className="marklist">
          {notes.map((n) => (
            <button key={n.id} className="tnote" disabled={live} onClick={() => handlers.seek(n.atMs)}>
              <span className="mono">{fmt(n.atMs)}</span>
              {n.body}
            </button>
          ))}
        </div>
      )}
    </>
  );
  const transcriptArea = (lead?: React.ReactNode) => (
    <>
      {(rec.status === "transcribing" || rec.status === "queued") && (
        <div className="progress">
          {sect("transcript", t.transcript, undefined, lead)}
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
          {sect("transcript", t.transcript, undefined, lead)}
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
            counted(t.transcript, turns.length),
            <span className="act" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 2, marginLeft: "auto", order: 2 }}>
              <button className="btn" disabled={!modelReady} title={modelReady ? undefined : t.needModel} onClick={transcribe}>
                {t.retranscribe}
              </button>
              <button className="btn" onClick={exportTxt}>
                {t.export}
              </button>
            </span>,
            lead,
          )}
          {(cols || !folded.transcript) && <Transcript t={t} recId={rec.id} segments={segments} comments={comments} notes={cols && !folded.notes ? NO_NOTES : notes} names={names} flash={flash} selected={selected} {...handlers} />}
        </>
      )}
    </>
  );

  return (
    <>
      <div className={"page recpage" + (cols ? " wide" : "")} key={rec.id}>
        <div className="eyebrow">
          <HomeFab />
          <span>{fmtDate(rec.createdAt, lang)}</span>
          {!draft && <span className="mono">{live ? <LiveClock /> : fmt(rec.durationMs)}</span>}
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
            <LangToggles value={rec.languages} options={settings.languages} onChange={(languages) => api.setLanguages(rec.id, languages).catch(notify)} />
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

        {cols ? (
          <div className="cols" ref={colsRef} style={{ gridTemplateColumns: folded.notes || folded.transcript ? "minmax(0,1fr)" : `minmax(220px,${split}fr) 14px minmax(0,${1 - split}fr)` }}>
            {!folded.notes && <section className="col notescol">{sect("notes", counted(t.notes, notes.length), folded.transcript ? chip("transcript", t.transcript) : undefined)}{notesBody}</section>}
            {!folded.notes && !folded.transcript && <div className="resizer" role="separator" aria-orientation="vertical" onPointerDown={startResize} />}
            {!folded.transcript && <section className="col">{transcriptArea(folded.notes ? chip("notes", t.notes) : undefined)}</section>}
            {folded.notes && folded.transcript && (
              <div className="foldrow">
                {chip("notes", t.notes)}
                {chip("transcript", t.transcript)}
              </div>
            )}
          </div>
        ) : (
          <>
            {!draft && (
              <>
                {sect("notes", t.notes)}
                {!folded.notes && notesBody}
              </>
            )}
            {!draft && !live && transcriptArea()}
          </>
        )}
      </div>
      {live && (
        <LivePill
          t={t}
          paused={paused}
          setPaused={setPaused}
          onStop={stop}
          onMark={(body, ms) =>
            api
              .addNote(rec.id, ms, body)
              .then((n) => setNotes((ns) => [...ns, n]))
              .catch(notify)
          }
        />
      )}
      {selected.size > 0 && rec.status === "done" && (
        <MoveBar t={t} lang={lang} source={rec} firstMs={selection.first} count={selected.size} durationMs={selection.duration} busy={moving} onMove={moveTo} onDelete={() => removeBlocks([...selected])} onClear={() => setSelected(new Set())} />
      )}
      {hasAudio && (
        <Player
          id={rec.id}
          duration={rec.durationMs}
          playing={!!(mine && playback?.playing)}
          rate={mine ? playback!.rate : 1}
          onToggle={() => (mine ? toggle() : play(rec.id))}
          onSeek={(ms) => seek(rec.id, ms)}
          onRate={setRate}
          notes={notes}
          comments={comments}
          segments={segments}
          onComment={handlers.goComment}
        />
      )}
    </>
  );
}
