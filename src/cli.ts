#!/usr/bin/env node
/**
 * ath — the Athletic Standard CLI.
 * Deterministic plumbing: no LLM calls live here. Agents (via the Skill) and
 * humans both drive the same commands.
 */
import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  ATHLETIC_STANDARD_VERSION,
  SERIES_QUANTITY_UNITS,
  type AthleticStandardFileT,
} from "./schema.js";
import {
  validateAthleticStandardFile,
  type ValidationIssue,
  type ValidationResult,
} from "./validate.js";
import { findFile, loadFile, loadFileRaw, saveFile, DEFAULT_FILENAME } from "./file.js";
import { SEED_BENCHMARKS } from "./benchmarks.js";
import { renderStats, statsAsJson } from "./stats.js";
import { checkSeriesRef, SERIES_DIR, seriesDirectory } from "./series.js";
import {
  coverageOfDays,
  matchingRefs,
  readRawDays,
  renderDaySummaries,
  renderRawDays,
  summarizeDays,
} from "./seriesview.js";
import {
  applyDraft,
  buildDraft,
  draftAsJson,
  linkResult,
  LogRefusal,
  renderDraft,
  renderQuestion,
  renderWritten,
  today,
  waitingMatches,
} from "./log.js";
import { evidenceFor } from "./context.js";
import { benchmarkOrRefuse, evidenceAsJson, PredictRefusal, renderEvidence } from "./predict.js";
import { importExport, PooledFileError, UnknownExportError } from "./import/index.js";
import { silentProgress, terminalProgress } from "./progress.js";
import { mergeSummaryAsJson, renderMergeSummary } from "./import/merge.js";

const program = new Command();

program
  .name("ath")
  .description(
    "Athletic Standard — an open, local-first format for training and recovery data " +
      "that keeps measured signals apart from self-reported ones.",
  )
  .version(ATHLETIC_STANDARD_VERSION);

program
  .command("init")
  .description(`create a new ${DEFAULT_FILENAME} in the current directory`)
  .option("--name <name>", "athlete name")
  .option("--birth-year <year>", "birth year")
  .option("--sex <sex>", "male | female")
  .option("--units <units>", "metric | imperial (display preference only)", "metric")
  .option("--file <path>", "output path", DEFAULT_FILENAME)
  .option("-y, --yes", "non-interactive: use provided flags and defaults")
  .option("--json", "structured output")
  .action(async (opts) => {
    const outPath = resolve(process.cwd(), opts.file);
    if (existsSync(outPath)) {
      fail(`${outPath} already exists — refusing to overwrite`);
    }

    let { name, birthYear, sex } = { name: opts.name, birthYear: opts.birthYear, sex: opts.sex };
    if (!opts.yes && !opts.json) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      name = name ?? ((await rl.question("Name (optional): ")) || undefined);
      birthYear = birthYear ?? ((await rl.question("Birth year (optional): ")) || undefined);
      sex = sex ?? ((await rl.question("Sex, male/female (optional): ")) || undefined);
      rl.close();
    }

    const file: AthleticStandardFileT = {
      athleticstandard_version: ATHLETIC_STANDARD_VERSION,
      athlete: {
        ...(name ? { name } : {}),
        ...(birthYear ? { birth_year: Number(birthYear) } : {}),
        ...(sex === "male" || sex === "female" ? { sex } : {}),
        units: opts.units === "imperial" ? "imperial" : "metric",
      },
      sources: [{ id: "manual-1", kind: "manual", detail: "Hand-entered data" }],
      hard_signals: [],
      soft_signals: [],
      benchmarks: SEED_BENCHMARKS,
      predictions: [],
    };

    const result = validateAthleticStandardFile(file);
    if (!result.valid) {
      fail(
        `refusing to write an invalid file:\n` +
          result.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
      );
    }

    saveFile(outPath, file);
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            created: outPath,
            athleticstandard_version: ATHLETIC_STANDARD_VERSION,
            benchmarks: SEED_BENCHMARKS.map((b) => b.id),
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(`created ${outPath}`);
    console.log(`  seeded ${SEED_BENCHMARKS.length} benchmarks: ${SEED_BENCHMARKS.map((b) => b.id).join(", ")}`);
    console.log(`  next: \`ath import <export-file>\` to load device data`);
  });

program
  .command("check")
  .description("validate a file against the schema and semantic rules")
  .argument("[file]", "path to the file (default: the one in this directory)")
  .option("--json", "structured output")
  .action((fileArg, opts: { json?: boolean }) => {
    const path = findOrFail(fileArg);
    const raw = loadFileRaw(path);
    const result = validateAthleticStandardFile(raw);
    const issues = [...result.issues, ...seriesIssues(path, result)];
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    // The file's own version, not the tool's. A 0.2.0 file read by a 0.3.0 tool is
    // valid and is still a 0.2.0 file, and saying otherwise hides that from the reader.
    const version =
      (raw as { athleticstandard_version?: string }).athleticstandard_version ?? null;

    if (opts.json) {
      console.log(
        JSON.stringify(
          { file: path, athleticstandard_version: version, valid: errors.length === 0, issues },
          null,
          2,
        ),
      );
      if (errors.length > 0) process.exit(1);
      return;
    }

    for (const i of errors) console.error(`error  ${i.path}: ${i.message}`);
    for (const i of warnings) console.warn(`warn   ${i.path}: ${i.message}`);

    if (errors.length > 0) {
      console.error(`\n${path}: INVALID — ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exit(1);
    }
    console.log(
      `${path}: valid Athletic Standard ${version ?? ATHLETIC_STANDARD_VERSION} file` +
        (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
    );
  });

program
  .command("import")
  .description("load an Apple Health, WHOOP, or Oura export into the file")
  .argument("<path>", "the export: a zip, a folder, an export.xml, or a CSV")
  .option("--file <path>", "athlete file to import into (default: the one in this directory)")
  .option("--json", "structured output")
  .action(async (exportPath: string, opts: { file?: string; json?: boolean }) => {
    const athletePath = findOrFail(opts.file);
    let file: AthleticStandardFileT;
    try {
      file = loadFile(athletePath);
    } catch (e) {
      return fail((e as Error).message);
    }

    // The bar draws on stderr and only when a person is watching. Piped output and
    // tests get the summary alone.
    const progress = process.stderr.isTTY && !opts.json ? terminalProgress() : silentProgress;
    let result;
    try {
      result = await importExport(file, athletePath, resolve(process.cwd(), exportPath), progress);
    } catch (e) {
      progress.finish();
      if (e instanceof UnknownExportError) return fail((e as Error).message);
      if (e instanceof PooledFileError) return fail((e as Error).message);
      return fail(`could not read that export: ${(e as Error).message}`);
    }

    // Refuse to write a file the import would have made invalid.
    const validation = validateAthleticStandardFile(file);
    if (!validation.valid) {
      const first = validation.issues.filter((i) => i.severity === "error").slice(0, 5);
      return fail(
        `import would produce an invalid file, so nothing was written:\n` +
          first.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
      );
    }

    saveFile(athletePath, file);

    // A result with no session is a match still waiting. Device data usually lands
    // days after the workout was logged, so every import asks again about the ones
    // that have become possible (D53).
    const waiting = waitingMatches(file);

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            ...mergeSummaryAsJson(result.summary, result.label),
            waiting_matches: waiting.map((m) => ({
              benchmark: m.result.benchmark,
              recorded_at: m.result.recorded_at,
              candidates: m.candidates,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(renderMergeSummary(result.summary, result.label));
    if (waiting.length === 0) return;

    const linked = await offerWaitingMatches(waiting);
    if (linked > 0) {
      const check = validateAthleticStandardFile(file);
      if (!check.valid) return fail(`that link would make the file invalid, so nothing was written`);
      saveFile(athletePath, file);
    }
  });

program
  .command("log")
  .description("write something down: a workout result, a measurement, or how you felt")
  .argument("[entry...]", "the entry, unquoted. Leave it off to paste one, ending with Ctrl-D")
  .option("--benchmark <name>", "name the workout, instead of naming it after the day")
  .option("--date <date>", "the day it happened, as YYYY-MM-DD (default: today)")
  .option("--scaling <rx|scaled>", "whether the workout was done as written")
  .option("--file <path>", "athlete file to write to (default: the one in this directory)")
  .option("-y, --yes", "skip the question and write it")
  .option("--dry-run", "show what would be written, and write nothing")
  .option("--json", "structured output")
  .action(async (words: string[], opts: LogOptions) => {
    const path = findOrFail(opts.file);
    let file: AthleticStandardFileT;
    try {
      file = loadFile(path);
    } catch (e) {
      return fail((e as Error).message);
    }

    // No words on the line means the entry is being pasted. A workout runs to several
    // lines and often carries a `"` for the box height, and a shell breaks on both,
    // so reading the paste is the only way to take one unquoted (D58).
    const text = words.length > 0 ? words.join(" ") : await readStdin();
    if (text.trim() === "") {
      return fail(
        `nothing to log. Type it on the line — \`ath log slept badly, about 5 hours\` — or run ` +
          `\`ath log\` on its own and paste it, ending with Ctrl-D.`,
      );
    }

    // A session match is made by asking. Without a terminal and without --yes there
    // is nobody to ask, so the result is written unlinked and `ath link` or the next
    // import picks it up (D53).
    // --dry-run counts, because it is a preview of the interactive run and writes
    // nothing either way.
    const confirmable =
      Boolean(opts.yes) || Boolean(opts.dryRun) || (process.stdout.isTTY === true && !opts.json);

    let draft;
    try {
      draft = buildDraft(file, {
        text,
        benchmark: opts.benchmark,
        date: opts.date,
        scaling: opts.scaling,
        confirmable,
      });
    } catch (e) {
      if (e instanceof LogRefusal) return fail((e as Error).message);
      throw e;
    }

    if (draft.blocks.length === 0) return fail("nothing to log.");

    // The summary, then one question. Every guess the tool made is on the screen
    // before anything reaches the file (D56).
    if (!opts.json) console.log(renderDraft(draft));

    if (opts.dryRun) {
      // The question is shown rather than asked, so a preview shows the whole shape
      // including the extra key a second candidate session adds.
      if (opts.json) console.log(JSON.stringify(draftAsJson(draft, false), null, 2));
      else console.log(`\n${renderQuestion(draft)}\nnothing written (--dry-run)`);
      return;
    }

    if (!opts.yes && !opts.json && process.stdout.isTTY) {
      const answer = await askOnTerminal(`\n${renderQuestion(draft)} `);
      if (answer === null) return fail("no terminal to ask on — pass --yes to write without asking");
      const choice = Number(answer);
      if (Number.isInteger(choice) && choice >= 2 && choice <= draft.candidates.length) {
        draft.chosenCandidate = choice - 1;
      } else if (!/^y(es)?$/i.test(answer)) {
        console.log("nothing written");
        return;
      }
    }

    try {
      applyDraft(file, draft);
    } catch (e) {
      if (e instanceof LogRefusal) return fail((e as Error).message);
      throw e;
    }

    const validation = validateAthleticStandardFile(file);
    if (!validation.valid) {
      const first = validation.issues.filter((i) => i.severity === "error").slice(0, 5);
      return fail(
        `that would make the file invalid, so nothing was written:\n` +
          first.map((i) => `  ${i.path}: ${i.message}`).join("\n"),
      );
    }

    saveFile(path, file);
    console.log(opts.json ? JSON.stringify(draftAsJson(draft, true), null, 2) : `\n${renderWritten(draft)}`);
  });

program
  .command("link")
  .description("attach a workout result to the device session it happened in")
  .argument("<result>", "the benchmark, e.g. `fran`, or `fran@2026-09-04` when there are several")
  .argument("<session>", "the session's start: `17:25`, a full timestamp, or `whoop-1@<timestamp>`")
  .option("--file <path>", "athlete file to change (default: the one in this directory)")
  .option("--json", "structured output")
  .action((result: string, session: string, opts: { file?: string; json?: boolean }) => {
    const path = findOrFail(opts.file);
    let file: AthleticStandardFileT;
    try {
      file = loadFile(path);
    } catch (e) {
      return fail((e as Error).message);
    }

    let outcome;
    try {
      outcome = linkResult(file, result, session);
    } catch (e) {
      if (e instanceof LogRefusal) return fail((e as Error).message);
      throw e;
    }

    const validation = validateAthleticStandardFile(file);
    if (!validation.valid) {
      return fail(`that link would make the file invalid, so nothing was written`);
    }
    saveFile(path, file);

    if (opts.json) {
      console.log(JSON.stringify(outcome, null, 2));
      return;
    }
    console.log(
      `${outcome.benchmark} on ${outcome.recordedAt.slice(0, 10)} is now linked to the ` +
        `${outcome.session.start.slice(11, 16)} session on ${outcome.session.source}` +
        (outcome.replaced ? ` (was ${outcome.replaced.start.slice(11, 16)} on ${outcome.replaced.source})` : ""),
    );
  });

program
  .command("predict")
  .description("print the evidence a prediction rests on — reads only, writes nothing")
  .argument("<benchmark>", "the benchmark to predict, e.g. `fran`. See them all with `ath stats`")
  .option("--as-of <date>", "pretend it is this day, hiding everything after it (YYYY-MM-DD)")
  .option("--file <path>", "athlete file to read (default: the one in this directory)")
  .option("--json", "structured output")
  .action((benchmarkId: string, opts: { asOf?: string; file?: string; json?: boolean }) => {
    const path = findOrFail(opts.file);
    let file: AthleticStandardFileT;
    try {
      file = loadFile(path);
    } catch (e) {
      return fail((e as Error).message);
    }

    const asOf = opts.asOf ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      return fail(`--as-of takes a day written as YYYY-MM-DD, not '${asOf}'.`);
    }

    let benchmark;
    try {
      benchmark = benchmarkOrRefuse(file, benchmarkId);
    } catch (e) {
      if (e instanceof PredictRefusal) return fail((e as Error).message);
      throw e;
    }

    const evidence = evidenceFor(file, path, benchmark, asOf);
    console.log(opts.json ? JSON.stringify(evidenceAsJson(evidence), null, 2) : renderEvidence(evidence));
  });

program
  .command("series")
  .description("read a sample series back: one row per day, or the raw samples")
  .argument("<quantity>", `one of: ${Object.keys(SERIES_QUANTITY_UNITS).join(", ")}`)
  .option("--from <date>", "earliest day to include (YYYY-MM-DD)")
  .option("--to <date>", "latest day to include (YYYY-MM-DD)")
  .option("--source <id>", "only this source, when several measured the same quantity")
  .option("--raw", "every sample, not a daily summary")
  .option("--json", "structured output")
  .option("--file <path>", "athlete file to read (default: the one in this directory)")
  .action(
    (
      quantity: string,
      opts: { from?: string; to?: string; source?: string; raw?: boolean; json?: boolean; file?: string },
    ) => {
      if (!(quantity in SERIES_QUANTITY_UNITS)) {
        return fail(
          `unknown quantity '${quantity}'. Known quantities: ` +
            Object.keys(SERIES_QUANTITY_UNITS).join(", "),
        );
      }
      const unit = SERIES_QUANTITY_UNITS[quantity as keyof typeof SERIES_QUANTITY_UNITS];

      const path = findOrFail(opts.file);
      let file: AthleticStandardFileT;
      try {
        file = loadFile(path);
      } catch (e) {
        return fail((e as Error).message);
      }

      const query = { quantity, from: opts.from, to: opts.to, source: opts.source };
      const refs = matchingRefs(file, query);
      if (refs.length === 0) {
        const available = [
          ...new Set(
            file.hard_signals
              .filter((s) => s.type === "series_ref")
              .map((s) => (s as { quantity: string }).quantity),
          ),
        ].sort();
        return fail(
          opts.source
            ? `no ${quantity} series recorded for source '${opts.source}'`
            : `no ${quantity} series in this file. Recorded: ${available.join(", ") || "none"}`,
        );
      }

      if (opts.raw) {
        const days = readRawDays(path, refs, query);
        console.log(
          opts.json
            ? JSON.stringify(
                {
                  quantity,
                  unit,
                  coverage: coverageOfDays(
                    quantity,
                    days.map((d) => ({ day: d.day, source: d.source, n: d.samples.length })),
                  ),
                  days,
                },
                null,
                2,
              )
            : renderRawDays(quantity, unit, days),
        );
        return;
      }

      const rows = summarizeDays(path, refs, query);
      console.log(
        opts.json
          ? JSON.stringify(
              { quantity, unit, coverage: coverageOfDays(quantity, rows), days: rows },
              null,
              2,
            )
          : renderDaySummaries(quantity, unit, rows),
      );
    },
  );

program
  .command("stats")
  .description("summarize the file: counts, date ranges, baselines")
  .argument("[file]", "path to the file (default: the one in this directory)")
  .option("--json", "structured output")
  .action((fileArg, opts: { json?: boolean }) => {
    const path = findOrFail(fileArg);
    const file = loadFile(path);
    console.log(
      opts.json ? JSON.stringify(statsAsJson(file, path), null, 2) : renderStats(file, path),
    );
  });

/**
 * Verify the sample series the document describes (D25, narrowed by D40).
 *
 * One rule: hash what is on disk for each quantity and compare. A missing day, an
 * extra day, and an edited day all change the hash, all say the same thing, and all
 * have the same remedy — import again, which rewrites the files and the record
 * together. Telling those apart would hand the reader a distinction they cannot act
 * on differently.
 *
 * No `series/` folder at all is the exception, and it is normal: that is the
 * document travelling without its sidecars, which it is meant to survive.
 */
function seriesIssues(path: string, result: ValidationResult): ValidationIssue[] {
  if (!result.valid) return [];

  let file: AthleticStandardFileT;
  try {
    file = loadFile(path);
  } catch {
    return [];
  }

  const refs = file.hard_signals.filter(
    (s): s is Extract<typeof s, { type: "series_ref" }> => s.type === "series_ref",
  );
  if (refs.length === 0) return [];

  if (!existsSync(seriesDirectory(path))) {
    return [
      {
        severity: "warning",
        path: SERIES_DIR,
        message:
          `series data not present — the document describes ${refs.length} series but the ` +
          `${SERIES_DIR}/ folder is not here. Everything else still reads normally.`,
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  for (const ref of refs) {
    if (checkSeriesRef(path, ref).status === "mismatch") {
      issues.push({
        severity: "error",
        path: `${SERIES_DIR}/${ref.quantity}`,
        message:
          `${ref.quantity} for ${ref.source} doesn't match what was recorded — ` +
          `re-import to fix`,
      });
    }
  }
  return issues;
}

/**
 * Offer each waiting match, and return how many were attached.
 *
 * With no terminal it prints the candidates and the command that links them, because
 * a match nobody was told about is a match nobody makes.
 */
async function offerWaitingMatches(waiting: ReturnType<typeof waitingMatches>): Promise<number> {
  const plural = waiting.length === 1 ? "result" : "results";
  console.log(
    `\n${waiting.length} ${plural} logged earlier now have a session on the same day:`,
  );

  let linked = 0;
  for (const { result, candidates } of waiting) {
    const day = result.recorded_at.slice(0, 10);
    const best = candidates[0]!;
    console.log(`  ${result.benchmark} on ${day} — ${best.label}`);

    if (!process.stdout.isTTY) {
      console.log(`    ath link ${result.benchmark}@${day} ${best.start.slice(11, 16)}`);
      continue;
    }

    const extra = candidates
      .slice(1, 4)
      .map((c, i) => `  [${i + 2}] the ${c.start.slice(11, 16)} one`)
      .join("");
    const answer = await askOnTerminal(`    link it? [y] yes  [n] no${extra} `);
    if (answer === null) return linked;
    const choice = Number(answer);
    const pick =
      Number.isInteger(choice) && choice >= 2 && choice <= candidates.length
        ? candidates[choice - 1]!
        : /^y(es)?$/i.test(answer)
          ? best
          : null;
    if (!pick) continue;
    result.session = { source: pick.source, start: pick.start };
    linked++;
  }
  return linked;
}

interface LogOptions {
  benchmark?: string;
  date?: string;
  scaling?: "rx" | "scaled";
  file?: string;
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

/** Everything piped or pasted, to the end. Empty when nothing is coming. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    process.stderr.write("Paste the entry, then press Ctrl-D:\n");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Ask on the terminal itself rather than on stdin.
 *
 * When the entry was pasted, stdin has already ended at Ctrl-D, so there is nothing
 * left to read an answer from. The terminal is still there, so the question goes to
 * it directly. Returns null where there is no terminal at all.
 */
async function askOnTerminal(question: string): Promise<string | null> {
  const { createReadStream } = await import("node:fs");
  let input: NodeJS.ReadableStream;
  try {
    input = process.stdin.isTTY && process.stdin.readable ? process.stdin : createReadStream("/dev/tty");
  } catch {
    return null;
  }
  const rl = createInterface({ input, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

function findOrFail(fileArg?: string): string {
  try {
    return findFile(fileArg);
  } catch (e) {
    return fail((e as Error).message);
  }
}

function fail(message: string): never {
  console.error(`ath: ${message}`);
  process.exit(1);
}

program.parse();
