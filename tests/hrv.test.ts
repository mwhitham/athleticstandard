import { describe, expect, it } from "vitest";
import {
  bpmToIntervalsMs,
  MIN_INTERVALS_FOR_RMSSD,
  rmssdFromIntervals,
} from "../src/hrv.js";

/** Repeat a pattern until it is long enough to clear the guard rails. */
function repeatTo(pattern: number[], length: number): number[] {
  const out: number[] = [];
  while (out.length < length) out.push(...pattern);
  return out.slice(0, length);
}

describe("rmssdFromIntervals", () => {
  it("matches a hand-computed value", () => {
    // Alternating 800/900 ms: every successive difference is 100 ms, so the root
    // mean square of those differences is exactly 100.
    const intervals = repeatTo([800, 900], 40);
    const result = rmssdFromIntervals(intervals);
    expect(result).not.toBeNull();
    expect(result!.rmssd_ms).toBe(100);
    expect(result!.n_beats).toBe(40);
    expect(result!.n_dropped).toBe(0);
    // 20 pairs of 800+900 = 34000 ms
    expect(result!.window_s).toBe(34);
  });

  it("returns zero for a perfectly regular rhythm", () => {
    const result = rmssdFromIntervals(repeatTo([850], 40));
    expect(result!.rmssd_ms).toBe(0);
  });

  it("drops implausible intervals and reports how many", () => {
    const intervals = [...repeatTo([800, 900], 40), 2500, 120];
    const result = rmssdFromIntervals(intervals);
    expect(result).not.toBeNull();
    expect(result!.n_dropped).toBe(2);
    expect(result!.n_beats).toBe(40);
    // The outliers are gone, so the clean value survives them.
    expect(result!.rmssd_ms).toBe(100);
  });

  it("publishes nothing when too few beats survive", () => {
    // A weak number that looks like a measurement is worse than no number.
    const tooFew = repeatTo([850], MIN_INTERVALS_FOR_RMSSD - 1);
    expect(rmssdFromIntervals(tooFew)).toBeNull();
  });

  it("publishes nothing when the window is too short, however many beats arrived", () => {
    // 25 beats at 350 ms each is only 8.75 seconds of data.
    expect(rmssdFromIntervals(repeatTo([350], 25))).toBeNull();
  });

  it("publishes nothing when every interval is implausible", () => {
    expect(rmssdFromIntervals(repeatTo([50], 40))).toBeNull();
  });
});

describe("bpmToIntervalsMs", () => {
  it("converts instantaneous rates to the gaps between beats", () => {
    // 60 bpm is one beat a second; 120 bpm is one every half second.
    expect(bpmToIntervalsMs([60, 120])).toEqual([1000, 500]);
  });

  it("ignores non-positive rates rather than dividing by zero", () => {
    expect(bpmToIntervalsMs([60, 0, -5])).toEqual([1000]);
  });
});
