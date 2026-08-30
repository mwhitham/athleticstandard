import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { beatsFromEcg, isUsableRhythm, parseEcgCsv } from "../src/import/ecg.js";
import { detectRPeaks } from "../src/rpeaks.js";
import { rmssdFromIntervals } from "../src/hrv.js";

const here = dirname(fileURLToPath(import.meta.url));
const ECG_DIR = resolve(here, "fixtures/exports/apple/electrocardiograms");

const sinus = readFileSync(resolve(ECG_DIR, "ecg_2026-08-09.csv"), "utf8");
const afib = readFileSync(resolve(ECG_DIR, "ecg_2026-08-07.csv"), "utf8");

/** Build an ECG waveform with a known rhythm, for testing the detector directly. */
function syntheticEcg(intervalsMs: number[], sampleRateHz: number): number[] {
  const totalMs = intervalsMs.reduce((a, b) => a + b, 0) + 1000;
  const n = Math.round((totalMs / 1000) * sampleRateHz);
  const signal = new Array<number>(n).fill(0);
  let tMs = 500;
  for (const interval of intervalsMs) {
    const centre = Math.round((tMs / 1000) * sampleRateHz);
    const width = Math.round(0.04 * sampleRateHz);
    for (let k = -width; k <= width; k++) {
      const i = centre + k;
      if (i < 0 || i >= n) continue;
      const x = k / (0.02 * sampleRateHz);
      signal[i]! += 1000 * Math.exp(-x * x);
    }
    tMs += interval;
  }
  return signal;
}

describe("parseEcgCsv", () => {
  it("reads the header labels wherever they appear", () => {
    // Apple's header order varies between watchOS versions: some files open with Name
    // and Date of Birth, others start at Recorded Date.
    const parsed = parseEcgCsv(sinus);
    expect("kind" in parsed).toBe(false);
    if ("kind" in parsed) return;
    expect(parsed.recordedAt).toBe("2026-08-09T07:20:11-07:00");
    expect(parsed.classification).toBe("Sinus Rhythm");
  });

  it("reads the real sample rate rather than assuming 512", () => {
    // Apple writes "510.844 hertz": a decimal, with the unit inside the same field.
    const parsed = parseEcgCsv(sinus);
    if ("kind" in parsed) throw new Error("expected a recording");
    expect(parsed.sampleRateHz).toBeCloseTo(510.844, 3);
  });

  it("survives a quoted field containing a comma", () => {
    // The device is written as "Watch7,2", so splitting on every comma would break.
    expect(sinus).toContain('Device,"Watch7,2"');
    expect("kind" in parseEcgCsv(sinus)).toBe(false);
  });

  it("collects the whole waveform", () => {
    const parsed = parseEcgCsv(sinus);
    if ("kind" in parsed) throw new Error("expected a recording");
    // About 30 seconds at ~511 Hz.
    expect(parsed.microvolts.length).toBeGreaterThan(14_000);
  });

  it("refuses a file with no header rather than reading it as a waveform", () => {
    const parsed = parseEcgCsv("1.0\n2.0\n3.0\n");
    expect("kind" in parsed).toBe(true);
    if (!("kind" in parsed)) return;
    expect(parsed.kind).toBe("unreadable");
  });

  it("refuses a recording too short to say anything", () => {
    const header = "Recorded Date,2026-08-09 07:20:11 -0700\nSample Rate,512 hertz\n\n";
    const parsed = parseEcgCsv(header + "1.0\n2.0\n");
    expect("kind" in parsed).toBe(true);
  });
});

describe("isUsableRhythm", () => {
  it("accepts sinus rhythm", () => {
    expect(isUsableRhythm("Sinus Rhythm")).toBe(true);
  });

  it("rejects rhythms where beat variation does not describe recovery", () => {
    // In atrial fibrillation the rhythm is irregular by definition, so RMSSD would
    // measure the arrhythmia rather than autonomic state.
    expect(isUsableRhythm("Atrial Fibrillation")).toBe(false);
    expect(isUsableRhythm("Inconclusive")).toBe(false);
    expect(isUsableRhythm("High Heart Rate")).toBe(false);
    expect(isUsableRhythm("")).toBe(false);
  });
});

describe("beatsFromEcg", () => {
  it("recovers a known RMSSD from the waveform", () => {
    // The fixture alternates 880/920 ms, so every successive difference is 40 ms and
    // the true RMSSD is exactly 40.
    const parsed = parseEcgCsv(sinus);
    if ("kind" in parsed) throw new Error("expected a recording");

    const beats = beatsFromEcg(parsed);
    expect("kind" in beats).toBe(false);
    if ("kind" in beats) return;

    const rmssd = rmssdFromIntervals(beats.intervalsMs);
    expect(rmssd).not.toBeNull();
    expect(rmssd!.rmssd_ms).toBeGreaterThan(36);
    expect(rmssd!.rmssd_ms).toBeLessThan(44);
  });

  it("reports how far the beats stood above the background", () => {
    const parsed = parseEcgCsv(sinus);
    if ("kind" in parsed) throw new Error("expected a recording");
    const beats = beatsFromEcg(parsed);
    if ("kind" in beats) throw new Error("expected beats");
    expect(beats.quality).toBeGreaterThan(1);
  });

  it("refuses an arrhythmia before computing anything", () => {
    const parsed = parseEcgCsv(afib);
    if ("kind" in parsed) throw new Error("expected a recording");
    const beats = beatsFromEcg(parsed);
    expect("kind" in beats).toBe(true);
    if (!("kind" in beats)) return;
    expect(beats.kind).toBe("not_sinus");
    expect(beats.detail).toContain("Atrial Fibrillation");
  });
});

describe("detectRPeaks", () => {
  const RATE = 510.844;

  it("finds every beat in a steady rhythm", () => {
    const intervals = Array.from({ length: 30 }, () => 900);
    const { peaks } = detectRPeaks(syntheticEcg(intervals, RATE), RATE);
    expect(peaks).toHaveLength(30);
  });

  it("does not mistake a T wave for a beat", () => {
    // A tall T wave 200 ms after each R peak is the classic false positive. The
    // band-pass and the refractory period exist to reject it.
    const intervals = Array.from({ length: 30 }, () => 900);
    const signal = syntheticEcg(intervals, RATE);
    let tMs = 500;
    for (const interval of intervals) {
      const centre = Math.round(((tMs + 200) / 1000) * RATE);
      const width = Math.round(0.08 * RATE);
      for (let k = -width; k <= width; k++) {
        const i = centre + k;
        if (i < 0 || i >= signal.length) continue;
        const x = k / (0.05 * RATE);
        signal[i]! += 400 * Math.exp(-x * x);
      }
      tMs += interval;
    }
    const { peaks } = detectRPeaks(signal, RATE);
    expect(peaks).toHaveLength(30);
  });

  it("tracks beat spacing closely enough for interval statistics", () => {
    const intervals = Array.from({ length: 30 }, (_, i) => (i % 2 ? 850 : 950));
    const { peaks } = detectRPeaks(syntheticEcg(intervals, RATE), RATE);
    const msPerSample = 1000 / RATE;
    const detected = peaks.slice(1).map((p, i) => (p - peaks[i]!) * msPerSample);
    const rmssd = rmssdFromIntervals(detected);
    // True RMSSD is 100 ms for a 100 ms alternation. One sample at this rate is
    // 1.96 ms, so that is the floor on how precisely any beat can be placed.
    expect(Math.abs(rmssd!.rmssd_ms - 100)).toBeLessThan(2);
  });

  it("survives baseline drift, which is what the band-pass is for", () => {
    const intervals = Array.from({ length: 30 }, () => 900);
    const signal = syntheticEcg(intervals, RATE);
    for (let i = 0; i < signal.length; i++) {
      signal[i]! += 400 * Math.sin((2 * Math.PI * i) / (RATE * 3));
    }
    const { peaks } = detectRPeaks(signal, RATE);
    expect(peaks).toHaveLength(30);
  });

  it("survives a motion artifact many times the height of a beat", () => {
    // Found on real recordings: a finger slipping off the crown produces one swing
    // far larger than any QRS complex. Setting the threshold as a fraction of the
    // largest value put it above every genuine beat, and a 30-second recording
    // yielded 2 beats instead of 35. The threshold comes from a percentile now.
    const intervals = Array.from({ length: 30 }, () => 900);
    for (const amplitude of [5_000, 50_000, 200_000]) {
      const signal = syntheticEcg(intervals, RATE);
      const centre = Math.round(5 * RATE);
      for (let k = -Math.round(0.05 * RATE); k <= Math.round(0.05 * RATE); k++) {
        const i = centre + k;
        if (i < 0 || i >= signal.length) continue;
        const x = k / (0.01 * RATE);
        signal[i]! += amplitude * Math.exp(-x * x);
      }
      const { peaks } = detectRPeaks(signal, RATE);
      expect(peaks.length, `artifact of ${amplitude} µV`).toBeGreaterThanOrEqual(29);
    }
  });

  it("reports nothing for a signal with no rhythm", () => {
    const flat = new Array<number>(Math.round(RATE * 30)).fill(0);
    expect(detectRPeaks(flat, RATE).peaks).toHaveLength(0);
  });

  it("reports nothing for a recording too short to judge", () => {
    expect(detectRPeaks(new Array<number>(100).fill(0), RATE).peaks).toHaveLength(0);
  });
});
