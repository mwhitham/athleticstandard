import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeries,
  checkSeriesRef,
  readSeriesSamples,
  writeSeriesFile,
  type Sample,
} from "../src/series.js";
import { SeriesFile } from "../src/schema.js";

function tempAthleteFile(): string {
  return join(mkdtempSync(join(tmpdir(), "ath-series-")), "athlete.ath.json");
}

describe("buildSeries", () => {
  it("keeps millisecond spacing, which is the point of storing beats at all", () => {
    // Whole-second offsets would collapse these three beats into one instant.
    const samples: Sample[] = [
      { at: "2026-08-09T06:12:00.000-07:00", value: 869.6 },
      { at: "2026-08-09T06:12:00.870-07:00", value: 810.8 },
      { at: "2026-08-09T06:12:01.681-07:00", value: 845.1 },
    ];
    const built = buildSeries("hrv_beats", "apple-1", "2026-08-09", samples);
    expect(built).not.toBeNull();

    const parsed = SeriesFile.parse(JSON.parse(built!.content));
    expect(parsed.offsets_ms).toEqual([0, 870, 1681]);
    expect(new Set(parsed.offsets_ms).size).toBe(3);
  });

  it("sorts by instant rather than trusting input order", () => {
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", [
      { at: "2026-08-09T08:10:00-07:00", value: 71 },
      { at: "2026-08-09T08:00:00-07:00", value: 62 },
      { at: "2026-08-09T08:05:00-07:00", value: 64 },
    ]);
    const parsed = SeriesFile.parse(JSON.parse(built!.content));
    expect(parsed.values).toEqual([62, 64, 71]);
    expect(parsed.offsets_ms).toEqual([0, 300_000, 600_000]);
    expect(built!.ref.start).toBe("2026-08-09T08:00:00-07:00");
    expect(built!.ref.end).toBe("2026-08-09T08:10:00-07:00");
  });

  it("records receipts a reader can use without opening the sidecar", () => {
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", [
      { at: "2026-08-09T08:00:00-07:00", value: 60 },
      { at: "2026-08-09T08:05:00-07:00", value: 80 },
    ]);
    expect(built!.ref.n).toBe(2);
    expect(built!.ref.summary).toEqual({ min: 60, max: 80, mean: 70 });
    expect(built!.ref.unit).toBe("bpm");
    expect(built!.ref.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps two devices' readings in separate files for the same day", () => {
    const samples: Sample[] = [{ at: "2026-08-09T08:00:00-07:00", value: 60 }];
    const apple = buildSeries("heart_rate", "apple-1", "2026-08-09", samples);
    const whoop = buildSeries("heart_rate", "whoop-1", "2026-08-09", samples);
    expect(apple!.ref.file).not.toBe(whoop!.ref.file);
  });

  it("returns null rather than an empty file when there is nothing to write", () => {
    expect(buildSeries("heart_rate", "apple-1", "2026-08-09", [])).toBeNull();
  });
});

describe("checkSeriesRef", () => {
  const samples: Sample[] = [
    { at: "2026-08-09T08:00:00-07:00", value: 62 },
    { at: "2026-08-09T08:05:00-07:00", value: 64 },
  ];

  it("passes a sidecar that matches its receipts", () => {
    const athleteFile = tempAthleteFile();
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", samples)!;
    writeSeriesFile(athleteFile, built);
    expect(checkSeriesRef(athleteFile, built.ref).status).toBe("ok");
  });

  it("reports a missing sidecar as missing, so the caller can warn not fail", () => {
    const athleteFile = tempAthleteFile();
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", samples)!;
    expect(checkSeriesRef(athleteFile, built.ref).status).toBe("missing");
  });

  it("catches a sidecar edited after import", () => {
    const athleteFile = tempAthleteFile();
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", samples)!;
    writeSeriesFile(athleteFile, built);

    const target = join(athleteFile, "..", built.ref.file);
    const tampered = JSON.parse(readFileSync(target, "utf8"));
    tampered.values[0] = 999;
    writeFileSync(target, JSON.stringify(tampered, null, 2) + "\n");

    expect(checkSeriesRef(athleteFile, built.ref).status).toBe("hash_mismatch");
  });

  it("round-trips samples back to their original instants", () => {
    const athleteFile = tempAthleteFile();
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", samples)!;
    writeSeriesFile(athleteFile, built);

    const read = readSeriesSamples(athleteFile, built.ref);
    expect(read.map((s) => s.value)).toEqual([62, 64]);
    expect(Date.parse(read[0]!.at)).toBe(Date.parse(samples[0]!.at));
    expect(Date.parse(read[1]!.at)).toBe(Date.parse(samples[1]!.at));
  });
});
