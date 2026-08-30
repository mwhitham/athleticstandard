/**
 * WHOOP's standard dashboard export: four flat CSVs.
 *
 * Three of them are device measurements. The fourth, `journal_entries.csv`, is the
 * wearer's own answers about alcohol, caffeine, and the like — self-reported data
 * that happens to travel inside a device export. Those import as soft signals with
 * no source, because the tier is decided by who reported the number, not by which
 * file carried it (D30).
 *
 * Recovery and strain are kept too, as vendor scores rather than measurements: they
 * are WHOOP's own composites on WHOOP's own scales (D27).
 */
import type { HardSignalT, SoftSignalT, SoftSignalTypeT } from "../schema.js";
import { countSkip, countSkipWithExample, emptyPayload, type ImportPayload } from "./merge.js";
import { cell, minutesToSeconds, num, parseCsv, positive, withOffset, type Row } from "./csv.js";

/** What we actually saw, quoted, so a format change is legible in the summary. */
function describeTime(value: string | undefined, offset: string | undefined): string {
  if (!value) return "blank timestamp";
  return `"${value}" with timezone "${offset ?? "(none)"}"`;
}

const CYCLES = "physiological_cycles.csv";
const SLEEPS = "sleeps.csv";
const WORKOUTS = "workouts.csv";
const JOURNAL = "journal_entries.csv";

/** Point measurements in the cycles file, recorded at wake. */
const CYCLE_POINTS: { columns: string[]; type: string; unit: string }[] = [
  { columns: ["Heart rate variability (ms)", "hrv_ms"], type: "hrv_rmssd", unit: "ms" },
  { columns: ["Resting heart rate (bpm)"], type: "resting_heart_rate", unit: "bpm" },
  { columns: ["Respiratory rate (rpm)"], type: "respiratory_rate", unit: "brpm" },
  { columns: ["Skin temp (celsius)", "skin_temp_celsius"], type: "skin_temperature", unit: "°C" },
  { columns: ["Blood oxygen %"], type: "oxygen_saturation", unit: "%" },
];

/**
 * Journal questions to soft-signal types, where the mapping is honest.
 * Anything not listed becomes a `note` keeping the question text, rather than
 * being forced into a category that changes its meaning.
 */
const JOURNAL_TYPES: { match: RegExp; type: SoftSignalTypeT }[] = [
  { match: /alcohol|caffeine|coffee|ate |eat |meal|hydrat|water|supplement|creatine/i, type: "nutrition" },
  { match: /stress|anxious|anxiety|meditat|breathwork|journal/i, type: "stress" },
  { match: /sleep|bed|nap|blue light|screen/i, type: "sleep_quality" },
  { match: /sore|injur|pain/i, type: "soreness" },
  { match: /energy|fatigue|tired/i, type: "energy" },
  { match: /mood|happy|sad/i, type: "mood" },
];

function journalType(question: string): SoftSignalTypeT {
  return JOURNAL_TYPES.find((m) => m.match.test(question))?.type ?? "note";
}

/** WHOOP answers are yes/no; anything else is passed through verbatim. */
function isAffirmative(answer: string): boolean {
  return /^(true|yes|1)$/i.test(answer.trim());
}

export function importWhoop(files: Map<string, string>, sourceId: string): ImportPayload {
  const payload = emptyPayload("whoop", "WHOOP via CSV export");

  const cycles = files.get(CYCLES);
  const sleeps = files.get(SLEEPS);
  const workouts = files.get(WORKOUTS);
  const journal = files.get(JOURNAL);

  if (cycles) importCycles(parseCsv(cycles), sourceId, payload);
  if (sleeps) importSleeps(parseCsv(sleeps), sourceId, payload);
  if (workouts) importWorkouts(parseCsv(workouts), sourceId, payload);
  if (journal) importJournal(parseCsv(journal), payload);

  for (const name of files.keys()) {
    if (![CYCLES, SLEEPS, WORKOUTS, JOURNAL].includes(name)) {
      countSkip(payload, `unrecognized WHOOP file: ${name}`);
    }
  }

  return payload;
}

/** The offset column names the cycle's timezone; every row in the file carries it. */
function rowOffset(row: Row): string | undefined {
  return cell(row, "Cycle timezone", "cycle_timezone", "timezone_offset");
}

function importCycles(rows: Row[], sourceId: string, payload: ImportPayload): void {
  for (const row of rows) {
    const offset = rowOffset(row);
    // Measurements belong to the moment the cycle ended, which is when WHOOP
    // computes them: at wake.
    const wake = withOffset(cell(row, "Wake onset", "Cycle end time", "Cycle start time"), offset);
    if (!wake) {
      countSkipWithExample(
        payload,
        "cycle rows with an unreadable timestamp",
        describeTime(cell(row, "Wake onset", "Cycle end time", "Cycle start time"), offset),
      );
      continue;
    }

    for (const mapping of CYCLE_POINTS) {
      const value = positive(row, ...mapping.columns);
      if (value === undefined) continue;
      payload.hardSignals.push({
        type: mapping.type,
        value: Math.round(value * 100) / 100,
        unit: mapping.unit,
        recorded_at: wake,
        source: sourceId,
      } as unknown as HardSignalT);
    }

    // Recovery and strain are WHOOP's composites, not measurements (D27).
    const recovery = num(row, "Recovery score %", "recovery_score");
    if (recovery !== undefined) {
      payload.hardSignals.push({
        type: "vendor_score",
        metric: "recovery",
        value: recovery,
        scale: "0-100",
        recorded_at: wake,
        source: sourceId,
      });
    }
    const strain = num(row, "Day Strain", "day_strain");
    if (strain !== undefined) {
      payload.hardSignals.push({
        type: "vendor_score",
        metric: "strain",
        value: Math.round(strain * 100) / 100,
        scale: "0-21",
        recorded_at: wake,
        source: sourceId,
      });
    }
  }
}

function importSleeps(rows: Row[], sourceId: string, payload: ImportPayload): void {
  for (const row of rows) {
    const offset = rowOffset(row);
    const start = withOffset(cell(row, "Sleep onset"), offset);
    const end = withOffset(cell(row, "Wake onset"), offset);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      countSkipWithExample(
        payload,
        "sleep rows with an unusable time range",
        `${describeTime(cell(row, "Sleep onset"), offset)} → ${describeTime(cell(row, "Wake onset"), offset)}`,
      );
      continue;
    }

    const aggregates: Record<string, number> = {};
    const set = (key: string, value: number | undefined) => {
      if (value !== undefined) aggregates[key] = value;
    };

    set("duration_s", minutesToSeconds(positive(row, "Asleep duration (min)")));
    set("time_in_bed_s", minutesToSeconds(positive(row, "In bed duration (min)")));
    set("light_s", minutesToSeconds(positive(row, "Light sleep duration (min)")));
    set("deep_s", minutesToSeconds(positive(row, "Deep (SWS) duration (min)", "deep_sleep_duration_min")));
    set("rem_s", minutesToSeconds(positive(row, "REM duration (min)")));
    set("awake_s", minutesToSeconds(positive(row, "Awake duration (min)")));

    const efficiency = positive(row, "Sleep efficiency %");
    if (efficiency !== undefined) {
      aggregates.efficiency_pct = Math.min(100, Math.round(efficiency * 10) / 10);
    }

    payload.hardSignals.push({
      type: "sleep_session",
      start,
      end,
      source: sourceId,
      aggregates: aggregates as never,
    } as HardSignalT);
  }
}

function importWorkouts(rows: Row[], sourceId: string, payload: ImportPayload): void {
  for (const row of rows) {
    const offset = rowOffset(row);
    const start = withOffset(cell(row, "Workout start time"), offset);
    const end = withOffset(cell(row, "Workout end time"), offset);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      countSkipWithExample(
        payload,
        "workout rows with an unusable time range",
        `${describeTime(cell(row, "Workout start time"), offset)} → ${describeTime(cell(row, "Workout end time"), offset)}`,
      );
      continue;
    }

    const aggregates: Record<string, unknown> = {};
    const activity = cell(row, "Activity name");
    if (activity) aggregates.activity = activity.toLowerCase();
    const avg = positive(row, "Average HR (bpm)", "average_hr_bpm");
    if (avg !== undefined) aggregates.avg_hr_bpm = Math.round(avg);
    const max = positive(row, "Max HR (bpm)", "max_hr_bpm");
    if (max !== undefined) aggregates.max_hr_bpm = Math.round(max);
    const energy = positive(row, "Energy burned (cal)");
    if (energy !== undefined) aggregates.energy_kcal = Math.round(energy);
    const distance = positive(row, "Distance (meters)", "distance_meters");
    if (distance !== undefined) aggregates.distance_m = Math.round(distance);

    payload.hardSignals.push({
      type: "workout_session",
      start,
      end,
      source: sourceId,
      aggregates: aggregates as never,
    } as HardSignalT);

    // Strain is per-workout as well as per-day, and it is still a vendor composite.
    const strain = num(row, "Activity Strain", "activity_strain");
    if (strain !== undefined) {
      payload.hardSignals.push({
        type: "vendor_score",
        metric: "activity_strain",
        value: Math.round(strain * 100) / 100,
        scale: "0-21",
        recorded_at: start,
        source: sourceId,
      });
    }
  }
}

/**
 * Journal rows become soft signals. No source field — soft signals structurally
 * cannot claim device provenance (D2) — and the question text is kept verbatim so
 * nothing is silently reinterpreted.
 */
function importJournal(rows: Row[], payload: ImportPayload): void {
  for (const row of rows) {
    const offset = rowOffset(row);
    // Keyed on the cycle end, the wake date, which is how the other files align.
    // The current cycle has no end yet, so fall back to its start.
    const reportedAt = withOffset(cell(row, "Cycle end time", "Cycle start time"), offset);
    const question = cell(row, "Question text", "question_text");
    if (!reportedAt || !question) {
      // Without a timestamp there is nowhere in time to put the answer, and a
      // soft signal must be dated to be worth anything.
      countSkipWithExample(
        payload,
        "journal rows we cannot place in time",
        !question
          ? "row has no question text"
          : cell(row, "Cycle end time", "Cycle start time") === undefined
            ? "row has neither a cycle start nor end time"
            : describeTime(cell(row, "Cycle end time", "Cycle start time"), offset),
      );
      continue;
    }

    const answer = cell(row, "Answered yes", "answered_yes", "Answer") ?? "";
    const notes = cell(row, "Notes");

    const affirmative = isAffirmative(answer);
    const note = [`${question}: ${affirmative ? "yes" : "no"}`, notes].filter(Boolean).join(" — ");

    const signal: SoftSignalT = {
      type: journalType(question),
      reported_at: reportedAt,
      note,
      provenance: { via: "text" },
    };
    payload.softSignals.push(signal);
  }
}
