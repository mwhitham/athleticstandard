# Agent Onboarding

Athletic Standard: an open, local-first file format (`.athleticstandard.json`) for a functional-fitness athlete's training and recovery state, designed for AI agents to reason over, plus a reference agent that proves the format works. Not an app, not a coach, not medical advice.

## Where the truth lives

Read these before making decisions — they are the project's memory and outrank anything you infer:

1. **`build-history/v1/spec.md`** — the approved build specification (architecture, file format, CLI surface, grading procedure, backtest design, build order in §12).
2. **`build-history/v1/decisions.md` + addenda** — every decision with the alternatives that were rejected and why (D1–D22). Do not relitigate these without new information; if a decision changes, record it as a new addendum, never by editing history.
3. **`build-history/v1/progress.md`** — what's done and what's next.
4. **`docs/connections.md`** — per-provider data research (what WHOOP/Oura/Garmin/Apple Health each provide via which path).
5. **`SPEC.md`** — the public field-level format reference. The Zod schemas in `src/schema.ts` are normative; the JSON Schema is generated from them.

## Hard rules

- **The two-tier wall:** device-measured (hard) and self-reported (soft) signals never mix. Hard signals require a `source` reference; soft signals structurally cannot claim one. Never weaken this.
- **`build-history/` is append-only.** Every new plan's spec goes in a new versioned subfolder; existing entries are never rewritten.
- **Schemas are the source of truth.** After changing `src/schema.ts`, run `pnpm generate:json-schema` and `pnpm generate:fixture` and commit the regenerated outputs.
- **Naming:** "Athletic Standard" in prose; `athleticstandard` for the npm package, file extension, and version field; `ath` is the CLI command; `AthleticStandard` in code identifiers.
- **Keep the repo impersonal:** no personal objectives, audience/positioning framing, or individual names in committed content.
- **SDNN and RMSSD are different statistics** (`hrv_sdnn` vs `hrv_rmssd`); never combine them in one baseline.

## Verification

`pnpm typecheck && pnpm test && pnpm build` must pass before any commit. The fixture (`examples/demo-athlete/`) is deterministic — regenerate, don't hand-edit.

## Workflow

Feature branches off `main` (`main` is PR-only by ruleset). Commit each logical change separately. Update `build-history/v1/progress.md` when a build step completes.
