/**
 * Apple Watch ECG recordings, read for their beat timing rather than their diagnosis.
 *
 * Each file in an export's `electrocardiograms/` folder is about 30 seconds of
 * single-lead ECG sampled near 512 Hz. That gives R-peak timing measured
 * electrically, which is the reference standard for heart rate variability — the
 * optical sensor on the same watch underestimates HRV by roughly 8 ms, about 29%
 * error against a chest strap.
 *
 * So an ECG is worth reading as a calibration point: it says how far a wearer's own
 * watch runs from the truth, for that wearer, rather than for the average of a study.
 *
 * What this deliberately does not do is store the waveform or the rhythm
 * classification. The intervals between beats are a performance measurement. The
 * waveform and the words "Atrial Fibrillation" are a clinical finding, and this
 * format is not medical advice. The classification is read and then discarded,
 * because it decides whether the recording is usable at all.
 */
import { detectRPeaks } from "../rpeaks.js";

export interface EcgRecording {
  /** When the recording started, ISO 8601 with offset. */
  recordedAt: string;
  /** Samples per second, as written in the file. Not exactly 512. */
  sampleRateHz: number;
  /** Rhythm classification, used as a quality gate and then dropped. */
  classification: string;
  /** Microvolt samples, one per reading. */
  microvolts: number[];
}

/** Why a recording could not be used, for the skip summary. */
export type EcgProblem =
  | { kind: "unreadable"; detail: string }
  | { kind: "not_sinus"; detail: string }
  | { kind: "too_few_beats"; detail: string };

/**
 * Rhythm classifications where beat-to-beat variability means what we think it does.
 *
 * This is a methodological gate, not a diagnosis. In atrial fibrillation the rhythm
 * is irregularly irregular by definition, so RMSSD computed from it measures the
 * arrhythmia rather than autonomic state, and averaging it into a recovery baseline
 * would be meaningless. Inconclusive and low/high-rate recordings are excluded for
 * the same reason: the beat timing is not trustworthy.
 */
const USABLE_CLASSIFICATIONS = [/sinus\s*rhythm/i];

export function isUsableRhythm(classification: string): boolean {
  return USABLE_CLASSIFICATIONS.some((r) => r.test(classification));
}

/**
 * Split a metadata line into label and value.
 *
 * Values can be quoted because they contain a comma — Apple writes the device as
 * `"Watch4,2"` — so the split has to respect quoting rather than cut on every comma.
 */
function splitMetadata(line: string): { label: string; value: string } | null {
  const comma = line.indexOf(",");
  if (comma < 0) return null;
  const label = line.slice(0, comma).trim();
  let value = line.slice(comma + 1).trim();
  if (value.startsWith('"')) {
    const closing = value.lastIndexOf('"');
    if (closing > 0) value = value.slice(1, closing);
  }
  return { label, value };
}

/**
 * Apple writes the rate as `510.844 hertz` — a decimal, with the unit inside the
 * same field, and not the 512 you would guess.
 */
function parseSampleRate(value: string): number | null {
  const m = /([\d.]+)/.exec(value.replace(/,/g, "."));
  if (!m) return null;
  const hz = Number(m[1]);
  return Number.isFinite(hz) && hz > 0 ? hz : null;
}

/** `2020-02-16 11:56:41 -0600` into ISO 8601 keeping the offset. */
function parseRecordedDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2}):?(\d{2})/.exec(
    value.trim(),
  );
  if (m) {
    const [, y, mo, d, h, mi, s, sign, oh, om] = m;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

/**
 * Read one ECG CSV.
 *
 * The header labels and their order vary between watchOS versions — some files open
 * with `Name` and `Date of Birth`, others start at `Recorded Date` — so labels are
 * matched wherever they appear rather than by position. Blank lines are scattered
 * through the header and are ignored.
 */
export function parseEcgCsv(text: string): EcgRecording | EcgProblem {
  const lines = text.split(/\r?\n/);

  let recordedAt: string | null = null;
  let sampleRateHz: number | null = null;
  let classification = "";
  let firstSampleIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;

    // A bare number means the header is over and the waveform has started.
    if (/^-?[\d.]+$/.test(line)) {
      firstSampleIndex = i;
      break;
    }

    const entry = splitMetadata(line);
    if (!entry) continue;

    const label = entry.label.toLowerCase();
    if (label.includes("recorded date")) recordedAt = parseRecordedDate(entry.value);
    else if (label.includes("sample rate")) sampleRateHz = parseSampleRate(entry.value);
    else if (label.includes("classification")) classification = entry.value;
  }

  if (!recordedAt) {
    return { kind: "unreadable", detail: "no readable 'Recorded Date' in the header" };
  }
  if (!sampleRateHz) {
    return { kind: "unreadable", detail: "no readable 'Sample Rate' in the header" };
  }
  if (firstSampleIndex < 0) {
    return { kind: "unreadable", detail: "header present but no waveform samples" };
  }

  const microvolts: number[] = [];
  for (let i = firstSampleIndex; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const value = Number(line);
    if (Number.isFinite(value)) microvolts.push(value);
  }

  if (microvolts.length < sampleRateHz * 5) {
    return {
      kind: "unreadable",
      detail: `only ${microvolts.length} samples, under 5 seconds of signal`,
    };
  }

  return { recordedAt, sampleRateHz, classification, microvolts };
}

export interface EcgBeats {
  recordedAt: string;
  /** Offset of each detected beat from the start of the recording, milliseconds. */
  offsetsMs: number[];
  /** Interval preceding each beat, milliseconds. First beat has none. */
  intervalsMs: number[];
  /** How far the beats stood above the background; low means noisy timing. */
  quality: number;
}

/**
 * Beat timing from a recording, or the reason there is none.
 *
 * The rhythm gate runs first: a recording that is not sinus rhythm is refused before
 * any interval is computed, so an arrhythmia never reaches a recovery baseline.
 */
export function beatsFromEcg(recording: EcgRecording): EcgBeats | EcgProblem {
  if (!isUsableRhythm(recording.classification)) {
    return {
      kind: "not_sinus",
      detail: `classified "${recording.classification || "unknown"}", where beat-to-beat variation does not describe recovery`,
    };
  }

  const { peaks, quality } = detectRPeaks(recording.microvolts, recording.sampleRateHz);
  if (peaks.length < 12) {
    return { kind: "too_few_beats", detail: `${peaks.length} beats detected` };
  }

  const msPerSample = 1000 / recording.sampleRateHz;
  const offsetsMs = peaks.map((p) => p * msPerSample);
  const intervalsMs: number[] = [];
  for (let i = 1; i < offsetsMs.length; i++) {
    intervalsMs.push(offsetsMs[i]! - offsetsMs[i - 1]!);
  }

  return { recordedAt: recording.recordedAt, offsetsMs, intervalsMs, quality };
}
