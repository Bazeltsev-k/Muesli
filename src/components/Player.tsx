import { useEffect, useState, type RefObject } from "react";
import type { Note } from "../lib/api";
import { formatTime } from "../lib/format";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function Player({ src, audio, notes, durationMs }: { src: string; audio: RefObject<HTMLAudioElement | null>; notes: Note[]; durationMs: number }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationMs / 1000);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== "Space" || target.closest("input, textarea, select, button")) return;
      e.preventDefault();
      const a = audio.current;
      if (a) a.paused ? a.play() : a.pause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audio]);

  const skip = (seconds: number) => {
    const a = audio.current;
    if (a) a.currentTime = Math.min(Math.max(0, a.currentTime + seconds), duration);
  };

  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t-[1.5px] border-fg bg-side px-6 py-3">
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onSeeked={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
      />
      <button className="btn w-10 justify-center px-0" onClick={() => skip(-10)} aria-label="Back 10 seconds">
        −10
      </button>
      <button
        className="btn btn-pri w-12 justify-center px-0"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          const a = audio.current;
          if (a) a.paused ? a.play() : a.pause();
        }}
      >
        {playing ? (
          <span className="flex gap-[3px]">
            <span className="h-3 w-[3px] bg-current" />
            <span className="h-3 w-[3px] bg-current" />
          </span>
        ) : (
          <span className="ml-0.5 size-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
        )}
      </button>
      <button className="btn w-10 justify-center px-0" onClick={() => skip(10)} aria-label="Forward 10 seconds">
        +10
      </button>
      <span className="w-[92px] text-right text-[13px] text-muted tabular-nums">
        {formatTime(time * 1000)} / {formatTime(duration * 1000)}
      </span>
      <div className="relative flex flex-1 items-center">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={time}
          onChange={(e) => {
            if (audio.current) audio.current.currentTime = Number(e.target.value);
          }}
          className="w-full accent-[var(--accent)]"
          aria-label="Seek"
        />
        {duration > 0 &&
          notes.map((n) => (
            <button
              key={n.id}
              title={`${formatTime(n.atMs)} ${n.body}`}
              onClick={() => {
                if (audio.current) audio.current.currentTime = n.atMs / 1000;
              }}
              className="absolute -top-2.5 size-2 -translate-x-1/2 rotate-45 bg-fg"
              style={{ left: `${Math.min(100, (n.atMs / 1000 / duration) * 100)}%` }}
            />
          ))}
      </div>
      <select
        className="field w-[72px]"
        value={rate}
        aria-label="Playback speed"
        onChange={(e) => {
          const r = Number(e.target.value);
          setRate(r);
          if (audio.current) audio.current.playbackRate = r;
        }}
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  );
}
