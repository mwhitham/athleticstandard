/**
 * Small things every command needs, kept in one place.
 *
 * None of this is interesting on its own. It is here because the same four-line
 * helper written in four files is four chances for one of them to be quietly wrong,
 * and the day arithmetic in particular has already cost this project a bug.
 */
import type { AthleticStandardFileT, HardSignalT } from "./schema.js";

/**
 * When a hard signal happened, as a timestamp.
 *
 * Three shapes carry their time differently: a measurement has an instant, a session
 * has a start and an end, and a series reference covers a range of days. Sorting the
 * file needs one answer from all three.
 */
export function signalAt(sig: HardSignalT): string {
  if ("recorded_at" in sig) return sig.recorded_at;
  if (sig.type === "series_ref") return `${sig.from}T00:00:00Z`;
  return sig.start;
}

/** The file's signals in time order, which is how they are always stored. */
export function sortHardSignals(file: AthleticStandardFileT): void {
  file.hard_signals.sort((a, b) => Date.parse(signalAt(a)) - Date.parse(signalAt(b)));
}

/** The source hand-typed records belong to, created if the file has none. */
export function manualSource(file: AthleticStandardFileT): string {
  const existing = file.sources.find((s) => s.kind === "manual");
  if (existing) return existing.id;
  file.sources.push({ id: "manual-1", kind: "manual", detail: "Hand-entered data" });
  return "manual-1";
}

/** The calendar day `by` days from this one. Negative goes backwards. */
export function shiftDay(day: string, by: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
}

/** The calendar day `days` before this one. */
export function dayBefore(day: string, days: number): string {
  return shiftDay(day, -days);
}

/** The day part of a timestamp. */
export function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * The measurements a prediction reads, in the order they are worth reading.
 *
 * One list, because `ath stats`, `ath predict` and the miss dossier all have to look
 * at the same things. A measurement in one and not the others makes a baseline that
 * appears in the summary and not in the evidence, which reads as a missing number
 * rather than as a list that fell out of step.
 */
export const TRACKED: readonly { type: string; unit: string }[] = [
  { type: "hrv_rmssd", unit: "ms" },
  { type: "hrv_sdnn", unit: "ms" },
  { type: "resting_heart_rate", unit: "bpm" },
  { type: "respiratory_rate", unit: "brpm" },
];

export const TRACKED_TYPES: readonly string[] = TRACKED.map((t) => t.type);
