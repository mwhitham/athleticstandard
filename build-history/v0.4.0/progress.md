# v0.4.0 Build Progress

Tracks the build order from `spec.md`. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 0 | Version folder, version bump to 0.4.0, regenerated schema and fixture | ✅ done |
| 1 | Spec written and approved, decisions D72 onward recorded | ✅ D72–D78 recorded |
| 2 | `ath log`: one entry, round times, attach wording (D72–D74) | ✅ done |
| 3 | Gateway key in the OS password store, never in the athlete file (D75) | ✅ done |
| 4 | Bare `ath predict` calls a model; `--json` is evidence (D76, D78) | ✅ done |
| 5 | `ath backtest` ranks models, writes a report, not the athlete file (D77) | ✅ done |
| 6 | Docs, skill, evals. CI does not call a live gateway | ✅ done |

This version takes over v0.1.0 build step 6 (`ath backtest` and the evals), which [v0.1.0/progress.md](../v0.1.0/progress.md) tracked until now.
