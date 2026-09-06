/**
 * One way to ask for a measurement, wherever it is stored (D43).
 *
 * A measurement type can arrive two ways. A device that samples through the night
 * writes a stream, which lives in a sidecar; a device that reports one figure for
 * the night writes a single reading, which lives in the document. Both are the same
 * measurement, so a caller asking "what is this athlete's SDNN over the last 90
 * days" should not have to know which device wrote it, or look in two places.
 *
 * Nothing here averages or reduces anything. Readings come back as they were
 * recorded, each carrying where it was found.
 */
import type { AthleticStandardFileT } from "./schema.js";
import { readSeriesDay, seriesDayFiles } from "./series.js";

export interface Reading {
  at: string;
  value: number;
  unit: string;
  source: string;
  /** Where this reading was found. Same measurement either way. */
  storage: "document" | "series";
}

const day = (ts: string) => ts.slice(0, 10);

/** Inline readings of a type, from one source. */
function inDocument(file: AthleticStandardFileT, type: string, source: string): Reading[] {
  return file.hard_signals
    .filter(
      (s): s is Extract<typeof s, { recorded_at: string; value: number; unit: string }> =>
        "value" in s && "unit" in s && s.type === type && s.source === source,
    )
    .map((s) => ({
      at: s.recorded_at,
      value: s.value,
      unit: s.unit,
      source,
      storage: "document" as const,
    }));
}

/**
 * The last day this source has a reading of this type, or null.
 *
 * Answered from filenames and inline timestamps alone, without opening a sidecar,
 * because it exists so that a caller can decide which days are worth opening.
 */
export function latestReadingDay(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  type: string,
  source: string,
): string | null {
  const days = [
    ...inDocument(file, type, source).map((r) => day(r.at)),
    ...seriesDayFiles(athleteFilePath, type, source).map((f) => f.day),
  ];
  if (days.length === 0) return null;
  return days.reduce((a, b) => (a >= b ? a : b));
}

/**
 * Every reading of a type from one source, oldest first.
 *
 * `from` and `to` are calendar days, and they bound which sidecars get opened as
 * well as which readings come back. Eleven years of nightly samples is thousands of
 * files, and a 90-day question should read 90 of them.
 */
export function readingsFor(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  type: string,
  source: string,
  window: { from?: string; to?: string } = {},
): Reading[] {
  const withinDay = (d: string) =>
    (window.from === undefined || d >= window.from) && (window.to === undefined || d <= window.to);

  const readings = inDocument(file, type, source).filter((r) => withinDay(day(r.at)));

  const unit = file.hard_signals.find(
    (s): s is Extract<typeof s, { type: "series_ref" }> =>
      s.type === "series_ref" && s.quantity === type && s.source === source,
  )?.unit;

  for (const found of seriesDayFiles(athleteFilePath, type, source)) {
    if (!withinDay(found.day)) continue;
    for (const sample of readSeriesDay(athleteFilePath, type, source, found.day) ?? []) {
      readings.push({
        at: sample.at,
        value: sample.value,
        unit: unit ?? "",
        source,
        storage: "series",
      });
    }
  }

  return readings.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
