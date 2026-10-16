import { useEffect, useRef, useState } from "react";
import type { Strings } from "../i18n";
import { api, type Recording } from "../lib/api";
import { fmt, fmtDate, useOutside } from "../lib/util";
import { Seg, Toggle } from "./Controls";

export function flyBlocks(targetId: number | null, copy: boolean) {
  const blocks = [...document.querySelectorAll<HTMLElement>(".turn.selected")];
  const dest = (targetId !== null && document.querySelector<HTMLElement>(`.item[data-id="${targetId}"]`)) || document.querySelector<HTMLElement>(".newrec");
  if (!dest || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const d = dest.getBoundingClientRect();
  const flights = blocks
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    })
    .slice(0, 10)
    .map((el, i) => {
      const r = el.getBoundingClientRect();
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add("ghost");
      Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      document.body.appendChild(ghost);
      const dx = d.left + d.width / 2 - (r.left + r.width / 2);
      const dy = d.top + d.height / 2 - (r.top + r.height / 2);
      const scale = Math.max(0.08, Math.min(0.3, d.width / r.width / 2));
      return ghost
        .animate(
          [
            { transform: "none", opacity: 1 },
            { transform: "translateY(-14px) rotate(-1.2deg) scale(1.02)", opacity: 1, offset: 0.2 },
            { transform: `translate(${dx}px, ${dy}px) rotate(-5deg) scale(${scale})`, opacity: 0.15 },
          ],
          { duration: 760, delay: i * 60, easing: "cubic-bezier(.55,0,.2,1)", fill: "forwards" },
        )
        .finished.then(() => ghost.remove());
    });
  if (!copy)
    for (const el of blocks) {
      el.style.height = el.offsetHeight + "px";
      el.getBoundingClientRect();
      el.classList.add("leaving");
    }
  return Promise.all(flights).then(() => undefined);
}

type Row = { kind: "rec"; rec: Recording } | { kind: "new" };

export function MoveBar({ t, lang, source, firstMs, count, durationMs, busy, onMove, onDelete, onClear }: {
  t: Strings;
  lang: string;
  source: Recording;
  firstMs: number;
  count: number;
  durationMs: number;
  busy: boolean;
  onMove: (target: Recording | null, copy: boolean, atStart: boolean) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [copy, setCopy] = useState(false);
  const [atStart, setAtStart] = useState(false);
  const [list, setList] = useState<Recording[]>([]);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  useEffect(() => {
    if (open) api.listRecordings("", null).then(setList).catch(() => {});
  }, [open]);
  const what = count === 1 ? t.blocks1 : t.blocksN.replace("{n}", String(count));
  const query = q.trim().toLowerCase();
  const rows: Row[] = [
    ...list
      .filter((r) => r.id !== source.id && r.status === "done" && (!query || (r.title + " " + r.them).toLowerCase().includes(query)))
      .slice(0, query ? 20 : 5)
      .map((rec) => ({ kind: "rec" as const, rec })),
    { kind: "new" },
  ];
  const pick = (row: Row) => {
    setOpen(false);
    onMove(row.kind === "rec" ? row.rec : null, copy, atStart);
  };
  const time = new Date(source.createdAt + firstMs).toLocaleTimeString(lang === "uk" ? "uk-UA" : lang === "ru" ? "ru-RU" : "en-US", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="movebar" ref={ref}>
      {open && (
        <div className="movepop" role="dialog">
          <label className="search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="7" cy="7" r="5" />
              <path d="m11 11 3.5 3.5" />
            </svg>
            <input
              autoFocus
              placeholder={t.moveSearch}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setCursor((c) => Math.min(rows.length - 1, c + 1));
                if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
                if (e.key === "Enter" && rows[cursor]) pick(rows[cursor]);
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </label>
          {!query && <div className="group">{t.recent}</div>}
          {rows.length === 1 && <p className="hint" style={{ padding: "4px 10px" }}>{t.noTargets}</p>}
          {rows.map((row, i) => (
            <button key={row.kind === "rec" ? row.rec.id : "new"} className={"mvrow" + (row.kind === "new" ? " new" : "")} aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => pick(row)}>
              <b>{row.kind === "rec" ? row.rec.title || t.untitled : "+ " + t.newRec}</b>
              <span>
                {row.kind === "rec" ? (
                  <>
                    {fmtDate(row.rec.createdAt, lang)} · {fmt(row.rec.durationMs)} · <em>{atStart ? t.mvStart : t.mvEnd}</em>
                  </>
                ) : (
                  t.mvNew.replace("{time}", time)
                )}
              </span>
            </button>
          ))}
          <div className="mvfoot">
            <span>{t.placeAt}</span>
            <Seg
              value={atStart ? "start" : "end"}
              options={[
                ["start", t.atStart],
                ["end", t.atEnd],
              ]}
              onChange={(v) => setAtStart(v === "start")}
            />
          </div>
          <div className="mvfoot">
            <Toggle on={copy} set={setCopy} />
            <span>{t.copyInstead}</span>
          </div>
        </div>
      )}
      <span className="mono dur">{fmt(durationMs)}</span>
      <button className="mv" disabled={busy} onClick={() => setOpen(!open)}>
        {busy ? t.moving : t.moveN.replace("{n}", what)}
        <span aria-hidden>→</span>
      </button>
      <button className="ic" title={t.deleteBlock} aria-label={t.deleteBlock} disabled={busy} onClick={onDelete}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
        </svg>
      </button>
      <button className="ic" title={t.clearSel} aria-label={t.clearSel} onClick={onClear}>
        ✕
      </button>
    </div>
  );
}
