/**
 * Generates examples/demo-athlete/athlete.athleticstandard.json — a synthetic but realistic
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
import type { AthleticStandardFileT, HardSignalT, SoftSignalT } from "../src/schema.js";
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

for (const b of benchmarkPlan) {
  // A bad night before a benchmark costs 4-9%
  const penalty = badNight.has(b.day - 1) || badNight.has(b.day) ? between(1.04, 1.09) : 1.0;
  const duration = Math.round(b.base * penalty * gaussish(1, 0.012));
  hard.push({
    type: "benchmark_result",
    benchmark: b.id,
    recorded_at: at(b.day, 18, 15),
    source: "manual-1",
    result: { duration_s: duration },
    scaling: "rx",
    ...(b.note ? { note: b.note } : {}),
  });
}

const file: AthleticStandardFileT = {
  athleticstandard_version: ATHLETIC_STANDARD_VERSION,
  athlete: { name: "Demo Athlete", birth_year: 1991, sex: "male", units: "metric" },
  sources: [
    {
      id: "whoop-1",
      kind: "wearable",
      vendor: "whoop",
      detail: "WHOOP 4.0 via CSV export (synthetic fixture data)",
    },
    { id: "manual-1", kind: "manual", detail: "Hand-entered benchmark results" },
  ],
  hard_signals: hard.sort((a, b) =>
    ("recorded_at" in a ? a.recorded_at : a.start).localeCompare(
      "recorded_at" in b ? b.recorded_at : b.start,
    ),
  ),
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
  predictions: [],
};

const result = validateAthleticStandardFile(file);
if (!result.valid) {
  console.error("fixture failed validation:", result.issues);
  process.exit(1);
}

const outDir = join(root, "examples", "demo-athlete");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "athlete.athleticstandard.json"), JSON.stringify(file, null, 2) + "\n");
console.log(
  `wrote examples/demo-athlete/athlete.athleticstandard.json — ` +
    `${file.hard_signals.length} hard signals, ${file.soft_signals.length} soft signals, ` +
    `${benchmarkPlan.length} benchmark results`,
);
