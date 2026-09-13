/**
 * `ath share` is not built. It names the latest backtest report so the person
 * knows where the later share payload lives (D77).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const REPORT = /^backtest-\d{4}-\d{2}-\d{2}T\d{6}\.json$/;

export function latestReport(athletePath: string, cwd = process.cwd()): string | undefined {
  const dirs = [dirname(athletePath), cwd];
  const seen = new Set<string>();
  const found: { path: string; mtime: number }[] = [];
  for (const dir of dirs) {
    if (seen.has(dir) || !existsSync(dir)) continue;
    seen.add(dir);
    for (const name of readdirSync(dir)) {
      if (!REPORT.test(name)) continue;
      const path = join(dir, name);
      found.push({ path, mtime: statSync(path).mtimeMs });
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0]?.path;
}

export function shareRefusal(reportPath?: string): string {
  if (!reportPath) {
    return [
      `ath share is not built yet.`,
      `Run \`ath backtest\` first. The shareable part of a report is its summary.`,
    ].join("\n");
  }
  return [
    `ath share is not built yet.`,
    `The shareable part of a backtest is the summary in:`,
    `  ${reportPath}`,
  ].join("\n");
}
