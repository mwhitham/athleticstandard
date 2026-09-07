/**
 * `ath log` — the only command that writes (D55).
 *
 * Four kinds of record go through here: a measurement, a self-reported entry, a
 * benchmark result, and a prediction. One write path is one thing to learn, one
 * place to enforce validation, and one surface to test.
 *
 * Nothing is written until the summary has been shown and the one question answered
 * (D56). The tool guesses — at the score, at the kind, at the subtype — and every
 * guess it makes appears on the screen first. That is what separates this from the
 * three silent parser failures that cost this project the most (D34, D42, D44).
 */
import {
  ATHLETIC_STANDARD_VERSION,
  Benchmark,
  HardSignal,
  Prediction,
  SoftSignal,
  SoftSignalType,
  type AthleticStandardFileT,
  type BenchmarkT,
  type HardSignalT,
  type PredictionT,
  type ScoreT,
  type SoftSignalT,
} from "./schema.js";
import { formatDuration, parseEntry, ParseRefusal, type Entry } from "./logparse.js";

/** Raised when input cannot be written, with the remedy in the message. */
export class LogRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogRefusal";
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date written in an order nobody can settle.
 *
 * `09-04-2026` is the 4th of September in the United States and the 9th of April
 * almost everywhere else, and the string itself does not decide. Every other guess
 * this tool makes is shown in the summary and can be checked; this one cannot, since
 * `2026-09-04` looks right under either intent. So it is refused (D56).
 */
const AMBIGUOUS_DATE = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/;

/** The machine's UTC offset, written the way a timestamp states it. */
function localOffset(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** An instant written with this machine's offset, so the local day is readable. */
export function localTimestamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}${localOffset(at)}`
  );
}

/** Midday on a past date, since a day with no time still has to be an instant. */
export function noonOn(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return localTimestamp(new Date(y!, m! - 1, d!, 12, 0, 0));
}

export function today(now: Date = new Date()): string {
  return localTimestamp(now).slice(0, 10);
}

/**
 * Pull a leading date off the text, and refuse one written ambiguously.
 *
 * Returns the day and the rest of the text. No date means today, because most
 * workouts are logged the day they happen and the day is shown in the summary before
 * anything is written.
 */
export function takeDate(text: string, now: Date = new Date()): { day: string; rest: string; wasToday: boolean } {
  const match = /^(\S+)([\s\S]*)$/.exec(text.trim());
  const first = match?.[1] ?? "";

  if (ISO_DATE.test(first)) {
    if (Number.isNaN(Date.parse(`${first}T00:00:00Z`))) {
      throw new LogRefusal(`'${first}' is not a real date.`);
    }
    return { day: first, rest: (match?.[2] ?? "").trim(), wasToday: first === today(now) };
  }

  const ambiguous = AMBIGUOUS_DATE.exec(first);
  if (ambiguous) {
    const [, a, b, year] = ambiguous;
    const pad = (n: string) => n.padStart(2, "0");
    throw new LogRefusal(
      `'${first}' could be ${year}-${pad(a!)}-${pad(b!)} or ${year}-${pad(b!)}-${pad(a!)}, and ` +
        `nothing in it says which. Write it as ${year}-${pad(a!)}-${pad(b!)} — year, month, day.`,
    );
  }

  return { day: today(now), rest: text.trim(), wasToday: true };
}

// ---------------------------------------------------------------------------
// The draft: what will be written, before anything is
// ---------------------------------------------------------------------------

export interface SessionCandidate {
  source: string;
  start: string;
  end: string;
  /** How it reads in the summary: "17:25 to 17:48 on whoop-1". */
  label: string;
}

export interface LogDraft {
  hard: HardSignalT[];
  soft: SoftSignalT[];
  predictions: PredictionT[];
  /** Benchmarks that do not exist yet and will be created alongside the result. */
  newBenchmarks: BenchmarkT[];
  /** Sessions the benchmark result may have happened in, best first. */
  candidates: SessionCandidate[];
  /**
   * Which candidate will be saved, or -1 for none.
   *
   * A match is made by asking, never by inference (D53), so it starts at -1 wherever
   * there is nobody to ask. The extra key on the question moves it.
   */
  chosenCandidate: number;
  /** One block per record, for the summary. */
  blocks: { label: string; value: string }[][];
}

const SOFT_TYPES = new Set(SoftSignalType.options as readonly string[]);

/** The source hand-typed records belong to, created if the file has none. */
function manualSource(file: AthleticStandardFileT): string {
  const existing = file.sources.find((s) => s.kind === "manual");
  if (existing) return existing.id;
  file.sources.push({ id: "manual-1", kind: "manual", detail: "Hand-entered data" });
  return "manual-1";
}

/** A benchmark id from a name a person or an agent supplied. */
export function benchmarkId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new LogRefusal(`'${name}' has nothing in it that can be an id.`);
  return /^[a-z0-9]/.test(slug) ? slug : `b-${slug}`;
}

/**
 * The sessions a result may have happened in.
 *
 * Same calendar day, from any source, best first — a workout logged at 6pm and a
 * session at 6pm are probably the same effort, and probably is exactly why the tool
 * offers them rather than picking one (D53).
 */
export function sessionCandidates(file: AthleticStandardFileT, recordedAt: string): SessionCandidate[] {
  const day = recordedAt.slice(0, 10);
  const at = Date.parse(recordedAt);
  return file.hard_signals
    .filter((s): s is Extract<HardSignalT, { type: "workout_session" }> => s.type === "workout_session")
    .filter((s) => s.start.slice(0, 10) === day)
    .map((s) => ({
      source: s.source,
      start: s.start,
      end: s.end,
      label: `${s.start.slice(11, 16)} to ${s.end.slice(11, 16)} on ${s.source}`,
    }))
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.start) - at) - Math.abs(Date.parse(b.start) - at) ||
        a.start.localeCompare(b.start),
    );
}

export interface LogInput {
  /** What the person typed or pasted, or the JSON an agent passed. */
  text: string;
  /** A benchmark name, which an agent supplies after recognising the workout (D54). */
  benchmark?: string | undefined;
  date?: string | undefined;
  scaling?: "rx" | "scaled" | undefined;
  now?: Date | undefined;
  /**
   * Whether the one question can be put to somebody. False with no terminal and no
   * `--yes`, in which case a session match is left for `ath link` or the next import
   * rather than written on nobody's say-so.
   */
  confirmable?: boolean | undefined;
}

/** Is this an agent's structured input rather than something a person typed? */
export function looksLikeJson(text: string): boolean {
  const first = text.trim()[0];
  return first === "{" || first === "[";
}

/**
 * Build everything that will be written, without writing any of it.
 *
 * Every guess made here lands in `blocks`, which is what the reader sees above the
 * one question. Nothing reaches the file until that question is answered.
 */
export function buildDraft(file: AthleticStandardFileT, input: LogInput): LogDraft {
  const now = input.now ?? new Date();
  const draft: LogDraft = {
    hard: [],
    soft: [],
    predictions: [],
    newBenchmarks: [],
    candidates: [],
    chosenCandidate: input.confirmable === false ? -1 : 0,
    blocks: [],
  };

  if (looksLikeJson(input.text)) {
    buildFromJson(file, draft, input.text, now);
    return draft;
  }

  const { day, rest, wasToday } = input.date
    ? { day: checkedDay(input.date), rest: input.text.trim(), wasToday: input.date === today(now) }
    : takeDate(input.text, now);

  if (rest === "") {
    throw new LogRefusal(
      `nothing to log. Type the entry on the line — \`ath log slept badly, about 5 hours\` — ` +
        `or run \`ath log\` on its own and paste it, ending with Ctrl-D.`,
    );
  }

  const recordedAt = wasToday ? localTimestamp(now) : noonOn(day);
  const source = manualSource(file);

  let entries: Entry[];
  try {
    entries = parseEntry(rest, {
      knownBenchmarks: file.benchmarks.map((b) => b.id),
      benchmark: input.benchmark,
    });
  } catch (e) {
    if (e instanceof ParseRefusal) throw new LogRefusal(e.message);
    throw e;
  }

  const dateNote = wasToday ? "  (today)" : "";

  for (const entry of entries) {
    if (entry.kind === "measurement") {
      draft.hard.push({
        type: entry.type,
        value: entry.value,
        unit: entry.unit,
        recorded_at: recordedAt,
        source,
        ...(entry.text.trim() ? { note: entry.text.trim() } : {}),
      } as HardSignalT);
      draft.blocks.push([
        { label: "kind", value: "measurement  (typed in by hand, not read by a device)" },
        { label: "date", value: `${day}${dateNote}` },
        { label: "reading", value: `${entry.type} ${entry.value} ${entry.unit}` },
        { label: "source", value: source },
      ]);
      continue;
    }

    if (entry.kind === "self-reported") {
      draft.soft.push({
        type: entry.type,
        reported_at: recordedAt,
        ...(entry.rating !== undefined ? { rating: entry.rating, scale: entry.scale! } : {}),
        ...(entry.bodyRegion ? { body_region: entry.bodyRegion } : {}),
        note: entry.text,
        provenance: { via: "text" },
      });
      const detail = [
        entry.type,
        entry.bodyRegion,
        entry.rating !== undefined ? `${entry.rating} out of ${entry.scale!.split("-")[1]}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      draft.blocks.push([
        { label: "kind", value: "self-reported  (how it felt, not what was measured)" },
        { label: "date", value: `${day}${dateNote}` },
        { label: "entry", value: detail },
        { label: "text", value: entry.text },
      ]);
      continue;
    }

    // A workout result. The benchmark is named by the agent, by the text, or by the
    // day, in that order (D54). An unknown one is created rather than refused,
    // because logging a workout nobody has done before is the ordinary case.
    const named = input.benchmark ? benchmarkId(input.benchmark) : entry.namedBenchmark;
    const id = named ?? freeDateName(file, draft, day, entry.text);
    const why = input.benchmark
      ? ""
      : entry.namedBenchmark
        ? "  (named in what you wrote)"
        : "  (no agent connected, so named after the day)";

    const existing = file.benchmarks.find((b) => b.id === id) ?? draft.newBenchmarks.find((b) => b.id === id);
    if (!existing) {
      draft.newBenchmarks.push({
        id,
        kind: "custom",
        score_type: entry.scoreType,
        definition: entry.text,
      });
    } else if (existing.score_type !== entry.scoreType) {
      throw new LogRefusal(
        `'${id}' is scored by ${existing.score_type} and this reads as ${entry.scoreType}. ` +
          `Give it a different name with --benchmark, or check the score.`,
      );
    }

    const candidates = sessionCandidates(file, recordedAt);
    const result: HardSignalT = {
      type: "benchmark_result",
      benchmark: id,
      recorded_at: recordedAt,
      source,
      result: entry.score,
      ...(input.scaling ?? entry.scaling ? { scaling: (input.scaling ?? entry.scaling)! } : {}),
    };
    draft.hard.push(result);
    draft.candidates = candidates;

    const block = [
      { label: "kind", value: "workout result" },
      { label: "date", value: `${day}${dateNote}` },
      { label: "score", value: entry.scoreText },
      { label: "name", value: `${id}${existing ? "" : why || "  (new benchmark)"}` },
    ];
    if (candidates.length === 0) {
      block.push({
        label: "session",
        value: "no device session that day yet — link it after your next import",
      });
    } else if (draft.chosenCandidate < 0) {
      block.push({
        label: "session",
        value: `${candidates[0]!.label} — not linked, because there is nobody to confirm it with`,
      });
    } else {
      block.push({ label: "session", value: candidates[0]!.label });
    }
    block.push({ label: "workout", value: "saved word for word" });
    draft.blocks.push(block);
  }

  return draft;
}

/**
 * A date-shaped name that is free, or the same one again if the workout matches.
 *
 * Two different workouts on one day would otherwise share a benchmark and be
 * compared against each other, which is the one thing a benchmark is for. Repeating
 * the same workout keeps the same name, so the comparison still works.
 */
function freeDateName(file: AthleticStandardFileT, draft: LogDraft, day: string, text: string): string {
  const all = [...file.benchmarks, ...draft.newBenchmarks];
  for (let n = 1; ; n++) {
    const id = n === 1 ? day : `${day}-${n}`;
    const taken = all.find((b) => b.id === id);
    if (!taken || taken.definition === text) return id;
  }
}

function checkedDay(day: string): string {
  if (!ISO_DATE.test(day)) {
    throw new LogRefusal(`--date takes a day written as YYYY-MM-DD, not '${day}'.`);
  }
  return day;
}

/**
 * An agent's input, dispatched on shape rather than guessed at (D57).
 *
 * A `type` from the hard list is a measurement, a `type` from the soft list is
 * self-reported, and `predicted` with `confidence` and no `type` is a prediction.
 * The three do not overlap, so nothing here reads words.
 */
function buildFromJson(file: AthleticStandardFileT, draft: LogDraft, text: string, now: Date): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new LogRefusal(`that is not valid JSON: ${(e as Error).message}`);
  }

  for (const raw of Array.isArray(parsed) ? parsed : [parsed]) {
    if (raw === null || typeof raw !== "object") {
      throw new LogRefusal("each record has to be an object.");
    }
    const record = raw as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : undefined;

    if (type === undefined && "predicted" in record && "confidence" in record) {
      const prediction = Prediction.safeParse({
        actual: null,
        grade: null,
        miss_analysis: null,
        ...record,
      });
      if (!prediction.success) throw new LogRefusal(explain("prediction", prediction.error.issues));
      if (!file.benchmarks.some((b) => b.id === prediction.data.benchmark)) {
        throw new LogRefusal(
          `no benchmark called '${prediction.data.benchmark}'. Predict against one that exists, ` +
            `or log a result for it first.`,
        );
      }
      draft.predictions.push(prediction.data);
      draft.blocks.push([
        { label: "kind", value: "prediction" },
        { label: "benchmark", value: prediction.data.benchmark },
        { label: "predicted", value: describeScore(prediction.data.predicted) },
        { label: "confidence", value: prediction.data.confidence },
      ]);
      continue;
    }

    if (type !== undefined && SOFT_TYPES.has(type)) {
      const soft = SoftSignal.safeParse({ reported_at: localTimestamp(now), ...record });
      if (!soft.success) throw new LogRefusal(explain("self-reported entry", soft.error.issues));
      draft.soft.push(soft.data);
      draft.blocks.push([
        { label: "kind", value: "self-reported" },
        { label: "date", value: soft.data.reported_at.slice(0, 10) },
        { label: "entry", value: soft.data.type },
        { label: "text", value: soft.data.note ?? "(no text)" },
      ]);
      continue;
    }

    const hard = HardSignal.safeParse({
      recorded_at: localTimestamp(now),
      source: manualSource(file),
      ...record,
    });
    if (!hard.success) {
      throw new LogRefusal(
        explain("record", hard.error.issues) +
          `\n  A measurement needs a type from the hard list, a value and its unit. A ` +
          `self-reported entry needs a type from the soft list. A prediction needs ` +
          `predicted and confidence, and no type.`,
      );
    }
    const signal = hard.data;
    draft.hard.push(signal);

    if (signal.type === "benchmark_result") {
      if (!file.benchmarks.some((b) => b.id === signal.benchmark)) {
        throw new LogRefusal(
          `no benchmark called '${signal.benchmark}'. Add one by logging the workout as text, ` +
            `or include a benchmarks entry first.`,
        );
      }
      draft.candidates = signal.session ? [] : sessionCandidates(file, signal.recorded_at);
      draft.blocks.push([
        { label: "kind", value: "workout result" },
        { label: "date", value: signal.recorded_at.slice(0, 10) },
        { label: "score", value: describeScore(signal.result) },
        { label: "name", value: signal.benchmark },
        {
          label: "session",
          value: signal.session
            ? `${signal.session.start.slice(11, 16)} on ${signal.session.source}`
            : (draft.candidates[0]?.label ?? "none that day"),
        },
      ]);
      continue;
    }

    draft.blocks.push([
      { label: "kind", value: "measurement" },
      { label: "date", value: describeWhen(signal) },
      { label: "reading", value: describeHard(signal) },
      { label: "source", value: signal.source },
    ]);
  }
}

function explain(what: string, issues: { path: PropertyKey[]; message: string }[]): string {
  return (
    `that ${what} does not fit the format, so nothing was written:\n` +
    issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n")
  );
}

export function describeScore(score: ScoreT): string {
  if (score.duration_s !== undefined) return formatDuration(score.duration_s);
  if (score.reps !== undefined) return `${score.reps} reps`;
  if (score.weight_kg !== undefined) return `${score.weight_kg} kg`;
  return "(no score)";
}

function describeWhen(sig: HardSignalT): string {
  return ("recorded_at" in sig ? sig.recorded_at : sig.type === "series_ref" ? sig.from : sig.start).slice(0, 10);
}

function describeHard(sig: HardSignalT): string {
  if ("value" in sig && "unit" in sig) return `${sig.type} ${sig.value} ${sig.unit}`;
  return sig.type;
}

// ---------------------------------------------------------------------------
// The summary, and writing
// ---------------------------------------------------------------------------

export function renderDraft(draft: LogDraft): string {
  const lines: string[] = [];
  const width = Math.max(...draft.blocks.flat().map((r) => r.label.length), 7);
  draft.blocks.forEach((block, i) => {
    if (i > 0) lines.push("");
    for (const row of block) lines.push(`  ${row.label.padEnd(width)}  ${row.value}`);
  });
  return lines.join("\n");
}

/**
 * The one question, with the extra keys the session match needs.
 *
 * A second candidate becomes a key on this question rather than a second question,
 * because two questions in a row is how a person stops reading them (D58).
 */
export function renderQuestion(draft: LogDraft): string {
  const extra = draft.candidates
    .slice(1, 4)
    .map((c, i) => `  [${i + 2}] use the ${c.start.slice(11, 16)} one instead`)
    .join("");
  return `Save this? [y] yes  [n] no${extra}`;
}

/** Apply the draft to the file. The caller validates and saves. */
export function applyDraft(file: AthleticStandardFileT, draft: LogDraft): void {
  for (const benchmark of draft.newBenchmarks) {
    const checked = Benchmark.safeParse(benchmark);
    if (!checked.success) throw new LogRefusal(explain("benchmark", checked.error.issues));
    file.benchmarks.push(checked.data);
  }

  const chosen = draft.chosenCandidate < 0 ? undefined : draft.candidates[draft.chosenCandidate];
  for (const signal of draft.hard) {
    if (signal.type === "benchmark_result" && chosen && !signal.session) {
      signal.session = { source: chosen.source, start: chosen.start };
    }
    file.hard_signals.push(signal);
  }
  file.soft_signals.push(...draft.soft);
  file.predictions.push(...draft.predictions);

  file.hard_signals.sort((a, b) => Date.parse(signalAt(a)) - Date.parse(signalAt(b)));
  file.soft_signals.sort((a, b) => Date.parse(a.reported_at) - Date.parse(b.reported_at));
}

function signalAt(sig: HardSignalT): string {
  if ("recorded_at" in sig) return sig.recorded_at;
  if (sig.type === "series_ref") return `${sig.from}T00:00:00Z`;
  return sig.start;
}

/** One line per record written, echoed back so the reader sees what landed. */
export function renderWritten(draft: LogDraft): string {
  const lines: string[] = [];
  for (const benchmark of draft.newBenchmarks) {
    lines.push(`created benchmark '${benchmark.id}' (scored by ${benchmark.score_type})`);
  }
  const chosen = draft.chosenCandidate < 0 ? undefined : draft.candidates[draft.chosenCandidate];
  for (const signal of draft.hard) {
    if (signal.type === "benchmark_result") {
      lines.push(
        `logged ${describeScore(signal.result)} on '${signal.benchmark}'` +
          (signal.session ? `, linked to the ${signal.session.start.slice(11, 16)} session` : ", not linked to a session"),
      );
      if (!signal.session) {
        lines.push(
          `  link it after your next import, or with ` +
            `\`ath link ${signal.benchmark}@${signal.recorded_at.slice(0, 10)} <time>\``,
        );
      }
    } else {
      lines.push(`logged ${describeHard(signal)}`);
    }
  }
  for (const soft of draft.soft) lines.push(`logged ${soft.type}: ${soft.note ?? "(no text)"}`);
  for (const p of draft.predictions) {
    lines.push(`logged prediction '${p.id}' on '${p.benchmark}': ${describeScore(p.predicted)}`);
  }
  return lines.join("\n");
}

/** The draft as data, for `--json`. */
export function draftAsJson(draft: LogDraft, written: boolean): Record<string, unknown> {
  return {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    written,
    benchmarks_created: draft.newBenchmarks,
    hard_signals: draft.hard,
    soft_signals: draft.soft,
    predictions: draft.predictions,
    session_candidates: draft.candidates,
    session_chosen: (draft.chosenCandidate < 0 ? undefined : draft.candidates[draft.chosenCandidate]) ?? null,
  };
}

// ---------------------------------------------------------------------------
// ath link
// ---------------------------------------------------------------------------

export interface LinkOutcome {
  benchmark: string;
  recordedAt: string;
  session: { source: string; start: string };
  /** What it was attached to before, when this corrected an earlier link. */
  replaced: { source: string; start: string } | null;
}

/**
 * Attach a result to the session it happened in, or move one that went to the wrong
 * session (D53).
 *
 * `result` is a benchmark id, optionally with `@YYYY-MM-DD` when there is more than
 * one. `session` is a start time — `17:25` on the result's own day, or a full
 * timestamp, or `source@timestamp` when two devices recorded the same minute.
 */
export function linkResult(file: AthleticStandardFileT, result: string, session: string): LinkOutcome {
  const [benchmark, onDay] = result.split("@");
  const matches = file.hard_signals.filter(
    (s): s is Extract<HardSignalT, { type: "benchmark_result" }> =>
      s.type === "benchmark_result" &&
      s.benchmark === benchmark &&
      (onDay === undefined || s.recorded_at.slice(0, 10) === onDay),
  );

  if (matches.length === 0) {
    const known = [...new Set(file.hard_signals.filter((s) => s.type === "benchmark_result").map((s) => s.benchmark))];
    throw new LogRefusal(
      `no result for '${benchmark}'${onDay ? ` on ${onDay}` : ""}. ` +
        `Results recorded for: ${known.join(", ") || "none yet"}.`,
    );
  }
  if (matches.length > 1 && onDay === undefined) {
    throw new LogRefusal(
      `'${benchmark}' has ${matches.length} results. Say which day: ` +
        matches.map((m) => `${benchmark}@${m.recorded_at.slice(0, 10)}`).join(", "),
    );
  }
  const target = matches[matches.length - 1]!;

  const [maybeSource, maybeStart] = session.includes("@") ? session.split("@") : [undefined, session];
  const sessions = file.hard_signals.filter(
    (s): s is Extract<HardSignalT, { type: "workout_session" }> =>
      s.type === "workout_session" &&
      (maybeSource === undefined || s.source === maybeSource) &&
      (s.start === maybeStart ||
        (s.start.slice(0, 10) === target.recorded_at.slice(0, 10) && s.start.slice(11, 16) === maybeStart)),
  );

  if (sessions.length === 0) {
    const sameDay = file.hard_signals
      .filter((s) => s.type === "workout_session" && s.start.slice(0, 10) === target.recorded_at.slice(0, 10))
      .map((s) => `${(s as { start: string }).start.slice(11, 16)} on ${s.source}`);
    throw new LogRefusal(
      `no session matching '${session}'. Sessions on ${target.recorded_at.slice(0, 10)}: ` +
        `${sameDay.join(", ") || "none — import your device data first"}.`,
    );
  }
  if (sessions.length > 1) {
    throw new LogRefusal(
      `${sessions.length} sessions start at ${maybeStart}. Say which device: ` +
        sessions.map((s) => `${s.source}@${s.start}`).join(", "),
    );
  }

  const chosen = sessions[0]!;
  const replaced = target.session ?? null;
  target.session = { source: chosen.source, start: chosen.start };
  return { benchmark: target.benchmark, recordedAt: target.recorded_at, session: target.session, replaced };
}

/**
 * Results still waiting for a session that a session now exists for.
 *
 * A result with no `session` is itself the record of a match still waiting, so no
 * extra state remembers it. Every import asks again about the ones that have become
 * possible (D53).
 */
export function waitingMatches(
  file: AthleticStandardFileT,
): { result: Extract<HardSignalT, { type: "benchmark_result" }>; candidates: SessionCandidate[] }[] {
  return file.hard_signals
    .filter(
      (s): s is Extract<HardSignalT, { type: "benchmark_result" }> =>
        s.type === "benchmark_result" && s.session === undefined,
    )
    .map((result) => ({ result, candidates: sessionCandidates(file, result.recorded_at) }))
    .filter((m) => m.candidates.length > 0);
}
