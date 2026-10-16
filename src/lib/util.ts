import { useEffect, useMemo, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Comment, Recording, Segment, Word } from "./api";

export const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

export const fmtDate = (ms: number, lang: string) =>
  new Date(ms).toLocaleString(lang === "uk" ? "uk-UA" : lang === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export type IndexedWord = Word & { i: number };
export type Turn = { speaker: number; start: number; end: number; paras: IndexedWord[][] };

const PARAGRAPH_GAP_MS = 1500;

export function turnsOf(segments: Segment[]): Turn[] {
  const out: Turn[] = [];
  let index = 0;
  for (const s of segments) {
    const ws = s.words.map((w) => ({ ...w, i: index++ }));
    const last = out[out.length - 1];
    if (last && last.speaker === s.speaker) {
      if (s.startMs - last.end > PARAGRAPH_GAP_MS) last.paras.push(ws);
      else last.paras[last.paras.length - 1].push(...ws);
      last.end = Math.max(last.end, s.endMs);
    } else out.push({ speaker: s.speaker, start: s.startMs, end: s.endMs, paras: [ws] });
  }
  return out;
}

export const flatWords = (segments: Segment[]) => segments.flatMap((s) => s.words);

export function activeIndex(words: Word[], t: number) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].startMs <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function rewordRange(segments: Segment[], first: number, last: number, text: string): Segment[] {
  const all = flatWords(segments);
  const start = all[first].startMs;
  const end = (all[last + 1]?.startMs ?? all[last].startMs + 600) - 50;
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const fresh = parts.map((w, k) => ({ startMs: Math.round(start + ((end - start) * k) / Math.max(1, parts.length)), text: w }));
  let k = 0;
  return segments
    .map((s) => {
      const words: Word[] = [];
      for (const w of s.words) {
        const i = k++;
        if (i < first || i > last) words.push(w);
        else if (i === first) words.push(...fresh);
      }
      return { ...s, words };
    })
    .filter((s) => s.words.length > 0);
}

export function setTurnSpeaker(segments: Segment[], firstWord: number, speaker: number): Segment[] {
  const turn = turnsOf(segments).find((t) => t.paras[0][0].i === firstWord);
  if (!turn) return segments;
  const lastWord = turn.paras[turn.paras.length - 1].at(-1)!.i;
  let index = 0;
  return segments.map((s) => {
    const first = index;
    index += s.words.length;
    return s.words.length && first >= firstWord && first <= lastWord ? { ...s, speaker } : s;
  });
}

export function removeTurns(segments: Segment[], comments: Comment[], keys: number[]) {
  const ranges = turnsOf(segments)
    .filter((tn) => keys.includes(tn.paras[0][0].i))
    .map((tn) => [tn.paras[0][0].i, tn.paras[tn.paras.length - 1].at(-1)!.i]);
  const gone = (i: number) => ranges.some(([a, b]) => i >= a && i <= b);
  const before = (i: number) => ranges.reduce((n, [a, b]) => n + (b < i ? b - a + 1 : 0), 0);
  let k = 0;
  return {
    segments: segments.map((s) => ({ ...s, words: s.words.filter(() => !gone(k++)) })).filter((s) => s.words.length > 0),
    comments: comments.filter((c) => !ranges.some(([a, b]) => c.word <= b && c.end >= a)).map((c) => ({ ...c, word: c.word - before(c.word), end: c.end - before(c.end) })),
  };
}

const EXTRA_SPEAKER_COLORS = ["#30A46C", "#F76B15", "#D6409F", "#12A594", "#E0A12E", "#E5484D"];
export const speakerColor = (i: number) => (i === 0 ? "var(--me)" : i === 1 ? "var(--them)" : EXTRA_SPEAKER_COLORS[(i - 2) % EXTRA_SPEAKER_COLORS.length]);

export function transcriptText(rec: Recording, segments: Segment[], names: string[], timestamps: boolean, untitled: string) {
  const lines = turnsOf(segments).map((t) => `${timestamps ? `[${fmt(t.start)}] ` : ""}${names[t.speaker] ?? names[1]}: ${t.paras.flat().map((w) => w.text).join(" ")}`);
  return `${rec.title || untitled}\n\n${lines.join("\n")}\n`;
}

export function useTicker(active: boolean, cb: () => void, ms = 100) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

export function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  const cb = useRef(onOut);
  cb.current = onOut;
  useEffect(() => {
    const h = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && cb.current();
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [ref]);
}

export function useTauriEvent<T>(name: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const unlisten = listen<T>(name, (e) => ref.current(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, [name]);
}

export function useStable<T extends Record<string, (...args: never[]) => unknown>>(fns: T): T {
  const ref = useRef(fns);
  ref.current = fns;
  return useMemo(() => Object.fromEntries(Object.keys(fns).map((k) => [k, (...args: never[]) => ref.current[k](...args)])) as T, []);
}
