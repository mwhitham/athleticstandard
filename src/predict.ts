/**
 * `ath predict` — a prediction when a model is present, evidence when asked.
 *
 * Bare terminal: call the model you chose, print the number, ask, write (D76).
 * `--json` is evidence for a harness. Evidence alone is never a prediction.
 *
 * A harness still writes through `ath log` (D55). When the CLI itself produced
 * the number, this command writes it.
 */
import {
  ATHLETIC_STANDARD_VERSION,
  type AthleticStandardFileT,
  type BenchmarkT,
  type PredictionT,
  type ScoreT,
  type SoftSignalT,
} from "./schema.js";
import { renderCoverage, RULES } from "./coverage.js";
import { describeScore, formatDuration, hoursAndMinutes, nativeValue, scoreFromNative } from "./score.js";
import {
  RECENT_DAYS,
  type DayRow,
  type Evidence,
  type ResultHistory,
  type ResultRow,
} from "./context.js";
import { evidenceFor } from "./context.js";
import { complete } from "./gateway.js";
import { resolveModel } from "./models.js";
import { PredictRefusal } from "./predict-errors.js";
import { localTimestamp, type LogDraft } from "./log.js";
import type { GatewayName } from "./keyring.js";

export { PredictRefusal } from "./predict-errors.js";

/**
 * The benchmark being asked about, or a refusal naming the closest ones.
 *
 * An unknown name is usually a near miss — `fran` typed as `frans`, or a workout
 * logged under its date. Listing the closest few is more use than saying no.
 */
export function benchmarkOrRefuse(file: AthleticStandardFileT, id: string): BenchmarkT {
  const exact = file.benchmarks.find((b) => b.id === id);
  if (exact) return exact;

  const wanted = id.toLowerCase();
  const near = file.benchmarks
    .map((b) => ({ b, score: closeness(wanted, b.id.toLowerCase()) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.b.id);

  const withResults = new Set(
    file.hard_signals.filter((s) => s.type === "benchmark_result").map((s) => s.benchmark),
  );
  const suggestions =
    near.length > 0
      ? near
      : file.benchmarks
          .filter((b) => withResults.has(b.id))
          .slice(0, 5)
          .map((b) => b.id);

  throw new PredictRefusal(
    `no benchmark called '${id}'.` +
      (suggestions.length > 0 ? ` Closest: ${suggestions.join(", ")}.` : "") +
      ` See them all with \`ath stats\`, or log the workout with \`ath log\` to create it.`,
  );
}

/** Shared characters at the front, plus a bonus when one name contains the other. */
function closeness(a: string, b: string): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  const contains = a.includes(b) || b.includes(a) ? 3 : 0;
  return shared + contains;
}

const EVIDENCE_NOTE =
  "Evidence for a prediction, not a prediction. A harness reasons over this and writes with `ath log`.";

/** The four sections, as markdown a person and an agent both read. */
export function renderEvidence(ev: Evidence): string {
  const out: string[] = [];

  out.push(`# ${ev.benchmark.id} — evidence, not a prediction`);
  out.push("");
  out.push(
    `This is what the file holds. It is not a prediction. A prediction needs a model.`,
  );
  out.push("");
  out.push(`  benchmark   ${ev.benchmark.id} — ${ev.benchmark.kind}, scored by ${ev.benchmark.score_type}`);
  out.push(`  definition  ${ev.benchmark.definition}`);
  out.push(`  as of       ${ev.asOf} — nothing after this day is shown`);
  out.push(`  window      ${ev.from} → ${ev.asOf} for the day-by-day rows`);

  out.push("");
  out.push(`## What is missing`);
  out.push("");
  if (ev.gaps.length === 0) {
    out.push(`Nothing worth naming: the window is complete and the sources agree.`);
  } else {
    for (const gap of ev.gaps) out.push(`- ${gap}`);
  }

  out.push("");
  out.push(`## 1. ${ev.history.shown < ev.history.total ? "Recent results" : "Every result"} on this benchmark`);
  out.push("");
  out.push(...resultLines(ev.history.rows, "No result on this benchmark yet."));
  out.push(...leftOut(ev.history, "on this benchmark"));

  if (ev.related.total > 0) {
    out.push("");
    out.push(`Other ${ev.benchmark.kind} benchmarks, for shape rather than for comparison:`);
    out.push("");
    out.push(...resultLines(ev.related.rows, "", true));
    out.push(...leftOut(ev.related, `on other ${ev.benchmark.kind} benchmarks`));
  }

  out.push("");
  out.push(`## 2. The last ${RECENT_DAYS} days, day by day`);
  out.push("");
  out.push(
    `Rows, not averages. Sleep is actual sleep and time in bed, kept apart because ` +
      `they are different numbers. A reading marked \`n=\` is that day's mean over that ` +
      `many samples, with the range beside it. A vendor score is a number the vendor ` +
      `computed rather than one a sensor read, so it may corroborate a claim and cannot ` +
      `be the basis of one.`,
  );
  out.push("");
  out.push(...dayTable(ev.days));
  out.push("");
  out.push(renderCoverage(ev.coverage));

  out.push("");
  out.push(`### Self-reported, word for word`);
  out.push("");
  out.push(...softLines(ev.soft));

  out.push("");
  out.push(`## 3. Long-range averages, ${RULES.perSource}`);
  out.push("");
  if (ev.baselines.length === 0) {
    out.push(`No measurement has enough history for an average.`);
  } else {
    for (const b of ev.baselines) {
      out.push(`- **${b.source} ${b.type}: ${b.mean}${b.unit}** (sd ${b.sd})`);
      out.push(`  - ${renderCoverage(b.coverage)}`);
    }
  }

  out.push("");
  out.push(`## 4. Past predictions on this benchmark`);
  out.push("");
  if (ev.track.length === 0) {
    out.push(`None. This is the first, so there is no track record to weigh it against.`);
  } else {
    for (const t of ev.track) {
      const actual = t.actual ? describeScore(t.actual) : "not yet graded";
      out.push(`- ${t.createdAt.slice(0, 10)} predicted ${describeScore(t.predicted)}, actual ${actual}`);
      if (t.grade) {
        out.push(
          `  - ${t.grade.in_range ? "hit" : "miss"}, off by ${t.grade.abs_error_pct}% ` +
            `(${t.grade.signed_error > 0 ? "+" : ""}${t.grade.signed_error})`,
        );
      }
      out.push(`  - by ${t.by}`);
      if (t.lesson) out.push(`  - lesson: ${t.lesson}`);
    }
  }

  return out.join("\n");
}

function leftOut(history: ResultHistory, what: string): string[] {
  if (history.shown >= history.total) return [];
  return [
    "",
    `Showing the ${history.shown} most recent of ${history.total} results ${what}. ` +
      `The rest are in the file, and \`ath stats\` counts them all.`,
  ];
}

function resultLines(rows: ResultRow[], empty: string, withName = false): string[] {
  if (rows.length === 0) return empty ? [empty] : [];
  return rows.map((r) => {
    let line =
      `- ${r.recordedAt.slice(0, 10)}: ` +
      (withName ? `${r.benchmark} ` : "") +
      `**${describeScore(r.score)}**` +
      (r.scaling ? ` (${r.scaling})` : "");
    if (r.session) {
      line += ` — session ${r.session.start.slice(11, 16)} on ${r.session.source}`;
      if (r.session.avgHr !== undefined) line += `, avg ${r.session.avgHr} bpm`;
    } else {
      line += ` — no session linked`;
    }
    if (r.note) line += `\n  - note: ${r.note}`;
    return line;
  });
}

interface Cell {
  day: string;
  source: string;
  values: Map<string, string>;
  sleep: string;
  session: string;
  vendor: string;
}

function dayTable(days: DayRow[]): string[] {
  if (days.length === 0) return ["No measurements at all in this window."];

  const rows: Cell[] = [];
  const cellFor = (day: string, source: string): Cell => {
    const found = rows.find((r) => r.day === day && r.source === source);
    if (found) return found;
    const fresh: Cell = { day, source, values: new Map(), sleep: "", session: "", vendor: "" };
    rows.push(fresh);
    return fresh;
  };

  const types: string[] = [];
  for (const d of days) {
    for (const r of d.readings) {
      if (!types.includes(r.type)) types.push(r.type);
      cellFor(d.day, r.source).values.set(
        r.type,
        r.n === 1 ? `${r.value} ${r.unit}` : `${r.value} ${r.unit} (n=${r.n}, ${r.min}–${r.max})`,
      );
    }
    for (const s of d.sleep) {
      const slept = s.duration_s === undefined ? "?" : hoursAndMinutes(s.duration_s);
      const inBed = s.time_in_bed_s === undefined ? "?" : hoursAndMinutes(s.time_in_bed_s);
      const eff = s.efficiency_pct === undefined ? "" : `, ${s.efficiency_pct}%`;
      cellFor(d.day, s.source).sleep = `${slept} of ${inBed}${eff}`;
    }
    for (const s of d.sessions) {
      const parts = [
        s.start.slice(11, 16),
        s.activity ?? "session",
        s.avgHr === undefined ? "" : `avg ${s.avgHr} bpm`,
      ].filter(Boolean);
      const cell = cellFor(d.day, s.source);
      cell.session = cell.session ? `${cell.session}; ${parts.join(" ")}` : parts.join(" ");
    }
    for (const v of d.vendor) {
      const cell = cellFor(d.day, v.source);
      const text = `${v.metric} ${v.value} (${v.scale})`;
      cell.vendor = cell.vendor ? `${cell.vendor}; ${text}` : text;
    }
  }

  rows.sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));

  const columns: { head: string; get: (c: Cell) => string }[] = [
    { head: "day", get: (c) => c.day },
    { head: "source", get: (c) => c.source },
    ...types.map((t) => ({ head: t, get: (c: Cell) => c.values.get(t) ?? "" })),
  ];
  if (rows.some((r) => r.sleep)) columns.push({ head: "sleep of time in bed", get: (c) => c.sleep });
  if (rows.some((r) => r.session)) columns.push({ head: "training", get: (c) => c.session });
  if (rows.some((r) => r.vendor)) {
    columns.push({ head: "vendor score (not measured)", get: (c) => c.vendor });
  }

  const widths = columns.map((col) => Math.max(col.head.length, ...rows.map((r) => col.get(r).length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;

  return [
    line(columns.map((c) => c.head)),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map((r) => line(columns.map((c) => c.get(r)))),
  ];
}

function softLines(soft: SoftSignalT[]): string[] {
  if (soft.length === 0) return ["Nothing self-reported in this window."];
  return soft.map((s) => {
    const rating = s.rating === undefined ? "" : ` ${s.rating}/${s.scale?.split("-")[1] ?? "?"}`;
    const region = s.body_region ? ` ${s.body_region}` : "";
    return `- ${s.reported_at.slice(0, 10)} ${s.type}${region}${rating}: "${s.note ?? ""}"`;
  });
}

/** The same evidence as data, for a harness that would rather not read prose (D47, D76). */
export function evidenceAsJson(ev: Evidence): Record<string, unknown> {
  return {
    kind: "evidence",
    benchmark: ev.benchmark,
    as_of: ev.asOf,
    window: { from: ev.from, to: ev.asOf },
    gaps: ev.gaps,
    history: ev.history,
    related: ev.related,
    days: ev.days,
    coverage: ev.coverage,
    soft_signals: ev.soft,
    baselines: ev.baselines,
    track_record: ev.track,
    note: EVIDENCE_NOTE,
  };
}

export interface PredictOptions {
  asOf: string;
  /** True when `--as-of` was passed, which never writes (D76). */
  asOfPassed?: boolean;
  model?: string;
  gateway?: GatewayName;
  dryRun?: boolean;
  now?: Date;
}

export interface PlannedPrediction {
  evidence: Evidence;
  prediction: PredictionT;
  draft: LogDraft;
  gateway: GatewayName;
  model: string;
  /** False for `--as-of` and `--dry-run`. */
  canWrite: boolean;
  holdReason?: string;
}

/**
 * Call the chosen model and build a draft. The caller asks, then writes.
 */
export async function planPredict(
  file: AthleticStandardFileT,
  athletePath: string,
  benchmark: BenchmarkT,
  options: PredictOptions,
): Promise<PlannedPrediction> {
  const { gateway, model } = await resolveModel(athletePath, options.model, options.gateway);
  const evidence = evidenceFor(file, athletePath, benchmark, options.asOf);
  const prediction = await predictFromEvidence(file, evidence, {
    gateway,
    model,
    ...(options.now ? { now: options.now } : {}),
  });

  const canWrite = !options.asOfPassed && !options.dryRun;
  const planned: PlannedPrediction = {
    evidence,
    prediction,
    draft: predictionDraft(prediction),
    gateway,
    model,
    canWrite,
  };
  if (options.dryRun) planned.holdReason = "nothing written (--dry-run)";
  else if (options.asOfPassed) {
    planned.holdReason = "nothing written (--as-of). Replaying the past is `ath backtest`.";
  }
  return planned;
}

export async function predictFromEvidence(
  file: AthleticStandardFileT,
  evidence: Evidence,
  opts: { gateway: GatewayName; model: string; now?: Date },
): Promise<PredictionT> {
  const answer = await complete({
    gateway: opts.gateway,
    model: opts.model,
    system: PREDICT_SYSTEM,
    user: predictUserPrompt(evidence),
  });
  const parsed = parseModelAnswer(answer.content, evidence.benchmark.score_type);
  return buildPrediction(file, evidence, parsed, opts.model, opts.now);
}

const PREDICT_SYSTEM = `You predict one athlete's result on a named benchmark. Return only JSON.

Rules:
- The number comes from measured signals (past results, HRV, sleep duration, resting heart rate). Self-reported notes and vendor scores may change confidence and the range. They do not move the number.
- Cite dates and values in reasoning. Do not write vague trends.
- Always give a range. A thin history means a wide range and low confidence, and the reasoning must say so.
- Evidence is not a prediction. You are making the prediction.

Return:
{"value": number, "low": number, "high": number, "confidence": "low"|"moderate"|"high", "reasoning": string}

value, low, and high are in the benchmark's own unit: seconds for time, reps for reps, kilograms for load. 4:35 is 275.`;

function predictUserPrompt(ev: Evidence): string {
  return [
    `Benchmark: ${ev.benchmark.id} (${ev.benchmark.kind}, scored by ${ev.benchmark.score_type}).`,
    `Definition: ${ev.benchmark.definition}`,
    `As of ${ev.asOf}.`,
    ``,
    renderEvidence(ev),
  ].join("\n");
}

export interface ModelAnswer {
  value: number;
  low: number;
  high: number;
  confidence: "low" | "moderate" | "high";
  reasoning: string;
}

/** Read the model's JSON (or a fenced block) into numbers in the benchmark's unit. */
export function parseModelAnswer(text: string, scoreType: BenchmarkT["score_type"]): ModelAnswer {
  const raw = extractJson(text);
  if (!raw || typeof raw !== "object") {
    throw new PredictRefusal(
      `the model did not return JSON I can read, so nothing was written. ` +
        `Try again, or pick another model with --model.`,
    );
  }
  const rec = raw as Record<string, unknown>;
  const value = readAmount(rec.value, scoreType, "value");
  let low = rec.low === undefined ? value : readAmount(rec.low, scoreType, "low");
  let high = rec.high === undefined ? value : readAmount(rec.high, scoreType, "high");
  if (low > high) [low, high] = [high, low];
  const confidence = readConfidence(rec.confidence);
  const reasoning = typeof rec.reasoning === "string" ? rec.reasoning.trim() : "";
  if (reasoning === "") {
    throw new PredictRefusal(`the model returned no reasoning, so nothing was written.`);
  }
  return { value, low, high, confidence, reasoning };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function readAmount(value: unknown, scoreType: BenchmarkT["score_type"], field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const clock = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
    if (clock && scoreType === "time") {
      return clock[3] === undefined
        ? Number(clock[1]) * 60 + Number(clock[2])
        : Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    }
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  throw new PredictRefusal(`the model returned no usable ${field}, so nothing was written.`);
}

function readConfidence(value: unknown): "low" | "moderate" | "high" {
  if (value === "low" || value === "moderate" || value === "high") return value;
  return "moderate";
}

export function buildPrediction(
  file: AthleticStandardFileT,
  evidence: Evidence,
  answer: ModelAnswer,
  model: string,
  now: Date = new Date(),
): PredictionT {
  const kind = evidence.benchmark.score_type;
  const predicted = scoreFromNative(answer.value, kind);
  const range = { low: scoreFromNative(answer.low, kind), high: scoreFromNative(answer.high, kind) };
  return {
    id: predictionId(file, evidence.benchmark.id, evidence.asOf),
    benchmark: evidence.benchmark.id,
    created_at: localTimestamp(now),
    predicted,
    range,
    confidence: answer.confidence,
    reasoning: answer.reasoning,
    evidence_window: { from: evidence.from, to: evidence.asOf },
    model,
    agent: "ath predict",
    ath_version: ATHLETIC_STANDARD_VERSION,
    actual: null,
    grade: null,
    miss_analysis: null,
  };
}

function predictionId(file: AthleticStandardFileT, benchmark: string, day: string): string {
  const base = `ath-p-${benchmark}-${day}`;
  if (!file.predictions.some((p) => p.id === base)) return base;
  let n = 2;
  while (file.predictions.some((p) => p.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export function predictionDraft(prediction: PredictionT): LogDraft {
  return {
    hard: [],
    soft: [],
    predictions: [prediction],
    newBenchmarks: [],
    candidates: [],
    chosenCandidate: -1,
    blocks: [
      [
        { label: "kind", value: "prediction" },
        { label: "benchmark", value: prediction.benchmark },
        { label: "predicted", value: describeScore(prediction.predicted) },
        { label: "range", value: describeRange(prediction) },
        { label: "confidence", value: prediction.confidence },
        { label: "by", value: `${prediction.agent} running ${prediction.model}` },
        { label: "ath", value: prediction.ath_version ?? ATHLETIC_STANDARD_VERSION },
      ],
    ],
  };
}

function describeRange(prediction: PredictionT): string {
  if (!prediction.range) return "(none)";
  return `${describeScore(prediction.range.low)}–${describeScore(prediction.range.high)}`;
}

export function renderPrediction(plan: PlannedPrediction): string {
  const p = plan.prediction;
  const out = [
    `# ${p.benchmark} — prediction`,
    ``,
    `  predicted   ${describeScore(p.predicted)}`,
    `  range       ${describeRange(p)}`,
    `  confidence  ${p.confidence}`,
    `  model       ${plan.model}`,
    `  gateway     ${plan.gateway}`,
    ``,
    p.reasoning,
    ``,
    `Evidence this prediction used:`,
    ``,
    renderEvidence(plan.evidence),
  ];
  return out.join("\n");
}

export function predictionAsJson(plan: PlannedPrediction): Record<string, unknown> {
  return {
    kind: "prediction",
    prediction: plan.prediction,
    gateway: plan.gateway,
    model: plan.model,
    evidence: evidenceAsJson(plan.evidence),
  };
}

/** Native value of a score, for tests and tables. */
export function scoreAmount(score: ScoreT, scoreType: BenchmarkT["score_type"]): number | undefined {
  return nativeValue(score, scoreType);
}

export function formatScore(score: ScoreT, scoreType: BenchmarkT["score_type"]): string {
  const value = nativeValue(score, scoreType);
  if (value === undefined) return describeScore(score);
  if (scoreType === "time") return formatDuration(value);
  if (scoreType === "reps") return `${value} reps`;
  return `${value} kg`;
}
