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
import { ATHLETIC_STANDARD_VERSION, type AthleticStandardFileT } from "./schema.js";
import {
  validateAthleticStandardFile,
  type ValidationIssue,
  type ValidationResult,
} from "./validate.js";
import { findFile, loadFile, loadFileRaw, saveFile, DEFAULT_FILENAME } from "./file.js";
import { SEED_BENCHMARKS } from "./benchmarks.js";
import { renderStats } from "./stats.js";
import { checkSeriesRef } from "./series.js";
import { importExport, UnknownExportError } from "./import/index.js";
import { renderMergeSummary } from "./import/merge.js";

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
  .action(async (opts) => {
    const outPath = resolve(process.cwd(), opts.file);
    if (existsSync(outPath)) {
      fail(`${outPath} already exists — refusing to overwrite`);
    }

    let { name, birthYear, sex } = { name: opts.name, birthYear: opts.birthYear, sex: opts.sex };
    if (!opts.yes) {
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
    console.log(`created ${outPath}`);
    console.log(`  seeded ${SEED_BENCHMARKS.length} benchmarks: ${SEED_BENCHMARKS.map((b) => b.id).join(", ")}`);
    console.log(`  next: \`ath import <export-file>\` to load device data`);
  });

program
  .command("check")
  .description("validate a file against the schema and semantic rules")
  .argument("[file]", "path to the file (default: the one in this directory)")
  .action((fileArg) => {
    const path = findOrFail(fileArg);
    const result = validateAthleticStandardFile(loadFileRaw(path));
    const issues = [...result.issues, ...seriesIssues(path, result)];
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    for (const i of errors) console.error(`error  ${i.path}: ${i.message}`);
    for (const i of warnings) console.warn(`warn   ${i.path}: ${i.message}`);

    if (errors.length > 0) {
      console.error(`\n${path}: INVALID — ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exit(1);
    }
    console.log(
      `${path}: valid Athletic Standard ${ATHLETIC_STANDARD_VERSION} file` +
        (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
    );
  });

program
  .command("import")
  .description("load an Apple Health, WHOOP, or Oura export into the file")
  .argument("<path>", "the export: a zip, a folder, an export.xml, or a CSV")
  .option("--file <path>", "athlete file to import into (default: the one in this directory)")
  .action(async (exportPath: string, opts: { file?: string }) => {
    const athletePath = findOrFail(opts.file);
    let file: AthleticStandardFileT;
    try {
      file = loadFile(athletePath);
    } catch (e) {
      return fail((e as Error).message);
    }

    let result;
    try {
      result = await importExport(file, athletePath, resolve(process.cwd(), exportPath));
    } catch (e) {
      if (e instanceof UnknownExportError) return fail((e as Error).message);
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
    console.log(renderMergeSummary(result.summary, result.label));
  });

program
  .command("stats")
  .description("summarize the file: counts, date ranges, baselines")
  .argument("[file]", "path to the file (default: the one in this directory)")
  .action((fileArg) => {
    const path = findOrFail(fileArg);
    console.log(renderStats(loadFile(path)));
  });

/**
 * Verify every sidecar series the document points at (D25).
 *
 * A missing sidecar is a warning: the document must stay usable when it travels
 * without them. A hash or count mismatch is an error, because a file edited
 * underneath its receipts is worse than one that is simply absent.
 */
function seriesIssues(path: string, result: ValidationResult): ValidationIssue[] {
  if (!result.valid) return [];

  let file: AthleticStandardFileT;
  try {
    file = loadFile(path);
  } catch {
    return [];
  }

  const issues: ValidationIssue[] = [];
  file.hard_signals.forEach((sig, i) => {
    if (sig.type !== "series_ref") return;
    const at = `hard_signals.${i}`;
    const check = checkSeriesRef(path, sig);
    switch (check.status) {
      case "ok":
        break;
      case "missing":
        issues.push({
          severity: "warning",
          path: `${at}.file`,
          message: `sidecar not found: ${sig.file} — the document is still readable, but ${sig.n} samples are not here`,
        });
        break;
      case "hash_mismatch":
        issues.push({
          severity: "error",
          path: `${at}.sha256`,
          message: `${sig.file} does not match its recorded hash (${check.detail}) — it was changed after import`,
        });
        break;
      case "count_mismatch":
        issues.push({ severity: "error", path: `${at}.n`, message: `${sig.file}: ${check.detail}` });
        break;
      case "unreadable":
        issues.push({
          severity: "error",
          path: `${at}.file`,
          message: `${sig.file} could not be read as a series file: ${check.detail}`,
        });
        break;
    }
  });
  return issues;
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
