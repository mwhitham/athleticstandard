import { describe, expect, it } from "vitest";
import { AthleticStandardFile, ATHLETIC_STANDARD_VERSION, Score, type AthleticStandardFileT } from "../src/schema.js";
import { validateAthleticStandardFile } from "../src/validate.js";

function minimalFile(): AthleticStandardFileT {
  return {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    athlete: { name: "Test Athlete", birth_year: 1990, sex: "male", units: "metric" },
    sources: [
      { id: "whoop-1", kind: "wearable", vendor: "whoop", detail: "WHOOP 4.0 via CSV export" },
      { id: "manual-1", kind: "manual" },
    ],
    hard_signals: [
      {
        type: "hrv_rmssd",
        value: 62,
        unit: "ms",
        recorded_at: "2026-08-09T06:12:00Z",
        source: "whoop-1",
      },
      {
        type: "sleep_session",
        start: "2026-08-08T22:30:00Z",
        end: "2026-08-09T06:00:00Z",
        source: "whoop-1",
        aggregates: { duration_s: 26100, efficiency_pct: 89, deep_s: 5400, rem_s: 6300 },
      },
      {
        type: "benchmark_result",
        benchmark: "fran",
        recorded_at: "2026-08-09T17:30:00Z",
        source: "manual-1",
        result: { duration_s: 281 },
        scaling: "rx",
      },
    ],
    soft_signals: [
      {
        type: "sleep_quality",
        reported_at: "2026-08-09T07:00:00Z",
        rating: 2,
        scale: "1-5",
        note: "neighbor's dog, maybe 5 hours",
        provenance: { via: "text" },
      },
    ],
    benchmarks: [
      {
        id: "fran",
        kind: "named_wod",
        score_type: "time",
        definition: "21-15-9 reps for time: thrusters 95/65 lb, pull-ups",
      },
    ],
    predictions: [
      {
        id: "pred-2026-08-09-fran",
        benchmark: "fran",
        created_at: "2026-08-09T15:00:00Z",
        predicted: { duration_s: 275 },
        range: { low: { duration_s: 265 }, high: { duration_s: 290 } },
        confidence: "moderate",
        reasoning: "Last Fran 4:41 on 2026-06-02. HRV 61-66ms all week vs 63ms baseline.",
        evidence_window: { from: "2026-06-01", to: "2026-08-09" },
        model: "claude-sonnet-4-5",
        actual: null,
        grade: null,
        miss_analysis: null,
      },
    ],
  };
}

describe("schema: happy path", () => {
  it("accepts a well-formed file", () => {
    const result = validateAthleticStandardFile(minimalFile());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("the two-tier wall", () => {
  it("rejects a hard signal without a source (schema level)", () => {
    const file: Record<string, unknown> = minimalFile();
    (file.hard_signals as Record<string, unknown>[])[0] = {
      type: "hrv_rmssd",
      value: 62,
      unit: "ms",
      recorded_at: "2026-08-09T06:12:00Z",
      // source omitted
    };
    expect(AthleticStandardFile.safeParse(file).success).toBe(false);
  });

  it("rejects a soft signal that claims a device source (strict object)", () => {
    const file: Record<string, unknown> = minimalFile();
    (file.soft_signals as Record<string, unknown>[]).push({
      type: "stress",
      reported_at: "2026-08-09T07:00:00Z",
      rating: 3,
      scale: "1-5",
      source: "whoop-1", // soft signals have no source field — must fail
    });
    expect(AthleticStandardFile.safeParse(file).success).toBe(false);
  });

  it("rejects a self-reported feeling smuggled into hard_signals", () => {
    const file: Record<string, unknown> = minimalFile();
    (file.hard_signals as Record<string, unknown>[]).push({
      type: "mood", // not a hard signal type
      value: 3,
      unit: "1-5",
      recorded_at: "2026-08-09T07:00:00Z",
      source: "manual-1",
    });
    expect(AthleticStandardFile.safeParse(file).success).toBe(false);
  });

  it("rejects a hard signal with the wrong canonical unit", () => {
    const file: Record<string, unknown> = minimalFile();
    (file.hard_signals as Record<string, unknown>[])[0] = {
      type: "hrv_rmssd",
      value: 0.062,
      unit: "s", // must be ms
      recorded_at: "2026-08-09T06:12:00Z",
      source: "whoop-1",
    };
    expect(AthleticStandardFile.safeParse(file).success).toBe(false);
  });

  it("requires a scale when a soft signal carries a rating", () => {
    const file = minimalFile();
    file.soft_signals[0] = { type: "mood", reported_at: "2026-08-09T07:00:00Z", rating: 4 };
    expect(AthleticStandardFile.safeParse(file).success).toBe(false);
  });

  it("requires photo-derived entries to name the interpreting model", () => {
    const file = minimalFile();
    file.soft_signals.push({
      type: "nutrition",
      reported_at: "2026-08-09T12:30:00Z",
      note: "grilled chicken bowl",
      provenance: { via: "photo" }, // interpreted_by missing
    });
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path.includes("interpreted_by"))).toBe(true);
  });
});

describe("referential integrity", () => {
  it("flags a hard signal pointing at an unknown source", () => {
    const file = minimalFile();
    file.hard_signals[0]!.source = "ghost-device";
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.message).toContain("unknown source");
  });

  it("flags a benchmark result for an undefined benchmark", () => {
    const file = minimalFile();
    file.benchmarks = [];
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("unknown benchmark"))).toBe(true);
  });

  it("flags a session whose end precedes its start", () => {
    const file = minimalFile();
    const sleep = file.hard_signals[1]!;
    if (sleep.type === "sleep_session") {
      sleep.end = "2026-08-08T20:00:00Z";
    }
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
  });

  it("flags a time benchmark scored with reps", () => {
    const file = minimalFile();
    const res = file.hard_signals[2]!;
    if (res.type === "benchmark_result") {
      res.result = { reps: 90 };
    }
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("scored by time"))).toBe(true);
  });
});

describe("score shape", () => {
  it("accepts exactly one of duration_s, reps, or weight_kg", () => {
    expect(Score.safeParse({ duration_s: 281 }).success).toBe(true);
    expect(Score.safeParse({ reps: 90 }).success).toBe(true);
    expect(Score.safeParse({ weight_kg: 100 }).success).toBe(true);
  });

  it("rejects a score with no fields", () => {
    expect(Score.safeParse({}).success).toBe(false);
  });

  it("rejects a score that carries more than one field", () => {
    expect(Score.safeParse({ duration_s: 281, reps: 90 }).success).toBe(false);
    expect(Score.safeParse({ duration_s: 281, weight_kg: 100 }).success).toBe(false);
    expect(Score.safeParse({ reps: 90, weight_kg: 100 }).success).toBe(false);
  });
});

describe("prediction ledger honesty", () => {
  it("flags an actual recorded before the prediction was made", () => {
    const file = minimalFile();
    file.predictions[0]!.actual = {
      result: { duration_s: 272 },
      recorded_at: "2026-08-01T10:00:00Z", // before created_at
    };
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("precede"))).toBe(true);
  });

  it("flags a grade without an actual", () => {
    const file = minimalFile();
    file.predictions[0]!.grade = { signed_error: 3, abs_error_pct: 1.1, in_range: true };
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
  });

  it("flags a miss analysis with no causes that is not marked unexplained", () => {
    const file = minimalFile();
    const p = file.predictions[0]!;
    p.actual = { result: { duration_s: 320 }, recorded_at: "2026-08-10T17:00:00Z" };
    p.grade = { signed_error: -45, abs_error_pct: 16.4, in_range: false };
    p.miss_analysis = {
      direction: "slower",
      severity: "severe",
      candidate_causes: [],
      unexplained: false,
    };
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("unexplained"))).toBe(true);
  });

  it("flags a prediction range that does not match the benchmark score type", () => {
    const file = minimalFile();
    file.predictions[0]!.range = { low: { reps: 10 }, high: { duration_s: 290 } };
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "predictions.0.range.low")).toBe(true);
  });

  it("flags a prediction actual that does not match the benchmark score type", () => {
    const file = minimalFile();
    file.predictions[0]!.actual = {
      result: { reps: 90 },
      recorded_at: "2026-08-10T17:00:00Z",
    };
    const result = validateAthleticStandardFile(file);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "predictions.0.actual.result")).toBe(true);
  });

  it("accepts a fully graded miss with an honest analysis", () => {
    const file = minimalFile();
    const p = file.predictions[0]!;
    p.actual = { result: { duration_s: 320 }, recorded_at: "2026-08-10T17:00:00Z" };
    p.grade = { signed_error: -45, abs_error_pct: 16.4, in_range: false };
    p.miss_analysis = {
      direction: "slower",
      severity: "severe",
      candidate_causes: [
        {
          signal: { tier: "soft", type: "sleep_quality", date: "2026-08-09" },
          explanation: "reported ~5h of sleep the night before",
        },
      ],
      unexplained: false,
      lesson: "poor sleep the night before cost ~16% on a short high-power benchmark",
    };
    const result = validateAthleticStandardFile(file);
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
