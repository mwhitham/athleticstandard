import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AthleticStandardFileT, HardSignalT } from "../src/schema.js";
import { readScore } from "../src/logparse.js";
import { takeDate } from "../src/log.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");

function ath(args: string[], cwd: string, stdin = ""): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8", input: stdin });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

function newAthlete(): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-log-"));
  expect(ath(["init", "-y"], dir).code).toBe(0);
  return dir;
}

function read(dir: string): AthleticStandardFileT {
  return JSON.parse(readFileSync(join(dir, "athlete.ath.json"), "utf8"));
}

/** Log an entry and hand back the file it produced. */
function log(args: string[], stdin = "", dir = newAthlete()) {
  const res = ath(["log", ...args], dir, stdin);
  return { dir, res, file: read(dir) };
}

const results = (file: AthleticStandardFileT) =>
  file.hard_signals.filter(
    (s): s is Extract<HardSignalT, { type: "benchmark_result" }> => s.type === "benchmark_result",
  );

const measurements = (file: AthleticStandardFileT) =>
  file.hard_signals.filter((s) => "value" in s && "unit" in s);

/** A day's crossfit session, so a result has something to be matched against. */
function withSession(dir: string, start: string, end: string, source = "whoop-1"): void {
  const path = join(dir, "athlete.ath.json");
  const file: AthleticStandardFileT = JSON.parse(readFileSync(path, "utf8"));
  if (!file.sources.some((s) => s.id === source)) {
    file.sources.push({ id: source, kind: "wearable", vendor: "whoop" });
  }
  file.hard_signals.push({
    type: "workout_session",
    start,
    end,
    source,
    aggregates: { activity: "crossfit", avg_hr_bpm: 168 },
  });
  writeFileSync(path, JSON.stringify(file, null, 2));
}

const TODAY = new Date().toLocaleDateString("en-CA");

describe("ath log — telling the four kinds apart (D57)", () => {
  it("reads a scored paste as a workout result", () => {
    const { res, file } = log(
      [],
      '7 ROUNDS FOR REPS\n40s ALT DB SNATCH 55lbs\n20s REST\n40s BOX STEP UPS 20"\n245 TOTAL REPS\n',
    );
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kind     workout result");
    expect(results(file)).toHaveLength(1);
    expect(results(file)[0]!.result).toEqual({ reps: 245 });
  });

  it("reads a named measurement with a number as a hand-typed measurement", () => {
    const { res, file } = log(["HRV", "61", "this", "morning"]);
    expect(res.stdout).toContain("hrv_rmssd 61 ms");
    const reading = measurements(file)[0] as { type: string; value: number; source: string };
    expect(reading).toMatchObject({ type: "hrv_rmssd", value: 61, source: "manual-1" });
    expect(file.soft_signals).toHaveLength(0);
  });

  it("reads a rating as a rated soreness entry, with the body region", () => {
    const { file } = log(["sore", "quads", "4/5"]);
    expect(file.soft_signals[0]).toMatchObject({
      type: "soreness",
      rating: 4,
      scale: "1-5",
      body_region: "quads",
      note: "sore quads 4/5",
    });
  });

  it("reads words no list contains as a plain note, kept verbatim", () => {
    const { file } = log(["quads", "are", "wrecked"]);
    expect(file.soft_signals[0]).toMatchObject({ type: "note", note: "quads are wrecked" });
    expect(file.hard_signals).toHaveLength(0);
  });

  it("keeps 'slept 5 hours' a note, because a sleep session needs a start and an end", () => {
    const { file } = log(["slept", "5", "hours"]);
    expect(file.hard_signals).toHaveLength(0);
    expect(file.soft_signals[0]!.type).toBe("sleep_quality");
    expect(file.soft_signals[0]!.note).toBe("slept 5 hours");
  });

  it("refuses a name covering several measurements, and names them (D28)", () => {
    const { res, file } = log(["temperature", "36.8"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("body_temperature");
    expect(res.stdout).toContain("wrist_temperature_sleeping");
    expect(file.hard_signals).toHaveLength(0);
    expect(file.soft_signals).toHaveLength(0);
  });

  it("never turns free text into a prediction", () => {
    const { file } = log(["I", "reckon", "Fran", "in", "about", "4:20", "next", "week"]);
    expect(file.predictions).toHaveLength(0);
  });

  it("writes three records from one sentence, under one question", () => {
    const { res, file } = log(["Did", "Fran", "in", "4:41,", "felt", "awful,", "slept", "about", "5", "hours"]);
    expect(results(file)).toHaveLength(1);
    expect(results(file)[0]!.benchmark).toBe("fran");
    expect(file.soft_signals.map((s) => s.type)).toEqual(["mood", "sleep_quality"]);
    // One summary with three blocks, and one question at the end of it.
    expect(res.stdout.match(/kind /g)).toHaveLength(3);
  });

  it("keeps a comma inside one thought as one entry", () => {
    const { file } = log(["slept", "badly,", "about", "5", "hours"]);
    expect(file.soft_signals).toHaveLength(1);
    expect(file.soft_signals[0]!.note).toBe("slept badly, about 5 hours");
  });

  it("dispatches an agent's JSON on shape, with nothing guessed", () => {
    const dir = newAthlete();
    const payload = JSON.stringify([
      { type: "hrv_rmssd", value: 58, unit: "ms", recorded_at: "2026-09-04T06:10:00Z" },
      { type: "stress", reported_at: "2026-09-04T20:00:00Z", rating: 4, scale: "1-5", note: "deadline" },
    ]);
    expect(ath(["log"], dir, payload).code).toBe(0);
    const file = read(dir);
    expect(measurements(file)).toHaveLength(1);
    expect(file.soft_signals[0]).toMatchObject({ type: "stress", rating: 4 });
  });

  it("takes a prediction only from an agent, and only in the prediction's shape", () => {
    const dir = newAthlete();
    const payload = JSON.stringify({
      id: "pred-2026-09-04-fran",
      benchmark: "fran",
      created_at: "2026-09-04T15:00:00Z",
      predicted: { duration_s: 275 },
      range: { low: { duration_s: 265 }, high: { duration_s: 290 } },
      confidence: "moderate",
      reasoning: "Last Fran 4:41 on 2026-06-02, HRV steady at 63ms.",
      evidence_window: { from: "2026-06-01", to: "2026-09-04" },
      model: "claude-sonnet-4-5",
    });
    const res = ath(["log"], dir, payload);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("kind        prediction");
    expect(read(dir).predictions).toHaveLength(1);
  });
});

describe("ath log — the direction of failure (D59)", () => {
  /** The rule that makes the word list safe: a misread can only land in the soft tier. */
  const noNameNoNumber = [
    "everything hurts",
    "coach said to back off this week",
    "meeting at 9:30",
    "travelled all day",
    "wrecked",
    "did the thing again",
    "felt strong but the last round fell apart",
  ];

  it("cannot produce a hard signal from text naming no measurement and no score", () => {
    for (const text of noNameNoNumber) {
      const { file } = log(text.split(" "));
      expect(file.hard_signals, `"${text}" reached the measured tier`).toHaveLength(0);
      expect(file.soft_signals).toHaveLength(1);
      expect(file.soft_signals[0]!.note).toBe(text);
    }
  });

  it("keeps a clock time an appointment unless the words say training", () => {
    expect(log(["meeting", "at", "9:30"]).file.hard_signals).toHaveLength(0);
    expect(results(log(["5k", "run", "in", "22:14"]).file)).toHaveLength(1);
  });

  it("refuses a unit that does not fit, rather than converting something", () => {
    const { res, file } = log(["HRV", "61", "bpm"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("not a unit it accepts");
    expect(file.hard_signals).toHaveLength(0);
  });

  it("refuses a number no body produces", () => {
    const { res } = log(["resting", "heart", "rate", "480"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("reads as a typo");
  });
});

describe("ath log — dates", () => {
  it("dates an entry today when no date is given", () => {
    const { file } = log(["quads", "are", "wrecked"]);
    expect(file.soft_signals[0]!.reported_at.slice(0, 10)).toBe(TODAY);
  });

  it("takes a leading ISO date as the day", () => {
    const { file } = log(["2026-09-04", "quads", "are", "wrecked"]);
    expect(file.soft_signals[0]!.reported_at.slice(0, 10)).toBe("2026-09-04");
    expect(file.soft_signals[0]!.note).toBe("quads are wrecked");
  });

  it("refuses an ambiguous date and names both readings (D56)", () => {
    const { res, file } = log(["09-04-2026", "245", "total", "reps"]);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("2026-09-04");
    expect(res.stdout).toContain("2026-04-09");
    expect(file.hard_signals).toHaveLength(0);
  });

  it("reads a leading date the same way from the command line and from a paste", () => {
    expect(takeDate("2026-09-04 sore quads").day).toBe("2026-09-04");
    expect(takeDate("2026-09-04 sore quads").rest).toBe("sore quads");
    expect(takeDate("sore quads").rest).toBe("sore quads");
  });
});

describe("ath log — the workout result", () => {
  it("creates a benchmark that does not exist, rather than refusing", () => {
    const { file } = log([], "10 rounds of 10 burpees\n100 total reps\n");
    expect(file.benchmarks.some((b) => b.id === TODAY)).toBe(true);
    expect(results(file)[0]!.benchmark).toBe(TODAY);
  });

  it("names it after the day when nothing else names it, and says why", () => {
    const { res } = log([], "10 rounds of 10 burpees\n100 total reps\n");
    expect(res.stdout).toContain("no agent connected, so named after the day");
  });

  it("takes the name an agent supplies", () => {
    const { file } = log(["--benchmark", "Fran with Dumbbells"], "21-15-9 db thrusters\n4:58\n");
    expect(file.benchmarks.some((b) => b.id === "fran-with-dumbbells")).toBe(true);
  });

  it("keeps the workout text word for word as the definition", () => {
    const text = '7 ROUNDS FOR REPS\n40s BOX STEP UPS 20"\n245 TOTAL REPS';
    const { file } = log([], `${text}\n`);
    expect(file.benchmarks.find((b) => b.id === TODAY)!.definition).toBe(text);
  });

  it("gives two different workouts on one day two names", () => {
    const dir = newAthlete();
    ath(["log"], dir, "10 rounds of burpees\n100 total reps\n");
    ath(["log"], dir, "5 rounds of thrusters\n80 total reps\n");
    const ids = read(dir).benchmarks.map((b) => b.id);
    expect(ids).toContain(TODAY);
    expect(ids).toContain(`${TODAY}-2`);
  });

  it("takes no quotes, even with a double quote inside the workout", () => {
    const { res, file } = log([], '3 rounds\n20" box jumps\n60 total reps\n');
    expect(res.code).toBe(0);
    expect(file.benchmarks.find((b) => b.id === TODAY)!.definition).toContain('20" box jumps');
  });

  it("writes nothing on --dry-run, and says so", () => {
    const { res, file } = log(["--dry-run", "sore", "quads", "4/5"]);
    expect(res.stdout).toContain("nothing written (--dry-run)");
    expect(file.soft_signals).toHaveLength(0);
  });
});

describe("readScore", () => {
  it("prefers a labelled total to any other number in the text", () => {
    expect(readScore('40s BOX STEP UPS 55lbs 20" 20s REST 245 TOTAL REPS')!.score).toEqual({ reps: 245 });
  });

  it("reads a clock as a time, and states it back the way it was written", () => {
    expect(readScore("Did Fran in 4:41")).toMatchObject({
      score: { duration_s: 281 },
      scoreText: "4:41",
    });
    expect(readScore("marathon 3:12:40")!.score).toEqual({ duration_s: 11560 });
  });

  it("reads a load at the end, converting pounds", () => {
    expect(readScore("back squat 1RM 315 lb")!.score).toEqual({ weight_kg: 142.88 });
  });

  it("finds no score where none is written", () => {
    expect(readScore("felt strong today")).toBeNull();
  });
});

describe("ath log — session matching at log time (D53)", () => {
  it("offers the covering session as a line in the same summary", () => {
    const dir = newAthlete();
    withSession(dir, `${TODAY}T17:25:00Z`, `${TODAY}T17:48:00Z`);
    const res = ath(["log", "--yes"], dir, "3 rounds for time\n21 thrusters\n4:41\n");
    expect(res.stdout).toContain("session  17:25 to 17:48 on whoop-1");
    expect(results(read(dir))[0]!.session).toEqual({ source: "whoop-1", start: `${TODAY}T17:25:00Z` });
  });

  it("offers a second candidate as an extra key rather than a second question", () => {
    const dir = newAthlete();
    withSession(dir, `${TODAY}T17:25:00Z`, `${TODAY}T17:48:00Z`);
    withSession(dir, `${TODAY}T19:02:00Z`, `${TODAY}T19:40:00Z`);
    const res = ath(["log", "--dry-run"], dir, "3 rounds for time\n21 thrusters\n4:41\n");
    expect(res.stdout).toMatch(/\[y\] yes {2}\[n\] no {2}\[2\] use the \d\d:\d\d one instead/);
  });

  it("says plainly when there is no session yet, and how to link it later", () => {
    const { res } = log([], "3 rounds for time\n21 thrusters\n4:41\n");
    expect(res.stdout).toContain("no device session that day yet");
    expect(res.stdout).toContain("ath link");
  });

  it("writes the result unlinked when the match is declined", () => {
    const dir = newAthlete();
    withSession(dir, `${TODAY}T17:25:00Z`, `${TODAY}T17:48:00Z`);
    // No terminal to ask on, so nothing is chosen and the result stands alone.
    ath(["log"], dir, "3 rounds for time\n21 thrusters\n4:41\n");
    expect(results(read(dir))[0]!.session).toBeUndefined();
  });
});

describe("ath log — matches offered again after an import (D53)", () => {
  const EXPORTS = resolve(here, "fixtures/exports");

  /** Log a result on the day the WHOOP fixture has a workout on. */
  function loggedBeforeTheWatchSynced(): string {
    const dir = newAthlete();
    expect(ath(["log", "--date", "2026-08-09", "--benchmark", "fran"], dir, "21-15-9 thrusters\n4:41\n").code).toBe(0);
    expect(results(read(dir))[0]!.session).toBeUndefined();
    return dir;
  }

  it("names the waiting match and the command that links it", () => {
    const dir = loggedBeforeTheWatchSynced();
    const res = ath(["import", join(EXPORTS, "whoop")], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("now have a session on the same day");
    expect(res.stdout).toMatch(/ath link fran@2026-08-09 \d\d:\d\d/);
  });

  it("ath link attaches it, and can move a link that went to the wrong session", () => {
    const dir = loggedBeforeTheWatchSynced();
    expect(ath(["import", join(EXPORTS, "whoop")], dir).code).toBe(0);

    const sessions = read(dir).hard_signals.filter((s) => s.type === "workout_session");
    expect(sessions.length).toBeGreaterThan(0);
    const first = sessions[0] as { start: string; source: string };

    const linked = ath(["link", "fran@2026-08-09", first.start.slice(11, 16)], dir);
    expect(linked.code).toBe(0);
    expect(results(read(dir))[0]!.session).toEqual({ source: first.source, start: first.start });

    withSession(dir, "2026-08-09T21:15:00Z", "2026-08-09T21:45:00Z", "manual-watch");
    const moved = ath(["link", "fran@2026-08-09", "21:15"], dir);
    expect(moved.code).toBe(0);
    expect(moved.stdout).toContain("was ");
    expect(results(read(dir))[0]!.session!.start).toBe("2026-08-09T21:15:00Z");
  });

  it("says what sessions exist when the one named does not", () => {
    const dir = loggedBeforeTheWatchSynced();
    const res = ath(["link", "fran@2026-08-09", "03:00"], dir);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain("no session matching");
  });

  it("stops offering a match once it has been made", () => {
    const dir = loggedBeforeTheWatchSynced();
    ath(["import", join(EXPORTS, "whoop")], dir);
    const sessions = read(dir).hard_signals.filter((s) => s.type === "workout_session");
    const first = sessions[0] as { start: string };
    ath(["link", "fran@2026-08-09", first.start.slice(11, 16)], dir);

    const again = ath(["import", join(EXPORTS, "whoop")], dir);
    expect(again.stdout).not.toContain("now have a session on the same day");
  });
});
