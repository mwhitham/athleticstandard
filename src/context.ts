/**
 * The evidence a prediction rests on, assembled from the file.
 *
 * The worry this is built against: hand a model a tidy summary and it repeats the
 * summary without reading anything. So the package always carries actual rows, and
 * every summary carries the count, the window and the spread it came from — which
 * means the reader can check a summary against the rows where the two overlap.
 *
 * Four sections, unchanged from [v0.1.0 §5](../build-history/v0.1.0/spec.md):
 * the benchmark's own history, the recent window row by row, long-range averages
 * with their receipts, and the track record of past predictions on this benchmark.
 */
import type {
  AthleticStandardFileT,
  BenchmarkT,
  HardSignalT,
  PredictionT,
  ScoreT,
  SoftSignalT,
} from "./schema.js";
import { readingsFor } from "./readings.js";
import { baselineFor } from "./stats.js";
import { daysBetween, type Coverage } from "./coverage.js";
import { dayBefore, TRACKED_TYPES } from "./signals.js";

/** How far back the row-by-row window reaches. */
export const RECENT_DAYS = 28;

export interface ResultRow {
  benchmark: string;
  recordedAt: string;
  score: ScoreT;
  scaling?: "rx" | "scaled" | undefined;
  note?: string | undefined;
  /** The session it was recorded in, when it has one (D48). */
  session?: { source: string; start: string; avgHr?: number | undefined } | undefined;
}

export interface DayReading {
  source: string;
  type: string;
  unit: string;
  /** The reading, or the day's mean when the device wrote a stream. */
  value: number;
  /** How many readings that day. One means the value is the reading itself. */
  n: number;
  min?: number;
  max?: number;
}

export interface DayRow {
  day: string;
  readings: DayReading[];
  sleep: {
    source: string;
    duration_s?: number | undefined;
    time_in_bed_s?: number | undefined;
    efficiency_pct?: number | undefined;
  }[];
  sessions: { source: string; start: string; end: string; activity?: string; avgHr?: number }[];
}

export interface BaselineRow {
  source: string;
  type: string;
  unit: string;
  mean: number;
  sd: number;
  coverage: Coverage;
}

export interface TrackRow {
  id: string;
  createdAt: string;
  predicted: ScoreT;
  actual: ScoreT | null;
  grade: PredictionT["grade"];
  lesson: string | null;
}

export interface Evidence {
  benchmark: BenchmarkT;
  /** Everything after this day is hidden, which is what makes a backtest honest. */
  asOf: string;
  from: string;
  history: ResultRow[];
  related: ResultRow[];
  days: DayRow[];
  soft: SoftSignalT[];
  baselines: BaselineRow[];
  track: TrackRow[];
  /** What is missing or disagreeing, named rather than left to be noticed. */
  gaps: string[];
}

const day = (ts: string) => ts.slice(0, 10);

/** The workout session a result names, if the file still holds it. */
function sessionOf(
  file: AthleticStandardFileT,
  result: Extract<HardSignalT, { type: "benchmark_result" }>,
): ResultRow["session"] {
  if (!result.session) return undefined;
  const match = file.hard_signals.find(
    (s): s is Extract<HardSignalT, { type: "workout_session" }> =>
      s.type === "workout_session" &&
      s.source === result.session!.source &&
      s.start === result.session!.start,
  );
  return {
    source: result.session.source,
    start: result.session.start,
    avgHr: match?.aggregates.avg_hr_bpm,
  };
}

function toRow(file: AthleticStandardFileT, r: Extract<HardSignalT, { type: "benchmark_result" }>): ResultRow {
  return {
    benchmark: r.benchmark,
    recordedAt: r.recorded_at,
    score: r.result,
    scaling: r.scaling,
    note: r.note,
    session: sessionOf(file, r),
  };
}

/**
 * Assemble the evidence for one benchmark.
 *
 * `asOf` hides everything after that day, including results, readings and
 * predictions. A backtest that can see the answer is not a test.
 */
export function evidenceFor(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  benchmark: BenchmarkT,
  asOf: string,
): Evidence {
  const from = dayBefore(asOf, RECENT_DAYS - 1);
  const upTo = (ts: string) => day(ts) <= asOf;

  const allResults = file.hard_signals.filter(
    (s): s is Extract<HardSignalT, { type: "benchmark_result" }> =>
      s.type === "benchmark_result" && upTo(s.recorded_at),
  );

  const history = allResults
    .filter((r) => r.benchmark === benchmark.id)
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map((r) => toRow(file, r));

  const sameKind = new Set(
    file.benchmarks.filter((b) => b.kind === benchmark.kind && b.id !== benchmark.id).map((b) => b.id),
  );
  const related = allResults
    .filter((r) => sameKind.has(r.benchmark))
    .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    .map((r) => toRow(file, r));

  // --- Section 2: the recent window, row by row ---
  const sources = file.sources.map((s) => s.id);
  const byDay = new Map<string, DayRow>();
  const rowFor = (d: string): DayRow => {
    const existing = byDay.get(d);
    if (existing) return existing;
    const fresh: DayRow = { day: d, readings: [], sleep: [], sessions: [] };
    byDay.set(d, fresh);
    return fresh;
  };

  for (const source of sources) {
    for (const type of TRACKED_TYPES) {
      const readings = readingsFor(file, athleteFilePath, type, source, { from, to: asOf });
      if (readings.length === 0) continue;
      const grouped = new Map<string, typeof readings>();
      for (const r of readings) grouped.set(day(r.at), [...(grouped.get(day(r.at)) ?? []), r]);
      for (const [d, group] of grouped) {
        const values = group.map((r) => r.value);
        // A device that samples through the night writes hundreds of readings for one
        // measurement. The day's mean carries its count and spread so it can still be
        // checked, rather than printing a night of samples as though it were evidence.
        const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
        rowFor(d).readings.push({
          source,
          type,
          unit: group[0]!.unit,
          value: mean,
          n: values.length,
          ...(values.length > 1 ? { min: Math.min(...values), max: Math.max(...values) } : {}),
        });
      }
    }
  }

  for (const sig of file.hard_signals) {
    if (sig.type === "sleep_session" && day(sig.end) >= from && day(sig.end) <= asOf) {
      rowFor(day(sig.end)).sleep.push({
        source: sig.source,
        duration_s: sig.aggregates.duration_s,
        time_in_bed_s: sig.aggregates.time_in_bed_s,
        efficiency_pct: sig.aggregates.efficiency_pct,
      });
    }
    if (sig.type === "workout_session" && day(sig.start) >= from && day(sig.start) <= asOf) {
      rowFor(day(sig.start)).sessions.push({
        source: sig.source,
        start: sig.start,
        end: sig.end,
        ...(sig.aggregates.activity ? { activity: sig.aggregates.activity } : {}),
        ...(sig.aggregates.avg_hr_bpm ? { avgHr: sig.aggregates.avg_hr_bpm } : {}),
      });
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const soft = file.soft_signals
    .filter((s) => day(s.reported_at) >= from && day(s.reported_at) <= asOf)
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at));

  // --- Section 3: long-range averages, per source and never pooled (D31) ---
  // One baseline function, given a day to stop at. `--as-of` hides readings; it does
  // not change how the mean is worked out (D69).
  const baselines: BaselineRow[] = [];
  for (const source of sources) {
    for (const type of TRACKED_TYPES) {
      const b = baselineFor(file, athleteFilePath, type, source, { asOf });
      if (b) baselines.push({ source, type, unit: unitOf(file, type, source), ...b });
    }
  }

  // --- Section 4: the track record on this benchmark ---
  const track: TrackRow[] = file.predictions
    .filter((p) => p.benchmark === benchmark.id && day(p.created_at) <= asOf)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      predicted: p.predicted,
      actual: p.actual?.result ?? null,
      grade: p.grade,
      lesson: p.miss_analysis?.lesson ?? null,
    }));

  return {
    benchmark,
    asOf,
    from,
    history,
    related,
    days,
    soft,
    baselines,
    track,
    gaps: namedGaps({ from, asOf, days, history, baselines }),
  };
}

function unitOf(file: AthleticStandardFileT, type: string, source: string): string {
  const point = file.hard_signals.find(
    (s): s is Extract<HardSignalT, { value: number; unit: string }> =>
      "unit" in s && s.type === type && s.source === source,
  );
  if (point) return point.unit;
  const series = file.hard_signals.find(
    (s): s is Extract<HardSignalT, { type: "series_ref" }> =>
      s.type === "series_ref" && s.quantity === type && s.source === source,
  );
  return series?.unit ?? "";
}

/**
 * What is missing, said out loud.
 *
 * An agent that has to notice a gap will sometimes not notice it. Three are worth
 * naming every time: days with nothing recorded, a benchmark with too little history
 * to extrapolate from, and two devices giving different answers for one measurement.
 */
function namedGaps(input: {
  from: string;
  asOf: string;
  days: DayRow[];
  history: ResultRow[];
  baselines: BaselineRow[];
}): string[] {
  const gaps: string[] = [];

  const expected = daysBetween(input.from, input.asOf);
  const withData = new Set(input.days.filter((d) => d.readings.length > 0 || d.sleep.length > 0).map((d) => d.day));
  if (withData.size < expected) {
    const missing = expected - withData.size;
    gaps.push(
      `${missing} of the ${expected} days from ${input.from} to ${input.asOf} have no measurements at all.`,
    );
  }

  if (input.history.length === 0) {
    gaps.push(`No prior result on this benchmark. There is nothing here to extrapolate from.`);
  } else if (input.history.length === 1) {
    gaps.push(
      `Only one prior result on this benchmark (${day(input.history[0]!.recordedAt)}). ` +
        `A single point has no trend and no spread.`,
    );
  }

  // Two devices measuring one quantity is two answers. Naming the disagreement is
  // the honest move; picking one for the reader is not (D31).
  const byType = new Map<string, BaselineRow[]>();
  for (const b of input.baselines) byType.set(b.type, [...(byType.get(b.type) ?? []), b]);
  for (const [type, rows] of byType) {
    if (rows.length < 2) continue;
    const low = rows.reduce((a, b) => (a.mean <= b.mean ? a : b));
    const high = rows.reduce((a, b) => (a.mean >= b.mean ? a : b));
    const spread = high.mean - low.mean;
    const tolerance = Math.max(low.sd, high.sd, Math.abs(low.mean) * 0.05);
    if (spread > tolerance) {
      gaps.push(
        `${rows.length} sources measure ${type} and they disagree: ` +
          rows.map((r) => `${r.source} ${r.mean}${r.unit}`).join(", ") +
          `. They are never pooled, so pick the one you mean.`,
      );
    }
  }

  return gaps;
}
