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
