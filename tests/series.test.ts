import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleSeriesRef,
  buildSeries,
  checkSeriesRef,
  readSeriesDay,
  seriesDayFiles,
  writeSeriesFile,
  type Sample,
} from "../src/series.js";
import { SeriesFile } from "../src/schema.js";

function tempAthleteFile(): string {
  return join(mkdtempSync(join(tmpdir(), "ath-series-")), "athlete.ath.json");
}

/** Write one day's sidecar and return the athlete file it sits beside. */
function withDays(
  days: { day: string; samples: Sample[]; source?: string }[],
  quantity: "heart_rate" | "hrv_beats" = "heart_rate",
): string {
  const athleteFile = tempAthleteFile();
  for (const entry of days) {
    const built = buildSeries(quantity, entry.source ?? "apple-1", entry.day, entry.samples)!;
    writeSeriesFile(athleteFile, built);
  }
  return athleteFile;
}

const twoSamples: Sample[] = [
  { at: "2026-08-09T08:00:00-07:00", value: 62 },
  { at: "2026-08-09T08:05:00-07:00", value: 64 },
];

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
    expect(parsed.start).toBe("2026-08-09T08:00:00-07:00");
  });

  it("names the day, quantity, and source it belongs to", () => {
    const built = buildSeries("heart_rate", "apple-1", "2026-08-09", twoSamples)!;
    expect(built.day).toBe("2026-08-09");
    expect(built.quantity).toBe("heart_rate");
    expect(built.source).toBe("apple-1");
    expect(built.n).toBe(2);
    expect(built.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps two devices' readings in separate files for the same day", () => {
    const samples: Sample[] = [{ at: "2026-08-09T08:00:00-07:00", value: 60 }];
    const apple = buildSeries("heart_rate", "apple-1", "2026-08-09", samples)!;
    const whoop = buildSeries("heart_rate", "whoop-1", "2026-08-09", samples)!;
    expect(apple.file).not.toBe(whoop.file);
  });

  it("returns null rather than an empty file when there is nothing to write", () => {
    expect(buildSeries("heart_rate", "apple-1", "2026-08-09", [])).toBeNull();
  });
});

describe("seriesDayFiles", () => {
  it("finds a quantity's days in date order", () => {
    const athleteFile = withDays([
      { day: "2026-08-10", samples: twoSamples },
      { day: "2026-08-08", samples: twoSamples },
      { day: "2026-08-09", samples: twoSamples },
    ]);
    expect(seriesDayFiles(athleteFile, "heart_rate", "apple-1").map((f) => f.day)).toEqual([
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
    ]);
  });

  it("keeps sources apart even though ids contain hyphens", () => {
    // `apple-ecg-1` ends with `-1` just as `apple-1` does, so a loose match would
    // pull one device's days into the other's coverage.
    const athleteFile = withDays(
      [
        { day: "2026-08-09", samples: twoSamples, source: "apple-1" },
        { day: "2026-08-09", samples: twoSamples, source: "apple-ecg-1" },
        { day: "2026-08-10", samples: twoSamples, source: "apple-ecg-1" },
      ],
      "hrv_beats",
    );
    expect(seriesDayFiles(athleteFile, "hrv_beats", "apple-1")).toHaveLength(1);
    expect(seriesDayFiles(athleteFile, "hrv_beats", "apple-ecg-1")).toHaveLength(2);
  });

  it("returns nothing when there is no series folder", () => {
    expect(seriesDayFiles(tempAthleteFile(), "heart_rate", "apple-1")).toEqual([]);
  });
});

describe("assembleSeriesRef", () => {
  it("describes the whole quantity in one record", () => {
    const athleteFile = withDays([
      { day: "2026-08-08", samples: twoSamples },
      { day: "2026-08-09", samples: twoSamples },
      { day: "2026-08-11", samples: [{ at: "2026-08-11T08:00:00-07:00", value: 70 }] },
    ]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;

    expect(ref.from).toBe("2026-08-08");
    expect(ref.to).toBe("2026-08-11");
    // Three days with files; the gap on the 10th is not counted as covered.
    expect(ref.days).toBe(3);
    expect(ref.n).toBe(5);
    expect(ref.unit).toBe("bpm");
    expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns null when a quantity has no days on disk", () => {
    expect(assembleSeriesRef(tempAthleteFile(), "heart_rate", "apple-1")).toBeNull();
  });

  it("gives the same hash for the same files, whatever order they were written", () => {
    const forward = withDays([
      { day: "2026-08-08", samples: twoSamples },
      { day: "2026-08-09", samples: twoSamples },
    ]);
    const backward = withDays([
      { day: "2026-08-09", samples: twoSamples },
      { day: "2026-08-08", samples: twoSamples },
    ]);
    expect(assembleSeriesRef(forward, "heart_rate", "apple-1")!.sha256).toBe(
      assembleSeriesRef(backward, "heart_rate", "apple-1")!.sha256,
    );
  });

  it("changes the hash when a day's samples move to a different date", () => {
    // The day is hashed alongside its content, so identical bytes on a different
    // date are a different series.
    const original = withDays([{ day: "2026-08-08", samples: twoSamples }]);
    const moved = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    expect(assembleSeriesRef(original, "heart_rate", "apple-1")!.sha256).not.toBe(
      assembleSeriesRef(moved, "heart_rate", "apple-1")!.sha256,
    );
  });
});

describe("checkSeriesRef", () => {
  it("passes when disk matches the record", () => {
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;
    expect(checkSeriesRef(athleteFile, ref).status).toBe("ok");
  });

  it("reports an absent series folder as its own case, not a failure", () => {
    // The document travelling without its sidecars is normal and must stay usable.
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;
    rmSync(join(athleteFile, "..", "series"), { recursive: true, force: true });
    expect(checkSeriesRef(athleteFile, ref).status).toBe("no_series_dir");
  });

  it("catches an edited day", () => {
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;

    const target = join(athleteFile, "..", seriesDayFiles(athleteFile, "heart_rate", "apple-1")[0]!.file);
    const tampered = JSON.parse(readFileSync(target, "utf8"));
    tampered.values[0] = 999;
    writeFileSync(target, JSON.stringify(tampered, null, 2) + "\n");

    expect(checkSeriesRef(athleteFile, ref).status).toBe("mismatch");
  });

  it("catches a deleted day", () => {
    // Missing, extra, and edited all report the same thing, because the remedy is
    // the same for all three: import again.
    const athleteFile = withDays([
      { day: "2026-08-08", samples: twoSamples },
      { day: "2026-08-09", samples: twoSamples },
    ]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;
    rmSync(join(athleteFile, "..", seriesDayFiles(athleteFile, "heart_rate", "apple-1")[0]!.file));
    expect(checkSeriesRef(athleteFile, ref).status).toBe("mismatch");
  });

  it("catches an added day", () => {
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    const ref = assembleSeriesRef(athleteFile, "heart_rate", "apple-1")!;
    writeSeriesFile(
      athleteFile,
      buildSeries("heart_rate", "apple-1", "2026-08-10", twoSamples)!,
    );
    expect(checkSeriesRef(athleteFile, ref).status).toBe("mismatch");
  });
});

describe("readSeriesDay", () => {
  it("round-trips samples back to their original instants", () => {
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    const read = readSeriesDay(athleteFile, "heart_rate", "apple-1", "2026-08-09")!;
    expect(read.map((s) => s.value)).toEqual([62, 64]);
    expect(Date.parse(read[0]!.at)).toBe(Date.parse(twoSamples[0]!.at));
    expect(Date.parse(read[1]!.at)).toBe(Date.parse(twoSamples[1]!.at));
  });

  it("returns null for a day with no sidecar", () => {
    const athleteFile = withDays([{ day: "2026-08-09", samples: twoSamples }]);
    expect(readSeriesDay(athleteFile, "heart_rate", "apple-1", "2026-08-10")).toBeNull();
  });
});
