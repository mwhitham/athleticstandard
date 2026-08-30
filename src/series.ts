/**
 * Sidecar series files: dense sample streams stored beside the athlete file (D25).
 *
 * All-day heart rate, per-second workout heart rate, and beat-to-beat intervals
 * would add roughly 22 MB a year to a document measured at 0.43 MB, which stops it
 * being readable in a text editor. So the samples live in `series/`, one file per
 * quantity per day per source, and the document holds a `series_ref` with the path,
 * a hash, and a summary.
 *
 * Nothing here averages or downsamples. The sidecar holds every sample the export
 * contained — the point of keeping series data is the fidelity a daily mean destroys.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ATHLETIC_STANDARD_VERSION,
  SERIES_QUANTITY_UNITS,
  SeriesFile,
  type SeriesFileT,
  type SeriesQuantity,
  type SeriesRefT,
} from "./schema.js";

export const SERIES_DIR = "series";

/** One sample: an absolute instant and a value, before it is packed into a sidecar. */
export interface Sample {
  at: string;
  value: number;
}

/** Stable field order and a trailing newline, so sidecars diff cleanly under git. */
function serializeSeries(file: SeriesFileT): string {
  return (
    JSON.stringify(
      {
        athleticstandard_version: file.athleticstandard_version,
        quantity: file.quantity,
        unit: file.unit,
        start: file.start,
        source: file.source,
        offsets_ms: file.offsets_ms,
        values: file.values,
      },
      null,
      2,
    ) + "\n"
  );
}

export function hashSeriesContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Sidecar filename. Includes the source so two devices measuring the same day
 * never collide — their readings are kept apart, not merged (D31).
 */
export function seriesFilename(quantity: SeriesQuantity, day: string, source: string): string {
  return join(SERIES_DIR, `${day}-${quantity}-${source}.ath.series.json`);
}

export interface BuiltSeries {
  ref: SeriesRefT;
  content: string;
}

/**
 * Pack samples into a sidecar plus the reference record that points at it.
 * Samples are sorted by instant; offsets are milliseconds from the first one.
 */
export function buildSeries(
  quantity: SeriesQuantity,
  source: string,
  day: string,
  samples: Sample[],
): BuiltSeries | null {
  if (samples.length === 0) return null;

  const sorted = [...samples].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const start = sorted[0]!.at;
  const startMs = Date.parse(start);
  const offsets_ms = sorted.map((s) => Date.parse(s.at) - startMs);
  const values = sorted.map((s) => s.value);

  const unit = SERIES_QUANTITY_UNITS[quantity];
  const file: SeriesFileT = {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    quantity,
    unit,
    start,
    source,
    offsets_ms,
    values,
  };
  const content = serializeSeries(file);

  const sum = values.reduce((a, b) => a + b, 0);
  return {
    ref: {
      type: "series_ref",
      quantity,
      unit,
      start,
      end: sorted[sorted.length - 1]!.at,
      source,
      file: seriesFilename(quantity, day, source),
      sha256: hashSeriesContent(content),
      n: values.length,
      summary: {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: Math.round((sum / values.length) * 100) / 100,
      },
    },
    content,
  };
}

/** Write a sidecar next to the athlete file, creating `series/` if needed. */
export function writeSeriesFile(athleteFilePath: string, built: BuiltSeries): void {
  const target = resolve(dirname(athleteFilePath), built.ref.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, built.content);
}

export interface SeriesCheck {
  status: "ok" | "missing" | "hash_mismatch" | "unreadable" | "count_mismatch";
  detail?: string;
}

/**
 * Verify a referenced sidecar.
 *
 * A missing file is reported so the caller can warn rather than fail: a document
 * that travelled without its sidecars must still be usable. A hash mismatch is
 * different — a file edited underneath its receipts is worse than an absent one.
 */
export function checkSeriesRef(athleteFilePath: string, ref: SeriesRefT): SeriesCheck {
  const target = resolve(dirname(athleteFilePath), ref.file);
  if (!existsSync(target)) return { status: "missing" };

  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch (e) {
    return { status: "unreadable", detail: (e as Error).message };
  }

  const actual = hashSeriesContent(content);
  if (actual !== ref.sha256) {
    return { status: "hash_mismatch", detail: `expected ${ref.sha256.slice(0, 12)}…, found ${actual.slice(0, 12)}…` };
  }

  const parsed = SeriesFile.safeParse(JSON.parse(content));
  if (!parsed.success) {
    return { status: "unreadable", detail: parsed.error.issues[0]?.message ?? "does not match the series schema" };
  }
  if (parsed.data.values.length !== ref.n) {
    return {
      status: "count_mismatch",
      detail: `reference claims ${ref.n} samples, sidecar holds ${parsed.data.values.length}`,
    };
  }
  return { status: "ok" };
}

/** Read a sidecar back, resolving offsets into absolute instants. */
export function readSeriesSamples(athleteFilePath: string, ref: SeriesRefT): Sample[] {
  const target = resolve(dirname(athleteFilePath), ref.file);
  const parsed = SeriesFile.parse(JSON.parse(readFileSync(target, "utf8")));
  const startMs = Date.parse(parsed.start);
  return parsed.offsets_ms.map((offset, i) => ({
    at: new Date(startMs + offset).toISOString(),
    value: parsed.values[i]!,
  }));
}
