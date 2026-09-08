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
| 12 | Reading the whole loop back: the fixes below, D64–D71 | ✅ done |

Three decisions were added while building steps 1–11, and are recorded in [decisions.md](decisions.md):

- **D61.** A prediction that stated no range cannot be a hit, and is graded on error alone.
- **D62.** The agent's miss analysis comes back through `ath grade --analysis`, and every cause it names is checked against the file.
- **D63.** The dossier's anomaly test compares a day's mean against the spread of daily means.

## Step 12: reading the whole loop back

Once every piece existed, the loop was read end to end and eight things were found that no single step had been responsible for. They are decisions D64–D71.

| What was wrong | Fix |
|---|---|
| A graded prediction held a copy of the score and pointed at nothing. Correcting the result left the prediction claiming the old number. | `prediction.actual.recorded_at` is stated to reference the `benchmark_result`, and `ath check` verifies it (D64). |
| `ath grade` wrote straight to the file while `ath log` showed a summary and asked. | Grading is now `planGrade` then `applyGrade`, with the summary, the one question and the session offer in between (D65). |
| Predictions recorded the model and nothing else. | They record the agent and the version of `ath` too. `ath log` refuses a prediction with no agent named (D66). |
| Running `ath grade` twice made two results and said nothing. | A second result on a day that already has one is refused; `--again` records a real one; grading a result already logged grades it (D67). |
| `--yes` attached the result to the nearest of several sessions. | `--yes` attaches one candidate and leaves two or more alone (D68). |
| Two baseline functions, so `--as-of` changed the arithmetic as well as the data. | One function, taking the day to stop at (D69). |
| Vendor scores were in the dossier and the skill but not in the evidence package. | They appear in the day rows, in their own column, labelled (D70). |
| `ath predict` printed every result ever recorded. | The twenty most recent, with what was left out stated (D71). |

Two things were tidied at the same time, with no decision attached because neither changes behaviour: six helpers written two or three times across modules moved into `src/score.ts` and `src/signals.ts`, and the demo fixture gained a graded hit, a graded miss with an analysis, and one open prediction, so the file demonstrates the loop it exists to demonstrate.

v0.1.0 step 6 (`backtest` and the evals) stays open and is tracked in [v0.1.0/progress.md](../v0.1.0/progress.md). The skill it measures now exists, so the work is unblocked.
