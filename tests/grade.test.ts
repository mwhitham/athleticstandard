import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATHLETIC_STANDARD_VERSION, type AthleticStandardFileT, type PredictionT } from "../src/schema.js";
import { parseActual } from "../src/grade.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

const ATTEMPT_DAY = "2026-08-10";

/** A prediction of 4:50 on Fran, with a range of 4:45 to 4:55. */
function prediction(over: Partial<PredictionT> = {}): PredictionT {
  return {
    id: "p-1",
    benchmark: "fran",
    created_at: "2026-08-08T08:00:00Z",
    predicted: { duration_s: 290 },
    range: { low: { duration_s: 285 }, high: { duration_s: 295 } },
    confidence: "moderate",
    reasoning: "hrv steady at 60ms all week",
    evidence_window: { from: "2026-07-01", to: "2026-08-08" },
    model: "test",
    actual: null,
    grade: null,
    miss_analysis: null,
    ...over,
  } as PredictionT;
}

/**
 * A small file with one wearable, a week of readings, and the night before the
 * attempt. Written by hand rather than taken from the fixture so the arithmetic in
 * each assertion is checkable by eye.
 */
function athlete(predictions: PredictionT[]): AthleticStandardFileT {
  const file: AthleticStandardFileT = {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    athlete: { units: "metric" },
    sources: [
      { id: "manual-1", kind: "manual", detail: "Hand-entered data" },
      { id: "whoop-1", kind: "wearable", vendor: "whoop", writer: "WHOOP" },
    ],
    hard_signals: [],
    soft_signals: [],
    benchmarks: [
      { id: "fran", kind: "named_wod", score_type: "time", definition: "21-15-9 thrusters and pull-ups" },
      { id: "cindy", kind: "named_wod", score_type: "reps", definition: "20 min AMRAP" },
      { id: "back-squat", kind: "lift", score_type: "load", definition: "1 rep max" },
    ],
    predictions,
  };

  // Ninety nights of steady readings, so a baseline exists and one bad night stands
  // out against it rather than against nothing.
  for (let i = 90; i >= 0; i--) {
    const day = new Date(Date.parse(`${ATTEMPT_DAY}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    file.hard_signals.push({
      type: "hrv_rmssd",
      value: 60 + (i % 3),
      unit: "ms",
      recorded_at: `${day}T06:10:00Z`,
      source: "whoop-1",
    });
    file.hard_signals.push({
      type: "resting_heart_rate",
      value: 52,
      unit: "bpm",
      recorded_at: `${day}T06:10:00Z`,
      source: "whoop-1",
    });
  }

  file.hard_signals.push({
    type: "sleep_session",
    start: `2026-08-09T23:10:00Z`,
    end: `${ATTEMPT_DAY}T04:20:00Z`,
    source: "whoop-1",
    aggregates: { duration_s: 18_000, time_in_bed_s: 18_600, efficiency_pct: 96.8 },
  });

  return file;
}

function dirWith(file: AthleticStandardFileT): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-grade-"));
  writeFileSync(join(dir, "athlete.ath.json"), JSON.stringify(file, null, 2));
  return dir;
}

function read(dir: string): AthleticStandardFileT {
  return JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8"));
}

/** Grade an attempt on the day the fixtures are built around. */
function grade(file: AthleticStandardFileT, actual: string, extra: string[] = []) {
  const dir = dirWith(file);
  const res = ath(["grade", "fran", "--actual", actual, "--date", ATTEMPT_DAY, ...extra], dir);
  return { dir, res, file: read(dir) };
}

describe("ath grade — measuring the prediction against what happened", () => {
  it("calls a result inside the range a hit, and prints no dossier", () => {
    const { res, file } = grade(athlete([prediction()]), "4:52");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Predicted 4:50, actual 4:52");
    expect(res.stdout).toContain("Inside the stated range of 4:45–4:55. Hit.");
    expect(res.stdout).not.toContain("miss dossier");

    expect(file.predictions[0]!.grade).toMatchObject({ in_range: true, signed_error: -2 });
    expect(file.predictions[0]!.actual!.result).toEqual({ duration_s: 292 });
  });

  it("classifies a miss under 5 percent as minor", () => {
    const { res, file } = grade(athlete([prediction()]), "5:00");
    expect(res.stdout).toContain("A minor miss.");
    expect(file.predictions[0]!.grade).toMatchObject({ in_range: false, abs_error_pct: 3.3 });
  });

  it("classifies a miss between 5 and 15 percent as significant", () => {
    const { res } = grade(athlete([prediction()]), "5:20");
    expect(res.stdout).toContain("off by 30s (9.4%)");
    expect(res.stdout).toContain("A significant miss.");
  });

  it("classifies a miss over 15 percent as severe", () => {
    const { res } = grade(athlete([prediction()]), "6:00");
    expect(res.stdout).toContain("A severe miss.");
  });

  it("treats beating the prediction as the same size of failure as missing it", () => {
    const { res, file } = grade(athlete([prediction()]), "4:05");
    expect(res.stdout).toContain("faster than predicted");
    expect(res.stdout).toContain("A severe miss.");
    expect(file.predictions[0]!.grade!.signed_error).toBe(45);
  });

  it("cannot call a prediction with no stated range a hit (D61)", () => {
    const noRange = prediction();
    delete (noRange as { range?: unknown }).range;
    const { res, file } = grade(athlete([noRange]), "4:50");
    expect(res.stdout).toContain("No range was stated, so this is graded on the error alone");
    expect(file.predictions[0]!.grade).toMatchObject({ in_range: false, abs_error_pct: 0 });
  });

  it("logs the result and stops when no prediction was open", () => {
    const { res, file } = grade(athlete([]), "4:52");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("No prediction was open for it, so there is nothing to grade.");
    const results = file.hard_signals.filter((s) => s.type === "benchmark_result");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ benchmark: "fran", source: "manual-1" });
  });

  it("grades the most recent open prediction and leaves a graded one alone", () => {
    const old = prediction({ id: "p-0", created_at: "2026-07-01T08:00:00Z" });
    old.actual = { result: { duration_s: 300 }, recorded_at: "2026-07-02T17:00:00Z" };
    old.grade = { signed_error: -10, abs_error_pct: 3.3, in_range: false };
    const already = athlete([old, prediction()]);
    // The graded prediction points at a result the file holds, which is the rule the
    // grade itself has to satisfy (D64).
    already.hard_signals.push({
      type: "benchmark_result",
      benchmark: "fran",
      recorded_at: "2026-07-02T17:00:00Z",
      source: "manual-1",
      result: { duration_s: 300 },
    });
    const { file } = grade(already, "4:52");
    expect(file.predictions.find((p) => p.id === "p-0")!.grade!.signed_error).toBe(-10);
    expect(file.predictions.find((p) => p.id === "p-1")!.grade!.in_range).toBe(true);
  });

  it("points the graded prediction at the result it was graded against (D64)", () => {
    const { file } = grade(athlete([prediction()]), "4:52");
    const p = file.predictions[0]!;
    const result = file.hard_signals.find((s) => s.type === "benchmark_result")!;
    expect(p.actual!.recorded_at).toBe(result.recorded_at);
    expect(p.actual!.result).toEqual(result.result);
  });

  it("refuses an attempt dated before the prediction, and writes nothing", () => {
    const dir = dirWith(athlete([prediction()]));
    const res = ath(["grade", "fran", "--actual", "4:52", "--date", "2026-08-01"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("before the prediction was made on 2026-08-08");
    expect(read(dir).hard_signals.filter((s) => s.type === "benchmark_result")).toHaveLength(0);
  });

  it("names an unknown benchmark with the closest ones", () => {
    const dir = dirWith(athlete([]));
    const res = ath(["grade", "frans", "--actual", "4:52"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no benchmark called 'frans'");
    expect(res.stdout).toContain("fran");
  });

  it("points at the session that day when the result is not linked to one", () => {
    const file = athlete([prediction()]);
    file.hard_signals.push({
      type: "workout_session",
      start: `${ATTEMPT_DAY}T17:15:00Z`,
      end: `${ATTEMPT_DAY}T17:45:00Z`,
      source: "whoop-1",
      aggregates: { activity: "crossfit", avg_hr_bpm: 168 },
    });
    const { res } = grade(file, "4:52");
    expect(res.stdout).toContain("ath link fran@2026-08-10 17:15");
  });
});

/** A file whose Fran result on the attempt day is already recorded. */
function withResult(seconds: number, at = `${ATTEMPT_DAY}T17:30:00Z`): AthleticStandardFileT {
  const file = athlete([prediction()]);
  file.hard_signals.push({
    type: "benchmark_result",
    benchmark: "fran",
    recorded_at: at,
    source: "manual-1",
    result: { duration_s: seconds },
  });
  return file;
}

describe("ath grade — a write, so it shows its work first (D65)", () => {
  it("prints the summary of what it will write above the verdict", () => {
    const { res } = grade(athlete([prediction()]), "4:52");
    // Column widths shift with the longest label, so the padding is squeezed out.
    const flat = res.stdout.replace(/[ \t]+/g, " ");
    expect(flat).toContain("kind workout result");
    expect(flat).toContain("score 4:52");
    expect(flat).toContain("name fran");
    expect(flat).toContain("grade against the prediction of 4:50 made on 2026-08-08");
    // The summary comes first: the verdict is what the write causes, not what is
    // being agreed to.
    expect(flat.indexOf("kind workout result")).toBeLessThan(flat.indexOf("Predicted 4:50"));
  });

  it("writes nothing under --dry-run, and shows the question it would ask", () => {
    const dir = dirWith(athlete([prediction()]));
    const res = ath(["grade", "fran", "--actual", "4:52", "--date", ATTEMPT_DAY, "--dry-run"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Save this? [y] yes  [n] no");
    expect(res.stdout).toContain("nothing written (--dry-run)");
    const file = read(dir);
    expect(file.hard_signals.filter((s) => s.type === "benchmark_result")).toHaveLength(0);
    expect(file.predictions[0]!.grade).toBeNull();
  });

  it("attaches the one session that day under --yes", () => {
    const file = athlete([prediction()]);
    file.hard_signals.push({
      type: "workout_session",
      start: `${ATTEMPT_DAY}T17:15:00Z`,
      end: `${ATTEMPT_DAY}T17:45:00Z`,
      source: "whoop-1",
      aggregates: { activity: "crossfit" },
    });
    const { file: after } = grade(file, "4:52", ["--yes"]);
    const result = after.hard_signals.find((s) => s.type === "benchmark_result")!;
    expect(result.session).toEqual({ source: "whoop-1", start: `${ATTEMPT_DAY}T17:15:00Z` });
  });

  it("leaves the session unattached under --yes when two sessions could be it (D68)", () => {
    const file = athlete([prediction()]);
    for (const start of ["07:05", "17:15"]) {
      file.hard_signals.push({
        type: "workout_session",
        start: `${ATTEMPT_DAY}T${start}:00Z`,
        end: `${ATTEMPT_DAY}T${start === "07:05" ? "07:50" : "17:45"}:00Z`,
        source: "whoop-1",
        aggregates: { activity: "crossfit" },
      });
    }
    const { res, file: after } = grade(file, "4:52", ["--yes"]);
    const result = after.hard_signals.find((s) => s.type === "benchmark_result")!;
    expect(result.session).toBeUndefined();
    expect(res.stdout).toContain("picking one is a guess");
  });
});

describe("ath grade — one attempt, one result (D67)", () => {
  it("grades the result already logged rather than writing a second one", () => {
    const { res, file } = grade(withResult(292), "4:52");
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("already logged on that day");
    const results = file.hard_signals.filter((s) => s.type === "benchmark_result");
    expect(results).toHaveLength(1);
    expect(file.predictions[0]!.actual!.recorded_at).toBe(results[0]!.recorded_at);
    expect(file.predictions[0]!.grade!.in_range).toBe(true);
  });

  it("refuses a different score on a day that already has a result", () => {
    const dir = dirWith(withResult(281));
    const res = ath(["grade", "fran", "--actual", "4:52", "--date", ATTEMPT_DAY], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("already has a result on 2026-08-10: 4:41");
    expect(res.stdout).toContain("--again");
    expect(read(dir).hard_signals.filter((s) => s.type === "benchmark_result")).toHaveLength(1);
  });

  it("records a real second attempt when --again says so", () => {
    const { res, file } = grade(withResult(281), "4:52", ["--again"]);
    expect(res.code).toBe(0);
    expect(file.hard_signals.filter((s) => s.type === "benchmark_result")).toHaveLength(2);
  });
});

describe("ath grade — the miss dossier", () => {
  it("carries the day's measurements, the 72 hours before, and the week's unusual days", () => {
    const file = athlete([prediction()]);
    file.soft_signals.push(
      {
        type: "sleep_quality",
        reported_at: `${ATTEMPT_DAY}T07:00:00Z`,
        rating: 1,
        scale: "1-5",
        note: "neighbour's dog again",
        provenance: { via: "text" },
      },
      {
        type: "stress",
        reported_at: "2026-08-01T07:00:00Z",
        rating: 4,
        scale: "1-5",
        note: "too far back to count",
        provenance: { via: "text" },
      },
    );
    // One night far below the steady 60–62 ms, so there is an anomaly to find.
    const crash = file.hard_signals.find(
      (s) => s.type === "hrv_rmssd" && s.recorded_at.startsWith("2026-08-09"),
    ) as { value: number };
    crash.value = 38;

    const { res } = grade(file, "5:20");
    expect(res.stdout).toContain("## The miss dossier");
    expect(res.stdout).toContain("whoop-1 sleep: 5h00m actual sleep of 5h10m in bed");
    expect(res.stdout).toContain("whoop-1 hrv_rmssd: 60 ms");
    expect(res.stdout).toContain(`neighbour's dog again`);
    expect(res.stdout).not.toContain("too far back to count");
    expect(res.stdout).toMatch(/2026-08-09 whoop-1 hrv_rmssd: 38ms against a baseline of/);
    expect(res.stdout).toContain("standard deviations");
    // The baseline the anomaly is measured against says what it rests on (D47).
    expect(res.stdout).toMatch(/n=91, 2026-05-1\d → 2026-08-10, whoop-1 —/);
    expect(res.stdout).toContain("spread of daily hrv_rmssd means over the 90 days to 2026-08-10");
  });

  it("says so plainly when nothing in the week was unusual", () => {
    const { res } = grade(athlete([prediction()]), "5:20");
    expect(res.stdout).toContain("None. Every day sat inside the usual spread.");
    expect(res.stdout).toContain("Nothing self-reported in that window.");
  });

  it("carries the same dossier under --json", () => {
    const { res } = grade(athlete([prediction()]), "5:20", ["--json"]);
    const out = JSON.parse(res.stdout);
    expect(out.severity).toBe("significant");
    expect(out.prediction.grade).toMatchObject({ in_range: false });
    expect(out.dossier.dayOf.length).toBeGreaterThan(0);
    expect(out.dossier.soft).toEqual([]);
  });

  it("gives a hit no dossier under --json either", () => {
    const { res } = grade(athlete([prediction()]), "4:52", ["--json"]);
    expect(JSON.parse(res.stdout)).toMatchObject({ severity: "hit", dossier: null });
  });
});

describe("ath grade --analysis — the agent's half, checked (D62)", () => {
  const analysis = (causes: unknown[], unexplained = false) =>
    JSON.stringify({
      direction: "slower",
      severity: "significant",
      candidate_causes: causes,
      unexplained,
      lesson: "short sleep costs this athlete time on short benchmarks",
    });

  it("attaches an analysis whose causes are all in the file", () => {
    const { dir } = grade(athlete([prediction()]), "5:20");
    const res = ath(
      [
        "grade",
        "fran",
        "--analysis",
        analysis([
          {
            signal: { tier: "hard", type: "sleep_session", date: ATTEMPT_DAY },
            explanation: "5h00m against a 7h baseline",
          },
        ]),
      ],
      dir,
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("analysis attached to 'p-1'");
    expect(read(dir).predictions[0]!.miss_analysis).toMatchObject({
      unexplained: false,
      lesson: "short sleep costs this athlete time on short benchmarks",
    });
  });

  it("refuses a cause the file does not hold", () => {
    const { dir } = grade(athlete([prediction()]), "5:20");
    const res = ath(
      [
        "grade",
        "fran",
        "--analysis",
        analysis([
          { signal: { tier: "soft", type: "soreness", date: ATTEMPT_DAY }, explanation: "invented" },
        ]),
      ],
      dir,
    );
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("this file has no such record");
    expect(read(dir).predictions[0]!.miss_analysis).toBeNull();
  });

  it("accepts no causes at all when the miss is marked unexplained", () => {
    const { dir } = grade(athlete([prediction()]), "5:20");
    const res = ath(["grade", "fran", "--analysis", analysis([], true)], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("marked unexplained");
  });

  it("refuses to analyse a hit", () => {
    const { dir } = grade(athlete([prediction()]), "4:52");
    const res = ath(["grade", "fran", "--analysis", analysis([], true)], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("hits are not analysed");
  });

  it("refuses an analysis before anything has been graded", () => {
    const dir = dirWith(athlete([prediction()]));
    const res = ath(["grade", "fran", "--analysis", analysis([], true)], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no graded prediction on 'fran'");
  });

  it("asks for something to do when given neither an actual nor an analysis", () => {
    const dir = dirWith(athlete([prediction()]));
    const res = ath(["grade", "fran"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("--actual 4:32");
  });
});

describe("reading --actual in the benchmark's own unit", () => {
  it("reads a clock, and seconds carrying their unit", () => {
    expect(parseActual("4:32", "time").score).toEqual({ duration_s: 272 });
    expect(parseActual("1:02:30", "time").score).toEqual({ duration_s: 3750 });
    expect(parseActual("272s", "time").score).toEqual({ duration_s: 272 });
  });

  it("refuses a bare number for a time, naming how to write it", () => {
    expect(() => parseActual("272", "time")).toThrow(/write it as a clock/i);
  });

  it("reads reps with or without the word", () => {
    expect(parseActual("245", "reps").score).toEqual({ reps: 245 });
    expect(parseActual("245 reps", "reps").score).toEqual({ reps: 245 });
  });

  it("refuses a load with no unit, because it is two different numbers", () => {
    expect(() => parseActual("100", "load")).toThrow(/two different numbers/);
    expect(parseActual("100kg", "load").score).toEqual({ weight_kg: 100 });
    expect(parseActual("225lb", "load").score.weight_kg).toBeCloseTo(102.06, 2);
  });

  it("grades a reps benchmark and a load benchmark the same way", () => {
    const file = athlete([
      prediction({ id: "p-reps", benchmark: "cindy", predicted: { reps: 400 }, range: undefined }),
    ]);
    const dir = dirWith(file);
    const res = ath(["grade", "cindy", "--actual", "380", "--date", ATTEMPT_DAY], dir);
    expect(res.stdout).toContain("Predicted 400 reps, actual 380 reps — off by 20 reps (5.3%)");
    expect(read(dir).predictions[0]!.grade).toMatchObject({ signed_error: 20, in_range: false });
  });
});
