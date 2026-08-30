/**
 * Finding heartbeats in an ECG waveform.
 *
 * This follows Pan and Tompkins (1985), the standard approach: band-pass the signal
 * to the frequency band where the QRS complex lives, differentiate to pick up its
 * steep slope, square to make large slopes dominate, integrate over a window about
 * as wide as a QRS complex, then take peaks above an adaptive threshold with a
 * refractory period after each one.
 *
 * Each step exists for a reason worth stating, because the naive version of this
 * (threshold the raw signal) fails on real recordings:
 *
 * - **Band-pass 5–15 Hz.** Removes baseline wander from breathing and movement below
 *   it, and muscle noise and mains interference above it. The T wave also sits mostly
 *   below this band, which matters because a tall T wave is the classic false beat.
 * - **Derivative then square.** The QRS complex is distinguished from other features
 *   less by height than by steepness. Squaring makes steep things dominate and also
 *   removes the sign, so an inverted lead still works.
 * - **Moving-window integration over 150 ms**, roughly the widest a QRS complex gets.
 *   This turns the multiple spikes a derivative produces within one beat into a single
 *   smooth bump.
 * - **200 ms refractory period.** The heart physically cannot depolarize again that
 *   soon, so a second detection inside 200 ms is an artifact of the same beat.
 *
 * One deliberate addition: peaks are located on the band-passed signal rather than the
 * integrated one. Integration smears the peak in time, and since the whole point here
 * is interval timing precise enough for RMSSD, a smeared peak would add jitter to
 * every interval.
 */

/** The QRS complex lives here; below is drift, above is noise. */
const BANDPASS_LOW_HZ = 5;
const BANDPASS_HIGH_HZ = 15;
/** About the widest a QRS complex gets. */
const INTEGRATION_WINDOW_S = 0.15;
/** The heart cannot beat again this soon, so a closer detection is the same beat. */
const REFRACTORY_S = 0.2;
/** How far either side of an integrated bump to look for the true peak. */
const PEAK_SEARCH_S = 0.1;

/** Centred moving average. Used as the building block for both filter halves. */
function movingAverage(signal: number[], windowSamples: number): number[] {
  const width = Math.max(1, Math.round(windowSamples));
  if (width <= 1) return [...signal];

  const out = new Array<number>(signal.length);
  const half = Math.floor(width / 2);
  let sum = 0;
  let count = 0;

  // Prime the window over the first half.
  for (let i = 0; i < Math.min(half, signal.length); i++) {
    sum += signal[i]!;
    count++;
  }
  for (let i = 0; i < signal.length; i++) {
    const entering = i + half;
    if (entering < signal.length) {
      sum += signal[entering]!;
      count++;
    }
    const leaving = i - half - 1;
    if (leaving >= 0) {
      sum -= signal[leaving]!;
      count--;
    }
    out[i] = count > 0 ? sum / count : 0;
  }
  return out;
}

/**
 * Band-pass by subtracting a slow moving average (removing drift) and then smoothing
 * (removing high-frequency noise). Cheap, stable, and adequate for a clean
 * single-lead recording — no filter coefficients to get wrong at an unusual rate.
 */
function bandpass(signal: number[], sampleRateHz: number): number[] {
  const lowCutWindow = sampleRateHz / BANDPASS_LOW_HZ;
  const highCutWindow = sampleRateHz / BANDPASS_HIGH_HZ;

  const drift = movingAverage(signal, lowCutWindow);
  const highPassed = signal.map((v, i) => v - drift[i]!);
  return movingAverage(highPassed, highCutWindow);
}

/** Five-point derivative, as Pan and Tompkins specify. */
function derivative(signal: number[]): number[] {
  const out = new Array<number>(signal.length).fill(0);
  for (let i = 2; i < signal.length - 2; i++) {
    out[i] =
      (2 * signal[i + 2]! + signal[i + 1]! - signal[i - 1]! - 2 * signal[i - 2]!) / 8;
  }
  return out;
}

/** Value at a percentile of the sorted data, interpolating between neighbours. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export interface RPeakResult {
  /** Sample indices of detected R peaks. */
  peaks: number[];
  /**
   * How far the beats stand above the background, as a ratio.
   *
   * Worth carrying because noise does not stop detection, it degrades timing: on a
   * synthetic recording with every beat found, added noise inflated RMSSD from 25 ms
   * to 33 ms purely through jitter in where each peak landed. A reader given this
   * figure can discount a poor recording; without it, a noisy reading looks identical
   * to a clean one.
   */
  quality: number;
}

/**
 * Detect R peaks, with a quality figure for the recording.
 *
 * Returns no peaks rather than guessing when the signal carries no clear rhythm. A
 * wrong beat list would produce a confident, wrong HRV number.
 */
export function detectRPeaks(microvolts: number[], sampleRateHz: number): RPeakResult {
  const empty: RPeakResult = { peaks: [], quality: 0 };
  if (microvolts.length < sampleRateHz * 2) return empty;

  const filtered = bandpass(microvolts, sampleRateHz);
  const squared = derivative(filtered).map((v) => v * v);
  const integrated = movingAverage(squared, sampleRateHz * INTEGRATION_WINDOW_S);

  // Threshold from percentiles, never from the maximum.
  //
  // Using the largest value here was a real bug found on real recordings: one motion
  // artifact — a finger slipping off the crown — is many times the height of a QRS
  // complex, so a threshold set as a fraction of the maximum sat above every genuine
  // beat and a 30-second recording yielded 2 beats instead of 35.
  //
  // A high percentile is unmoved by a handful of artifacts. QRS complexes occupy
  // roughly a sixth of the recording after integration, so the 95th percentile lands
  // inside a real beat while the median sits in the quiet between them.
  const positive = integrated.filter((v) => v > 0);
  if (positive.length === 0) return empty;
  const sorted = [...positive].sort((a, b) => a - b);
  const noiseLevel = percentile(sorted, 0.5);
  const signalLevel = percentile(sorted, 0.95);
  if (signalLevel <= 0) return empty;
  const threshold = noiseLevel + 0.25 * (signalLevel - noiseLevel);

  // The integrator squares its input, so amplitudes here are on a squared scale.
  const quality = noiseLevel > 0 ? Math.sqrt(signalLevel / noiseLevel) : 0;

  const refractorySamples = Math.round(sampleRateHz * REFRACTORY_S);
  const searchSamples = Math.max(1, Math.round(sampleRateHz * PEAK_SEARCH_S));

  const peaks: number[] = [];
  let i = 1;
  while (i < integrated.length - 1) {
    if (integrated[i]! <= threshold) {
      i++;
      continue;
    }

    // Walk to the top of this bump.
    let bumpEnd = i;
    while (bumpEnd < integrated.length && integrated[bumpEnd]! > threshold) bumpEnd++;

    // Locate the beat on the band-passed signal, where the peak is not smeared by
    // integration. Timing precision here is what makes the intervals worth having.
    const from = Math.max(0, i - searchSamples);
    const to = Math.min(filtered.length - 1, bumpEnd + searchSamples);
    let best = from;
    let bestMagnitude = Math.abs(filtered[from]!);
    for (let j = from + 1; j <= to; j++) {
      const magnitude = Math.abs(filtered[j]!);
      if (magnitude > bestMagnitude) {
        bestMagnitude = magnitude;
        best = j;
      }
    }

    const previous = peaks[peaks.length - 1];
    if (previous === undefined || best - previous >= refractorySamples) {
      peaks.push(best);
    } else if (bestMagnitude > Math.abs(filtered[previous]!)) {
      // Same beat found twice: keep whichever is the stronger candidate.
      peaks[peaks.length - 1] = best;
    }

    i = bumpEnd + 1;
  }

  return { peaks, quality: Math.round(quality * 10) / 10 };
}
