import { useEffect, useRef, useState } from "react";
import { api, type Note } from "../lib/api";
import { useApp } from "../lib/context";
import { formatTime } from "../lib/format";

export function TimedNotes({ id, notes, setNotes, now, onSeek }: { id: number; notes: Note[]; setNotes: (notes: Note[]) => void; now: () => number; onSeek?: (ms: number) => void }) {
  const { notify } = useApp();
  const [body, setBody] = useState("");

  const add = async () => {
    if (!body.trim()) return;
    try {
      const note = await api.addNote(id, Math.round(now()), body);
      setNotes([...notes, note].sort((a, b) => a.atMs - b.atMs));
      setBody("");
    } catch (e) {
      notify(e);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="cap">Timestamped notes</div>
      <input
        className="field"
        placeholder={`Note at ${formatTime(now())} — press Enter`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      {notes.length > 0 && (
        <div className="panel">
          {notes.map((n) => (
            <div key={n.id} className="group flex items-start gap-3 border-b border-line px-3 py-2 last:border-0">
              <button className="shrink-0 pt-px text-xs font-bold text-accent tabular-nums disabled:text-muted" disabled={!onSeek} onClick={() => onSeek?.(n.atMs)}>
                {formatTime(n.atMs)}
              </button>
              <p className="selectable flex-1 whitespace-pre-wrap">{n.body}</p>
              <button
                className="text-muted opacity-0 group-hover:opacity-100 hover:text-accent"
                aria-label="Delete note"
                onClick={() => api.deleteNote(n.id).then(() => setNotes(notes.filter((x) => x.id !== n.id)), notify)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GeneralNote({ id, initial }: { id: number; initial: string }) {
  const [text, setText] = useState(initial);
  const saved = useRef(initial);
  const latest = useRef(text);
  latest.current = text;

  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== saved.current) api.updateNote(id, text).then(() => (saved.current = text));
    }, 500);
    return () => clearTimeout(t);
  }, [id, text]);

  useEffect(
    () => () => {
      if (latest.current !== saved.current) api.updateNote(id, latest.current);
    },
    [id],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="cap">Notes</div>
      <textarea
        className="field h-auto min-h-[140px] resize-y py-2 leading-relaxed"
        placeholder="Anything about this meeting as a whole…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}
