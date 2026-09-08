/**
 * What a number rests on, in one shape every command uses (D47).
 *
 * A mean with no count behind it cannot be argued with. `ath stats` has always
 * printed a count, a window and a spread beside its baselines; nothing else did, so
 * a reader outside `stats` had a number and no idea whether it came from 90 nights
 * or from four. This is that record, made shared and made mandatory.
 *
 * It also names the rule in words. Where a definition can be read two ways — sleep
 * against time in bed, SDNN against RMSSD, one source against several — the output
 * says which reading it used rather than leaving the reader to assume.
 */

/** The days between two calendar dates, inclusive of both ends. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export interface Coverage {
  /** Observations the number rests on. */
  n: number;
  /** First day covered. */
  from: string;
  /** Last day covered. */
  to: string;
  /** Days with at least one observation. */
  days_present: number;
  /** Days in the window, so a reader can see what is missing. */
  days_expected: number;
  /**
   * Which source the observations came from. Always one, never several: readings
   * from different devices are not pooled (D31), so a coverage record covering two
   * would be describing a number this tool does not produce.
   */
  source: string;
  /** How the number was calculated, in words. */
  rule: string;
}

/** Coverage for a set of timestamped observations from one source. */
export function coverageOf(
  observations: { at: string }[],
  source: string,
  rule: string,
): Coverage | null {
  if (observations.length === 0) return null;
  // Ends of the window are found by instant, not by comparing the day strings. A
  // timestamp carrying an offset can name an earlier local day than one written in
  // UTC that happened before it, so string order and time order disagree.
  const at = (o: { at: string }) => Date.parse(o.at);
  const earliest = observations.reduce((a, b) => (at(a) <= at(b) ? a : b));
  const latest = observations.reduce((a, b) => (at(a) >= at(b) ? a : b));
  const from = earliest.at.slice(0, 10);
  const to = latest.at.slice(0, 10);
  return {
    n: observations.length,
    from,
    to,
    days_present: new Set(observations.map((o) => o.at.slice(0, 10))).size,
    days_expected: daysBetween(from, to),
    source,
    rule,
  };
}

/**
 * Coverage on one line, for output a person reads.
 *
 * The gap is stated as days present out of days in the window rather than as a
 * percentage, because a reader deciding whether to trust a number wants to know how
 * many days are missing, not what fraction they are.
 */
export function renderCoverage(c: Coverage): string {
  const window = c.from === c.to ? c.from : `${c.from} → ${c.to}`;
  const gap = c.days_present === c.days_expected ? "" : `, ${c.days_present}/${c.days_expected} days`;
  return `n=${c.n}, ${window}${gap}, ${c.source} — ${c.rule}`;
}

/**
 * The rules the tools apply, written once so the same words appear everywhere.
 *
 * These are the definitions a reader could otherwise get wrong: `SleepSession`
 * carries both actual sleep and time in bed, SDNN and RMSSD are different statistics
 * that must never share a baseline (D22), and no average crosses a source (D31).
 */
export const RULES = {
  perSource: "one source only, never pooled across devices",
  sleepDuration: "actual sleep, excluding time awake — not time in bed",
  timeInBed: "time in bed, including time awake",
  baseline: (type: string, windowDays: number) =>
    `mean of ${type} over the trailing ${windowDays} days, from this source alone`,
  dailySummary: (quantity: string) => `every ${quantity} sample recorded that day, from one source`,
} as const;
