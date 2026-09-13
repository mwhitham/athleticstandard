import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

/**
 * Health-shaped files are allowed only when their exact synthetic contents were
 * reviewed. A changed hash is a prompt for another review, not proof of origin.
 */
const approvedSyntheticFixtures = new Map<string, string>([
  [
    "examples/demo-athlete/athlete.ath.json",
    "0d223b8086d575fd327acac7e134efcae417e5c9f315411f93c859dd97e5cacf",
  ],
  [
    "tests/fixtures/exports/apple/export.xml",
    "01ac134b87a3f0e7793ab7831898d3e54fba062491f1b8c3c9a1d7a229788f44",
  ],
  [
    "tests/fixtures/exports/apple/electrocardiograms/ecg_2026-08-07.csv",
    "f87620e6816813d01e743c5476d823373556ea3c58523161cb4ebceb0a05e409",
  ],
  [
    "tests/fixtures/exports/apple/electrocardiograms/ecg_2026-08-09.csv",
    "32768721c3d8a1433f598b36370e9670ce6119fb3a53ee63c8cf73c7182e95a9",
  ],
  [
    "tests/fixtures/exports/apple/workout-routes/route_2026-08-09_7.00pm.gpx",
    "8033b604f2bdb46358a7541ad462c9b9d851f315df6f1d1024698800b53e3f52",
  ],
  [
    "tests/fixtures/exports/oura/oura_daily_readiness.csv",
    "f096e2cf7bd4cbea7fb9b9e181c8f55540632f7e0299501ed380e150fb6fbe42",
  ],
  [
    "tests/fixtures/exports/oura/oura_sleep.csv",
    "ed59f11d1bb995278882238e26eea72830a114be67d74b2d223f96c8bfe6fb1b",
  ],
  [
    "tests/fixtures/exports/whoop/journal_entries.csv",
    "db60258f8c69f115afe427fdc442e6c97c85b9cc96b3d086e5aabc52157701d9",
  ],
  [
    "tests/fixtures/exports/whoop/physiological_cycles.csv",
    "e5d0ea4de8c24ac4c9b7fd9795be62c038170f37f6b0c6be51b1ba367b8fb356",
  ],
  [
    "tests/fixtures/exports/whoop/sleeps.csv",
    "eb5825dea3f3c26bffb84281f4bac52daa410dd6dcba08cbd9a92442f531229c",
  ],
  [
    "tests/fixtures/exports/whoop/workouts.csv",
    "4cb6248df5443456996386a02325e0d21532d4251bfa5649c02ea0ca0d4c4ce1",
  ],
]);

const requiredIgnoreRules = [
  ".private-data/",
  "private-validation/",
  "validation-data/",
  "*.ath.json",
  "*.fit",
  "*.gpx",
  "*.xml",
  "*.zip",
  "*.csv",
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function isHealthDataFile(path: string): boolean {
  const lower = path.toLowerCase();
  const sensitiveEndings = [".ath.json", ".csv", ".fit", ".gpx", ".tcx", ".xml", ".zip"];
  if (sensitiveEndings.some((ending) => lower.endsWith(ending))) return true;

  const name = basename(lower);
  return (
    name.endsWith(".json") &&
    /(apple[-_ ]?health|athlete|export|garmin|healthkit|oura|whoop)/.test(name)
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const errors: string[] = [];
const tracked = new Set(trackedFiles());
const ignoreLines = new Set(
  readFileSync(".gitignore", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean),
);

for (const path of tracked) {
  if (isHealthDataFile(path) && !approvedSyntheticFixtures.has(path)) {
    errors.push(
      `${path}: health-data file is not on the synthetic-fixture allowlist. ` +
        "Remove it from Git. If it is invented test data, review it and add its exact path and hash.",
    );
  }
}

for (const [path, expectedHash] of approvedSyntheticFixtures) {
  if (!tracked.has(path)) {
    errors.push(`${path}: approved synthetic fixture is missing or is not tracked.`);
    continue;
  }

  const actualHash = sha256(path);
  if (actualHash !== expectedHash) {
    errors.push(
      `${path}: approved synthetic fixture changed (expected ${expectedHash}, got ${actualHash}). ` +
        "Confirm every value is invented, then update the reviewed hash.",
    );
  }

  if (!ignoreLines.has(`!${path}`)) {
    errors.push(`${path}: add an explicit !${path} exception to .gitignore.`);
  }
}

for (const rule of requiredIgnoreRules) {
  if (!ignoreLines.has(rule)) {
    errors.push(`.gitignore: required private-data rule is missing: ${rule}`);
  }
}

if (errors.length > 0) {
  console.error("Public-data check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  console.error("\nReal health exports belong in encrypted storage outside Git.");
  process.exitCode = 1;
} else {
  console.log(
    `Public-data check passed: ${approvedSyntheticFixtures.size} approved synthetic fixtures; no other health-data files tracked.`,
  );
}
