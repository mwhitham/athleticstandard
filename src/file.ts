/**
 * Finding, loading, and saving the athlete file.
 * The file is the database: one JSON document, local, no locks, no daemon.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { AthleticStandardFile, type AthleticStandardFileT } from "./schema.js";
import { validateAthleticStandardFile } from "./validate.js";

export const FILE_SUFFIX = ".ath.json";
export const DEFAULT_FILENAME = `athlete${FILE_SUFFIX}`;

/**
 * Resolve which file to operate on: an explicit --file path, or the single
 * *.ath.json in the current directory. Multiple candidates is an
 * error we refuse to guess about.
 */
export function findFile(explicitPath?: string, cwd = process.cwd()): string {
  if (explicitPath) {
    const p = resolve(cwd, explicitPath);
    if (!existsSync(p)) throw new Error(`file not found: ${p}`);
    return p;
  }
  const candidates = readdirSync(cwd).filter((f) => f.endsWith(FILE_SUFFIX));
  if (candidates.length === 0) {
    throw new Error(
      `no ${FILE_SUFFIX} file in ${cwd} — run \`ath init\` to create one, or pass --file`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `multiple athlete files in ${cwd} (${candidates.join(", ")}) — pass --file to choose`,
    );
  }
  return resolve(cwd, candidates[0]!);
}

/** Load without validating (callers that validate should use `check`-style flows). */
export function loadFileRaw(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Load and parse through the schema; throws with a readable message on failure.
 *
 * The message comes from the same explanation `ath check` gives, because a bare Zod
 * union failure says only "Invalid input" — which tells the reader nothing about a
 * file they are expected to be able to edit by hand.
 */
export function loadFile(path: string): AthleticStandardFileT {
  const raw = loadFileRaw(path);
  const parsed = AthleticStandardFile.safeParse(raw);
  if (!parsed.success) {
    const first = validateAthleticStandardFile(raw).issues.find((i) => i.severity === "error");
    throw new Error(
      `${path} is not a valid Athletic Standard file.\n` +
        `  ${first?.path ?? "root"}: ${first?.message ?? "unreadable"}\n` +
        `Run \`ath check\` for the full list.`,
    );
  }
  return parsed.data;
}

/** Stable field order + trailing newline, so files diff cleanly under git. */
export function saveFile(path: string, file: AthleticStandardFileT): void {
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}
