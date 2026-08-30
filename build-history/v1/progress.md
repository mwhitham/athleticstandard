# v1 Build Progress

Tracks the build order from `spec.md` §12. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | Zod schemas + JSON Schema + SPEC.md + fixture | ✅ done |
| 2 | `ath check` / `init` / `stats` | ✅ done |
| 3 | Importers: Apple Health export.zip (first, per D15), WHOOP CSV, Oura CSV | ⬜ next |
| 4 | `ath context` / `log` / `record-prediction` / `grade` (incl. grading procedure §6) | ⬜ |
| 5 | The Skill (`skill/SKILL.md`, installed by `init`) | ⬜ |
| 6 | `ath backtest` + evals (incl. planted-contradiction test) | ⬜ |
| 7 | README + polish | ✅ README in; polish later |

State as of 2026-08-29: 21 tests passing; CLI smoke-tested end to end (`init` → `check` → `stats` on both the fixture and a fresh file). All work on branch `cursor/athletic-standard-v1-b092`, PR #1.
