import type { Recording, Segment, Word } from "./api";
import { formatDate, formatTime } from "./format";

export type Turn = { speaker: number; startMs: number; endMs: number; paragraphs: Word[][] };

const PARAGRAPH_GAP_MS = 1500;

export function turns(segments: Segment[]): Turn[] {
  const result: Turn[] = [];
  for (const s of segments) {
    const last = result[result.length - 1];
    if (last && last.speaker === s.speaker) {
      if (s.startMs - last.endMs > PARAGRAPH_GAP_MS) last.paragraphs.push([...s.words]);
      else last.paragraphs[last.paragraphs.length - 1].push(...s.words);
      last.endMs = Math.max(last.endMs, s.endMs);
    } else result.push({ speaker: s.speaker, startMs: s.startMs, endMs: s.endMs, paragraphs: [[...s.words]] });
  }
  return result;
}

export function transcriptText(recording: Recording, segments: Segment[], names: [string, string], timestamps: boolean): string {
  const header = `${recording.title}\n${formatDate(recording.createdAt)} · ${formatTime(recording.durationMs)}\n`;
  const body = turns(segments).map((t) => {
    const prefix = timestamps ? `[${formatTime(t.startMs)}] ` : "";
    return `${prefix}${names[t.speaker] ?? names[1]}: ${t.paragraphs.flat().map((w) => w.text).join(" ")}`;
  });
  return [header, ...body].join("\n") + "\n";
}
