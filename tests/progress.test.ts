import { describe, expect, it } from "vitest";
import { silentProgress, terminalProgress } from "../src/progress.js";

/** A stand-in for stderr that remembers what was written. */
function fakeStream(columns = 120) {
  const writes: string[] = [];
  const stream = {
    columns,
    write(chunk: string) {
      writes.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}

describe("progress bar", () => {
  it("draws the step, a bar, a percentage and the figures", () => {
    const { stream, writes } = fakeStream();
    const bar = terminalProgress(stream);
    bar.start("reading export.xml", 2_000_000_000, "bytes");
    expect(writes.at(-1)).toContain("reading export.xml");
    expect(writes.at(-1)).toContain("0%");
    expect(writes.at(-1)).toContain("0 B / 2.0 GB");
  });

  it("redraws in place rather than scrolling", () => {
    // Every write starts by returning to the column and clearing the line, so the
    // bar never leaves a trail behind it.
    const { stream, writes } = fakeStream();
    const bar = terminalProgress(stream);
    bar.start("writing series files", 10);
    for (const w of writes) expect(w.startsWith("\r\x1b[2K")).toBe(true);
    expect(writes.join("")).not.toContain("\n");
  });

  it("clears the line when a step finishes, so the summary starts clean", () => {
    const { stream, writes } = fakeStream();
    const bar = terminalProgress(stream);
    bar.start("writing series files", 10);
    bar.finish();
    expect(writes.at(-1)).toBe("\r\x1b[2K");
    // Finishing twice writes nothing more.
    bar.finish();
    expect(writes.at(-1)).toBe("\r\x1b[2K");
  });

  it("shows the count alone when the total is unknown", () => {
    const { stream, writes } = fakeStream();
    const bar = terminalProgress(stream);
    bar.start("reading", undefined);
    expect(writes.at(-1)).not.toContain("%");
    expect(writes.at(-1)).toContain("reading");
  });

  it("never draws past the terminal's width", () => {
    const { stream, writes } = fakeStream(40);
    const bar = terminalProgress(stream);
    bar.start("reading export.xml", 2_000_000_000, "bytes");
    const drawn = writes.at(-1)!.replace("\r\x1b[2K", "");
    expect(drawn.length).toBeLessThan(40);
  });

  it("still draws when the terminal reports no width", () => {
    // Some pseudo-terminals report 0 columns. That is not a request for nothing.
    const { stream, writes } = fakeStream(0);
    const bar = terminalProgress(stream);
    bar.start("reading export.xml", 100, "bytes");
    expect(writes.at(-1)).toContain("reading export.xml");
  });

  it("does nothing when silent", () => {
    silentProgress.start("x", 1);
    silentProgress.update(1);
    silentProgress.advance();
    silentProgress.finish();
  });
});
