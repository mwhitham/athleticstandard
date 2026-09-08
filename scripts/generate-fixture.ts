/**
 * Generates examples/demo-athlete/athlete.ath.json — a synthetic but realistic
 * athlete: ~14 months of daily WHOOP-shaped data, benchmark results across four
 * benchmarks with a plausible improvement curve, and soft signals sprinkled the
 * way a real person actually logs (sporadically, and mostly when things go wrong).
 *
 * Deterministic: seeded PRNG, so regenerating produces an identical file.
 * Used by tests, the backtest demo, and README examples.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AthleticStandardFileT,
  HardSignalT,
  PredictionT,
  SoftSignalT,
} from "../src/schema.js";
import { ATHLETIC_STANDARD_VERSION } from "../src/schema.js";
import { validateAthleticStandardFile } from "../src/validate.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Seeded PRNG (mulberry32) — deterministic output ---
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xa7c4);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const gaussish = (mean: number, spread: number) =>
  mean + (rand() + rand() + rand() - 1.5) * spread;

const START = new Date("2025-06-01T00:00:00Z");
const DAYS = 427; // ~14 months

const dayAt = (i: number) => new Date(START.getTime() + i * 86400_000);
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const at = (i: number, h: number, m = 0) => {
  const d = dayAt(i);
  d.setUTCHours(h, m, Math.floor(between(0, 59)), 0);
  return iso(d);
};

const hard: HardSignalT[] = [];
const soft: SoftSignalT[] = [];

/** What to sort a hard signal by: a series covers days, so it sorts by its first. */
function signalOrder(sig: HardSignalT): string {
  if ("recorded_at" in sig) return sig.recorded_at;
  if (sig.type === "series_ref") return sig.from;
  return sig.start;
}

// --- Daily physiology with slow trends and correlated bad patches ---
let hrvBaseline = 58; // improves slowly over 14 months toward ~66
let sleepDebt = 0; // accumulates on bad nights, decays otherwise
const badNight = new Set<number>();
const heavyDay = new Set<number>();

for (let i = 0; i < DAYS; i++) {
  hrvBaseline += 0.02 * rand();

  // ~9% of nights are bad (short, low quality); slightly clustered
  const isBad = rand() < (badNight.has(i - 1) ? 0.18 : 0.08);
  if (isBad) badNight.add(i);

  const sleepH = isBad ? between(4.4, 5.6) : gaussish(7.4, 0.7);
  sleepDebt = Math.max(0, sleepDebt * 0.6 + (7.2 - sleepH));

  const sleepStart = new Date(dayAt(i - 1).getTime());
  sleepStart.setUTCHours(22, Math.floor(between(0, 59)), 0, 0);
  const sleepEnd = new Date(sleepStart.getTime() + sleepH * 3600_000);
  const duration_s = Math.round(sleepH * 3600 * between(0.88, 0.95));

  hard.push({
    type: "sleep_session",
    start: iso(sleepStart),
    end: iso(sleepEnd),
    source: "whoop-1",
    aggregates: {
      duration_s,
      time_in_bed_s: Math.round(sleepH * 3600),
      efficiency_pct: Math.round(between(84, 96) * 10) / 10,
      deep_s: Math.round(duration_s * between(0.18, 0.24)),
      rem_s: Math.round(duration_s * between(0.2, 0.27)),
      light_s: Math.round(duration_s * between(0.45, 0.55)),
      interruptions: isBad ? Math.floor(between(3, 7)) : Math.floor(between(0, 3)),
    },
  });

  // Morning HRV & RHR — suppressed by sleep debt and yesterday's heavy session
  const strain = (heavyDay.has(i - 1) ? 4 : 0) + Math.min(8, sleepDebt * 2.2);
  hard.push({
    type: "hrv_rmssd",
    value: Math.round(Math.max(28, gaussish(hrvBaseline - strain, 5)) * 10) / 10,
    unit: "ms",
    recorded_at: at(i, 6, 10),
    source: "whoop-1",
  });
  hard.push({
    type: "resting_heart_rate",
    value: Math.round(Math.max(42, gaussish(52 + strain * 0.5, 1.6))),
    unit: "bpm",
    recorded_at: at(i, 6, 10),
    source: "whoop-1",
  });

  // Training ~5x/week: crossfit mostly, a run ~once a week
  const dow = dayAt(i).getUTCDay();
  const trains = dow !== 0 && !(dow === 4 && rand() < 0.7) && rand() < 0.92;
  if (trains) {
    const isRun = dow === 6 && rand() < 0.7;
    const isHeavy = !isRun && rand() < 0.3;
    if (isHeavy) heavyDay.add(i);

    const startT = new Date(dayAt(i).getTime());
    startT.setUTCHours(17, Math.floor(between(0, 30)), 0, 0);
    const durMin = isRun ? between(28, 55) : between(45, 75);
    const endT = new Date(startT.getTime() + durMin * 60_000);

    if (isRun) {
      const kmPaceS = gaussish(305, 18); // ~5:05/km
      const kms = Math.max(3, Math.round(durMin / (kmPaceS / 60)));
      hard.push({
        type: "workout_session",
        start: iso(startT),
        end: iso(endT),
        source: "whoop-1",
        aggregates: {
          activity: "run",
          avg_hr_bpm: Math.round(gaussish(152, 5)),
          max_hr_bpm: Math.round(gaussish(171, 5)),
          energy_kcal: Math.round(kms * gaussish(62, 5)),
          distance_m: kms * 1000,
        },
        segments: Array.from({ length: kms }, (_, k) => ({
          label: `km ${k + 1}`,
          duration_s: Math.round(gaussish(kmPaceS, 9)),
          distance_m: 1000,
        })),
      });
    } else {
      hard.push({
        type: "workout_session",
        start: iso(startT),
        end: iso(endT),
        source: "whoop-1",
        aggregates: {
          activity: "crossfit",
          avg_hr_bpm: Math.round(gaussish(isHeavy ? 158 : 147, 6)),
          max_hr_bpm: Math.round(gaussish(isHeavy ? 182 : 172, 5)),
          energy_kcal: Math.round(gaussish(isHeavy ? 620 : 480, 60)),
        },
      });
    }
  }

  // Soft signals: humans log when something is off, plus occasional routine notes
  if (isBad && rand() < 0.75) {
    soft.push({
      type: "sleep_quality",
      reported_at: at(i, 7, 5),
      rating: Math.floor(between(1, 3)),
      scale: "1-5",
      note: ["kids up all night", "late flight", "couldn't switch off", "neighbor's dog"][
        Math.floor(between(0, 4))
      ]!,
      provenance: { via: "text" },
    });
  }
  if (heavyDay.has(i - 1) && rand() < 0.5) {
    soft.push({
      type: "soreness",
      reported_at: at(i, 8, 30),
      rating: Math.floor(between(3, 6)),
      scale: "1-5",
      body_region: ["quads", "lower back", "shoulders", "hamstrings"][Math.floor(between(0, 4))]!,
      provenance: { via: "text" },
    });
  }
  if (rand() < 0.06) {
    soft.push({
      type: "stress",
      reported_at: at(i, 20, 0),
      rating: Math.floor(between(3, 6)),
      scale: "1-5",
      note: "work deadline week",
      provenance: { via: "text" },
    });
  }
}

// --- Benchmark results: improvement curve, dented by sleep debt on the day ---
const benchmarkPlan: { id: string; day: number; base: number; note?: string }[] = [
  { id: "fran", day: 24, base: 310, note: "first timed Fran" },
  { id: "helen", day: 66, base: 585 },
  { id: "5k-run", day: 101, base: 1490 },
  { id: "fran", day: 149, base: 288 },
  { id: "grace", day: 173, base: 195 },
  { id: "helen", day: 214, base: 561 },
  { id: "fran", day: 262, base: 281, note: "unbroken thrusters first two rounds" },
  { id: "5k-run", day: 298, base: 1442 },
  { id: "grace", day: 331, base: 184 },
  { id: "fran", day: 366, base: 275 },
  { id: "helen", day: 401, base: 549 },
];

// Where the watch recorded a session that day, the attempt happened inside it and
// the result names it (D48). Not every benchmark day has one, and that is deliberate:
// a result logged before the watch synced is the ordinary case, so the fixture holds
// both a linked and an unlinked result for anything reading it to meet.
const sessionByDay = new Map<string, { start: string; end: string }>();
for (const sig of hard) {
  if (sig.type !== "workout_session") continue;
  sessionByDay.set(sig.start.slice(0, 10), { start: sig.start, end: sig.end });
}

for (const b of benchmarkPlan) {
  // A bad night before a benchmark costs 4-9%
  const penalty = badNight.has(b.day - 1) || badNight.has(b.day) ? between(1.04, 1.09) : 1.0;
  const duration = Math.round(b.base * penalty * gaussish(1, 0.012));
  const session = sessionByDay.get(iso(dayAt(b.day)).slice(0, 10));
  const insideSession = session
    ? iso(
        new Date(
          Math.round(
            Date.parse(session.start) + (Date.parse(session.end) - Date.parse(session.start)) * 0.6,
          ),
        ),
      )
    : undefined;
  hard.push({
    type: "benchmark_result",
    benchmark: b.id,
    recorded_at: insideSession ?? at(b.day, 18, 15),
    source: "manual-1",
    result: { duration_s: duration },
    scaling: "rx",
    ...(session ? { session: { source: "whoop-1", start: session.start } } : {}),
    ...(b.note ? { note: b.note } : {}),
  });
}

// --- Predictions: the loop, so the demo file demonstrates the thing it is for ---
//
// A hit, a miss with its analysis, and one still open. Each graded prediction points
// at the result it was graded against, by benchmark and instant, which is the rule
// `ath check` enforces (D64). The numbers are computed from the results above rather
// than typed in, so the fixture cannot drift out of agreement with itself.
type Result = Extract<HardSignalT, { type: "benchmark_result" }>;

const resultsFor = (id: string): Result[] =>
  hard.filter((s): s is Result => s.type === "benchmark_result" && s.benchmark === id);

const EVIDENCE_DAYS = 28;

function predictionFor(
  result: Result,
  input: {
    id: string;
    predicted: number;
    range: [number, number];
    confidence: "low" | "moderate" | "high";
    reasoning: string;
  },
): PredictionT {
  const actual = result.result.duration_s!;
  const createdAt = iso(new Date(Date.parse(result.recorded_at) - 3 * 86400_000));
  const from = iso(new Date(Date.parse(createdAt) - (EVIDENCE_DAYS - 1) * 86400_000)).slice(0, 10);
  const signed = Math.round((input.predicted - actual) * 100) / 100;
  return {
    id: input.id,
    benchmark: result.benchmark,
    created_at: createdAt,
    predicted: { duration_s: input.predicted },
    range: { low: { duration_s: input.range[0] }, high: { duration_s: input.range[1] } },
    confidence: input.confidence,
    reasoning: input.reasoning,
    evidence_window: { from, to: createdAt.slice(0, 10) },
    model: "claude-sonnet-4-5",
    agent: "Claude Code",
    ath_version: ATHLETIC_STANDARD_VERSION,
    actual: { result: result.result, recorded_at: result.recorded_at },
    grade: {
      signed_error: signed,
      abs_error_pct: Math.round((Math.abs(signed) / actual) * 1000) / 10,
      in_range: actual >= input.range[0] && actual <= input.range[1],
    },
    miss_analysis: null,
  };
}

const franResults = resultsFor("fran");
const lastFran = franResults[franResults.length - 1]!;
const hit = predictionFor(lastFran, {
  id: `pred-${lastFran.recorded_at.slice(0, 10)}-fran`,
  predicted: lastFran.result.duration_s! + 3,
  range: [lastFran.result.duration_s! - 7, lastFran.result.duration_s! + 8],
  confidence: "moderate",
  reasoning:
    "Three prior Frans, 5:10 down to 4:48 over eleven months, roughly 11 seconds off " +
    "each time. HRV sat at its own 90-day mean every night of the last two weeks and " +
    "the night before was 7h10m of actual sleep, so nothing argues for a departure " +
    "from the trend.",
});

const helenResults = resultsFor("helen");
const lastHelen = helenResults[helenResults.length - 1]!;
const helenActual = lastHelen.result.duration_s!;
const miss = predictionFor(lastHelen, {
  id: `pred-${lastHelen.recorded_at.slice(0, 10)}-helen`,
  predicted: Math.round(helenActual * 0.92),
  range: [Math.round(helenActual * 0.92) - 8, Math.round(helenActual * 0.92) + 8],
  confidence: "high",
  reasoning:
    "Two prior Helens, 9:45 then 9:21, and the run split is the part that has been " +
    "improving. Called high confidence on the strength of two points, which is one " +
    "more than none and fewer than enough.",
});

// A cause has to reference a signal the file holds (D62), so the analysis cites one
// that is there or admits it has nothing.
const attemptAt = Date.parse(lastHelen.recorded_at);
const nearby = soft.find((s) => {
  const at = Date.parse(s.reported_at);
  return at <= attemptAt && at >= attemptAt - 72 * 3600_000;
});
miss.miss_analysis = nearby
  ? {
      direction: "slower",
      severity: "significant",
      candidate_causes: [
        {
          signal: { tier: "soft", type: nearby.type, date: nearby.reported_at.slice(0, 10) },
          explanation:
            `${nearby.type} reported ${nearby.rating}/5 on ${nearby.reported_at.slice(0, 10)}` +
            (nearby.note ? `: "${nearby.note}"` : "") +
            `. Self-reported, so it is what the athlete noticed and not a measurement.`,
        },
      ],
      unexplained: false,
      lesson:
        "High confidence off two prior results was the error, not the number. Two " +
        "points give a direction and no spread.",
    }
  : {
      direction: "slower",
      severity: "significant",
      candidate_causes: [],
      unexplained: true,
      lesson: "Nothing in the file explains this one. High confidence off two results was the error.",
    };

const graceResults = resultsFor("grace");
const lastGrace = graceResults[graceResults.length - 1]!;
const lastDay = iso(dayAt(DAYS - 1)).slice(0, 10);
const open: PredictionT = {
  id: `pred-${lastDay}-grace`,
  benchmark: "grace",
  created_at: at(DAYS - 1, 9, 0),
  predicted: { duration_s: lastGrace.result.duration_s! - 6 },
  range: {
    low: { duration_s: lastGrace.result.duration_s! - 14 },
    high: { duration_s: lastGrace.result.duration_s! + 4 },
  },
  confidence: "low",
  reasoning:
    "Two prior Graces, and the second was 11 seconds faster than the first. The last " +
    "one was three months ago and there has been no barbell work logged since, so the " +
    "range is wide and the confidence is low.",
  evidence_window: { from: iso(dayAt(DAYS - EVIDENCE_DAYS)).slice(0, 10), to: lastDay },
  model: "claude-sonnet-4-5",
  agent: "Claude Code",
  ath_version: ATHLETIC_STANDARD_VERSION,
  actual: null,
  grade: null,
  miss_analysis: null,
};

const predictions = [hit, miss, open].sort((a, b) => a.created_at.localeCompare(b.created_at));

// The device index (D51). A real import accumulates this while streaming; the fixture
// derives it from what it just wrote, which is the same thing measured after the fact.
const whoopDays = hard
  .filter((s) => s.source === "whoop-1")
  .map((s) => signalOrder(s).slice(0, 10))
  .sort();

const file: AthleticStandardFileT = {
  athleticstandard_version: ATHLETIC_STANDARD_VERSION,
  athlete: { name: "Demo Athlete", birth_year: 1991, sex: "male", units: "metric" },
  sources: [
    {
      id: "whoop-1",
      kind: "wearable",
      vendor: "whoop",
      detail: "WHOOP 4.0 via CSV export (synthetic fixture data)",
      devices: [
        {
          name: "WHOOP",
          manufacturer: "WHOOP",
          model: "4.0",
          from: whoopDays[0]!,
          to: whoopDays[whoopDays.length - 1]!,
          n: whoopDays.length,
        },
      ],
    },
    { id: "manual-1", kind: "manual", detail: "Hand-entered benchmark results" },
  ],
  hard_signals: hard.sort((a, b) => signalOrder(a).localeCompare(signalOrder(b))),
  soft_signals: soft.sort((a, b) => a.reported_at.localeCompare(b.reported_at)),
  benchmarks: [
    {
      id: "fran",
      kind: "named_wod",
      score_type: "time",
      definition: "21-15-9 reps for time: thrusters 95/65 lb (43/29 kg), pull-ups",
      tags: ["short", "high-power"],
    },
    {
      id: "grace",
      kind: "named_wod",
      score_type: "time",
      definition: "30 clean and jerks for time, 135/95 lb (61/43 kg)",
      tags: ["short", "barbell"],
    },
    {
      id: "helen",
      kind: "named_wod",
      score_type: "time",
      definition: "3 rounds for time: 400m run, 21 kettlebell swings 53/35 lb, 12 pull-ups",
      tags: ["medium", "mixed-modal"],
    },
    {
      id: "5k-run",
      kind: "run",
      score_type: "time",
      definition: "5 kilometer run for time",
      tags: ["endurance"],
    },
  ],
  predictions,
};

const result = validateAthleticStandardFile(file);
if (!result.valid) {
  console.error("fixture failed validation:", result.issues);
  process.exit(1);
}

const outDir = join(root, "examples", "demo-athlete");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "athlete.ath.json"), JSON.stringify(file, null, 2) + "\n");
console.log(
  `wrote examples/demo-athlete/athlete.ath.json — ` +
    `${file.hard_signals.length} hard signals, ${file.soft_signals.length} soft signals, ` +
    `${benchmarkPlan.length} benchmark results, ${predictions.length} predictions ` +
    `(${predictions.filter((p) => p.grade !== null).length} graded)`,
);
