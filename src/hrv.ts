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

/**
 * Shortest window worth computing over.
 *
 * Ten seconds, following the evidence rather than caution: in 3,387 adults, RMSSD
 * from a single 10-second recording was a valid proxy for the 4–5 minute standard
 * (r = 0.86), and agreement improved steadily with length. A 60-second window
 * reached ICC 0.98 in athletes.
 *
 * Short windows are kept rather than discarded because every derived value carries
 * its `window_s` and beat count. A reader wanting only long windows can filter on
 * the receipts; a reader given nothing has no choice at all.
 */
export const MIN_WINDOW_S_FOR_RMSSD = 10;

export interface RmssdResult {
  rmssd_ms: number;
  n_beats: number;
  n_dropped: number;
  window_s: number;
}

/** One beat: when it landed, and the interval it reports. */
export interface Beat {
  /** Milliseconds from the start of the measurement window. */
  offsetMs: number;
  /** The interval this beat reports, in milliseconds. */
  intervalMs: number;
}

/**
 * A gap wider than this multiple of the expected interval means a beat was missed.
 * 1.5 sits above normal beat-to-beat variation and below a skipped beat.
 */
const GAP_TOLERANCE = 1.5;

/** Fewest successive pairs worth computing over. */
export const MIN_PAIRS_FOR_RMSSD = 10;

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

/**
 * RMSSD over a timestamped beat sequence, skipping pairs that span a missed beat.
 *
 * This is the part a plain interval list cannot get right. RMSSD is built from the
 * difference between *successive* intervals, so if the watch failed to detect a
 * beat, the two intervals either side of the gap are not successive. Treating them
 * as if they were invents a large difference and inflates the result — the reading
 * looks like high variability when it is really a dropped beat.
 *
 * So gaps are detected from the beat timestamps, the sequence is split there, and
 * only pairs inside a continuous run contribute.
 */
export function rmssdFromBeats(beats: Beat[]): RmssdResult | null {
  const plausible = beats.filter(
    (b) => b.intervalMs >= MIN_PLAUSIBLE_INTERVAL_MS && b.intervalMs <= MAX_PLAUSIBLE_INTERVAL_MS,
  );
  const nDropped = beats.length - plausible.length;
  if (plausible.length < 2) return null;

  // Split into runs of beats with no missed beat between them.
  const runs: Beat[][] = [];
  let run: Beat[] = [plausible[0]!];
  for (let i = 1; i < plausible.length; i++) {
    const previous = plausible[i - 1]!;
    const current = plausible[i]!;
    const observedGap = current.offsetMs - previous.offsetMs;
    const continuous = observedGap > 0 && observedGap <= current.intervalMs * GAP_TOLERANCE;
    if (continuous) {
      run.push(current);
      continue;
    }
    runs.push(run);
    run = [current];
  }
  runs.push(run);

  let sumSquares = 0;
  let pairs = 0;
  for (const segment of runs) {
    for (let i = 1; i < segment.length; i++) {
      const diff = segment[i]!.intervalMs - segment[i - 1]!.intervalMs;
      sumSquares += diff * diff;
      pairs++;
    }
  }

  if (pairs < MIN_PAIRS_FOR_RMSSD) return null;

  const spanMs = plausible[plausible.length - 1]!.offsetMs - plausible[0]!.offsetMs;
  const windowS = spanMs / 1000;
  if (windowS < MIN_WINDOW_S_FOR_RMSSD) return null;

  return {
    rmssd_ms: Math.round(Math.sqrt(sumSquares / pairs) * 10) / 10,
    n_beats: plausible.length,
    n_dropped: nDropped,
    window_s: Math.round(windowS * 10) / 10,
  };
}
