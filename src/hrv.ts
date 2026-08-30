/**
 * RMSSD from beat-to-beat intervals.
 *
 * Apple reports HRV only as SDNN, while WHOOP and Oura report RMSSD, and the two
 * are different statistics that must never share a baseline (D22). But Apple's
 * export carries the beats underneath its SDNN number, so RMSSD can be computed
 * rather than lost (D26).
 *
 * A ~60 second window is enough for RMSSD. In athletes it agreed with the
 * standard 5-minute measurement at ICC 0.98, and in 3,387 adults RMSSD from even
 * a 10-second recording was a valid proxy (r = 0.86). SDNN needs longer windows
 * and agrees worse at every length, which is why this computes RMSSD only.
 */

/** Shortest interval treated as a real heartbeat: 2000 ms is 30 bpm. */
const MIN_PLAUSIBLE_INTERVAL_MS = 300;
/** Longest interval treated as a real heartbeat: 300 ms is 200 bpm. */
const MAX_PLAUSIBLE_INTERVAL_MS = 2000;

/** Below this many usable intervals the result is noise, so nothing is published. */
export const MIN_INTERVALS_FOR_RMSSD = 20;
/** Below this window length the same applies, however many beats arrived. */
export const MIN_WINDOW_S_FOR_RMSSD = 30;

export interface RmssdResult {
  rmssd_ms: number;
  n_beats: number;
  n_dropped: number;
  window_s: number;
}

/**
 * Instantaneous heart rates to the intervals between beats.
 * A reading of 70 bpm describes a gap of 60000/70 = 857 ms.
 */
export function bpmToIntervalsMs(bpms: number[]): number[] {
  return bpms.filter((bpm) => bpm > 0).map((bpm) => 60000 / bpm);
}

/**
 * RMSSD over a series of beat intervals, or null when too little usable data
 * survives. Returning null is deliberate: a weak number that looks like a
 * measurement is worse than no number.
 */
export function rmssdFromIntervals(intervalsMs: number[]): RmssdResult | null {
  const usable = intervalsMs.filter(
    (ms) => ms >= MIN_PLAUSIBLE_INTERVAL_MS && ms <= MAX_PLAUSIBLE_INTERVAL_MS,
  );
  const nDropped = intervalsMs.length - usable.length;

  if (usable.length < MIN_INTERVALS_FOR_RMSSD) return null;

  const windowS = usable.reduce((sum, ms) => sum + ms, 0) / 1000;
  if (windowS < MIN_WINDOW_S_FOR_RMSSD) return null;

  // RMSSD: root mean square of the differences between successive intervals.
  let sumSquares = 0;
  for (let i = 1; i < usable.length; i++) {
    const diff = usable[i]! - usable[i - 1]!;
    sumSquares += diff * diff;
  }
  const rmssd = Math.sqrt(sumSquares / (usable.length - 1));

  return {
    rmssd_ms: Math.round(rmssd * 10) / 10,
    n_beats: usable.length,
    n_dropped: nDropped,
    window_s: Math.round(windowS * 10) / 10,
  };
}
