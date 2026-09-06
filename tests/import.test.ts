import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { AthleticStandardFileT } from "../src/schema.js";
import { readingsFor } from "../src/readings.js";
import { readSeriesDay, seriesDayFiles } from "../src/series.js";
import { baselineFor } from "../src/stats.js";

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
    (s): s is Extract<typeof s, { value: number; unit: string }> =>
      s.type === type && "value" in s && "unit" in s,
  );
}

function seriesOf(file: AthleticStandardFileT, quantity: string) {
  return file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "series_ref" }> =>
      s.type === "series_ref" && s.quantity === quantity,
  );
}

/**
 * The values actually written to disk for a quantity.
 *
 * Unit conversions are asserted against these rather than against a summary in the
 * document, because this is where the converted number really lands.
 */
function samplesOf(dir: string, quantity: string, source = "apple-watch-1"): number[] {
  const athleteFile = join(dir, "athlete.ath.json");
  return seriesDayFiles(athleteFile, quantity, source).flatMap(
    ({ day }) => readSeriesDay(athleteFile, quantity, source, day)?.map((s) => s.value) ?? [],
  );
}

function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * The source id for a writer that arrived by a given route. Ids are handed out in
 * import order, so WHOOP's copy inside an Apple export can be `whoop-1` and WHOOP's
 * own CSV `whoop-2`; the source record, not the id, says which is which.
 */
function sourceByRoute(file: AthleticStandardFileT, writer: string, via: string): string {
  const found = file.sources.find((s) => s.writer === writer && s.via === via);
  if (!found) throw new Error(`no source for ${writer} via ${via}`);
  return found.id;
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
    expect(samplesOf(dir, "oxygen_saturation")).toEqual([97]);
  });

  it("keeps wrist temperature apart from body temperature (D28)", () => {
    // Anti-phase signals: merging them would cancel the information out.
    expect(pointsOf(file, "wrist_temperature_sleeping")[0]!.value).toBe(33.4);
    expect(pointsOf(file, "body_temperature")[0]!.value).toBe(36.7);
  });

  it("stores Apple HRV as SDNN and never as RMSSD (D22)", () => {
    // Apple samples SDNN through the night rather than reporting one figure for it,
    // so the readings live in a sidecar (D43). Still SDNN, still never pooled with
    // RMSSD, and still nothing this tool computed.
    expect(samplesOf(dir, "hrv_sdnn")).toEqual([52.3, 41.8]);
    expect(pointsOf(file, "hrv_sdnn")).toHaveLength(0);
    expect(seriesOf(file, "hrv_sdnn")[0]!.unit).toBe("ms");
  });

  it("computes RMSSD from the beat list and marks it derived (D26)", () => {
    // Scoped to the watch's optical sensor: the ECG produces its own, under its own
    // source, and the two must never be counted together.
    const rmssd = pointsOf(file, "hrv_rmssd").filter((s) => s.source === "apple-watch-1");
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
    expect(samplesOf(dir, "distance_walking_running")[0]).toBeCloseTo(1995.59, 1);
    expect(samplesOf(dir, "distance_cycling")[0]).toBeCloseTo(14200, 1);
    expect(samplesOf(dir, "distance_swimming")[0]).toBeCloseTo(1097.28, 1);
  });

  it("sends dense samples to sidecars rather than the document", () => {
    const beats = seriesOf(file, "hrv_beats");
    expect(beats).toHaveLength(1);
    expect(beats[0]!.n).toBe(69);
    expect(seriesDayFiles(join(dir, "athlete.ath.json"), "hrv_beats", "apple-watch-1")).toEqual([
      { day: "2026-08-09", file: "series/2026-08-09-hrv_beats-apple-watch-1.ath.series.json" },
    ]);

    // The samples are on disk, not inline.
    const raw = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(raw).not.toContain("offsets_ms");
  });

  it("clusters overlapping sleep stage records into one night, per writer", () => {
    // The watch and the ring both recorded this night. Two observations, two records:
    // folding their stages together would produce a night nobody measured (D45).
    const sleep = file.hard_signals.filter(
      (s): s is Extract<typeof s, { type: "sleep_session" }> => s.type === "sleep_session",
    );
    expect(sleep.map((s) => s.source).sort()).toEqual(["apple-watch-1", "oura-1"]);

    const ring = sleep.find((s) => s.source === "oura-1")!;
    expect(ring.start).toBe("2026-08-08T22:20:00-07:00");
    expect(ring.aggregates.duration_s).toBe(26400);

    const night = sleep.find((s) => s.source === "apple-watch-1") as {
      start: string;
      end: string;
      aggregates: Record<string, number>;
    };
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
    // Years of data means thousands of sidecars. The count of files written is one
    // line, and the detail below it has one line per quantity — so the summary is
    // bounded by how many things are measured, not by how long the history is.
    expect(output).toMatch(/wrote \d+ series files to series\/$/m);
    expect(output).toMatch(/hrv_beats \(apple-watch-1\): 69 samples across 1 day/);

    const coverageLines = output
      .split("\n")
      .filter((line) => /^ {4}\w+( \([\w-]+\))?: \d+ samples? across \d+ days? \(/.test(line));
    const recordCount = file.hard_signals.filter((s) => s.type === "series_ref").length;
    expect(coverageLines).toHaveLength(recordCount);
  });

  it("keeps running dynamics, which a run prediction needs (D32)", () => {
    // These separate "slow because unrecovered" from "slow because form fell apart".
    expect(samplesOf(dir, "running_power")).toEqual([284]);
    expect(samplesOf(dir, "running_stride_length")).toEqual([1.18]);
    expect(samplesOf(dir, "running_vertical_oscillation")).toEqual([8.4]);
    expect(samplesOf(dir, "running_ground_contact_time")).toEqual([243]);
  });

  it("converts running speed from either unit into m/s", () => {
    // The fixture carries one sample in m/s and one in km/hr: 12.6 km/hr is 3.5 m/s.
    const speed = seriesOf(file, "running_speed")[0]!;
    expect(speed.n).toBe(2);
    expect(samplesOf(dir, "running_speed").sort((a, b) => a - b)).toEqual([3.42, 3.5]);
  });

  it("keeps training load and gait", () => {
    expect(samplesOf(dir, "physical_effort")).toEqual([9.4]);
    expect(samplesOf(dir, "basal_energy")).toEqual([72.4]);
    expect(samplesOf(dir, "exercise_time")).toEqual([1]);
    // Gait comes from the phone in the pocket, not the watch, and is filed that way.
    expect(samplesOf(dir, "walking_speed", "iphone-1")).toEqual([1.42]);
    // 78 cm becomes 0.78 m.
    expect(samplesOf(dir, "walking_step_length", "iphone-1")).toEqual([0.78]);
    expect(samplesOf(dir, "walking_asymmetry_percentage", "iphone-1")).toEqual([1.4]);
    expect(samplesOf(dir, "time_in_daylight")).toEqual([46]);
  });

  it("keeps body composition and blood pressure", () => {
    // 148.2 lb is 67.22 kg; 5.9 ft is 179.83 cm; 0.182 is 18.2%.
    expect(pointsOf(file, "lean_body_mass")[0]!.value).toBeCloseTo(67.22, 2);
    expect(pointsOf(file, "body_fat_percentage")[0]!.value).toBeCloseTo(18.2, 1);
    expect(pointsOf(file, "height")[0]!.value).toBeCloseTo(179.83, 1);
    expect(pointsOf(file, "blood_pressure_systolic")[0]!.value).toBe(118);
    expect(pointsOf(file, "blood_pressure_diastolic")[0]!.value).toBe(74);
  });

  it("leaves diagnostic findings out, since this is not medical advice", () => {
    expect(output).toContain("unmapped HealthKit type: AtrialFibrillationBurden");
  });

  it("reports an unrecognized unit instead of storing a wrong number", () => {
    // A mile stored as a metre still looks like real data, so an unknown unit is
    // refused and named rather than assumed.
    expect(output).toContain('RunningPower in "horsepower"');
    // The recognized samples still came through.
    expect(seriesOf(file, "running_power")[0]!.n).toBe(1);
  });

  it("counts what it will not guess at instead of guessing", () => {
    expect(output).toContain("unmapped HealthKit type: HeadphoneAudioExposure");
    expect(output).toContain("unmapped HealthKit type: DietaryCaffeine");
    expect(output).toContain("clinical records (out of scope)");
  });

  it("puts ECG readings under their own source, never pooled with the watch (D37)", () => {
    // One watch, two sensors: optical all day, electrical during an ECG. The
    // electrical figure is the reference standard and the optical one carries about
    // 29% error, so a shared baseline would bury the comparison.
    const ecgSource = file.sources.find((s) => s.sensor === "ecg");
    expect(ecgSource).toBeDefined();
    expect(ecgSource!.id).toBe("apple-watch-ecg-1");
    expect(ecgSource!.vendor).toBe("apple");

    const rmssd = pointsOf(file, "hrv_rmssd");
    const bySource = new Map(rmssd.map((s) => [s.source, s]));
    expect(bySource.has("apple-watch-1")).toBe(true);
    expect(bySource.has("apple-watch-ecg-1")).toBe(true);
  });

  it("names every source it wrote under, with what wrote it", () => {
    // An import that quietly creates a source leaves readings the wearer cannot
    // find, under a name nothing told them about. One export carries a watch, a
    // phone, a scale, a cuff, a ring, a strap, the ECG sensor, and a person typing.
    expect(output).toContain("  apple-watch-1 (Apple Watch):");
    expect(output).toContain("  apple-watch-ecg-1 (Apple Watch, ecg):");
    expect(output).toContain("  withings-1 (Withings):");
    expect(output).toContain("  omron-1 (Omron):");
    expect(output).toContain("  oura-1 (Oura):");
    expect(output).toContain("  whoop-1 (WHOOP):");
    expect(output).toContain("  manual-1 (typed in by hand):");
    expect(output).toMatch(/ecg_beats \(apple-watch-ecg-1\): \d+ samples/);
    expect(output).toMatch(/steps \(iphone-1\): \d+ samples/);
  });

  it("derives RMSSD from the ECG waveform with its receipts", () => {
    // The fixture alternates 880/920 ms, a true RMSSD of 40 ms.
    const fromEcg = pointsOf(file, "hrv_rmssd").find((s) => s.source === "apple-watch-ecg-1")!;
    expect(fromEcg.value).toBeGreaterThan(36);
    expect(fromEcg.value).toBeLessThan(44);

    const derived = (fromEcg as { derived?: Record<string, unknown> }).derived!;
    expect(derived.from).toBe("ecg_beats");
    expect(derived.method).toBe("rmssd");
    expect(Number(derived.signal_quality)).toBeGreaterThan(1);
  });

  it("refuses an ECG that is not sinus rhythm, and says why", () => {
    // In atrial fibrillation the rhythm is irregular by definition, so RMSSD would
    // measure the arrhythmia rather than recovery.
    expect(output).toContain("not in sinus rhythm");
    expect(output).toContain("Atrial Fibrillation");
  });

  it("stores ECG intervals apart from optically detected beats", () => {
    const ecgBeats = seriesOf(file, "ecg_beats");
    expect(ecgBeats).toHaveLength(1);
    expect(ecgBeats[0]!.source).toBe("apple-watch-ecg-1");
    // Mean interval of an 880/920 alternation is 900 ms.
    const intervals = samplesOf(dir, "ecg_beats", "apple-watch-ecg-1");
    expect(meanOf(intervals)).toBeGreaterThan(880);
    expect(meanOf(intervals)).toBeLessThan(920);
  });

  it("does not store the waveform or the rhythm classification", () => {
    // The intervals are a performance measurement; the waveform and the words
    // "Atrial Fibrillation" are a clinical finding.
    const raw = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(raw).not.toContain("Sinus");
    expect(raw).not.toContain("Fibrillation");
    expect(seriesOf(file, "ecg_beats")[0]!.n).toBeLessThan(100);
  });

  it("turns a GPS route into per-kilometre splits (D38)", () => {
    const run = file.hard_signals.find(
      (s): s is Extract<typeof s, { type: "workout_session" }> =>
        s.type === "workout_session" && s.aggregates.activity === "running",
    )!;
    expect(run.segments).toBeDefined();
    expect(run.segments!.map((s) => s.label)).toEqual([
      "km 1",
      "km 2",
      "km 3 (partial)",
    ]);
    // The route was built as two even kilometres then a deliberate fade. Points
    // arrive every five seconds, so interpolating the boundary lands within a second.
    expect(Math.abs(run.segments![0]!.duration_s! - 300)).toBeLessThan(1);
    expect(Math.abs(run.segments![1]!.duration_s! - 300)).toBeLessThan(1);
    expect(run.segments![2]!.duration_s).toBeGreaterThan(150);
    expect(run.aggregates.elevation_gain_m).toBeGreaterThan(0);
  });

  it("keeps laps the wearer set rather than replacing them with even kilometres", () => {
    const strength = file.hard_signals.find(
      (s): s is Extract<typeof s, { type: "workout_session" }> =>
        s.type === "workout_session" && s.aggregates.activity === "functionalstrengthtraining",
    )!;
    expect(strength.segments!.map((s) => s.label)).toEqual(["lap 1", "lap 2"]);
  });

  it("does not store raw coordinates, which would reveal where you live", () => {
    const raw = readFileSync(join(dir, "athlete.ath.json"), "utf8");
    expect(raw).not.toContain("37.77");
    expect(raw).not.toContain("-122.41");
  });

  it("leaves a file that passes check", () => {
    expect(ath(["check"], dir).code).toBe(0);
  });
});

describe("samples and summaries of one measurement (D43)", () => {
  let dir: string;
  let file: AthleticStandardFileT;

  beforeAll(() => {
    dir = newAthlete();
    expect(ath(["import", join(EXPORTS, "apple/export.xml")], dir).code).toBe(0);
    expect(ath(["import", join(EXPORTS, "whoop")], dir).code).toBe(0);
    file = read(dir);
  });

  it("keeps a sampled measurement and a nightly one apart, under one name", () => {
    // Apple samples respiratory rate through the night; WHOOP reports one figure for
    // it. Same measurement, same unit, different things — so one is a series and the
    // other a reading, and neither is converted into the other.
    const whoopCsv = sourceByRoute(file, "WHOOP", "whoop_csv");
    expect(seriesOf(file, "respiratory_rate").map((s) => s.source)).toEqual(["apple-watch-1"]);
    expect(pointsOf(file, "respiratory_rate").map((s) => s.source)).toEqual([whoopCsv, whoopCsv]);
    expect(seriesOf(file, "respiratory_rate")[0]!.unit).toBe("brpm");
    expect(pointsOf(file, "respiratory_rate")[0]!.unit).toBe("brpm");
  });

  it("moves the readings without changing any of them", () => {
    // The export's own values, timestamps and unit, read back out of the sidecar.
    const athleteFile = join(dir, "athlete.ath.json");
    const samples = seriesDayFiles(athleteFile, "hrv_sdnn", "apple-watch-1").flatMap(
      ({ day }) => readSeriesDay(athleteFile, "hrv_sdnn", "apple-watch-1", day) ?? [],
    );
    expect(samples.map(({ at, value }) => ({ at, value }))).toEqual([
      { at: "2026-08-09T06:12:00-07:00", value: 52.3 },
      { at: "2026-08-09T22:30:00-07:00", value: 41.8 },
    ]);
    // An SDNN figure describes a window, and the window's length comes with it (D45).
    expect(samples.map((s) => s.durationMs)).toEqual([61_000, 6_000]);

    const ref = seriesOf(file, "hrv_sdnn")[0]!;
    expect(ref.n).toBe(2);
    expect(ref.unit).toBe("ms");
    expect(ref.source).toBe("apple-watch-1");
  });

  it("answers the same question the same way, wherever the readings are", () => {
    // The interface a caller uses does not depend on where a reading was stored, and
    // neither does the answer: the same readings inline and in sidecars produce the
    // same baseline.
    const athleteFile = join(dir, "athlete.ath.json");
    const fromSidecars = baselineFor(file, athleteFile, "hrv_sdnn", "apple-watch-1")!;
    expect(fromSidecars.n).toBe(2);
    expect(fromSidecars.mean).toBe(47.1);

    const inline: AthleticStandardFileT = {
      ...file,
      hard_signals: [
        { type: "hrv_sdnn", value: 52.3, unit: "ms", recorded_at: "2026-08-09T06:12:00-07:00", source: "apple-watch-1" },
        { type: "hrv_sdnn", value: 41.8, unit: "ms", recorded_at: "2026-08-09T22:30:00-07:00", source: "apple-watch-1" },
      ],
    };
    expect(baselineFor(inline, "/nonexistent/athlete.ath.json", "hrv_sdnn", "apple-watch-1")).toEqual(
      fromSidecars,
    );
  });

  it("reads both storage locations through one call", () => {
    const athleteFile = join(dir, "athlete.ath.json");
    expect(readingsFor(file, athleteFile, "hrv_sdnn", "apple-watch-1").map((r) => r.storage)).toEqual([
      "series",
      "series",
    ]);
    expect(
      readingsFor(file, athleteFile, "respiratory_rate", sourceByRoute(file, "WHOOP", "whoop_csv")).map(
        (r) => r.storage,
      ),
    ).toEqual(["document", "document"]);
  });

  it("drops inline readings that a later import stores as a series", () => {
    // A file written before the measurement moved still holds the old inline copies.
    // Keeping both would count every reading twice and leave the document its old size.
    const stale = newAthlete();
    const athleteFile = join(stale, "athlete.ath.json");
    const before = JSON.parse(readFileSync(athleteFile, "utf8")) as AthleticStandardFileT;
    before.sources.push({
      id: "apple-watch-1",
      kind: "export_file",
      vendor: "apple",
      writer: "Apple Watch",
      via: "apple_health",
    });
    before.hard_signals.push({
      type: "hrv_sdnn",
      value: 52.3,
      unit: "ms",
      recorded_at: "2026-08-09T06:12:00-07:00",
      source: "apple-watch-1",
    });
    writeFileSync(athleteFile, JSON.stringify(before, null, 2));

    const res = ath(["import", join(EXPORTS, "apple/export.xml")], stale);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("moved 1 reading(s) out of the document");
    expect(pointsOf(read(stale), "hrv_sdnn")).toHaveLength(0);
    expect(samplesOf(stale, "hrv_sdnn")).toEqual([52.3, 41.8]);
  });
});

describe("ath import — one export, many writers (D45)", () => {
  const WATCH_DEVICE =
    'device="&lt;&lt;HKDevice: 0x2809b6800&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,2, software:10.2&gt;"';
  const NEW_WATCH_DEVICE =
    'device="&lt;&lt;HKDevice: 0x1f0033a00&gt;, name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch7,1, software:11.0&gt;"';

  /** A minimal export.xml with the records given, and nothing else. */
  function exportOf(records: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<HealthData locale="en_US">
 <ExportDate value="2026-08-10 09:00:00 -0700"/>
${records}
</HealthData>
`;
  }

  function importXml(text: string, into?: string) {
    const dir = into ?? newAthlete();
    const exportPath = join(dir, "export.xml");
    writeFileSync(exportPath, text);
    const res = ath(["import", exportPath], dir);
    return { dir, res, file: read(dir) };
  }

  const hr = (writer: string, at: string, bpm: number, extra = "") =>
    `<Record type="HKQuantityTypeIdentifierHeartRate" sourceName="${writer}" ${extra} unit="count/min" startDate="${at}" endDate="${at}" value="${bpm}"/>`;
  const energy = (writer: string, start: string, end: string, kcal: number) =>
    `<Record type="HKQuantityTypeIdentifierActiveEnergyBurned" sourceName="${writer}" unit="kcal" startDate="${start}" endDate="${end}" value="${kcal}"/>`;
  const workout = (writer: string, start: string, end: string) =>
    `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" totalEnergyBurned="300" totalEnergyBurnedUnit="kcal" sourceName="${writer}" startDate="${start}" endDate="${end}"/>`;

  it("keeps two writers' samples of one quantity in the same window apart, and both totals intact", () => {
    // The case that started this: a watch and a ring both logging calories during
    // one run. Two files, two totals, and adding them together is not a workout total.
    const { dir, res, file } = importXml(
      exportOf(
        [
          energy("Apple Watch", "2026-08-29 13:40:14 -0500", "2026-08-29 13:40:17 -0500", 0.5),
          energy("Apple Watch", "2026-08-29 13:40:17 -0500", "2026-08-29 13:40:20 -0500", 0.6),
          energy("Apple Watch", "2026-08-29 13:40:20 -0500", "2026-08-29 13:40:23 -0500", 0.4),
          energy("Oura", "2026-08-29 13:40:00 -0500", "2026-08-29 13:41:00 -0500", 9.7),
          energy("Oura", "2026-08-29 13:41:00 -0500", "2026-08-29 13:42:00 -0500", 10.2),
        ].join("\n"),
      ),
    );
    expect(res.code).toBe(0);

    const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(sum(samplesOf(dir, "active_energy", "apple-watch-1"))).toBe(1.5);
    expect(sum(samplesOf(dir, "active_energy", "oura-1"))).toBe(19.9);
    expect(seriesOf(file, "active_energy").map((s) => [s.source, s.n]).sort()).toEqual([
      ["apple-watch-1", 3],
      ["oura-1", 2],
    ]);
    expect(seriesDayFiles(join(dir, "athlete.ath.json"), "active_energy", "apple-watch-1")).toHaveLength(1);
    expect(seriesDayFiles(join(dir, "athlete.ath.json"), "active_energy", "oura-1")).toHaveLength(1);
  });

  it("keeps two writers' readings that share a timestamp and a value", () => {
    // Agreement is data. Two devices saying 62 at 08:00 is two observations, and
    // dropping one because it matched would erase exactly the comparison D31 protects.
    const { dir } = importXml(
      exportOf(
        [
          hr("Apple Watch", "2026-08-09 08:00:00 -0700", 62),
          hr("WHOOP", "2026-08-09 08:00:00 -0700", 62),
        ].join("\n"),
      ),
    );
    expect(samplesOf(dir, "heart_rate", "apple-watch-1")).toEqual([62]);
    expect(samplesOf(dir, "heart_rate", "whoop-1")).toEqual([62]);
  });

  it("keeps two writers' workouts and nights of sleep as separate records", () => {
    const sleep = (writer: string, start: string, end: string, value: string) =>
      `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${writer}" startDate="${start}" endDate="${end}" value="${value}"/>`;
    const { file } = importXml(
      exportOf(
        [
          workout("Apple Watch", "2026-08-09 18:00:00 -0700", "2026-08-09 18:30:00 -0700"),
          workout("WHOOP", "2026-08-09 18:00:30 -0700", "2026-08-09 18:29:00 -0700"),
          sleep("Apple Watch", "2026-08-08 22:30:00 -0700", "2026-08-09 06:00:00 -0700", "HKCategoryValueSleepAnalysisAsleepCore"),
          sleep("Oura", "2026-08-08 22:34:00 -0700", "2026-08-09 05:58:00 -0700", "HKCategoryValueSleepAnalysisAsleepUnspecified"),
        ].join("\n"),
      ),
    );
    const workouts = file.hard_signals.filter((s) => s.type === "workout_session");
    const nights = file.hard_signals.filter((s) => s.type === "sleep_session");
    expect(workouts.map((s) => s.source).sort()).toEqual(["apple-watch-1", "whoop-1"]);
    expect(nights.map((s) => s.source).sort()).toEqual(["apple-watch-1", "oura-1"]);
  });

  it("imports a record with no device attribute and records no device for it", () => {
    const { file } = importXml(exportOf(hr("WHOOP", "2026-08-09 08:00:00 -0700", 58)));
    const whoop = file.sources.find((s) => s.id === "whoop-1")!;
    expect(whoop.writer).toBe("WHOOP");
    expect(whoop.devices).toBeUndefined();
  });

  it("does not split a watch across a software update or a missing device attribute", () => {
    const { file } = importXml(
      exportOf(
        [
          hr("Apple Watch", "2026-08-09 08:00:00 -0700", 60, `sourceVersion="10.2" ${WATCH_DEVICE}`),
          hr("Apple Watch", "2026-08-09 08:05:00 -0700", 61, `sourceVersion="10.6" ${WATCH_DEVICE.replace("software:10.2", "software:10.6")}`),
          hr("Apple Watch", "2026-08-09 08:10:00 -0700", 62, `sourceVersion="10.6"`),
        ].join("\n"),
      ),
    );
    const watches = file.sources.filter((s) => s.writer === "Apple Watch");
    expect(watches).toHaveLength(1);
    expect(watches[0]!.devices).toHaveLength(1);
    expect(seriesOf(file, "heart_rate")[0]!.n).toBe(3);
  });

  it("keeps a replaced watch under the same name as one source, and lists both devices", () => {
    const { file } = importXml(
      exportOf(
        [
          hr("Apple Watch", "2026-08-09 08:00:00 -0700", 60, WATCH_DEVICE),
          hr("Apple Watch", "2026-08-10 08:00:00 -0700", 61, NEW_WATCH_DEVICE),
        ].join("\n"),
      ),
    );
    const watch = file.sources.find((s) => s.id === "apple-watch-1")!;
    expect(file.sources.filter((s) => s.writer === "Apple Watch")).toHaveLength(1);
    expect(watch.devices!.map((d) => d.hardware)).toEqual(["Watch6,2", "Watch7,1"]);
  });

  it("drops the person's name from the id but keeps the writer as written", () => {
    const { file } = importXml(exportOf(hr("Alex's Apple Watch", "2026-08-09 08:00:00 -0700", 60)));
    const watch = file.sources.find((s) => s.writer === "Alex's Apple Watch")!;
    expect(watch.id).toBe("apple-watch-1");
  });

  it("files hand-typed readings under the manual source, not under a device", () => {
    const { file } = importXml(
      exportOf(
        `<Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health" unit="kg" startDate="2026-08-09 07:00:00 -0700" endDate="2026-08-09 07:00:00 -0700" value="82.3"/>`,
      ),
    );
    const weight = pointsOf(file, "body_weight")[0]!;
    expect(weight.source).toBe("manual-1");
    expect(file.sources.find((s) => s.id === "manual-1")!.kind).toBe("manual");
    expect(file.sources.some((s) => s.writer === "Health")).toBe(false);
  });

  it("adds nothing on a repeat import, and does not merge across writers to get there", () => {
    const xml = exportOf(
      [
        hr("Apple Watch", "2026-08-09 08:00:00 -0700", 62),
        hr("WHOOP", "2026-08-09 08:00:00 -0700", 62),
        workout("Apple Watch", "2026-08-09 18:00:00 -0700", "2026-08-09 18:30:00 -0700"),
      ].join("\n"),
    );
    const first = importXml(xml);
    const again = importXml(xml, first.dir);
    expect(again.res.code).toBe(0);
    // Sidecars are rewritten with the same bytes; the document gains no reading.
    expect(again.res.stdout).not.toMatch(/^ {4}\w+: \d+$/m);
    expect(again.res.stdout).toContain("skipped 1 already-present record");
    expect(again.file.sources).toHaveLength(first.file.sources.length);
    expect(again.file.hard_signals).toHaveLength(first.file.hard_signals.length);
    expect(samplesOf(first.dir, "heart_rate", "apple-watch-1")).toEqual([62]);
    expect(samplesOf(first.dir, "heart_rate", "whoop-1")).toEqual([62]);
  });

  it("keeps how long a span sample covered, and adds nothing to an instant reading", () => {
    const { dir, res } = importXml(
      exportOf(
        [
          `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-08-09 09:00:00 -0700" endDate="2026-08-09 09:05:00 -0700" value="420"/>`,
          hr("Apple Watch", "2026-08-09 08:00:00 -0700", 62),
        ].join("\n"),
      ),
    );
    expect(res.code).toBe(0);
    const athleteFile = join(dir, "athlete.ath.json");

    const steps = readSeriesDay(athleteFile, "steps", "iphone-1", "2026-08-09")!;
    expect(steps).toEqual([{ at: "2026-08-09T09:00:00-07:00", value: 420, durationMs: 300_000 }]);
    const stepsRaw = readFileSync(join(dir, seriesDayFiles(athleteFile, "steps", "iphone-1")[0]!.file), "utf8");
    expect(JSON.parse(stepsRaw).durations_ms).toEqual([300_000]);

    const pulse = readFileSync(join(dir, seriesDayFiles(athleteFile, "heart_rate", "apple-watch-1")[0]!.file), "utf8");
    expect(JSON.parse(pulse)).not.toHaveProperty("durations_ms");

    // A person reading the rows sees the span; a program gets the milliseconds.
    expect(ath(["series", "steps", "--raw"], dir).stdout).toContain("420  over 5m");
    expect(JSON.parse(ath(["series", "steps", "--raw", "--json"], dir).stdout)[0].samples[0].durationMs).toBe(
      300_000,
    );
  });

  it("refuses a file written in the old one-source-per-export layout, and says what to do", () => {
    // Such a file cannot be repaired: nothing in it says which reading came from
    // which device. Importing on top of it would leave the pooled history beside the
    // separated one, counted twice.
    const dir = newAthlete();
    const athleteFile = join(dir, "athlete.ath.json");
    const old = JSON.parse(readFileSync(athleteFile, "utf8")) as AthleticStandardFileT;
    old.sources.push({ id: "apple-1", kind: "export_file", vendor: "apple", detail: "Apple Health via zip export" });
    writeFileSync(athleteFile, JSON.stringify(old, null, 2));

    const res = ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    expect(res.code).not.toBe(0);
    expect(res.stdout).toContain("apple-1");
    expect(res.stdout).toContain("ath init");
    expect(read(dir)).toEqual(old);
  });
});

describe("ath import — Apple writes beat clocks in the phone's own locale", () => {
  const fixture = readFileSync(join(EXPORTS, "apple/export.xml"), "utf8");

  /** The same instants, written the way another phone's settings would write them. */
  function inLocale(text: string, style: "24h" | "12h" | "comma" | "korean"): string {
    return text.replace(/time="(\d{1,2}):(\d{2}):(\d{2})\.(\d+)"/g, (_all, h, mi, s, frac) => {
      const hour = Number(h);
      const twelve = hour % 12 === 0 ? 12 : hour % 12;
      switch (style) {
        case "24h":
          return `time="${String(hour).padStart(2, "0")}:${mi}:${s}.${frac}"`;
        case "12h":
          return `time="${twelve}:${mi}:${s}.${frac} ${hour < 12 ? "AM" : "PM"}"`;
        case "comma":
          return `time="${h}:${mi}:${s},${frac}"`;
        case "korean":
          return `time="${hour < 12 ? "오전" : "오후"} ${twelve}:${mi}:${s}.${frac}"`;
      }
    });
  }

  /** Import an export whose beat clocks were rewritten, and report what survived. */
  function importWithClocks(text: string) {
    const dir = newAthlete();
    const exportPath = join(dir, "export.xml");
    writeFileSync(exportPath, text);
    const res = ath(["import", exportPath], dir);
    expect(res.code).toBe(0);
    const file = read(dir);
    return {
      output: res.stdout,
      beats: samplesOf(dir, "hrv_beats"),
      rmssd: pointsOf(file, "hrv_rmssd").map((s) => s.value),
    };
  }

  it("reads every locale's clock as the same beats", () => {
    // Apple writes this timestamp using the settings of the phone the export came
    // from, so one watch produces four spellings of one instant. A US phone on a
    // 12-hour clock is the common case, and it used to lose every beat in the file.
    const reference = importWithClocks(inLocale(fixture, "24h"));
    expect(reference.beats).toHaveLength(69);
    expect(reference.rmssd).toHaveLength(1);

    for (const style of ["12h", "comma", "korean"] as const) {
      const got = importWithClocks(inLocale(fixture, style));
      expect(got.beats, style).toEqual(reference.beats);
      expect(got.rmssd, style).toEqual(reference.rmssd);
      expect(got.output, style).not.toContain("heartbeat readings");
    }
  });

  it("reads beats whose hour disagrees with the record's own start hour", () => {
    // In a real export more than half the beats in the file said an hour that the
    // record they belong to did not: the beat clock and the record's start are
    // rendered against different UTC offsets. Shifting every hour reproduces it.
    const reference = importWithClocks(inLocale(fixture, "24h"));
    const shifted = fixture.replace(
      /time="(\d{1,2}):(\d{2}):(\d{2})\.(\d+)"/g,
      (_all, h, mi, s, frac) => `time="${(Number(h) + 23) % 24}:${mi}:${s}.${frac}"`,
    );

    const got = importWithClocks(shifted);
    expect(got.beats).toEqual(reference.beats);
    expect(got.rmssd).toEqual(reference.rmssd);
    expect(got.output).not.toContain("heartbeat readings");
  });

  it("counts a beat whose minute does not fit, which no offset explains", () => {
    const reference = importWithClocks(inLocale(fixture, "24h"));
    const shifted = fixture.replace(
      /time="(\d{1,2}):(\d{2}):(\d{2})\.(\d+)"/g,
      (_all, h, mi, s, frac) => `time="${h}:${String((Number(mi) + 20) % 60).padStart(2, "0")}:${s}.${frac}"`,
    );

    const got = importWithClocks(shifted);
    expect(got.beats).toHaveLength(0);
    expect(got.rmssd).toHaveLength(0);
    expect(got.output).toContain("heartbeat readings we could not place");
    expect(reference.beats.length).toBeGreaterThan(0);
  });

  it("counts beats it cannot place instead of dropping them in silence", () => {
    // The failure that hid itself: unreadable beats left the window empty, an empty
    // window was discarded, and the report said nothing at all.
    const got = importWithClocks(fixture.replace(/time="[^"]*"/g, 'time="quarter past six"'));
    expect(got.beats).toHaveLength(0);
    expect(got.rmssd).toHaveLength(0);
    expect(got.output).toContain("heartbeat readings we could not place");
    expect(got.output).toContain("quarter past six");
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

  it("registers one source per writer and route, and one more for the ECG sensor", () => {
    // The Apple export alone carries seven writers. WHOOP and Oura then arrive a
    // second time by their own exports, and each route is its own source (D45).
    const byId = new Map(file.sources.map((s) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual(
      [
        "manual-1",
        "apple-watch-1",
        "apple-watch-ecg-1",
        "iphone-1",
        "withings-1",
        "omron-1",
        "oura-1",
        "oura-2",
        "whoop-1",
        "whoop-2",
      ].sort(),
    );
    expect(byId.get("whoop-1")).toMatchObject({ writer: "WHOOP", via: "apple_health", vendor: "whoop" });
    expect(byId.get("whoop-2")).toMatchObject({ writer: "WHOOP", via: "whoop_csv", vendor: "whoop" });
    expect(byId.get("oura-1")).toMatchObject({ writer: "Oura", via: "apple_health" });
    expect(byId.get("oura-2")).toMatchObject({ writer: "Oura", via: "oura_csv" });
    expect(byId.get("iphone-1")).toMatchObject({ writer: "iPhone", vendor: "apple" });
    expect(byId.get("manual-1")!.kind).toBe("manual");
  });

  it("records the watch's device once, across a software update and a missing attribute", () => {
    // Three of the watch's records: one with the device at software 10.2, one with the
    // same hardware at 10.6 and a different memory address, one with no device at all.
    // One source, one device, no version and no address.
    const watch = file.sources.find((s) => s.id === "apple-watch-1")!;
    expect(watch.devices).toEqual([
      { name: "Apple Watch", manufacturer: "Apple Inc.", model: "Watch", hardware: "Watch6,2" },
    ]);
    expect(JSON.stringify(watch)).not.toContain("0x28");
    expect(JSON.stringify(watch)).not.toContain("10.2");
  });

  it("keeps every device's reading of the same morning as its own record (D31)", () => {
    const morning = pointsOf(file, "resting_heart_rate").filter((s) =>
      s.recorded_at.startsWith("2026-08-09"),
    );
    // Watch, WHOOP relayed through Health, WHOOP's own CSV, Oura's own CSV.
    expect(morning).toHaveLength(4);
    expect(new Set(morning.map((s) => s.source))).toEqual(
      new Set(["apple-watch-1", "whoop-1", "whoop-2", "oura-2"]),
    );
  });

  it("shows each device its own baseline rather than one pooled number", () => {
    const stats = ath(["stats"], dir).stdout;
    expect(stats).toContain("never pooled across devices");
    expect(stats).toMatch(/whoop-2 hrv_rmssd:/);
    expect(stats).toMatch(/oura-2 hrv_rmssd:/);
    expect(stats).toMatch(/apple-watch-1 hrv_rmssd:/);
  });

  it("lists every source with what wrote it, so an agent can tell them apart", () => {
    const stats = ath(["stats"], dir).stdout;
    expect(stats).toMatch(/^sources: 10$/m);
    expect(stats).toContain("apple-watch-1: Apple Watch, via apple_health [Apple Watch Watch6,2]");
    expect(stats).toContain("whoop-1: WHOOP, via apple_health");
    expect(stats).toContain("whoop-2: WHOOP, via whoop_csv");
    expect(stats).toContain("manual-1: typed in by hand");
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
    // The whole folder gone is the case that must stay usable: that is the document
    // travelling on its own.
    rmSync(join(dir, "series"), { recursive: true, force: true });

    const res = ath(["check"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("series data not present");
    expect(res.stdout).toContain("valid Athletic Standard");
  });

  it("fails when a sidecar was edited after import (D25)", () => {
    // Worse than an absent folder: the record no longer describes the contents.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);

    const target = join(
      dir,
      seriesDayFiles(join(dir, "athlete.ath.json"), "heart_rate", "apple-watch-1")[0]!.file,
    );
    const tampered = JSON.parse(readFileSync(target, "utf8"));
    tampered.values[0] = 999;
    writeFileSync(target, JSON.stringify(tampered, null, 2) + "\n");

    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("heart_rate for apple-watch-1 doesn't match what was recorded");
  });

  it("fails when a day's sidecar is deleted while the folder remains (D40)", () => {
    // Missing, extra, and edited all report the same thing: the fix is the same.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    rmSync(
      join(dir, seriesDayFiles(join(dir, "athlete.ath.json"), "heart_rate", "apple-watch-1")[0]!.file),
    );

    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("re-import to fix");
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

  it("explains a document written by an earlier build, and how to fix it", () => {
    // A hard signal is a union, and a failed union says only "Invalid input" — which
    // is no use for a file people are meant to edit by hand.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);

    const athleteFile = join(dir, "athlete.ath.json");
    const file = JSON.parse(readFileSync(athleteFile, "utf8"));
    file.hard_signals = file.hard_signals.map((s: Record<string, unknown>) =>
      s.type !== "series_ref"
        ? s
        : {
            type: "series_ref",
            quantity: s.quantity,
            unit: s.unit,
            start: `${s.from}T00:00:00Z`,
            end: `${s.to}T23:59:59Z`,
            source: s.source,
            file: `series/${s.from}-${s.quantity}-${s.source}.ath.series.json`,
            sha256: s.sha256,
            n: s.n,
            summary: { min: 0, max: 1, mean: 0.5 },
          },
    );
    writeFileSync(athleteFile, JSON.stringify(file, null, 2) + "\n");

    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("an earlier build wrote one record per day");
    expect(res.stdout).toContain("import again");

    // The same explanation appears when a command loads the file, not just on check.
    expect(ath(["import", join(EXPORTS, "apple/export.xml")], dir).stdout).toContain(
      "an earlier build wrote one record per day",
    );
  });

  it("rebuilds coverage from sidecars already on disk", () => {
    // Which is why the remedy above is only a re-import: the samples never moved.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);
    const before = read(dir).hard_signals.filter((s) => s.type === "series_ref").length;

    rmSync(join(dir, "athlete.ath.json"));
    expect(ath(["init", "-y"], dir).code).toBe(0);
    expect(ath(["import", join(EXPORTS, "apple/export.xml")], dir).code).toBe(0);

    expect(read(dir).hard_signals.filter((s) => s.type === "series_ref")).toHaveLength(before);
    expect(ath(["check"], dir).code).toBe(0);
  });

  it("names the field at fault in a hand-edited record", () => {
    // The format is meant to be editable by hand, so a bad edit has to say what broke.
    const dir = newAthlete();
    ath(["import", join(EXPORTS, "apple/export.xml")], dir);

    const athleteFile = join(dir, "athlete.ath.json");
    const file = JSON.parse(readFileSync(athleteFile, "utf8"));
    const point = file.hard_signals.find((s: { type: string }) => s.type === "resting_heart_rate");
    delete point.unit;
    writeFileSync(athleteFile, JSON.stringify(file, null, 2) + "\n");

    const res = ath(["check"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/hard_signals\.\d+\.unit/);
  });

  it("reports a path that does not exist", () => {
    const dir = newAthlete();
    const res = ath(["import", join(dir, "nope.zip")], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toMatch(/no such file/);
  });
});
