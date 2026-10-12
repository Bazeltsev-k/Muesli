import { useRef, useState } from "react";
import { PRESETS, type Strings } from "../i18n";
import type { Theme } from "../lib/api";
import { useOutside } from "../lib/util";
import { Bars } from "./Controls";

export function Picker({ t, theme, setTheme, onClose, anchor, sideHidden }: { t: Strings; theme: Theme; setTheme: (t: Theme) => void; onClose: () => void; anchor: DOMRect; sideHidden: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pad = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<"side" | "bg">("side");
  const [preview, setPreview] = useState<"side" | "lift" | null>(null);
  const hideTimer = useRef<number>(undefined);
  useOutside(ref, onClose);
  const show = (kind: "side" | "lift") => {
    window.clearTimeout(hideTimer.current);
    setPreview(kind);
    hideTimer.current = window.setTimeout(() => setPreview(null), 1600);
  };
  const sidePreview = () => sideHidden && target === "side" && show("side");
  const cur = target === "side" ? { h: theme.h, c: theme.c } : { h: theme.bh, c: theme.bc };
  const set = (h: number, c: number) => setTheme(target === "side" ? { ...theme, h, c } : { ...theme, bh: h, bc: c });
  const move = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    set(Math.round(x * 360), Math.round((1 - y) * 100));
    sidePreview();
  };
  const w = 284;
  const left = Math.min(window.innerWidth - w - 12, Math.max(12, anchor.left));
  const opensDown = anchor.top <= window.innerHeight / 2;
  const pos = opensDown ? { left, top: anchor.bottom + 8 } : { left, bottom: window.innerHeight - anchor.top + 8 };
  const previewPos = { ...(left + w + 14 + 260 > window.innerWidth ? { left: "auto", right: "calc(100% + 14px)" } : {}), ...(opensDown ? { bottom: "auto", top: 0 } : {}) };
  const slider = (label: string, value: number, max: number, onChange: (v: number) => void, onTouch?: () => void) => (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min="0" max={max} step={max / 25} value={value} onPointerDown={onTouch} onFocus={onTouch} onChange={(e) => (onChange(+e.target.value), onTouch?.())} />
    </label>
  );
  return (
    <div className="picker" ref={ref} style={{ ...pos, width: w }}>
      <div className="seg">
        {(
          [
            ["side", t.sideColor],
            ["bg", t.bgColor],
          ] as const
        ).map(([k, l]) => (
          <button key={k} aria-pressed={target === k} onClick={() => setTarget(k)}>
            {l}
          </button>
        ))}
      </div>
      <div
        className="pad"
        ref={pad}
        onPointerDown={(e) => {
          pad.current!.setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => e.buttons && move(e)}
      >
        <i className="knob2" style={{ left: `${(cur.h / 360) * 100}%`, top: `${100 - cur.c}%`, background: `hsl(${cur.h} ${cur.c}% 55%)` }} />
      </div>
      <div className="presets">
        {PRESETS.map(([h, c]) => (
          <button
            key={h + "-" + c}
            className="preset"
            aria-pressed={cur.h === h && cur.c === c}
            style={{ background: `hsl(${h} ${c}% 55%)` }}
            aria-label="Preset"
            onClick={() => {
              set(h, c);
              sidePreview();
            }}
          />
        ))}
      </div>
      {target === "side" ? (
        slider(t.grain, theme.grain, 1, (grain) => setTheme({ ...theme, grain }), sidePreview)
      ) : (
        <>
          {slider(t.grain, theme.bgrain, 1, (bgrain) => setTheme({ ...theme, bgrain }))}
          {slider(t.depth, theme.depth, 1, (depth) => setTheme({ ...theme, depth }))}
          {slider(t.lift, theme.lift, 0.5, (lift) => setTheme({ ...theme, lift }), () => show("lift"))}
        </>
      )}
      <div className="seg">
        {(["light", "auto", "dark"] as const).map((m) => (
          <button key={m} aria-pressed={theme.mode === m} onClick={() => setTheme({ ...theme, mode: m })}>
            {t[m]}
          </button>
        ))}
      </div>
      {preview === "side" && (
        <div className="liftprev" aria-hidden="true" style={previewPos}>
          <div className="sideprev">
            <div className="lights">
              <i />
              <i />
              <i />
            </div>
            <span className="newrec">
              <i className="dot" />
              {t.newRec}
            </span>
            <span className="sp-search" />
            <span className="sp-item on">
              <b />
              <i />
            </span>
            <span className="sp-item">
              <b style={{ width: "72%" }} />
              <i />
            </span>
            <span className="sp-item">
              <b style={{ width: "58%" }} />
              <i />
            </span>
          </div>
        </div>
      )}
      {preview === "lift" && (
        <div className="liftprev" aria-hidden="true" style={previewPos}>
          <div className="pip">
            <div className="head">
              <i className="live-dot" style={{ width: 9, height: 9 }} />
              <span className="name">{t.untitled}</span>
              <span className="backbtn">↗</span>
            </div>
            <div className="mid">
              <span className="t">0:42</span>
              <Bars level={0.7} color="var(--me)" />
              <Bars level={0.4} color="var(--them)" />
            </div>
            <input placeholder={t.markPh} readOnly />
            <div className="acts">
              <span className="pb" style={{ display: "grid", placeItems: "center" }}>
                {t.pause}
              </span>
              <span className="stop">
                <i />
                {t.stop}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
