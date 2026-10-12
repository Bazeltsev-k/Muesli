import { describe, expect, it } from "vitest";
import { transcriptText, turns } from "./transcript";
import { activeIndex, formatTime } from "./format";
import type { Recording, Segment } from "./api";

const seg = (speaker: number, startMs: number, text: string): Segment => ({
  speaker,
  startMs,
  endMs: startMs + 1000,
  lang: "en",
  words: text.split(" ").map((t, i) => ({ startMs: startMs + i * 100, text: t })),
});

describe("transcript", () => {
  it("merges consecutive turns of one speaker and labels speakers", () => {
    const rec = { title: "Sync", createdAt: 0, durationMs: 3_725_000 } as Recording;
    const text = transcriptText(rec, [seg(0, 0, "Hi all"), seg(0, 2000, "let's start"), seg(1, 65_000, "Привіт")], ["Kir", "Them"], true);
    expect(text.split("\n").slice(1)).toEqual([
      expect.stringContaining("1:02:05"),
      "",
      "[0:00] Kir: Hi all let's start",
      "[1:05] Them: Привіт",
      "",
    ]);
  });

  it("starts a new paragraph after a long pause within a turn", () => {
    const t = turns([seg(0, 0, "One two"), seg(0, 1500, "three"), seg(0, 9000, "four"), seg(1, 9500, "five")]);
    expect(t.map((x) => x.paragraphs.map((p) => p.map((w) => w.text).join(" ")))).toEqual([["One two three", "four"], ["five"]]);
  });

  it("finds the word being spoken", () => {
    expect([-5, 0, 150, 999].map((t) => activeIndex([0, 100, 200], t))).toEqual([-1, 0, 1, 2]);
    expect(formatTime(59_999)).toBe("0:59");
  });
});
