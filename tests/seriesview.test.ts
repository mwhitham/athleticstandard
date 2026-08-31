import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const APPLE = resolve(here, "fixtures/exports/apple");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

describe("ath series", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ath-seriesview-"));
    expect(ath(["init", "-y"], dir).code).toBe(0);
    expect(ath(["import", APPLE], dir).code).toBe(0);
  });

  it("summarizes a quantity one row per day", () => {
    // The figures the document used to store are computed here instead, which is why
    // dropping them cost nothing (D40).
    const res = ath(["series", "heart_rate"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("heart_rate (bpm)");
    // The fixture's four heart-rate samples run 62 to 158.
    expect(res.stdout).toMatch(/2026-08-09\s+n=4\s+min 62\s+max 158\s+mean 88\.75/);
    expect(res.stdout).toContain("4 samples total");
  });

  it("returns the samples themselves with --raw", () => {
    const res = ath(["series", "hrv_beats", "--raw"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("69 samples");
    // Millisecond beat spacing has to survive all the way back out.
    expect(res.stdout).toMatch(/869\.6/);
  });

  it("gives structured output with --json", () => {
    const res = ath(["series", "heart_rate", "--json"], dir);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.quantity).toBe("heart_rate");
    expect(parsed.unit).toBe("bpm");
    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0].n).toBe(4);
    expect(parsed.days[0].mean).toBe(88.75);
  });

  it("narrows to a date range", () => {
    const inside = ath(["series", "heart_rate", "--from", "2026-08-01", "--json"], dir);
    expect(JSON.parse(inside.stdout).days).toHaveLength(1);

    const after = ath(["series", "heart_rate", "--from", "2026-09-01", "--json"], dir);
    expect(JSON.parse(after.stdout).days).toHaveLength(0);

    const before = ath(["series", "heart_rate", "--to", "2026-01-01", "--json"], dir);
    expect(JSON.parse(before.stdout).days).toHaveLength(0);
  });

  it("narrows to one source, so two sensors stay apart", () => {
    // The ECG sensor writes its own beats under its own source (D37).
    const ecg = ath(["series", "ecg_beats", "--source", "apple-ecg-1", "--json"], dir);
    expect(ecg.code).toBe(0);
    expect(JSON.parse(ecg.stdout).days[0].source).toBe("apple-ecg-1");

    const wrong = ath(["series", "ecg_beats", "--source", "apple-1"], dir);
    expect(wrong.code).toBe(1);
    expect(wrong.stdout).toContain("no ecg_beats series recorded for source 'apple-1'");
  });

  it("names the quantities it knows when given one it does not", () => {
    const res = ath(["series", "nonsense"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("unknown quantity 'nonsense'");
    expect(res.stdout).toContain("heart_rate");
  });

  it("says what the file does hold when a known quantity is absent", () => {
    const empty = mkdtempSync(join(tmpdir(), "ath-seriesview-empty-"));
    expect(ath(["init", "-y"], empty).code).toBe(0);
    const res = ath(["series", "heart_rate"], empty);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no heart_rate series in this file");
  });

  it("is pointed at by stats, so the data is discoverable", () => {
    expect(ath(["stats"], dir).stdout).toContain("ath series <quantity>");
  });
});
