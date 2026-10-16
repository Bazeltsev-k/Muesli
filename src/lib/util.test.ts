import { describe, expect, it } from "vitest";
import { activeIndex, fmt, removeTurns, rewordRange, setTurnSpeaker, transcriptText, turnsOf } from "./util";
import type { Recording, Segment } from "./api";

const seg = (speaker: number, startMs: number, text: string): Segment => ({
  speaker,
  startMs,
  endMs: startMs + 1000,
  lang: "en",
  words: text.split(" ").map((t, i) => ({ startMs: startMs + i * 100, text: t })),
});

describe("transcript helpers", () => {
  it("groups turns and starts paragraphs after long pauses", () => {
    const t = turnsOf([seg(0, 0, "One two"), seg(0, 1500, "three"), seg(0, 9000, "four"), seg(1, 9500, "five")]);
    expect(t.map((x) => x.paras.map((p) => p.map((w) => `${w.i}:${w.text}`).join(" ")))).toEqual([["0:One 1:two 2:three", "3:four"], ["4:five"]]);
  });

  it("replaces an edited range and re-times the new words inside it", () => {
    const segs = [seg(0, 0, "a b c"), seg(1, 2000, "d e")];
    const out = rewordRange(segs, 1, 3, "x y z w");
    expect(out.map((s) => s.words.map((w) => w.text).join(" "))).toEqual(["a x y z w", "e"]);
    const times = out[0].words.map((w) => w.startMs);
    expect(times[1]).toBe(100);
    expect(times.every((t, i) => i === 0 || t >= times[i - 1])).toBe(true);
    expect(times[4]).toBeLessThan(2100);
  });

  it("drops a whole range when the new text is empty", () => {
    const out = rewordRange([seg(0, 0, "a b"), seg(1, 2000, "c d"), seg(0, 4000, "e")], 2, 3, "");
    expect(out.map((s) => s.words.map((w) => w.text).join(" "))).toEqual(["a b", "e"]);
  });

  it("removes whole turns and keeps later comments on the same words", () => {
    const segs = [seg(0, 0, "a b"), seg(1, 2000, "c d"), seg(0, 4000, "e f")];
    const out = removeTurns(segs, [{ id: 1, word: 2, end: 3, body: "gone" }, { id: 2, word: 4, end: 5, body: "kept" }], [2]);
    expect(out.segments.map((s) => s.words.map((w) => w.text).join(" "))).toEqual(["a b", "e f"]);
    expect(out.comments).toEqual([{ id: 2, word: 2, end: 3, body: "kept" }]);
  });

  it("reassigns every segment of one turn to another speaker", () => {
    const out = setTurnSpeaker([seg(1, 0, "a b"), seg(0, 1000, "c"), seg(0, 2000, "d"), seg(1, 3000, "e")], 2, 4);
    expect(out.map((s) => s.speaker)).toEqual([1, 4, 4, 1]);
  });

  it("exports turns with names and times, and finds the spoken word", () => {
    const rec = { title: "" } as Recording;
    expect(transcriptText(rec, [seg(0, 0, "Hi all"), seg(1, 65_000, "Привіт")], ["Kir", "Olena"], true, "Untitled")).toBe("Untitled\n\n[0:00] Kir: Hi all\n[1:05] Olena: Привіт\n");
    const words = [{ startMs: 0, text: "a" }, { startMs: 100, text: "b" }];
    expect([-1, 0, 150].map((t) => activeIndex(words, t))).toEqual([-1, 0, 1]);
    expect(fmt(3_725_000)).toBe("1:02:05");
  });
});
