import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const FIXTURE = resolve(here, "../examples/demo-athlete/athlete.ath.json");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { status: number; stdout?: string; stderr?: string };
    return { stdout: (err.stdout ?? "") + (err.stderr ?? ""), code: err.status };
  }
}

describe("ath init", () => {
  it("creates a valid file with seeded benchmarks, non-interactively", () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-"));
    const res = ath(["init", "-y", "--name", "Test", "--birth-year", "1990", "--sex", "male"], dir);
    expect(res.code).toBe(0);

    const file = JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8"));
    expect(file.athleticstandard_version).toBeDefined();
    expect(file.athlete.name).toBe("Test");
    expect(file.benchmarks.map((b: { id: string }) => b.id)).toContain("fran");

    const check = ath(["check"], dir);
    expect(check.code).toBe(0);
  });

  it("refuses to overwrite an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-"));
    expect(ath(["init", "-y"], dir).code).toBe(0);
    const second = ath(["init", "-y"], dir);
    expect(second.code).toBe(1);
    expect(second.stdout).toContain("refusing to overwrite");
  });
});

describe("ath check", () => {
  it("passes the fixture file", () => {
    const res = ath(["check", FIXTURE], process.cwd());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("valid Athletic Standard");
  });

  it("fails a tier violation with a pointed message", () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-"));
    const file = JSON.parse(readFileSync(FIXTURE, "utf8"));
    file.hard_signals[0].source = "ghost-device";
    writeFileSync(join(dir, "athlete.ath.json"), JSON.stringify(file));
    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("unknown source");
  });

  it("fails cleanly when no file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ath-"));
    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("ath init");
  });
});

describe("ath stats", () => {
  it("summarizes the fixture with baselines and receipts", () => {
    const res = ath(["stats", FIXTURE], process.cwd());
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("hard signals: 1593");
    expect(res.stdout).toContain("hrv_rmssd");
    expect(res.stdout).toMatch(/90-day baselines \(per source/);
    expect(res.stdout).toMatch(/whoop-1 hrv_rmssd:/);
    expect(res.stdout).toMatch(/n=\d+/);
    expect(res.stdout).toContain("benchmarks defined: 4");
  });
});
