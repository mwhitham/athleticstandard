/**
 * Shared CSV helpers for the WHOOP and Oura importers.
 *
 * Both vendors ship flat daily-summary tables with human-readable headers that
 * change wording between export versions, so column lookup is tolerant of case,
 * spacing, and punctuation while still requiring an exact conceptual match. A
 * column we do not recognize is never guessed at.
 */
import Papa from "papaparse";

export type Row = Record<string, string>;

/** Lowercase, collapse punctuation and spacing, so "Max HR (bpm)" matches "max_hr_bpm". */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[()%]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function parseCsv(text: string): Row[] {
  const parsed = Papa.parse<Row>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });
  return parsed.data.filter((r) => r && Object.keys(r).length > 0);
}

/** First present value among candidate column names. */
export function cell(row: Row, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined && value.trim() !== "") return value.trim();
  }
  return undefined;
}

/** A finite number from a cell, or undefined. Blank cells are normal in these exports. */
export function num(row: Row, ...names: string[]): number | undefined {
  const raw = cell(row, ...names);
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** A positive number, for measurements where zero means "not recorded". */
export function positive(row: Row, ...names: string[]): number | undefined {
  const n = num(row, ...names);
  return n !== undefined && n > 0 ? n : undefined;
}

/**
 * Combine a local timestamp with a UTC offset into ISO 8601.
 *
 * WHOOP writes local times in one column and the offset in another; storing the
 * local time alone would be a naive timestamp, which this format does not allow.
 */
export function withOffset(local: string | undefined, offset: string | undefined): string | null {
  if (!local) return null;

  const trimmed = local.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed);
  if (!iso) return null;
  const [, y, mo, d, h, mi, s = "00"] = iso;

  // Already carries an offset or Z: keep what the vendor wrote.
  const existing = /([+-]\d{2}:?\d{2}|Z)$/.exec(trimmed);
  if (existing) {
    const raw = existing[1]!;
    const normalized = raw === "Z" ? "Z" : raw.includes(":") ? raw : `${raw.slice(0, 3)}:${raw.slice(3)}`;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${normalized}`;
  }

  const normalizedOffset = normalizeOffset(offset);
  if (!normalizedOffset) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${normalizedOffset}`;
}

/**
 * Normalize the several ways an export can spell a UTC offset.
 *
 * WHOOP's `Cycle timezone` column writes `UTC-07:00`. Bare offsets and a plain
 * `Z` also appear, so all of them are accepted; the prefix carries no extra
 * meaning. Anything else returns null rather than being guessed at.
 */
export function normalizeOffset(offset: string | undefined): string | null {
  if (!offset) return null;

  const trimmed = offset.trim();
  if (trimmed === "Z" || /^(UTC|GMT)$/i.test(trimmed)) return "Z";

  // Strip a leading UTC/GMT, which is decoration around the offset itself.
  // WHOOP writes plain `UTCZ` for the occasional row it recorded in UTC, which
  // shows up around daylight-saving transitions.
  const bare = trimmed.replace(/^(UTC|GMT)\s*/i, "");
  if (bare === "" || bare === "Z" || bare === "z" || /^[+-]00:?00$/.test(bare)) return "Z";

  const m = /^([+-])(\d{1,2}):?(\d{2})$/.exec(bare);
  if (!m) return null;
  return `${m[1]}${m[2]!.padStart(2, "0")}:${m[3]}`;
}

/** Minutes to whole seconds, for vendors that report sleep stages in minutes. */
export function minutesToSeconds(minutes: number | undefined): number | undefined {
  return minutes === undefined ? undefined : Math.round(minutes * 60);
}
