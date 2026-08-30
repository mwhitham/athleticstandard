/**
 * Reading entries out of a zip without inflating the whole archive.
 *
 * An Apple Health export.zip can be several gigabytes once expanded, and the file
 * we want is one entry inside it. `yauzl` gives a read stream per entry, so the
 * XML can be streamed straight into the parser.
 */
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export interface ZipIndex {
  path: string;
  entries: string[];
}

/** Read the central directory only: entry names, no decompression. */
export function openZip(path: string): Promise<ZipIndex> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`could not open ${path} as a zip`));
      const entries: string[] = [];
      zip.on("entry", (entry) => {
        entries.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolve({ path, entries }));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

export function zipEntryNames(zip: ZipIndex): string[] {
  return zip.entries;
}

/** A single entry as text. For entries small enough to hold in memory (CSVs). */
export function readZipEntry(zipPath: string, entryName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`could not open ${zipPath} as a zip`));
      let found = false;
      zip.on("entry", (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            return reject(streamErr ?? new Error(`could not read ${entryName}`));
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c: Buffer) => chunks.push(c));
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => {
        if (!found) reject(new Error(`${entryName} not found in ${zipPath}`));
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/**
 * A read stream for one entry, so a large XML never lands in memory whole.
 */
export function openZipEntryStream(zipPath: string, entryName: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error(`could not open ${zipPath} as a zip`));
      let found = false;
      zip.on("entry", (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            return reject(streamErr ?? new Error(`could not read ${entryName}`));
          }
          resolve(stream as unknown as Readable);
        });
      });
      zip.on("end", () => {
        if (!found) reject(new Error(`${entryName} not found in ${zipPath}`));
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/** Spill an entry to disk, for cases that need a seekable file. */
export async function extractZipEntry(
  zipPath: string,
  entryName: string,
  destination: string,
): Promise<void> {
  const stream = await openZipEntryStream(zipPath, entryName);
  await pipeline(stream, createWriteStream(destination));
}
