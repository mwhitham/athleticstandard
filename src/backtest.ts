/**
 * `ath backtest` — replay history with a model, write a report, not the athlete
 * file (D77).
 *
 * A result is replayed only when an earlier result on the same benchmark exists
 * (D10). Evidence is as of the day before (D69). Grade math is the same as
 * `ath grade`.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ATHLETIC_STANDARD_VERSION,
  type AthleticStandardFileT,
  type BenchmarkT,
  type GradeT,
  type HardSignalT,
  type ScoreT,
} from "./schema.js";
import { evidenceFor } from "./context.js";
import { scorePrediction } from "./grade.js";
import { type GatewayName } from "./keyring.js";
import { loadCatalog, requireOnList, resolveModel } from "./models.js";
import { predictFromEvidence } from "./predict.js";
import { PredictRefusal } from "./predict-errors.js";
import { describeScore } from "./score.js";
import { dayBefore, dayOf } from "./signals.js";
import { localTimestamp } from "./log.js";

export type ResultSignal = Extract<HardSignalT, { type: "benchmark_result" }>;

export interface ReplayRow {
  model: string;
  benchmark: string;
  as_of: string;
  recorded_at: string;
  actual: ScoreT;
  predicted?: ScoreT;
  range?: { low: ScoreT; high: ScoreT };
  grade?: GradeT;
  history_depth: number;
  error?: string;
}

export interface DepthBucket {
  n: number;
  median_abs_error_pct: number | null;
}

export interface ModelSummary {
  model: string;
  n: number;
  n_failed: number;
  median_abs_error_pct: number | null;
  mean_abs_error_pct: number | null;
  in_range_rate: number | null;
  in_range: number;
  by_history_depth: {
    "1": DepthBucket;
    "2-3": DepthBucket;
    "4+": DepthBucket;
  };
}

export interface BacktestSummary {
  n_replayed: number;
  n_skipped: number;
  models: ModelSummary[];
  winner: string | null;
}

export interface BacktestReport {
  athleticstandard_version: string;
  created_at: string;
  gateway: GatewayName;
  models: string[];
  replays: ReplayRow[];
  summary: BacktestSummary;
}

export interface BacktestOptions {
  models?: string[];
  all?: boolean;
  gateway?: GatewayName;
  now?: Date;
}

export interface PlannedBacktest {
  targets: ResultSignal[];
  skipped: number;
  models: string[];
  gateway: GatewayName;
}

/**
 * Results that can be replayed: each has at least one earlier result on the
 * same benchmark (D10).
 */
export function replayableResults(file: AthleticStandardFileT): {
  targets: ResultSignal[];
  skipped: number;
} {
  const results = file.hard_signals
    .filter((s): s is ResultSignal => s.type === "benchmark_result")
    .slice()
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));

  const seen = new Map<string, number>();
  const targets: ResultSignal[] = [];
  let skipped = 0;
  for (const result of results) {
    const prior = seen.get(result.benchmark) ?? 0;
    if (prior === 0) skipped++;
    else targets.push(result);
    seen.set(result.benchmark, prior + 1);
  }
  return { targets, skipped };
}

export function historyDepth(file: AthleticStandardFileT, result: ResultSignal): number {
  const day = dayOf(result.recorded_at);
  return file.hard_signals.filter(
    (s): s is ResultSignal =>
      s.type === "benchmark_result" &&
      s.benchmark === result.benchmark &&
      dayOf(s.recorded_at) < day,
  ).length;
}

export async function planBacktest(
  file: AthleticStandardFileT,
  athletePath: string,
  options: BacktestOptions,
): Promise<PlannedBacktest> {
  const { targets, skipped } = replayableResults(file);
  if (targets.length === 0) {
    throw new PredictRefusal(
      `nothing to replay. A result is replayed only when an earlier result on the ` +
        `same benchmark exists. Log a second attempt, or import a history that has one.`,
    );
  }

  let models: string[];
  let gateway: GatewayName;
  if (options.all) {
    const catalog = await loadCatalog(options.gateway);
    gateway = catalog.gateway;
    models = catalog.models.map((m) => m.id);
    if (models.length === 0) {
      throw new PredictRefusal(
        `the ${gateway} catalog marked no text models that can reason, so there is nothing to run.`,
      );
    }
  } else if (options.models && options.models.length > 0) {
    const catalog = await loadCatalog(options.gateway);
    gateway = catalog.gateway;
    models = options.models.map((id) => requireOnList(id, catalog.models));
  } else {
    const resolved = await resolveModel(athletePath, undefined, options.gateway);
    gateway = resolved.gateway;
    models = [resolved.model];
  }

  return { targets, skipped, models, gateway };
}

export async function runBacktest(
  file: AthleticStandardFileT,
  athletePath: string,
  plan: PlannedBacktest,
  now: Date = new Date(),
): Promise<BacktestReport> {
  const replays: ReplayRow[] = [];
  const byId = new Map(file.benchmarks.map((b) => [b.id, b]));

  for (const model of plan.models) {
    for (const result of plan.targets) {
      const benchmark = byId.get(result.benchmark);
      if (!benchmark) continue;
      const asOf = dayBefore(dayOf(result.recorded_at), 1);
      const depth = historyDepth(file, result);
      try {
        const evidence = evidenceFor(file, athletePath, benchmark, asOf);
        const prediction = await predictFromEvidence(file, evidence, {
          gateway: plan.gateway,
          model,
          now,
        });
        const grade = scorePrediction(
          prediction.predicted,
          result.result,
          benchmark.score_type,
          prediction.range,
        );
        const row: ReplayRow = {
          model,
          benchmark: result.benchmark,
          as_of: asOf,
          recorded_at: result.recorded_at,
          actual: result.result,
          predicted: prediction.predicted,
          grade,
          history_depth: depth,
        };
        if (prediction.range) row.range = prediction.range;
        replays.push(row);
      } catch (e) {
        replays.push({
          model,
          benchmark: result.benchmark,
          as_of: asOf,
          recorded_at: result.recorded_at,
          actual: result.result,
          history_depth: depth,
          error: (e as Error).message,
        });
      }
    }
  }

  const summary = summarise(replays, plan.models, plan.targets.length, plan.skipped);
  return {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    created_at: localTimestamp(now),
    gateway: plan.gateway,
    models: plan.models,
    replays,
    summary,
  };
}

export function summarise(
  replays: ReplayRow[],
  models: string[],
  nReplayed: number,
  nSkipped: number,
): BacktestSummary {
  const rows = models.map((model) => summariseModel(model, replays.filter((r) => r.model === model)));
  return {
    n_replayed: nReplayed,
    n_skipped: nSkipped,
    models: rows,
    winner: pickWinner(rows),
  };
}

function summariseModel(model: string, rows: ReplayRow[]): ModelSummary {
  const graded = rows.filter((r) => r.grade);
  const errors = graded.map((r) => r.grade!.abs_error_pct);
  const inRange = graded.filter((r) => r.grade!.in_range).length;
  return {
    model,
    n: graded.length,
    n_failed: rows.length - graded.length,
    median_abs_error_pct: median(errors),
    mean_abs_error_pct: mean(errors),
    in_range_rate: graded.length === 0 ? null : Math.round((inRange / graded.length) * 1000) / 1000,
    in_range: inRange,
    by_history_depth: {
      "1": bucket(graded, (d) => d === 1),
      "2-3": bucket(graded, (d) => d >= 2 && d <= 3),
      "4+": bucket(graded, (d) => d >= 4),
    },
  };
}

function bucket(rows: ReplayRow[], take: (depth: number) => boolean): DepthBucket {
  const errors = rows.filter((r) => take(r.history_depth) && r.grade).map((r) => r.grade!.abs_error_pct);
  return { n: errors.length, median_abs_error_pct: median(errors) };
}

function pickWinner(rows: ModelSummary[]): string | null {
  const ranked = rows
    .filter((r) => r.n > 0 && r.median_abs_error_pct !== null)
    .slice()
    .sort((a, b) => {
      const med = (a.median_abs_error_pct ?? Infinity) - (b.median_abs_error_pct ?? Infinity);
      if (med !== 0) return med;
      const avg = (a.mean_abs_error_pct ?? Infinity) - (b.mean_abs_error_pct ?? Infinity);
      if (avg !== 0) return avg;
      return b.n - a.n;
    });
  return ranked[0]?.model ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.round(raw * 10) / 10;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function reportFilename(now: Date): string {
  const stamp = localTimestamp(now).replace(/[:.]/g, "").replace(/([+-]\d{4})$/, "");
  const day = stamp.slice(0, 10);
  const time = stamp.slice(11, 17);
  return `backtest-${day}T${time}.json`;
}

export function writeReport(athletePath: string, report: BacktestReport, now: Date): string {
  const path = join(dirname(athletePath), reportFilename(now));
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path;
}

export function renderReport(report: BacktestReport, path: string): string {
  const lines = [
    `replayed ${report.summary.n_replayed} results` +
      (report.summary.n_skipped > 0
        ? ` (${report.summary.n_skipped} skipped: first-ever result, nothing to anchor to)`
        : ""),
    ``,
  ];

  const cols = [
    { head: "model", get: (m: ModelSummary) => m.model },
    { head: "n", get: (m: ModelSummary) => String(m.n) },
    { head: "median", get: (m: ModelSummary) => pct(m.median_abs_error_pct) },
    { head: "mean", get: (m: ModelSummary) => pct(m.mean_abs_error_pct) },
    { head: "in-range", get: (m: ModelSummary) => (m.n === 0 ? "—" : `${m.in_range}/${m.n}`) },
    { head: "1 prior", get: (m: ModelSummary) => pct(m.by_history_depth["1"].median_abs_error_pct) },
    { head: "2-3", get: (m: ModelSummary) => pct(m.by_history_depth["2-3"].median_abs_error_pct) },
    { head: "4+", get: (m: ModelSummary) => pct(m.by_history_depth["4+"].median_abs_error_pct) },
  ];
  const widths = cols.map((c) => Math.max(c.head.length, ...report.summary.models.map((m) => c.get(m).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  lines.push(line(cols.map((c) => c.head)));
  lines.push(line(widths.map((w) => "-".repeat(w))));
  for (const row of report.summary.models) lines.push(line(cols.map((c) => c.get(row))));

  lines.push("");
  lines.push(
    report.summary.winner
      ? `winner on this file: ${report.summary.winner}`
      : `no winner — no model returned a graded prediction`,
  );
  lines.push(`wrote ${path}`);
  return lines.join("\n");
}

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

export function describeReplay(row: ReplayRow, benchmark: BenchmarkT): string {
  if (row.error) return `${row.benchmark} ${row.as_of}: failed — ${row.error}`;
  return `${row.benchmark} ${row.as_of}: predicted ${row.predicted ? describeScore(row.predicted) : "?"} vs ${describeScore(row.actual)} (${benchmark.score_type})`;
}
