import { useApp } from "../lib/context";
import { api } from "../lib/api";
import { formatTime } from "../lib/format";

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <span className="truncate text-[13px] font-bold">{label}</span>
      <div className="h-2 bg-raised">
        <div className={`h-full ${color} transition-[width] duration-100`} style={{ width: `${Math.min(100, Math.sqrt(value) * 220)}%` }} />
      </div>
    </div>
  );
}

export function LivePanel() {
  const { level, paused, setPaused, settings } = useApp();
  return (
    <div className="panel flex flex-col items-center gap-6 px-8 py-10">
      <div className="flex items-center gap-2">
        <span className={`size-2.5 rounded-full bg-accent ${paused ? "" : "animate-pulse"}`} />
        <span className="cap">{paused ? "Paused" : "Recording"}</span>
      </div>
      <div className="text-[64px] leading-none font-bold tracking-[-2px] tabular-nums">{formatTime(level.ms)}</div>
      <div className="flex w-full max-w-[460px] flex-col gap-3">
        <Meter label={settings.displayName} value={level.mic} color="bg-me" />
        {settings.captureSystem && <Meter label={settings.otherName} value={level.sys} color="bg-them" />}
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button className="btn btn-rec" onClick={() => api.stopRecording()}>
          <span className="size-2.5 bg-white" />
          Stop recording
        </button>
      </div>
    </div>
  );
}
