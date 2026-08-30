import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { AthleticStandardFileT } from "../src/schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");
const EXPORTS = resolve(here, "fixtures/exports");
const WHOOP_CSVS = [
  "physiological_cycles.csv",
  "sleeps.csv",
  "workouts.csv",
  "journal_entries.csv",
];

/** Both streams together, because warnings go to stderr even on success. */
function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

/** A fresh athlete file in its own directory. */
function newAthlete(): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-import-"));
  expect(ath(["init", "-y"], dir).code).toBe(0);
  return dir;
}

function read(dir: string): AthleticStandardFileT {
  return JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8"));
}

function pointsOf(file: AthleticStandardFileT, type: string) {
  return file.hard_signals.filter(
    (s): s is Extract<typeof s, { value: number }> => s.type === type && "value" in s,
  );
}

function seriesOf(file: AthleticStandardFileT, quantity: string) {
  return file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "series_ref" }> =>
      s.type === "series_ref" && s.quantity === quantity,
  );
}

function vendorScoresOf(file: AthleticStandardFileT, metric: string) {
  return file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "vendor_score" }> =>
      s.type === "vendor_score" && s.metric === metric,
  );
}

describe("ath import — Apple Health", () => {
  let dir: string;
  let file: AthleticStandardFileT;
  let output: string;

  beforeAll(() => {
    dir = newAthlete();
    const res = ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    expect(res.code).toBe(0);
    output = res.stdout;
    file = read(dir);
  });

  it("converts pounds to kilograms", () => {
    // 181.4 lb × 0.45359237 = 82.28 kg
    expect(pointsOf(file, "body_weight")[0]!.value).toBeCloseTo(82.28, 2);
  });

  it("converts Apple's saturation fraction to a percentage", () => {
    expect(pointsOf(file, "oxygen_saturation")[0]!.value).toBe(97);
  });

  it("keeps wrist temperature apart from body temperature (D28)", () => {
    // Anti-phase signals: merging them would cancel the information out.
    expect(pointsOf(file, "wrist_temperature_sleeping")[0]!.value).toBe(33.4);
    expect(pointsOf(file, "body_temperature")[0]!.value).toBe(36.7);
  });

  it("stores Apple HRV as SDNN and never as RMSSD (D22)", () => {
    const sdnn = pointsOf(file, "hrv_sdnn");
    expect(sdnn.map((s) => s.value)).toEqual([52.3, 41.8]);
    expect(sdnn.every((s) => !("derived" in s && s.derived))).toBe(true);
  });

  it("computes RMSSD from the beat list and marks it derived (D26)", () => {
    const rmssd = pointsOf(file, "hrv_rmssd");
    // One window had 65 usable beats; the other had 4 and must produce nothing.
    expect(rmssd).toHaveLength(1);
    const derived = (rmssd[0] as { derived?: Record<string, unknown> }).derived;
    expect(derived).toBeDefined();
    expect(derived!.from).toBe("hrv_beats");
    expect(derived!.method).toBe("rmssd");
    expect(derived!.n_beats).toBe(65);
    expect(Number(derived!.window_s)).toBeGreaterThan(30);
  });

  it("says plainly when a beat window was too sparse to use", () => {
    expect(output).toContain("HRV beat windows too short or sparse for RMSSD");
  });

  it("splits distance by modality so a triathlete's disciplines stay apart (D29)", () => {
    // 1.24 mi, 14.2 km, and 1200 yd in three separate series.
    expect(seriesOf(file, "distance_walking_running")[0]!.summary.mean).toBeCloseTo(1995.59, 1);
    expect(seriesOf(file, "distance_cycling")[0]!.summary.mean).toBeCloseTo(14200, 1);
    expect(seriesOf(file, "distance_swimming")[0]!.summary.mean).toBeCloseTo(1097.28, 1);
  });

  it("sends dense samples to sidecars rather than the document", () => {
    const beats = seriesOf(file, "hrv_beats");
    expect(beats).toHaveLength(1);
    expect(beats[0]!.n).toBe(69);
    expect(beats[0]!.file).toMatch(/^series\/2026-08-09-hrv_beats-apple-1\.ath\.series\.json$/);

    // The samples are on disk, not inline.
    const raw = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(raw).not.toContain("offsets_ms");
  });

  it("clusters overlapping sleep stage records into one night", () => {
    const sleep = file.hard_signals.filter((s) => s.type === "sleep_session");
    expect(sleep).toHaveLength(1);
    const night = sleep[0] as { start: string; end: string; aggregates: Record<string, number> };
    expect(night.start).toBe("2026-08-08T22:15:00-07:00");
    expect(night.end).toBe("2026-08-09T06:05:00-07:00");
    // Core 2h + deep 1h15 + REM 1h30 + core 2h30 = 7h15 = 26100s asleep.
    expect(night.aggregates.duration_s).toBe(26100);
    expect(night.aggregates.deep_s).toBe(4500);
    expect(night.aggregates.rem_s).toBe(5400);
    expect(night.aggregates.awake_s).toBe(900);
    expect(night.aggregates.interruptions).toBe(1);
  });

  it("turns workout laps into segments", () => {
    const workout = file.hard_signals.find((s) => s.type === "workout_session") as {
      aggregates: Record<string, unknown>;
      segments?: { label: string; duration_s?: number }[];
    };
    expect(workout.aggregates.avg_hr_bpm).toBe(142);
    expect(workout.aggregates.max_hr_bpm).toBe(178);
    expect(workout.segments).toHaveLength(2);
    expect(workout.segments![0]!.duration_s).toBe(600);
  });

  it("summarizes series by quantity rather than one line per file", () => {
    // Years of data means thousands of sidecars. A per-file list floods the
    // terminal with output nobody reads.
    expect(output).toMatch(/wrote 7 series files to series\/:/);
    expect(output).toMatch(/hrv_beats: 69 samples across 1 day/);
    expect(output.split("\n").length).toBeLessThan(30);
  });

  it("counts what it will not guess at instead of guessing", () => {
    expect(output).toContain("unmapped HealthKit type: HeadphoneAudioExposure");
    expect(output).toContain("unmapped HealthKit type: DietaryCaffeine");
    expect(output).toContain("clinical records (out of scope)");
  });

  it("leaves a file that passes check", () => {
    expect(ath(["check"], dir).code).toBe(0);
  });
});

describe("ath import — WHOOP", () => {
  let dir: string;
  let file: AthleticStandardFileT;

  beforeAll(() => {
    dir = newAthlete();
    expect(ath(["import", join(EXPORTS, "whoop")], dir).code).toBe(0);
    file = read(dir);
  });

  it("reads WHOOP HRV as RMSSD", () => {
    expect(pointsOf(file, "hrv_rmssd").map((s) => s.value)).toEqual([68.4, 74.1]);
  });

  it("reads skin temperature as skin, not body, temperature", () => {
    expect(pointsOf(file, "skin_temperature").map((s) => s.value)).toEqual([33.2, 33]);
    expect(pointsOf(file, "body_temperature")).toHaveLength(0);
  });

  it("converts sleep stage minutes to seconds", () => {
    const night = file.hard_signals.find((s) => s.type === "sleep_session") as {
      aggregates: Record<string, number>;
    };
    expect(night.aggregates.duration_s).toBe(415 * 60);
    expect(night.aggregates.deep_s).toBe(95 * 60);
    expect(night.aggregates.efficiency_pct).toBe(88.3);
  });

  it("keeps recovery and strain as vendor scores with their scales (D27)", () => {
    const recovery = vendorScoresOf(file, "recovery");
    expect(recovery.map((s) => s.value)).toEqual([67, 81]);
    expect(recovery[0]!.scale).toBe("0-100");

    // Strain runs 0-21, which is why a bare number needs its scale.
    const strain = vendorScoresOf(file, "strain");
    expect(strain[0]!.scale).toBe("0-21");
    expect(strain.map((s) => s.value)).toEqual([14.2, 9.8]);
  });

  it("never files a vendor score as a measurement", () => {
    // A recovery score of 67 must not be reachable as a point measurement.
    for (const type of ["hrv_rmssd", "resting_heart_rate", "oxygen_saturation"]) {
      expect(pointsOf(file, type).map((s) => s.value)).not.toContain(67);
    }
  });

  it("imports journal answers as soft signals with no source (D30)", () => {
    expect(file.soft_signals).toHaveLength(5);
    for (const signal of file.soft_signals) {
      expect(signal).not.toHaveProperty("source");
      expect(signal.provenance?.via).toBe("text");
    }
  });

  it("maps journal questions honestly and keeps the wording of the rest", () => {
    const byNote = new Map(file.soft_signals.map((s) => [s.note ?? "", s.type]));
    expect(byNote.get("Have any alcoholic drinks?: yes — two beers")).toBe("nutrition");
    expect(byNote.get("Practice mediation or breathwork?: yes — ten minutes")).toBe("stress");
    // No honest category for this one, so it keeps its question text as a note.
    expect(byNote.get("Feeling sick or unwell?: no")).toBe("note");
  });

  it("leaves a file that passes check", () => {
    expect(ath(["check"], dir).code).toBe(0);
  });

  it("handles the in-progress cycle, which has no end time yet", () => {
    // WHOOP leaves `Cycle end time` blank for the cycle you are currently in.
    const trial = newAthlete();
    writeFileSync(
      join(trial, "physiological_cycles.csv"),
      "Cycle start time,Cycle end time,Cycle timezone,Recovery score %,Resting heart rate (bpm),Heart rate variability (ms),Sleep onset,Wake onset\n" +
        "2026-08-29 22:30:00,,UTC-07:00,81,49,74.1,2026-08-29 22:40:00,2026-08-30 06:25:00\n",
    );
    writeFileSync(
      join(trial, "journal_entries.csv"),
      "Cycle start time,Cycle end time,Cycle timezone,Question text,Answered yes,Notes\n" +
        "2026-08-29 22:30:00,,UTC-07:00,Felt stressed today?,true,big deadline\n",
    );

    const res = ath(["import", trial], trial);
    expect(res.code).toBe(0);
    const file = read(trial);
    expect(pointsOf(file, "hrv_rmssd")).toHaveLength(1);
    expect(file.soft_signals).toHaveLength(1);
  });

  it("names the offending value when it cannot read a timestamp", () => {
    // A bare count says a thousand rows failed without saying why.
    const trial = newAthlete();
    writeFileSync(
      join(trial, "physiological_cycles.csv"),
      "Cycle start time,Cycle end time,Cycle timezone,Heart rate variability (ms),Wake onset\n" +
        "2026-08-29 22:30:00,2026-08-30 22:30:00,America/Los_Angeles,74.1,2026-08-30 06:25:00\n",
    );

    const res = ath(["import", trial], trial);
    expect(res.stdout).toContain('with timezone "America/Los_Angeles"');
    expect(res.stdout).toContain("a column format changed");
  });
});

describe("ath import — Oura", () => {
  let dir: string;
  let file: AthleticStandardFileT;

  beforeAll(() => {
    dir = newAthlete();
    expect(ath(["import", join(EXPORTS, "oura")], dir).code).toBe(0);
    file = read(dir);
  });

  it("reads the real pulse, not the readiness contributor of the same name", () => {
    // lowest_heart_rate is 48/46 bpm. The contributor called "resting heart rate"
    // is 97/99 on a 0-100 scale, and reading it as a pulse would poison a baseline.
    const rhr = pointsOf(file, "resting_heart_rate").map((s) => s.value);
    expect(rhr).toEqual([48, 46]);
    expect(rhr).not.toContain(97);
    expect(rhr).not.toContain(99);
  });

  it("keeps temperature deviation as a delta, not a body temperature (D28)", () => {
    const deviation = pointsOf(file, "temperature_deviation").map((s) => s.value);
    expect(deviation).toEqual([-0.21, 0.34]);
    expect(pointsOf(file, "body_temperature")).toHaveLength(0);
  });

  it("allows a negative deviation, since a delta below baseline is ordinary", () => {
    expect(pointsOf(file, "temperature_deviation")[0]!.value).toBeLessThan(0);
  });

  it("keeps Oura's durations in seconds as the format expects", () => {
    const night = file.hard_signals.find((s) => s.type === "sleep_session") as {
      aggregates: Record<string, number>;
    };
    expect(night.aggregates.duration_s).toBe(24900);
    expect(night.aggregates.deep_s).toBe(5700);
  });

  it("labels readiness contributors as the scores they are", () => {
    const contributor = vendorScoresOf(file, "readiness_contributor_resting_heart_rate");
    expect(contributor.map((s) => s.value)).toEqual([97, 99]);
    expect(contributor[0]!.scale).toBe("0-100");
  });

  it("leaves a file that passes check", () => {
    expect(ath(["check"], dir).code).toBe(0);
  });
});

describe("ath import — multiple devices", () => {
  let dir: string;
  let file: AthleticStandardFileT;

  beforeAll(() => {
    dir = newAthlete();
    for (const path of ["apple/export.xml", "whoop", "oura"]) {
      expect(ath(["import", join(EXPORTS, path)], dir).code).toBe(0);
    }
    file = read(dir);
  });

  it("registers one source per device", () => {
    expect(file.sources.map((s) => s.id)).toEqual(["manual-1", "apple-1", "whoop-1", "oura-1"]);
  });

  it("keeps three devices' readings of the same night as three records (D31)", () => {
    const morning = pointsOf(file, "resting_heart_rate").filter((s) =>
      s.recorded_at.startsWith("2026-08-09"),
    );
    expect(morning).toHaveLength(3);
    expect(new Set(morning.map((s) => s.source))).toEqual(
      new Set(["apple-1", "whoop-1", "oura-1"]),
    );
  });

  it("shows each device its own baseline rather than one pooled number", () => {
    const stats = ath(["stats"], dir).stdout;
    expect(stats).toContain("never pooled across devices");
    expect(stats).toMatch(/whoop-1 hrv_rmssd:/);
    expect(stats).toMatch(/oura-1 hrv_rmssd:/);
    expect(stats).toMatch(/apple-1 hrv_rmssd:/);
  });

  it("lists vendor scores apart from measurements", () => {
    const stats = ath(["stats"], dir).stdout;
    expect(stats).toContain("vendor scores (vendor-computed, not measurements)");
  });

  it("adds nothing on a second import of the same export", () => {
    const before = read(dir);
    const res = ath(["import", join(EXPORTS, "whoop")], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("nothing new");

    const after = read(dir);
    expect(after.hard_signals).toHaveLength(before.hard_signals.length);
    expect(after.soft_signals).toHaveLength(before.soft_signals.length);
    expect(after.sources).toHaveLength(before.sources.length);
  });

  it("replaces a day's series instead of doubling its samples", () => {
    const before = seriesOf(read(dir), "hrv_beats");
    expect(ath(["import", join(EXPORTS, "apple/export.xml")], dir).code).toBe(0);
    const after = seriesOf(read(dir), "hrv_beats");
    expect(after).toHaveLength(before.length);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

describe("ath import — zip containers", () => {
  // The README tells people to hand over export.zip directly, so this is the
  // path most imports actually take.
  it("reads an Apple export.zip without unpacking it first", () => {
    const dir = newAthlete();
    const staging = mkdtempSync(join(tmpdir(), "ath-zip-"));
    mkdirSync(join(staging, "apple_health_export"), { recursive: true });
    writeFileSync(
      join(staging, "apple_health_export", "export.xml"),
      readFileSync(join(EXPORTS, "apple/export.xml"), "utf8"),
    );
    execFileSync("zip", ["-qr", join(dir, "export.zip"), "apple_health_export"], { cwd: staging });

    const res = ath(["import", join(dir, "export.zip")], dir);
    expect(res.code).toBe(0);
    expect(seriesOf(read(dir), "hrv_beats")[0]!.n).toBe(69);
    expect(ath(["check"], dir).code).toBe(0);
  });

  it("reads a WHOOP CSV export delivered as a zip", () => {
    const dir = newAthlete();
    execFileSync("zip", ["-q", join(dir, "whoop.zip"), ...WHOOP_CSVS], { cwd: join(EXPORTS, "whoop") });

    const res = ath(["import", join(dir, "whoop.zip")], dir);
    expect(res.code).toBe(0);
    expect(pointsOf(read(dir), "hrv_rmssd").map((s) => s.value)).toEqual([68.4, 74.1]);
    expect(read(dir).soft_signals).toHaveLength(5);
  });
});

describe("ath import — failure modes", () => {
  it("warns but stays valid when a sidecar is absent (D25)", () => {
    // A document that travelled without its sidecars must still be usable.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    const ref = seriesOf(read(dir), "heart_rate")[0]!;
    rmSync(join(dir, ref.file));

    const res = ath(["check"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("sidecar not found");
    expect(res.stdout).toContain("valid Athletic Standard");
  });

  it("fails when a sidecar was edited after import (D25)", () => {
    // Worse than an absent file: the receipts no longer describe the contents.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    const ref = seriesOf(read(dir), "heart_rate")[0]!;

    const target = join(dir, ref.file);
    const tampered = JSON.parse(readFileSync(target, "utf8"));
    tampered.values[0] = 999;
    writeFileSync(target, JSON.stringify(tampered, null, 2) + "\n");

    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("does not match its recorded hash");
  });

  it("refuses an export it cannot place, rather than guessing", () => {
    const dir = newAthlete();
    writeFileSync(join(dir, "mystery.csv"), "alpha,beta\n1,2\n");
    const res = ath(["import", join(dir, "mystery.csv")], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/cannot place/);
  });

  it("names the export it wants when handed WHOOP's older archive", () => {
    const dir = newAthlete();
    const gdpr = mkdtempSync(join(tmpdir(), "ath-gdpr-"));
    mkdirSync(join(gdpr, "Health"), { recursive: true });
    writeFileSync(join(gdpr, "Health", "sleeps.csv"), "during,something\n");
    const res = ath(["import", gdpr], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("Data Export");
  });

  it("reports a path that does not exist", () => {
    const dir = newAthlete();
    const res = ath(["import", join(dir, "nope.zip")], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/no such file/);
  });
});
