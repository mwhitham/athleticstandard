---
name: athletic-standard
description: Read and write an athlete's Athletic Standard file (.ath.json) using the ath CLI. Use when someone logs a workout, a measurement, or how they feel; asks what their training and recovery data says; asks for a prediction on a benchmark; or reports a result that a prediction was made about.
---

# Athletic Standard

An Athletic Standard file is one JSON document holding one athlete's training and
recovery data. It sits on the athlete's own machine. `ath` is the command that reads
and writes it.

This skill expects format version **0.3.0**. `ath check` prints the version of the
file in front of you. A file on an older version still loads; a newer one may hold
fields described nowhere here, so say so rather than guessing at them.

Not an app, not a coach, not medical advice. Describe what the data shows and what it
does not. Do not prescribe training or diagnose anything.

## The one rule the format is built on

Measured signals and self-reported signals never mix. A measurement came off a device
and names the source that wrote it. A self-reported entry is what the athlete said,
and it structurally cannot name a device.

The consequence for you: a predicted number comes from measured signals. What the
athlete reported about themselves can widen or narrow your confidence and can explain
a result afterwards, but it does not move the number.

## Before you analyse anything, look at what is there

Run `ath stats`. It tells you which measurements exist, which device wrote each one,
over what days, and how many observations each average rests on. Read it every time
rather than working from an earlier run — the file changes underneath you.

Two things in that output decide what you can honestly say:

- **Sources.** Each app or device is its own source. Two of them measuring the same
  quantity give two answers and are never averaged together. If they disagree, say
  which one you used and by how much they differ.
- **Coverage.** Every number the tool prints carries the count it rests on, the days
  it covers, how many of those days actually have data, and the rule used. A mean
  over 90 nights and a mean over 4 look identical until you read that line.

## The commands

| Command | What it does |
|---|---|
| `ath stats` | what is in the file, per source, with coverage |
| `ath series <quantity>` | a sample stream back, one row per day or every sample |
| `ath check` | whether the file still obeys every rule of the format |
| `ath log` | the only command that writes |
| `ath link <result> <session>` | attach a result to the device session it happened in |
| `ath predict <benchmark>` | the evidence a prediction rests on |
| `ath grade <benchmark> --actual <score>` | score a prediction against what happened |

Every one takes `--json`, which is what you should use. Every one has examples under
`--help`.

## What you must hold, because no tool can

- **Recorded activity is not actual activity.** A day with no workout session recorded
  is a day with no recording. It may or may not have been a rest day. Say which you
  mean.
- **Association is not cause.** Two things moving together is a thing to notice, not a
  reason. When you name a cause, say what would have to be true for it to be one.
- **Every claim traces to a row.** Cite the date and the value. If you cannot point at
  the row, do not make the claim.
- **Name what is missing.** Gaps change an answer as much as the data does. `ath
  predict` names its own gaps; carry them into what you say.
- **A number the athlete typed is not a device reading.** `ath log` files it under the
  manual source. Never present it as if a device measured it.

## What you do not need to hold, because the tools do

Units are converted at import and stored canonically. Duplicate records are
reconciled by type, timestamp, and source. Averages are never pooled across sources.
Sleep is stored as actual sleep and as time in bed, separately, and every command
that prints one says which it printed. SDNN and RMSSD are separate measurements and
never share a baseline.

Do not re-implement any of that. If a command seems to be getting it wrong, that is a
bug in the command, not something to work around in prose.

## Open these when the question needs them

- [format.md](format.md) — the record types, their fields, and their units.
- [logging.md](logging.md) — how to turn what someone said into a record, and how to
  name a workout they did not name.
- [predicting.md](predicting.md) — how to read the evidence package and write a
  prediction worth grading.
- [grading.md](grading.md) — what to do with a hit, and what to do with a miss.
