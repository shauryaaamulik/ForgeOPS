import { describe, expect, it } from "vitest";
import { counterDelta, overlapSeconds } from "../src/modules/analytics/intervals.js";

const t = (s: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, s));

describe("overlapSeconds", () => {
  it("counts only the part of an interval inside the window", () => {
    expect(overlapSeconds([{ start: t(0), end: t(100) }], t(50), t(200), t(500))).toBe(50);
  });
  it("sums several intervals and ignores ones outside the window", () => {
    const iv = [
      { start: t(0), end: t(10) },
      { start: t(20), end: t(30) },
      { start: t(500), end: t(600) },
    ];
    expect(overlapSeconds(iv, t(0), t(100), t(1000))).toBe(20);
  });
  it("ends an open interval at the earlier of 'now' and the window end", () => {
    expect(overlapSeconds([{ start: t(10), end: null }], t(0), t(100), t(40))).toBe(30);
    expect(overlapSeconds([{ start: t(10), end: null }], t(0), t(100), t(900))).toBe(90);
  });
});

describe("counterDelta", () => {
  it("returns the increase, and treats a reset as a fresh count", () => {
    expect(counterDelta(15, 10)).toBe(5);
    expect(counterDelta(10, 10)).toBe(0);
    expect(counterDelta(3, 120)).toBe(3);
  });
});
