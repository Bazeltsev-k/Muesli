import { useRef, useState } from "react";
import type { Strings } from "../i18n";
import { fmt } from "../lib/util";
import { levelStore, useLevel } from "../lib/level";
import { useClock } from "../lib/clock";
import { Icon, LiveBars, LiveClock } from "./Controls";

function MarkInput({ t, onMark, style }: { t: Strings; onMark: (body: string, ms: number) => void; style?: React.CSSProperties }) {
  const [mark, setMark] = useState("");
  const ms = useLevel((l) => (mark ? 0 : Math.floor(l.ms / 1000) * 1000));
  const submit = () => {
    if (!mark.trim()) return;
    onMark(mark.trim(), levelStore.get().ms);
    setMark("");
  };
  return (
    <span className="markin" style={style}>
      <input placeholder={mark ? "" : `${t.markPh} ${fmt(ms)}`} value={mark} onChange={(e) => setMark(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <button className="enter" disabled={!mark.trim()} aria-label="Add" onClick={submit}>
        ↵
      </button>
    </span>
  );
}

type LiveProps = { t: Strings; paused: boolean; setPaused: (p: boolean) => void; onStop: () => void; onMark: (body: string, ms: number) => void };

export function LivePill({ t, paused, setPaused, onStop, onMark }: LiveProps) {
  return (
    <div className="pill">
      <i className="live-dot" style={{ width: 9, height: 9 }} />
      <span className="t">
        <LiveClock />
      </span>
      <LiveBars channel="mic" paused={paused} color="var(--me)" />
      <LiveBars channel="sys" paused={paused} color="var(--them)" />
      <MarkInput t={t} onMark={onMark} style={{ flex: "none", width: 230 }} />
      <button className="pb" onClick={() => setPaused(!paused)}>
        {paused ? t.resume : t.pause}
      </button>
      <button className="stop" onClick={onStop}>
        <i />
        {t.stop}
      </button>
    </div>
  );
}

function useDrag(initial: () => { x: number; y: number }, height: number) {
  const [pos, setPos] = useState(initial);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(window.innerWidth - 336, Math.max(16, p.x)), y: Math.min(window.innerHeight - height, Math.max(16, p.y)) });
  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => drag.current && setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy })),
    onPointerUp: () => (drag.current = null),
  };
  const at = clamp(pos);
  return { style: { left: at.x, top: at.y }, handlers };
}

export function Pip({ t, title, them, onOpen, ...live }: LiveProps & { title: string; them: string; onOpen: () => void }) {
  const { style, handlers } = useDrag(() => ({ x: window.innerWidth - 340, y: window.innerHeight - 230 }), 210);
  return (
    <div className="pip" style={style}>
      <div className="head" {...handlers}>
        <i className="live-dot" style={{ width: 9, height: 9 }} />
        <span className="name">
          {title || t.untitled}
          {them ? " · " + them : ""}
        </span>
        <button className="backbtn" title={t.backToRec} aria-label={t.backToRec} onPointerDown={(e) => e.stopPropagation()} onClick={onOpen}>
          ↗
        </button>
      </div>
      <div className="mid">
        <span className="t">
          <LiveClock />
        </span>
        <LiveBars channel="mic" paused={live.paused} color="var(--me)" />
        <LiveBars channel="sys" paused={live.paused} color="var(--them)" />
        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, opacity: 0.7 }}>{live.paused ? t.paused : t.recording}</span>
      </div>
      <MarkInput t={t} onMark={live.onMark} />
      <div className="acts">
        <button className="pb" onClick={() => live.setPaused(!live.paused)}>
          {live.paused ? t.resume : t.pause}
        </button>
        <button className="stop" onClick={live.onStop}>
          <i />
          {t.stop}
        </button>
      </div>
    </div>
  );
}

export function PlayPip({ t, id, title, them, duration, playing, stacked, onToggle, onSeek, onOpen, onClose }: {
  t: Strings;
  title: string;
  them: string;
  duration: number;
  id: number;
  playing: boolean;
  stacked: boolean;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { style, handlers } = useDrag(() => ({ x: window.innerWidth - 340, y: window.innerHeight - 150 - (stacked ? 245 : 0) }), 130);
  const bar = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, duration);
  const time = useClock(id, (ms) => Math.floor(ms / 250) * 250);
  const jump = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur);
  };
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="pip playpip" style={style}>
      <div className="head" {...handlers}>
        <span className="name">
          {title || t.untitled}
          {them ? " · " + them : ""}
        </span>
        <button className="backbtn" title={t.backToRec} aria-label={t.backToRec} onPointerDown={stop} onClick={onOpen}>
          ↗
        </button>
        <button className="backbtn" title={t.dismiss} aria-label={t.dismiss} onPointerDown={stop} onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mid">
        <button className="play" style={{ width: 34, height: 34 }} onClick={onToggle}>
          {playing ? Icon.pause : Icon.play}
        </button>
        <div
          className="minibar"
          ref={bar}
          onPointerDown={(e) => {
            bar.current!.setPointerCapture(e.pointerId);
            jump(e);
          }}
          onPointerMove={(e) => e.buttons && jump(e)}
        >
          <i style={{ width: (time / dur) * 100 + "%" }} />
        </div>
        <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
          {fmt(time)} / {fmt(dur)}
        </span>
      </div>
    </div>
  );
}
