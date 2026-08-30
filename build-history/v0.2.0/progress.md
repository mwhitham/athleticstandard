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
| 8 | Real-export fixes: D32–D36 (running dynamics, unit refusal, beat continuity) | ✅ done |

State as of 2026-08-30: v0.2.0 complete. 110 tests passing, up from 29.

Bugs the build caught, worth remembering. The first two came from testing the code; the rest came from running real exports through it, which found things no synthetic fixture would have.

- Beat timestamps were being truncated to whole seconds, which collapsed beats falling inside the same second into one instant. That is the exact fidelity loss the sidecar design existed to prevent. Offsets are milliseconds now, and a test asserts the spacing survives a round trip.
- The "session end after start" rule rejected a series holding a single sample, where `end` equals `start` honestly. Sessions still require a real span; series do not.
- A three-year export printed one summary line per sidecar: 3,291 lines. Series are now summarized per quantity.
- **A real WHOOP export skipped all 1,305 of its rows.** `Cycle timezone` is written `UTC-07:00` and the parser accepted only the bare `-07:00`. The fixture had been written from published descriptions rather than a real file, so it encoded the same wrong guess as the parser and the tests passed. This is the lesson of the version: a fixture built on the same assumption as the code cannot falsify it. See D34.
- WHOOP also writes `UTCZ` around daylight-saving transitions, and leaves `Cycle end time` blank for the cycle in progress.
- **A real Apple export skipped 928,750 records as unmapped**, including all running dynamics. Fixed in D32, which also records why the remaining skips stay skipped.
- RMSSD was computed by accumulating each beat's reported rate and ignoring the timestamps, which cannot see a dropped beat. Since a gap makes two non-successive intervals look adjacent, every missed beat was being read as variability. See D35.

v0.1.0 steps 4–7 (`context` / `log` / `record-prediction` / `grade`, the Skill, `backtest`, polish) are still tracked in [v0.1.0/progress.md](../v0.1.0/progress.md).

Roadmap item this version deliberately did not build: a command reporting bias, spread, and overlap between two sources. The format keeps every reading with its source so the comparison stays possible, but the analysis waits until the prediction loop exists (D31).
