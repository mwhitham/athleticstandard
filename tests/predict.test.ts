import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AthleticStandardFileT } from "../src/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const FIXTURE = resolve(here, "../examples/demo-athlete/athlete.ath.json");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

/** A copy of the fixture in its own directory, so a test can edit it freely. */
function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-predict-"));
  writeFileSync(join(dir, "athlete.ath.json"), readFileSync(FIXTURE, "utf8"));
  return dir;
}

function newAthlete(): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-predict-"));
  expect(ath(["init", "-y"], dir).code).toBe(0);
  return dir;
}

function read(dir: string): AthleticStandardFileT {
  return JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8"));
}

function write(dir: string, file: AthleticStandardFileT): void {
  writeFileSync(join(dir, "athlete.ath.json"), JSON.stringify(file, null, 2));
}

describe("ath predict — the evidence package", () => {
  it("prints all four sections, and says it is not the prediction", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("## 1. Every result on this benchmark");
    expect(res.stdout).toContain("## 2. The last 28 days, day by day");
    expect(res.stdout).toContain("## 3. Long-range averages");
    expect(res.stdout).toContain("## 4. Past predictions on this benchmark");
    expect(res.stdout).toContain("turning evidence into a number needs an agent");
  });

  it("carries the rows a summary rests on, not only the summary", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    // A baseline and its receipt.
    expect(res.stdout).toMatch(/whoop-1 hrv_rmssd: [\d.]+ms\*\* \(sd [\d.]+\)/);
    expect(res.stdout).toMatch(/n=\d+, \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);
    // The day-by-day rows those numbers came from.
    expect(res.stdout).toContain("| day        | source  |");
    expect(res.stdout).toMatch(/\| 2026-07-2\d \| whoop-1 \|/);
    // Self-reported entries, word for word.
    expect(res.stdout).toContain(`"neighbor's dog"`);
  });

  it("keeps the reading it used clear where a word could mean two things", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    expect(res.stdout).toContain("sleep of time in bed");
    expect(res.stdout).toContain("one source only, never pooled across devices");
  });

  it("hides everything after --as-of", () => {
    const early = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2025-07-01"], process.cwd());
    expect(early.stdout).toContain("2025-06-25");
    expect(early.stdout).not.toContain("2026-06-02");

    const late = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    expect(late.stdout).toContain("2026-06-02");
  });

  it("refuses an --as-of that is not a calendar date", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "09-04-2026"], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("YYYY-MM-DD");
  });

  it("names the gap when days in the window have no data", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    expect(res.stdout).toContain("## What is missing");
    expect(res.stdout).toMatch(/of the 28 days from 2026-07-14 to 2026-08-10 have no measurements/);
  });

  it("says so when the benchmark has one result, and when it has none", () => {
    const dir = copyFixture();
    const file = read(dir);
    file.hard_signals = file.hard_signals.filter(
      (s) => s.type !== "benchmark_result" || s.benchmark !== "fran" || s.recorded_at.startsWith("2025-06"),
    );
    write(dir, file);
    expect(ath(["predict", "fran", "--as-of", "2026-08-10"], dir).stdout).toContain(
      "Only one prior result on this benchmark",
    );

    const empty = newAthlete();
    expect(ath(["predict", "fran"], empty).stdout).toContain("No prior result on this benchmark");
  });

  it("names two sources that disagree rather than picking one", () => {
    const dir = copyFixture();
    const file = read(dir);
    file.sources.push({ id: "ring-1", kind: "wearable", vendor: "oura", writer: "Oura" });
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.parse("2026-06-25T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
      file.hard_signals.push({
        type: "hrv_rmssd",
        value: 92 + (i % 3),
        unit: "ms",
        recorded_at: `${day}T06:00:00Z`,
        source: "ring-1",
      });
    }
    write(dir, file);
    const res = ath(["predict", "fran", "--as-of", "2026-08-10"], dir);
    expect(res.stdout).toContain("sources measure hrv_rmssd and they disagree");
    expect(res.stdout).toContain("They are never pooled");
  });

  it("names an unknown benchmark, with the closest ones", () => {
    const res = ath(["predict", "frans", "--file", FIXTURE], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no benchmark called 'frans'");
    expect(res.stdout).toContain("fran");
  });

  it("never modifies the file", () => {
    const dir = copyFixture();
    const before = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(ath(["predict", "fran", "--as-of", "2026-08-10"], dir).code).toBe(0);
    expect(ath(["predict", "fran", "--json"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "athlete.ath.json"), "utf8")).toBe(before);
  });

  it("carries the same evidence as data under --json", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10", "--json"], process.cwd());
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.benchmark.id).toBe("fran");
    expect(out.as_of).toBe("2026-08-10");
    expect(out.history.rows.length).toBeGreaterThan(1);
    expect(out.history.total).toBe(out.history.shown);
    expect(out.days.length).toBeGreaterThan(1);
    expect(out.coverage).toMatchObject({ to: "2026-08-10" });
    expect(out.coverage.days_expected).toBe(28);
    expect(out.baselines[0].coverage).toMatchObject({ source: "whoop-1" });
    expect(out.baselines[0].coverage.n).toBeGreaterThan(0);
    expect(out.gaps.length).toBeGreaterThan(0);
    expect(out.track_record[0]).toMatchObject({
      by: "Claude Code running claude-sonnet-4-5, on ath 0.3.0",
    });
  });

  it("shows vendor scores in the day rows, labelled as not measured (D70)", () => {
    const dir = copyFixture();
    const file = read(dir);
    file.hard_signals.push(
      {
        type: "vendor_score",
        metric: "recovery",
        value: 34,
        scale: "0-100",
        recorded_at: "2026-08-09T06:30:00Z",
        source: "whoop-1",
      },
      {
        type: "vendor_score",
        metric: "recovery",
        value: 81,
        scale: "0-100",
        recorded_at: "2026-08-10T06:30:00Z",
        source: "whoop-1",
      },
    );
    write(dir, file);

    const res = ath(["predict", "fran", "--as-of", "2026-08-10"], dir);
    expect(res.stdout).toContain("vendor score (not measured)");
    expect(res.stdout).toContain("recovery 34 (0-100)");
    expect(res.stdout).toContain("may corroborate a claim and cannot be the basis of one");

    const json = JSON.parse(ath(["predict", "fran", "--as-of", "2026-08-10", "--json"], dir).stdout);
    const day = json.days.find((d: { day: string }) => d.day === "2026-08-09");
    expect(day.vendor).toEqual([
      { source: "whoop-1", metric: "recovery", value: 34, scale: "0-100" },
    ]);
  });

  it("says what the day-by-day window rests on (D47)", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10"], process.cwd());
    expect(res.stdout).toMatch(/n=\d+, 2026-07-14 → 2026-08-10, \d+\/28 days/);
  });

  it("shows the most recent results and says how many it left out (D71)", () => {
    const dir = copyFixture();
    const file = read(dir);
    // Twenty-five weekly attempts, so the cap of twenty bites.
    for (let i = 0; i < 25; i++) {
      const day = new Date(Date.parse("2026-01-07T00:00:00Z") + i * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      file.hard_signals.push({
        type: "benchmark_result",
        benchmark: "grace",
        recorded_at: `${day}T17:30:00Z`,
        source: "manual-1",
        result: { duration_s: 180 + i },
      });
    }
    write(dir, file);

    const res = ath(["predict", "grace", "--as-of", "2026-08-10"], dir);
    expect(res.stdout).toContain("## 1. Recent results on this benchmark");
    expect(res.stdout).toMatch(/Showing the 20 most recent of \d+ results on this benchmark/);
    expect(res.stdout).toContain("`ath stats` counts them all");

    const json = JSON.parse(ath(["predict", "grace", "--as-of", "2026-08-10", "--json"], dir).stdout);
    expect(json.history.shown).toBe(20);
    expect(json.history.total).toBeGreaterThan(20);
  });

  it("shows a past prediction, its grade and its lesson", () => {
    const dir = copyFixture();
    const file = read(dir);
    file.predictions.push({
      id: "p-1",
      benchmark: "fran",
      created_at: "2026-06-01T08:00:00Z",
      predicted: { duration_s: 290 },
      range: { low: { duration_s: 280 }, high: { duration_s: 300 } },
      confidence: "moderate",
      reasoning: "hrv steady at 63ms through May",
      evidence_window: { from: "2026-03-01", to: "2026-06-01" },
      model: "test",
      agent: "test-harness",
      // The fixture's own Fran result, which is what a graded prediction points at (D64).
      actual: { result: { duration_s: 275 }, recorded_at: "2026-06-02T17:54:25Z" },
      grade: { signed_error: 15, abs_error_pct: 5.5, in_range: false },
      miss_analysis: {
        direction: "faster",
        severity: "significant",
        candidate_causes: [],
        unexplained: true,
        lesson: "this athlete beats a steady-HRV prediction on short benchmarks",
      },
    });
    write(dir, file);
    const res = ath(["predict", "fran", "--as-of", "2026-08-10"], dir);
    expect(res.stdout).toContain("2026-06-01 predicted 4:50, actual 4:35");
    expect(res.stdout).toContain("miss, off by 5.5%");
    expect(res.stdout).toContain("lesson: this athlete beats a steady-HRV prediction");
  });
});
