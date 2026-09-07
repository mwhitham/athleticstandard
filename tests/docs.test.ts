import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATHLETIC_STANDARD_VERSION } from "../src/schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("the README shows ath log doing every kind of entry (D60)", () => {
  const readme = read("README.md");

  it("has an example of each kind", () => {
    for (const example of [
      "ath log slept badly, about 5 hours",
      "ath log sore quads 4/5",
      "ath log HRV 61 this morning",
      "ath log Fran in 4:41 rx",
      "ath log 2026-09-04",
    ]) {
      expect(readme, example).toContain(example);
    }
    expect(readme).toContain("245 TOTAL REPS");
  });

  it("shows the summary and the one question", () => {
    expect(readme).toContain("kind     workout result");
    expect(readme).toContain("Save this? [y] yes  [n] no");
  });

  it("sets a bare terminal against an agent, side by side", () => {
    expect(readme).toContain("| You type | A bare terminal writes | With an agent connected |");
    expect(readme).toContain("quads are wrecked");
    expect(readme).toContain("fran-dumbbell");
  });

  it("covers the prediction loop, now that it exists", () => {
    expect(readme).toContain("ath predict fran");
    expect(readme).toContain("ath grade fran --actual 4:32");
    expect(readme).not.toContain("isn't built yet");
  });
});

describe("SPEC.md keeps up with the schema", () => {
  const spec = read("SPEC.md");

  it("is written to the version the code is on", () => {
    expect(spec).toContain(`Specification v${ATHLETIC_STANDARD_VERSION}`);
    expect(spec).toContain(`"athleticstandard_version": "${ATHLETIC_STANDARD_VERSION}"`);
  });

  it("documents the two fields 0.3.0 added", () => {
    expect(spec).toContain(`"session": { "source": "whoop-1"`);
    expect(spec).toContain("device index");
    expect(spec).toMatch(/`from` and `to` \(calendar dates\) and `n`/);
  });
});
