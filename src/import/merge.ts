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
  seriesWritten: BuiltSeries[];
  seriesReplaced: number;
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
 * Reused when a matching vendor and kind already exist, so importing a second
 * export from the same device does not create `apple-2` and split that device's
 * history across two baselines.
 */
export function upsertSource(file: AthleticStandardFileT, vendor: string, detail: string): string {
  const existing = file.sources.find((s) => s.vendor === vendor && s.kind === "export_file");
  if (existing) {
    existing.detail = detail;
    return existing.id;
  }

  const taken = new Set(file.sources.map((s) => s.id));
  let id = `${vendor}-1`;
  for (let n = 2; taken.has(id); n++) id = `${vendor}-${n}`;

  const source: SourceT = { id, kind: "export_file", vendor, detail };
  file.sources.push(source);
  return id;
}

/** Instant a signal belongs to: sessions are keyed on their start. */
function signalTimestamp(sig: HardSignalT): string {
  return "recorded_at" in sig ? sig.recorded_at : sig.start;
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
 * Series replace rather than accumulate: re-importing a day means a fuller export
 * has arrived for it, and appending would double the samples.
 */
export function mergePayload(
  file: AthleticStandardFileT,
  payload: ImportPayload,
): MergeSummary {
  const sourceId = upsertSource(file, payload.vendor, payload.detail);

  const added = new Map<string, number>();
  let duplicates = 0;

  const existingKeys = new Set(file.hard_signals.map(hardKey));

  // Series first: a derived value must be able to cite a series in the file (D26),
  // so the reference has to be present before the point that points at it.
  const seriesRefs = payload.series.map((s) => s.ref);
  const replacedKeys = new Set(seriesRefs.map((r) => `${r.quantity}|${r.source}|${day(r.start)}`));
  const before = file.hard_signals.length;
  file.hard_signals = file.hard_signals.filter((sig) => {
    if (sig.type !== "series_ref") return true;
    return !replacedKeys.has(`${sig.quantity}|${sig.source}|${day(sig.start)}`);
  });
  const seriesReplaced = before - file.hard_signals.length;

  for (const ref of seriesRefs) {
    file.hard_signals.push(ref);
    added.set("series_ref", (added.get("series_ref") ?? 0) + 1);
  }

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
    seriesReplaced,
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

  // Years of data means thousands of sidecars, so this reports totals per quantity
  // rather than one line per file — a summary nobody can read is not a summary.
  if (summary.seriesWritten.length > 0) {
    const byQuantity = new Map<string, { files: number; samples: number }>();
    for (const built of summary.seriesWritten) {
      const acc = byQuantity.get(built.ref.quantity) ?? { files: 0, samples: 0 };
      byQuantity.set(built.ref.quantity, {
        files: acc.files + 1,
        samples: acc.samples + built.ref.n,
      });
    }
    const totalFiles = summary.seriesWritten.length;
    lines.push(
      `  wrote ${totalFiles} series file${totalFiles === 1 ? "" : "s"} to ${SERIES_DIR}/:`,
    );
    for (const [quantity, { files, samples }] of [...byQuantity].sort()) {
      lines.push(
        `    ${quantity}: ${samples} sample${samples === 1 ? "" : "s"} across ${files} day${files === 1 ? "" : "s"}`,
      );
    }
  }
  if (summary.seriesReplaced > 0) {
    lines.push(`  replaced ${summary.seriesReplaced} previously imported series day(s)`);
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
