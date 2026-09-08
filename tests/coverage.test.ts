import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { coverageOf, daysBetween, renderCoverage, RULES } from "../src/coverage.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const EXPORTS = resolve(here, "fixtures/exports");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

describe("coverageOf", () => {
  it("counts observations, the window, and the days actually present", () => {
    const c = coverageOf(
      [
        { at: "2026-08-01T06:00:00Z" },
        { at: "2026-08-01T22:00:00Z" },
        { at: "2026-08-05T06:00:00Z" },
      ],
      "whoop-1",
      RULES.perSource,
    )!;
    expect(c).toMatchObject({
      n: 3,
      from: "2026-08-01",
      to: "2026-08-05",
      days_present: 2,
      days_expected: 5,
      source: "whoop-1",
    });
  });

  it("finds the ends of the window by instant, not by comparing day strings", () => {
    // 2026-08-30T20:00:00-07:00 is 2026-08-31T03:00Z, so it is the later reading
    // while naming the earlier local day. Sorting the strings gets this backwards.
    const c = coverageOf(
      [{ at: "2026-08-31T01:00:00Z" }, { at: "2026-08-30T20:00:00-07:00" }],
      "whoop-1",
      RULES.perSource,
    )!;
    expect(c.to).toBe("2026-08-30");
  });

  it("has nothing to say about nothing", () => {
    expect(coverageOf([], "whoop-1", RULES.perSource)).toBeNull();
  });

  it("counts both ends of a window as days", () => {
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(1);
    expect(daysBetween("2026-08-01", "2026-08-03")).toBe(3);
  });

  it("names the rule and hides the gap only when there is none", () => {
    const full = coverageOf(
      [{ at: "2026-08-01T06:00:00Z" }, { at: "2026-08-02T06:00:00Z" }],
      "whoop-1",
      RULES.sleepDuration,
    )!;
    expect(renderCoverage(full)).toBe(
      "n=2, 2026-08-01 → 2026-08-02, whoop-1 — actual sleep, excluding time awake — not time in bed",
    );

    const gappy = coverageOf(
      [{ at: "2026-08-01T06:00:00Z" }, { at: "2026-08-05T06:00:00Z" }],
      "whoop-1",
      RULES.perSource,
    )!;
    expect(renderCoverage(gappy)).toContain("2/5 days");
  });
});

describe("--json on every command (D47)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ath-coverage-"));
    expect(ath(["init", "-y", "--json"], dir).code).toBe(0);
    expect(ath(["import", join(EXPORTS, "apple/export.xml"), "--json"], dir).code).toBe(0);
  });

  it("init reports what it created without asking anything", () => {
    const fresh = mkdtempSync(join(tmpdir(), "ath-coverage-init-"));
    const out = JSON.parse(ath(["init", "--json"], fresh).stdout);
    expect(out.created).toContain("athlete.ath.json");
    expect(out.benchmarks.length).toBeGreaterThan(0);
  });

  it("check reports the file's own version and its issues as data", () => {
    const out = JSON.parse(ath(["check", "--json"], dir).stdout);
    expect(out.valid).toBe(true);
    expect(out.athleticstandard_version).toBe(
      JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8")).athleticstandard_version,
    );
    expect(Array.isArray(out.issues)).toBe(true);
  });

  it("import reports what it added, what it first saw, and the series coverage", () => {
    const fresh = mkdtempSync(join(tmpdir(), "ath-coverage-import-"));
    expect(ath(["init", "-y"], fresh).code).toBe(0);
    const out = JSON.parse(ath(["import", join(EXPORTS, "apple/export.xml"), "--json"], fresh).stdout);
    expect(out.imported).toContain("Apple Health");
    expect(Object.keys(out.added)).toContain("apple-watch-1");
    expect(out.first_seen.sources).toContain("apple-watch-1");
    const hr = out.series_coverage.find(
      (s: { quantity: string; source: string }) => s.quantity === "heart_rate" && s.source === "apple-watch-1",
    );
    expect(hr.coverage).toMatchObject({ source: "apple-watch-1" });
    expect(hr.coverage.rule).toContain("heart_rate");
  });

  it("stats carries a coverage record beside every baseline and series", () => {
    const out = JSON.parse(ath(["stats", "--json"], dir).stdout);
    for (const b of out.baselines) {
      expect(b.coverage).toMatchObject({ source: b.source });
      expect(typeof b.coverage.n).toBe("number");
      expect(typeof b.coverage.days_expected).toBe("number");
      expect(b.coverage.rule).toContain(b.type);
    }
    for (const s of out.series) {
      expect(s.coverage.source).toBe(s.source);
      expect(typeof s.coverage.days_present).toBe("number");
    }
    // The device index travels with the source it describes.
    const watch = out.sources.find((s: { id: string }) => s.id === "apple-watch-1");
    expect(watch.devices[0]).toMatchObject({ hardware: "Watch6,2" });
    expect(watch.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("series carries coverage per source, never pooled across them", () => {
    const out = JSON.parse(ath(["series", "heart_rate", "--json"], dir).stdout);
    expect(out.coverage.length).toBeGreaterThan(0);
    for (const c of out.coverage) {
      expect(typeof c.source).toBe("string");
      expect(c.n).toBeGreaterThan(0);
    }
    // One record per source, so two devices never share a count.
    expect(new Set(out.coverage.map((c: { source: string }) => c.source)).size).toBe(
      out.coverage.length,
    );
  });

  it("says the same thing in text, so a person is not left with a bare number", () => {
    const text = ath(["stats"], dir).stdout;
    expect(text).toMatch(/n=\d+, \d{4}-\d{2}-\d{2}/);
    expect(text).toContain("from this source alone");
  });
});
