/**
 * Athletic Standard v0.1 — the format, as code.
 *
 * These Zod schemas are the single source of truth for the Athletic Standard file format.
 * The committed JSON Schema (schema/athleticstandard.schema.json) is generated from them,
 * so the spec and the implementation cannot drift.
 *
 * The load-bearing design rule is the two-tier wall:
 *   - hard signals are device-measured and MUST reference a source (provenance);
 *   - soft signals are self-reported and structurally CANNOT reference a device
 *     source (the field does not exist, and objects are strict).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** ISO 8601 timestamp. UTC (`Z`) or explicit offset — never a naive local time. */
export const Timestamp = z.iso
  .datetime({ offset: true })
  .describe("ISO 8601 timestamp with timezone (UTC `Z` or explicit offset)");

/** ISO 8601 calendar date (YYYY-MM-DD). */
export const CalendarDate = z.iso.date().describe("ISO 8601 date (YYYY-MM-DD)");

/** Identifier: lowercase, digits, hyphens/underscores. Human-typeable, diff-friendly. */
export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "lowercase alphanumeric with - or _")
  .describe("Identifier: lowercase alphanumeric with hyphens/underscores");

// ---------------------------------------------------------------------------
// Sources — where hard data came from
// ---------------------------------------------------------------------------

export const SourceKind = z.enum(["wearable", "export_file", "connector", "manual"]);

export const Source = z
  .strictObject({
    id: Id,
    kind: SourceKind,
    vendor: z
      .string()
      .optional()
      .describe("e.g. whoop, oura, apple, garmin — omit for kind=manual"),
    detail: z
      .string()
      .optional()
      .describe("Human-readable provenance, e.g. 'WHOOP 4.0 via CSV export 2026-08-09'"),
  })
  .describe(
    "A provenance record. Every hard signal must reference one. `manual` exists so " +
      "typed-in numbers can be stored as measurements without claiming device provenance.",
  );

// ---------------------------------------------------------------------------
// Hard signals — measured data (device-sourced, canonical units)
// ---------------------------------------------------------------------------

/**
 * Canonical units per point-measurement type, adopted verbatim from
 * Open Wearables' unit table (HRV in ms, HR in bpm, mass in kg, etc.).
 */
export const POINT_MEASUREMENT_UNITS = {
  hrv_rmssd: "ms",
  hrv_sdnn: "ms",
  resting_heart_rate: "bpm",
  body_weight: "kg",
  respiratory_rate: "brpm",
} as const;

export type PointMeasurementType = keyof typeof POINT_MEASUREMENT_UNITS;

const pointVariant = <T extends PointMeasurementType>(type: T) =>
  z.strictObject({
    type: z.literal(type),
    value: z.number().positive(),
    unit: z
      .literal(POINT_MEASUREMENT_UNITS[type])
      .describe("Fixed canonical unit for this type — no ambiguous values"),
    recorded_at: Timestamp,
    source: Id.describe("Reference to sources[].id"),
    note: z.string().optional(),
  });

/** A single timestamped measurement (one HRV reading, one morning RHR). */
export const PointMeasurement = z
  .discriminatedUnion("type", [
    pointVariant("hrv_rmssd"),
    pointVariant("hrv_sdnn"),
    pointVariant("resting_heart_rate"),
    pointVariant("body_weight"),
    pointVariant("respiratory_rate"),
  ])
  .describe("A single timestamped device measurement with a fixed canonical unit");

/** A night of sleep as one record with aggregates. */
export const SleepSession = z.strictObject({
  type: z.literal("sleep_session"),
  start: Timestamp,
  end: Timestamp,
  source: Id.describe("Reference to sources[].id"),
  aggregates: z.strictObject({
    duration_s: z.number().nonnegative().optional().describe("Actual sleep, excluding awake time"),
    time_in_bed_s: z.number().nonnegative().optional(),
    efficiency_pct: z.number().min(0).max(100).optional(),
    deep_s: z.number().nonnegative().optional(),
    rem_s: z.number().nonnegative().optional(),
    light_s: z.number().nonnegative().optional(),
    awake_s: z.number().nonnegative().optional(),
    interruptions: z.number().int().nonnegative().optional(),
  }),
  note: z.string().optional(),
});

/** An ordered, labeled sub-effort inside a workout: run splits, HYROX stations. */
export const WorkoutSegment = z.strictObject({
  label: z.string().describe("e.g. 'run 1km', 'ski erg', 'sled push'"),
  duration_s: z.number().nonnegative().optional(),
  distance_m: z.number().nonnegative().optional(),
  avg_hr_bpm: z.number().positive().optional(),
});

/** A training session as one record with aggregates and optional segments. */
export const WorkoutSession = z.strictObject({
  type: z.literal("workout_session"),
  start: Timestamp,
  end: Timestamp,
  source: Id.describe("Reference to sources[].id"),
  aggregates: z.strictObject({
    activity: z
      .string()
      .optional()
      .describe("Freeform activity label, e.g. 'crossfit', 'run', 'hyrox'"),
    avg_hr_bpm: z.number().positive().optional(),
    max_hr_bpm: z.number().positive().optional(),
    energy_kcal: z.number().nonnegative().optional(),
    distance_m: z.number().nonnegative().optional(),
  }),
  segments: z
    .array(WorkoutSegment)
    .optional()
    .describe("Ordered sub-efforts: run splits, HYROX station times"),
  note: z.string().optional(),
});

/**
 * A benchmark score. Must include the field that matches the benchmark's
 * score_type (checked by the semantic validator); extra fields are allowed
 * so a time result can also record load or reps when that's useful.
 */
export const Score = z
  .strictObject({
    duration_s: z.number().positive().optional().describe("For score_type=time"),
    reps: z.number().int().positive().optional().describe("For score_type=reps"),
    weight_kg: z.number().positive().optional().describe("For score_type=load"),
  })
  .refine((s) => s.duration_s !== undefined || s.reps !== undefined || s.weight_kg !== undefined, {
    message: "A score must contain at least one of duration_s, reps, weight_kg",
  });

/**
 * A benchmark result is measured fact even when hand-entered — but its source
 * will be `manual` unless it came from a device, keeping the trust level visible.
 */
export const BenchmarkResult = z.strictObject({
  type: z.literal("benchmark_result"),
  benchmark: Id.describe("Reference to benchmarks[].id"),
  recorded_at: Timestamp,
  source: Id.describe("Reference to sources[].id"),
  result: Score,
  scaling: z.enum(["rx", "scaled"]).optional(),
  note: z.string().optional(),
});

export const HardSignal = z
  .union([PointMeasurement, SleepSession, WorkoutSession, BenchmarkResult])
  .describe(
    "Tier 1: device-measured, high trust. Drives predictions. " +
      "Every hard signal must reference a source.",
  );

// ---------------------------------------------------------------------------
// Soft signals — self-reported data (low confidence, optional, timestamped)
// ---------------------------------------------------------------------------

export const SoftSignalType = z.enum([
  "sleep_quality",
  "soreness",
  "stress",
  "mood",
  "energy",
  "nutrition",
  "note",
]);

/** How a self-reported entry came to exist — and whether an AI interpreted it. */
export const SoftProvenance = z.strictObject({
  via: z.enum(["text", "voice", "photo"]),
  interpreted_by: z
    .string()
    .optional()
    .describe("Model that interpreted the input, e.g. 'claude-sonnet-4-5'. Required for via=photo."),
  attachment: z
    .strictObject({
      file: z.string().describe("Filename inside the sibling attachments/ folder"),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
});

export const SoftSignal = z
  .strictObject({
    type: SoftSignalType,
    reported_at: Timestamp,
    rating: z.number().optional(),
    scale: z
      .string()
      .optional()
      .describe("Required when rating is present, e.g. '1-5'. Ratings without scales are meaningless."),
    body_region: z.string().optional().describe("For soreness, e.g. 'quads', 'lower back'"),
    note: z.string().optional(),
    provenance: SoftProvenance.optional().describe("Defaults to { via: 'text' } when absent"),
  })
  .refine((s) => s.rating === undefined || s.scale !== undefined, {
    message: "A rating requires an explicit scale",
    path: ["scale"],
  })
  .describe(
    "Tier 2: self-reported, low confidence. Adjusts prediction confidence and explains misses. " +
      "Structurally cannot claim device provenance: there is no source field.",
  );

// ---------------------------------------------------------------------------
// Benchmarks — definitions
// ---------------------------------------------------------------------------

export const Benchmark = z.strictObject({
  id: Id,
  kind: z.enum(["named_wod", "run", "hyrox", "lift", "custom"]),
  score_type: z.enum(["time", "reps", "load"]),
  definition: z.string().describe("Human-readable definition, e.g. '21-15-9 reps for time: …'"),
  tags: z.array(z.string()).optional().describe("Freeform, e.g. ['short', 'high-power']"),
});

// ---------------------------------------------------------------------------
// Predictions — the ledger
// ---------------------------------------------------------------------------

export const Confidence = z.enum(["low", "moderate", "high"]);

/** Written by the CLI when the actual result is recorded. Deterministic. */
export const Grade = z.strictObject({
  signed_error: z
    .number()
    .describe("predicted − actual, in the benchmark's native unit (seconds, reps, or kg)"),
  abs_error_pct: z.number().nonnegative(),
  in_range: z.boolean().describe("Did the actual land inside the stated range?"),
});

export const MissCause = z.strictObject({
  signal: z.strictObject({
    tier: z.enum(["hard", "soft"]),
    type: z.string(),
    date: CalendarDate,
  }),
  explanation: z.string(),
});

/**
 * Written by the agent on any miss. Every candidate cause must reference a signal
 * that exists in the file; if nothing explains the miss, set `unexplained: true`.
 */
export const MissAnalysis = z.strictObject({
  direction: z.enum(["faster", "slower", "higher", "lower"]),
  severity: z.enum(["minor", "significant", "severe"]),
  candidate_causes: z.array(MissCause),
  unexplained: z.boolean(),
  lesson: z
    .string()
    .optional()
    .describe("One sentence, written to be useful to a future prediction"),
});

export const Prediction = z.strictObject({
  id: Id,
  benchmark: Id.describe("Reference to benchmarks[].id"),
  created_at: Timestamp,
  predicted: Score,
  range: z
    .strictObject({ low: Score, high: Score })
    .optional()
    .describe("Stated uncertainty. Grading checks whether the actual landed inside it."),
  confidence: Confidence,
  reasoning: z
    .string()
    .describe("Must cite specific dates and values from the evidence, not vague trends"),
  evidence_window: z.strictObject({ from: CalendarDate, to: CalendarDate }),
  model: z.string().describe("Model that produced the prediction"),
  actual: z
    .strictObject({ result: Score, recorded_at: Timestamp })
    .nullable()
    .default(null),
  grade: Grade.nullable().default(null),
  miss_analysis: MissAnalysis.nullable().default(null),
});

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

export const Athlete = z.strictObject({
  name: z.string().optional(),
  birth_year: z.number().int().min(1900).max(2100).optional(),
  sex: z.enum(["male", "female"]).optional(),
  units: z
    .enum(["metric", "imperial"])
    .optional()
    .describe("Display preference only — stored values are always canonical (metric) units"),
});

export const ATHLETIC_STANDARD_VERSION = "0.1.0";

export const AthleticStandardFile = z
  .strictObject({
    athleticstandard_version: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, "semver")
      .describe("Format version (semver). Minor versions may only add optional fields."),
    athlete: Athlete,
    sources: z.array(Source),
    hard_signals: z.array(HardSignal),
    soft_signals: z.array(SoftSignal),
    benchmarks: z.array(Benchmark),
    predictions: z.array(Prediction),
  })
  .describe(
    "Athletic Standard: an open, local-first format for a functional-fitness athlete's training and " +
      "recovery state, designed for AI agents to reason over. Measured signals (hard) and " +
      "self-reported signals (soft) never mix.",
  );

export type AthleticStandardFileT = z.infer<typeof AthleticStandardFile>;
export type SourceT = z.infer<typeof Source>;
export type HardSignalT = z.infer<typeof HardSignal>;
export type SoftSignalT = z.infer<typeof SoftSignal>;
export type BenchmarkT = z.infer<typeof Benchmark>;
export type PredictionT = z.infer<typeof Prediction>;
export type ScoreT = z.infer<typeof Score>;
