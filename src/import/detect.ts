/**
 * Working out which export a path holds, so nobody has to pass a vendor flag.
 *
 * Detection reads structure, never guesses from a filename an athlete may have
 * renamed. An unrecognized export fails loudly instead of being parsed as
 * something it is not.
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { openZip, readZipEntry, zipEntryNames } from "./zip.js";

export type ExportFormat = "apple" | "whoop" | "oura";

export interface DetectedExport {
  format: ExportFormat;
  /** How the export was laid out, for the summary line. */
  container: "zip" | "directory" | "file";
  path: string;
}

const APPLE_XML_NAMES = ["export.xml", "apple_health_export/export.xml"];
const WHOOP_MARKER = "physiological_cycles.csv";
/** WHOOP's older privacy-portal archive, which has a different sleep schema. */
const WHOOP_GDPR_MARKER = "health/";

/** Column names that only appear in an Oura export. */
const OURA_MARKERS = [
  "average_hrv",
  "bedtime_start",
  "total_sleep_duration",
  "lowest_heart_rate",
  "readiness_score",
];

function isOuraHeader(header: string): boolean {
  const normalized = header.toLowerCase().replace(/\s+/g, "_");
  return OURA_MARKERS.some((m) => normalized.includes(m));
}

function firstLine(path: string): string {
  // Enough for a header row without reading a year of nights into memory.
  const buf = Buffer.alloc(8192);
  const fd = openSync(path, "r");
  try {
    const read = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read).toString("utf8").split(/\r?\n/)[0] ?? "";
  } finally {
    closeSync(fd);
  }
}

export class UnknownExportError extends Error {}

export async function detectExport(path: string): Promise<DetectedExport> {
  if (!existsSync(path)) throw new UnknownExportError(`no such file or directory: ${path}`);

  const stat = statSync(path);

  if (stat.isDirectory()) {
    const names = readdirSync(path).map((n) => n.toLowerCase());
    if (names.includes("export.xml")) return { format: "apple", container: "directory", path };
    if (names.includes("apple_health_export")) {
      return { format: "apple", container: "directory", path };
    }
    if (names.includes(WHOOP_MARKER)) return { format: "whoop", container: "directory", path };
    if (names.some((n) => n === "health")) {
      throw new UnknownExportError(whoopGdprMessage(path));
    }
    const csvs = readdirSync(path).filter((n) => n.toLowerCase().endsWith(".csv"));
    if (csvs.some((c) => isOuraHeader(firstLine(join(path, c))))) {
      return { format: "oura", container: "directory", path };
    }
    throw new UnknownExportError(
      `${path} does not look like an Apple Health, WHOOP, or Oura export. ` +
        `Expected export.xml, ${WHOOP_MARKER}, or Oura CSVs.`,
    );
  }

  const lower = path.toLowerCase();

  if (lower.endsWith(".zip")) {
    const zip = await openZip(path);
    const names = zipEntryNames(zip).map((n) => n.toLowerCase());
    if (names.some((n) => APPLE_XML_NAMES.some((a) => n.endsWith(a)))) {
      return { format: "apple", container: "zip", path };
    }
    if (names.some((n) => n.endsWith(WHOOP_MARKER))) {
      return { format: "whoop", container: "zip", path };
    }
    if (names.some((n) => n.includes(WHOOP_GDPR_MARKER) && n.endsWith("sleeps.csv"))) {
      throw new UnknownExportError(whoopGdprMessage(path));
    }
    for (const name of zipEntryNames(zip)) {
      if (!name.toLowerCase().endsWith(".csv")) continue;
      const content = await readZipEntry(path, name);
      if (isOuraHeader(content.split(/\r?\n/)[0] ?? "")) {
        return { format: "oura", container: "zip", path };
      }
    }
    throw new UnknownExportError(
      `${basename(path)} is a zip, but not one we recognize. Expected an Apple Health ` +
        `export.xml, WHOOP's ${WHOOP_MARKER}, or Oura CSVs inside it.`,
    );
  }

  if (lower.endsWith(".xml")) return { format: "apple", container: "file", path };

  if (lower.endsWith(".csv")) {
    const header = firstLine(path);
    if (isOuraHeader(header)) return { format: "oura", container: "file", path };
    if (/cycle start time|cycle timezone/i.test(header)) {
      // A single WHOOP CSV is readable, but the bundle carries sleep and workouts too.
      return { format: "whoop", container: "file", path };
    }
    throw new UnknownExportError(
      `${basename(path)} is a CSV we cannot place. Oura exports carry columns like ` +
        `average_hrv or bedtime_start; WHOOP exports carry "Cycle start time".`,
    );
  }

  throw new UnknownExportError(
    `${basename(path)} is not a supported export. Pass an Apple Health export.zip, ` +
      `a WHOOP CSV export, or an Oura CSV export.`,
  );
}

function whoopGdprMessage(path: string): string {
  return (
    `${basename(path)} looks like WHOOP's older privacy-portal archive, which stores sleep ` +
    `in a different shape. Use the export from the WHOOP app (More → Data Export); it contains ` +
    `${WHOOP_MARKER}.`
  );
}

/** Text of every CSV in an export, keyed by lowercase basename. */
export async function readCsvBundle(detected: DetectedExport): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  if (detected.container === "file") {
    out.set(basename(detected.path).toLowerCase(), readFileSync(detected.path, "utf8"));
    return out;
  }

  if (detected.container === "directory") {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.toLowerCase().endsWith(".csv")) {
          out.set(entry.name.toLowerCase(), readFileSync(full, "utf8"));
        }
      }
    };
    walk(detected.path);
    return out;
  }

  const zip = await openZip(detected.path);
  for (const name of zipEntryNames(zip)) {
    if (!name.toLowerCase().endsWith(".csv")) continue;
    out.set(basename(name).toLowerCase(), await readZipEntry(detected.path, name));
  }
  return out;
}
