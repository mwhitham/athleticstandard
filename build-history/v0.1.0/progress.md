# v0.1.0 Build Progress

Tracks the build order from `spec.md` §12. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | Zod schemas + JSON Schema + SPEC.md + fixture | ✅ done |
| 2 | `ath check` / `init` / `stats` | ✅ done |
| 3 | Importers: Apple Health export.zip (first, per D15), WHOOP CSV, Oura CSV | ➡️ moved to [v0.2.0](../v0.2.0/progress.md) |
| 4 | `ath context` / `log` / `record-prediction` / `grade` (incl. grading procedure §6) | ⬜ |
| 5 | The Skill (`skill/SKILL.md`, installed by `init`) | ⬜ |
| 6 | `ath backtest` + evals (incl. planted-contradiction test) | ⬜ |
| 7 | README + polish | ✅ README in; polish later |

State as of 2026-08-30: README in. 29 tests passing.

Step 3 grew past what this plan described. Building the importers showed that the format was dropping data it should keep: device-computed scores, beat-level HRV, and self-reported rows carried inside a device export. That is a format change, so it became its own version. The importers ship there: [`build-history/v0.2.0/`](../v0.2.0/spec.md). Steps 4–7 are still tracked here.
