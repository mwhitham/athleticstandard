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
import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Readable } from "node:stream";
import sax from "sax";
import {
  POINT_MEASUREMENT_UNITS,
  type DeviceT,
  type HardSignalT,
  type PointMeasurementType,
  type SeriesQuantity,
} from "../schema.js";
import { buildSeries, type Sample } from "../series.js";
import { silentProgress, type Progress } from "../progress.js";
import { rmssdFromBeats, rmssdFromIntervals, type Beat } from "../hrv.js";
import {
  countSkip,
  countSkipWithExample,
  emptyPayload,
  writerSlug,
  type ImportPayload,
  type SourceBook,
} from "./merge.js";
import { beatsFromEcg, parseEcgCsv } from "./ecg.js";
import { parseGpx, summarizeRoute, type RouteSummary } from "./routes.js";
import { isEcgEntry, isRouteEntry, readEntries, type DetectedExport } from "./detect.js";
import { openZipEntryStream, zipEntryNames, openZip } from "./zip.js";
import {
  passthrough,
  perMinute,
  toCelsius,
  toCentimeters,
  toCount,
  toKilocalories,
  toKilograms,
  toMets,
  toMetres,
  toMetresPerSecond,
  toMillimetresMercury,
  toMilliseconds,
  toMinutes,
  toPercent,
  toWatts,
  type Converter,
} from "./units.js";

/** HealthKit identifier suffix to point type, with the conversion each needs. */
interface PointMapping {
  type: PointMeasurementType;
  convert: Converter;
}

const POINT_MAPPINGS: Record<string, PointMapping> = {
  RestingHeartRate: { type: "resting_heart_rate", convert: perMinute },
  WalkingHeartRateAverage: { type: "walking_heart_rate", convert: perMinute },
  HeartRateRecoveryOneMinute: { type: "hr_recovery", convert: perMinute },
  BodyMass: { type: "body_weight", convert: toKilograms },
  LeanBodyMass: { type: "lean_body_mass", convert: toKilograms },
  BodyFatPercentage: { type: "body_fat_percentage", convert: toPercent },
  Height: { type: "height", convert: toCentimeters },
  VO2Max: { type: "vo2_max", convert: passthrough },
  AppleSleepingWristTemperature: { type: "wrist_temperature_sleeping", convert: toCelsius },
  BodyTemperature: { type: "body_temperature", convert: toCelsius },
  BloodPressureSystolic: { type: "blood_pressure_systolic", convert: toMillimetresMercury },
  BloodPressureDiastolic: { type: "blood_pressure_diastolic", convert: toMillimetresMercury },
};

const SERIES_MAPPINGS: Record<string, SeriesMapping> = {
  HeartRate: { quantity: "heart_rate", convert: perMinute },

  // Apple samples these three repeatedly rather than reporting one figure per night,
  // so here they are streams and belong in sidecars (D43). WHOOP and Oura report one
  // figure per night for the same measurements, and those stay point measurements.
  HeartRateVariabilitySDNN: { quantity: "hrv_sdnn", convert: toMilliseconds },
  RespiratoryRate: { quantity: "respiratory_rate", convert: perMinute },
  OxygenSaturation: { quantity: "oxygen_saturation", convert: toPercent },

  StepCount: { quantity: "steps", convert: toCount },
  ActiveEnergyBurned: { quantity: "active_energy", convert: toKilocalories },
  BasalEnergyBurned: { quantity: "basal_energy", convert: toKilocalories },
  DistanceWalkingRunning: { quantity: "distance_walking_running", convert: toMetres },
  DistanceCycling: { quantity: "distance_cycling", convert: toMetres },
  DistanceSwimming: { quantity: "distance_swimming", convert: toMetres },

  RunningSpeed: { quantity: "running_speed", convert: toMetresPerSecond },
  RunningPower: { quantity: "running_power", convert: toWatts },
  RunningStrideLength: { quantity: "running_stride_length", convert: toMetres },
  RunningVerticalOscillation: { quantity: "running_vertical_oscillation", convert: toCentimeters },
  RunningGroundContactTime: { quantity: "running_ground_contact_time", convert: toMilliseconds },

  PhysicalEffort: { quantity: "physical_effort", convert: toMets },
  AppleExerciseTime: { quantity: "exercise_time", convert: toMinutes },
  FlightsClimbed: { quantity: "flights_climbed", convert: toCount },

  WalkingSpeed: { quantity: "walking_speed", convert: toMetresPerSecond },
  WalkingStepLength: { quantity: "walking_step_length", convert: toMetres },
  WalkingAsymmetryPercentage: { quantity: "walking_asymmetry_percentage", convert: toPercent },

  TimeInDaylight: { quantity: "time_in_daylight", convert: toMinutes },
};

interface SeriesMapping {
  quantity: SeriesQuantity;
  convert: Converter;
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
  source: string;
}

interface BeatWindow {
  recordedAt: string;
  endsAt: string | null;
  beats: Beat[];
  source: string;
}

/** Fields Apple writes inside a `device` attribute, in the order they appear. */
const DEVICE_FIELDS = [
  "name",
  "manufacturer",
  "model",
  "hardware",
  "software",
  "firmware",
  "localIdentifier",
  "UDI",
] as const;

/**
 * Read the stable parts of Apple's device string.
 *
 * `<<HKDevice: 0x2809b6800>, name:Apple Watch, manufacturer:Apple Inc., model:Watch,
 * hardware:Watch6,2, software:10.2>`. The address is different every time the phone
 * runs and the software changes every update, so neither is kept. Values can hold a
 * comma — `Watch6,2` — so the string is cut at the field names, not at commas.
 */
export function parseAppleDevice(raw: string | undefined): DeviceT | undefined {
  if (!raw) return undefined;
  const body = raw.replace(/^<<HKDevice:[^>]*>,?\s*/, "").replace(/>\s*$/, "");

  const fieldAt = new RegExp(`(?:^|,\\s*)(${DEVICE_FIELDS.join("|")}):`, "g");
  const hits: { key: string; valueStart: number; matchStart: number }[] = [];
  for (const m of body.matchAll(fieldAt)) {
    hits.push({ key: m[1]!, valueStart: m.index! + m[0].length, matchStart: m.index! });
  }
  if (hits.length === 0) return undefined;

  const fields: Record<string, string> = {};
  hits.forEach((hit, i) => {
    const end = i + 1 < hits.length ? hits[i + 1]!.matchStart : body.length;
    const value = body.slice(hit.valueStart, end).trim();
    if (value) fields[hit.key] = value;
  });

  const device: DeviceT = {
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.manufacturer ? { manufacturer: fields.manufacturer } : {}),
    ...(fields.model ? { model: fields.model } : {}),
    ...(fields.hardware ? { hardware: fields.hardware } : {}),
  };
  return Object.keys(device).length > 0 ? device : undefined;
}

/** Writers that are the Health app itself: the person typed the number in. */
const HAND_ENTERED_WRITERS = new Set(["health", "manual"]);

/**
 * Vendor slug for a writer. The manufacturer settles it when the device names one;
 * otherwise Apple's own devices are recognised by name and anything else is taken
 * from the first word of the writer.
 */
export function vendorOf(writer: string, device?: DeviceT): string {
  if (device?.manufacturer) return writerSlug(device.manufacturer).split("-")[0] ?? "unknown";
  const slug = writerSlug(writer);
  if (/^(iphone|ipad|apple)(-|$)/.test(slug)) return "apple";
  return slug.split("-")[0] ?? "unknown";
}

/**
 * Source ids for the writers met while parsing, resolved once per distinct
 * (name, device) pair. An export holds a million records from a dozen writers, so the
 * lookup has to be a map hit, not a search.
 */
class WriterCache {
  private readonly ids = new Map<string, string>();
  private readonly devices = new Map<string, DeviceT | undefined>();

  constructor(private readonly sources: SourceBook) {}

  resolve(attrs: Record<string, string>): string {
    const writer = (attrs.sourceName ?? "").trim() || "Unknown";
    const rawDevice = attrs.device ?? "";
    const key = `${writer}\u0000${rawDevice}`;
    const hit = this.ids.get(key);
    if (hit) return hit;

    let id: string;
    if (HAND_ENTERED_WRITERS.has(writer.toLowerCase())) {
      id = this.sources.manual();
    } else {
      let device = this.devices.get(rawDevice);
      if (!this.devices.has(rawDevice)) {
        device = parseAppleDevice(rawDevice);
        this.devices.set(rawDevice, device);
      }
      id = this.sources.forWriter({
        writer,
        vendor: vendorOf(writer, device),
        ...(device ? { device } : {}),
      });
    }
    this.ids.set(key, id);
    return id;
  }
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** How far outside its stated window a beat may fall and still be believed. */
const BEAT_WINDOW_TOLERANCE_MS = 5 * 60 * 1000;

/** A window this long cannot be resolved from a minute and a second alone. */
const LONGEST_PLACEABLE_WINDOW_MS = 55 * 60 * 1000;

/** Time of day of an offset timestamp, in milliseconds since local midnight. */
function clockMs(timestamp: string): number | null {
  const m = /T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/.exec(timestamp);
  if (!m) return null;
  const [, h, mi, s, frac = "0"] = m;
  return (Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000 + Number(frac.padEnd(3, "0"));
}

/**
 * Where a beat falls inside its record's window, in milliseconds from the start.
 *
 * Beat entries carry a time of day with no date, and two things about that clock are
 * unreliable. Apple writes it in the settings of the phone the export came from, so
 * one watch produces `13:40:45.22`, `1:40:45.22 PM`, `13:40:45,22`, or
 * `오후 1:40:45.22`. And the hour can disagree with the hour in the record's own
 * start time by a whole number of hours, because the two are rendered against
 * different UTC offsets: a record starting `2020-11-15T23:33:17-05:00` carries a
 * first beat at `10:33:19.09 PM`.
 *
 * So the hour is not read at all. Only the minute and the second are, and the record
 * decides the rest: a window about a minute long has one position per hour that fits,
 * and a whole-hour disagreement cannot move a beat out of the minute it belongs to. A
 * window crossing midnight wraps.
 *
 * A zone difference that is not a whole hour (India, Nepal, Newfoundland) shifts the
 * minute too, and those beats are counted as unplaceable rather than guessed at.
 */
export function beatOffsetMs(
  recordedAt: string,
  endsAt: string | null,
  timeOfDay: string,
): number | null {
  const m = /\d{1,2}:(\d{2}):(\d{2})(?:[.,](\d{1,3}))?/.exec(timeOfDay);
  if (!m) return null;
  const [, mi, s, frac = "0"] = m;
  const beatWithinHour = Number(mi) * 60_000 + Number(s) * 1000 + Number(frac.padEnd(3, "0"));

  const startMs = clockMs(recordedAt);
  if (startMs === null) return null;
  const endMs = endsAt === null ? null : clockMs(endsAt);
  const durationMs = endMs === null ? 0 : (endMs - startMs + DAY_MS) % DAY_MS;
  if (durationMs > LONGEST_PLACEABLE_WINDOW_MS) return null;

  const base = beatWithinHour - (startMs % HOUR_MS);

  let best: number | null = null;
  for (const offset of [base, base + HOUR_MS, base - HOUR_MS]) {
    if (offset < -BEAT_WINDOW_TOLERANCE_MS) continue;
    if (offset > durationMs + BEAT_WINDOW_TOLERANCE_MS) continue;
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}

/** One writer's samples for one quantity, bucketed by day. */
interface SeriesBucket {
  quantity: SeriesQuantity;
  source: string;
  byDay: Map<string, Sample[]>;
}

interface AppleAccumulator {
  points: HardSignalT[];
  sleepFragments: SleepFragment[];
  workouts: HardSignalT[];
  /** `${quantity}|${source}` -> bucket. Two writers of one quantity never share a file. */
  series: Map<string, SeriesBucket>;
  beatWindows: BeatWindow[];
}

/** Locate export.xml inside whatever the user handed us, with its size for the bar. */
async function openAppleXml(detected: DetectedExport): Promise<{ stream: Readable; size: number }> {
  if (detected.container === "file") {
    return { stream: createReadStream(detected.path), size: statSync(detected.path).size };
  }

  if (detected.container === "directory") {
    const candidates = [
      join(detected.path, "export.xml"),
      join(detected.path, "apple_health_export", "export.xml"),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error(`no export.xml under ${detected.path}`);
    return { stream: createReadStream(found), size: statSync(found).size };
  }

  const zip = await openZip(detected.path);
  const entry = zipEntryNames(zip).find((n) => n.toLowerCase().endsWith("export.xml"));
  if (!entry) throw new Error(`no export.xml inside ${detected.path}`);
  return openZipEntryStream(detected.path, entry);
}

export async function importAppleHealth(
  detected: DetectedExport,
  sources: SourceBook,
  progress: Progress = silentProgress,
): Promise<ImportPayload> {
  const payload = emptyPayload("apple", `Apple Health export (${detected.container})`);
  const acc: AppleAccumulator = {
    points: [],
    sleepFragments: [],
    workouts: [],
    series: new Map(),
    beatWindows: [],
  };

  const { stream, size } = await openAppleXml(detected);
  progress.start("reading export.xml", size, "bytes");
  let bytes = 0;
  stream.on("data", (chunk: Buffer | string) => {
    bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    progress.update(bytes);
  });
  await parseAppleXml(stream, acc, payload, new WriterCache(sources));
  progress.finish();

  payload.hardSignals.push(...acc.points);
  await attachRouteSplits(detected, acc.workouts, payload, progress);
  payload.hardSignals.push(...acc.workouts);
  payload.hardSignals.push(...buildSleepSessions(acc.sleepFragments));

  await importEcgs(detected, sources, payload, progress);

  // Beat windows become a per-day hrv_beats series plus one derived RMSSD each, under
  // the source of the record that carried them.
  const beatsByDay = new Map<string, { source: string; day: string; samples: Sample[] }>();
  for (const window of acc.beatWindows) {
    const day = localDay(window.recordedAt);
    const key = `${window.source}|${day}`;
    const bucket = beatsByDay.get(key) ?? { source: window.source, day, samples: [] };
    // Each beat is placed where the export says it fell, not where accumulating
    // intervals would put it, so a missed beat stays visible as a gap.
    const windowStartMs = Date.parse(window.recordedAt);
    for (const beat of window.beats) {
      bucket.samples.push({
        at: atOffsetOf(window.recordedAt, windowStartMs + beat.offsetMs),
        value: Math.round(beat.intervalMs * 10) / 10,
      });
    }
    beatsByDay.set(key, bucket);

    const rmssd = rmssdFromBeats(window.beats);
    if (!rmssd) {
      countSkip(payload, "HRV beat windows too short or sparse for RMSSD");
      continue;
    }
    payload.hardSignals.push({
      type: "hrv_rmssd",
      value: rmssd.rmssd_ms,
      unit: "ms",
      recorded_at: window.recordedAt,
      source: window.source,
      derived: {
        from: "hrv_beats",
        method: "rmssd",
        window_s: rmssd.window_s,
        n_beats: rmssd.n_beats,
        ...(rmssd.n_dropped > 0 ? { n_dropped: rmssd.n_dropped } : {}),
      },
    });
  }
  for (const { source, day, samples } of beatsByDay.values()) {
    const built = buildSeries("hrv_beats", source, day, samples);
    if (built) payload.series.push(built);
  }

  for (const bucket of acc.series.values()) {
    for (const [day, samples] of bucket.byDay) {
      const built = buildSeries(bucket.quantity, bucket.source, day, samples);
      if (built) payload.series.push(built);
    }
  }

  return payload;
}

function parseAppleXml(
  stream: Readable,
  acc: AppleAccumulator,
  payload: ImportPayload,
  writers: WriterCache,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true, lowercase: false });

    // Record-level state: a Record element may carry a nested beat list, and a
    // Workout may carry laps, so both need somewhere to collect children.
    let currentBeatWindow: BeatWindow | null = null;
    let currentWorkout: {
      start: string;
      end: string;
      source: string;
      segments: { label: string; duration_s?: number }[];
      aggregates: Record<string, unknown>;
    } | null = null;

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
          if (!Number.isFinite(bpm) || bpm <= 0) {
            countSkipWithExample(
              payload,
              "heartbeat readings with an unusable rate",
              `bpm "${attrs.bpm ?? "(none)"}"`,
            );
            break;
          }
          const offsetMs = beatOffsetMs(
            currentBeatWindow.recordedAt,
            currentBeatWindow.endsAt,
            attrs.time ?? "",
          );
          if (offsetMs === null) {
            // Counted, because a beat dropped in silence is how a locale mismatch
            // removed every RMSSD an Apple Watch could have contributed while the
            // import reported nothing at all.
            countSkipWithExample(
              payload,
              "heartbeat readings we could not place in their reading's window",
              `time "${attrs.time ?? "(none)"}" in a window starting ${currentBeatWindow.recordedAt}`,
            );
            break;
          }
          // The rate a beat reports is the interval that produced it: 70 bpm is a
          // gap of 60000/70 ms.
          currentBeatWindow.beats.push({ offsetMs, intervalMs: 60000 / bpm });
          break;
        }

        case "Workout": {
          const start = parseAppleDate(attrs.startDate ?? "");
          const end = parseAppleDate(attrs.endDate ?? "");
          if (!start || !end || Date.parse(end) <= Date.parse(start)) {
            // Apple writes the occasional zero-length workout. A session that
            // began and ended at the same instant did not happen.
            countSkipWithExample(
              payload,
              "workouts with an unusable time range",
              `${(attrs.workoutActivityType ?? "unknown").replace(/^HKWorkoutActivityType/, "")} from "${attrs.startDate ?? "(none)"}" to "${attrs.endDate ?? "(none)"}"`,
            );
            break;
          }
          const aggregates: Record<string, unknown> = {};
          const activity = (attrs.workoutActivityType ?? "").replace(/^HKWorkoutActivityType/, "");
          if (activity) aggregates.activity = activity.toLowerCase();
          const distance = Number(attrs.totalDistance);
          if (Number.isFinite(distance) && distance > 0) {
            aggregates.distance_m = round(
              toMetres(distance, attrs.totalDistanceUnit ?? "m") ?? distance,
            );
          }
          const energy = Number(attrs.totalEnergyBurned);
          if (Number.isFinite(energy) && energy > 0) aggregates.energy_kcal = round(energy);
          currentWorkout = { start, end, source: writers.resolve(attrs), segments: [], aggregates };
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
        if (currentBeatWindow.beats.length > 0) acc.beatWindows.push(currentBeatWindow);
        currentBeatWindow = null;
      }
      if (name === "Workout" && currentWorkout) {
        acc.workouts.push({
          type: "workout_session",
          start: currentWorkout.start,
          end: currentWorkout.end,
          source: currentWorkout.source,
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
        acc.sleepFragments.push({
          start: startDate,
          end: endDate,
          value: attrs.value ?? "",
          source: writers.resolve(attrs),
        });
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
        const converted = point.convert(raw, attrs.unit ?? "");
        if (converted === null) {
          countSkipWithExample(
            payload,
            `measurements in a unit we do not recognize`,
            `${identifier} in "${attrs.unit ?? "(none)"}"`,
          );
          return;
        }
        if (!Number.isFinite(converted) || converted <= 0) {
          countSkip(payload, "measurements outside a plausible range");
          return;
        }
        acc.points.push({
          type: point.type,
          value: round(converted),
          unit: POINT_MEASUREMENT_UNITS[point.type],
          recorded_at: startDate,
          source: writers.resolve(attrs),
        } as HardSignalT);
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
        const value = series.convert(raw, attrs.unit ?? "");
        if (value === null) {
          countSkipWithExample(
            payload,
            `series samples in a unit we do not recognize`,
            `${identifier} in "${attrs.unit ?? "(none)"}"`,
          );
          return;
        }
        const source = writers.resolve(attrs);
        const key = `${series.quantity}|${source}`;
        const bucket =
          acc.series.get(key) ?? { quantity: series.quantity, source, byDay: new Map<string, Sample[]>() };
        const day = localDay(startDate);
        const samples = bucket.byDay.get(day) ?? [];

        // A sample that covers a span keeps its length: "420 steps from 9:00 to 9:05"
        // is a rate only if the five minutes survive. An instant reading has none.
        const durationMs = endDate ? Date.parse(endDate) - Date.parse(startDate) : 0;
        samples.push({
          at: startDate,
          value: roundSample(value),
          ...(durationMs > 0 ? { durationMs } : {}),
        });
        bucket.byDay.set(day, samples);
        acc.series.set(key, bucket);

        // An SDNN record may carry the beats it was computed from. Its end time comes
        // along because the window is what places each beat's clock.
        if (series.quantity === "hrv_sdnn") {
          currentBeatWindow = { recordedAt: startDate, endsAt: endDate, beats: [], source };
        }
        return;
      }

      if (rawType) countSkip(payload, `unmapped HealthKit type: ${identifier || rawType}`);
    }

    stream.pipe(parser as unknown as NodeJS.WritableStream);
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Series samples keep three decimals, which is what Apple writes. A calorie sample
 * every three seconds is about 0.5 kcal, and rounding each to two places drifted a
 * run's total by half a kilocalorie over 891 samples. Rounding exists only to remove
 * float noise from unit conversion, so it stops one place past the source's precision.
 */
function roundSample(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Give each workout the splits from its GPS route, where one exists.
 *
 * Routes are matched to workouts by overlapping time rather than by the date in the
 * filename, since filenames are rounded to the minute and a wearer can start two
 * activities close together.
 *
 * A workout that already has laps from the watch keeps them: the wearer pressed the
 * button deliberately, and that division means more to them than an even kilometre.
 */
async function attachRouteSplits(
  detected: DetectedExport,
  workouts: HardSignalT[],
  payload: ImportPayload,
  progress: Progress,
): Promise<void> {
  const files = await readEntries(detected, isRouteEntry, (done, total) => {
    if (done === 1) progress.start("reading workout routes", total);
    progress.update(done);
  });
  progress.finish();
  if (files.size === 0) return;

  const summaries: RouteSummary[] = [];
  for (const [name, text] of files) {
    const summary = summarizeRoute(parseGpx(text));
    if (!summary) {
      countSkipWithExample(payload, "workout routes with too few track points", name);
      continue;
    }
    summaries.push(summary);
  }

  let matched = 0;
  for (const workout of workouts) {
    if (workout.type !== "workout_session") continue;
    const workoutStart = Date.parse(workout.start);
    const workoutEnd = Date.parse(workout.end);

    const route = summaries.find((r) => {
      const routeStart = Date.parse(r.start);
      const routeEnd = Date.parse(r.end);
      return routeStart < workoutEnd && routeEnd > workoutStart;
    });
    if (!route) continue;

    matched++;
    if (route.elevationGainM > 0) {
      (workout.aggregates as Record<string, number>).elevation_gain_m = route.elevationGainM;
    }
    if (!workout.segments || workout.segments.length === 0) {
      if (route.splits.length > 0) workout.segments = route.splits;
    }
  }

  const unmatched = summaries.length - matched;
  if (unmatched > 0) {
    countSkip(payload, "workout routes with no workout in the same window", unmatched);
  }
}

/**
 * Read the ECG recordings and derive an RMSSD from each.
 *
 * These land under their own source, not the one the rest of the export uses. The
 * watch measures beats optically all day and electrically only during an ECG, and the
 * electrical figure is the reference standard while the optical one carries roughly
 * 29% error. Pooling them would bury exactly the comparison that makes these
 * recordings worth reading (D31, D37).
 */
async function importEcgs(
  detected: DetectedExport,
  sources: SourceBook,
  payload: ImportPayload,
  progress: Progress,
): Promise<void> {
  const files = await readEntries(detected, isEcgEntry, (done, total) => {
    if (done === 1) progress.start("reading ECG recordings", total);
    progress.update(done);
  });
  progress.finish();
  if (files.size === 0) return;

  // Created only once a recording exists, so a wearer who has never taken an ECG
  // gets no empty source.
  const ecgSourceId = sources.forWriter({ writer: "Apple Watch", vendor: "apple", sensor: "ecg" });
  const beatsByDay = new Map<string, Sample[]>();

  for (const [name, text] of files) {
    const parsed = parseEcgCsv(text);
    if ("kind" in parsed) {
      countSkipWithExample(payload, `ECG recordings we could not read`, `${basename(name)}: ${parsed.detail}`);
      continue;
    }

    const beats = beatsFromEcg(parsed);
    if ("kind" in beats) {
      const reason =
        beats.kind === "not_sinus"
          ? "ECG recordings not in sinus rhythm, where variability does not describe recovery"
          : "ECG recordings with too few detectable beats";
      countSkipWithExample(payload, reason, `${basename(name)}: ${beats.detail}`);
      continue;
    }

    const day = localDay(beats.recordedAt);
    const samples = beatsByDay.get(day) ?? [];
    const startMs = Date.parse(beats.recordedAt);
    // The first beat has no preceding interval, so intervals line up from the second.
    for (let i = 1; i < beats.offsetsMs.length; i++) {
      samples.push({
        at: atOffsetOf(beats.recordedAt, startMs + beats.offsetsMs[i]!),
        value: Math.round(beats.intervalsMs[i - 1]! * 10) / 10,
      });
    }
    beatsByDay.set(day, samples);

    const rmssd = rmssdFromIntervals(beats.intervalsMs);
    if (!rmssd) {
      countSkipWithExample(
        payload,
        "ECG recordings with too few usable intervals for RMSSD",
        basename(name),
      );
      continue;
    }

    payload.hardSignals.push({
      type: "hrv_rmssd",
      value: rmssd.rmssd_ms,
      unit: "ms",
      recorded_at: beats.recordedAt,
      source: ecgSourceId,
      derived: {
        from: "ecg_beats",
        method: "rmssd",
        window_s: rmssd.window_s,
        n_beats: rmssd.n_beats,
        ...(rmssd.n_dropped > 0 ? { n_dropped: rmssd.n_dropped } : {}),
        ...(beats.quality > 0 ? { signal_quality: beats.quality } : {}),
      },
    });
  }

  for (const [day, samples] of beatsByDay) {
    const built = buildSeries("ecg_beats", ecgSourceId, day, samples);
    if (built) payload.series.push(built);
  }
}

/**
 * Apple writes sleep as many overlapping stage records. Cluster them into nights,
 * then total the stages inside each.
 *
 * Clustered per writer. A watch and a ring both recording one night are two
 * observations of it, not one, and folding their stages together would produce a
 * night nobody measured (D31, D45).
 */
export function buildSleepSessions(fragments: SleepFragment[]): HardSignalT[] {
  const bySource = new Map<string, SleepFragment[]>();
  for (const f of fragments) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
  return [...bySource].flatMap(([sourceId, own]) => clusterNights(own, sourceId));
}

function clusterNights(fragments: SleepFragment[], sourceId: string): HardSignalT[] {
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
