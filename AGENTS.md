# Agent Onboarding

Athletic Standard: an open, local-first file format (`.ath.json`) for a functional-fitness athlete's training and recovery state, designed for AI agents to reason over, plus a reference agent that proves the format works. Not an app, not a coach, not medical advice.

## Where the truth lives

Read these before making decisions — they are the project's memory and outrank anything you infer:

1. **`build-history/v1/spec.md`** — the approved build specification (architecture, file format, CLI surface, grading procedure, backtest design, build order in §12).
2. **`build-history/v1/decisions.md`** — every v1 decision with the alternatives that were rejected and why (D1 onward). Do not relitigate these without new information; if a decision is superseded, append a new D-number in this file. Don't rewrite earlier entries. Don't create addendum files.
3. **`build-history/v1/appendix/`** — the long-form studies that informed decisions (pressure test, connections). Linked from the D-number. Do not move the decision into the appendix, and do not trim the study down to the decision line.
4. **`build-history/v1/progress.md`** — what's done and what's next.
5. **`docs/connections.md`** — per-provider data research (what WHOOP/Oura/Garmin/Apple Health each provide via which path).
6. **`SPEC.md`** — the public field-level format reference. The Zod schemas in `src/schema.ts` are normative; the JSON Schema is generated from them.

## Hard rules

- **The two-tier wall:** device-measured (hard) and self-reported (soft) signals never mix. Hard signals require a `source` reference; soft signals structurally cannot claim one. Never weaken this.
- **`build-history/` is append-only.** New plans get a new version folder (`v2/`). Within a version, append new decisions to `decisions.md`. Supporting research goes in `appendix/` and is linked from the D-number. Don't rewrite earlier D-numbers or earlier version folders.
- **Schemas are the source of truth.** After changing `src/schema.ts`, run `pnpm generate:json-schema` and `pnpm generate:fixture` and commit the regenerated outputs.
- **Naming:** "Athletic Standard" in prose; `athleticstandard` for the npm package, file extension, and version field; `ath` is the CLI command; `AthleticStandard` in code identifiers.
- **Keep the repo impersonal:** no personal objectives, audience/positioning framing, or individual names in committed content.
- **Prose (D24):** write the rule, then the reason. Short sentences. Ordinary words. No slogans, no metaphor used as if it were the rule, no antithesis wordplay (*an* vs *the*, "X is the pipe, Y is the document", "never a data upgrade"). Don't use "vibes", "bet", "scoreboard", "on-ramp", or "doctrine" as stand-ins for the actual idea. Named principles are allowed when they name a real rule ("two-tier wall", "the file is the database", "not an app, not a coach, not medical advice") — after the name, state the rule in ordinary words in the same paragraph.
- **SDNN and RMSSD are different statistics** (`hrv_sdnn` vs `hrv_rmssd`); never combine them in one baseline.

## Verification

`pnpm typecheck && pnpm test && pnpm build` must pass before any commit. The fixture (`examples/demo-athlete/`) is deterministic — regenerate, don't hand-edit.

## Workflow

Feature branches off `main` (`main` is PR-only by ruleset). Commit each logical change separately. Update `build-history/v1/progress.md` when a build step completes.
