/**
 * Reading what a person typed, without a model (D59).
 *
 * A word list of about forty terms, a body-region list, and patterns for numbers,
 * ratings, units and clock times. That is all it is. It reads `sore quads 4/5`
 * correctly and reads `quads are wrecked` as a plain note, because "wrecked" is not
 * a word any maintainable list contains.
 *
 * What makes that safe is the direction of failure rather than the rate of it.
 * Promotion into the measured tier needs an exact hit: a known measurement name, a
 * number, a unit that fits, and everything else that measurement requires. Anything
 * else becomes a note with its text kept word for word. So a misread lands somewhere
 * harmless, and nothing typed is ever lost.
 *
 * An agent does not come through here at all. It passes structured JSON, whose three
 * shapes do not overlap, so there is nothing to guess (D57).
 */
import { POINT_MEASUREMENT_UNITS, type ScoreT, type SoftSignalTypeT } from "./schema.js";
import {
  CLOCK_AT_END,
  CLOCK_INTRODUCED,
  formatDuration,
  kilosFromLoad,
  lbToKg,
  LOAD_AT_END,
  secondsFromClock,
  type ScoreType,
} from "./score.js";

export { formatDuration } from "./score.js";

// ---------------------------------------------------------------------------
// What a line of text can become
// ---------------------------------------------------------------------------

export interface WorkoutEntry {
  kind: "workout result";
  score: ScoreT;
  /** How the score is stated back to the reader: "245 reps", "4:41". */
  scoreText: string;
  scoreType: "time" | "reps" | "load";
  /** The text, kept word for word, which becomes the benchmark's definition. */
  text: string;
  /** An existing benchmark the text named, when it named one. */
  namedBenchmark?: string;
  scaling?: "rx" | "scaled";
}

export interface MeasurementEntry {
  kind: "measurement";
  type: PointType;
  value: number;
  unit: string;
  /** The original wording, kept because it usually said more than the number. */
  text: string;
}

export interface SelfReportedEntry {
  kind: "self-reported";
  type: SoftSignalTypeT;
  rating?: number;
  scale?: string;
  bodyRegion?: string;
  /** Kept word for word. Every self-reported entry is read verbatim anyway. */
  text: string;
}

export type Entry = WorkoutEntry | MeasurementEntry | SelfReportedEntry;

/** A refusal: the tool could read the text two ways and will not choose. */
export class ParseRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseRefusal";
  }
}

type PointType = keyof typeof POINT_MEASUREMENT_UNITS;

// ---------------------------------------------------------------------------
// Measurements: the closed list, and what each one accepts
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
const same = (n: number) => n;
const fToC = (n: number) => round2(((n - 32) * 5) / 9);
const inToCm = (n: number) => round2(n * 2.54);

interface MeasurementName {
  /** Words that name it. Longest match wins, so "resting hr" beats "hr". */
  words: string[];
  type: PointType;
  /** Units the text may state, and how each converts to the canonical one. */
  accepts: Record<string, (n: number) => number>;
  /** Outside this a number is a typo, not a reading. */
  plausible: [number, number];
}

/**
 * The names a person might type, and the one measurement each resolves to.
 *
 * A name that could mean several measurements is not here. It is in
 * `AMBIGUOUS_NAMES`, and it is refused rather than picked (D28, D59).
 *
 * `hrv` resolves to RMSSD because that is what the wearables reporting a single
 * "HRV" number report, and the resolved type is shown in the summary before
 * anything is written, so a wearer whose watch reports SDNN can see it and decline.
 * Nothing here ever pools the two — that is D22's rule and it is enforced in the
 * baselines, not in this parser.
 */
const MEASUREMENT_NAMES: MeasurementName[] = [
  { words: ["resting heart rate", "resting hr", "rhr"], type: "resting_heart_rate", accepts: { bpm: same }, plausible: [25, 120] },
  { words: ["walking heart rate"], type: "walking_heart_rate", accepts: { bpm: same }, plausible: [50, 180] },
  { words: ["heart rate recovery", "hr recovery"], type: "hr_recovery", accepts: { bpm: same }, plausible: [1, 100] },
  { words: ["hrv rmssd", "rmssd", "hrv"], type: "hrv_rmssd", accepts: { ms: same }, plausible: [5, 300] },
  { words: ["hrv sdnn", "sdnn"], type: "hrv_sdnn", accepts: { ms: same }, plausible: [5, 300] },
  { words: ["body weight", "bodyweight", "weight"], type: "body_weight", accepts: { kg: same, lb: lbToKg, lbs: lbToKg, pounds: lbToKg }, plausible: [25, 300] },
  { words: ["lean body mass", "lean mass"], type: "lean_body_mass", accepts: { kg: same, lb: lbToKg, lbs: lbToKg }, plausible: [15, 200] },
  { words: ["body fat percentage", "body fat", "bodyfat"], type: "body_fat_percentage", accepts: { "%": same, pct: same }, plausible: [2, 60] },
  { words: ["height"], type: "height", accepts: { cm: same, in: inToCm, inches: inToCm }, plausible: [90, 250] },
  { words: ["respiratory rate", "breathing rate"], type: "respiratory_rate", accepts: { brpm: same, rpm: same }, plausible: [4, 40] },
  { words: ["vo2 max", "vo2max"], type: "vo2_max", accepts: { "ml/kg/min": same }, plausible: [15, 100] },
  { words: ["oxygen saturation", "blood oxygen", "spo2"], type: "oxygen_saturation", accepts: { "%": same, pct: same }, plausible: [50, 100] },
  { words: ["body temperature", "core temperature"], type: "body_temperature", accepts: { c: same, "°c": same, f: fToC, "°f": fToC }, plausible: [30, 45] },
  { words: ["skin temperature"], type: "skin_temperature", accepts: { c: same, "°c": same, f: fToC, "°f": fToC }, plausible: [20, 45] },
  { words: ["wrist temperature"], type: "wrist_temperature_sleeping", accepts: { c: same, "°c": same, f: fToC, "°f": fToC }, plausible: [20, 45] },
  { words: ["temperature deviation"], type: "temperature_deviation", accepts: { c: same, "°c": same }, plausible: [-10, 10] },
];

/** Names covering more than one measurement. Offered as a choice, never picked. */
const AMBIGUOUS_NAMES: { words: string[]; choices: PointType[] }[] = [
  {
    words: ["temperature", "temp"],
    choices: ["body_temperature", "skin_temperature", "wrist_temperature_sleeping", "temperature_deviation"],
  },
];

/**
 * Every token this tool would read as a unit, across all measurements.
 *
 * A word after the number is only treated as a unit if it is on this list. Otherwise
 * it is part of the sentence: `HRV 61 this morning` states no unit, while `HRV 61
 * bpm` states one that HRV is never measured in, and only the second is refused.
 */
const UNIT_TOKENS = new Set([
  "ms", "bpm", "kg", "lb", "lbs", "pounds", "%", "pct", "c", "f", "°c", "°f",
  "cm", "in", "inches", "brpm", "rpm", "ml/kg/min", "mmhg", "s", "sec", "secs",
  "min", "mins", "hr", "hrs", "hour", "hours", "w", "m", "km", "mi", "miles",
]);

/** Blood pressure arrives as one phrase and two measurements. */
const BLOOD_PRESSURE = /\bblood pressure\b[^0-9]*(\d{2,3})\s*\/\s*(\d{2,3})/i;

// ---------------------------------------------------------------------------
// Self-reported: the word lists
// ---------------------------------------------------------------------------

/**
 * The forty-odd words, grouped by the subtype they suggest.
 *
 * Getting the subtype wrong costs almost nothing: every self-reported entry is read
 * verbatim by whatever opens the file, so a `note` and a `soreness` are read the
 * same way. The subtype is a convenience for counting in `ath stats`.
 */
const SOFT_WORDS: [SoftSignalTypeT, string[]][] = [
  ["sleep_quality", ["slept", "sleep", "insomnia", "restless", "woke", "bedtime", "nap", "napped"]],
  ["soreness", ["sore", "soreness", "doms", "stiff", "tight", "ache", "aching", "achy"]],
  ["stress", ["stress", "stressed", "anxious", "anxiety", "overwhelmed", "deadline"]],
  ["energy", ["energy", "energised", "energized", "tired", "exhausted", "fatigued", "sluggish", "wired", "fresh"]],
  ["mood", ["mood", "felt", "feeling", "irritable", "grumpy", "flat", "motivated"]],
  ["nutrition", ["ate", "eating", "meal", "protein", "carbs", "hydration", "hydrated", "alcohol", "drank", "fasted"]],
];

const BODY_REGIONS = [
  "lower back", "upper back", "hip flexors", "hip flexor", "quads", "quad", "hamstrings", "hamstring",
  "glutes", "calves", "calf", "shoulders", "shoulder", "lats", "chest", "traps", "biceps", "triceps",
  "forearms", "hips", "knees", "knee", "ankles", "ankle", "wrists", "wrist", "neck", "adductors",
  "elbows", "achilles", "groin", "back",
];

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

/**
 * Words that make a clock time a result rather than an appointment.
 *
 * Without one of these, `meeting at 9:30` would be promoted to a measured benchmark
 * result on the strength of a colon. This list is what stops that.
 */
const WORKOUT_WORDS = [
  "rounds", "round", "rft", "amrap", "emom", "for time", "metcon", "wod", "rx", "scaled",
  "reps", "rep", "cals", "calories", "thruster", "thrusters", "snatch", "clean", "jerk",
  "deadlift", "squat", "squats", "burpee", "burpees", "pull-up", "pull-ups", "pullup", "pullups",
  "push-up", "push-ups", "box", "run", "ran", "row", "rowed", "echo", "ski", "erg", "kettlebell",
  "kb", "wall ball", "wallball", "muscle-up", "muscle-ups", "double-under", "double-unders",
  "chipper", "ladder", "sets", "pr", "lift", "lifted", "workout", "session", "swim", "swam",
  "bike", "biked", "assault", "sled", "carry", "lunge", "lunges", "sit-up", "sit-ups", "toes to bar",
];

// ---------------------------------------------------------------------------
// Reading a score
// ---------------------------------------------------------------------------

interface ReadScore {
  score: ScoreT;
  scoreText: string;
  scoreType: ScoreType;
}

/**
 * The score, read from the text.
 *
 * Ordered by how explicitly each form states a result. A workout is full of numbers
 * — loads, distances, intervals — so the ones read are the ones written the way a
 * result is written: a labelled total, or a clock at the end.
 *
 * Anything with no such form has no score, and a benchmark result without a score is
 * not written at all. That is the whole guard: the text falls through to a note
 * instead of becoming a measured record with a number picked out of the middle of it.
 */
export function readScore(text: string): ReadScore | null {
  const flat = text.replace(/\s+/g, " ").trim();

  const totalReps = /(\d{1,5})\s*(?:total\s+)?reps?\b\s*$/i.exec(flat) ?? /\btotal\s*(?:reps)?[: ]\s*(\d{1,5})\b/i.exec(flat);
  if (totalReps) {
    const reps = Number(totalReps[1]);
    if (reps > 0) return { score: { reps }, scoreText: `${reps} reps`, scoreType: "reps" };
  }

  // A clock at the end, or one introduced by "in" or "time".
  const clock = CLOCK_AT_END.exec(flat) ?? CLOCK_INTRODUCED.exec(flat);
  if (clock) {
    const duration_s = secondsFromClock(clock);
    if (duration_s > 0) {
      return { score: { duration_s }, scoreText: formatDuration(duration_s), scoreType: "time" };
    }
  }

  const load = LOAD_AT_END.exec(flat);
  if (load) {
    const weight_kg = kilosFromLoad(load);
    if (weight_kg > 0) {
      return { score: { weight_kg }, scoreText: `${weight_kg} kg`, scoreType: "load" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Classifying one clause
// ---------------------------------------------------------------------------

/** Where a name appears in the text, or -1. Whole words only. */
function indexOfWord(haystack: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, "i").exec(haystack);
  return m ? m.index : -1;
}

/**
 * A measurement, if the text names one and supplies everything it needs.
 *
 * Returns `null` when it does not, which is the ordinary case. Throws only when the
 * text names a measurement and then says something the tool will not resolve — an
 * ambiguous name, or a unit that does not fit.
 */
function readMeasurement(clause: string): MeasurementEntry[] | null {
  const lower = clause.toLowerCase();

  const bp = BLOOD_PRESSURE.exec(clause);
  if (bp) {
    const [systolic, diastolic] = [Number(bp[1]), Number(bp[2])];
    if (systolic <= diastolic) {
      throw new ParseRefusal(
        `blood pressure ${systolic}/${diastolic} reads as systolic ${systolic} over diastolic ` +
          `${diastolic}, and the first number has to be the larger one. Type it the other way round.`,
      );
    }
    return [
      { kind: "measurement", type: "blood_pressure_systolic", value: systolic, unit: "mmHg", text: clause },
      { kind: "measurement", type: "blood_pressure_diastolic", value: diastolic, unit: "mmHg", text: clause },
    ];
  }

  // Longest name first, so "resting heart rate" is not read as "heart rate".
  const candidates = MEASUREMENT_NAMES.flatMap((m) =>
    m.words.map((word) => ({ m, word, at: indexOfWord(lower, word) })),
  )
    .filter((c) => c.at >= 0)
    .sort((a, b) => b.word.length - a.word.length);

  const ambiguous = AMBIGUOUS_NAMES.flatMap((a) =>
    a.words.map((word) => ({ a, word, at: indexOfWord(lower, word) })),
  ).filter((c) => c.at >= 0);

  const hit = candidates[0];
  if (!hit) {
    // "temperature 36.8" names four measurements D28 keeps apart, so it is a choice
    // to be made rather than a guess to be shown.
    const vague = ambiguous[0];
    if (vague && /\d/.test(clause)) {
      throw new ParseRefusal(
        `'${vague.word}' names ${vague.a.choices.length} different measurements, and they are ` +
          `not interchangeable. Say which one: ${vague.a.choices.join(", ")}.`,
      );
    }
    return null;
  }

  // The number after the name, with a unit if one was given.
  const after = clause.slice(hit.at + hit.word.length + 1);
  const value = /(-?\d{1,4}(?:\.\d+)?)\s*([a-z%°/]+)?/i.exec(after);
  if (!value) return null;

  const raw = Number(value[1]);
  const written = (value[2] ?? "").toLowerCase().replace(/\.$/, "");
  const stated = UNIT_TOKENS.has(written) ? written : "";
  const canonical = POINT_MEASUREMENT_UNITS[hit.m.type];

  let converted = raw;
  if (stated && stated !== canonical.toLowerCase()) {
    const convert = hit.m.accepts[stated];
    if (!convert) {
      throw new ParseRefusal(
        `${hit.m.type} is recorded in ${canonical}, and '${stated}' is not a unit it accepts ` +
          `(${Object.keys(hit.m.accepts).join(", ")}). Nothing was written.`,
      );
    }
    converted = convert(raw);
  }

  const [low, high] = hit.m.plausible;
  if (converted < low || converted > high) {
    throw new ParseRefusal(
      `${converted}${canonical} is outside the range ${hit.m.type} is ever measured in ` +
        `(${low}–${high}${canonical}), so this reads as a typo. Nothing was written.`,
    );
  }

  return [{ kind: "measurement", type: hit.m.type, value: converted, unit: canonical, text: clause }];
}

/** The rating and its scale, when the text states one: `4/5`, `rated 3 out of 5`. */
function readRating(clause: string): { rating: number; scale: string } | null {
  const m =
    /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/.exec(clause) ??
    /\b(\d{1,2})\s+out\s+of\s+(\d{1,2})\b/i.exec(clause);
  if (!m) return null;
  const rating = Number(m[1]);
  const top = Number(m[2]);
  if (top < 2 || rating > top) return null;
  return { rating, scale: `1-${top}` };
}

/** Which self-reported subtype the words suggest, or `note` when none do. */
function readSoft(clause: string): SelfReportedEntry {
  const lower = clause.toLowerCase();

  const hits = SOFT_WORDS.flatMap(([type, words]) =>
    words.map((word) => ({ type, at: indexOfWord(lower, word) })),
  )
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at);

  const region = BODY_REGIONS.map((r) => ({ r, at: indexOfWord(lower, r) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => b.r.length - a.r.length)[0];

  const rating = readRating(clause);
  const type = hits[0]?.type ?? "note";

  return {
    kind: "self-reported",
    type,
    ...(rating ?? {}),
    // A body region only travels with soreness. On anything else it is a word in a
    // sentence, and the sentence is kept anyway.
    ...(type === "soreness" && region ? { bodyRegion: region.r } : {}),
    text: clause,
  };
}

export interface ParseContext {
  /** Benchmark ids already in the file, so naming one is a workout indicator. */
  knownBenchmarks: string[];
  /** A benchmark named on the command line, which settles the kind outright. */
  benchmark?: string | undefined;
}

/** A benchmark already in the file that this text names, if it names one. */
function benchmarkNamedIn(clause: string, known: string[]): string | undefined {
  const lower = clause.toLowerCase();
  return known.find(
    (id) => indexOfWord(lower, id) >= 0 || indexOfWord(lower, id.replace(/-/g, " ")) >= 0,
  );
}

/** Does the text read like training, rather than a sentence that has a number in it? */
function readsLikeTraining(clause: string, context: ParseContext): boolean {
  if (benchmarkNamedIn(clause, context.knownBenchmarks) !== undefined) return true;
  const lower = clause.toLowerCase();
  return WORKOUT_WORDS.some((w) => indexOfWord(lower, w) >= 0);
}

/**
 * One clause, classified.
 *
 * The order is the trust order. A measurement needs an exact hit on a closed list;
 * a workout result needs both a score and something that says this is training;
 * everything else is self-reported, which is where an unreadable clause lands.
 */
function classify(clause: string, context: ParseContext, multiline: boolean): Entry[] {
  const measurement = readMeasurement(clause);
  if (measurement) return measurement;

  const score = readScore(clause);
  if (score && (multiline || context.benchmark || readsLikeTraining(clause, context))) {
    const named = benchmarkNamedIn(clause, context.knownBenchmarks);
    const scaling = /\bscaled\b/i.test(clause) ? "scaled" : /\brx\b/i.test(clause) ? "rx" : undefined;
    return [
      {
        kind: "workout result",
        score: score.score,
        scoreText: score.scoreText,
        scoreType: score.scoreType,
        text: clause,
        ...(named ? { namedBenchmark: named } : {}),
        ...(scaling ? { scaling } : {}),
      },
    ];
  }

  return [readSoft(clause)];
}

/**
 * Everything one entry of text becomes.
 *
 * A comma splits the text only when one of the parts is a measurement or a result.
 * `slept badly, about 5 hours` is one thought and stays one entry; `Did Fran in 4:41,
 * felt awful, slept about 5 hours` is a result and two feelings, and becomes three
 * records under the one question.
 *
 * Several lines are never split, because several lines is what a pasted workout is.
 */
export function parseEntry(text: string, context: ParseContext): Entry[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  const multiline = /\n/.test(trimmed);
  if (multiline) return classify(trimmed, context, true);

  const clauses = trimmed
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
  if (clauses.length < 2) return classify(trimmed, context, false);

  const split = clauses.map((clause) => classify(clause, context, false));
  const hardParts = split.filter((entries) =>
    entries.some((e) => e.kind === "measurement" || e.kind === "workout result"),
  );
  if (hardParts.length === 0) return classify(trimmed, context, false);
  return split.flat();
}
