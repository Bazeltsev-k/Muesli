import { useState } from "react";
import { useApp } from "../lib/context";
import { api, type Note } from "../lib/api";
import { formatTime } from "../lib/format";

const SHAPE = [0.55, 0.9, 1, 0.7, 0.45];

function Bars({ value, color, label }: { value: number; color: string; label: string }) {
  const height = Math.min(1, Math.sqrt(value) * 4);
  return (
    <div className="flex h-5 items-center gap-[2px]" title={label} aria-label={`${label} level`}>
      {SHAPE.map((k, i) => (
        <span key={i} className={`w-[3px] ${color} transition-[height] duration-100`} style={{ height: `${Math.max(3, height * k * 20)}px` }} />
      ))}
    </div>
  );
}

export function RecordingPill({ id, onNote }: { id: number; onNote: (note: Note) => void }) {
  const { level, paused, setPaused, settings, notify } = useApp();
  const [body, setBody] = useState("");

  const mark = async () => {
    if (!body.trim()) return;
    try {
      onNote(await api.addNote(id, level.ms, body));
      setBody("");
    } catch (e) {
      notify(e);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-[3px] border-[1.5px] border-fg bg-panel py-2 pr-2 pl-4 shadow-[0_18px_40px_-16px_rgba(0,0,0,0.55)]">
      <span className={`size-2.5 rounded-full bg-accent ${paused ? "" : "animate-pulse"}`} />
      <span className="w-[54px] font-bold tabular-nums">{formatTime(level.ms)}</span>
      <Bars value={paused ? 0 : level.mic} color="bg-me" label={settings.displayName} />
      {settings.captureSystem && <Bars value={paused ? 0 : level.sys} color="bg-them" label={settings.otherName} />}
      <input
        className="field h-8 w-[220px]"
        placeholder={`Mark ${formatTime(level.ms)} — press Enter`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && mark()}
      />
      <button className="btn" onClick={() => setPaused(!paused)}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button className="btn btn-rec" onClick={() => api.stopRecording()}>
        <span className="size-2.5 bg-white" />
        Stop
      </button>
    </div>
  );
}
