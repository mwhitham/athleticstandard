# v0.3.0 Build Progress

Tracks the build order from `spec.md` §9. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | This spec + decisions D46–D63 | ✅ done |
| 2 | Schema 0.3.0: session reference, device window and count, regenerated schema and fixture | ✅ done |
| 3 | Device index: accumulated at import, reported in `ath stats`, first appearances in the import summary | ✅ done |
| 4 | `src/coverage.ts` and `--json` on the existing commands | ✅ done |
| 5 | `ath log` | ✅ done |
| 6 | Session matching and `ath link` | ✅ done |
| 7 | `ath predict` | ✅ done |
| 8 | `ath grade` | ✅ done |
| 9 | Help rewrite and error messages | ✅ done |
| 10 | `skill/`, installed by `init` | ✅ done |
| 11 | SPEC.md, README, progress | ✅ done |

Three decisions were added while building, and are recorded in [decisions.md](decisions.md):

- **D61.** A prediction that stated no range cannot be a hit, and is graded on error alone.
- **D62.** The agent's miss analysis comes back through `ath grade --analysis`, and every cause it names is checked against the file.
- **D63.** The dossier's anomaly test compares a day's mean against the spread of daily means.

v0.1.0 step 6 (`backtest` and the evals) stays open and is tracked in [v0.1.0/progress.md](../v0.1.0/progress.md). The skill it measures now exists, so the work is unblocked.
