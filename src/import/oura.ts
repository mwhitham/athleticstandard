/**
 * Oura's export: either a bundle of per-category CSVs or a single Trends table.
 *
 * Two traps this importer avoids. Oura publishes a readiness contributor called
 * "resting heart rate" that is a 0-100 sub-score, not a pulse; reading it as one
 * would put a number near 90 into a resting-HR baseline. And `temperature_deviation`
 * is a signed delta from Oura's own baseline, so it gets its own type rather than
 * being written as a body temperature (D28).
 */
import type { HardSignalT } from "../schema.js";
import { countSkip, emptyPayload, type ImportPayload } from "./merge.js";
import { cell, num, parseCsv, positive, withOffset, type Row } from "./csv.js";

/** Measurements taken from a sleep row. Oura already reports durations in seconds. */
const SLEEP_POINTS: { columns: string[]; type: string; unit: string }[] = [
  { columns: ["average_hrv", "Average HRV", "hrv"], type: "hrv_rmssd", unit: "ms" },
  // The genuine pulse figure. Oura's own "resting heart rate" contributor is a score.
  { columns: ["lowest_heart_rate", "Lowest Resting Heart Rate", "lowest_resting_heart_rate"], type: "resting_heart_rate", unit: "bpm" },
  { columns: ["average_breath", "Respiratory Rate", "respiratory_rate"], type: "respiratory_rate", unit: "brpm" },
  { columns: ["spo2_percentage", "Average SpO2", "spo2"], type: "oxygen_saturation", unit: "%" },
  { columns: ["vo2_max"], type: "vo2_max", unit: "ml/kg/min" },
];

const SLEEP_STAGES: { columns: string[]; key: string }[] = [
  { columns: ["total_sleep_duration", "Total Sleep Duration"], key: "duration_s" },
  { columns: ["time_in_bed", "Time in Bed"], key: "time_in_bed_s" },
  { columns: ["deep_sleep_duration", "Deep Sleep Duration"], key: "deep_s" },
  { columns: ["rem_sleep_duration", "REM Sleep Duration"], key: "rem_s" },
  { columns: ["light_sleep_duration", "Light Sleep Duration"], key: "light_s" },
  { columns: ["awake_time", "Awake Time", "awake_duration"], key: "awake_s" },
];

/** Vendor composites. Kept, labelled, and never mistaken for measurements (D27). */
const VENDOR_SCORES: { columns: string[]; metric: string }[] = [
  { columns: ["readiness_score", "Readiness Score"], metric: "readiness" },
  { columns: ["sleep_score", "Sleep Score"], metric: "sleep_score" },
  { columns: ["activity_score", "Activity Score"], metric: "activity_score" },
];

/**
 * Readiness contributors are sub-scores on a 0-100 scale. They are named after
 * measurements ("resting heart rate", "hrv balance") but they are not measurements,
 * so they import prefixed and clearly labelled.
 */
const CONTRIBUTORS = [
  "activity_balance",
  "body_temperature",
  "hrv_balance",
  "previous_day_activity",
  "previous_night",
  "recovery_index",
  "resting_heart_rate",
  "sleep_balance",
  "sleep_regularity",
];

export function importOura(files: Map<string, string>, sourceId: string): ImportPayload {
  const payload = emptyPayload("oura", "Oura via CSV export");

  for (const [name, text] of files) {
    const rows = parseCsv(text);
    if (rows.length === 0) {
      countSkip(payload, `empty CSV: ${name}`);
      continue;
    }
    importRows(rows, sourceId, payload, name);
  }

  return payload;
}

/**
 * Oura's export has one file per category, and its Trends download combines them.
 * Rather than switch on filename, each row contributes whatever columns it has —
 * a readiness file simply has no sleep columns.
 */
function importRows(rows: Row[], sourceId: string, payload: ImportPayload, name: string): void {
  let used = 0;

  for (const row of rows) {
    const bedtimeStart = withOffset(cell(row, "bedtime_start", "Bedtime Start"), undefined);
    const bedtimeEnd = withOffset(cell(row, "bedtime_end", "Bedtime End"), undefined);
    // Daily rows carry only a date; anchor them at the start of that local day.
    const day = cell(row, "day", "date", "summary_date");
    const anchor = bedtimeEnd ?? (day ? `${day}T00:00:00Z` : null);

    if (!anchor) {
      countSkip(payload, `${name}: rows without a date`);
      continue;
    }
    used++;

    for (const mapping of SLEEP_POINTS) {
      const value = positive(row, ...mapping.columns);
      if (value === undefined) continue;
      payload.hardSignals.push({
        type: mapping.type,
        value: Math.round(value * 100) / 100,
        unit: mapping.unit,
        recorded_at: anchor,
        source: sourceId,
      } as unknown as HardSignalT);
    }

    // A signed delta from Oura's own baseline, so it may be negative or zero.
    const deviation = num(row, "temperature_deviation", "Temperature Deviation");
    if (deviation !== undefined) {
      payload.hardSignals.push({
        type: "temperature_deviation",
        value: Math.round(deviation * 100) / 100,
        unit: "°C",
        recorded_at: anchor,
        source: sourceId,
      });
    }

    if (bedtimeStart && bedtimeEnd && Date.parse(bedtimeEnd) > Date.parse(bedtimeStart)) {
      const aggregates: Record<string, number> = {};
      for (const stage of SLEEP_STAGES) {
        const seconds = positive(row, ...stage.columns);
        if (seconds !== undefined) aggregates[stage.key] = Math.round(seconds);
      }
      const efficiency = positive(row, "efficiency", "sleep_efficiency", "Sleep Efficiency");
      if (efficiency !== undefined) {
        aggregates.efficiency_pct = Math.min(100, Math.round(efficiency * 10) / 10);
      }
      payload.hardSignals.push({
        type: "sleep_session",
        start: bedtimeStart,
        end: bedtimeEnd,
        source: sourceId,
        aggregates: aggregates as never,
      } as HardSignalT);
    }

    for (const score of VENDOR_SCORES) {
      const value = num(row, ...score.columns);
      if (value === undefined) continue;
      payload.hardSignals.push({
        type: "vendor_score",
        metric: score.metric,
        value,
        scale: "0-100",
        recorded_at: anchor,
        source: sourceId,
      });
    }

    for (const contributor of CONTRIBUTORS) {
      const value = num(row, `contributor_${contributor}`, `contributors_${contributor}`);
      if (value === undefined) continue;
      payload.hardSignals.push({
        type: "vendor_score",
        metric: `readiness_contributor_${contributor}`,
        value,
        scale: "0-100",
        recorded_at: anchor,
        source: sourceId,
      });
    }
  }

  if (used === 0) countSkip(payload, `${name}: no rows we could place`);
}
