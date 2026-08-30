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
import { validateAthleticStandardFile } from "./validate.js";
import { findFile, loadFile, loadFileRaw, saveFile, DEFAULT_FILENAME } from "./file.js";
import { SEED_BENCHMARKS } from "./benchmarks.js";
import { renderStats } from "./stats.js";

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
    const errors = result.issues.filter((i) => i.severity === "error");
    const warnings = result.issues.filter((i) => i.severity === "warning");

    for (const i of errors) console.error(`error  ${i.path}: ${i.message}`);
    for (const i of warnings) console.warn(`warn   ${i.path}: ${i.message}`);

    if (!result.valid) {
      console.error(`\n${path}: INVALID — ${errors.length} error(s), ${warnings.length} warning(s)`);
      process.exit(1);
    }
    console.log(
      `${path}: valid Athletic Standard ${ATHLETIC_STANDARD_VERSION} file` +
        (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
    );
  });

program
  .command("stats")
  .description("summarize the file: counts, date ranges, baselines")
  .argument("[file]", "path to the file (default: the one in this directory)")
  .action((fileArg) => {
    const path = findOrFail(fileArg);
    console.log(renderStats(loadFile(path)));
  });

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
