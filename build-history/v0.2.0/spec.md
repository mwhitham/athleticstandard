# Athletic Standard v0.2.0 — Build Specification

The format revision that makes imports lossless, plus the three file-based importers.

This plan supersedes parts of [v0.1.0's spec](../v0.1.0/spec.md) §2 (the file format) and §8 (importers). Everything else in v0.1.0 still stands: the CLI surface, the grading procedure, the backtest design, and build steps 4–7.

## 0. Why this version exists

v0.1.0 §8 named four things to pull from Apple Health: HRV, resting heart rate, sleep, and workouts. Building the importer showed that list was being read as a limit rather than as the prediction-critical minimum. Everything else in an export was going to be dropped, including measurements the format already had types for.

Six things were being lost. Each is fixed here, and each has a decision number in [decisions.md](decisions.md).

1. Device-computed scores (WHOOP recovery and strain, Oura readiness) were dropped for having no type. They now have one. (D27)
2. Apple's beat-by-beat HRV data was dropped, which is the only route to an RMSSD for Apple Watch wearers. It is now stored and used. (D26)
3. Wrist temperature and body temperature were being written to one type. They are different signals. (D28)
4. Walking, cycling, and swimming distance were being written to one type. A multi-sport athlete needs them apart. (D29)
5. WHOOP journal entries were dropped as "self-report inside a device export", when self-report is exactly what the soft tier is for. (D30)
6. Dense data had nowhere to live that kept the file readable. It now has sidecar files. (D25)

The two-tier wall does not move. Device-measured and self-reported signals still never mix.

## 1. What ships in this version

- Schema v0.2.0: eight new point types, a `series_ref` record, a `vendor_score` record, and a `derived` field on point measurements.
- Sidecar series files for dense sample streams, with hash verification in `ath check`.
- RMSSD computed from beat intervals.
- `ath import` for Apple Health export.zip, WHOOP CSV, and Oura CSV.
- `ath stats` reporting baselines per source rather than pooled.

## 2. Format changes

### 2.1 New point measurement types

Canonical unit fixed per type, same rule as v0.1.0 — the `unit` field is mandatory and must equal the canonical unit.

| Type | Unit | Notes |
|---|---|---|
| `vo2_max` | `ml/kg/min` | |
| `hr_recovery` | `bpm` | one-minute drop after effort |
| `walking_heart_rate` | `bpm` | Apple's walking average; not a resting value |
| `oxygen_saturation` | `%` | |
| `body_temperature` | `°C` | an actual body temperature |
| `skin_temperature` | `°C` | measured at the skin, e.g. WHOOP |
| `wrist_temperature_sleeping` | `°C` | Apple's overnight wrist measurement |
| `temperature_deviation` | `°C` | a signed delta from a vendor's own baseline, not an absolute |

Unchanged: `hrv_rmssd`, `hrv_sdnn`, `resting_heart_rate`, `body_weight`, `respiratory_rate`.

Four temperature types rather than one, because they are not interchangeable. Core temperature falls during sleep while the wrist warms, and wrist temperature runs about an hour ahead of core with a daily swing of roughly 6 °C. Averaging them together would cancel out the signal. Oura's deviation is a fourth thing again: a difference from a personal baseline, which is meaningless if read as a temperature.

`temperature_deviation` is the one type whose value may be negative or zero. Every other point measurement stays positive.

### 2.2 `series_ref` — dense data in sidecar files

Some measurements arrive as streams: heart rate all day, one sample per second inside a workout, beat-to-beat intervals. Measured against the existing fixture, keeping those in the document would add roughly 22 MB per year to a 0.43 MB file. That breaks the principle that the file is readable with a text editor.

Dense series therefore live in sibling files, one per quantity per day, the same way photos already live in `attachments/`. Nothing is averaged or downsampled — the sidecar holds every sample the export contained.

```
my-training/
  athlete.ath.json
  series/
    2026-08-09-heart_rate-apple-1.ath.series.json
  attachments/
```

The document holds a reference with the receipts, so an agent can judge coverage without opening the sidecar:

```json
{ "type": "series_ref", "quantity": "heart_rate", "unit": "bpm",
  "start": "2026-08-09T00:00:12-07:00", "end": "2026-08-09T23:59:41-07:00",
  "source": "apple-1",
  "file": "series/2026-08-09-heart_rate-apple-1.ath.series.json",
  "sha256": "…", "n": 4211,
  "summary": { "min": 47, "max": 178, "mean": 71.4 } }
```

The sidecar is parallel arrays with offsets in milliseconds from `start`:

```json
{ "athleticstandard_version": "0.2.0", "quantity": "heart_rate", "unit": "bpm",
  "start": "2026-08-09T00:00:12-07:00", "source": "apple-1",
  "offsets_ms": [0, 300000], "values": [62, 64] }
```

Milliseconds, not seconds. Beat intervals are about 850 ms apart and Apple timestamps them to hundredths of a second; whole seconds would destroy the spacing that makes the data worth keeping.

Series quantities:

| Quantity | Unit |
|---|---|
| `heart_rate` | `bpm` |
| `hrv_beats` | `ms` (beat-to-beat intervals) |
| `steps` | `count` |
| `active_energy` | `kcal` |
| `distance_walking_running` | `m` |
| `distance_cycling` | `m` |
| `distance_swimming` | `m` |

Distance is split by modality because a triathlete's disciplines are separate questions. A slow swim and a slow run are different problems, and one summed number cannot tell them apart.

`ath check` verifies each referenced sidecar: the file exists, its hash matches, and `n` and the summary agree with its contents. A missing sidecar is a **warning**, not an error, because the document must stay useful when it travels alone. A hash mismatch is an **error** — a file that has been edited underneath its receipts is worse than a missing one.

### 2.3 `vendor_score` — device-computed composites

WHOOP recovery, WHOOP strain, Oura readiness, and Oura sleep score are not raw measurements. They are proprietary composites, computed by the vendor from measurements we may or may not also have. They are also not self-reported, so the soft tier is wrong for them.

They get their own record:

```json
{ "type": "vendor_score", "metric": "recovery", "value": 67, "scale": "0-100",
  "recorded_at": "2026-08-09T06:12:00-07:00", "source": "whoop-1" }
```

`scale` is mandatory. A bare 14 means nothing until you know WHOOP strain runs 0–21, and this is the same reason a soft-signal rating requires a scale.

`metric` is a free string so a vendor can add a score without a schema change. Known values in this version: `recovery`, `strain`, `readiness`, `sleep_score`, and Oura's readiness contributors.

Vendor scores are hard signals: they carry a `source` and they came from a device. But they must not drive a predicted number on their own. The v0.1.0 anti-over-indexing rule (D9) is the reason — a tidy score is exactly the kind of thing a model repeats instead of reading the underlying data. A prediction may cite a vendor score as corroboration; the number it predicts comes from measurements.

### 2.4 `derived` — values this tool computed

A point measurement may carry a `derived` block:

```json
{ "type": "hrv_rmssd", "value": 44.2, "unit": "ms",
  "recorded_at": "2026-08-09T06:12:00-07:00", "source": "apple-1",
  "derived": { "from": "hrv_beats", "method": "rmssd", "window_s": 61,
               "n_beats": 68, "n_dropped": 2 } }
```

A signal with `derived` was computed here, not reported by the device. The block records enough to reproduce or dispute the number: the series it came from, the method, the window length, how many beats were used, and how many were discarded as implausible.

`ath check` requires the referenced series quantity to be present in the file for the same source and day, so a derived value cannot cite evidence the file does not contain.

### 2.5 Version

`athleticstandard_version` becomes `0.2.0`. New optional fields and new members of a union or enum are a minor addition under the v0.1.0 versioning rule, so a v0.1.0 file is a valid v0.2.0 file and a v0.1.0 reader can ignore what it does not recognize.

## 3. Multiple devices

Someone may wear an Apple Watch daily, a WHOOP for recovery, and an Oura ring at night. All three measure the same night. The rules:

**Nothing is merged.** Every hard signal carries a `source`, and the deduplication key includes it. Three devices measuring one night produce three records. Two records with the same timestamp from different sources are not duplicates. Re-importing the same export twice adds nothing.

**Baselines are per source and per type.** A 90-day HRV baseline for WHOOP uses WHOOP readings only. v0.1.0 already required this between SDNN and RMSSD (D22). The validation research requires it between two RMSSD devices too.

Measured against ECG over 536 nights: Oura Gen 4 about 6% error, Oura Gen 3 about 7%, WHOOP 4.0 about 8%, Garmin Fenix 6 about 10.5%, Polar about 16%. Apple Watch Series 9 and Ultra 2 underestimated HRV by 8.31 ms, about 29% error, against a Polar H10 chest strap. Resting heart rate was different: every device landed within roughly 1 bpm of ECG.

So resting heart rate is broadly comparable across devices and HRV is not. The gap between two devices is larger than the day-to-day change a prediction is trying to read, so pooling them would add more error than signal.

**Disagreement is kept, not resolved.** The format never picks a winner and never averages. Both readings stay, each with its source, so the difference between two devices on the same night is recoverable later. That keeps the per-person question answerable: which device is more useful for which signal, for this athlete.

**What is not built here.** A command that reports bias, spread, and overlap count between two sources is roadmap, not this version. The format guarantee lands now; the analysis waits until the prediction loop works.

## 4. `ath import`

```
ath import <path> [--file <athlete-file>]
```

`<path>` may be a zip, a folder, an `export.xml`, or a single CSV. The format is detected; the user does not pass a vendor flag.

1. Parse into hard signals, soft signals, vendor scores, and series.
2. Upsert one `sources[]` entry (`kind: "export_file"`, `vendor: apple | whoop | oura`), reusing an existing matching source so a second import does not create a second id.
3. Write series sidecars beside the athlete file, with hashes and summaries.
4. Deduplicate. Points, sessions, and vendor scores key on `(type, timestamp, source)`, sessions using `start`. Series key on `(quantity, day, source)` and a later import **replaces** the day, so a fuller export wins. Soft signals key on `(type, reported_at, note)`.
5. Save and print a summary: counts added by type, series files written with sample counts, soft signals added, duplicates skipped, unknown rows skipped.

Unknown identifiers and clinical records are skipped with a count. That is a refusal to guess at a mapping, not a judgment that the data is unwanted. The file must pass validation after the merge.

## 5. Importers

### 5.1 Apple Health (first, per D15)

Accepts `export.zip` (containing `apple_health_export/export.xml` or `export.xml`), a folder, or a bare `export.xml`. Streamed with `sax`; the document is never held in memory. Timestamps arrive as `2026-08-09 06:12:00 -0700` and keep that offset.

Points:

| HealthKit identifier | Athletic Standard |
|---|---|
| `HeartRateVariabilitySDNN` | `hrv_sdnn` |
| `RestingHeartRate` | `resting_heart_rate` |
| `WalkingHeartRateAverage` | `walking_heart_rate` |
| `HeartRateRecoveryOneMinute` | `hr_recovery` |
| `RespiratoryRate` | `respiratory_rate` |
| `BodyMass` | `body_weight` (lb → kg) |
| `VO2Max` | `vo2_max` |
| `AppleSleepingWristTemperature` | `wrist_temperature_sleeping` |
| `BodyTemperature` | `body_temperature` |
| `OxygenSaturation` | `oxygen_saturation` (fraction → %) |

Beat series: each SDNN record carries a `HeartRateVariabilityMetadataList` of `InstantaneousBeatsPerMinute` entries. Those become an `hrv_beats` series of intervals in milliseconds, plus a derived `hrv_rmssd` point.

Guard rails, so a weak number is never published: at least 20 usable intervals and a window of at least 30 seconds, intervals outside 300–2000 ms dropped as implausible and counted in `n_dropped`, and no derived point at all when too little survives.

Sessions: `SleepAnalysis` records cluster into `sleep_session` — `InBed`, `AsleepCore`, `AsleepDeep`, `AsleepREM`, `Awake`, and the older undifferentiated `Asleep`. A gap of a few hours starts a new night. `Workout` becomes `workout_session`, with `WorkoutEvent` laps as `segments` and distance, energy, and average and maximum heart rate on the aggregates.

Series to sidecars: `HeartRate` → `heart_rate`, `StepCount` → `steps`, `ActiveEnergyBurned` → `active_energy`, `DistanceWalkingRunning` / `DistanceCycling` / `DistanceSwimming` → their own three quantities.

Skipped with a count: clinical and FHIR-shaped records (a standing non-goal), ECG voltage, audio exposure, and any unrecognized identifier.

### 5.2 WHOOP CSV

The standard dashboard export, as a zip or a folder: `physiological_cycles.csv`, `sleeps.csv`, `workouts.csv`, `journal_entries.csv`. Detected by `physiological_cycles.csv`. The older GDPR archive (a `Health/` folder, a different sleep schema) is rejected with a message naming the export we read, rather than guessed at.

Timestamps are local, with the offset in a `Cycle timezone` column.

Measurements from `physiological_cycles.csv`, recorded at wake:

| Column | Athletic Standard |
|---|---|
| `Heart rate variability (ms)` | `hrv_rmssd` |
| `Resting heart rate (bpm)` | `resting_heart_rate` |
| `Respiratory rate (rpm)` | `respiratory_rate` |
| `Skin temp (celsius)` | `skin_temperature` |
| `Blood oxygen %` | `oxygen_saturation` |

`sleeps.csv` becomes `sleep_session` (stage minutes → seconds). `workouts.csv` becomes `workout_session`.

Vendor scores: `Recovery score %` → `recovery` on `0-100`, `Day Strain` → `strain` on `0-21`.

`journal_entries.csv` becomes **soft signals**. These are the wearer's own yes/no answers about alcohol, caffeine, meditation and the like. They travelled inside a device export, but a device did not measure them, and the tier is decided by who reported the number. So they carry no `source`, they get `provenance: { via: "text" }`, and the question text is preserved verbatim in `note` so nothing is silently reinterpreted.

Questions map to existing soft types where the fit is honest — alcohol and caffeine to `nutrition`, stress and meditation to `stress`, sleep questions to `sleep_quality` — and anything else becomes `note`. Rows are keyed on `Cycle end time`, the wake date, which is how the other WHOOP files align.

### 5.3 Oura CSV

Accepts a Membership Hub zip of per-category CSVs, a folder, or a Trends daily CSV. Detected on columns such as `average_hrv`, `bedtime_start`, `total_sleep_duration`, `lowest_heart_rate`.

Measurements from sleep rows:

| Column | Athletic Standard |
|---|---|
| `average_hrv` | `hrv_rmssd` |
| `lowest_heart_rate` | `resting_heart_rate` |
| `average_breath` | `respiratory_rate` |
| `spo2_percentage` | `oxygen_saturation` |
| `vo2_max` | `vo2_max` |
| bedtime + stage durations (already seconds) | `sleep_session` |

`lowest_heart_rate` is the real bpm figure. Oura also publishes a readiness contributor called "resting heart rate" which is a 0–100 sub-score; reading that as a heart rate would put a number near 90 into a resting-HR baseline.

`temperature_deviation` imports as `temperature_deviation`, not as a body temperature, because it is a signed delta from Oura's own baseline.

Vendor scores: `readiness_score` → `readiness`, `sleep_score` → `sleep_score`, both `0-100`. Readiness contributors import as vendor scores too, named `readiness_contributor_*`, so they are kept without being mistaken for the measurements they are named after.

## 6. Tests

Fixtures live in `tests/fixtures/exports/` and are synthetic. No real health data.

- Apple: an `export.xml` with an HRV record including a beat list, resting heart rate, body mass, wrist temperature, steps, heart-rate samples, a clustered sleep night, a workout with a lap, and one clinical plus one unknown record that must land in the skipped count.
- WHOOP: the four CSVs with current dashboard headers, journal rows included.
- Oura: a sleep CSV and a readiness CSV.

Required cases: unit conversion and mapping per importer; RMSSD against a hand-computed value; guard rails (too few beats yields no derived point); millisecond offsets surviving a sidecar round trip; `ath check` catching a tampered sidecar and warning on a missing one; WHOOP journal rows landing in `soft_signals` with no `source`; vendor scores never appearing as point measurements; two sources covering one night producing two records and two separate baselines; re-import being a no-op; a later import replacing a day's series. CLI: zip detection, summary output, unknown format exiting non-zero.

## 7. Build order

1. This spec and its decisions.
2. Schema v0.2.0, regenerated JSON Schema and fixture, stats per source.
3. Sidecar series module, RMSSD module, `ath check` verification.
4. Shared detection and merge, `ath import`, Apple importer.
5. WHOOP importer.
6. Oura importer.
7. SPEC.md, README, connections, progress.

`pnpm typecheck && pnpm test && pnpm build` passes at every commit.

## 8. Out of scope

Unchanged from [v0.1.0 §11](../v0.1.0/spec.md): the Open Wearables connector, the hosted OAuth broker, an MCP server, Garmin FIT, multi-athlete files, encryption at rest, and any web UI. Added here: the cross-source comparison command (§3), which needs the prediction loop first.
