import type { Recording, Segment, Word } from "./api";
import { formatDate, formatTime } from "./format";

export type Turn = { speaker: number; startMs: number; words: Word[] };

export function turns(segments: Segment[]): Turn[] {
  const result: Turn[] = [];
  for (const s of segments) {
    const last = result[result.length - 1];
    if (last && last.speaker === s.speaker) last.words.push(...s.words);
    else result.push({ speaker: s.speaker, startMs: s.startMs, words: [...s.words] });
  }
  return result;
}

export function transcriptText(recording: Recording, segments: Segment[], names: [string, string], timestamps: boolean): string {
  const header = `${recording.title}\n${formatDate(recording.createdAt)} · ${formatTime(recording.durationMs)}\n`;
  const body = turns(segments).map((t) => {
    const prefix = timestamps ? `[${formatTime(t.startMs)}] ` : "";
    return `${prefix}${names[t.speaker] ?? names[1]}: ${t.words.map((w) => w.text).join(" ")}`;
  });
  return [header, ...body].join("\n") + "\n";
}
