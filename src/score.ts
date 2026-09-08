/**
 * What a written-down score means, in one place.
 *
 * Two readers want scores and they want them differently. `ath log` hunts for one
 * inside a sentence somebody typed, where most of the numbers are loads and
 * intervals and only a few are results. `ath grade --actual` reads a whole field
 * whose score type is already known, so it can be strict. What the two must agree on
 * is the grammar: `4:32` is four minutes thirty-two, `225lb` is a load, and a bare
 * number is neither. Written twice, that grammar drifts, and the same score typed
 * into two commands stops meaning one thing.
 *
 * So the patterns and the arithmetic live here and the anchoring lives with the
 * caller, which is the part that genuinely differs.
 */
import type { BenchmarkT, ScoreT } from "./schema.js";

/** How a benchmark is scored, and which field of a score carries it. */
export type ScoreType = BenchmarkT["score_type"];

export const SCORE_KEY = { time: "duration_s", reps: "reps", load: "weight_kg" } as const;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const lbToKg = (n: number) => round2(n * 0.45359237);

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

/** A clock: `4:32`, or `1:02:30` once it runs past an hour. */
const CLOCK = String.raw`(\d{1,3}):([0-5]\d)(?::([0-5]\d))?`;

/** An amount and the unit it is weighed in. The unit is never optional. */
const LOAD = String.raw`(\d{1,4}(?:\.\d+)?)\s*(kg|lbs?|pounds)`;

/** The whole field is a clock. What `--actual 4:32` matches. */
export const CLOCK_ONLY = new RegExp(`^${CLOCK}$`);

/** A clock at the end of a sentence, which is where a finish time is written. */
export const CLOCK_AT_END = new RegExp(`(?:^|\\s)${CLOCK}\\s*$`);

/** A clock the sentence introduced: `in 4:41`, `finished 12:03`. */
export const CLOCK_INTRODUCED = new RegExp(`\\b(?:in|time|finished)\\s+${CLOCK}\\b`, "i");

/** The whole field is a load. What `--actual 100kg` matches. */
export const LOAD_ONLY = new RegExp(`^${LOAD}$`, "i");

/** A load at the end of a sentence. */
export const LOAD_AT_END = new RegExp(`${LOAD}\\s*$`, "i");

/** Seconds from a clock match. Two captures are minutes and seconds, three add hours. */
export function secondsFromClock(match: RegExpExecArray): number {
  const [, a, b, c] = match;
  return c === undefined
    ? Number(a) * 60 + Number(b)
    : Number(a) * 3600 + Number(b) * 60 + Number(c);
}

/** Kilos from a load match, whichever unit it was written in. */
export function kilosFromLoad(match: RegExpExecArray): number {
  const raw = Number(match[1]);
  return /^kg$/i.test(match[2]!) ? raw : lbToKg(raw);
}

// ---------------------------------------------------------------------------
// Saying a score back
// ---------------------------------------------------------------------------

/** "4:41", "1:02:30" — the way a result is written down. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** "7h20m", for a duration nobody counts in seconds. */
export function hoursAndMinutes(seconds: number): string {
  // Round to the minute first. Rounding the remainder on its own turns 6h59m30s
  // into "6h60m", which is not a time anybody writes.
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** A score read from whichever field it carries. */
export function describeScore(score: ScoreT): string {
  if (score.duration_s !== undefined) return formatDuration(score.duration_s);
  if (score.reps !== undefined) return `${score.reps} reps`;
  if (score.weight_kg !== undefined) return `${score.weight_kg} kg`;
  return "(no score)";
}

/** The score in the benchmark's own unit, or undefined when it carries no such field. */
export function nativeValue(score: ScoreT, scoreType: ScoreType): number | undefined {
  return score[SCORE_KEY[scoreType]];
}

/** An amount in the benchmark's own unit: `3s`, `12 reps`, `2.5 kg`. */
export function amountIn(amount: number, scoreType: ScoreType): string {
  const rounded = Math.round(amount * 100) / 100;
  if (scoreType === "time") return `${rounded}s`;
  if (scoreType === "reps") return `${rounded} reps`;
  return `${rounded} kg`;
}
