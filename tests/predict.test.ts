import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ATHLETIC_STANDARD_VERSION, type AthleticStandardFileT } from "../src/schema.js";
import { loadFile } from "../src/file.js";
import { evidenceFor } from "../src/context.js";
import {
  evidenceAsJson,
  benchmarkOrRefuse,
  parseModelAnswer,
  planPredict,
  renderEvidence,
} from "../src/predict.js";
import { applyDraft } from "../src/log.js";
import { useCatalog, useCompleter } from "../src/gateway.js";
import { MemorySecretStore, useSecretStore } from "../src/keyring.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const FIXTURE = resolve(here, "../examples/demo-athlete/athlete.ath.json");

const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.AI_GATEWAY_API_KEY;
delete CLEAN_ENV.VERCEL_AI_GATEWAY_API_KEY;
delete CLEAN_ENV.OPENROUTER_API_KEY;

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", env: CLEAN_ENV });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

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

function evidenceOf(path: string, id: string, asOf: string) {
  const file = loadFile(path);
  return evidenceFor(file, path, benchmarkOrRefuse(file, id), asOf);
}

function evidenceText(path: string, id: string, asOf: string): string {
  return renderEvidence(evidenceOf(path, id, asOf));
}

afterEach(() => {
  useCompleter(undefined);
  useCatalog(undefined);
  useSecretStore(undefined);
});

describe("ath predict --json — evidence for a harness", () => {
  it("prints evidence and says it is not a prediction", () => {
    const res = ath(
      ["predict", "fran", "--file", FIXTURE, "--as-of", "2026-08-10", "--json"],
      process.cwd(),
    );
    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.kind).toBe("evidence");
    expect(out.note).toMatch(/not a prediction/i);
    expect(out.benchmark.id).toBe("fran");
    expect(out.as_of).toBe("2026-08-10");
    expect(out.history.rows.length).toBeGreaterThan(1);
    expect(out.days.length).toBeGreaterThan(1);
    expect(out.coverage).toMatchObject({ to: "2026-08-10" });
    expect(out.coverage.days_expected).toBe(28);
    expect(out.baselines[0].coverage).toMatchObject({ source: "whoop-1" });
    expect(out.gaps.length).toBeGreaterThan(0);
    expect(out.track_record[0]).toMatchObject({
      by: `Claude Code running claude-sonnet-4-5, on ath ${ATHLETIC_STANDARD_VERSION}`,
    });
  });

  it("works without a gateway key", () => {
    const dir = newAthlete();
    const res = ath(["predict", "fran", "--json"], dir);
    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout).kind).toBe("evidence");
  });
});

describe("ath predict — a prediction needs a model", () => {
  it("refuses a bare terminal run without a key", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("ath key set");
    expect(res.stdout).toMatch(/Claude Code|Cursor|Codex/);
    expect(res.stdout).toContain("--json");
    expect(res.stdout).not.toContain("## 1.");
  });

  it("never modifies the file when it refuses or when it prints evidence", () => {
    const dir = copyFixture();
    const before = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(ath(["predict", "fran", "--as-of", "2026-08-10"], dir).code).toBe(1);
    expect(ath(["predict", "fran", "--json"], dir).code).toBe(0);
    expect(readFileSync(join(dir, "athlete.ath.json"), "utf8")).toBe(before);
  });

  it("names an unknown benchmark, with the closest ones", () => {
    const res = ath(["predict", "frans", "--file", FIXTURE], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no benchmark called 'frans'");
    expect(res.stdout).toContain("fran");
  });

  it("refuses an --as-of that is not a calendar date", () => {
    const res = ath(["predict", "fran", "--file", FIXTURE, "--as-of", "09-04-2026"], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("YYYY-MM-DD");
  });
});

describe("the evidence rows (D9 planted contradiction)", () => {
  it("prints all four sections, and says it is not the prediction", () => {
    const text = evidenceText(FIXTURE, "fran", "2026-08-10");
    expect(text).toContain("## 1. Every result on this benchmark");
    expect(text).toContain("## 2. The last 28 days, day by day");
    expect(text).toContain("## 3. Long-range averages");
    expect(text).toContain("## 4. Past predictions on this benchmark");
    expect(text).toMatch(/not a prediction/i);
  });

  it("carries the rows a summary rests on, not only the summary", () => {
    const text = evidenceText(FIXTURE, "fran", "2026-08-10");
    expect(text).toMatch(/whoop-1 hrv_rmssd: [\d.]+ms\*\* \(sd [\d.]+\)/);
    expect(text).toMatch(/n=\d+, \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);
    expect(text).toContain("| day        | source  |");
    expect(text).toMatch(/\| 2026-07-2\d \| whoop-1 \|/);
    expect(text).toContain(`"neighbor's dog"`);
  });

  it("shows two short nights in the rows, not only a tidy average (D9)", () => {
    const ev = evidenceOf(FIXTURE, "fran", "2026-08-01");
    const short = ev.days.flatMap((d) => d.sleep).filter((s) => (s.duration_s ?? 0) < 6 * 3600);
    expect(short.length).toBeGreaterThanOrEqual(2);
    const text = renderEvidence(ev);
    expect(text).toContain("sleep of time in bed");
    expect(text).toMatch(/\d+h\d+m of \d+h\d+m/);
  });

  it("keeps the reading it used clear where a word could mean two things", () => {
    const text = evidenceText(FIXTURE, "fran", "2026-08-10");
    expect(text).toContain("sleep of time in bed");
    expect(text).toContain("one source only, never pooled across devices");
  });

  it("hides everything after --as-of", () => {
    expect(evidenceText(FIXTURE, "fran", "2025-07-01")).toContain("2025-06-25");
    expect(evidenceText(FIXTURE, "fran", "2025-07-01")).not.toContain("2026-06-02");
    expect(evidenceText(FIXTURE, "fran", "2026-08-10")).toContain("2026-06-02");
  });

  it("names the gap when days in the window have no data", () => {
    const text = evidenceText(FIXTURE, "fran", "2026-08-10");
    expect(text).toContain("## What is missing");
    expect(text).toMatch(/of the 28 days from 2026-07-14 to 2026-08-10 have no measurements/);
  });

  it("says so when the benchmark has one result, and when it has none", () => {
    const dir = copyFixture();
    const file = read(dir);
    file.hard_signals = file.hard_signals.filter(
      (s) => s.type !== "benchmark_result" || s.benchmark !== "fran" || s.recorded_at.startsWith("2025-06"),
    );
    write(dir, file);
    expect(evidenceText(join(dir, "athlete.ath.json"), "fran", "2026-08-10")).toContain(
      "Only one prior result on this benchmark",
    );

    const empty = newAthlete();
    expect(evidenceText(join(empty, "athlete.ath.json"), "fran", "2026-09-13")).toContain(
      "No prior result on this benchmark",
    );
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
    const text = evidenceText(join(dir, "athlete.ath.json"), "fran", "2026-08-10");
    expect(text).toContain("sources measure hrv_rmssd and they disagree");
    expect(text).toContain("They are never pooled");
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

    const path = join(dir, "athlete.ath.json");
    const text = evidenceText(path, "fran", "2026-08-10");
    expect(text).toContain("vendor score (not measured)");
    expect(text).toContain("recovery 34 (0-100)");
    expect(text).toContain("may corroborate a claim and cannot be the basis of one");

    const json = evidenceAsJson(evidenceOf(path, "fran", "2026-08-10"));
    const day = (json.days as { day: string; vendor: unknown }[]).find((d) => d.day === "2026-08-09");
    expect(day?.vendor).toEqual([{ source: "whoop-1", metric: "recovery", value: 34, scale: "0-100" }]);
  });

  it("says what the day-by-day window rests on (D47)", () => {
    const text = evidenceText(FIXTURE, "fran", "2026-08-10");
    expect(text).toMatch(/n=\d+, 2026-07-14 → 2026-08-10, \d+\/28 days/);
  });

  it("shows the most recent results and says how many it left out (D71)", () => {
    const dir = copyFixture();
    const file = read(dir);
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

    const path = join(dir, "athlete.ath.json");
    const text = evidenceText(path, "grace", "2026-08-10");
    expect(text).toContain("## 1. Recent results on this benchmark");
    expect(text).toMatch(/Showing the 20 most recent of \d+ results on this benchmark/);
    expect(text).toContain("`ath stats` counts them all");

    const json = evidenceAsJson(evidenceOf(path, "grace", "2026-08-10"));
    expect((json.history as { shown: number; total: number }).shown).toBe(20);
    expect((json.history as { shown: number; total: number }).total).toBeGreaterThan(20);
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
    const text = evidenceText(join(dir, "athlete.ath.json"), "fran", "2026-08-10");
    expect(text).toContain("2026-06-01 predicted 4:50, actual 4:35");
    expect(text).toContain("miss, off by 5.5%");
    expect(text).toContain("lesson: this athlete beats a steady-HRV prediction");
  });
});

describe("ath predict — a fake gateway writes a signed number", () => {
  it("writes a prediction through applyDraft with agent ath predict", async () => {
    const dir = copyFixture();
    const path = join(dir, "athlete.ath.json");
    useSecretStore(new MemorySecretStore());
    useCatalog(async () => [{ id: "qwen/qwen3-235b-a22b" }]);
    useCompleter(async () => ({
      model: "qwen/qwen3-235b-a22b",
      content: JSON.stringify({
        value: 275,
        low: 265,
        high: 290,
        confidence: "moderate",
        reasoning: "Four prior Frans, last 4:35 on 2026-06-02, HRV near the 90-day mean.",
      }),
    }));

    const file = loadFile(path);
    const before = file.predictions.length;
    const plan = await planPredict(file, path, benchmarkOrRefuse(file, "fran"), {
      asOf: "2026-08-10",
      model: "qwen/qwen3-235b-a22b",
    });
    expect(plan.prediction.predicted.duration_s).toBe(275);
    expect(plan.prediction.agent).toBe("ath predict");
    expect(plan.prediction.model).toBe("qwen/qwen3-235b-a22b");
    expect(plan.canWrite).toBe(true);

    applyDraft(file, plan.draft);
    expect(file.predictions.length).toBe(before + 1);
    expect(file.predictions.at(-1)?.id).toBe(plan.prediction.id);
  });

  it("--as-of does not write", async () => {
    const dir = copyFixture();
    const path = join(dir, "athlete.ath.json");
    useCatalog(async () => [{ id: "openai/gpt-oss-120b" }]);
    useCompleter(async () => ({
      model: "openai/gpt-oss-120b",
      content: JSON.stringify({
        value: 280,
        low: 270,
        high: 295,
        confidence: "low",
        reasoning: "Only what was knowable on 2026-06-01.",
      }),
    }));
    const file = loadFile(path);
    const plan = await planPredict(file, path, benchmarkOrRefuse(file, "fran"), {
      asOf: "2026-06-01",
      asOfPassed: true,
      model: "openai/gpt-oss-120b",
    });
    expect(plan.canWrite).toBe(false);
    expect(plan.holdReason).toContain("ath backtest");
  });

  it("reads a clock written as 4:35", () => {
    const parsed = parseModelAnswer(
      '```json\n{"value":"4:35","low":"4:25","high":"4:45","confidence":"high","reasoning":"cited 2026-06-02 4:35"}\n```',
      "time",
    );
    expect(parsed.value).toBe(275);
    expect(parsed.low).toBe(265);
    expect(parsed.high).toBe(285);
  });
});
