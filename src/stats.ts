/**
 * `ath stats` — a human-readable summary of what's in the file:
 * counts, date ranges, and current baselines with receipts (n, window, spread).
 */
import type { AthleticStandardFileT } from "./schema.js";
import { latestReadingDay, readingsFor } from "./readings.js";

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
  from: string;
  to: string;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs: number[], m: number): number {
  if (xs.length < 2) return 0;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

const day = (ts: string) => ts.slice(0, 10);

/** Instant in milliseconds. Offset timestamps cannot be ordered as strings. */
const instant = (ts: string): number => Date.parse(ts);

/** Calendar day `days` before `d`. */
function dayBefore(d: string, days: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) - days * 86400_000).toISOString().slice(0, 10);
}

/**
 * Mean/sd of a measurement over the trailing `windowDays` of data.
 *
 * `source` is required, because baselines are never pooled across devices (D31).
 * Two devices disagree by more than the day-to-day change a prediction reads:
 * against an ECG reference, nocturnal HRV error runs about 6% on an Oura Gen 4
 * and about 29% on an Apple Watch. Mixing them describes neither device.
 *
 * Readings are fetched through one interface whether the device wrote a nightly
 * figure into the document or a night of samples into a sidecar (D43). The window is
 * bounded before anything is opened, so a 90-day baseline reads 90 days of files and
 * not eleven years of them.
 */
export function baselineFor(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  type: string,
  source: string,
  windowDays = 90,
): Baseline | null {
  const latestDay = latestReadingDay(file, athleteFilePath, type, source);
  if (latestDay === null) return null;

  // A day wider than the window at each end, because a day is not an instant: the
  // exact cutoff is applied below, once the readings carry their own timestamps.
  const readings = readingsFor(file, athleteFilePath, type, source, {
    from: dayBefore(latestDay, windowDays + 1),
    to: latestDay,
  });
  if (readings.length === 0) return null;

  const latest = readings.reduce((a, b) => (instant(a.at) >= instant(b.at) ? a : b));
  const cutoff = instant(latest.at) - windowDays * 86400_000;
  const windowed = readings.filter((r) => instant(r.at) >= cutoff);
  const earliest = windowed.reduce((a, b) => (instant(a.at) <= instant(b.at) ? a : b));
  const values = windowed.map((r) => r.value);
  const m = mean(values);
  return {
    mean: Math.round(m * 10) / 10,
    sd: Math.round(sd(values, m) * 10) / 10,
    n: windowed.length,
    from: day(earliest.at),
    to: day(latest.at),
  };
}

/**
 * The days each source covers, computed rather than stored (D51).
 *
 * Every hard signal names its source and every coverage record carries its own
 * dates, so this is already in the file. Storing a copy would be a second thing to
 * keep true. The per-device windows are stored because nothing can recover those.
 */
export function sourceWindows(
  file: AthleticStandardFileT,
): Map<string, { from: string; to: string; n: number }> {
  const windows = new Map<string, { from: string; to: string; n: number }>();
  for (const sig of file.hard_signals) {
    const [first, last] =
      sig.type === "series_ref"
        ? [sig.from, sig.to]
        : "recorded_at" in sig
          ? [day(sig.recorded_at), day(sig.recorded_at)]
          : [day(sig.start), day(sig.end)];
    const seen = windows.get(sig.source);
    if (!seen) {
      windows.set(sig.source, { from: first, to: last, n: 1 });
      continue;
    }
    if (first < seen.from) seen.from = first;
    if (last > seen.to) seen.to = last;
    seen.n++;
  }
  return windows;
}

export function renderStats(file: AthleticStandardFileT, athleteFilePath: string): string {
  const lines: string[] = [];
  const name = file.athlete.name ?? "unnamed athlete";

  // A series coverage record carries dates rather than instants, and it spans a
  // range, so both ends count toward the file's overall window.
  const timestamps = [
    ...file.hard_signals.flatMap((s) => {
      if ("recorded_at" in s) return [s.recorded_at];
      if (s.type === "series_ref") return [s.from, s.to];
      return [s.start];
    }),
    ...file.soft_signals.map((s) => s.reported_at),
  ].sort((a, b) => instant(a) - instant(b));
  const range =
    timestamps.length > 0
      ? `${day(timestamps[0]!)} → ${day(timestamps[timestamps.length - 1]!)}`
      : "empty";

  lines.push(`${name} · ${range}`);
  lines.push("");

  const hardByType = new Map<string, number>();
  for (const s of file.hard_signals) hardByType.set(s.type, (hardByType.get(s.type) ?? 0) + 1);
  const softByType = new Map<string, number>();
  for (const s of file.soft_signals) softByType.set(s.type, (softByType.get(s.type) ?? 0) + 1);

  lines.push(`hard signals: ${file.hard_signals.length}`);
  for (const [type, count] of [...hardByType].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push(`soft signals: ${file.soft_signals.length}`);
  for (const [type, count] of [...softByType].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push("");

  // Every source, with what wrote it. An export is a container; the writer is the
  // device or app behind the readings, and a reader asking "watch versus ring" needs
  // to know which id is which (D45).
  const readingsBySource = new Map<string, number>();
  for (const s of file.hard_signals) {
    readingsBySource.set(s.source, (readingsBySource.get(s.source) ?? 0) + 1);
  }
  const windows = sourceWindows(file);
  lines.push(`sources: ${file.sources.length}`);
  for (const src of file.sources) {
    const what =
      src.kind === "manual"
        ? "typed in by hand"
        : [src.writer, src.sensor, src.via ? `via ${src.via}` : undefined]
            .filter(Boolean)
            .join(", ") || (src.detail ?? src.kind);
    const n = readingsBySource.get(src.id) ?? 0;
    const window = windows.get(src.id);
    lines.push(
      `  ${src.id}: ${what} — ${n} record${n === 1 ? "" : "s"}` +
        (window ? `, ${window.from} → ${window.to}` : ""),
    );
    // What the source is made of (D51). A replaced watch keeps the same name, so the
    // windows are the only place the change is visible.
    for (const device of src.devices ?? []) {
      const label = [device.name, device.hardware ?? device.model].filter(Boolean).join(" ");
      const wrote = device.n === undefined ? "" : ` — ${device.n} record${device.n === 1 ? "" : "s"}`;
      const when = device.from && device.to ? `, ${device.from} → ${device.to}` : "";
      lines.push(`    ${label || "unnamed device"}${wrote}${when}`);
    }
  }
  lines.push("");

  // Baselines are listed per source, never pooled (D31). A reader comparing two
  // devices should see two numbers and decide, not one number hiding a disagreement.
  const baselineTypes: [string, string][] = [
    ["hrv_rmssd", "ms"],
    ["hrv_sdnn", "ms"],
    ["resting_heart_rate", "bpm"],
    ["respiratory_rate", "brpm"],
  ];
  const baselineRows = file.sources.flatMap((src) =>
    baselineTypes
      .map(([type, unit]) => ({
        source: src.id,
        type,
        unit,
        b: baselineFor(file, athleteFilePath, type, src.id),
      }))
      .filter((x) => x.b !== null),
  );
  if (baselineRows.length > 0) {
    lines.push("90-day baselines (per source — never pooled across devices):");
    for (const { source, type, unit, b } of baselineRows) {
      lines.push(
        `  ${source} ${type}: ${b!.mean}${unit} (n=${b!.n}, ${b!.from} → ${b!.to}, sd ${b!.sd})`,
      );
    }
    lines.push("");
  }

  const seriesRefs = file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "series_ref" }> => s.type === "series_ref",
  );
  if (seriesRefs.length > 0) {
    lines.push("sample series (stored alongside the file):");
    for (const s of [...seriesRefs].sort((a, b) =>
      `${a.source} ${a.quantity}`.localeCompare(`${b.source} ${b.quantity}`),
    )) {
      lines.push(
        `  ${s.source} ${s.quantity}: ${s.n} sample${s.n === 1 ? "" : "s"} across ` +
          `${s.days} day${s.days === 1 ? "" : "s"} (${s.from} → ${s.to})`,
      );
    }
    lines.push(`  read them with \`ath series <quantity>\``);
    lines.push("");
  }

  // Vendor scores are listed apart from measurements on purpose (D27): they are
  // composites a vendor computed, not something a sensor read.
  const vendorScores = file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "vendor_score" }> => s.type === "vendor_score",
  );
  if (vendorScores.length > 0) {
    const byMetric = new Map<string, number>();
    for (const s of vendorScores) {
      const key = `${s.source} ${s.metric} (${s.scale})`;
      byMetric.set(key, (byMetric.get(key) ?? 0) + 1);
    }
    lines.push("vendor scores (vendor-computed, not measurements):");
    for (const [key, count] of [...byMetric].sort()) {
      lines.push(`  ${key}: ${count}`);
    }
    lines.push("");
  }

  const results = file.hard_signals.filter((s) => s.type === "benchmark_result");
  lines.push(`benchmarks defined: ${file.benchmarks.length} · results recorded: ${results.length}`);
  const byBenchmark = new Map<string, number>();
  for (const r of results) {
    if (r.type === "benchmark_result") {
      byBenchmark.set(r.benchmark, (byBenchmark.get(r.benchmark) ?? 0) + 1);
    }
  }
  for (const [id, count] of [...byBenchmark].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${id}: ${count} result${count === 1 ? "" : "s"}`);
  }

  const graded = file.predictions.filter((p) => p.grade !== null);
  lines.push(
    `predictions: ${file.predictions.length} recorded · ${graded.length} graded`,
  );

  return lines.join("\n");
}
