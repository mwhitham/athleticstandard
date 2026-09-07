/**
 * Installing the skill (D49, and D41 on the mechanism).
 *
 * `skill/` is a directory copied whole, not a path to one file. Agent hosts discover
 * skills from their own folders, so `ath init` looks for the folders that are here
 * and copies into each of them. It builds nothing of its own: distribution is the
 * host's job and this project is not building a channel for it.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder name the skill installs under, inside each host's skills directory. */
export const SKILL_NAME = "athletic-standard";

/** Agent folders this looks for. A host not listed here can point at `skill/` itself. */
export const AGENT_DIRS = [".claude", ".cursor", ".agents"] as const;

/**
 * Where the skill ships from.
 *
 * `skill/` sits beside `src/` in the repository and beside `dist/` in the published
 * package, so one step up from this module finds it either way.
 */
export function skillSource(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "skill");
}

/**
 * Copy the skill into every agent folder present in `cwd`.
 *
 * Returns the paths written, which is empty when no agent folder is there. That is
 * not a failure: plenty of people run the CLI without an agent, and `init` says
 * where the skill lives so it can be copied later.
 */
export function installSkill(cwd: string): string[] {
  const source = skillSource();
  if (!existsSync(source)) return [];

  const written: string[] = [];
  for (const agent of AGENT_DIRS) {
    if (!existsSync(join(cwd, agent))) continue;
    const destination = join(cwd, agent, "skills", SKILL_NAME);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    written.push(destination);
  }
  return written;
}
