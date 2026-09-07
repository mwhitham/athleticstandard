import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATHLETIC_STANDARD_VERSION } from "../src/schema.js";
import { AGENT_DIRS, SKILL_NAME, skillSource } from "../src/skill.js";

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, "../src/cli.ts");
const TSX = resolve(here, "../node_modules/.bin/tsx");

function ath(args: string[], cwd: string): { stdout: string; code: number } {
  const res = spawnSync(TSX, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), code: res.status ?? 1 };
}

/** A working directory with the named agent folders already in it. */
function dirWithAgents(...agents: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ath-skill-"));
  for (const agent of agents) mkdirSync(join(dir, agent));
  return dir;
}

const skillFile = (dir: string, agent: string, file: string) =>
  join(dir, agent, "skills", SKILL_NAME, file);

describe("the skill", () => {
  it("names the format version it expects", () => {
    const text = readFileSync(join(skillSource(), "SKILL.md"), "utf8");
    expect(text).toContain(ATHLETIC_STANDARD_VERSION);
  });

  it("is one skill with its detail in sibling files, loaded when needed (D49)", () => {
    for (const file of ["SKILL.md", "format.md", "logging.md", "predicting.md", "grading.md"]) {
      expect(existsSync(join(skillSource(), file)), file).toBe(true);
    }
    const text = readFileSync(join(skillSource(), "SKILL.md"), "utf8");
    for (const file of ["format.md", "logging.md", "predicting.md", "grading.md"]) {
      expect(text, `SKILL.md should point at ${file}`).toContain(`(${file})`);
    }
  });

  it("carries the workout naming procedure and a reference list (D54)", () => {
    const text = readFileSync(join(skillSource(), "logging.md"), "utf8");
    expect(text).toContain("--benchmark");
    expect(text).toContain("near variation");
    expect(text).toMatch(/\bfran\b/);
    expect(text).toMatch(/\bmurph\b/);
    expect(text).toMatch(/hyrox/i);
  });

  it("leaves to the tools what the tools enforce (D46)", () => {
    const text = readFileSync(join(skillSource(), "SKILL.md"), "utf8");
    expect(text).toContain("What you do not need to hold, because the tools do");
    expect(text).toContain("never pooled");
  });
});

describe("ath init installs it", () => {
  it("copies the whole directory into every agent folder it finds", () => {
    const dir = dirWithAgents(".claude", ".cursor");
    const res = ath(["init", "-y"], dir);
    expect(res.code).toBe(0);
    for (const agent of [".claude", ".cursor"]) {
      expect(existsSync(skillFile(dir, agent, "SKILL.md")), agent).toBe(true);
      expect(existsSync(skillFile(dir, agent, "grading.md")), agent).toBe(true);
      expect(res.stdout).toContain(join(agent, "skills", SKILL_NAME));
    }
  });

  it("says where to find the skill when there is no agent folder", () => {
    const dir = dirWithAgents();
    const res = ath(["init", "-y"], dir);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("no agent folder here");
    for (const agent of AGENT_DIRS) expect(res.stdout).toContain(agent);
    expect(res.stdout).toContain(skillSource());
  });

  it("skips the install when asked to", () => {
    const dir = dirWithAgents(".cursor");
    const res = ath(["init", "-y", "--no-skill"], dir);
    expect(res.code).toBe(0);
    expect(existsSync(skillFile(dir, ".cursor", "SKILL.md"))).toBe(false);
    expect(res.stdout).not.toContain("no agent folder here");
  });

  it("reports what it installed under --json", () => {
    const dir = dirWithAgents(".claude");
    const res = ath(["init", "-y", "--json"], dir);
    const out = JSON.parse(res.stdout);
    expect(out.skill_installed).toEqual([join(dir, ".claude", "skills", SKILL_NAME)]);
  });
});
