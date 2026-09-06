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
| 9 | ECG-derived RMSSD and workout-route splits: D37–D39 | ✅ done |
| 10 | Grouped series coverage + `ath series`: D40. Skill surface: D41 | ✅ done |
| 11 | Locale-proof beat clocks: D42. Every source named in the import summary | ✅ done |
| 12 | Samples to sidecars, summaries in the document, one read interface: D43 | ✅ done |

State as of 2026-09-06: v0.2.0 complete. 189 tests passing, up from 29.

The last two additions came from looking at what else an export folder actually contains rather than at what the spec listed: the ECG recordings and the GPS routes were both sitting there unread. Both are now used, and both are deliberately reduced to the measurement rather than stored whole — beat intervals without the waveform, splits without the coordinates.

Bugs the build caught, worth remembering. The first two came from testing the code; the rest came from running real exports through it, which found things no synthetic fixture would have.

- Beat timestamps were being truncated to whole seconds, which collapsed beats falling inside the same second into one instant. That is the exact fidelity loss the sidecar design existed to prevent. Offsets are milliseconds now, and a test asserts the spacing survives a round trip.
- The "session end after start" rule rejected a series holding a single sample, where `end` equals `start` honestly. Sessions still require a real span; series do not.
- A three-year export printed one summary line per sidecar: 3,291 lines. Series are now summarized per quantity.
- **A real WHOOP export skipped all 1,305 of its rows.** `Cycle timezone` is written `UTC-07:00` and the parser accepted only the bare `-07:00`. The fixture had been written from published descriptions rather than a real file, so it encoded the same wrong guess as the parser and the tests passed. This is the lesson of the version: a fixture built on the same assumption as the code cannot falsify it. See D34.
- WHOOP also writes `UTCZ` around daylight-saving transitions, and leaves `Cycle end time` blank for the cycle in progress.
- **A real Apple export skipped 928,750 records as unmapped**, including all running dynamics. Fixed in D32, which also records why the remaining skips stay skipped.
- RMSSD was computed by accumulating each beat's reported rate and ignoring the timestamps, which cannot see a dropped beat. Since a gap makes two non-successive intervals look adjacent, every missed beat was being read as variability. See D35.
- Two ECG recordings yielded 2 beats where there should have been 35. The R-peak threshold was set as a fraction of the largest value in the recording, so a single motion artifact sat above every genuine beat. A percentile fixed it.
- **A real Apple export lost every beat in the file, and the import reported a clean run.** Apple writes each beat's time of day in the locale of the phone the export came from, and the parser accepted one spelling of it. Beats that failed to parse were dropped one at a time, which left the HRV window empty, and an empty window was discarded silently — so 12,554 HRV readings produced no RMSSD and no skip line. The worse half of the bug is the silence: nothing in the output could have shown it. See D42.
- **The document was still 9.1 MB after D40 fixed the references.** Measured, not estimated: 52,709 readings, three quarters of them respiratory rate, SDNN and blood oxygen sampled all night by one watch. D25 had said dense streams belong in sidecars; these three had been classified as single readings before anyone checked how often Apple writes them. Now 1.45 MB. The shape of the mistake: a rule can be right and still not be applied, and the check is to measure a real import rather than reason about the type list. See D43.
- **An import created a second source and never said so.** The ECG readings went under `apple-ecg-1`, correctly kept apart from the watch, but the summary named only `apple-1`. Every source an import writes under is now named.
- **The sidecar design solved the sample problem and recreated it with the references.** 24,448 per-day records made the document 10.5 MB, about 3 million tokens — unreadable, and growing every year. Grouped per quantity it is 8 KB. See D40. Worth remembering as a shape of mistake: moving a cost somewhere else is not the same as removing it, and the second version can look nothing like the first.

v0.1.0 steps 4–7 (`context` / `log` / `record-prediction` / `grade`, the Skill, `backtest`, polish) are still tracked in [v0.1.0/progress.md](../v0.1.0/progress.md).

Roadmap item this version deliberately did not build: a command reporting bias, spread, and overlap between two sources. The format keeps every reading with its source so the comparison stays possible, but the analysis waits until the prediction loop exists (D31).
