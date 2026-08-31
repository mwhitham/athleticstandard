/**
 * Folding an import into the athlete file.
 *
 * The rule that shapes everything here: readings from different devices are never
 * merged (D31). Every deduplication key includes the source, so three devices
 * measuring one night produce three records. Two readings sharing a timestamp are
 * not duplicates if they came from different devices — that disagreement is the
 * data, and it stays recoverable.
 */
import type {
  AthleticStandardFileT,
  HardSignalT,
  SeriesRefT,
  SoftSignalT,
  SourceT,
} from "../schema.js";
import { SERIES_DIR, type BuiltSeries } from "../series.js";

/** What an importer produces, before anything is written. */
export interface ImportPayload {
  vendor: string;
  detail: string;
  hardSignals: HardSignalT[];
  softSignals: SoftSignalT[];
  series: BuiltSeries[];
  /** Rows we would not guess at, counted rather than silently dropped. */
  skipped: Map<string, number>;
  /** One example per skip reason, so a format mismatch is readable. */
  skipExamples: Map<string, string>;
}

export interface MergeSummary {
  sourceId: string;
  added: Map<string, number>;
  duplicates: number;
  softAdded: number;
  softDuplicates: number;
  /** The day sidecars this run wrote. */
  seriesWritten: BuiltSeries[];
  /** The coverage records now in the document, spanning every day on disk. */
  coverage: SeriesRefT[];
  skipped: Map<string, number>;
  skipExamples: Map<string, string>;
}

export function emptyPayload(vendor: string, detail: string): ImportPayload {
  return {
    vendor,
    detail,
    hardSignals: [],
    softSignals: [],
    series: [],
    skipped: new Map(),
    skipExamples: new Map(),
  };
}

export function countSkip(payload: ImportPayload, reason: string, n = 1): void {
  payload.skipped.set(reason, (payload.skipped.get(reason) ?? 0) + n);
}

/**
 * Count a skip and keep one example of what was rejected.
 *
 * A bare count says a thousand rows failed; it does not say why. Showing the
 * first offending value turns a silent mismatch into something readable, which
 * matters most when a vendor changes a column format.
 */
export function countSkipWithExample(
  payload: ImportPayload,
  reason: string,
  example: string,
): void {
  countSkip(payload, reason);
  if (!payload.skipExamples.has(reason)) payload.skipExamples.set(reason, example);
}

/**
 * Find or create the source for this import.
 *
 * Reused when a matching vendor, kind, and sensor already exist, so importing a
 * second export from the same device does not create `apple-2` and split that
 * device's history across two baselines.
 *
 * `sensor` separates two sensors inside one device. An Apple Watch measures beats
 * optically all day and electrically when the wearer takes an ECG, and the two
 * disagree substantially — so they get separate sources and their baselines never
 * pool, for the same reason two different devices do not pool (D31).
 */
export function upsertSource(
  file: AthleticStandardFileT,
  vendor: string,
  detail: string,
  sensor?: string,
): string {
  const existing = file.sources.find(
    (s) => s.vendor === vendor && s.kind === "export_file" && s.sensor === sensor,
  );
  if (existing) {
    existing.detail = detail;
    return existing.id;
  }

  const stem = sensor ? `${vendor}-${sensor}` : vendor;
  const taken = new Set(file.sources.map((s) => s.id));
  let id = `${stem}-1`;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;

  const source: SourceT = {
    id,
    kind: "export_file",
    vendor,
    ...(sensor ? { sensor } : {}),
    detail,
  };
  file.sources.push(source);
  return id;
}

/**
 * Instant a signal belongs to: sessions are keyed on their start, and a series on
 * the first day it covers, since coverage records carry dates rather than instants.
 */
function signalTimestamp(sig: HardSignalT): string {
  if ("recorded_at" in sig) return sig.recorded_at;
  if (sig.type === "series_ref") return sig.from;
  return sig.start;
}

/**
 * Identity of a hard signal. The source is part of it, deliberately: this is
 * what stops two devices' readings from cancelling each other out.
 */
function hardKey(sig: HardSignalT): string {
  const base = `${sig.type}|${signalTimestamp(sig)}|${sig.source}`;
  // Two vendor scores can share a timestamp and source while measuring different
  // things — WHOOP writes recovery and strain for the same cycle.
  return sig.type === "vendor_score" ? `${base}|${sig.metric}` : base;
}

/** Soft signals have no source, so their text is what distinguishes them. */
function softKey(sig: SoftSignalT): string {
  return `${sig.type}|${sig.reported_at}|${sig.note ?? ""}`;
}

const day = (ts: string) => ts.slice(0, 10);

/**
 * Apply a payload to the file. Mutates `file` and returns what changed.
 *
 * `groupRefs` are the coverage records assembled from disk after the day sidecars
 * were written. They arrive ready-made because a group hash has to cover days from
 * earlier imports too, which only the filesystem knows about (D40).
 */
export function mergePayload(
  file: AthleticStandardFileT,
  payload: ImportPayload,
  groupRefs: SeriesRefT[] = [],
): MergeSummary {
  const sourceId = upsertSource(file, payload.vendor, payload.detail);

  const added = new Map<string, number>();
  let duplicates = 0;

  const existingKeys = new Set(file.hard_signals.map(hardKey));

  // Series coverage first: a derived value must be able to cite a series in the
  // file (D26), so the record has to be present before the point that points at it.
  // One record per quantity, so a re-import replaces it outright.
  const replaced = new Set(groupRefs.map((r) => `${r.quantity}|${r.source}`));
  file.hard_signals = file.hard_signals.filter(
    (sig) => sig.type !== "series_ref" || !replaced.has(`${sig.quantity}|${sig.source}`),
  );
  for (const ref of groupRefs) file.hard_signals.push(ref);

  for (const sig of payload.hardSignals) {
    const key = hardKey(sig);
    if (existingKeys.has(key)) {
      duplicates++;
      continue;
    }
    existingKeys.add(key);
    file.hard_signals.push(sig);
    const label = sig.type === "vendor_score" ? `vendor_score:${sig.metric}` : sig.type;
    added.set(label, (added.get(label) ?? 0) + 1);
  }

  const existingSoftKeys = new Set(file.soft_signals.map(softKey));
  let softAdded = 0;
  let softDuplicates = 0;
  for (const sig of payload.softSignals) {
    const key = softKey(sig);
    if (existingSoftKeys.has(key)) {
      softDuplicates++;
      continue;
    }
    existingSoftKeys.add(key);
    file.soft_signals.push(sig);
    softAdded++;
  }

  file.hard_signals.sort((a, b) => Date.parse(signalTimestamp(a)) - Date.parse(signalTimestamp(b)));
  file.soft_signals.sort((a, b) => Date.parse(a.reported_at) - Date.parse(b.reported_at));

  return {
    sourceId,
    added,
    duplicates,
    softAdded,
    softDuplicates,
    seriesWritten: payload.series,
    coverage: groupRefs,
    skipped: payload.skipped,
    skipExamples: payload.skipExamples,
  };
}

/** The summary printed after an import. */
export function renderMergeSummary(summary: MergeSummary, label: string): string {
  const lines: string[] = [];
  lines.push(`imported ${label} as source '${summary.sourceId}'`);

  const totalAdded = [...summary.added.values()].reduce((a, b) => a + b, 0);
  if (totalAdded === 0 && summary.softAdded === 0) {
    lines.push("  nothing new — every record was already in the file");
  }

  for (const [type, count] of [...summary.added].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type}: ${count}`);
  }
  if (summary.softAdded > 0) {
    lines.push(`  soft signals (self-reported): ${summary.softAdded}`);
  }

  // Years of data means thousands of sidecars, so the file count is one line and the
  // per-quantity detail comes from coverage — a summary nobody can read is not a
  // summary. Coverage is the more useful figure anyway: it counts every day on disk,
  // not just the days this run happened to touch.
  if (summary.seriesWritten.length > 0) {
    const written = summary.seriesWritten.length;
    lines.push(`  wrote ${written} series file${written === 1 ? "" : "s"} to ${SERIES_DIR}/`);
  }

  if (summary.coverage.length > 0) {
    lines.push(`  series coverage now recorded:`);
    for (const ref of [...summary.coverage].sort((a, b) => a.quantity.localeCompare(b.quantity))) {
      const span = ref.from === ref.to ? ref.from : `${ref.from} → ${ref.to}`;
      lines.push(
        `    ${ref.quantity}: ${ref.n} sample${ref.n === 1 ? "" : "s"} across ` +
          `${ref.days} day${ref.days === 1 ? "" : "s"} (${span})`,
      );
    }
  }

  if (summary.duplicates > 0 || summary.softDuplicates > 0) {
    lines.push(`  skipped ${summary.duplicates + summary.softDuplicates} already-present record(s)`);
  }

  const skippedTotal = [...summary.skipped.values()].reduce((a, b) => a + b, 0);
  if (skippedTotal > 0) {
    lines.push(`  skipped ${skippedTotal} row(s) we will not guess at:`);
    for (const [reason, count] of [...summary.skipped].sort((a, b) => b[1] - a[1])) {
      const example = summary.skipExamples.get(reason);
      lines.push(`    ${reason}: ${count}${example ? ` (e.g. ${example})` : ""}`);
    }
    if (totalAdded === 0) {
      lines.push(
        `  every row was skipped, which usually means a column format changed. ` +
          `Please open an issue with the examples above.`,
      );
    }
  }

  return lines.join("\n");
}
