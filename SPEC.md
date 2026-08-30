# The Athletic Standard Format — Specification v0.2.0

**Status:** draft · **File extension:** `.ath.json` · **Schema:** [`schema/athleticstandard.schema.json`](schema/athleticstandard.schema.json) (JSON Schema draft 2020-12, generated from the Zod definitions in [`src/schema.ts`](src/schema.ts), which are normative)

Athletic Standard is an open, local-first file format for a functional-fitness athlete's training and recovery state over time, designed for AI agents to reason over.

## Design principles

1. **The file is the database.** One JSON document per athlete. No server, no DBMS, no accounts. The format must be fully usable with nothing but a text editor and an LLM.
2. **The two-tier wall.** Device-measured data (*hard signals*) and self-reported data (*soft signals*) never mix, and the separation is structural, not conventional: hard signals **must** carry provenance (a `source` reference); soft signals **cannot** (the field does not exist, and objects reject unknown keys). An agent reading the file always knows which numbers were measured and which were self-reported.
3. **Predictions live in the file.** An agent's predictions are written into the document before the attempt and graded after, so the file keeps a record of whether each prediction was right.
4. **Canonical units, no ambiguity.** Every measurement type has exactly one unit, adopted from [Open Wearables](https://github.com/the-momentum/open-wearables)' canonical table. There are no unitless `value` fields.
5. **Append-friendly, diff-friendly.** Arrays of timestamped records, stable field order, pure text. Photos live in a sibling `attachments/` folder and dense sample streams in a sibling `series/` folder, both referenced by filename and content hash; the document itself never embeds binary data or millions of samples.
6. **Readings from different devices are never merged.** Every measurement keeps the source that produced it, and baselines are computed per source. Two devices disagree by more than the change a prediction is trying to read, so averaging them would describe neither.

## Top-level structure

```json
{
  "athleticstandard_version": "0.2.0",
  "athlete": { },
  "sources": [ ],
  "hard_signals": [ ],
  "soft_signals": [ ],
  "benchmarks": [ ],
  "predictions": [ ]
}
```

| Field | Required | Description |
|---|---|---|
| `athleticstandard_version` | yes | Semver. See [Versioning](#versioning). |
| `athlete` | yes | Profile (all fields optional). |
| `sources` | yes | Provenance registry for hard signals. |
| `hard_signals` | yes | Tier 1: measured data. |
| `soft_signals` | yes | Tier 2: self-reported data. |
| `benchmarks` | yes | Benchmark definitions referenced by results and predictions. |
| `predictions` | yes | The graded prediction ledger. |

All timestamps are ISO 8601 with timezone (UTC `Z` or explicit offset — never naive local time). All dates are `YYYY-MM-DD`. All identifiers are lowercase alphanumeric with `-`/`_`.

### `athlete`

| Field | Type | Notes |
|---|---|---|
| `name` | string | optional |
| `birth_year` | integer | optional, 1900–2100 |
| `sex` | `male` \| `female` | optional; as relevant to performance modeling |
| `units` | `metric` \| `imperial` | **display preference only** — stored values are always canonical units |

## `sources`

Every hard signal references a source by id. This registry is what makes "measured" auditable.

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | id | unique within the file, e.g. `whoop-1` |
| `kind` | yes | `wearable` \| `export_file` \| `connector` \| `manual` | |
| `vendor` | no | string | `whoop`, `oura`, `apple`, `garmin`, … |
| `detail` | no | string | human-readable, e.g. `"WHOOP 4.0 via CSV export 2026-08-09"` |

**The `manual` kind** exists so a typed-in number ("my HRV was 54 this morning") can be stored as a measurement *without claiming device provenance*. Agents should weight `manual`-sourced hard signals below device-sourced ones. Writing a typed-in number under a device source is a spec violation.

## `hard_signals` — Tier 1, measured

Six record shapes. Every record has a `source` reference and an optional `note`.

### Point measurements

A single timestamped reading.

```json
{ "type": "hrv_rmssd", "value": 62, "unit": "ms",
  "recorded_at": "2026-08-09T06:12:00Z", "source": "whoop-1" }
```

| `type` | Canonical unit | Notes |
|---|---|---|
| `hrv_rmssd` | `ms` | |
| `hrv_sdnn` | `ms` | a different statistic from RMSSD; never share a baseline |
| `resting_heart_rate` | `bpm` | |
| `walking_heart_rate` | `bpm` | a walking average, not a resting value |
| `hr_recovery` | `bpm` | one-minute drop after effort |
| `body_weight` | `kg` | |
| `respiratory_rate` | `brpm` | |
| `vo2_max` | `ml/kg/min` | |
| `oxygen_saturation` | `%` | |
| `body_temperature` | `°C` | an actual body temperature |
| `skin_temperature` | `°C` | measured at the skin |
| `wrist_temperature_sleeping` | `°C` | overnight wrist measurement |
| `temperature_deviation` | `°C` | a signed delta from a vendor baseline |

The `unit` field is mandatory and must equal the canonical unit — it is redundant on purpose, so a record read in isolation is never ambiguous.

**Why four temperature types.** They are not interchangeable. Core temperature falls during sleep because the extremities warm and shed heat, so wrist temperature runs roughly an hour ahead of core and inverted, with a daily swing of about 6 °C. A wrist reading is a circadian marker, not a thermometer for the body. Averaging these together would cancel out the signal. `temperature_deviation` is a fourth thing again: a difference from a personal baseline, meaningless if read as a temperature.

`temperature_deviation` is the only point type whose value may be negative or zero. Every other reading is positive.

#### `derived` — values this tool computed

A point measurement may carry a `derived` block, meaning the value was computed here rather than reported by the device:

```json
{ "type": "hrv_rmssd", "value": 44.2, "unit": "ms",
  "recorded_at": "2026-08-09T06:12:00-07:00", "source": "apple-1",
  "derived": { "from": "hrv_beats", "method": "rmssd", "window_s": 61,
               "n_beats": 68, "n_dropped": 2 } }
```

| Field | Required | Notes |
|---|---|---|
| `from` | yes | series quantity the value was computed from |
| `method` | yes | computation applied, e.g. `rmssd` |
| `window_s` | no | length of the window used |
| `n_beats` | no | usable samples the value rests on |
| `n_dropped` | no | samples discarded as implausible |

The block records enough to reproduce or dispute the number. Absence of `derived` means the device reported the value. Agents should weight a derived value by the receipts it carries, and the validator requires the cited series to be present in the file for the same source and day.

### `series_ref` — dense samples in a sibling file

Heart rate all day, one sample per second inside a workout, and beat-to-beat intervals are streams rather than readings. Keeping them inline would add roughly 22 MB a year to a document measured at 0.43 MB, so they live in sibling files and the document holds a reference:

```json
{ "type": "series_ref", "quantity": "heart_rate", "unit": "bpm",
  "start": "2026-08-09T00:00:12-07:00", "end": "2026-08-09T23:59:41-07:00",
  "source": "apple-1",
  "file": "series/2026-08-09-heart_rate-apple-1.ath.series.json",
  "sha256": "…", "n": 4211,
  "summary": { "min": 47, "max": 178, "mean": 71.4 } }
```

| `quantity` | Canonical unit |
|---|---|
| `heart_rate` | `bpm` |
| `hrv_beats` | `ms` (beat-to-beat intervals) |
| `steps` | `count` |
| `active_energy` | `kcal` |
| `distance_walking_running` | `m` |
| `distance_cycling` | `m` |
| `distance_swimming` | `m` |

Distance is split by modality because a multi-sport athlete's disciplines are separate questions: a slow swim and a slow run are different problems, and one summed number cannot tell them apart.

The `summary` and `n` are receipts, so an agent can judge coverage without opening the sidecar. Nothing is averaged or downsampled — the sidecar holds every sample the source contained.

A sidecar is one quantity, one day, one source:

```json
{ "athleticstandard_version": "0.2.0", "quantity": "heart_rate", "unit": "bpm",
  "start": "2026-08-09T00:00:12-07:00", "source": "apple-1",
  "offsets_ms": [0, 300000], "values": [62, 64] }
```

`offsets_ms` and `values` are parallel arrays of equal length, offsets measured in milliseconds from `start`. Milliseconds rather than seconds because beat intervals are about 850 ms apart, and whole seconds would collapse beats sharing a second into one instant.

Validators must check that each referenced sidecar exists, that its hash matches, and that `n` agrees with its contents. A **missing** sidecar is a warning: the document has to stay usable when it travels alone. A **changed** sidecar is an error, because a file edited underneath its receipts is worse than one that is absent.

### `vendor_score` — device-computed composites

WHOOP recovery and strain, Oura readiness and sleep score. A device produced them, so they carry a source and belong to Tier 1, but they are not measurements: they are proprietary composites on per-vendor scales.

```json
{ "type": "vendor_score", "metric": "recovery", "value": 67, "scale": "0-100",
  "recorded_at": "2026-08-09T06:12:00-07:00", "source": "whoop-1" }
```

| Field | Required | Notes |
|---|---|---|
| `metric` | yes | vendor's name for the score, e.g. `recovery`, `strain`, `readiness` |
| `value` | yes | may be negative or zero |
| `scale` | yes | the range it is read against, e.g. `"0-100"` or `"0-21"` |

`scale` is mandatory for the same reason a soft-signal rating needs one: a bare 14 means nothing until you know WHOOP strain runs 0–21.

**A vendor score must not drive a predicted number on its own.** A tidy score is exactly what a model repeats instead of reading the data underneath. An agent may cite one as corroboration; the predicted number comes from measurements.

### `sleep_session`

A night of sleep as one record: `start`, `end`, `source`, and an `aggregates` object with optional `duration_s` (actual sleep), `time_in_bed_s`, `efficiency_pct` (0–100), `deep_s`, `rem_s`, `light_s`, `awake_s`, `interruptions`.

### `workout_session`

A training session: `start`, `end`, `source`, an `aggregates` object (optional `activity` label, `avg_hr_bpm`, `max_hr_bpm`, `energy_kcal`, `distance_m`), and optional `segments` — ordered, labeled sub-efforts, which is how run splits and HYROX station times are represented:

```json
"segments": [
  { "label": "km 1", "duration_s": 305, "distance_m": 1000 },
  { "label": "ski erg", "duration_s": 261 }
]
```

### `benchmark_result`

A scored attempt at a defined benchmark. A result is measured fact even when hand-entered — but then its `source` is `manual`, keeping the trust level visible.

```json
{ "type": "benchmark_result", "benchmark": "fran",
  "recorded_at": "2026-08-09T17:30:00Z", "source": "manual-1",
  "result": { "duration_s": 281 }, "scaling": "rx",
  "note": "unbroken thrusters first two rounds" }
```

`result` is a **score object**: at least one of `duration_s` (for time-scored benchmarks), `reps`, `weight_kg`. The key matching the benchmark's `score_type` is required (validated); extra keys are allowed. `scaling` is `rx` | `scaled`, optional.

## `soft_signals` — Tier 2, self-reported

```json
{ "type": "sleep_quality", "reported_at": "2026-08-09T07:00:00Z",
  "rating": 2, "scale": "1-5", "note": "neighbor's dog, maybe 5 hours",
  "provenance": { "via": "text" } }
```

| Field | Required | Notes |
|---|---|---|
| `type` | yes | `sleep_quality` \| `soreness` \| `stress` \| `mood` \| `energy` \| `nutrition` \| `note` |
| `reported_at` | yes | timestamp |
| `rating` | no | **requires `scale`** — a rating without a scale is meaningless and fails validation |
| `scale` | with rating | e.g. `"1-5"` |
| `body_region` | no | for `soreness`, e.g. `"quads"` |
| `note` | no | freeform |
| `provenance` | no | defaults to `{ "via": "text" }` |

**Provenance** records how the entry came to exist: `via` is `text` | `voice` | `photo`. Photo-derived entries (e.g. a meal photo interpreted by a vision model) **must** name the interpreting model in `interpreted_by` and may reference the image:

```json
"provenance": { "via": "photo", "interpreted_by": "claude-sonnet-4-5",
  "attachment": { "file": "2026-08-09-lunch.jpg", "sha256": "…" } }
```

The AI's *description* lives in `note` inside the file, so the document remains self-sufficient even if it travels without its attachments. AI-interpreted entries are one step further from ground truth than typed ones; agents should weigh them accordingly — but they are still Tier 2. Interpretation never promotes data to Tier 1.

### How an agent should use the two tiers

Hard signals drive predictions. Soft signals **adjust confidence and explain misses** — they may widen or narrow a stated range, and they supply candidate causes when a prediction is wrong, but the predicted number itself derives from measured data. This division is the format's core opinion.

Note that self-reported data sometimes arrives inside a device export. WHOOP's journal is the wearer's own answers about alcohol, caffeine, and similar. Those are soft signals with no `source`, because the tier follows who reported the number, not which file carried it.

## Multiple devices

An athlete may wear several devices that measure the same night. The format keeps them apart.

**Readings from different sources are never merged.** Every hard signal carries a `source`, and deduplication includes it, so three devices measuring one night produce three records. Two readings sharing a timestamp are not duplicates if they came from different devices.

**Baselines are computed per source and per type, never pooled.** This is already required between `hrv_sdnn` and `hrv_rmssd`, which are different statistics. It is equally required between two devices that both report RMSSD.

The reason is measured. Against an ECG reference across 536 nights, nocturnal HRV error was about 6% on an Oura Gen 4, 7% on an Oura Gen 3, 8% on a WHOOP 4.0, 10.5% on a Garmin Fenix 6, and 16% on a Polar Grit X Pro. An Apple Watch Series 9 and Ultra 2 underestimated HRV by 8.31 ms against a chest strap, about 29% error. Resting heart rate behaved differently: every device landed within roughly 1 bpm of ECG.

So resting heart rate is broadly comparable across devices and HRV is not. The disagreement between two devices is larger than the day-to-day change a prediction is reading, so pooling them would add more error than signal.

**Disagreement is preserved, not resolved.** The format never picks a winner and never averages. Both readings stay with their sources, so the difference between two devices on the same night remains recoverable — which keeps a useful question answerable: for this athlete, which device is worth trusting for which signal.

## `benchmarks`

| Field | Required | Notes |
|---|---|---|
| `id` | yes | unique, e.g. `fran` |
| `kind` | yes | `named_wod` \| `run` \| `hyrox` \| `lift` \| `custom` |
| `score_type` | yes | `time` \| `reps` \| `load` |
| `definition` | yes | human-readable, e.g. `"21-15-9 reps for time: thrusters 95/65 lb, pull-ups"` |
| `tags` | no | freeform, e.g. `["short", "high-power"]` |

Custom benchmarks are first-class: define your gym's quarterly test once, reference it forever.

## `predictions` — the ledger

Written by an agent **before** the attempt; graded after; append-only by convention (validators warn when history is mutated).

```json
{ "id": "pred-2026-08-09-fran", "benchmark": "fran",
  "created_at": "2026-08-09T15:00:00Z",
  "predicted": { "duration_s": 275 },
  "range": { "low": { "duration_s": 265 }, "high": { "duration_s": 290 } },
  "confidence": "moderate",
  "reasoning": "Last Fran 4:41 on 2026-06-02. HRV 61-66ms all week vs 63ms baseline. …",
  "evidence_window": { "from": "2026-06-01", "to": "2026-08-09" },
  "model": "claude-sonnet-4-5",
  "actual": null, "grade": null, "miss_analysis": null }
```

| Field | Required | Notes |
|---|---|---|
| `id`, `benchmark`, `created_at` | yes | |
| `predicted` | yes | score object matching the benchmark's `score_type` |
| `range` | no | stated uncertainty: `low`/`high` score objects. Grading tests whether the actual landed inside |
| `confidence` | yes | `low` \| `moderate` \| `high` |
| `reasoning` | yes | must cite specific dates and values, not vague trends |
| `evidence_window` | yes | the date range of data the prediction considered |
| `model` | yes | which model produced it |
| `actual` | after attempt | `{ result, recorded_at }` — must not precede `created_at` (validated) |
| `grade` | after grading | `{ signed_error, abs_error_pct, in_range }` — computed deterministically, never by the LLM |
| `miss_analysis` | on misses | see below |

### `miss_analysis`

Required semantics: every candidate cause references a signal that exists in the file; if nothing in the file explains the miss, `unexplained` must be `true` (validated: no causes + not unexplained = error).

```json
{ "direction": "slower", "severity": "significant",
  "candidate_causes": [
    { "signal": { "tier": "hard", "type": "sleep_session", "date": "2026-08-08" },
      "explanation": "5.1h sleep vs 7.4h baseline the night before" }
  ],
  "unexplained": false,
  "lesson": "poor sleep the night before cost ~8% on a short high-power benchmark" }
```

`severity`: `minor` (<5% error) | `significant` (5–15%) | `severe` (>15%). `direction`: `faster` | `slower` (time) or `higher` | `lower` (reps/load). `lesson` is one sentence written for the *next* prediction to read.

## Versioning

`athleticstandard_version` is semver. Within a major version:

- **Minor** versions may only **add optional fields** or enum values. A v0.1 reader can read a v0.2 file by ignoring unknown fields.
- **Patch** versions are clarifications only.
- Breaking changes (removing/renaming fields, changing units) require a major bump and a documented migration.

Validators should accept any file whose major version they support and warn on newer minors.

## Validation

Two layers, both required for a file to be conformant:

1. **Schema** (`schema/athleticstandard.schema.json`): shapes, types, enums, canonical units, strict objects (unknown keys rejected).
2. **Semantic rules** (reference implementation: `src/validate.ts`): source and benchmark references resolve; ids unique; session `end` after `start` (a `series_ref` may have `end` equal to `start`, since a single sample spans no time); score keys match `score_type`; ratings carry scales; vendor scores carry scales; photo provenance names its interpreter; a `derived` value cites a series present in the file for the same source and day; series units match their quantity; actuals don't precede predictions; grades require actuals; miss analyses require grades; empty cause lists must be marked unexplained.
3. **Sidecar checks** for any `series_ref`: the file exists, its hash matches, and `n` agrees with its contents. A missing sidecar is a warning; a changed one is an error.

## Appendix A — Prior art and mapping

The study behind the format. Athletic Standard deliberately reuses existing vocabulary where good vocabulary exists; its contributions are the two-tier wall, benchmarks, and the prediction ledger — none of which exist in any surveyed model.

### Open Wearables (primary anchor)

[Open Wearables](https://github.com/the-momentum/open-wearables) (MIT, self-hosted) normalizes multi-provider wearable data into a unified model: **Events** (sessions with start/end and aggregates), **Time Series** (timestamped point values), device/ID mapping, and canonical units (HRV in ms, HR in bpm, distance in meters, temperature in °C, timestamps UTC). Athletic Standard adopts this design directly:

| Open Wearables | Athletic Standard |
|---|---|
| Time Series sample (`heart_rate_variability_rmssd`, ms) | point measurement `hrv_rmssd` |
| Time Series sample (`resting_heart_rate`, bpm) | point measurement `resting_heart_rate` |
| Sleep event + aggregates | `sleep_session` |
| Workout event + aggregates | `workout_session` |
| ExternalDeviceMapping | `sources[]` |
| canonical-units table | canonical-units rule |

What OW has no concept of — and Athletic Standard adds: self-reported (soft) signals, benchmark definitions/results, the prediction ledger, and portability as a single file rather than a database+API. Open Wearables moves data between devices and a store. Athletic Standard is the file you keep.

### Apple HealthKit export

The de-facto consumer aggregation hub (both ChatGPT Health and Claude's connectors standardized on it in 2026). Its export is a monolithic XML of typed samples (`HKQuantityTypeIdentifierHeartRateVariabilitySDNN` etc.) with device metadata — provenance-rich but verbose. Athletic Standard's importer maps its sample types to point measurements, its category sleep records to `sleep_session`, and its dense samples to sidecar series.

Apple publishes HRV as SDNN only, but each SDNN record carries the beat readings it was computed from, so RMSSD is recoverable — see [Appendix B](#appendix-b--importer-mappings). Design lesson taken: per-sample source attribution, and shipping the raw beats alongside the summary. Design lesson rejected: 200-character type identifiers.

### Garmin FIT

Binary, compact, superb for high-frequency in-workout telemetry (per-second GPS/HR). Wrong layer for Athletic Standard: a FIT file is one activity's raw stream; Athletic Standard stores the *session-level* summary and segments, and can cite a FIT file as a source `detail`.

### WHOOP / Oura CSV exports

Flat daily-summary tables (recovery/sleep/strain per day). Trivially mappable to point measurements and sessions; they are Athletic Standard's v1 import path. Design lesson taken: a day-per-row summary is the granularity that recovery reasoning actually uses.

### Terra API

Commercial normalization layer with a well-designed JSON model across providers. Closed and subscription-based — the thing Athletic Standard must not depend on, but its schema choices corroborate the Events/samples split.

### Open mHealth

Pioneered open JSON schemas for mobile health data points (IEEE 1752); strong on units and provenance, clinical in orientation, no training/performance concepts, and per-datapoint schemas rather than a whole-athlete document. Athletic Standard follows its rigor on units, not its granularity.

## Appendix B — Importer mappings

What `ath import` reads from each export, and what it deliberately does not. Unknown identifiers and clinical records are counted as skipped rather than guessed at.

### Apple Health `export.xml`

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
| `SleepAnalysis` | clustered into `sleep_session` |
| `Workout` + `WorkoutEvent` laps | `workout_session` + `segments` |
| `HeartRate` | `heart_rate` series |
| `StepCount` | `steps` series |
| `ActiveEnergyBurned` | `active_energy` series |
| `DistanceWalkingRunning` / `Cycling` / `Swimming` | three separate distance series |

**Beat lists.** Each SDNN record carries a `HeartRateVariabilityMetadataList` of instantaneous beat readings, roughly 60 seconds of them. Those become an `hrv_beats` series plus a derived `hrv_rmssd`. Without this, an Apple Watch wearer has no statistic comparable to WHOOP or Oura, because Apple publishes SDNN only.

A 60-second window is enough for RMSSD: in athletes it agreed with the standard 5-minute measurement at ICC 0.98, and in 3,387 adults RMSSD from even a 10-second recording was a valid proxy (r = 0.86, rising to 0.94 averaged over three windows). SDNN needs longer windows and agrees worse at every length, which is why only RMSSD is derived.

Guard rails: at least 20 usable intervals and a 30-second window, intervals outside 300–2000 ms discarded as implausible and counted, and no derived value at all when too little survives. A weak number that looks like a measurement is worse than no number.

### WHOOP standard CSV export

| Column | Athletic Standard |
|---|---|
| `Heart rate variability (ms)` | `hrv_rmssd` |
| `Resting heart rate (bpm)` | `resting_heart_rate` |
| `Respiratory rate (rpm)` | `respiratory_rate` |
| `Skin temp (celsius)` | `skin_temperature` |
| `Blood oxygen %` | `oxygen_saturation` |
| sleep onset/wake + stage minutes | `sleep_session` (minutes → seconds) |
| workout rows | `workout_session` |
| `Recovery score %` | `vendor_score` `recovery`, scale `0-100` |
| `Day Strain` | `vendor_score` `strain`, scale `0-21` |
| `journal_entries.csv` | soft signals, no `source` |

Timestamps are local, with the offset in a `Cycle timezone` column. Journal questions map to existing soft types where the fit is honest, and anything else keeps its question text as a `note`.

### Oura CSV export

| Column | Athletic Standard |
|---|---|
| `average_hrv` | `hrv_rmssd` |
| `lowest_heart_rate` | `resting_heart_rate` |
| `average_breath` | `respiratory_rate` |
| `spo2_percentage` | `oxygen_saturation` |
| `vo2_max` | `vo2_max` |
| `temperature_deviation` | `temperature_deviation` |
| bedtime + stage durations | `sleep_session` (already seconds) |
| `readiness_score`, `sleep_score` | `vendor_score`, scale `0-100` |
| readiness contributors | `vendor_score` `readiness_contributor_*` |

**One trap worth naming.** Oura publishes a readiness contributor called "resting heart rate" that is a 0–100 sub-score, not a pulse. Reading it as a heart rate would put a number near 90 into a resting-HR baseline. The genuine figure is `lowest_heart_rate`.

## Appendix C — Non-goals

Athletic Standard is not an app, not a coach, and not medical advice. It does not model general health records (see FHIR), nutrition databases, or programming/workout *planning* — it represents state and evidence so that agents can reason about them.
