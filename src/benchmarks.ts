import type { BenchmarkT } from "./schema.js";

/** Benchmarks seeded by `ath init`. Users add their own; custom ones are first-class. */
export const SEED_BENCHMARKS: BenchmarkT[] = [
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
    id: "murph",
    kind: "named_wod",
    score_type: "time",
    definition:
      "For time: 1 mile run, 100 pull-ups, 200 push-ups, 300 air squats, 1 mile run (partition as needed)",
    tags: ["long", "endurance"],
  },
  {
    id: "5k-run",
    kind: "run",
    score_type: "time",
    definition: "5 kilometer run for time",
    tags: ["endurance"],
  },
  {
    id: "1-mile-run",
    kind: "run",
    score_type: "time",
    definition: "1 mile run for time",
    tags: ["short", "endurance"],
  },
  {
    id: "hyrox-full",
    kind: "hyrox",
    score_type: "time",
    definition:
      "8x (1km run + station): ski erg 1000m, sled push 50m, sled pull 50m, burpee broad jumps 80m, rowing 1000m, farmers carry 200m, sandbag lunges 100m, wall balls 100/75 reps",
    tags: ["long", "endurance", "stations"],
  },
];
