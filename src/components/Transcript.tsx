import { Fragment, useMemo, useRef, useState } from "react";
import type { Strings } from "../i18n";
import type { Comment, Note, Segment } from "../lib/api";
import { activeIndex, flatWords, fmt, turnsOf } from "../lib/util";
import { HoldDelete, Icon } from "./Controls";

function Composer({ t, quote, onSave, onDismiss }: { t: Strings; quote: string; onSave: (body: string) => void; onDismiss: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="composer">
      <span className="q">“{quote}”</span>
      <input
        autoFocus
        placeholder={t.commentPh}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) onSave(draft.trim());
          if (e.key === "Escape" && !draft.trim()) onDismiss();
        }}
      />
      <button className="btn solid" disabled={!draft.trim()} onClick={() => onSave(draft.trim())}>
        {t.comment}
      </button>
      {draft.trim() ? (
        <HoldDelete t={t} className="btn dismiss" label="✕" holdLabel="✕" onConfirm={onDismiss} />
      ) : (
        <button className="btn dismiss" onClick={onDismiss} aria-label={t.dismiss}>
          ✕
        </button>
      )}
    </div>
  );
}

type Props = {
  t: Strings;
  segments: Segment[];
  comments: Comment[];
  notes: Note[];
  names: [string, string];
  time: number;
  seek: (ms: number) => void;
  editing: boolean;
  flash: number | null;
  onEdit: (first: number, last: number, text: string) => void;
  onComment: (word: number, end: number, body: string) => void;
  onDeleteComment: (id: number) => void;
};

export function Transcript({ t, segments, comments, notes, names, time, seek, editing, flash, onEdit, onComment, onDeleteComment }: Props) {
  const turns = useMemo(() => turnsOf(segments), [segments]);
  const all = useMemo(() => flatWords(segments), [segments]);
  const active = activeIndex(all, time);
  const [hover, setHover] = useState<number | null>(null);
  const [pending, setPending] = useState<{ word: number; end: number } | null>(null);
  const covered = useMemo(() => {
    const m = new Set<number>();
    for (const c of comments) for (let i = c.word; i <= c.end; i++) m.add(i);
    return m;
  }, [comments]);
  const quote = (a: number, b: number) => all.slice(a, b + 1).map((w) => w.text).join(" ");

  const onUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const a = sel.anchorNode?.parentElement?.closest<HTMLElement>("[data-i]");
    const b = sel.focusNode?.parentElement?.closest<HTMLElement>("[data-i]");
    if (!a || !b) return;
    const [x, y] = [+a.dataset.i!, +b.dataset.i!].sort((p, q) => p - q);
    setPending({ word: x, end: y });
    sel.removeAllRanges();
  };
  const notesBetween = (a: number, b: number) => notes.filter((n) => n.atMs >= a && n.atMs < b);
  const tnote = (n: Note) => (
    <div key={"n" + n.id} className="tnote">
      <span className="mono">{fmt(n.atMs)}</span>
      {n.body}
    </div>
  );

  return (
    <div onMouseUp={editing ? undefined : onUp}>
      {!editing && (
        <div className="chint" style={{ marginBottom: 6 }}>
          {t.commentHint}
        </div>
      )}
      {turns.map((tn, ti) => (
        <Fragment key={ti}>
          {notesBetween(ti === 0 ? 0 : tn.start, tn.start).map(tnote)}
          <div className="turn">
            <div className="who" style={{ color: tn.speaker === 0 ? "var(--me)" : "var(--them)" }}>
              {names[tn.speaker] ?? names[1]}
              <small onClick={() => seek(tn.start)}>{fmt(tn.start)}</small>
            </div>
            <div>
              {tn.paras.map((p, pi) =>
                editing ? (
                  <textarea
                    key={pi}
                    className="editp"
                    defaultValue={p.map((w) => w.text).join(" ")}
                    rows={Math.max(2, Math.ceil(p.length / 11))}
                    onBlur={(e) => e.target.value.trim() !== p.map((w) => w.text).join(" ") && e.target.value.trim() && onEdit(p[0].i, p[p.length - 1].i, e.target.value)}
                  />
                ) : (
                  <Fragment key={pi}>
                    <p className="para">
                      {p.map((w) => (
                        <Fragment key={w.i}>
                          <span
                            data-i={w.i}
                            className={"w" + (w.i === active ? " now" : w.i < active ? " past" : "") + (covered.has(w.i) ? " cm" : "") + (pending && w.i >= pending.word && w.i <= pending.end ? " sel" : "")}
                            onMouseEnter={() => setHover(w.i)}
                            onMouseLeave={() => setHover((h) => (h === w.i ? null : h))}
                            onClick={() => !window.getSelection()?.toString() && seek(w.startMs)}
                          >
                            {w.text}
                            {hover === w.i && !pending && (
                              <button
                                className="wc"
                                aria-label={t.comment}
                                title={t.comment}
                                onMouseUp={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPending({ word: w.i, end: w.i });
                                  setHover(null);
                                }}
                              >
                                💬
                              </button>
                            )}
                          </span>{" "}
                        </Fragment>
                      ))}
                    </p>
                    {pending && p.some((w) => w.i === pending.end) && (
                      <Composer
                        key={pending.word + "-" + pending.end}
                        t={t}
                        quote={quote(pending.word, pending.end)}
                        onSave={(body) => {
                          onComment(pending.word, pending.end, body);
                          setPending(null);
                        }}
                        onDismiss={() => setPending(null)}
                      />
                    )}
                    {comments
                      .filter((c) => p.some((w) => w.i === c.end))
                      .map((c) => (
                        <div key={c.id} id={"c-" + c.id} className={"comment" + (flash === c.id ? " flash" : "")}>
                          <b>“{quote(c.word, c.end)}”</b>
                          <span>{c.body}</span>
                          <button className="x" onClick={() => onDeleteComment(c.id)} aria-label="Remove">
                            ✕
                          </button>
                        </div>
                      ))}
                  </Fragment>
                ),
              )}
            </div>
          </div>
          {ti === turns.length - 1 && notesBetween(tn.start, Infinity).map(tnote)}
        </Fragment>
      ))}
    </div>
  );
}

type Mark = { key: string; at: number; kind: "n" | "c"; label: string; body: string; go: () => void };

export function Player({ duration, time, playing, rate, onToggle, onSeek, onRate, notes, comments, segments, onComment }: {
  duration: number;
  time: number;
  playing: boolean;
  rate: number;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onRate: (r: number) => void;
  notes: Note[];
  comments: Comment[];
  segments: Segment[];
  onComment: (c: Comment) => void;
}) {
  const [tip, setTip] = useState<Mark | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const dur = Math.max(1, duration);
  const jump = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur);
  };
  const all = flatWords(segments);
  const marks: Mark[] = [
    ...notes.map((n) => ({ key: "n" + n.id, at: n.atMs, kind: "n" as const, label: fmt(n.atMs), body: n.body, go: () => onSeek(n.atMs) })),
    ...comments.map((c) => ({ key: "c" + c.id, at: all[c.word]?.startMs ?? 0, kind: "c" as const, label: "“" + all.slice(c.word, c.end + 1).map((w) => w.text).join(" ") + "”", body: c.body, go: () => onComment(c) })),
  ];
  return (
    <div className="player">
      <button className="play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? Icon.pause : Icon.play}
      </button>
      <span className="mono" style={{ fontSize: 12, color: "var(--muted)", minWidth: 92 }}>
        {fmt(time)} / {fmt(dur)}
      </span>
      <div
        className="track"
        ref={track}
        onPointerDown={(e) => {
          track.current!.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => e.buttons && jump(e)}
      >
        <i className="rail" />
        <i className="done" style={{ width: (time / dur) * 100 + "%" }} />
        <i className="knob" style={{ left: (time / dur) * 100 + "%" }} />
        <div className="marks">
          {marks.map((m) => (
            <button
              key={m.key}
              className={"mk " + m.kind}
              style={{ left: (m.at / dur) * 100 + "%" }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseEnter={() => setTip(m)}
              onMouseLeave={() => setTip(null)}
              onFocus={() => setTip(m)}
              onBlur={() => setTip(null)}
              onClick={m.go}
              aria-label={m.body}
            />
          ))}
          {tip && (
            <div className="mtip" style={{ left: (tip.at / dur) * 100 + "%" }}>
              <b>{tip.label}</b>
              {tip.body}
            </div>
          )}
        </div>
      </div>
      <button className="speed" onClick={() => onRate(rate >= 2 ? 0.75 : rate + 0.25)}>
        {rate}×
      </button>
    </div>
  );
}
