import { useEffect, useRef, useState, type ReactNode } from "react";
import { LANGS, TAG_COLORS, type Strings } from "../i18n";
import type { Tag } from "../lib/api";
import { fmt, useOutside } from "../lib/util";
import { useLevel } from "../lib/level";
import { useApp } from "../lib/app";

export const Icon = {
  search: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7" cy="7" r="5" />
      <path d="m11 11 3.5 3.5" />
    </svg>
  ),
  gear: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  ),
  palette: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.9 1.4-1.8-.4-1.2.5-2.2 1.7-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z" />
      <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  check: (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2.5 6.5 2.3 2.3L9.5 3.5" />
    </svg>
  ),
  play: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M3 1.8v10.4c0 .6.7 1 1.2.6l8-5.2a.7.7 0 0 0 0-1.2l-8-5.2C3.7.8 3 1.2 3 1.8z" />
    </svg>
  ),
  pencil: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M10.8 2.7a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1z" />
    </svg>
  ),
  pause: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="2.5" y="1.5" width="3" height="11" rx="1" />
      <rect x="8.5" y="1.5" width="3" height="11" rx="1" />
    </svg>
  ),
};

export function HoldDelete({ t, onConfirm, label, holdLabel, className = "btn" }: { t: Strings; onConfirm: () => void; label?: ReactNode; holdLabel?: ReactNode; className?: string }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>(undefined);
  const start = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, 900);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };
  return (
    <button
      title={t.holdHint}
      className={`${className} hold${holding ? " holding" : ""}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start(e)}
      onKeyUp={cancel}
    >
      <i className="fill" />
      <span>{holding ? (holdLabel ?? t.holding) : (label ?? t.hold)}</span>
    </button>
  );
}

export function LangToggles({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options?: string[] }) {
  return (
    <span className="langs" role="group">
      {LANGS.filter(([code]) => !options || options.includes(code) || value.includes(code)).map(([code, name]) => {
        const on = value.includes(code);
        return (
          <button
            key={code}
            className="lang"
            role="checkbox"
            aria-checked={on}
            title={name}
            onClick={() => {
              if (on && value.length === 1) return;
              onChange(on ? value.filter((l) => l !== code) : LANGS.map(([c]) => c).filter((c) => c === code || value.includes(c)));
            }}
          >
            <span className="box">{Icon.check}</span>
            <span>{code.toUpperCase()}</span>
          </button>
        );
      })}
    </span>
  );
}

export function HomeFab() {
  const { t, go } = useApp();
  return (
    <button className="homefab" onClick={() => go({ name: "home" })} aria-label={t.home}>
      <span className="arr">←</span>
      {t.home}
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </span>
  );
}

export const Row = ({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) => (
  <div className="row">
    <div className="l">
      <b>{label}</b>
      {hint && <span>{hint}</span>}
    </div>
    {children}
  </div>
);

export const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => <button className="toggle" role="switch" aria-checked={on} onClick={() => set(!on)} />;

export function Bars({ level, color }: { level: number; color: string }) {
  return (
    <span className="bars">
      {[0.5, 0.85, 1, 0.7, 0.4].map((k, i) => (
        <i key={i} style={{ background: color, transform: `scaleY(${Math.max(3, Math.min(1, level) * k * 22) / 22})` }} />
      ))}
    </span>
  );
}

export function LiveBars({ channel, paused, color }: { channel: "mic" | "sys"; paused: boolean; color: string }) {
  const level = useLevel((l) => (paused ? 0 : Math.round(Math.sqrt(l[channel]) * 60) / 20));
  return <Bars level={level} color={color} />;
}

export function LiveClock() {
  return <>{fmt(useLevel((l) => Math.floor(l.ms / 1000)) * 1000)}</>;
}

export function AutoNote({ className, placeholder, value, onChange }: { className: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    };
    fit();
    let width = el.offsetWidth;
    const watch = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      fit();
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);
  return <textarea ref={ref} className={className} placeholder={placeholder} value={value} rows={1} onChange={(e) => onChange(e.target.value)} />;
}

export type TagOps = {
  recolor: (name: string, color: string) => void;
  rename: (from: string, to: string) => void;
  remove: (name: string) => void;
};

export function TagPicker({ t, tags, allTags, onChange, tagOps, compact }: { t: Strings; tags: string[]; allTags: Tag[]; onChange: (tags: string[]) => void; tagOps: TagOps; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => {
    setOpen(false);
    setEditing(null);
  });
  const color = (n: string) => allTags.find((x) => x.name === n)?.color ?? "#8D8D86";
  const shown = allTags.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  const match = allTags.find((x) => x.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (n: string) => onChange(tags.includes(n) ? tags.filter((x) => x !== n) : [...tags, n]);
  const create = (n: string) => {
    onChange([...tags, n]);
    setQ("");
  };
  return (
    <div className="tags" ref={ref} style={{ position: "relative" }}>
      {tags.map((n) => (
        <span key={n} className="tag" style={{ "--tc": color(n) } as React.CSSProperties}>
          <i className="tdot" />
          {n}
        </span>
      ))}
      <button className={"addtag" + (compact ? " compact" : "")} onClick={() => setOpen(!open)}>
        + {compact ? t.tag : t.addTag}
      </button>
      {open && (
        <div className="pop" style={compact ? { top: "calc(100% + 6px)", right: 0, transformOrigin: "top right" } : { top: "calc(100% + 6px)", left: 0 }}>
          <input
            className="q"
            autoFocus
            placeholder={t.searchTags}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) {
                if (match) {
                  toggle(match.name);
                  setQ("");
                } else create(q.trim());
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          {shown.map((x) => (
            <div key={x.name}>
              <div className="opt" role="option" aria-selected={tags.includes(x.name)} onClick={() => toggle(x.name)}>
                <i className="tdot" style={{ background: x.color }} />
                <span className="oname">{x.name}</span>
                <span className="check">{Icon.check}</span>
                <button
                  className="colorbtn"
                  title={t.editTag}
                  aria-label={t.editTag}
                  aria-expanded={editing === x.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(editing === x.name ? null : x.name);
                  }}
                >
                  ⋯
                </button>
              </div>
              {editing === x.name && (
                <div className="tagedit">
                  <input
                    className="q"
                    defaultValue={x.name}
                    aria-label={t.rename}
                    onKeyDown={(e) => {
                      const v = e.currentTarget.value.trim();
                      if (e.key === "Enter" && v) {
                        if (v !== x.name) tagOps.rename(x.name, v);
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== x.name) tagOps.rename(x.name, v);
                    }}
                  />
                  <div className="swatches">
                    {TAG_COLORS.map((c) => (
                      <button key={c} className="sw" style={{ background: c }} aria-pressed={x.color === c} onClick={() => tagOps.recolor(x.name, c)} />
                    ))}
                  </div>
                  <HoldDelete
                    t={t}
                    label={t.deleteTag}
                    onConfirm={() => {
                      tagOps.remove(x.name);
                      setEditing(null);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
          {q.trim() && !match && (
            <div className="opt" onClick={() => create(q.trim())}>
              <span style={{ color: "var(--accent)" }}>+</span> {t.newTag} “{q.trim()}”
            </div>
          )}
        </div>
      )}
    </div>
  );
}
