/**
 * Semantic validation — the rules JSON Schema cannot express.
 * Schema validation says "this is shaped like an Athletic Standard file";
 * these checks say "this Athletic Standard file is internally honest."
 */
import { AthleticStandardFile, type AthleticStandardFileT } from "./schema.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Full validation: Zod schema first, then semantic rules on the parsed file. */
export function validateAthleticStandardFile(data: unknown): ValidationResult {
  const parsed = AthleticStandardFile.safeParse(data);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map((i) => ({
        severity: "error" as const,
        path: i.path.join("."),
        message: i.message,
      })),
    };
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
      if (Date.parse(sig.end) <= Date.parse(sig.start)) {
        err(`${path}`, `session end (${sig.end}) is not after start (${sig.start})`);
      }
    }
    if (sig.type === "benchmark_result") {
      if (!benchmarkIds.has(sig.benchmark)) {
        err(`${path}.benchmark`, `unknown benchmark '${sig.benchmark}'`);
      }
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
        "no candidate causes and not marked unexplained — an honest 'unexplained' beats a missing story",
      );
    }
    if (!p.reasoning.trim()) {
      warn(`${path}.reasoning`, "empty reasoning — predictions must show what they weighed");
    }
  });

  return issues;
}
