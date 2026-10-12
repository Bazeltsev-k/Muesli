import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Segment } from "../lib/api";
import { activeIndex, formatTime } from "../lib/format";
import { turns } from "../lib/transcript";

export function Transcript({ segments, names, audio }: { segments: Segment[]; names: [string, string]; audio: RefObject<HTMLAudioElement | null> }) {
  const list = useMemo(() => turns(segments), [segments]);
  const paragraphs = useMemo(() => {
    let index = 0;
    return list.map((t) => t.paragraphs.map((p) => p.map((w) => ({ ...w, i: index++ }))));
  }, [list]);
  const starts = useMemo(() => list.flatMap((t) => t.paragraphs.flat().map((w) => w.startMs)), [list]);
  const root = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [playing, setPlaying] = useState(false);
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    const scroller = root.current?.closest("[data-scroll]");
    const stop = () => setFollow(false);
    scroller?.addEventListener("wheel", stop, { passive: true });
    let frame = 0;
    let prev = -1;
    const tick = () => {
      const a = audio.current;
      if (a && root.current) {
        setPlaying(!a.paused);
        const i = activeIndex(starts, a.currentTime * 1000);
        if (i !== prev) {
          root.current.querySelector(`[data-i="${prev}"]`)?.classList.remove("active");
          const el = root.current.querySelector(`[data-i="${i}"]`);
          el?.classList.add("active");
          prev = i;
          if (el && scroller && followRef.current && !a.paused) {
            const box = el.getBoundingClientRect();
            const view = scroller.getBoundingClientRect();
            if (box.top < view.top + 60 || box.bottom > view.bottom - 120) el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      scroller?.removeEventListener("wheel", stop);
    };
  }, [starts, audio]);

  const seek = (ms: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = ms / 1000;
    setFollow(true);
    a.play();
  };

  return (
    <div ref={root} className="flex flex-col">
      {list.map((turn, ti) => (
        <div key={ti} className="grid grid-cols-[120px_1fr] gap-4 border-b border-line py-3 last:border-0">
          <div className={`border-l-[3px] pl-2.5 ${turn.speaker === 0 ? "border-me" : "border-them"}`}>
            <div className={`truncate text-[13px] font-bold ${turn.speaker === 0 ? "text-me" : "text-them"}`}>{names[turn.speaker] ?? names[1]}</div>
            <button className="text-xs text-muted tabular-nums hover:text-fg" onClick={() => seek(turn.startMs)}>
              {formatTime(turn.startMs)}
            </button>
          </div>
          <div className="selectable flex flex-col gap-2.5 text-[15px] leading-[1.8] text-fg2">
            {paragraphs[ti].map((p, pi) => (
              <p key={pi}>
                {p.map((w) => (
                  <Fragment key={w.i}>
                    <span data-i={w.i} className="word" onClick={() => seek(w.startMs)}>
                      {w.text}
                    </span>{" "}
                  </Fragment>
                ))}
              </p>
            ))}
          </div>
        </div>
      ))}
      {!follow && playing && (
        <button className="btn btn-pri fixed right-8 bottom-20 z-20 shadow-lg" onClick={() => setFollow(true)}>
          Follow playback
        </button>
      )}
    </div>
  );
}
