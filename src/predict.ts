/**
 * `ath predict` — the evidence a prediction rests on, printed and nothing more.
 *
 * The command reads. It never writes, and it never produces a number: turning
 * evidence into a prediction takes a model, and the CLI has none (D7). The agent
 * reads this, reasons, and saves its answer with `ath log`, which is the one command
 * that writes (D55).
 *
 * Four sections, from [v0.1.0 §5](../build-history/v0.1.0/spec.md), plus the gaps
 * named out loud. Summaries are printed beside the rows they came from, so a reader
 * can check one against the other instead of taking the summary on trust.
 */
import type { AthleticStandardFileT, BenchmarkT, SoftSignalT } from "./schema.js";
import { renderCoverage, RULES } from "./coverage.js";
import { describeScore, hoursAndMinutes } from "./score.js";
import {
  RECENT_DAYS,
  type DayRow,
  type Evidence,
  type ResultHistory,
  type ResultRow,
} from "./context.js";

/** Raised when there is nothing to predict against, with the remedy in the message. */
export class PredictRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictRefusal";
  }
}

/**
 * The benchmark being asked about, or a refusal naming the closest ones.
 *
 * An unknown name is usually a near miss — `fran` typed as `frans`, or a workout
 * logged under its date. Listing the closest few is more use than saying no.
 */
export function benchmarkOrRefuse(file: AthleticStandardFileT, id: string): BenchmarkT {
  const exact = file.benchmarks.find((b) => b.id === id);
  if (exact) return exact;

  const wanted = id.toLowerCase();
  const near = file.benchmarks
    .map((b) => ({ b, score: closeness(wanted, b.id.toLowerCase()) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.b.id);

  const withResults = new Set(
    file.hard_signals.filter((s) => s.type === "benchmark_result").map((s) => s.benchmark),
  );
  const suggestions =
    near.length > 0
      ? near
      : file.benchmarks
          .filter((b) => withResults.has(b.id))
          .slice(0, 5)
          .map((b) => b.id);

  throw new PredictRefusal(
    `no benchmark called '${id}'.` +
      (suggestions.length > 0 ? ` Closest: ${suggestions.join(", ")}.` : "") +
      ` See them all with \`ath stats\`, or log the workout with \`ath log\` to create it.`,
  );
}

/** Shared characters at the front, plus a bonus when one name contains the other. */
function closeness(a: string, b: string): number {
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
  const contains = a.includes(b) || b.includes(a) ? 3 : 0;
  return shared + contains;
}

/** The four sections, as markdown a person and an agent both read. */
export function renderEvidence(ev: Evidence): string {
  const out: string[] = [];

  out.push(`# ${ev.benchmark.id} — the evidence for a prediction`);
  out.push("");
  out.push(
    `This is what the file holds. It is not a prediction: turning evidence into a ` +
      `number needs an agent, because this tool has no model. An agent writes its ` +
      `answer back with \`ath log\`.`,
  );
  out.push("");
  out.push(`  benchmark   ${ev.benchmark.id} — ${ev.benchmark.kind}, scored by ${ev.benchmark.score_type}`);
  out.push(`  definition  ${ev.benchmark.definition}`);
  out.push(`  as of       ${ev.asOf} — nothing after this day is shown`);
  out.push(`  window      ${ev.from} → ${ev.asOf} for the day-by-day rows`);

  out.push("");
  out.push(`## What is missing`);
  out.push("");
  if (ev.gaps.length === 0) {
    out.push(`Nothing worth naming: the window is complete and the sources agree.`);
  } else {
    for (const gap of ev.gaps) out.push(`- ${gap}`);
  }

  out.push("");
  out.push(`## 1. ${ev.history.shown < ev.history.total ? "Recent results" : "Every result"} on this benchmark`);
  out.push("");
  out.push(...resultLines(ev.history.rows, "No result on this benchmark yet."));
  out.push(...leftOut(ev.history, "on this benchmark"));

  if (ev.related.total > 0) {
    out.push("");
    out.push(`Other ${ev.benchmark.kind} benchmarks, for shape rather than for comparison:`);
    out.push("");
    out.push(...resultLines(ev.related.rows, "", true));
    out.push(...leftOut(ev.related, `on other ${ev.benchmark.kind} benchmarks`));
  }

  out.push("");
  out.push(`## 2. The last ${RECENT_DAYS} days, day by day`);
  out.push("");
  out.push(
    `Rows, not averages. Sleep is actual sleep and time in bed, kept apart because ` +
      `they are different numbers. A reading marked \`n=\` is that day's mean over that ` +
      `many samples, with the range beside it. A vendor score is a number the vendor ` +
      `computed rather than one a sensor read, so it may corroborate a claim and cannot ` +
      `be the basis of one.`,
  );
  out.push("");
  out.push(...dayTable(ev.days));
  out.push("");
  out.push(renderCoverage(ev.coverage));

  out.push("");
  out.push(`### Self-reported, word for word`);
  out.push("");
  out.push(...softLines(ev.soft));

  out.push("");
  out.push(`## 3. Long-range averages, ${RULES.perSource}`);
  out.push("");
  if (ev.baselines.length === 0) {
    out.push(`No measurement has enough history for an average.`);
  } else {
    for (const b of ev.baselines) {
      out.push(`- **${b.source} ${b.type}: ${b.mean}${b.unit}** (sd ${b.sd})`);
      out.push(`  - ${renderCoverage(b.coverage)}`);
    }
  }

  out.push("");
  out.push(`## 4. Past predictions on this benchmark`);
  out.push("");
  if (ev.track.length === 0) {
    out.push(`None. This is the first, so there is no track record to weigh it against.`);
  } else {
    for (const t of ev.track) {
      const actual = t.actual ? describeScore(t.actual) : "not yet graded";
      out.push(`- ${t.createdAt.slice(0, 10)} predicted ${describeScore(t.predicted)}, actual ${actual}`);
      if (t.grade) {
        out.push(
          `  - ${t.grade.in_range ? "hit" : "miss"}, off by ${t.grade.abs_error_pct}% ` +
            `(${t.grade.signed_error > 0 ? "+" : ""}${t.grade.signed_error})`,
        );
      }
      // Who made it, so a run of misses from one model is visible rather than
      // averaged in with everyone else's (D66).
      out.push(`  - by ${t.by}`);
      if (t.lesson) out.push(`  - lesson: ${t.lesson}`);
    }
  }

  out.push("");
  out.push(
    `Save a prediction with \`ath log\`, passing JSON with an id, this benchmark, ` +
      `predicted, confidence, reasoning, evidence_window, model, and agent — the ` +
      `program you are running in. Grade it later with ` +
      `\`ath grade ${ev.benchmark.id} --actual <score>\`.`,
  );

  return out.join("\n");
}

/**
 * What was not printed, said rather than trimmed away.
 *
 * A reader who cannot see how much was left out cannot tell a short history from a
 * truncated one (D71).
 */
function leftOut(history: ResultHistory, what: string): string[] {
  if (history.shown >= history.total) return [];
  return [
    "",
    `Showing the ${history.shown} most recent of ${history.total} results ${what}. ` +
      `The rest are in the file, and \`ath stats\` counts them all.`,
  ];
}

function resultLines(rows: ResultRow[], empty: string, withName = false): string[] {
  if (rows.length === 0) return empty ? [empty] : [];
  return rows.map((r) => {
    let line =
      `- ${r.recordedAt.slice(0, 10)}: ` +
      (withName ? `${r.benchmark} ` : "") +
      `**${describeScore(r.score)}**` +
      (r.scaling ? ` (${r.scaling})` : "");
    if (r.session) {
      line += ` — session ${r.session.start.slice(11, 16)} on ${r.session.source}`;
      if (r.session.avgHr !== undefined) line += `, avg ${r.session.avgHr} bpm`;
    } else {
      line += ` — no session linked`;
    }
    if (r.note) line += `\n  - note: ${r.note}`;
    return line;
  });
}

interface Cell {
  day: string;
  source: string;
  values: Map<string, string>;
  sleep: string;
  session: string;
  vendor: string;
}

/**
 * The recent window as a table, one row per day per source.
 *
 * Two devices measuring one day are two rows, never one averaged row, because
 * readings are not pooled across sources (D31). Columns appear only where there is
 * something in them, so a file with one wearable does not print four empty ones.
 */
function dayTable(days: DayRow[]): string[] {
  if (days.length === 0) return ["No measurements at all in this window."];

  const rows: Cell[] = [];
  const cellFor = (day: string, source: string): Cell => {
    const found = rows.find((r) => r.day === day && r.source === source);
    if (found) return found;
    const fresh: Cell = { day, source, values: new Map(), sleep: "", session: "", vendor: "" };
    rows.push(fresh);
    return fresh;
  };

  const types: string[] = [];
  for (const d of days) {
    for (const r of d.readings) {
      if (!types.includes(r.type)) types.push(r.type);
      cellFor(d.day, r.source).values.set(
        r.type,
        r.n === 1 ? `${r.value} ${r.unit}` : `${r.value} ${r.unit} (n=${r.n}, ${r.min}–${r.max})`,
      );
    }
    for (const s of d.sleep) {
      const slept = s.duration_s === undefined ? "?" : hoursAndMinutes(s.duration_s);
      const inBed = s.time_in_bed_s === undefined ? "?" : hoursAndMinutes(s.time_in_bed_s);
      const eff = s.efficiency_pct === undefined ? "" : `, ${s.efficiency_pct}%`;
      cellFor(d.day, s.source).sleep = `${slept} of ${inBed}${eff}`;
    }
    for (const s of d.sessions) {
      const parts = [
        s.start.slice(11, 16),
        s.activity ?? "session",
        s.avgHr === undefined ? "" : `avg ${s.avgHr} bpm`,
      ].filter(Boolean);
      const cell = cellFor(d.day, s.source);
      cell.session = cell.session ? `${cell.session}; ${parts.join(" ")}` : parts.join(" ");
    }
    for (const v of d.vendor) {
      const cell = cellFor(d.day, v.source);
      const text = `${v.metric} ${v.value} (${v.scale})`;
      cell.vendor = cell.vendor ? `${cell.vendor}; ${text}` : text;
    }
  }

  rows.sort((a, b) => a.day.localeCompare(b.day) || a.source.localeCompare(b.source));

  const columns: { head: string; get: (c: Cell) => string }[] = [
    { head: "day", get: (c) => c.day },
    { head: "source", get: (c) => c.source },
    ...types.map((t) => ({ head: t, get: (c: Cell) => c.values.get(t) ?? "" })),
  ];
  if (rows.some((r) => r.sleep)) columns.push({ head: "sleep of time in bed", get: (c) => c.sleep });
  if (rows.some((r) => r.session)) columns.push({ head: "training", get: (c) => c.session });
  if (rows.some((r) => r.vendor)) {
    columns.push({ head: "vendor score (not measured)", get: (c) => c.vendor });
  }

  const widths = columns.map((col) => Math.max(col.head.length, ...rows.map((r) => col.get(r).length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;

  return [
    line(columns.map((c) => c.head)),
    line(widths.map((w) => "-".repeat(w))),
    ...rows.map((r) => line(columns.map((c) => c.get(r)))),
  ];
}

function softLines(soft: SoftSignalT[]): string[] {
  if (soft.length === 0) return ["Nothing self-reported in this window."];
  return soft.map((s) => {
    const rating = s.rating === undefined ? "" : ` ${s.rating}/${s.scale?.split("-")[1] ?? "?"}`;
    const region = s.body_region ? ` ${s.body_region}` : "";
    return `- ${s.reported_at.slice(0, 10)} ${s.type}${region}${rating}: "${s.note ?? ""}"`;
  });
}

/** The same evidence as data, for an agent that would rather not read prose (D47). */
export function evidenceAsJson(ev: Evidence): Record<string, unknown> {
  return {
    benchmark: ev.benchmark,
    as_of: ev.asOf,
    window: { from: ev.from, to: ev.asOf },
    gaps: ev.gaps,
    history: ev.history,
    related: ev.related,
    days: ev.days,
    coverage: ev.coverage,
    soft_signals: ev.soft,
    baselines: ev.baselines,
    track_record: ev.track,
    note:
      "Evidence only. This tool has no model and does not predict; write the " +
      "prediction back with `ath log`.",
  };
}
