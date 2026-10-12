import { describe, expect, it } from "vitest";
import { transcriptText } from "./transcript";
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

  it("finds the word being spoken", () => {
    expect([-5, 0, 150, 999].map((t) => activeIndex([0, 100, 200], t))).toEqual([-1, 0, 1, 2]);
    expect(formatTime(59_999)).toBe("0:59");
  });
});
