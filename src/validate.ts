/**
 * Semantic validation — the rules JSON Schema cannot express.
 * Schema validation says "this is shaped like an Athletic Standard file";
 * these checks say "this Athletic Standard file is internally honest."
 */
import { z } from "zod";
import {
  AthleticStandardFile,
  BenchmarkResult,
  POINT_MEASUREMENT_UNITS,
  PointMeasurement,
  SERIES_QUANTITY_UNITS,
  SeriesRef,
  SleepSession,
  VendorScore,
  WorkoutSession,
  type AthleticStandardFileT,
} from "./schema.js";

/** Calendar day of a timestamp, for keying signals to the day they belong to. */
const day = (ts: string) => ts.slice(0, 10);

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * The record shape each `type` is meant to satisfy.
 *
 * A hard signal is a union, and a union that fails gives one useless message:
 * "Invalid input", with no indication of which shape was intended or what was wrong
 * with it. This format is meant to be edited by hand and by agents, so a malformed
 * record has to explain itself. Matching on `type` first turns the union back into a
 * single schema whose errors name actual fields.
 */
const HARD_SIGNAL_SHAPES: Record<string, z.ZodType> = {
  sleep_session: SleepSession,
  workout_session: WorkoutSession,
  benchmark_result: BenchmarkResult,
  series_ref: SeriesRef,
  vendor_score: VendorScore,
};

/** Fields that only existed in the per-day series records replaced by D40. */
const RETIRED_SERIES_FIELDS = ["file", "summary", "start", "end"];

function explainHardSignal(raw: unknown, index: number): ValidationIssue[] {
  const at = `hard_signals.${index}`;
  if (raw === null || typeof raw !== "object") {
    return [{ severity: "error", path: at, message: "not an object" }];
  }

  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string") {
    return [{ severity: "error", path: `${at}.type`, message: "missing a `type`" }];
  }

  // A series record written before D40 is a known case with a concrete remedy, so
  // say so rather than listing the fields that moved.
  if (type === "series_ref") {
    const retired = RETIRED_SERIES_FIELDS.filter((f) => f in record);
    if (retired.length > 0) {
      return [
        {
          severity: "error",
          path: at,
          message:
            `series_ref carries ${retired.join(", ")}, which an earlier build wrote one ` +
            `record per day. Coverage is now one record per quantity: delete this file and ` +
            `import again, which rebuilds it from the sidecars you already have.`,
        },
      ];
    }
  }

  const shape = HARD_SIGNAL_SHAPES[type] ?? (type in POINT_MEASUREMENT_UNITS ? PointMeasurement : undefined);
  if (!shape) {
    return [
      {
        severity: "error",
        path: `${at}.type`,
        message: `unknown hard signal type '${type}'`,
      },
    ];
  }

  const parsed = shape.safeParse(raw);
  if (parsed.success) {
    return [{ severity: "error", path: at, message: `does not match any hard signal shape` }];
  }
  return parsed.error.issues.map((i) => ({
    severity: "error" as const,
    path: [at, ...i.path.map(String)].join("."),
    message: i.message,
  }));
}

/** Full validation: Zod schema first, then semantic rules on the parsed file. */
export function validateAthleticStandardFile(data: unknown): ValidationResult {
  const parsed = AthleticStandardFile.safeParse(data);
  if (!parsed.success) {
    const rawSignals =
      data !== null && typeof data === "object" && Array.isArray((data as { hard_signals?: unknown }).hard_signals)
        ? ((data as { hard_signals: unknown[] }).hard_signals)
        : [];

    const issues = parsed.error.issues.flatMap((i): ValidationIssue[] => {
      // Replace a bare union failure on a hard signal with the real reason.
      const [head, index, ...rest] = i.path;
      if (head === "hard_signals" && typeof index === "number" && rest.length === 0) {
        const explained = explainHardSignal(rawSignals[index], index);
        if (explained.length > 0) return explained;
      }
      return [{ severity: "error", path: i.path.join(".") || "root", message: i.message }];
    });

    return { valid: false, issues };
  }
  const issues = semanticIssues(parsed.data);
  return { valid: !issues.some((i) => i.severity === "error"), issues };
}

export function semanticIssues(file: AthleticStandardFileT): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) =>
    issues.push({ severity: "warning", path, message });

  const sourceIds = new Map(file.sources.map((s) => [s.id, s]));
  const benchmarkIds = new Set(file.benchmarks.map((b) => b.id));

  // --- Sources: unique ids ---
  const seenSources = new Set<string>();
  file.sources.forEach((s, i) => {
    if (seenSources.has(s.id)) err(`sources.${i}.id`, `duplicate source id '${s.id}'`);
    seenSources.add(s.id);
  });

  // --- Hard signals: source refs resolve, timestamps sane, benchmark refs resolve ---
  file.hard_signals.forEach((sig, i) => {
    const path = `hard_signals.${i}`;
    if (!sourceIds.has(sig.source)) {
      err(`${path}.source`, `unknown source '${sig.source}' — every hard signal needs provenance`);
    }
    if ("start" in sig && "end" in sig) {
      // A session that begins and ends at the same instant did not happen.
      if (Date.parse(sig.end) <= Date.parse(sig.start)) {
        err(`${path}`, `session end (${sig.end}) is not after start (${sig.start})`);
      }
    }
    if (sig.type === "benchmark_result") {
      if (!benchmarkIds.has(sig.benchmark)) {
        err(`${path}.benchmark`, `unknown benchmark '${sig.benchmark}'`);
      }
    }
    if (sig.type === "series_ref") {
      const expected = SERIES_QUANTITY_UNITS[sig.quantity];
      if (sig.unit !== expected) {
        err(`${path}.unit`, `${sig.quantity} is measured in ${expected}, not '${sig.unit}'`);
      }
      if (sig.from > sig.to) {
        err(`${path}`, `series coverage starts (${sig.from}) after it ends (${sig.to})`);
      }
      if (sig.days === 0 || sig.n === 0) {
        warn(`${path}`, `series covers no samples — nothing was imported for ${sig.quantity}`);
      }
    }
    if (sig.type === "vendor_score" && !sig.scale.trim()) {
      err(
        `${path}.scale`,
        "a vendor score needs its scale — the number is meaningless without the range it is read against",
      );
    }
  });

  // --- Derived values must cite series this file actually contains (D26) ---
  // A computed number that references evidence the file lacks cannot be audited.
  // Coverage is per quantity now (D40), so the day has to fall inside the span
  // rather than match a record of its own.
  const coverage = new Map<string, { from: string; to: string }>();
  for (const sig of file.hard_signals) {
    if (sig.type !== "series_ref") continue;
    coverage.set(`${sig.quantity}|${sig.source}`, { from: sig.from, to: sig.to });
  }
  file.hard_signals.forEach((sig, i) => {
    if (!("derived" in sig) || !sig.derived) return;
    const span = coverage.get(`${sig.derived.from}|${sig.source}`);
    const on = day(sig.recorded_at);
    if (!span || on < span.from || on > span.to) {
      err(
        `hard_signals.${i}.derived.from`,
        `derived from '${sig.derived.from}' but source '${sig.source}' has no such series ` +
          `covering ${on} — a derived value must cite evidence in the file`,
      );
    }
  });

  // --- Soft signals: photo provenance must name its interpreter ---
  file.soft_signals.forEach((sig, i) => {
    const path = `soft_signals.${i}`;
    if (sig.provenance?.via === "photo" && !sig.provenance.interpreted_by) {
      err(
        `${path}.provenance.interpreted_by`,
        "photo-derived entries must record which model interpreted them",
      );
    }
  });

  // --- Benchmarks: unique ids, score consistency ---
  const seenBenchmarks = new Set<string>();
  file.benchmarks.forEach((b, i) => {
    if (seenBenchmarks.has(b.id)) err(`benchmarks.${i}.id`, `duplicate benchmark id '${b.id}'`);
    seenBenchmarks.add(b.id);
  });

  const scoreKeyFor = { time: "duration_s", reps: "reps", load: "weight_kg" } as const;
  const benchmarkById = new Map(file.benchmarks.map((b) => [b.id, b]));

  const checkScoreMatchesBenchmark = (
    path: string,
    benchmarkId: string,
    score: Record<string, unknown>,
  ) => {
    const bench = benchmarkById.get(benchmarkId);
    if (!bench) return;
    const key = scoreKeyFor[bench.score_type];
    if (score[key] === undefined) {
      err(path, `benchmark '${benchmarkId}' is scored by ${bench.score_type}; expected ${key}`);
    }
  };

  file.hard_signals.forEach((sig, i) => {
    if (sig.type === "benchmark_result") {
      checkScoreMatchesBenchmark(`hard_signals.${i}.result`, sig.benchmark, sig.result);
    }
  });

  // --- Predictions: refs resolve, score types match, grading consistency ---
  const seenPredictions = new Set<string>();
  file.predictions.forEach((p, i) => {
    const path = `predictions.${i}`;
    if (seenPredictions.has(p.id)) err(`${path}.id`, `duplicate prediction id '${p.id}'`);
    seenPredictions.add(p.id);

    if (!benchmarkIds.has(p.benchmark)) {
      err(`${path}.benchmark`, `unknown benchmark '${p.benchmark}'`);
    } else {
      checkScoreMatchesBenchmark(`${path}.predicted`, p.benchmark, p.predicted);
      if (p.range) {
        checkScoreMatchesBenchmark(`${path}.range.low`, p.benchmark, p.range.low);
        checkScoreMatchesBenchmark(`${path}.range.high`, p.benchmark, p.range.high);
      }
      if (p.actual) {
        checkScoreMatchesBenchmark(`${path}.actual.result`, p.benchmark, p.actual.result);
      }
    }

    if (Date.parse(p.evidence_window.from) > Date.parse(p.evidence_window.to)) {
      err(`${path}.evidence_window`, "evidence_window.from is after evidence_window.to");
    }

    if (p.actual && Date.parse(p.actual.recorded_at) < Date.parse(p.created_at)) {
      err(
        `${path}.actual`,
        "actual was recorded before the prediction was made — predictions must precede attempts",
      );
    }
    if (p.grade && !p.actual) {
      err(`${path}.grade`, "a grade exists but no actual result is recorded");
    }
    if (p.miss_analysis && !p.grade) {
      err(`${path}.miss_analysis`, "a miss analysis exists but the prediction was never graded");
    }
    if (p.miss_analysis && p.miss_analysis.candidate_causes.length === 0 && !p.miss_analysis.unexplained) {
      err(
        `${path}.miss_analysis`,
        "no candidate causes and not marked unexplained — set unexplained to true when there is no cause",
      );
    }
    if (!p.reasoning.trim()) {
      warn(`${path}.reasoning`, "empty reasoning — predictions must show what they weighed");
    }
  });

  return issues;
}
