# v0.3.0 Build Progress

Tracks the build order from `spec.md` §9. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | This spec + decisions D46–D60 | ✅ done |
| 2 | Schema 0.3.0: session reference, device window and count, regenerated schema and fixture | ✅ done |
| 3 | Device index: accumulated at import, reported in `ath stats`, first appearances in the import summary | ✅ done |
| 4 | `src/coverage.ts` and `--json` on the existing commands | ✅ done |
| 5 | `ath log` | ✅ done |
| 6 | Session matching and `ath link` | ✅ done |
| 7 | `ath predict` | ✅ done |
| 8 | `ath grade` | ⬜ |
| 9 | Help rewrite and error messages | ⬜ |
| 10 | `skill/`, installed by `init` | ⬜ |
| 11 | SPEC.md, README, progress | ⬜ |

v0.1.0 step 6 (`backtest` and the evals) stays open and is tracked in [v0.1.0/progress.md](../v0.1.0/progress.md). It measures a prompt that does not exist until the skill in step 10 is written.
