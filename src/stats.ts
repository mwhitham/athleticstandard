/**
 * `ath stats` — a human-readable summary of what's in the file:
 * counts, date ranges, and current baselines with receipts (n, window, spread).
 */
import type { AthleticStandardFileT } from "./schema.js";

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

/**
 * Mean/sd of a point-measurement type over the trailing `windowDays` of data.
 *
 * `source` is required, because baselines are never pooled across devices (D31).
 * Two devices disagree by more than the day-to-day change a prediction reads:
 * against an ECG reference, nocturnal HRV error runs about 6% on an Oura Gen 4
 * and about 29% on an Apple Watch. Mixing them describes neither device.
 */
export function baselineFor(
  file: AthleticStandardFileT,
  type: string,
  source: string,
  windowDays = 90,
): Baseline | null {
  const points = file.hard_signals.filter(
    (s): s is Extract<typeof s, { recorded_at: string; value: number }> =>
      "value" in s && s.type === type && s.source === source,
  );
  if (points.length === 0) return null;
  const dated = points.map((p) => ({ point: p, t: instant(p.recorded_at) }));
  const latest = dated.reduce((a, b) => (a.t >= b.t ? a : b));
  const cutoff = latest.t - windowDays * 86400_000;
  const windowed = dated.filter((p) => p.t >= cutoff);
  const earliest = windowed.reduce((a, b) => (a.t <= b.t ? a : b));
  const values = windowed.map((p) => p.point.value);
  const m = mean(values);
  return {
    mean: Math.round(m * 10) / 10,
    sd: Math.round(sd(values, m) * 10) / 10,
    n: windowed.length,
    from: day(earliest.point.recorded_at),
    to: day(latest.point.recorded_at),
  };
}

export function renderStats(file: AthleticStandardFileT): string {
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
      .map(([type, unit]) => ({ source: src.id, type, unit, b: baselineFor(file, type, src.id) }))
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
