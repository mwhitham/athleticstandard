# Athletic Standard v0.2.0 — Decision Log

Decisions for the format revision, continuing the numbering from [v0.1.0](../v0.1.0/decisions.md) (D1–D24). The rejected alternatives are recorded because they are the part everyone forgets.

## D25. Dense series live in sidecar files, referenced with hashes and receipts

Heart rate all day, one sample per second inside a workout, and beat-to-beat intervals are streams, not readings. They have to be kept — series data carries information a daily average destroys — but they cannot sit in the document.

Measured, not estimated: the 14-month fixture is 0.43 MB. Adding these streams to it would cost roughly 22 MB per year, about 16 MB of that from workout heart rate at 1 Hz and about 4 MB from beat lists. A 50x file is no longer readable in a text editor, which is a stated principle (D4).

So each dense series is written to a sibling file, one per quantity per day per source, and the document holds a `series_ref` with the file path, a sha256, the sample count, and min/max/mean. Nothing is averaged or downsampled; the sidecar holds every sample the export contained. `ath check` verifies the hash and the receipts.

Offsets inside a sidecar are milliseconds. Whole seconds were the first draft and would have been a real loss: beat intervals are about 850 ms apart and Apple timestamps them to hundredths of a second.

Rejected alternatives:

- **Everything in one document.** Simplest, and one file to move. Rejected on the measured size: it breaks text-editor readability and makes every agent read tens of megabytes to answer a question about last night.
- **Averaging into daily summaries.** Small and tidy. Rejected because it destroys the fidelity that justified keeping the data — a mean heart rate cannot answer a question about intervals.
- **A size threshold, in-document until it grows.** Rejected as two code paths and unpredictable behavior: the same command produces a different layout depending on how much the athlete trained.
- **Binary or columnar formats (Parquet, protobuf).** Smaller and faster. Rejected because the format must stay readable with a text editor, and SPEC already says the document never embeds binary.

A missing sidecar is a warning, not an error, because a document that travels alone must still be usable. A hash mismatch is an error: a file edited underneath its receipts is worse than one that is absent.

## D26. Store Apple's beat series and compute RMSSD from it, marked as derived

Apple reports HRV only as SDNN. WHOOP and Oura report RMSSD. D22 forbids mixing them, which left Apple Watch wearers unable to compare with anything or to use the statistic the field prefers.

But Apple's export already carries the underlying data: every SDNN record has a `HeartRateVariabilityMetadataList` of instantaneous beat readings, roughly 60 seconds of them, timestamped to hundredths of a second. Those give beat-to-beat intervals, and RMSSD follows.

The evidence that a ~60 second window is enough:

- In collegiate athletes, RMSSD from a 60-second window agreed with the standard 5-minute measurement at ICC 0.98, with agreement falling as the window shortened toward 10 seconds (Esco and Flatt, 2014).
- In 3,387 adults, RMSSD from a single 10-second ECG was already a valid proxy for a 4–5 minute recording (r = 0.86), improving to r = 0.94 when three windows were averaged, and reaching near-perfect agreement by 120 seconds. RMSSD outperformed SDNN at every length (Munoz et al., 2015, PLOS One).
- HRV4Training has read Apple Watch beat intervals this way since iOS 13.

This does not weaken D22. A computed RMSSD is an RMSSD, not a relabelled SDNN, and it is never pooled with SDNN. It does introduce a value this tool produced rather than read, so it carries a `derived` block recording the source series, the method, the window, the beats used, and the beats discarded. That makes the number auditable and disputable instead of magic.

Guard rails, so a weak value is never published: at least 20 usable intervals, a window of at least 30 seconds, intervals outside 300–2000 ms discarded as implausible, and no derived point at all when too little survives.

Rejected alternatives:

- **Skip the beat lists, stay SDNN-only.** The first draft. Rejected as the single largest fidelity loss available: it discards the data and leaves Apple users with the weaker statistic.
- **Store the beats but never compute.** Safer, and leaves the choice to agents. Rejected because every agent would then reimplement the same arithmetic, differently, with no record of which guard rails it applied.
- **Write the derived value as an ordinary reading.** Rejected because a computed number that looks device-reported is a provenance lie, and provenance is what the two-tier wall protects.

Note the limit this does not fix: Apple Watch HRV underestimates a chest-strap reference by about 8.31 ms (roughly 29% error). A better statistic computed from the same sensor is still that sensor's data. This is a reason for per-source baselines (D31), not against deriving RMSSD.

## D27. Vendor scores are kept, in their own record type

WHOOP recovery and strain, Oura readiness and sleep score. The first draft dropped them for having no type.

That was wrong: an athlete paying for a device may reasonably want the number it shows them. But they are not raw measurements either — they are proprietary composites, computed from measurements we may or may not also have, on scales that differ per vendor and change without notice. And they are not self-reported, so the soft tier does not fit.

So they get a `vendor_score` record: a metric name, a value, a mandatory scale, a timestamp, and a source. The scale is mandatory for the same reason a soft-signal rating requires one — 14 means nothing until you know strain runs 0–21.

They are hard signals, because a device produced them and they carry provenance. But SPEC states plainly that they must not drive a predicted number on their own. D9 is the reason: a tidy score is exactly what a model repeats instead of reading the data underneath. A prediction may cite one as corroboration; the predicted number comes from measurements.

Rejected alternatives:

- **Drop them.** Rejected: it discards data the athlete owns and asked for.
- **Store them as point measurements.** Rejected: it would put a 0–100 composite into the same array as measured milliseconds, where a baseline could pick it up.
- **Store them as soft signals.** Rejected: they are not self-reported, and pretending otherwise would breach the two-tier wall from the other direction.
- **A fixed enum of metric names.** Rejected: vendors add scores whenever they like, and a schema change per marketing decision is not worth the strictness. `metric` is a free string; `scale` is not.

## D28. Temperature signals are typed by what was actually measured

The first draft mapped Apple's sleeping wrist temperature and a true body temperature to one `body_temperature` type. They are different signals, and combining them would cancel out the information.

Wrist and core temperature move in opposite directions. Core temperature falls to permit sleep, and it falls *because* the extremities warm and dump heat. Wrist temperature runs about 60 minutes ahead of core, inverted, with a daily swing of roughly 6 °C. A wrist reading is a circadian and vasodilation marker, not a thermometer for the body.

Apple compounds this by reporting its figure as a change from the wearer's own 5-night baseline rather than an absolute. Oura's `temperature_deviation` is a signed delta too.

Four types: `wrist_temperature_sleeping`, `body_temperature`, `skin_temperature` (WHOOP), and `temperature_deviation`. `temperature_deviation` is the only point type permitted to be negative or zero, because a delta of −0.3 °C is a normal value.

Rejected alternative: **one temperature type with a site label.** Tidier on the surface. Rejected because a shared type invites a shared baseline, and the whole problem is that these numbers must never be averaged together.

## D29. Distance is typed per modality

`distance_walking_running`, `distance_cycling`, `distance_swimming` — not one `distance`.

A multi-sport athlete's disciplines are separate questions. Summing a swim, a bike, and a run into one figure cannot answer why a race went badly, and this project exists to reason about named efforts and their parts. Apple already separates them at the source, so merging them would be work spent destroying information.

Rejected alternative: **one `distance` quantity with an activity field.** Rejected for the same reason as the temperature types: a shared type invites a shared total, and the sum is the thing nobody wants.

## D30. Self-reported rows inside a device export import as soft signals

WHOOP's `journal_entries.csv` holds the wearer's own answers: alcohol, caffeine, meditation, and similar. The first draft dropped the file for being self-report.

That inverted the rule. The two-tier wall is about who reported a number, not which file carried it. Self-report is exactly what the soft tier exists for, and a WHOOP journal answer is no different from the same answer typed to an agent.

So journal rows import as soft signals: no `source` field (structurally impossible for soft signals, per D2), `provenance: { via: "text" }`, and the original question text preserved verbatim in `note`. Questions map to existing soft types where the fit is honest — alcohol and caffeine to `nutrition`, stress and meditation to `stress`, sleep questions to `sleep_quality` — and everything else becomes `note` rather than being forced into a category.

Rejected alternatives:

- **Skip the file.** The first draft. Rejected: it throws away the only self-reported history most WHOOP wearers have.
- **Import them as hard signals because they came from a device export.** Rejected: it would breach the two-tier wall and let a self-reported yes/no gain device provenance.
- **Map every question onto a soft type.** Rejected: some questions have no honest mapping, and guessing one loses the question. Unmapped questions keep their text.

## D31. Readings from different devices are never merged; baselines are per source and type

An athlete may wear an Apple Watch daily, a WHOOP for recovery, and an Oura ring at night. All three measure the same night.

The deduplication key includes the source, so three devices produce three records. Two readings with the same timestamp from different sources are not duplicates. Baselines are computed per source and per type, never pooled.

D22 already required this between SDNN and RMSSD. The validation evidence requires it between two RMSSD devices as well. Against an ECG reference over 536 nights: Oura Gen 4 about 6% error, Oura Gen 3 about 7%, WHOOP 4.0 about 8%, Garmin Fenix 6 about 10.5%, Polar about 16% (Dial et al.). Apple Watch Series 9 and Ultra 2 underestimated HRV by 8.31 ms against a Polar H10 chest strap, about 29% error (O'Grady et al.). Resting heart rate behaved differently: every device landed within roughly 1 bpm of ECG.

So resting heart rate is broadly comparable across devices and HRV is not. The disagreement between two devices is larger than the day-to-day change a prediction is reading, so pooling them would add more error than signal.

Disagreement is kept rather than resolved. The format never picks a winner and never averages. Because both readings persist with their sources, the difference between two devices on the same night stays recoverable, which keeps a useful question answerable: for this athlete, which device is worth trusting for which signal.

Rejected alternatives:

- **Pick a preferred device per signal and drop the rest.** Rejected: it destroys the comparison and hard-codes a judgment that varies per person and per device generation.
- **Average across devices.** Rejected: averaging a 6% error device with a 29% error device produces a number that describes neither.
- **Merge same-timestamp readings as duplicates.** Rejected: it would silently discard whichever device imported second.

A command reporting bias, spread, and overlap between two sources is roadmap, not this version. The format guarantee lands now; the analysis waits until the prediction loop exists.

## D32. Import running dynamics, training load, gait, body composition, and blood pressure

Found by importing a real Apple Health export: 928,750 records were being skipped as unmapped, and the largest groups were not junk.

**Running dynamics are the important loss.** Apple records speed, power, stride length, vertical oscillation, and ground contact time stride by stride during outdoor runs on Series 6 and later. These are the measurements that separate a slow effort caused by poor recovery from one caused by form degrading late in the run, and the benchmark library already contains a 5k, a mile, and HYROX — which is mostly running between stations. Dropping them while keeping all-day step counts was the same error as D26.

Also imported:

- **Training load:** `physical_effort` (Apple's METs estimate), `basal_energy`, `exercise_time`, `flights_climbed`.
- **Gait:** `walking_speed`, `walking_step_length`, `walking_asymmetry_percentage`. Walking quality is a real signal for a trained athlete, and asymmetry is a plausible early sign of injury.
- **Circadian:** `time_in_daylight`, which feeds sleep timing.
- **Body composition:** `lean_body_mass`, `body_fat_percentage`, `height`.
- **Blood pressure:** `blood_pressure_systolic` and `blood_pressure_diastolic`.

Blood pressure needs its reason stated, because it sits closest to the "not medical advice" line. It is a cardiovascular measurement that bears on the load a session imposes and it is standard in athlete screening. That is different from a diagnostic finding.

Still skipped, and each for a reason rather than for want of a name:

- **Diagnostic findings** — atrial fibrillation burden, low heart rate events, walking steadiness. These are conclusions about disease, and holding them in the file invites exactly the medical interpretation the project disclaims.
- **Hearing health** — every audio exposure type. Nothing to do with training.
- **Derived or goal values** — body mass index (height and weight recomputed), sleep duration goal (something set, not measured).
- **Double support percentage, stand time, stair speeds, six-minute walk distance.** Designed as frailty and mobility measures; near-constant for a trained athlete, so they would add volume without a trend.

Rejected alternative: **import every HealthKit type and let the Skill ignore what it does not want.** Tempting, since it needs no judgment. Rejected because a type with no canonical unit and no meaning in this format cannot be validated, cannot be baselined, and would put clinical findings in a file that says it is not medical advice. Refusing to name a thing is honest; naming it wrongly is not.

## D33. An unrecognized unit is a reported skip, never an assumed conversion

Apple's unit strings vary with locale and with the wearer's display settings. The same identifier can arrive in miles or metres, Fahrenheit or Celsius, a fraction or a percentage.

Every converter therefore returns nothing when it does not recognise a unit, and the importer counts that as a skip naming the identifier and the unit it saw. It never falls back to treating the number as already canonical.

The reason is asymmetry of harm. A skipped row is visible and gets fixed. A mile stored as a metre looks like real data, passes validation, and quietly poisons a baseline. This is the same lesson as the WHOOP timezone bug in D34: guessing produced silence, refusing produces a report.

## D34. Skip reasons carry an example

A real WHOOP export skipped all 1,305 of its rows because `Cycle timezone` is written `UTC-07:00` and the parser accepted only the bare `-07:00`. The summary said 1,305 rows were skipped without saying what about them was unreadable, which took a round trip to diagnose.

Skip reasons now quote one example of the offending value, and the summary says plainly when every row failed that a column format has probably changed. Cheap to carry, and it turns a silent mismatch into a bug report.

The deeper lesson is about fixtures. That WHOOP fixture was written from published descriptions of the export rather than from an actual file, and it encoded the same wrong guess as the parser, so the tests passed. A fixture derived from the same assumption as the code under test cannot falsify it. Fixtures now use formats confirmed against real exports.

## D35. RMSSD skips pairs that straddle a missed beat

RMSSD is the root mean square of the difference between **successive** intervals. If a watch fails to detect a beat, the two intervals either side of the gap are not successive, and treating them as if they were invents a large difference. A dropped beat then reads as high variability, which is backwards: it would look like good recovery.

So beat continuity is checked from the timestamps the export attaches to every beat. Where the gap between two beats is more than 1.5 times the interval the later beat reports, the sequence is split and that pair contributes nothing. Intervals outside 300–2000 ms are discarded as implausible and counted.

The minimum window also drops from 30 seconds to 10, following the evidence in D26 rather than caution: RMSSD from a single 10-second recording was a valid proxy for the 4–5 minute standard in 3,387 adults (r = 0.86). Short windows are kept because every derived value carries its `window_s` and beat count, so a reader who wants only long windows can filter on the receipts. A reader given nothing has no choice at all.

Rejected alternative: **derive intervals by accumulating each beat's reported rate and ignore the timestamps.** This is what the first implementation did. Rejected because it cannot see a gap at all — the accumulated positions drift away from where the beats actually fell, and every dropped beat silently becomes variability.

## D36. Sidecar series stay one file per day

Considered switching to one file per quantity per month, because three years of Apple data across the D32 quantities means thousands of files in `series/`.

Kept per-day, for a reason that comes from how the data gets read rather than how it gets written. A prediction looks at roughly the last 30 to 90 days, not a year. Per-day files let a reader open exactly the days in the window; monthly files would force it to load a whole month to see two days of it, which wastes the context the evidence package is trying to conserve.

Rejected alternative: **monthly files.** Fewer files and a smaller directory, and re-importing one day rewriting one month is cheap. Rejected because it trades a real cost at read time for a cosmetic gain at write time, and reading happens far more often than importing.

## D37. Read Apple's ECG recordings for their beat timing, under a separate source

An Apple export carries a folder of ECG recordings: about 30 seconds each of single-lead waveform at roughly 511 Hz. Each one gives R-peak timing measured electrically, which is the reference standard for heart rate variability.

That matters because of the accuracy gap on the same wrist. The watch's optical sensor underestimates HRV by about 8.31 ms, roughly 29% error against a chest strap (O'Grady et al.). Its ECG does not have that problem. So a wearer's own recordings can say how far their own watch runs from the truth, for them, instead of leaving them to apply an average from a study of 39 strangers.

**The recordings get their own source.** `apple-ecg-1`, with a new optional `sensor` field on `sources[]`. Without this the two sets of readings would share `apple-1` and land in one baseline, which would average an accurate figure with an inaccurate one and destroy the comparison that justified reading them. D31 already forbids pooling across devices; the same reasoning applies with more force to two sensors of very different accuracy inside one device.

**Intervals are stored; the waveform and the diagnosis are not.** The intervals between beats are a performance measurement. The waveform, and the words "Atrial Fibrillation", are a clinical finding, and this format is not medical advice. The series quantity is `ecg_beats`, named apart from `hrv_beats` because optical and electrical beat detection are different measurements.

**The rhythm classification is read and then discarded.** It is used as a methodological gate: a recording that is not sinus rhythm is refused before any interval is computed. In atrial fibrillation the rhythm is irregularly irregular by definition, so RMSSD computed from it measures the arrhythmia rather than autonomic state, and letting it into a recovery baseline would be worse than having no reading. Reading the classification to exclude a recording is different from storing a diagnosis about the athlete.

Rejected alternatives:

- **Skip the folder as clinical.** The first instinct, and wrong for the same reason as D32: the waveform is clinical, but the beat timing derived from it is a performance measurement, and it is the most accurate one available.
- **Write ECG-derived RMSSD under the same source as the watch.** Rejected: it pools a reference measurement with a biased one and hides the discrepancy.
- **Store the waveform too, so the derivation can be redone later.** Tempting, and it would make a better R-peak detector retrospectively applicable. Rejected because the waveform is the clinical artifact, and the original export still exists if anyone wants to re-derive.
- **Store the rhythm classification alongside the reading.** Rejected: that is recording a diagnosis.

## D38. Turn workout routes into splits, and store no coordinates

An Apple export carries a GPX file per outdoor workout with a position and timestamp for every point. Alone, a route says where somebody went, which this format has no use for. Processed, it gives the thing a single finishing time cannot: how each kilometre compared with the last, and how much climbing was involved.

Splits fill `workout_session.segments`, which already existed for exactly this and was previously only populated when the wearer pressed the lap button. Climbing goes in a new optional `elevation_gain_m` on the workout aggregates.

Three details worth stating:

- **Raw coordinates are not stored.** A GPS track begins and ends at somebody's home. The format has no reason to hold that, and splits and elevation carry none of it.
- **Split boundaries are interpolated, not snapped.** Points arrive every second or so, and snapping each kilometre mark to the nearest point would put a second or two of error into every split.
- **Watch laps win over route splits.** A wearer who pressed the lap button divided the effort deliberately, and that division means more than an even kilometre.

Elevation gain ignores rises under a metre between points, because GPS altitude wobbles by several metres while standing still and summing every positive wobble turns a flat course into a mountain.

Rejected alternative: **store the track as a series so pace and elevation are available point by point.** Rejected on privacy — it is a map of where the athlete lives and trains — and because HealthKit already supplies `running_speed` as a series from the same runs (D32).

## D39. Auxiliary folders are found relative to the file, not just inside the archive

Someone who unzips their export and points at `export.xml` still has `electrocardiograms/` and `workout-routes/` sitting beside it. Looking only inside the given path would silently drop data that is right there, which is the failure mode this version keeps finding.

`DetectedExport` therefore carries an `auxRoot`: the archive for a zip, the folder itself for a folder, and the containing folder for a bare file.

## D40. One series record per quantity, not per day

D25 moved dense samples into sidecar files so the document would stay readable. It worked for the samples and then recreated the same problem with the references: a real Apple import produced 24,448 `series_ref` records and a 10.5 MB document, roughly 3 million tokens. No agent can read that at any context size, which breaks the format's first principle. Worse, it grew with the length of the history, so it got further out of reach every year.

One record now covers a whole quantity:

```json
{ "type": "series_ref", "quantity": "heart_rate", "source": "apple-1",
  "unit": "bpm", "from": "2023-06-01", "to": "2026-08-30",
  "days": 1120, "n": 410131, "sha256": "d7c1f30127…" }
```

Measured on the same 24,448 sidecars: 18 records, 4.9 KB, an 8 KB document. The size no longer depends on how much history exists.

Three fields went away and each for its own reason. `file` is derivable — a sidecar's name is fully determined by its day, quantity, and source, so storing 24,448 paths was storing the same rule 24,448 times. The per-day `summary` moved from stored to computed, which is why `ath series` had to ship in the same change rather than after it. `start` and `end` became `from` and `to`, calendar dates rather than instants, because coverage is measured in days.

`sha256` hashes each day's hash in date order rather than the concatenated contents. The day is hashed alongside its content hash, so moving a day's samples to a different date changes the result even though the bytes did not.

### Verification became one rule

Hash whatever is on disk for that quantity and compare it to the record. A missing day, an extra day, and an edited day all change the hash, all get the same message, and all have the same fix: import again, which rewrites the files and the record together.

The earlier design distinguished those cases. Dropping the distinction is the point, not a concession — knowing which of the three happened does not change what anyone would do about it, and the branching was where the complexity lived.

One exception remains, and it is the case D25 already cared about: no `series/` folder at all is reported once as "series data not present" and series checks are skipped. That is the document travelling without its sidecars, which it has to survive.

The cost is that `check` says "heart_rate doesn't match what was recorded" rather than naming the day. Acceptable because the remedy is identical either way, and it only arises when something changed a file without an import doing it.

### Rejected

- **Leave it.** Disqualified rather than merely inelegant. 3 million tokens cannot be read.
- **Monthly buckets.** 810 records and roughly 100k tokens. Better, but still most of a context window spent listing what exists, and still growing with history.
- **A separate `series/index.json`.** Works, and earns nothing. Sidecar filenames are already deterministic, so nothing needs an index to find a day, and it would add a second place that can drift from the document.
- **Storing the covered days as a list.** Would let `check` name exactly which day changed. Rejected at roughly 300 KB for 24,448 dates: a smaller version of the problem being fixed, bought for a distinction nobody acts on.

### Consequences in the code

Imports write sidecars before touching the document, because a coverage hash spans days from earlier imports and only the filesystem knows about those. And a derived value now cites coverage rather than a specific day, so [src/validate.ts](../../src/validate.ts) checks that the day falls inside the span — without that change every ECG-derived and beat-derived RMSSD would fail validation.

## D41. The skill surface is plural, and distribution is not ours to build

No `skill/` directory exists yet; `package.json` reserves the slot and [v0.1.0's spec](../v0.1.0/spec.md) plans a single `skill/SKILL.md` installed by `init` at build step 5.

Two things are settled now because they cost nothing before any skill exists and are awkward to retrofit afterwards:

- **`skill/` is a directory that `init` copies wholesale**, not a hardcoded path to one file. Nothing about the format wants exactly one skill, and discovering that later means changing an installer people already run.
- **Each skill states which format version it expects.** Trivial to add when there are no skills in the wild, annoying once there are.

**Not built:** an install command, a registry, or community distribution.

The mechanism already exists and is not ours. Agent hosts discover skills from their own folders, so anyone can write one today and nothing in this project stands in their way. Building a channel would add a step that the ecosystem already provides.

And there is a governance question that deserves its own decision rather than being settled by accident. This project is not a coach. Skills we ship, we control. A community skill saying "deload this week" is coaching, and building a distribution channel implies endorsement of whatever flows through it. That is a decision to make deliberately, if it is ever made.

Worth recording alongside: the pressure for sport-specific skills may resolve through benchmarks instead. Custom benchmarks are already first-class and user-extensible, while the reasoning procedure — predict before, grade after, explain the miss from recorded evidence — looks sport-agnostic. If that holds, a sport needs a benchmark definition rather than a skill.
