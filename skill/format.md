# The format, in brief

The full field-level reference is `SPEC.md` in the package, and the JSON Schema in
`schema/`. This file is the part you need in the middle of a conversation.

## The shape of the file

```
athleticstandard_version   the format version this file is written to
athlete                    name, birth year, sex, display units — all optional
sources                    every device or app that wrote something
hard_signals               measured
soft_signals               self-reported
benchmarks                 workout definitions
predictions                the ledger: what was claimed, and how it turned out
```

## Sources

One source per writer, per route. A watch and a ring are two sources. The same watch
reaching the file through two different exports is also two sources, because the two
routes carry different data.

A source lists the physical devices seen writing under it, each with the days it
covered and how many records it wrote. That is how a replaced watch that kept its
name stays visible instead of disappearing into an eleven-year average.

## Measured signals (`hard_signals`)

Every one names a `source`. Every one is stored in a fixed unit, so a value never has
to be interpreted.

**Point measurements** — one timestamped number.

| Type | Unit |
|---|---|
| `hrv_rmssd`, `hrv_sdnn` | ms |
| `resting_heart_rate`, `walking_heart_rate`, `hr_recovery` | bpm |
| `respiratory_rate` | brpm |
| `oxygen_saturation`, `body_fat_percentage` | % |
| `body_weight`, `lean_body_mass` | kg |
| `height` | cm |
| `vo2_max` | ml/kg/min |
| `body_temperature`, `skin_temperature`, `wrist_temperature_sleeping`, `temperature_deviation` | °C |
| `blood_pressure_systolic`, `blood_pressure_diastolic` | mmHg |

The four temperature types are separate on purpose. Wrist and core temperature move
in opposite directions during sleep, so one baseline over both cancels the signal
out. Oura's deviation is a third thing again: a difference from that vendor's own
baseline, not a temperature.

RMSSD and SDNN are different statistics computed from the same beats. Never put them
in one baseline and never describe one as the other.

**`sleep_session`** — a night, with `duration_s` (actual sleep) and `time_in_bed_s`
held apart. When you quote a sleep number, say which one it is.

**`workout_session`** — a training session, with an activity label, heart rate
aggregates, and optional segments for splits or stations.

**`benchmark_result`** — a score on a benchmark. Optionally names the
`workout_session` it happened in, by that session's source and start time. Most
results have no session, because device data usually arrives days later. That is
normal, not an error.

**`series_ref`** — a dense sample stream that lives in files beside the document
rather than in it. A night of beat intervals is thousands of samples; keeping them
inline would make the document unreadable. Read them with `ath series <quantity>`.
The record carries the days covered and the sample count.

**`vendor_score`** — a number a vendor computed, not one a sensor measured. WHOOP
recovery and strain, Oura readiness and sleep score. These are proprietary composites
on per-vendor scales. They may corroborate a claim. They must not be the basis of a
predicted number.

## Self-reported signals (`soft_signals`)

Types: `sleep_quality`, `soreness`, `stress`, `mood`, `energy`, `nutrition`, `note`.

There is no `source` field, and the object is strict, so a self-reported entry cannot
claim device provenance even by mistake. A `rating` must come with its `scale`,
because 4 means nothing without knowing 4 out of what.

The subtype is a convenience for counting. Every entry keeps the athlete's words, and
that text is what you should read.

## Benchmarks

`id`, `kind` (`named_wod`, `run`, `hyrox`, `lift`, `custom`), `score_type` (`time`,
`reps`, `load`), and a `definition` in words. A result's score must carry the field
its benchmark is scored by: `duration_s`, `reps`, or `weight_kg`.

## Predictions

`predicted`, an optional `range`, a `confidence`, `reasoning` that cites dates and
values, the `evidence_window` it was made from, and the `model` that made it.

After grading it also holds `actual`, a `grade` (signed error, absolute error
percent, whether it landed in range), and on a miss, a `miss_analysis`.
