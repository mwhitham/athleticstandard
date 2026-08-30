/**
 * The import entry point: detect the export, parse it, fold it in.
 *
 * Each importer returns a payload rather than writing anything, so the merge rules
 * (source upsert, deduplication that always includes the device, series replacement)
 * live in one place and apply identically to every vendor.
 */
import type { AthleticStandardFileT } from "../schema.js";
import { writeSeriesFile } from "../series.js";
import {
  detectExport,
  isEcgEntry,
  listEntries,
  readCsvBundle,
  type DetectedExport,
} from "./detect.js";
import { importAppleHealth } from "./apple.js";
import { importWhoop } from "./whoop.js";
import { importOura } from "./oura.js";
import { mergePayload, upsertSource, type MergeSummary } from "./merge.js";

export { detectExport, UnknownExportError } from "./detect.js";

const VENDOR_LABELS: Record<DetectedExport["format"], string> = {
  apple: "Apple Health",
  whoop: "WHOOP",
  oura: "Oura",
};

export interface ImportResult {
  summary: MergeSummary;
  label: string;
}

/**
 * Import `exportPath` into `file`, writing sidecars beside `athleteFilePath`.
 * Mutates `file`; the caller saves it.
 */
export async function importExport(
  file: AthleticStandardFileT,
  athleteFilePath: string,
  exportPath: string,
): Promise<ImportResult> {
  const detected = await detectExport(exportPath);
  const label = `${VENDOR_LABELS[detected.format]} export`;

  // The source id has to exist before parsing, because every signal an importer
  // builds references it.
  const detail = `${VENDOR_LABELS[detected.format]} via ${detected.container === "zip" ? "zip export" : detected.container === "directory" ? "export folder" : "CSV export"}`;
  const sourceId = upsertSource(file, detected.format, detail);

  // An Apple export carrying ECG recordings gets a second source for them. The
  // electrical and optical sensors on one watch disagree substantially, so their
  // readings are kept apart (D37). Created only when recordings are actually present,
  // so a wearer who has never taken an ECG gets no empty source.
  let ecgSourceId: string | undefined;
  if (detected.format === "apple") {
    const entries = await listEntries(detected);
    if (entries.some(isEcgEntry)) {
      ecgSourceId = upsertSource(
        file,
        "apple",
        `${VENDOR_LABELS.apple} ECG recordings`,
        "ecg",
      );
    }
  }

  const payload =
    detected.format === "apple"
      ? await importAppleHealth(detected, sourceId, ecgSourceId)
      : detected.format === "whoop"
        ? importWhoop(await readCsvBundle(detected), sourceId)
        : importOura(await readCsvBundle(detected), sourceId);

  // One place owns how a source is described, so the three importers cannot drift
  // into three different phrasings for the same idea.
  payload.detail = detail;

  const summary = mergePayload(file, payload);
  for (const built of summary.seriesWritten) writeSeriesFile(athleteFilePath, built);

  return { summary, label };
}
