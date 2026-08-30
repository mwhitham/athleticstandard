# The Athletic Standard Format — Specification v0.1.0

**Status:** draft · **File extension:** `.ath.json` · **Schema:** [`schema/athleticstandard.schema.json`](schema/athleticstandard.schema.json) (JSON Schema draft 2020-12, generated from the Zod definitions in [`src/schema.ts`](src/schema.ts), which are normative)

Athletic Standard is an open, local-first file format for a functional-fitness athlete's training and recovery state over time, designed for AI agents to reason over.

## Design principles

1. **The file is the database.** One JSON document per athlete. No server, no DBMS, no accounts. The format must be fully usable with nothing but a text editor and an LLM.
2. **The two-tier wall.** Device-measured data (*hard signals*) and self-reported data (*soft signals*) never mix, and the separation is structural, not conventional: hard signals **must** carry provenance (a `source` reference); soft signals **cannot** (the field does not exist, and objects reject unknown keys). An agent reading the file always knows which numbers were measured and which were self-reported.
3. **Predictions live in the file.** An agent's predictions are written into the document before the attempt and graded after, so the file keeps a record of whether each prediction was right.
4. **Canonical units, no ambiguity.** Every measurement type has exactly one unit, adopted from [Open Wearables](https://github.com/the-momentum/open-wearables)' canonical table. There are no unitless `value` fields.
5. **Append-friendly, diff-friendly.** Arrays of timestamped records, stable field order, pure text. Photos live in a sibling `attachments/` folder, referenced by filename and content hash; the file itself never embeds binary data.

## Top-level structure

```json
{
  "athleticstandard_version": "0.1.0",
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

Four record shapes. Every record has a `source` reference and an optional `note`.

### Point measurements

A single timestamped reading.

```json
{ "type": "hrv_rmssd", "value": 62, "unit": "ms",
  "recorded_at": "2026-08-09T06:12:00Z", "source": "whoop-1" }
```

| `type` | Canonical unit |
|---|---|
| `hrv_rmssd` | `ms` |
| `hrv_sdnn` | `ms` |
| `resting_heart_rate` | `bpm` |
| `body_weight` | `kg` |
| `respiratory_rate` | `brpm` |

The `unit` field is mandatory and must equal the canonical unit — it is redundant on purpose, so a record read in isolation is never ambiguous.

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
2. **Semantic rules** (reference implementation: `src/validate.ts`): source and benchmark references resolve; ids unique; session `end` after `start`; score keys match `score_type`; ratings carry scales; photo provenance names its interpreter; actuals don't precede predictions; grades require actuals; miss analyses require grades; empty cause lists must be marked unexplained.

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

The de-facto consumer aggregation hub (both ChatGPT Health and Claude's connectors standardized on it in 2026). Its export is a monolithic XML of typed samples (`HKQuantityTypeIdentifierHeartRateVariabilitySDNN` etc.) with device metadata — provenance-rich but verbose, and its HRV is SDNN-only. Athletic Standard's importer maps its sample types to point measurements and its category sleep records to `sleep_session`. Design lesson taken: per-sample source attribution. Design lesson rejected: 200-character type identifiers.

### Garmin FIT

Binary, compact, superb for high-frequency in-workout telemetry (per-second GPS/HR). Wrong layer for Athletic Standard: a FIT file is one activity's raw stream; Athletic Standard stores the *session-level* summary and segments, and can cite a FIT file as a source `detail`.

### WHOOP / Oura CSV exports

Flat daily-summary tables (recovery/sleep/strain per day). Trivially mappable to point measurements and sessions; they are Athletic Standard's v1 import path. Design lesson taken: a day-per-row summary is the granularity that recovery reasoning actually uses.

### Terra API

Commercial normalization layer with a well-designed JSON model across providers. Closed and subscription-based — the thing Athletic Standard must not depend on, but its schema choices corroborate the Events/samples split.

### Open mHealth

Pioneered open JSON schemas for mobile health data points (IEEE 1752); strong on units and provenance, clinical in orientation, no training/performance concepts, and per-datapoint schemas rather than a whole-athlete document. Athletic Standard follows its rigor on units, not its granularity.

## Appendix B — Non-goals

Athletic Standard is not an app, not a coach, and not medical advice. It does not model general health records (see FHIR), nutrition databases, or programming/workout *planning* — it represents state and evidence so that agents can reason about them.
