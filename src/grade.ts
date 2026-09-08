/**
 * `ath grade` — steps 1 and 2 of the grading procedure in
 * [v0.1.0 §6](../build-history/v0.1.0/spec.md), which are the deterministic ones.
 *
 * The tool matches the attempt to the open prediction, measures the error, and
 * classifies it. A hit prints one line and stops, because analysing a hit invites a
 * story told after the fact. A miss prints the dossier: the raw material an agent
 * needs for step 3, and nothing already chewed into a conclusion.
 *
 * Step 3 is the agent's, and it comes back through `--analysis`. Every cause it
 * names is checked against the file before it is written, because a rule a tool can
 * enforce should not live in a skill (D46, D62).
 */
import {
  MissAnalysis,
  type AthleticStandardFileT,
  type BenchmarkT,
  type HardSignalT,
  type PredictionT,
  type ScoreT,
  type SoftSignalT,
} from "./schema.js";
import { readingsFor } from "./readings.js";
import {
  amountIn,
  CLOCK_ONLY,
  formatDuration,
  hoursAndMinutes,
  kilosFromLoad,
  LOAD_ONLY,
  nativeValue,
  SCORE_KEY,
  secondsFromClock,
} from "./score.js";
import { manualSource, shiftDay, signalAt, TRACKED_TYPES } from "./signals.js";
import { localTimestamp, noonOn, today } from "./log.js";

/** Raised when the file cannot be graded, with the remedy in the message. */
export class GradeRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GradeRefusal";
  }
}

/** How far a day's mean must sit from the baseline before it is worth naming. */
const ANOMALY_SDS = 1.5;

export type Severity = "hit" | "minor" | "significant" | "severe";

export interface Anomaly {
  source: string;
  type: string;
  unit: string;
  day: string;
  /** That day's mean. */
  value: number;
  mean: number;
  sd: number;
  /** How many standard deviations out, signed. */
  sds: number;
}

export interface Dossier {
  /** Everything self-reported in the 72 hours before the attempt. */
  soft: SoftSignalT[];
  /** The day's own measurements, and the night before it. */
  dayOf: HardSignalT[];
  /** Days in the last week whose mean sat far from that source's own baseline. */
  anomalies: Anomaly[];
}

export interface GradeOutcome {
  benchmark: BenchmarkT;
  /** The result that was logged, whether or not a prediction was open. */
  result: Extract<HardSignalT, { type: "benchmark_result" }>;
  actualText: string;
  /** Null when nothing was open, in which case the result is simply logged. */
  prediction: PredictionT | null;
  severity: Severity | null;
  /** How the error reads in the benchmark's own unit, e.g. "3s" or "12 reps". */
  errorText: string;
  /** Present on a miss. A hit gets no dossier, on purpose. */
  dossier: Dossier | null;
  /** Sessions that day the result is not linked to yet. */
  unlinkedSessions: string[];
}

/**
 * Read `--actual` in the benchmark's own unit.
 *
 * The score type is known, so nothing is guessed — except for a bare number under a
 * time or a load, where the reading would change the answer. `4:32` and `272s` are
 * both four and a half minutes; `272` alone could be either seconds or minutes, and
 * `100` could be kilos or pounds. Those are refused with both readings named, the
 * same way an ambiguous date is (D56).
 */
export function parseActual(text: string, scoreType: BenchmarkT["score_type"]): { score: ScoreT; text: string } {
  const flat = text.trim();

  if (scoreType === "time") {
    const clock = CLOCK_ONLY.exec(flat);
    if (clock) {
      const duration_s = secondsFromClock(clock);
      if (duration_s > 0) return { score: { duration_s }, text: formatDuration(duration_s) };
    }
    const seconds = /^(\d{1,5})\s*s(?:ec|ecs|econds)?$/i.exec(flat);
    if (seconds && Number(seconds[1]) > 0) {
      const duration_s = Number(seconds[1]);
      return { score: { duration_s }, text: formatDuration(duration_s) };
    }
    throw new GradeRefusal(
      `'${flat}' is not a time. Write it as a clock — \`4:32\`, or \`1:02:30\` past an hour — ` +
        `or in seconds with the unit, \`272s\`.`,
    );
  }

  if (scoreType === "reps") {
    const reps = /^(\d{1,5})(?:\s*reps?)?$/i.exec(flat);
    if (reps && Number(reps[1]) > 0) {
      return { score: { reps: Number(reps[1]) }, text: `${Number(reps[1])} reps` };
    }
    throw new GradeRefusal(`'${flat}' is not a rep count. Write it as \`245\` or \`245 reps\`.`);
  }

  const load = LOAD_ONLY.exec(flat);
  if (load) {
    const weight_kg = kilosFromLoad(load);
    if (weight_kg > 0) return { score: { weight_kg }, text: `${weight_kg} kg` };
  }
  throw new GradeRefusal(
    `'${flat}' has no unit, and a load without one is two different numbers. ` +
      `Write it as \`100kg\` or \`225lb\`.`,
  );
}

/** The score in the benchmark's native unit: seconds, reps, or kilos. */
function native(score: ScoreT, scoreType: BenchmarkT["score_type"]): number {
  const value = nativeValue(score, scoreType);
  if (value === undefined) {
    throw new GradeRefusal(`that score has no ${SCORE_KEY[scoreType]}, which this benchmark is scored by.`);
  }
  return value;
}

function describe(score: ScoreT, scoreType: BenchmarkT["score_type"]): string {
  const value = native(score, scoreType);
  if (scoreType === "time") return formatDuration(value);
  if (scoreType === "reps") return `${value} reps`;
  return `${value} kg`;
}

/**
 * Grade the attempt, writing the result and the grade into the file.
 *
 * The caller validates and saves, the same way `ath log` works — one write path, one
 * place the file is checked before it lands (D55).
 */
export function gradeAttempt(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  benchmark: BenchmarkT,
  actualText: string,
  options: { date?: string | undefined; scaling?: "rx" | "scaled" | undefined; now?: Date | undefined } = {},
): GradeOutcome {
  const now = options.now ?? new Date();
  const day = options.date ?? today(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new GradeRefusal(`--date takes a day written as YYYY-MM-DD, not '${day}'.`);
  }
  const recordedAt = day === today(now) ? localTimestamp(now) : noonOn(day);

  const { score, text } = parseActual(actualText, benchmark.score_type);

  const result: Extract<HardSignalT, { type: "benchmark_result" }> = {
    type: "benchmark_result",
    benchmark: benchmark.id,
    recorded_at: recordedAt,
    source: manualSource(file),
    result: score,
    ...(options.scaling ? { scaling: options.scaling } : {}),
  };
  file.hard_signals.push(result);
  file.hard_signals.sort((a, b) => Date.parse(signalAt(a)) - Date.parse(signalAt(b)));

  const unlinkedSessions = file.hard_signals
    .filter(
      (s): s is Extract<HardSignalT, { type: "workout_session" }> =>
        s.type === "workout_session" && s.start.slice(0, 10) === day,
    )
    .map((s) => `${s.start.slice(11, 16)} on ${s.source}`);

  // The most recent prediction still waiting on a result. Nothing open means there
  // was no claim to be right or wrong about, so the result is logged and that is all.
  const open = file.predictions
    .filter((p) => p.benchmark === benchmark.id && p.grade === null)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .pop();

  if (!open) {
    return {
      benchmark,
      result,
      actualText: text,
      prediction: null,
      severity: null,
      errorText: "",
      dossier: null,
      unlinkedSessions,
    };
  }

  if (Date.parse(recordedAt) < Date.parse(open.created_at)) {
    file.hard_signals.splice(file.hard_signals.indexOf(result), 1);
    throw new GradeRefusal(
      `that attempt is dated ${day}, before the prediction was made on ` +
        `${open.created_at.slice(0, 10)}. A prediction has to come first, or it is not one. ` +
        `Check --date.`,
    );
  }

  const actual = native(score, benchmark.score_type);
  const predicted = native(open.predicted, benchmark.score_type);
  const signed = Math.round((predicted - actual) * 100) / 100;
  const absPct = Math.round((Math.abs(signed) / actual) * 1000) / 10;

  // No stated range means no hit (D61). A prediction that claimed no uncertainty
  // cannot claim the result landed inside it, so it is graded on error alone.
  const inRange =
    open.range !== undefined &&
    actual >= native(open.range.low, benchmark.score_type) &&
    actual <= native(open.range.high, benchmark.score_type);

  open.actual = { result: score, recorded_at: recordedAt };
  open.grade = { signed_error: signed, abs_error_pct: absPct, in_range: inRange };

  const severity: Severity = inRange ? "hit" : absPct < 5 ? "minor" : absPct <= 15 ? "significant" : "severe";

  return {
    benchmark,
    result,
    actualText: text,
    prediction: open,
    severity,
    errorText: amountIn(Math.abs(signed), benchmark.score_type),
    dossier: severity === "hit" ? null : buildDossier(file, athleteFilePath, recordedAt),
    unlinkedSessions,
  };
}

/**
 * The raw material for a miss analysis, in the order v0.1.0 §6 puts it: the day's
 * own measurements first because they are the most trusted, then what was
 * self-reported in the 72 hours before, then the week's anomalies.
 *
 * Nothing here is interpreted. A dossier that named a cause would be doing the
 * agent's job with none of the agent's context.
 */
function buildDossier(file: AthleticStandardFileT, athleteFilePath: string, attemptAt: string): Dossier {
  const attempt = Date.parse(attemptAt);
  const day = attemptAt.slice(0, 10);

  const soft = file.soft_signals
    .filter((s) => {
      const at = Date.parse(s.reported_at);
      return at <= attempt && at >= attempt - 72 * 3_600_000;
    })
    .sort((a, b) => Date.parse(a.reported_at) - Date.parse(b.reported_at));

  const dayOf = file.hard_signals
    .filter((s) => {
      if (s.type === "benchmark_result" || s.type === "series_ref") return false;
      if (s.type === "sleep_session") return s.end.slice(0, 10) === day;
      if (s.type === "workout_session") return s.start.slice(0, 10) === day;
      return s.recorded_at.slice(0, 10) === day && Date.parse(s.recorded_at) <= attempt;
    })
    .sort((a, b) => Date.parse(signalAt(a)) - Date.parse(signalAt(b)));

  return { soft, dayOf, anomalies: weekAnomalies(file, athleteFilePath, day) };
}

/**
 * Days in the last week whose mean sat far from that source's own baseline.
 *
 * The day's mean is compared against the mean and spread of daily means over the 90
 * days before it, so like is compared with like (D63). Comparing one night's
 * thousands of samples against the spread of individual samples would answer a
 * different question and answer it with a much wider spread.
 */
function weekAnomalies(file: AthleticStandardFileT, athleteFilePath: string, day: string): Anomaly[] {
  const found: Anomaly[] = [];
  const weekFrom = shiftDay(day, -6);
  const baselineFrom = shiftDay(day, -90);

  for (const source of file.sources.map((s) => s.id)) {
    for (const type of TRACKED_TYPES) {
      const readings = readingsFor(file, athleteFilePath, type, source, { from: baselineFrom, to: day });
      if (readings.length === 0) continue;

      const perDay = new Map<string, number[]>();
      for (const r of readings) {
        const d = r.at.slice(0, 10);
        perDay.set(d, [...(perDay.get(d) ?? []), r.value]);
      }
      const means = [...perDay.entries()].map(([d, values]) => ({
        day: d,
        mean: values.reduce((a, b) => a + b, 0) / values.length,
      }));
      if (means.length < 5) continue;

      const mean = means.reduce((a, b) => a + b.mean, 0) / means.length;
      const sd = Math.sqrt(
        means.reduce((a, b) => a + (b.mean - mean) ** 2, 0) / (means.length - 1),
      );
      if (sd === 0) continue;

      for (const m of means) {
        if (m.day < weekFrom) continue;
        const sds = (m.mean - mean) / sd;
        if (Math.abs(sds) <= ANOMALY_SDS) continue;
        found.push({
          source,
          type,
          unit: readings[0]!.unit,
          day: m.day,
          value: Math.round(m.mean * 10) / 10,
          mean: Math.round(mean * 10) / 10,
          sd: Math.round(sd * 10) / 10,
          sds: Math.round(sds * 10) / 10,
        });
      }
    }
  }

  return found.sort((a, b) => Math.abs(b.sds) - Math.abs(a.sds));
}

// ---------------------------------------------------------------------------
// The output
// ---------------------------------------------------------------------------

export function renderGrade(outcome: GradeOutcome): string {
  const lines: string[] = [];
  const kind = outcome.benchmark.score_type;

  if (!outcome.prediction) {
    lines.push(`logged ${outcome.actualText} on '${outcome.benchmark.id}'.`);
    lines.push(`No prediction was open for it, so there is nothing to grade.`);
    lines.push(...sessionHint(outcome));
    return lines.join("\n");
  }

  const p = outcome.prediction;
  const grade = p.grade!;
  const range = p.range
    ? `${describe(p.range.low, kind)}–${describe(p.range.high, kind)}`
    : null;

  const direction = grade.signed_error === 0 ? "exactly" : grade.signed_error > 0 ? "faster" : "slower";
  lines.push(
    `Predicted ${describe(p.predicted, kind)}, actual ${outcome.actualText} — ` +
      `off by ${outcome.errorText} (${grade.abs_error_pct}%), ${direction === "exactly" ? "exactly right" : direction + " than predicted"}.`,
  );
  lines.push(
    outcome.severity === "hit"
      ? `Inside the stated range of ${range}. Hit.`
      : range
        ? `Outside the stated range of ${range}. A ${outcome.severity} miss.`
        : `No range was stated, so this is graded on the error alone. A ${outcome.severity} miss.`,
  );
  lines.push(...sessionHint(outcome));

  if (!outcome.dossier) return lines.join("\n");

  const d = outcome.dossier;
  lines.push("");
  lines.push(`## The miss dossier`);
  lines.push("");
  lines.push(
    `Raw material, in the order it should be weighed: the day's own measurements ` +
      `first, then what was self-reported in the 72 hours before, then the week's ` +
      `unusual days. Nothing here is a cause until an agent shows it is one.`,
  );

  lines.push("");
  lines.push(`### The day of the attempt`);
  lines.push("");
  if (d.dayOf.length === 0) lines.push(`Nothing measured that day.`);
  for (const sig of d.dayOf) lines.push(`- ${describeSignal(sig)}`);

  lines.push("");
  lines.push(`### Self-reported in the 72 hours before`);
  lines.push("");
  if (d.soft.length === 0) lines.push(`Nothing self-reported in that window.`);
  for (const s of d.soft) {
    const rating = s.rating === undefined ? "" : ` ${s.rating}/${s.scale?.split("-")[1] ?? "?"}`;
    const region = s.body_region ? ` ${s.body_region}` : "";
    lines.push(`- ${s.reported_at.slice(0, 10)} ${s.type}${region}${rating}: "${s.note ?? ""}"`);
  }

  lines.push("");
  lines.push(`### Unusual days in the last week`);
  lines.push("");
  lines.push(
    `A day's mean more than ${ANOMALY_SDS} standard deviations from the mean of daily ` +
      `means over the 90 days before, for that source alone.`,
  );
  lines.push("");
  if (d.anomalies.length === 0) lines.push(`None. Every day sat inside the usual spread.`);
  for (const a of d.anomalies) {
    lines.push(
      `- ${a.day} ${a.source} ${a.type}: ${a.value}${a.unit} against a baseline of ` +
        `${a.mean}${a.unit} (sd ${a.sd}) — ${a.sds > 0 ? "+" : ""}${a.sds} standard deviations`,
    );
  }

  lines.push("");
  lines.push(
    `Write the analysis back with \`ath grade ${outcome.benchmark.id} --analysis '<json>'\`. ` +
      `Every cause it names has to reference a signal in this file, and where nothing ` +
      `explains the miss, set unexplained to true rather than inventing one.`,
  );

  return lines.join("\n");
}

function sessionHint(outcome: GradeOutcome): string[] {
  if (outcome.result.session || outcome.unlinkedSessions.length === 0) return [];
  return [
    `A device session that day is not linked to this result: ` +
      `${outcome.unlinkedSessions.join(", ")}. Attach it with ` +
      `\`ath link ${outcome.benchmark.id}@${outcome.result.recorded_at.slice(0, 10)} ` +
      `${outcome.unlinkedSessions[0]!.slice(0, 5)}\`.`,
  ];
}

function describeSignal(sig: HardSignalT): string {
  if (sig.type === "sleep_session") {
    const a = sig.aggregates;
    const hm = (s?: number) => (s === undefined ? "?" : hoursAndMinutes(s));
    return (
      `${sig.source} sleep: ${hm(a.duration_s)} actual sleep of ${hm(a.time_in_bed_s)} in bed` +
      (a.efficiency_pct === undefined ? "" : `, ${a.efficiency_pct}% efficiency`) +
      ` (ended ${sig.end.slice(11, 16)})`
    );
  }
  if (sig.type === "workout_session") {
    const a = sig.aggregates;
    return (
      `${sig.source} ${a.activity ?? "session"} ${sig.start.slice(11, 16)}–${sig.end.slice(11, 16)}` +
      (a.avg_hr_bpm === undefined ? "" : `, avg ${a.avg_hr_bpm} bpm`)
    );
  }
  if (sig.type === "vendor_score") {
    return `${sig.source} ${sig.metric}: ${sig.value} on ${sig.scale} (vendor-computed, not a measurement)`;
  }
  if ("value" in sig && "unit" in sig) {
    return `${sig.source} ${sig.type}: ${sig.value} ${sig.unit} at ${sig.recorded_at.slice(11, 16)}`;
  }
  return `${sig.source} ${sig.type}`;
}

export function gradeAsJson(outcome: GradeOutcome): Record<string, unknown> {
  return {
    benchmark: outcome.benchmark.id,
    score_type: outcome.benchmark.score_type,
    result: outcome.result,
    prediction: outcome.prediction,
    severity: outcome.severity,
    dossier: outcome.dossier,
    unlinked_sessions: outcome.unlinkedSessions,
  };
}

// ---------------------------------------------------------------------------
// Step 3: the analysis coming back
// ---------------------------------------------------------------------------

export interface AnalysisOutcome {
  prediction: PredictionT;
  causes: number;
  unexplained: boolean;
}

/**
 * Attach an agent's miss analysis to the graded prediction.
 *
 * One rule is enforced here rather than asked for: every candidate cause must point
 * at a signal that exists in the file, by tier, type and day. An invented cause is
 * the failure this step is most prone to, and a tool can check it (D46, D62).
 */
export function attachAnalysis(
  file: AthleticStandardFileT,
  benchmark: BenchmarkT,
  json: string,
): AnalysisOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new GradeRefusal(`--analysis is not valid JSON: ${(e as Error).message}`);
  }

  const analysis = MissAnalysis.safeParse(parsed);
  if (!analysis.success) {
    throw new GradeRefusal(
      `that analysis does not fit the format, so nothing was written:\n` +
        analysis.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
    );
  }

  const graded = file.predictions
    .filter((p) => p.benchmark === benchmark.id && p.grade !== null)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .pop();
  if (!graded) {
    throw new GradeRefusal(
      `no graded prediction on '${benchmark.id}'. Grade the attempt first with ` +
        `\`ath grade ${benchmark.id} --actual <score>\`.`,
    );
  }
  if (graded.grade!.in_range) {
    throw new GradeRefusal(
      `the last prediction on '${benchmark.id}' was a hit, and hits are not analysed. ` +
        `Explaining a result that landed where it was meant to is a story told afterwards.`,
    );
  }

  for (const [i, cause] of analysis.data.candidate_causes.entries()) {
    if (!signalExists(file, cause.signal)) {
      throw new GradeRefusal(
        `candidate_causes.${i} names a ${cause.signal.tier} ${cause.signal.type} on ` +
          `${cause.signal.date}, and this file has no such record. Every cause has to ` +
          `reference a signal in the file. Where nothing explains the miss, set ` +
          `unexplained to true instead.`,
      );
    }
  }

  graded.miss_analysis = analysis.data;
  return {
    prediction: graded,
    causes: analysis.data.candidate_causes.length,
    unexplained: analysis.data.unexplained,
  };
}

/**
 * Whether the file holds a signal of that tier, type and day.
 *
 * A night of sleep starts on one day and ends on the next, and a reference to either
 * day names the same night. So a session matches on any day it covers, rather than
 * on the day its start happens to fall in.
 */
function signalExists(
  file: AthleticStandardFileT,
  ref: { tier: "hard" | "soft"; type: string; date: string },
): boolean {
  if (ref.tier === "soft") {
    return file.soft_signals.some((s) => s.type === ref.type && s.reported_at.slice(0, 10) === ref.date);
  }
  return file.hard_signals.some((s) => {
    if (s.type !== ref.type) return false;
    if (s.type === "series_ref") return ref.date >= s.from && ref.date <= s.to;
    if ("start" in s && "end" in s) {
      return ref.date >= s.start.slice(0, 10) && ref.date <= s.end.slice(0, 10);
    }
    return signalAt(s).slice(0, 10) === ref.date;
  });
}

export function analysisAsJson(outcome: AnalysisOutcome): Record<string, unknown> {
  return {
    prediction: outcome.prediction.id,
    benchmark: outcome.prediction.benchmark,
    miss_analysis: outcome.prediction.miss_analysis,
  };
}