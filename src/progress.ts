/**
 * A one-line progress bar for long imports.
 *
 * An Apple Health export is gigabytes of XML and tens of thousands of sidecar
 * files, and a minute of silence reads as a hang. The bar names the step, shows
 * how far along it is, and clears itself when the step ends, so the summary that
 * follows is printed onto a clean line.
 *
 * It draws on stderr and only when stderr is a terminal. The summary stays on
 * stdout, tests capture nothing extra, and a piped run prints nothing it should
 * not. Everything that reports progress takes a `Progress` and is handed the
 * silent one by default.
 */

export interface Progress {
  /** Begin a step. `total` may be unknown, in which case only the count is shown. */
  start(label: string, total: number | undefined, unit?: "bytes" | "count"): void;
  /** Set how much of the current step is done, as an absolute figure. */
  update(done: number): void;
  /** Add to how much of the current step is done. */
  advance(n?: number): void;
  /** End the current step and clear the line. */
  finish(): void;
}

/** Reports nothing. The default everywhere. */
export const silentProgress: Progress = {
  start() {},
  update() {},
  advance() {},
  finish() {},
};

const BAR_WIDTH = 24;
const REDRAW_EVERY_MS = 80;

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** A bar that redraws in place on the given stream. */
export function terminalProgress(stream: NodeJS.WriteStream = process.stderr): Progress {
  let label = "";
  let total: number | undefined;
  let unit: "bytes" | "count" = "count";
  let done = 0;
  let active = false;
  let lastDrawn = 0;

  function render(force = false): void {
    if (!active) return;
    const now = Date.now();
    if (!force && now - lastDrawn < REDRAW_EVERY_MS) return;
    lastDrawn = now;

    const fmt = unit === "bytes" ? formatBytes : formatCount;
    let line: string;
    if (total && total > 0) {
      const ratio = Math.min(1, done / total);
      const filled = Math.round(ratio * BAR_WIDTH);
      const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
      const pct = `${Math.floor(ratio * 100)}%`.padStart(4);
      line = `${label.padEnd(24)} ${bar} ${pct}   ${fmt(done)} / ${fmt(total)}`;
    } else {
      line = `${label.padEnd(24)} ${fmt(done)}`;
    }

    // Some pseudo-terminals report a width of 0; treat anything unusable as 80.
    const width = stream.columns && stream.columns > 20 ? stream.columns : 80;
    if (line.length >= width) line = line.slice(0, Math.max(0, width - 1));
    stream.write(`\r\x1b[2K${line}`);
  }

  return {
    start(nextLabel, nextTotal, nextUnit = "count") {
      if (active) this.finish();
      label = nextLabel;
      total = nextTotal;
      unit = nextUnit;
      done = 0;
      active = true;
      lastDrawn = 0;
      render(true);
    },
    update(next) {
      done = next;
      render();
    },
    advance(n = 1) {
      done += n;
      render();
    },
    finish() {
      if (!active) return;
      active = false;
      stream.write("\r\x1b[2K");
    },
  };
}
