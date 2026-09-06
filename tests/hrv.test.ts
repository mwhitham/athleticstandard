import { describe, expect, it } from "vitest";
import {
  bpmToIntervalsMs,
  MIN_INTERVALS_FOR_RMSSD,
  rmssdFromBeats,
  rmssdFromIntervals,
  type Beat,
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

describe("rmssdFromBeats", () => {
  /** A continuous run of beats, each placed where its own interval puts it. */
  function continuous(intervals: number[]): Beat[] {
    const beats: Beat[] = [];
    let offsetMs = 0;
    for (const intervalMs of intervals) {
      beats.push({ offsetMs, intervalMs });
      offsetMs += intervalMs;
    }
    return beats;
  }

  it("agrees with the plain interval calculation when no beats are missing", () => {
    const intervals = repeatTo([800, 900], 40);
    const fromBeats = rmssdFromBeats(continuous(intervals));
    expect(fromBeats!.rmssd_ms).toBe(100);
    expect(fromBeats!.n_beats).toBe(40);
  });

  it("ignores the pair that straddles a missed beat", () => {
    // A steady 800 ms rhythm with one beat dropped from the middle. The intervals
    // either side are both 800, so a naive reading sees no variability — but the
    // timestamps show a 1600 ms gap where a beat should have been. Splitting there
    // is what stops a dropped beat from being read as real variation.
    const beats = continuous(repeatTo([800], 40));
    const withGap = beats.filter((_, i) => i !== 20);

    const result = rmssdFromBeats(withGap);
    expect(result).not.toBeNull();
    expect(result!.rmssd_ms).toBe(0);
    // 39 beats leave 38 adjacent pairs, one of which spans the gap.
    expect(result!.n_beats).toBe(39);
  });

  it("does not invent variability from a dropped beat", () => {
    // The case that matters. Alternating 700/900 with a beat missing: the pair
    // across the gap would contribute a spurious difference if counted.
    const beats = continuous(repeatTo([700, 900], 60));
    const withGap = beats.filter((_, i) => i !== 30);

    const clean = rmssdFromBeats(beats)!;
    const gappy = rmssdFromBeats(withGap)!;
    // Dropping one beat should barely move the result, not spike it.
    expect(Math.abs(gappy.rmssd_ms - clean.rmssd_ms)).toBeLessThan(5);
  });

  it("counts implausible intervals as dropped", () => {
    const beats = continuous(repeatTo([800, 900], 40));
    beats.push({ offsetMs: 40_000, intervalMs: 2500 });
    const result = rmssdFromBeats(beats);
    expect(result!.n_dropped).toBe(1);
  });

  it("publishes nothing when too few continuous pairs survive", () => {
    // Every beat isolated by a gap: no pair is trustworthy, so there is no value.
    const isolated: Beat[] = Array.from({ length: 40 }, (_, i) => ({
      offsetMs: i * 5000,
      intervalMs: 800,
    }));
    expect(rmssdFromBeats(isolated)).toBeNull();
  });

  it("accepts a ten-second window, which the literature supports", () => {
    // RMSSD from a 10-second recording was a valid proxy for the 5-minute standard
    // in a 3,387-adult study. The window length travels with the value so a reader
    // can weight it.
    const result = rmssdFromBeats(continuous(repeatTo([800, 900], 13)));
    expect(result).not.toBeNull();
    expect(result!.window_s).toBeGreaterThanOrEqual(10);
    expect(result!.window_s).toBeLessThan(30);
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
