# v0.2.0 Build Progress

Tracks the build order from `spec.md` §7. Update when a step lands.

| Step | Deliverable | Status |
|---|---|---|
| 1 | This spec + decisions D25–D31 | ✅ done |
| 2 | Schema v0.2.0 + regenerated JSON Schema and fixture + stats per source | ✅ done |
| 3 | Sidecar series module, RMSSD module, `ath check` verification | ✅ done |
| 4 | Shared detect/merge, `ath import`, Apple Health importer | ✅ done |
| 5 | WHOOP importer (measurements, vendor scores, journal soft signals) | ✅ done |
| 6 | Oura importer | ✅ done |
| 7 | SPEC.md, README, connections, progress | ✅ done |

State as of 2026-08-30: v0.2.0 complete. 85 tests passing, up from 29.

Two bugs the build caught, worth remembering:

- Beat timestamps were being truncated to whole seconds, which collapsed beats falling inside the same second into one instant. That is the exact fidelity loss the sidecar design existed to prevent. Offsets are milliseconds now, and a test asserts the spacing survives a round trip.
- The "session end after start" rule rejected a series holding a single sample, where `end` equals `start` honestly. Sessions still require a real span; series do not.

v0.1.0 steps 4–7 (`context` / `log` / `record-prediction` / `grade`, the Skill, `backtest`, polish) are still tracked in [v0.1.0/progress.md](../v0.1.0/progress.md).

Roadmap item this version deliberately did not build: a command reporting bias, spread, and overlap between two sources. The format keeps every reading with its source so the comparison stays possible, but the analysis waits until the prediction loop exists (D31).
