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
  DeviceT,
  HardSignalT,
  SeriesRefT,
  SoftSignalT,
  SourceT,
} from "../schema.js";
import { SERIES_DIR, type BuiltSeries } from "../series.js";

/**
 * One device seen writing under one source, and when (D51).
 *
 * The window widens from every record the importer attributes, including samples
 * that end up in a sidecar. Widening is stable under a repeat, because the earliest
 * and latest day do not move when the same export is read twice.
 */
export interface DeviceObservation {
  source: string;
  device: DeviceT;
  /** Earliest day seen, widened as records arrive. */
  from: string;
  /** Latest day seen. */
  to: string;
  /** Document records added under this device. Counted by the merge, after dedup. */
  n: number;
}

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
  /** The device index, keyed by `deviceIndexKey`. Empty for exports naming no device. */
  deviceIndex: Map<string, DeviceObservation>;
  /**
   * Which device index entry a record belongs to, keyed by the record itself.
   * Keyed by object rather than by content so the two can never drift apart.
   */
  deviceOf: Map<HardSignalT, string>;
}

/**
 * Things this import saw for the first time (D52).
 *
 * A new writer, a new device under a writer already known, and a quantity a source
 * has never written before are the same event: something outside changed. Naming it
 * is the difference between a visible seam and a number that quietly shifts.
 */
export interface FirstAppearances {
  sources: string[];
  devices: { source: string; device: DeviceT }[];
  quantities: { source: string; quantity: string }[];
}

export interface MergeSummary {
  /** What was added, per source. One export writes under as many sources as it has writers. */
  added: Map<string, Map<string, number>>;
  /** Every source this import touched, with how it describes itself. */
  sourceDetails: Map<string, string>;
  /** What appeared for the first time in this import. */
  firstSeen: FirstAppearances;
  duplicates: number;
  softAdded: number;
  softDuplicates: number;
  /** Inline readings dropped because the same measurement is now a series. */
  movedToSeries: number;
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
    deviceIndex: new Map(),
    deviceOf: new Map(),
  };
}

/** Identity of a device index entry: the source it wrote under, and the device itself. */
export function deviceIndexKey(source: string, device: DeviceT): string {
  return [source, device.name, device.manufacturer, device.model, device.hardware].join("\u0000");
}

/**
 * Note that `device` wrote under `source` on `onDay`, widening its window.
 *
 * Called once per record rather than once per device, because the window is the
 * point: a source that is not split on hardware (D45) needs the dates to show where
 * one watch stopped and the next began.
 */
export function observeDevice(
  payload: ImportPayload,
  source: string,
  device: DeviceT,
  onDay: string,
): string {
  const key = deviceIndexKey(source, device);
  const seen = payload.deviceIndex.get(key);
  if (!seen) {
    payload.deviceIndex.set(key, { source, device, from: onDay, to: onDay, n: 0 });
    return key;
  }
  if (onDay < seen.from) seen.from = onDay;
  if (onDay > seen.to) seen.to = onDay;
  return key;
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
 * Who wrote a set of readings, and how they reached the file.
 *
 * An export file is a container. One Apple Health export carries readings from the
 * watch, the phone, a scale, a blood-pressure cuff, and any app that writes into
 * Health — including WHOOP and Oura. Each writer is its own source (D45), because
 * a baseline pooled across a watch and a scale describes neither.
 */
export interface WriterSpec {
  /** The name the export gives the writer: "Apple Watch", "WHOOP", "Withings". */
  writer: string;
  /** The route into the file: "apple_health", "whoop_csv", "oura_csv". */
  via: string;
  /** Vendor slug, for readers grouping by maker: "apple", "whoop", "withings". */
  vendor: string;
  /** A second sensor inside one device that must not pool with the first (D37). */
  sensor?: string;
  detail: string;
  /** The device behind this batch of readings, when the export names one. */
  device?: DeviceT;
}

/**
 * Hands an importer a source id for each writer it meets, creating sources in the
 * file as it goes. Importers never see the file; this is the one door.
 */
export interface SourceBook {
  /** The source for readings a named app or device wrote. */
  forWriter(spec: Omit<WriterSpec, "via" | "detail">): string;
  /** The source for readings a person typed in. */
  manual(): string;
}

/**
 * Turn a writer's name into an id stem. A leading possessive is dropped — "Alex's
 * Apple Watch" and "Apple Watch" name the same kind of thing, and a person's name
 * does not belong in an identifier.
 */
export function writerSlug(writer: string): string {
  const stripped = writer.replace(/^\S+['’]s\s+/u, "");
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unknown";
}

const sameDevice = (a: DeviceT, b: DeviceT) =>
  a.name === b.name &&
  a.manufacturer === b.manufacturer &&
  a.model === b.model &&
  a.hardware === b.hardware;

/**
 * Find or create the source for a writer.
 *
 * Matched on writer, route, and sensor — never on the device. A replaced watch that
 * keeps its name stays one source and lists both devices, because splitting on the
 * device would also split one watch whose older readings lack a device attribute,
 * which is the pooling error this exists to fix, inverted. A software update changes
 * neither the name nor the device fields kept here, so it never splits anything.
 *
 * The same writer arriving by two routes is two sources. WHOOP's copy into Apple
 * Health is a rounded subset of WHOOP's own export; pooling them would hide that.
 */
export function sourceFor(file: AthleticStandardFileT, spec: WriterSpec): string {
  const existing = file.sources.find(
    (s) =>
      s.kind === "export_file" &&
      s.writer === spec.writer &&
      s.via === spec.via &&
      s.sensor === spec.sensor,
  );
  if (existing) {
    existing.detail = spec.detail;
    return existing.id;
  }

  const stem = spec.sensor ? `${writerSlug(spec.writer)}-${spec.sensor}` : writerSlug(spec.writer);
  const source: SourceT = {
    id: freshId(file, stem),
    kind: "export_file",
    vendor: spec.vendor,
    writer: spec.writer,
    via: spec.via,
    ...(spec.sensor ? { sensor: spec.sensor } : {}),
    detail: spec.detail,
  };
  file.sources.push(source);
  return source.id;
}

/**
 * Write the device index onto the sources (D51).
 *
 * The window widens and the count adds, so importing the same export twice leaves
 * both unchanged: the days do not move, and the second run adds no records to count.
 * A new device under an existing writer appears as a new entry rather than replacing
 * the old one, which is the seam a replaced watch is supposed to leave.
 */
function applyDeviceIndex(
  file: AthleticStandardFileT,
  index: Map<string, DeviceObservation>,
): DeviceObservation[] {
  const firstSeen: DeviceObservation[] = [];
  for (const seen of index.values()) {
    const source = file.sources.find((s) => s.id === seen.source);
    if (!source) continue;
    const devices = source.devices ?? [];
    const existing = devices.find((d) => sameDevice(d, seen.device));
    if (!existing) {
      devices.push({ ...seen.device, from: seen.from, to: seen.to, n: seen.n });
      source.devices = devices;
      firstSeen.push(seen);
      continue;
    }
    // An entry already here without a window came from an import before D51, or from
    // the source being created moments ago. Either way the observed window is the
    // first thing known about it.
    existing.from = existing.from && existing.from < seen.from ? existing.from : seen.from;
    existing.to = existing.to && existing.to > seen.to ? existing.to : seen.to;
    existing.n = (existing.n ?? 0) + seen.n;
    source.devices = devices;
  }
  return firstSeen;
}

/**
 * The source for numbers a person typed in. `init` creates one; an export that
 * carries hand-entered readings reuses it rather than inventing a device.
 */
export function manualSourceFor(file: AthleticStandardFileT): string {
  const existing = file.sources.find((s) => s.kind === "manual");
  if (existing) return existing.id;
  const source: SourceT = {
    id: freshId(file, "manual"),
    kind: "manual",
    detail: "Hand-entered data",
  };
  file.sources.push(source);
  return source.id;
}

function freshId(file: AthleticStandardFileT, stem: string): string {
  const taken = new Set(file.sources.map((s) => s.id));
  let id = `${stem}-1`;
  for (let n = 2; taken.has(id); n++) id = `${stem}-${n}`;
  return id;
}

/**
 * Files written before D45 labelled every reading in an export with one source, so
 * a scale and a watch share `apple-1`. Nothing in such a file says which reading came
 * from which device — only the original export does — so it cannot be repaired in
 * place, and importing on top of it would leave the pooled history beside the
 * separated one, counted twice. The tell is an export source with no writer.
 */
export function pooledSources(file: AthleticStandardFileT): SourceT[] {
  return file.sources.filter((s) => s.kind === "export_file" && !s.writer);
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

/** What a source is writing, at the grain a reader would call a quantity (D52). */
function quantityLabel(sig: HardSignalT): string {
  if (sig.type === "vendor_score") return `${sig.source}|vendor_score:${sig.metric}`;
  if (sig.type === "series_ref") return `${sig.source}|series:${sig.quantity}`;
  return `${sig.source}|${sig.type}`;
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
  knownSources: ReadonlySet<string> = new Set(file.sources.map((s) => s.id)),
): MergeSummary {
  const added = new Map<string, Map<string, number>>();
  let duplicates = 0;

  // Snapshotted before anything is written, because the coverage records are replaced
  // a few lines down and a quantity that was already here would look new afterwards.
  const knownQuantities = new Set(file.hard_signals.map(quantityLabel));

  const existingKeys = new Set(file.hard_signals.map(hardKey));

  // Series coverage first: a derived value must be able to cite a series in the
  // file (D26), so the record has to be present before the point that points at it.
  // One record per quantity, so a re-import replaces it outright.
  const replaced = new Set(groupRefs.map((r) => `${r.quantity}|${r.source}`));
  file.hard_signals = file.hard_signals.filter(
    (sig) => sig.type !== "series_ref" || !replaced.has(`${sig.quantity}|${sig.source}`),
  );
  for (const ref of groupRefs) file.hard_signals.push(ref);

  // A measurement stored as a series keeps no copy inline (D43). Files written before
  // a measurement moved still hold the old inline readings, and leaving them would
  // count every reading twice and keep the document at its old size. The samples
  // themselves are in the sidecars, so nothing is lost — only the duplicate.
  const before = file.hard_signals.length;
  file.hard_signals = file.hard_signals.filter(
    (sig) => !("recorded_at" in sig) || !replaced.has(`${sig.type}|${sig.source}`),
  );
  const movedToSeries = before - file.hard_signals.length;

  for (const sig of payload.hardSignals) {
    const key = hardKey(sig);
    if (existingKeys.has(key)) {
      duplicates++;
      continue;
    }
    existingKeys.add(key);
    file.hard_signals.push(sig);
    // Counted here rather than at parse time, so re-importing an export the file
    // already holds leaves every device's count exactly where it was (D51).
    const deviceKey = payload.deviceOf.get(sig);
    const seen = deviceKey ? payload.deviceIndex.get(deviceKey) : undefined;
    if (seen) seen.n++;
    const label = sig.type === "vendor_score" ? `vendor_score:${sig.metric}` : sig.type;
    const bySource = added.get(sig.source) ?? new Map<string, number>();
    bySource.set(label, (bySource.get(label) ?? 0) + 1);
    added.set(sig.source, bySource);
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

  const involved = new Set([
    ...payload.hardSignals.map((s) => s.source),
    ...groupRefs.map((r) => r.source),
  ]);
  const sourceDetails = new Map(
    file.sources.filter((s) => involved.has(s.id)).map((s) => [s.id, describeSource(s)]),
  );

  const newDevices = applyDeviceIndex(file, payload.deviceIndex);
  const firstSeen: FirstAppearances = {
    sources: [...involved].filter((id) => !knownSources.has(id)).sort(),
    devices: newDevices.map(({ source, device }) => ({ source, device })),
    quantities: [...added]
      .flatMap(([source, byType]) => [...byType.keys()].map((type) => ({ source, type })))
      .concat(groupRefs.map((r) => ({ source: r.source, type: `series:${r.quantity}` })))
      .filter(({ source, type }) => !knownQuantities.has(`${source}|${type}`))
      .map(({ source, type }) => ({ source, quantity: type }))
      .sort((a, b) => `${a.source}${a.quantity}`.localeCompare(`${b.source}${b.quantity}`)),
  };

  return {
    added,
    sourceDetails,
    firstSeen,
    movedToSeries,
    duplicates,
    softAdded,
    softDuplicates,
    seriesWritten: payload.series,
    coverage: groupRefs,
    skipped: payload.skipped,
    skipExamples: payload.skipExamples,
  };
}

/** How a source introduces itself in a summary: the writer, or the kind when there is none. */
export function describeSource(source: SourceT): string {
  if (source.kind === "manual") return "typed in by hand";
  if (source.writer) {
    const sensor = source.sensor ? `, ${source.sensor}` : "";
    return `${source.writer}${sensor}`;
  }
  return source.detail ?? source.kind;
}

/** The summary printed after an import. */
export function renderMergeSummary(summary: MergeSummary, label: string): string {
  const lines: string[] = [];
  lines.push(`imported ${label}`);

  const counts = (bySource: Map<string, number> | undefined) =>
    [...(bySource ?? new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const totalAdded = [...summary.added.values()]
    .flatMap((bySource) => [...bySource.values()])
    .reduce((a, b) => a + b, 0);
  if (totalAdded === 0 && summary.softAdded === 0 && summary.seriesWritten.length === 0) {
    lines.push("  nothing new — every record was already in the file");
  }

  // Every source is named, with what wrote it. An export is a container for readings
  // from many devices and apps, and a reading filed under a name nobody was told
  // about is a reading the wearer cannot find (D45).
  const bySourceSize = [...summary.added].sort(
    (a, b) =>
      [...b[1].values()].reduce((x, y) => x + y, 0) - [...a[1].values()].reduce((x, y) => x + y, 0),
  );
  for (const [id, bySource] of bySourceSize) {
    const detail = summary.sourceDetails.get(id);
    lines.push(`  ${id}${detail ? ` (${detail})` : ""}:`);
    for (const [type, count] of counts(bySource)) lines.push(`    ${type}: ${count}`);
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
    const ordered = [...summary.coverage].sort(
      (a, b) => a.quantity.localeCompare(b.quantity) || a.source.localeCompare(b.source),
    );
    for (const ref of ordered) {
      const span = ref.from === ref.to ? ref.from : `${ref.from} → ${ref.to}`;
      lines.push(
        `    ${ref.quantity} (${ref.source}): ` +
          `${ref.n} sample${ref.n === 1 ? "" : "s"} across ` +
          `${ref.days} day${ref.days === 1 ? "" : "s"} (${span})`,
      );
    }
  }

  // First appearances are called out because they are the moments a number moves for
  // a reason outside the athlete: a new watch, a vendor renaming its writer, a route
  // that started carrying something new (D52). Folded into a total, they are invisible.
  const { sources: newSources, devices: newDevices, quantities: newQuantities } = summary.firstSeen;
  if (newSources.length > 0 || newDevices.length > 0 || newQuantities.length > 0) {
    lines.push(`  first seen in this import:`);
    for (const id of newSources) {
      lines.push(`    new source ${id} (${summary.sourceDetails.get(id) ?? "unknown writer"})`);
    }
    for (const { source, device } of newDevices) {
      const label = [device.name, device.hardware ?? device.model].filter(Boolean).join(" ");
      lines.push(`    new device under ${source}: ${label || "unnamed device"}`);
    }
    for (const { source, quantity } of newQuantities) {
      lines.push(`    ${source} has not written ${quantity} before`);
    }
  }

  if (summary.movedToSeries > 0) {
    lines.push(
      `  moved ${summary.movedToSeries} reading(s) out of the document — ` +
        `this measurement is now stored as a series`,
    );
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
