# v0.1.0 Build Progress

Tracks the build order from `spec.md` §12. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | Zod schemas + JSON Schema + SPEC.md + fixture | ✅ done |
| 2 | `ath check` / `init` / `stats` | ✅ done |
| 3 | Importers: Apple Health export.zip (first, per D15), WHOOP CSV, Oura CSV | ➡️ moved to [v0.2.0](../v0.2.0/progress.md) |
| 4 | `ath context` / `log` / `record-prediction` / `grade` (incl. grading procedure §6) | ➡️ moved to [v0.3.0](../v0.3.0/progress.md), with `context` and `record-prediction` renamed to `predict` (D55) |
| 5 | The Skill (`skill/SKILL.md`, installed by `init`) | ➡️ moved to [v0.3.0](../v0.3.0/progress.md) |
| 6 | `ath backtest` + evals (incl. planted-contradiction test) | ⬜ |
| 7 | README + polish | ✅ README in; polish later |

State as of 2026-08-30: README in. 29 tests passing.

Steps 4 and 5 waited on the format changes in v0.2.0 and then on two more in v0.3.0, so they ship there. Step 6 is still tracked here, and the skill it measures now exists.

Step 3 grew past what this plan described. Building the importers showed that the format was dropping data it should keep: device-computed scores, beat-level HRV, and self-reported rows carried inside a device export. That is a format change, so it became its own version. The importers ship there: [`build-history/v0.2.0/`](../v0.2.0/spec.md).
