# Athletic Standard v0.3.0 — Build Specification

The prediction loop, and a tool that explains itself.

This plan completes [v0.1.0's spec](../v0.1.0/spec.md) build steps 4 and 5, which [v0.2.0](../v0.2.0/spec.md) left open. It renames two commands from v0.1.0 §3 and adds two fields to the format. Everything else in both earlier specs still stands.

## 0. Why this version exists

The file can now be created, filled from three vendors' exports, checked, summarized, and read back in detail. Nothing in it makes or grades a prediction, which is the thing the file exists for. A record of training and recovery that never commits to a claim about tomorrow cannot be shown to be right or wrong.

Building toward that surfaced four problems, each fixed here.

1. A benchmark result and the workout session it happened in are separate records that do not know about each other. The evidence for a prediction wants both. (D48)
2. A source lists the devices that wrote it with no dates and no counts, so a replaced watch leaves no visible seam. (D51, D52)
3. `ath stats` reports how many observations a number rests on and no other command does, so an agent reading anything else is guessing at completeness. (D46, D47)
4. `--help` lists flags without examples, and the two commands the prediction loop needed were called `context` and `record-prediction`. Nobody reaches for those names. (D50, D55)

The two-tier wall does not move. Device-measured and self-reported signals still never mix, and one new rule protects it: text typed by a person can only fail into the self-reported tier (D59).

## 1. What ships in this version

- `ath log`, the only command that writes, reading what a person types without requiring quotes.
- `ath predict`, the evidence a prediction rests on, replacing `context` and `record-prediction`.
- `ath grade`, the deterministic half of the grading procedure in [v0.1.0 §6](../v0.1.0/spec.md).
- `ath link`, for attaching a result to the session it happened in after the device data arrives.
- Schema 0.3.0: a session reference on a benchmark result, and a window and count on each device.
- A device index in `ath stats`, and first appearances named in the import summary.
- Coverage on every number every command prints, and `--json` on every command.
- Help written for someone who has never run the tool.
- One agent skill in `skill/`, installed by `ath init`.

## 2. Format changes

### 2.1 A benchmark result names its session

`BenchmarkResult` gains one optional field:

```ts
session: z
  .strictObject({ source: Id, start: Timestamp })
  .optional()
  .describe("The workout session this result was recorded during"),
```

A workout session is already uniquely identified by its source and its start time, which is the key the importers use when reconciling duplicates. Referencing it that way means the link survives a re-import unchanged and no importer has to invent an identifier. See D48.

`ath check` gains one rule: a `session` reference must resolve to a `workout_session` with that source and that start.

### 2.2 A device records its window and its count

`Device` gains three optional fields:

```ts
from: CalendarDate.optional().describe("First day this device was seen writing"),
to: CalendarDate.optional().describe("Last day this device was seen writing"),
n: z.number().int().nonnegative().optional().describe("Records written by this device"),
```

The names match what `series_ref` already uses for coverage. See D51.

Only the per-device numbers are stored. A source's own window and record count are computed at read time, because every hard signal names its source and every `series_ref` carries `from`, `to`, and `n`, so storing them would duplicate what the file already holds. The per-device numbers cannot be recovered from anything, because readings do not name devices.

### 2.3 Version

`athleticstandard_version` becomes `0.3.0`, and so does the npm package version. Both new fields are optional, so a 0.2.0 file loads unchanged and gains nothing until it is imported into again.

## 3. The commands

`ath log` writes. Everything else reads. That is the whole rule, and it exists so there is one write path to learn and one to test (D55).

### 3.1 `ath log`

Accepts four kinds of record: a measurement, a self-reported entry, a benchmark result, and a prediction. Validates against the schema and the semantic rules, appends, and echoes what it wrote. Refuses anything that would make the file invalid, the same way `ath import` already refuses.

Three ways to call it, none of which need quotes (D58):

```
ath log slept badly, about 5 hours     # a short entry, taken as written
ath log                                 # reads what is pasted, until Ctrl-D
ath log 2026-09-04                      # a leading ISO date, then the paste
```

A workout runs to several lines and often contains a `"` for a box height. A shell splits the first on newlines and breaks on the second before `ath` is reached, so reading the paste is the only way to accept one unquoted.

Agents pass structured JSON on stdin instead, which needs no parsing at all.

**One question, always.** The tool prints what it understood and asks once:

```
  kind     workout result
  date     2026-09-07  (today)
  score    245 reps
  name     2026-09-07  (no agent connected, so named after the day)
  session  17:25 to 17:48 on your watch
  workout  saved word for word

Save this? [y] yes  [n] no
```

A second candidate session adds a key to that question rather than asking again: `[y] yes  [n] no  [2] use the 19:02 one instead`.

Four rules govern a benchmark result:

- **No date means today.** The date is in the summary above the question, so a wrong day is visible before it is written.
- **The score is read from the text and shown before it is written.** Anything the parser cannot place is quoted back rather than dropped, which is D42's rule applied to typed input.
- **The workout text is kept word for word** as the benchmark's `definition`.
- **An unknown benchmark is created, not rejected.** Logging a workout nobody has done before is the normal case.

An ambiguous date is refused rather than resolved. `09-04-2026` is the 4th of September in the United States and the 9th of April in most of the world, so the tool names both readings and asks for `2026-09-04` (D56).

### 3.2 `ath predict <benchmark> [--as-of <date>]`

Prints the evidence a prediction rests on, and says plainly that turning it into a number needs an agent. `--as-of` truncates history to what was known on that day, which is what will make a backtest honest. An unknown benchmark is named as unknown, with the closest existing ones listed. The command never writes.

The evidence package follows [v0.1.0 §5](../v0.1.0/spec.md). Four parts:

1. Every prior result on this benchmark in full, plus results on benchmarks of the same kind.
2. The last 28 days of measurements as a day-by-day table, and every self-reported entry in the window verbatim. Actual rows, not summaries.
3. Long-range averages, each carrying its count, date range, and spread, per source and never pooled.
4. Past predictions on this benchmark with their grades and the lesson from each miss.

It reads through `readingsFor`, so a measurement is found whether the device wrote a nightly figure into the document or a night of samples into a sidecar (D43).

Gaps are named rather than left for the reader to notice: days with no data in the recent window, a benchmark with only one prior result, and two sources measuring the same quantity with different answers.

### 3.3 `ath link <benchmark-result> <session>`

Attaches a result to the session it happened in, or corrects a link. It exists because device data usually arrives days after the workout, so the match often cannot be made when the result is logged (D53).

A benchmark result with no `session` is itself the record of a match still waiting, so nothing extra is stored to remember it. After every import, `ath import` looks for unlinked results whose date now has a session and offers each match. Without a terminal it prints the candidates and the command that links them.

### 3.4 `ath grade <benchmark> --actual <score>`

Runs steps 1 and 2 of the grading procedure in [v0.1.0 §6](../v0.1.0/spec.md). Finds the most recent ungraded prediction for that benchmark, writes the actual result into it, logs a `benchmark_result`, and computes `signed_error`, `abs_error_pct`, and `in_range`.

Classification is unchanged from v0.1.0: inside the stated range is a hit, outside it is a minor miss under 5 percent, significant to 15 percent, and severe above that.

A hit prints one comparison line and stops. Analysing a hit invites a story told after the fact.

A miss prints the dossier the agent needs for step 3: every self-reported entry from the 72 hours before, the day-of measurements, and any reading in the last 7 days more than 1.5 standard deviations from that source's own baseline.

No open prediction means the result is logged as a normal benchmark result and grading stops.

## 4. Reading text without a model

The CLI has no model and is not getting one. That has held since D7, with `backtest` as the single exception.

From an agent, nothing is guessed. A `type` from the hard list is a measurement, a `type` from the soft list is self-reported, and `predicted` with `confidence` and no `type` is a prediction. The three shapes do not overlap.

From a person typing, the tool matches a word list of about forty terms, a body-region list, and patterns for numbers, ratings, units, and clock times. It reads `sore quads 4/5` correctly and reads `quads are wrecked` as a plain note.

What makes that safe is the direction of failure, not the rate of it (D59).

- Promotion into the measured tier needs an exact hit: a known measurement name, a number, a unit that fits, and everything else that measurement requires. `slept 5 hours` stays a note, because a `sleep_session` needs a start and an end and "5 hours" gives neither.
- A name that maps to several measurements is refused rather than picked. `temperature 36.8` names the four types D28 keeps apart and asks which was meant.
- Everything else becomes a note, with the text kept word for word.
- Landing in the wrong soft type costs almost nothing, because every self-reported entry is shown verbatim to whatever reads the file.
- Free text never becomes a prediction.

The kind is the first line of the summary. It is the line that decides which side of the two-tier wall the record lands on, so it is shown first and confirmed before anything is written (D57).

One sentence can produce several records. "Did Fran in 4:41, felt awful, slept about 5 hours" is a benchmark result and two self-reported entries. The summary lists all of them under the one question.

### 4.1 Naming a workout

A workout logged without a name still needs one, because the benchmark is how every later comparison finds it. Recognising that a paste is Fran, or a near variation of it, takes a model.

So the agent names it and passes the name to `ath log`. The skill carries that procedure and the reference list of known workouts, in a file it opens only when a workout needs naming.

Without an agent, the benchmark is named after its date. `2026-09-04` already satisfies the `Id` pattern. The name is a label, not a claim about what the workout was, and the definition holds the text word for word either way (D54).

## 5. Coverage, on every command

An agent that never reads the skill should still get data it cannot misread. Some of this already holds and the gap is that it holds only in places: units are converted at import, readings are never pooled across sources, `baselineFor` already returns a count, a window, and a spread, duplicates are already reconciled by type, timestamp, and source, and `SleepSession` already separates actual sleep from time in bed.

What this version adds (D47):

- `src/coverage.ts` renders one coverage record: the observation count, the date range, days present against days expected, the source, and the rule in words. Every command that prints a number prints it.
- `--json` on every command, carrying the same coverage fields as the text.
- Where a definition could be read two ways, the output names the one it used. Sleep prints as actual sleep, excluding time awake, rather than as a bare number.

## 6. Help

Today `--help` lists commands and flags with no examples, and bare `ath` prints the same list. Changes (D50):

- Commands grouped by what the reader is trying to do: set up, load data, read, and predict.
- Worked examples under every command's own `--help`, with real values rather than placeholders. `ath log --help` shows the whole shape at once — an entry, the summary it produces, and the question — because it is the command used most and the only one that reads what was typed (D60).
- Every option says when it would be used, not only what it is.
- Bare `ath` prints a short guide rather than the full list, and says something different depending on whether a file is present.
- Error messages name the remedy, the way the series mismatch error already does.

## 7. The skill

One directory, `skill/`, copied wholesale by `ath init` into whichever agent folder it finds. One skill rather than one per metric, until there is a real difference in how they are used (D49). It states the format version it expects, as [v0.2.0 §8](../v0.2.0/spec.md) settled.

`SKILL.md` stays short. It teaches an agent to check what measurements exist, where they came from, and how complete they are before analysing anything; to run `ath predict` and the reading commands, with examples; to keep recorded activity apart from actual activity and association apart from cause; and to trace every claim back to a row in the file and state what is missing.

Deeper material sits in sibling files the agent opens only when a question needs them: the format reference, the logging and naming procedure, the prediction procedure, and the grading procedure.

The skill carries no rule a tool can enforce. Units, choosing between sources, reconciling duplicates, and what counts as sleep all belong in a command, because a command that reconciles and reports how it did is stronger than an instruction an agent may not recall (D46).

## 8. Tests

- Telling the kinds apart: a scored paste becomes a workout result; `HRV 61 this morning` becomes a hand-typed measurement under the manual source; `sore quads 4/5` becomes a rated soreness entry; `quads are wrecked` becomes a plain note; `slept 5 hours` stays a note; `temperature 36.8` is refused with the four types named; free text never becomes a prediction; one sentence carrying a result and two feelings writes three records under one question; agent JSON dispatches on shape with no guessing.
- The direction of failure: no input without a measurement name or a score can produce a hard signal.
- `log`: refuses an invalid record; reads a paste from stdin unquoted; dates it today when no date is given; refuses `09-04-2026` naming both readings; creates a benchmark that does not exist; keeps the workout text word for word; writes nothing until the question is answered yes.
- Matching: the candidate session appears in the same summary rather than as a second question; a second candidate becomes an extra key; declining writes the result unlinked; an import that brings in a session offers the waiting match; `ath link` attaches it and corrects a wrong link.
- `predict`: the four sections; `--as-of` hides everything after the date; gaps are named; a one-result benchmark says so; an unknown benchmark says so; the command never modifies the file.
- `grade`: a hit, each of the three miss severities, no open prediction, and the dossier's contents.
- Coverage: every command's `--json` carries the count, the window, and the source.
- The device index: two devices under one writer name produce two entries with separate windows; importing the same export twice leaves the counts unchanged; a re-import widens a window rather than resetting it; a source whose export names no device still reports source-level coverage.
- Help: examples appear, and bare `ath` differs with and without a file present.
- The skill: `init` copies the directory, and `SKILL.md` names the format version.

## 9. Build order

`pnpm typecheck && pnpm test && pnpm build` passes at every commit.

1. This spec and decisions D46–D60.
2. Schema 0.3.0: the session reference, the device window and count, their validation rules, and the regenerated JSON Schema and fixture.
3. The device index: accumulated at import, reported in `ath stats`, first appearances named in the import summary.
4. `src/coverage.ts`, and `--json` on the existing commands.
5. `ath log`, including benchmark creation and the date rules.
6. Session matching, and `ath link`.
7. `ath predict`.
8. `ath grade`.
9. The help rewrite and the error message pass.
10. `skill/`, and `init` installing it.
11. `SPEC.md`, `README.md`, and progress.

## 10. Out of scope

`ath backtest` and the evals, including the planted-contradiction test, which measure a prompt that does not exist until the skill is written.

Tagging each individual reading with the device that wrote it. It would touch every signal type, the sidecar sample format, all three importers, and the fixture, and the tag would still be empty for the many Apple records that carry no device attribute and for everything from WHOOP and Oura.

Unchanged from [v0.1.0 §11](../v0.1.0/spec.md) and [v0.2.0 §9](../v0.2.0/spec.md): the Open Wearables connector, the hosted OAuth broker, an MCP server, Garmin FIT, multi-athlete files, encryption at rest, any web UI, the cross-source comparison command, and skill distribution.
