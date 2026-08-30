/**
 * Apple Health export.xml.
 *
 * Streamed with sax, because these files reach gigabytes and the document is never
 * held in memory. Every record is classified as it arrives: a point measurement, a
 * sleep stage, a workout, a sample belonging to a dense series, or something we
 * will not guess at.
 *
 * The beat lists attached to HRV records are the reason this importer matters. Apple
 * reports HRV only as SDNN, but each SDNN record carries the beats underneath it, so
 * RMSSD can be computed rather than lost (D26).
 */
import { createReadStream } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import sax from "sax";
import type { HardSignalT, PointMeasurementType, SeriesQuantity } from "../schema.js";
import { buildSeries, type Sample } from "../series.js";
import { bpmToIntervalsMs, rmssdFromIntervals } from "../hrv.js";
import { countSkip, emptyPayload, type ImportPayload } from "./merge.js";
import type { DetectedExport } from "./detect.js";
import { openZipEntryStream, zipEntryNames, openZip } from "./zip.js";

/** HealthKit identifier suffix to point type, with the conversion each needs. */
interface PointMapping {
  type: PointMeasurementType;
  /** Apple's unit strings vary by locale and setting, so convert explicitly. */
  convert?: (value: number, unit: string) => number | null;
}

const LB_TO_KG = 0.45359237;

const POINT_MAPPINGS: Record<string, PointMapping> = {
  HeartRateVariabilitySDNN: {
    type: "hrv_sdnn",
    convert: (v, unit) => (unit === "s" ? v * 1000 : v),
  },
  RestingHeartRate: { type: "resting_heart_rate" },
  WalkingHeartRateAverage: { type: "walking_heart_rate" },
  HeartRateRecoveryOneMinute: { type: "hr_recovery" },
  RespiratoryRate: { type: "respiratory_rate" },
  BodyMass: {
    type: "body_weight",
    convert: (v, unit) => (unit === "lb" ? v * LB_TO_KG : v),
  },
  VO2Max: { type: "vo2_max" },
  AppleSleepingWristTemperature: { type: "wrist_temperature_sleeping" },
  BodyTemperature: { type: "body_temperature" },
  OxygenSaturation: {
    type: "oxygen_saturation",
    // Apple stores saturation as a fraction; the format keeps it as a percentage.
    convert: (v) => (v <= 1 ? v * 100 : v),
  },
};

const SERIES_MAPPINGS: Record<string, { quantity: SeriesQuantity; convert?: (v: number, unit: string) => number }> = {
  HeartRate: { quantity: "heart_rate" },
  StepCount: { quantity: "steps" },
  ActiveEnergyBurned: { quantity: "active_energy" },
  DistanceWalkingRunning: { quantity: "distance_walking_running", convert: milesAwareMeters },
  DistanceCycling: { quantity: "distance_cycling", convert: milesAwareMeters },
  DistanceSwimming: { quantity: "distance_swimming", convert: milesAwareMeters },
};

function milesAwareMeters(value: number, unit: string): number {
  if (unit === "mi") return value * 1609.344;
  if (unit === "km") return value * 1000;
  if (unit === "yd") return value * 0.9144;
  return value;
}

/** Sleep stage identifiers, including the undifferentiated older value. */
const SLEEP_ASLEEP_VALUES = new Set([
  "HKCategoryValueSleepAnalysisAsleep",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
]);

/** A gap this long between sleep records starts a new night. */
const SLEEP_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Apple writes `2026-08-09 06:12:00 -0700`. Turn that into ISO 8601 keeping the
 * offset, because a naive local time is not a valid timestamp in this format.
 */
export function parseAppleDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-]\d{2}):?(\d{2})?$/.exec(
    raw.trim(),
  );
  if (m) {
    const [, y, mo, d, h, mi, s, offH, offM = "00"] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${offH}:${offM}`;
  }
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (iso.test(raw.trim())) return raw.trim();
  return null;
}

/** Local calendar day of an offset timestamp, used to bucket series by day. */
function localDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Format an instant using the same UTC offset as a reference timestamp.
 *
 * Beat timestamps have to keep the offset of the record they came from. Writing
 * them as UTC would put a late-evening window on the next calendar day, and the
 * derived RMSSD would then cite a series day that does not exist (D26).
 */
function atOffsetOf(reference: string, instantMs: number): string {
  // Milliseconds are kept. Truncating to whole seconds would collapse beats that
  // fall inside the same second into one instant, which is the spacing that makes
  // beat data worth storing at all.
  const rounded = Math.round(instantMs);
  const offset = /([+-]\d{2}:\d{2})$/.exec(reference)?.[1];
  if (!offset) return new Date(rounded).toISOString();

  const sign = offset.startsWith("-") ? -1 : 1;
  const [oh, om] = offset.slice(1).split(":").map(Number);
  const offsetMs = sign * ((oh! * 60 + om!) * 60_000);
  const shifted = new Date(rounded + offsetMs).toISOString();
  return `${shifted.slice(0, 23)}${offset}`;
}

interface SleepFragment {
  start: string;
  end: string;
  value: string;
}

interface BeatWindow {
  recordedAt: string;
  intervalsMs: number[];
}

interface AppleAccumulator {
  points: HardSignalT[];
  sleepFragments: SleepFragment[];
  workouts: HardSignalT[];
  /** quantity -> day -> samples */
  series: Map<SeriesQuantity, Map<string, Sample[]>>;
  beatWindows: BeatWindow[];
}

/** Locate export.xml inside whatever the user handed us. */
async function openAppleXml(detected: DetectedExport): Promise<Readable> {
  if (detected.container === "file") return createReadStream(detected.path, "utf8");

  if (detected.container === "directory") {
    const candidates = [
      join(detected.path, "export.xml"),
      join(detected.path, "apple_health_export", "export.xml"),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error(`no export.xml under ${detected.path}`);
    return createReadStream(found, "utf8");
  }

  const zip = await openZip(detected.path);
  const entry = zipEntryNames(zip).find((n) => n.toLowerCase().endsWith("export.xml"));
  if (!entry) throw new Error(`no export.xml inside ${detected.path}`);
  return openZipEntryStream(detected.path, entry);
}

export async function importAppleHealth(
  detected: DetectedExport,
  sourceId: string,
): Promise<ImportPayload> {
  const payload = emptyPayload("apple", `Apple Health export (${detected.container})`);
  const acc: AppleAccumulator = {
    points: [],
    sleepFragments: [],
    workouts: [],
    series: new Map(),
    beatWindows: [],
  };

  const stream = await openAppleXml(detected);
  await parseAppleXml(stream, acc, payload, sourceId);

  payload.hardSignals.push(...acc.points);
  payload.hardSignals.push(...acc.workouts);
  payload.hardSignals.push(...buildSleepSessions(acc.sleepFragments, sourceId));

  // Beat windows become a per-day hrv_beats series plus one derived RMSSD each.
  const beatsByDay = new Map<string, Sample[]>();
  for (const window of acc.beatWindows) {
    const day = localDay(window.recordedAt);
    const samples = beatsByDay.get(day) ?? [];
    // Intervals are laid out sequentially from the window's start; each sample's
    // instant is where that beat fell, so the sidecar keeps the real spacing.
    let cursor = Date.parse(window.recordedAt);
    for (const interval of window.intervalsMs) {
      samples.push({
        at: atOffsetOf(window.recordedAt, cursor),
        value: Math.round(interval * 10) / 10,
      });
      cursor += interval;
    }
    beatsByDay.set(day, samples);

    const rmssd = rmssdFromIntervals(window.intervalsMs);
    if (!rmssd) {
      countSkip(payload, "HRV beat windows too short or sparse for RMSSD");
      continue;
    }
    payload.hardSignals.push({
      type: "hrv_rmssd",
      value: rmssd.rmssd_ms,
      unit: "ms",
      recorded_at: window.recordedAt,
      source: sourceId,
      derived: {
        from: "hrv_beats",
        method: "rmssd",
        window_s: rmssd.window_s,
        n_beats: rmssd.n_beats,
        ...(rmssd.n_dropped > 0 ? { n_dropped: rmssd.n_dropped } : {}),
      },
    });
  }
  for (const [day, samples] of beatsByDay) {
    const built = buildSeries("hrv_beats", sourceId, day, samples);
    if (built) payload.series.push(built);
  }

  for (const [quantity, byDay] of acc.series) {
    for (const [day, samples] of byDay) {
      const built = buildSeries(quantity, sourceId, day, samples);
      if (built) payload.series.push(built);
    }
  }

  return payload;
}

function parseAppleXml(
  stream: Readable,
  acc: AppleAccumulator,
  payload: ImportPayload,
  sourceId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true, lowercase: false });

    // Record-level state: a Record element may carry a nested beat list, and a
    // Workout may carry laps, so both need somewhere to collect children.
    let currentBeatWindow: BeatWindow | null = null;
    let currentWorkout: { start: string; end: string; segments: { label: string; duration_s?: number }[]; aggregates: Record<string, unknown> } | null = null;

    parser.on("error", (err) => reject(err));
    parser.on("end", () => resolve());

    parser.on("opentag", (node) => {
      const attrs = node.attributes as Record<string, string>;

      switch (node.name) {
        case "Record":
          handleRecord(attrs);
          break;

        case "HeartRateVariabilityMetadataList":
          // Opens inside an SDNN record; beats accumulate into the window below.
          break;

        case "InstantaneousBeatsPerMinute": {
          if (!currentBeatWindow) break;
          const bpm = Number(attrs.bpm);
          if (Number.isFinite(bpm) && bpm > 0) currentBeatWindow.intervalsMs.push(60000 / bpm);
          break;
        }

        case "Workout": {
          const start = parseAppleDate(attrs.startDate ?? "");
          const end = parseAppleDate(attrs.endDate ?? "");
          if (!start || !end || Date.parse(end) <= Date.parse(start)) {
            countSkip(payload, "workouts with an unusable time range");
            break;
          }
          const aggregates: Record<string, unknown> = {};
          const activity = (attrs.workoutActivityType ?? "").replace(/^HKWorkoutActivityType/, "");
          if (activity) aggregates.activity = activity.toLowerCase();
          const distance = Number(attrs.totalDistance);
          if (Number.isFinite(distance) && distance > 0) {
            aggregates.distance_m = round(
              milesAwareMeters(distance, attrs.totalDistanceUnit ?? "m"),
            );
          }
          const energy = Number(attrs.totalEnergyBurned);
          if (Number.isFinite(energy) && energy > 0) aggregates.energy_kcal = round(energy);
          currentWorkout = { start, end, segments: [], aggregates };
          break;
        }

        case "WorkoutEvent": {
          if (!currentWorkout || attrs.type !== "HKWorkoutEventTypeLap") break;
          const duration = Number(attrs.duration);
          currentWorkout.segments.push({
            label: `lap ${currentWorkout.segments.length + 1}`,
            ...(Number.isFinite(duration) && duration > 0
              ? { duration_s: round(duration * 60) }
              : {}),
          });
          break;
        }

        case "MetadataEntry": {
          // Workout HR summaries arrive as metadata on some exports.
          if (!currentWorkout) break;
          const value = Number(attrs.value);
          if (!Number.isFinite(value) || value <= 0) break;
          if (attrs.key === "HKAverageHeartRate") currentWorkout.aggregates.avg_hr_bpm = round(value);
          if (attrs.key === "HKMaximumHeartRate") currentWorkout.aggregates.max_hr_bpm = round(value);
          break;
        }

        case "ClinicalRecord":
          countSkip(payload, "clinical records (out of scope)");
          break;
      }
    });

    parser.on("closetag", (name) => {
      if (name === "Record" && currentBeatWindow) {
        if (currentBeatWindow.intervalsMs.length > 0) acc.beatWindows.push(currentBeatWindow);
        currentBeatWindow = null;
      }
      if (name === "Workout" && currentWorkout) {
        acc.workouts.push({
          type: "workout_session",
          start: currentWorkout.start,
          end: currentWorkout.end,
          source: sourceId,
          aggregates: currentWorkout.aggregates as never,
          ...(currentWorkout.segments.length > 0 ? { segments: currentWorkout.segments as never } : {}),
        });
        currentWorkout = null;
      }
    });

    function handleRecord(attrs: Record<string, string>): void {
      const rawType = attrs.type ?? "";
      const identifier = rawType
        .replace(/^HKQuantityTypeIdentifier/, "")
        .replace(/^HKCategoryTypeIdentifier/, "")
        .replace(/^HKDataType/, "");

      const startDate = parseAppleDate(attrs.startDate ?? "");
      const endDate = parseAppleDate(attrs.endDate ?? "");

      if (identifier === "SleepAnalysis") {
        if (!startDate || !endDate) {
          countSkip(payload, "sleep records with an unreadable date");
          return;
        }
        acc.sleepFragments.push({ start: startDate, end: endDate, value: attrs.value ?? "" });
        return;
      }

      const point = POINT_MAPPINGS[identifier];
      if (point) {
        if (!startDate) {
          countSkip(payload, "measurements with an unreadable date");
          return;
        }
        const raw = Number(attrs.value);
        if (!Number.isFinite(raw)) {
          countSkip(payload, "measurements with a non-numeric value");
          return;
        }
        const converted = point.convert ? point.convert(raw, attrs.unit ?? "") : raw;
        if (converted === null || !Number.isFinite(converted) || converted <= 0) {
          countSkip(payload, "measurements outside a plausible range");
          return;
        }
        acc.points.push({
          type: point.type,
          value: round(converted),
          unit: POINT_UNITS[point.type],
          recorded_at: startDate,
          source: sourceId,
        } as HardSignalT);

        // An SDNN record may carry the beats it was computed from.
        if (point.type === "hrv_sdnn") {
          currentBeatWindow = { recordedAt: startDate, intervalsMs: [] };
        }
        return;
      }

      const series = SERIES_MAPPINGS[identifier];
      if (series) {
        if (!startDate) {
          countSkip(payload, "series samples with an unreadable date");
          return;
        }
        const raw = Number(attrs.value);
        if (!Number.isFinite(raw)) {
          countSkip(payload, "series samples with a non-numeric value");
          return;
        }
        const value = series.convert ? series.convert(raw, attrs.unit ?? "") : raw;
        const byDay = acc.series.get(series.quantity) ?? new Map<string, Sample[]>();
        const day = localDay(startDate);
        const samples = byDay.get(day) ?? [];
        samples.push({ at: startDate, value: round(value) });
        byDay.set(day, samples);
        acc.series.set(series.quantity, byDay);
        return;
      }

      if (rawType) countSkip(payload, `unmapped HealthKit type: ${identifier || rawType}`);
    }

    stream.pipe(parser as unknown as NodeJS.WritableStream);
  });
}

/** Canonical unit lookup, kept local so the mapping table stays readable. */
const POINT_UNITS: Record<PointMeasurementType, string> = {
  hrv_rmssd: "ms",
  hrv_sdnn: "ms",
  resting_heart_rate: "bpm",
  body_weight: "kg",
  respiratory_rate: "brpm",
  vo2_max: "ml/kg/min",
  hr_recovery: "bpm",
  walking_heart_rate: "bpm",
  oxygen_saturation: "%",
  body_temperature: "°C",
  skin_temperature: "°C",
  wrist_temperature_sleeping: "°C",
  temperature_deviation: "°C",
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Apple writes sleep as many overlapping stage records. Cluster them into nights,
 * then total the stages inside each.
 */
export function buildSleepSessions(fragments: SleepFragment[], sourceId: string): HardSignalT[] {
  if (fragments.length === 0) return [];

  const sorted = [...fragments].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const clusters: SleepFragment[][] = [];
  let current: SleepFragment[] = [sorted[0]!];
  let clusterEnd = Date.parse(sorted[0]!.end);

  for (const fragment of sorted.slice(1)) {
    const startMs = Date.parse(fragment.start);
    if (startMs - clusterEnd > SLEEP_GAP_MS) {
      clusters.push(current);
      current = [fragment];
      clusterEnd = Date.parse(fragment.end);
      continue;
    }
    current.push(fragment);
    clusterEnd = Math.max(clusterEnd, Date.parse(fragment.end));
  }
  clusters.push(current);

  return clusters.flatMap((cluster) => {
    const start = cluster.reduce((a, f) => (Date.parse(f.start) < Date.parse(a) ? f.start : a), cluster[0]!.start);
    const end = cluster.reduce((a, f) => (Date.parse(f.end) > Date.parse(a) ? f.end : a), cluster[0]!.end);
    if (Date.parse(end) <= Date.parse(start)) return [];

    const seconds = (f: SleepFragment) => (Date.parse(f.end) - Date.parse(f.start)) / 1000;
    let inBed = 0;
    let asleep = 0;
    let deep = 0;
    let rem = 0;
    let light = 0;
    let awake = 0;
    let interruptions = 0;

    for (const f of cluster) {
      const s = seconds(f);
      if (f.value === "HKCategoryValueSleepAnalysisInBed") inBed += s;
      else if (f.value === "HKCategoryValueSleepAnalysisAwake") {
        awake += s;
        interruptions++;
      } else if (SLEEP_ASLEEP_VALUES.has(f.value)) {
        asleep += s;
        if (f.value === "HKCategoryValueSleepAnalysisAsleepDeep") deep += s;
        else if (f.value === "HKCategoryValueSleepAnalysisAsleepREM") rem += s;
        else if (f.value === "HKCategoryValueSleepAnalysisAsleepCore") light += s;
      }
    }

    const aggregates: Record<string, number> = {};
    if (asleep > 0) aggregates.duration_s = Math.round(asleep);
    if (inBed > 0) aggregates.time_in_bed_s = Math.round(inBed);
    if (deep > 0) aggregates.deep_s = Math.round(deep);
    if (rem > 0) aggregates.rem_s = Math.round(rem);
    if (light > 0) aggregates.light_s = Math.round(light);
    if (awake > 0) aggregates.awake_s = Math.round(awake);
    if (interruptions > 0) aggregates.interruptions = interruptions;
    if (inBed > 0 && asleep > 0) {
      aggregates.efficiency_pct = Math.min(100, Math.round((asleep / inBed) * 1000) / 10);
    }

    return [
      {
        type: "sleep_session",
        start,
        end,
        source: sourceId,
        aggregates: aggregates as never,
      } as HardSignalT,
    ];
  });
}
