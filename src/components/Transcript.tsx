import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import type { Strings } from "../i18n";
import type { Comment, Note, Segment } from "../lib/api";
import { useClock } from "../lib/clock";
import { flatWords, fmt, speakerColor, turnsOf, useOutside, type IndexedWord, type Turn } from "../lib/util";
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

function SpeakerPicker({ t, names, current, onPick, onRename, onNew, onClose }: { t: Strings; names: string[]; current: number; onPick: (i: number) => void; onRename: (name: string) => void; onNew: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, onClose);
  const field = (placeholder: string, initial: string, save: (v: string) => void, hint?: string) => (
    <>
      <input
        className="q"
        placeholder={placeholder}
        defaultValue={initial}
        autoFocus={!!initial}
        onKeyDown={(e) => {
          const v = e.currentTarget.value.trim();
          if (e.key === "Enter" && v) save(v);
          if (e.key === "Escape") onClose();
        }}
      />
      {hint && <div className="pophint">{hint}</div>}
    </>
  );
  return (
    <div className="pop speakerpop" ref={ref} style={{ top: "calc(100% + 4px)", left: -6 }}>
      {field(t.speaker, names[current], (v) => v !== names[current] && onRename(v), t.renameAll)}
      {names.map((n, i) => (
        <div key={i} className="opt" role="option" aria-selected={i === current} onClick={() => onPick(i)}>
          <i className="tdot" style={{ background: speakerColor(i) }} />
          <span className="oname">{n}</span>
          <span className="check">{Icon.check}</span>
        </div>
      ))}
      {field("+ " + t.newSpeaker, "", onNew)}
    </div>
  );
}

export type TranscriptHandlers = {
  seek: (ms: number) => void;
  onEdit: (first: number, last: number, text: string) => void;
  onRemove: (keys: number[]) => void;
  onSpeaker: (firstWord: number, speaker: number) => void;
  onRenameSpeaker: (speaker: number, name: string) => void;
  onComment: (word: number, end: number, body: string) => void;
  onDeleteComment: (id: number) => void;
  onSelect: (keys: Set<number>) => void;
};

type Shared = {
  t: Strings;
  recId: number;
  names: string[];
  covered: Set<number>;
  quote: (a: number, b: number) => string;
  h: React.RefObject<TranscriptHandlers & { pend: (p: { word: number; end: number } | null) => void }>;
};

function lastAtOrBefore(words: IndexedWord[], t: number) {
  let lo = 0;
  let hi = words.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].startMs <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const Para = memo(function Para({ s, words, nextStart, pending, comments, flash }: { s: Shared; words: IndexedWord[]; nextStart: number; pending: { word: number; end: number } | null; comments: Comment[]; flash: number | null }) {
  const { t, covered, h } = s;
  const now = useClock(s.recId, (ms) => (ms < words[0].startMs ? -1 : ms >= nextStart ? -2 : lastAtOrBefore(words, ms)));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <>
      <p className="para">
        {words.map((w, k) => (
          <Fragment key={w.i}>
            <span
              data-i={w.i}
              className={"w" + (k === now ? " now" : now === -2 || k < now ? " past" : "") + (covered.has(w.i) ? " cm" : "") + (pending && w.i >= pending.word && w.i <= pending.end ? " sel" : "")}
              onMouseEnter={() => setHover(w.i)}
              onMouseLeave={() => setHover((x) => (x === w.i ? null : x))}
              onClick={() => !window.getSelection()?.toString() && h.current.seek(w.startMs)}
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
                    h.current.pend({ word: w.i, end: w.i });
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
      {pending && words.some((w) => w.i === pending.end) && (
        <Composer
          key={pending.word + "-" + pending.end}
          t={t}
          quote={s.quote(pending.word, pending.end)}
          onSave={(body) => {
            h.current.onComment(pending.word, pending.end, body);
            h.current.pend(null);
          }}
          onDismiss={() => h.current.pend(null)}
        />
      )}
      {comments.map((c) => (
        <div key={c.id} id={"c-" + c.id} className={"comment" + (flash === c.id ? " flash" : "")}>
          <b>“{s.quote(c.word, c.end)}”</b>
          <span>{c.body}</span>
          <button className="x" onClick={() => h.current.onDeleteComment(c.id)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
    </>
  );
});

const TurnBlock = memo(function TurnBlock({ s, tn, ti, nextStarts, selected, edge, pending, comments, flash }: { s: Shared; tn: Turn; ti: number; nextStarts: number[]; selected: boolean; edge: string; pending: { word: number; end: number } | null; comments: Comment[]; flash: number | null }) {
  const { t, names, h } = s;
  const first = tn.paras[0][0].i;
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <div className={"turn" + (editing ? " editing" : "") + (selected ? " selected" + edge : "")} data-ti={ti}>
      <div className="gut" aria-hidden />
      <div className="who" style={{ "--sc": speakerColor(tn.speaker) } as React.CSSProperties}>
        <button className="whoname" title={t.speaker} aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <i />
          <span>{names[tn.speaker] ?? names[1]}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="m2.5 4 2.5 2.5L7.5 4" />
          </svg>
        </button>
        <small onClick={() => h.current.seek(tn.start)}>{fmt(tn.start)}</small>
        {picking && (
          <SpeakerPicker
            t={t}
            names={names}
            current={tn.speaker}
            onClose={() => setPicking(false)}
            onPick={(i) => {
              if (i !== tn.speaker) h.current.onSpeaker(first, i);
              setPicking(false);
            }}
            onRename={(name) => {
              h.current.onRenameSpeaker(tn.speaker, name);
              setPicking(false);
            }}
            onNew={(name) => {
              const existing = names.indexOf(name);
              const index = existing >= 0 ? existing : Math.max(2, names.length);
              if (existing < 0) h.current.onRenameSpeaker(index, name);
              h.current.onSpeaker(first, index);
              setPicking(false);
            }}
          />
        )}
      </div>
      <div>
        {tn.paras.map((p, pi) =>
          editing ? (
            <textarea
              key={pi}
              className="editp"
              defaultValue={p.map((w) => w.text).join(" ")}
              rows={Math.max(2, Math.ceil(p.length / 11))}
              autoFocus={pi === 0}
              onBlur={(e) => e.target.value.trim() !== p.map((w) => w.text).join(" ") && e.target.value.trim() && h.current.onEdit(p[0].i, p[p.length - 1].i, e.target.value)}
            />
          ) : (
            <Para key={pi} s={s} words={p} nextStart={nextStarts[pi]} pending={pending && pending.word <= p[p.length - 1].i && pending.end >= p[0].i ? pending : null} comments={comments.filter((c) => c.end >= p[0].i && c.end <= p[p.length - 1].i)} flash={flash} />
          ),
        )}
      </div>
      <div className="tacts">
        <button className="tedit" title={editing ? t.doneEdit : t.editTurn} aria-label={editing ? t.doneEdit : t.editTurn} aria-pressed={editing} onClick={() => setEditing(!editing)}>
          {editing ? Icon.check : Icon.pencil}
        </button>
        {!editing && (
          <button className="tedit tdel" title={t.deleteBlock} aria-label={t.deleteBlock} onClick={() => h.current.onRemove([first])}>
            ✕
          </button>
        )}
      </div>
      {selected && <span className="selbar" aria-hidden />}
    </div>
  );
});

type Props = TranscriptHandlers & {
  t: Strings;
  recId: number;
  segments: Segment[];
  comments: Comment[];
  notes: Note[];
  names: string[];
  flash: number | null;
  selected: Set<number>;
};

export const Transcript = memo(function Transcript(props: Props) {
  const { t, recId, segments, comments, notes, names, flash, selected } = props;
  const turns = useMemo(() => turnsOf(segments), [segments]);
  const all = useMemo(() => flatWords(segments), [segments]);
  const [pending, setPending] = useState<{ word: number; end: number } | null>(null);
  const h = useRef({ ...props, pend: setPending });
  h.current = { ...props, pend: setPending };
  const covered = useMemo(() => {
    const m = new Set<number>();
    for (const c of comments) for (let i = c.word; i <= c.end; i++) m.add(i);
    return m;
  }, [comments]);
  const shared = useMemo<Shared>(() => ({ t, recId, names, covered, quote: (a, b) => all.slice(a, b + 1).map((w) => w.text).join(" "), h }), [t, recId, names, covered, all]);
  const starts = useMemo(() => {
    const paraStarts = turns.flatMap((tn) => tn.paras.map((p) => p[0].startMs));
    let k = 0;
    return turns.map((tn) => tn.paras.map(() => paraStarts[++k] ?? Infinity));
  }, [turns]);
  const keys = useMemo(() => turns.map((tn) => tn.paras[0][0].i), [turns]);
  const byTurn = useMemo(() => {
    const out = turns.map(() => [] as Comment[]);
    for (const c of comments) {
      const ti = turns.findIndex((tn) => c.end >= tn.paras[0][0].i && c.end <= tn.paras[tn.paras.length - 1].at(-1)!.i);
      if (ti >= 0) out[ti].push(c);
    }
    return out;
  }, [turns, comments]);
  const notesBefore = useMemo(() => notes.filter((n) => n.atMs < (turns[0]?.start ?? Infinity)), [turns, notes]);
  const notesAfter = useMemo(() => turns.map((tn, ti) => notes.filter((n) => n.atMs >= tn.start && n.atMs < (turns[ti + 1]?.start ?? Infinity))), [turns, notes]);

  const drag = useRef<{ mode: "block" | "text"; anchor: number; base: Set<number>; moved: boolean } | null>(null);
  const lastAnchor = useRef<number | null>(null);
  const suppress = useRef(false);
  const span = (a: number, b: number, base: Set<number>) => {
    const next = new Set(base);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(keys[i]);
    return next;
  };
  const root = useRef<HTMLDivElement>(null);
  const turnAt = (y: number) => {
    const els = root.current?.querySelectorAll<HTMLElement>(":scope > [data-ti]");
    if (!els?.length) return null;
    let best: HTMLElement | null = null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (y < r.top) break;
      best = el;
    }
    return +(best ?? els[0]).dataset.ti!;
  };
  const live = useRef({ keys, selected, span, turnAt });
  live.current = { keys, selected, span, turnAt };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || !(e.buttons & 1)) return;
      const { span, turnAt, selected } = live.current;
      const main = document.querySelector(".main");
      if (e.clientY < 90) main?.scrollBy(0, -16);
      else if (e.clientY > window.innerHeight - 120) main?.scrollBy(0, 16);
      const ti = turnAt(e.clientY);
      if (ti === null) return;
      if (d.mode === "text") {
        if (ti === d.anchor) return;
        d.mode = "block";
        d.base = new Set(selected);
        suppress.current = true;
      }
      window.getSelection()?.removeAllRanges();
      if (ti !== d.anchor) d.moved = true;
      if (d.moved) h.current.onSelect(span(d.anchor, ti, d.base));
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (!d || d.mode !== "block" || d.moved) return;
      const key = live.current.keys[d.anchor];
      const next = new Set(d.base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      h.current.onSelect(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".pop, textarea, input, .composer, button, small, .comment, .chint, .tnote")) return;
    const ti = turnAt(e.clientY);
    if (ti === null) return;
    if (target.closest(".para")) {
      drag.current = { mode: "text", anchor: +target.closest<HTMLElement>("[data-ti]")!.dataset.ti!, base: selected, moved: false };
      return;
    }
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (e.shiftKey && lastAnchor.current !== null) {
      props.onSelect(span(lastAnchor.current, ti, selected));
      return;
    }
    lastAnchor.current = ti;
    drag.current = { mode: "block", anchor: ti, base: selected, moved: false };
  };

  const onUp = () => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const a = sel.anchorNode?.parentElement?.closest<HTMLElement>("[data-i]");
    const b = sel.focusNode?.parentElement?.closest<HTMLElement>("[data-i]");
    if (!a || !b) return;
    const [x, y] = [+a.dataset.i!, +b.dataset.i!].sort((p, q) => p - q);
    setPending({ word: x, end: y });
    sel.removeAllRanges();
  };
  const tnote = (n: Note) => (
    <div key={"n" + n.id} className="tnote">
      <span className="mono">{fmt(n.atMs)}</span>
      {n.body}
    </div>
  );

  return (
    <div className={"transcript" + (selected.size ? " selecting" : "")} ref={root} onPointerDown={onPointerDown} onMouseUp={onUp}>
      <div className="chint">
        {t.dragTip} · {t.commentHint}
      </div>
      {turns.map((tn, ti) => {
        const sel = selected.has(keys[ti]);
        const edge = (sel && !selected.has(keys[ti - 1]) ? " first" : "") + (sel && !selected.has(keys[ti + 1]) ? " last" : "");
        return (
          <Fragment key={keys[ti]}>
            {ti === 0 && notesBefore.map(tnote)}
            <TurnBlock s={shared} tn={tn} ti={ti} nextStarts={starts[ti]} selected={sel} edge={edge} pending={pending && pending.word < (keys[ti + 1] ?? Infinity) && pending.end >= keys[ti] ? pending : null} comments={byTurn[ti]} flash={byTurn[ti].some((c) => c.id === flash) ? flash : null} />
            {notesAfter[ti].map(tnote)}
          </Fragment>
        );
      })}
    </div>
  );
});

type Mark = { key: string; at: number; kind: "n" | "c"; label: string; body: string; go: () => void };

export function Player({ id, duration, playing, rate, onToggle, onSeek, onRate, notes, comments, segments, onComment }: {
  id: number;
  duration: number;
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
  const time = useClock(id, (ms) => ms);
  const jump = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur);
  };
  const go = useRef({ onSeek, onComment });
  go.current = { onSeek, onComment };
  const marks: Mark[] = useMemo(() => {
    const all = flatWords(segments);
    return [
      ...notes.map((n) => ({ key: "n" + n.id, at: n.atMs, kind: "n" as const, label: fmt(n.atMs), body: n.body, go: () => go.current.onSeek(n.atMs) })),
      ...comments.map((c) => ({ key: "c" + c.id, at: all[c.word]?.startMs ?? 0, kind: "c" as const, label: "“" + all.slice(c.word, c.end + 1).map((w) => w.text).join(" ") + "”", body: c.body, go: () => go.current.onComment(c) })),
    ];
  }, [notes, comments, segments]);
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
