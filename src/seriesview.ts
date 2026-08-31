/**
 * `ath series` — reading the sample streams back out.
 *
 * This exists because of D40. Once the document holds only coverage, there is no way
 * to reach the samples without building sidecar paths by hand, and an agent doing
 * that will get them wrong. It also keeps the saving D40 made: a caller asking about
 * last week gets seven rows, not seven files' worth of raw samples.
 *
 * The per-day figures the document used to store are computed here instead, which is
 * why dropping them cost nothing.
 */
import type { AthleticStandardFileT, SeriesRefT } from "./schema.js";
import { readSeriesDay, seriesDayFiles, type Sample } from "./series.js";

export interface DaySummary {
  day: string;
  source: string;
  n: number;
  min: number;
  max: number;
  mean: number;
}

export interface SeriesQuery {
  quantity: string;
  from?: string | undefined;
  to?: string | undefined;
  source?: string | undefined;
}

/** The coverage records matching a query, so a caller knows which sources to read. */
export function matchingRefs(file: AthleticStandardFileT, query: SeriesQuery): SeriesRefT[] {
  return file.hard_signals.filter(
    (s): s is SeriesRefT =>
      s.type === "series_ref" &&
      s.quantity === query.quantity &&
      (query.source === undefined || s.source === query.source),
  );
}

function withinRange(day: string, from?: string, to?: string): boolean {
  if (from !== undefined && day < from) return false;
  if (to !== undefined && day > to) return false;
  return true;
}

/** One row per day, per source: how many samples and their spread. */
export function summarizeDays(
  athleteFilePath: string,
  refs: SeriesRefT[],
  query: SeriesQuery,
): DaySummary[] {
  const rows: DaySummary[] = [];

  for (const ref of refs) {
    for (const { day } of seriesDayFiles(athleteFilePath, ref.quantity, ref.source)) {
      if (!withinRange(day, query.from, query.to)) continue;
      const samples = readSeriesDay(athleteFilePath, ref.quantity, ref.source, day);
      if (!samples || samples.length === 0) continue;

      let min = samples[0]!.value;
      let max = samples[0]!.value;
      let total = 0;
      for (const s of samples) {
        if (s.value < min) min = s.value;
        if (s.value > max) max = s.value;
        total += s.value;
      }
      rows.push({
        day,
        source: ref.source,
        n: samples.length,
        min,
        max,
        mean: Math.round((total / samples.length) * 100) / 100,
      });
    }
  }

  return rows.sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));
}

export interface RawDay {
  day: string;
  source: string;
  samples: Sample[];
}

/** Every sample in range, still grouped by the day and source it came from. */
export function readRawDays(
  athleteFilePath: string,
  refs: SeriesRefT[],
  query: SeriesQuery,
): RawDay[] {
  const days: RawDay[] = [];

  for (const ref of refs) {
    for (const { day } of seriesDayFiles(athleteFilePath, ref.quantity, ref.source)) {
      if (!withinRange(day, query.from, query.to)) continue;
      const samples = readSeriesDay(athleteFilePath, ref.quantity, ref.source, day);
      if (samples && samples.length > 0) days.push({ day, source: ref.source, samples });
    }
  }

  return days.sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));
}

/** Aligned columns, so a person can scan a month of rows and see the shape. */
export function renderDaySummaries(quantity: string, unit: string, rows: DaySummary[]): string {
  if (rows.length === 0) return `no ${quantity} samples in that range`;

  const multipleSources = new Set(rows.map((r) => r.source)).size > 1;
  const lines: string[] = [];
  lines.push(`${quantity} (${unit}) — ${rows.length} day${rows.length === 1 ? "" : "s"}`);
  lines.push("");

  const width = (pick: (r: DaySummary) => string) =>
    Math.max(...rows.map((r) => pick(r).length));
  const nWidth = Math.max(1, width((r) => String(r.n)));
  const sourceWidth = multipleSources ? Math.max(6, width((r) => r.source)) : 0;

  for (const row of rows) {
    const source = multipleSources ? `  ${row.source.padEnd(sourceWidth)}` : "";
    lines.push(
      `  ${row.day}${source}  n=${String(row.n).padStart(nWidth)}  ` +
        `min ${row.min}  max ${row.max}  mean ${row.mean}`,
    );
  }

  const total = rows.reduce((sum, r) => sum + r.n, 0);
  lines.push("");
  lines.push(`  ${total} sample${total === 1 ? "" : "s"} total`);
  return lines.join("\n");
}

/** Raw samples as text: one instant and value per line, headed by the day. */
export function renderRawDays(quantity: string, unit: string, days: RawDay[]): string {
  if (days.length === 0) return `no ${quantity} samples in that range`;

  const lines: string[] = [];
  for (const day of days) {
    lines.push(`${day.day} · ${day.source} · ${quantity} (${unit}) · ${day.samples.length} samples`);
    for (const sample of day.samples) lines.push(`  ${sample.at}  ${sample.value}`);
  }
  return lines.join("\n");
}
