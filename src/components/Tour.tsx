import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOUR, TOUR_STEPS, type Lang } from "../i18n";

type Box = { top: number; left: number; width: number; height: number };

export function Tour({ hotkey, lang, setLang, step, setStep, onEnd, actionDone }: { hotkey: string; lang: Lang; setLang: (l: Lang) => void; step: number; setStep: (s: number) => void; onEnd: () => void; actionDone: (a: "model" | "perms") => boolean }) {
  const tt = TOUR[lang];
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(220);
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  });
  useEffect(() => {
    setBox(null);
    let el: Element | null = null;
    let frame = 0;
    const measure = () => {
      el = el?.isConnected ? el : document.querySelector(TOUR_STEPS[step].sel);
      if (el) {
        const r = el.getBoundingClientRect();
        setBox((b) => (b && b.top === r.top && b.left === r.left && b.width === r.width && b.height === r.height ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
      }
      frame = requestAnimationFrame(measure);
    };
    const start = window.setTimeout(() => {
      el = document.querySelector(TOUR_STEPS[step].sel);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      measure();
    }, 380);
    return () => {
      window.clearTimeout(start);
      cancelAnimationFrame(frame);
    };
  }, [step]);
  const last = step === TOUR_STEPS.length - 1;
  const next = () => (last ? onEnd() : setStep(step + 1));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEnd();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const [title, rawBody] = tt.steps[step];
  const body = rawBody.replace("{hotkey}", hotkey);
  const action = TOUR_STEPS[step].action;
  const done = !action || actionDone(action);
  const pad = 8;
  const cardW = 380;
  let card = { left: window.innerWidth / 2 - cardW / 2, top: window.innerHeight / 2 - 80 };
  if (box && box.height > window.innerHeight * 0.5) {
    card = { top: Math.min(window.innerHeight - cardH - 12, box.top + 24), left: Math.min(window.innerWidth - cardW - 12, box.left + box.width + pad + 16) };
  } else if (box) {
    const below = box.top + box.height + pad + 14;
    const above = box.top - pad - 14 - cardH;
    const top = below + cardH + 12 < window.innerHeight ? below : above >= 12 ? above : Math.max(12, window.innerHeight - cardH - 12);
    card = { top, left: Math.min(window.innerWidth - cardW - 12, Math.max(12, box.left + box.width / 2 - cardW / 2)) };
  }
  const blockers: [number | string, number | string, number | string, number | string][] = box
    ? [
        [0, 0, "100%", box.top - pad],
        [0, box.top + box.height + pad, "100%", "100%"],
        [0, box.top - pad, box.left - pad, box.height + pad * 2],
        [box.left + box.width + pad, box.top - pad, "100%", box.height + pad * 2],
      ]
    : [];
  return (
    <div className="tour" role="dialog" aria-label={title}>
      {box ? blockers.map(([l, tp, w, h], i) => <div key={i} className="tour-block" style={{ left: l, top: tp, width: w, height: h }} />) : <div className="tour-block" style={{ inset: 0 }} />}
      {box && <div className="tour-spot" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />}
      <div className="tour-card" key={step} ref={cardRef} style={{ ...card, width: cardW }}>
        <div className="tour-dots">
          {TOUR_STEPS.map((_, i) => (
            <i key={i} aria-current={i === step} />
          ))}
          <span>
            {step + 1}/{TOUR_STEPS.length}
          </span>
          <div className="tour-lang" role="group" aria-label="Language">
            {(["en", "uk", "ru"] as const).map((l) => (
              <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <h3>{title}</h3>
        <p>{body}</p>
        {!done && (
          <div className="tour-wait">
            <i />
            {tt.waiting}
          </div>
        )}
        <div className="tour-acts">
          <button className="tour-end" onClick={onEnd}>
            {tt.end}
          </button>
          {step > 0 && (
            <button className="btn" style={{ width: 34, padding: 0, justifyContent: "center" }} title={tt.back} aria-label={tt.back} onClick={() => setStep(step - 1)}>
              ←
            </button>
          )}
          {!done && (
            <button className="btn" onClick={next}>
              {tt.skip}
            </button>
          )}
          <button className={"btn solid" + (done ? "" : " waiting")} disabled={!done} onClick={next}>
            {last ? tt.done : tt.next}
          </button>
        </div>
      </div>
    </div>
  );
}
