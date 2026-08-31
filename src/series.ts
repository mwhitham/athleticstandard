/**
 * Sidecar series files: dense sample streams stored beside the athlete file (D25).
 *
 * All-day heart rate, per-second workout heart rate, and beat-to-beat intervals
 * would add roughly 22 MB a year to a document measured at 0.43 MB, which stops it
 * being readable in a text editor. So the samples live in `series/`, one file per
 * quantity per day per source.
 *
 * Nothing here averages or downsamples. The sidecar holds every sample the export
 * contained — the point of keeping series data is the fidelity a daily mean destroys.
 *
 * The document holds one record per quantity, not one per day (D40). Per-day records
 * had recreated the problem sidecars existed to solve: 24,448 of them on a real
 * import, a 10.5 MB document, unreadable. Days are found by name instead, since a
 * sidecar's filename is fully determined by its day, quantity, and source.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const SERIES_SUFFIX = ".ath.series.json";

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
  return join(SERIES_DIR, `${day}-${quantity}-${source}${SERIES_SUFFIX}`);
}

/** One day's sidecar, ready to write, with the hash of what will be written. */
export interface BuiltSeries {
  quantity: SeriesQuantity;
  source: string;
  day: string;
  file: string;
  n: number;
  sha256: string;
  content: string;
}

/**
 * Pack a day's samples into a sidecar.
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

  const file: SeriesFileT = {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    quantity,
    unit: SERIES_QUANTITY_UNITS[quantity],
    start,
    source,
    offsets_ms: sorted.map((s) => Date.parse(s.at) - startMs),
    values: sorted.map((s) => s.value),
  };
  const content = serializeSeries(file);

  return {
    quantity,
    source,
    day,
    file: seriesFilename(quantity, day, source),
    n: sorted.length,
    sha256: hashSeriesContent(content),
    content,
  };
}

/** Write a sidecar next to the athlete file, creating `series/` if needed. */
export function writeSeriesFile(athleteFilePath: string, built: BuiltSeries): void {
  const target = resolve(dirname(athleteFilePath), built.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, built.content);
}

export function seriesDirectory(athleteFilePath: string): string {
  return resolve(dirname(athleteFilePath), SERIES_DIR);
}

/** One sidecar found on disk. */
export interface SeriesDayFile {
  day: string;
  file: string;
}

/**
 * Every sidecar on disk for a quantity and source, in date order.
 *
 * Matched by filename suffix rather than by parsing the name apart. Quantities
 * contain underscores and source ids contain hyphens, so splitting on either would
 * be ambiguous — but the suffix is exact, and the day is the leading ten characters.
 */
export function seriesDayFiles(
  athleteFilePath: string,
  quantity: string,
  source: string,
): SeriesDayFile[] {
  const dir = seriesDirectory(athleteFilePath);
  if (!existsSync(dir)) return [];

  const suffix = `-${quantity}-${source}${SERIES_SUFFIX}`;
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}-/.test(name))
    .map((name) => ({ day: name.slice(0, 10), file: join(SERIES_DIR, name) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Combine per-day hashes into one hash for the quantity.
 *
 * Hashing the hashes rather than the concatenated contents keeps this cheap and
 * order-explicit: the day is hashed alongside its content hash, so moving a day's
 * samples to a different date changes the result even though the bytes did not.
 */
function combineDayHashes(days: { day: string; sha256: string }[]): string {
  const hash = createHash("sha256");
  for (const entry of days) hash.update(`${entry.day}:${entry.sha256}\n`);
  return hash.digest("hex");
}

/**
 * Build the document's record for a quantity by reading every sidecar on disk.
 *
 * Read from disk rather than from the import, because the hash has to cover days
 * written by earlier imports too. Returns null when the quantity has no sidecars,
 * which is how a caller learns a group record should be dropped.
 */
export function assembleSeriesRef(
  athleteFilePath: string,
  quantity: SeriesQuantity,
  source: string,
): SeriesRefT | null {
  const found = seriesDayFiles(athleteFilePath, quantity, source);
  if (found.length === 0) return null;

  const root = dirname(athleteFilePath);
  const hashes: { day: string; sha256: string }[] = [];
  let samples = 0;

  for (const entry of found) {
    const content = readFileSync(resolve(root, entry.file), "utf8");
    hashes.push({ day: entry.day, sha256: hashSeriesContent(content) });
    const parsed = SeriesFile.safeParse(JSON.parse(content));
    if (parsed.success) samples += parsed.data.values.length;
  }

  return {
    type: "series_ref",
    quantity,
    unit: SERIES_QUANTITY_UNITS[quantity],
    source,
    from: found[0]!.day,
    to: found[found.length - 1]!.day,
    days: found.length,
    n: samples,
    sha256: combineDayHashes(hashes),
  };
}

export type SeriesCheck =
  | { status: "ok" }
  | { status: "no_series_dir" }
  | { status: "mismatch" };

/**
 * Verify a quantity against what is on disk. One rule, one message.
 *
 * Hash whatever is there and compare. A missing day, an extra day, and an edited
 * day all change the hash, all report the same thing, and all have the same remedy:
 * import again, which rewrites the files and the record together. Telling those
 * causes apart would cost the reader a decision they do not have to make.
 *
 * No `series/` folder at all is different, and normal — that is the document
 * travelling without its sidecars, and it must stay usable.
 */
export function checkSeriesRef(athleteFilePath: string, ref: SeriesRefT): SeriesCheck {
  if (!existsSync(seriesDirectory(athleteFilePath))) return { status: "no_series_dir" };

  const rebuilt = assembleSeriesRef(athleteFilePath, ref.quantity, ref.source);
  if (!rebuilt || rebuilt.sha256 !== ref.sha256) return { status: "mismatch" };
  return { status: "ok" };
}

/**
 * Samples for one day, resolved back to absolute instants.
 * Returns null when that day has no sidecar.
 */
export function readSeriesDay(
  athleteFilePath: string,
  quantity: string,
  source: string,
  day: string,
): Sample[] | null {
  const target = resolve(
    dirname(athleteFilePath),
    join(SERIES_DIR, `${day}-${quantity}-${source}${SERIES_SUFFIX}`),
  );
  if (!existsSync(target)) return null;

  const parsed = SeriesFile.parse(JSON.parse(readFileSync(target, "utf8")));
  const startMs = Date.parse(parsed.start);
  return parsed.offsets_ms.map((offset, i) => ({
    at: new Date(startMs + offset).toISOString(),
    value: parsed.values[i]!,
  }));
}
