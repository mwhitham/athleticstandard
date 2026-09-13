import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { loadFile } from "../src/file.js";
import { useCatalog, useCompleter } from "../src/gateway.js";
import { MemorySecretStore, useSecretStore } from "../src/keyring.js";
import {
  planBacktest,
  replayableResults,
  runBacktest,
  writeReport,
} from "../src/backtest.js";
import { latestReport, shareRefusal } from "../src/share.js";

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

afterEach(() => {
  useCompleter(undefined);
  useCatalog(undefined);
  useSecretStore(undefined);
});

describe("ath backtest — needs a model", () => {
  it("refuses without a key", () => {
    const res = ath(["backtest", "--file", FIXTURE], process.cwd());
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("ath key set");
  });

  it("replays only results that have an earlier result on the same benchmark (D10)", () => {
    const file = loadFile(FIXTURE);
    const { targets, skipped } = replayableResults(file);
    expect(skipped).toBeGreaterThan(0);
    expect(targets.length).toBeGreaterThan(0);
    const firstFran = file.hard_signals.find(
      (s): s is Extract<typeof s, { type: "benchmark_result" }> =>
        s.type === "benchmark_result" && s.benchmark === "fran",
    );
    expect(targets.some((t) => t.recorded_at === firstFran?.recorded_at)).toBe(false);
  });

  it("ranks two models and does not write the athlete file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-backtest-"));
    expect(ath(["init", "-y"], dir).code).toBe(0);
    const path = join(dir, "athlete.ath.json");
    const file = loadFile(path);
    file.hard_signals.push(
      {
        type: "benchmark_result",
        benchmark: "fran",
        recorded_at: "2026-01-01T17:00:00Z",
        source: "manual-1",
        result: { duration_s: 300 },
      },
      {
        type: "benchmark_result",
        benchmark: "fran",
        recorded_at: "2026-03-01T17:00:00Z",
        source: "manual-1",
        result: { duration_s: 290 },
      },
    );
    writeFileSync(path, JSON.stringify(file, null, 2));
    const before = readFileSync(path, "utf8");

    useSecretStore(new MemorySecretStore());
    useCatalog(async () => [{ id: "model-a" }, { id: "model-b" }]);
    useCompleter(async (req) => {
      const value = req.model === "model-a" ? 291 : 400;
      return {
        model: req.model,
        content: JSON.stringify({
          value,
          low: value - 5,
          high: value + 5,
          confidence: "moderate",
          reasoning: `${req.model} cited the 5:00 Fran on 2026-01-01.`,
        }),
      };
    });

    const loaded = loadFile(path);
    const plan = await planBacktest(loaded, path, { models: ["model-a", "model-b"] });
    expect(plan.models).toEqual(["model-a", "model-b"]);
    expect(plan.targets).toHaveLength(1);
    const report = await runBacktest(loaded, path, plan, new Date("2026-09-13T12:00:00Z"));
    expect(report.summary.winner).toBe("model-a");
    expect(report.summary.models).toHaveLength(2);
    expect(report.replays).toHaveLength(2);
    expect(report.summary.n_replayed).toBe(1);
    expect(report.summary.n_skipped).toBe(1);
    const a = report.summary.models.find((m) => m.model === "model-a");
    expect(a?.median_abs_error_pct).toBe(0.3);
    expect(report.summary).not.toHaveProperty("athlete");
    expect(readFileSync(path, "utf8")).toBe(before);

    const reportPath = writeReport(path, report, new Date("2026-09-13T12:00:00Z"));
    expect(reportPath).toMatch(/backtest-\d{4}-\d{2}-\d{2}T\d{6}\.json$/);
    expect(latestReport(path)).toBe(reportPath);
    expect(shareRefusal(reportPath)).toContain(reportPath);
    expect(shareRefusal(reportPath)).toContain("not built");
  });
});

describe("ath share", () => {
  it("refuses and says so", () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-share-"));
    writeFileSync(join(dir, "athlete.ath.json"), readFileSync(FIXTURE, "utf8"));
    const res = ath(["share"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("not built");
  });
});
