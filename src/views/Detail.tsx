import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { api, LANGUAGES, type Note, type Recording, type Segment } from "../lib/api";
import { useApp, useTauriEvent } from "../lib/context";
import { formatDate, formatTime } from "../lib/format";
import { transcriptText } from "../lib/transcript";
import { StatusBadge } from "../components/StatusBadge";
import { TagEditor } from "../components/TagEditor";
import { Player } from "../components/Player";
import { Transcript } from "../components/Transcript";
import { GeneralNote, TimedNotes } from "../components/Notes";
import { RecordingPill } from "../components/LivePanel";

export function Detail({ id }: { id: number }) {
  const { settings, activeId, go, notify } = useApp();
  const [rec, setRec] = useState<Recording | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [src, setSrc] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [tab, setTab] = useState<"transcript" | "notes">("transcript");
  const audio = useRef<HTMLAudioElement>(null);

  const load = useCallback(() => {
    api.getRecording(id).then((r) => (r ? setRec(r) : go({ name: "library" })));
    api.getSegments(id).then(setSegments);
    api.modelInstalled().then(setModelReady);
  }, [id, go]);

  useEffect(() => {
    load();
    api.listNotes(id).then(setNotes);
  }, [id, load]);
  useTauriEvent("recordings-changed", load);

  const serverTitle = rec?.title;
  useEffect(() => {
    if (serverTitle !== undefined) setTitle(serverTitle);
  }, [serverTitle]);

  const audioReady = rec !== null && rec.status !== "recording";
  const durationMs = rec?.durationMs;
  useEffect(() => {
    if (audioReady) api.audioPath(id).then((p) => setSrc(`${convertFileSrc(p)}?v=${durationMs}`));
  }, [id, audioReady, durationMs]);
  useTauriEvent<[number, number]>("transcribe-progress", ([rid, p]) => rid === id && setProgress(p));

  if (!rec) return null;
  const live = rec.status === "recording";
  const names: [string, string] = [settings.displayName, settings.otherName];
  const busy = live || rec.status === "queued" || rec.status === "transcribing";
  const langs = [...new Set(segments.map((s) => s.lang))].map((l) => LANGUAGES[l] ?? l);

  const saveTitle = () => {
    const next = title.trim() || "Untitled";
    setTitle(next);
    if (next !== rec.title) api.updateTitle(id, next).catch(notify);
  };

  const exportTxt = async () => {
    const path = await save({ defaultPath: `${(rec.title || "Transcript").replace(/[/:\\]/g, "-")}.txt`, filters: [{ name: "Text", extensions: ["txt"] }] });
    if (!path) return;
    try {
      await api.saveText(path, transcriptText(rec, segments, names, settings.exportTimestamps));
      notify("Transcript exported");
    } catch (e) {
      notify(e);
    }
  };

  const remove = async () => {
    if (await ask(`Delete “${rec.title}” with its audio, transcript and notes? This can't be undone.`, { title: "Delete recording", kind: "warning" })) {
      api.deleteRecording(id).then(() => go({ name: "library" }), notify);
    }
  };

  const seek = (ms: number) => {
    if (!audio.current) return;
    audio.current.currentTime = ms / 1000;
    audio.current.play();
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-[920px] flex-1 flex-col gap-5 px-8 pt-7 pb-10">
        <button className="self-start text-[13px] font-semibold text-muted hover:text-fg" onClick={() => go({ name: "library" })}>
          ← Recordings
        </button>

        <div className="flex flex-col gap-3">
          <input
            className="h-12 w-full border-b-[1.5px] border-line bg-transparent text-[28px] font-bold tracking-[-0.6px] outline-none focus:border-fg"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            aria-label="Recording title"
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted tabular-nums">
            <span>{formatDate(rec.createdAt)}</span>
            {!live && <span>· {formatTime(rec.durationMs)}</span>}
            {langs.length > 0 && <span>· {langs.join(", ")}</span>}
            <StatusBadge status={rec.status} progress={progress} />
            {!live && <div className="ml-auto flex gap-2">
              <button className="btn" onClick={exportTxt} disabled={segments.length === 0}>
                Export .txt
              </button>
              <button
                className="btn"
                disabled={busy || !modelReady}
                title={modelReady ? undefined : "Download the model in Settings → Transcription"}
                onClick={() => api.transcribe(id).catch(notify)}
              >
                {segments.length > 0 ? "Re-transcribe" : "Transcribe"}
              </button>
              <button className="btn hover:border-accent hover:text-accent" onClick={remove}>
                Delete
              </button>
            </div>}
          </div>
          <TagEditor tags={rec.tags} onChange={(tags) => api.setTags(id, tags).then(load, notify)} />
        </div>

        {live ? (
          activeId === id ? (
            <>
              {notes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {notes.map((n) => (
                    <span key={n.id} className="chip text-fg2">
                      <b className="text-accent tabular-nums">{formatTime(n.atMs)}</b> {n.body}
                    </span>
                  ))}
                </div>
              )}
              <GeneralNote id={id} initial={rec.note} live />
              <RecordingPill id={id} onNote={(n) => setNotes([...notes, n])} />
            </>
          ) : (
            <p className="text-muted">Finishing the recording…</p>
          )
        ) : (
          <>
            <div className="flex border-b border-line">
              {(["transcript", "notes"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[13.5px] font-bold capitalize ${tab === t ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  {t}
                  {t === "notes" && notes.length > 0 && <span className="ml-1.5 text-muted">{notes.length}</span>}
                </button>
              ))}
            </div>

            {tab === "transcript" &&
              (segments.length > 0 ? (
                <Transcript segments={segments} names={names} audio={audio} />
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-[3px] border border-dashed border-line3 px-6 py-12 text-center">
                  {rec.status === "queued" && <p className="font-bold">Waiting for transcription…</p>}
                  {rec.status === "transcribing" && (
                    <>
                      <p className="font-bold">Transcribing… {progress !== undefined && `${Math.round(progress * 100)}%`}</p>
                      <div className="h-1.5 w-64 bg-raised">
                        <div className="h-full bg-accent transition-[width]" style={{ width: `${(progress ?? 0) * 100}%` }} />
                      </div>
                    </>
                  )}
                  {rec.status === "failed" && (
                    <>
                      <p className="font-bold text-accent">Something went wrong</p>
                      <p className="selectable max-w-[520px] text-muted">{rec.error}</p>
                    </>
                  )}
                  {rec.status === "recorded" && (
                    <p className="text-muted">
                      {modelReady ? "Not transcribed yet." : "Download the transcription model in Settings → Transcription to get a transcript."}
                    </p>
                  )}
                  {rec.status === "done" && <p className="text-muted">No speech was detected in this recording.</p>}
                  {modelReady && (rec.status === "recorded" || rec.status === "failed") && (
                    <button className="btn btn-pri" onClick={() => api.transcribe(id).catch(notify)}>
                      Transcribe now
                    </button>
                  )}
                </div>
              ))}

            {tab === "notes" && (
              <div className="flex flex-col gap-6">
                <GeneralNote id={id} initial={rec.note} />
                <TimedNotes id={id} notes={notes} setNotes={setNotes} now={() => (audio.current?.currentTime ?? 0) * 1000} onSeek={seek} />
              </div>
            )}
          </>
        )}
      </div>
      {!live && src && <Player src={src} audio={audio} notes={notes} durationMs={rec.durationMs} />}
    </div>
  );
}
