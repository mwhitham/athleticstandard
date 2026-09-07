# Athletic Standard v0.3.0 — Decision Log

Decisions for the prediction loop, continuing the numbering from [v0.1.0](../v0.1.0/decisions.md) (D1–D24) and [v0.2.0](../v0.2.0/decisions.md) (D25–D45). The rejected alternatives are recorded because they are the part everyone forgets.

## D46. Correctness lives in the tools; the skill teaches an agent how to ask

A skill saying "do not double-count" is weaker than a command that reconciles the records and reports how it did. The instruction depends on an agent recalling it at the right moment. The command holds whether or not anything read the skill.

So the split is by whether a rule can be enforced. Units, choosing between two sources, reconciling duplicates, and what counts as sleep rather than time in bed all live in the tools. The skill teaches an agent to check what exists before analysing it, to reach for the right command, to keep association apart from cause, and to trace a claim back to a row.

The test this has to pass: an agent with no skill still gets data it cannot misread, and an agent with the skill reaches a useful answer faster. If the skill is doing work the tool could do, the work is in the wrong place.

Rejected alternatives:

- **Put the rules in the skill, where they are easier to change.** Rejected because the rules that matter are the ones an agent must not forget under pressure, and prose is the weakest place to keep those.
- **Write one skill per metric, each carrying its own rules.** Rejected in D49 on other grounds, and here too: the same rule restated in five files drifts into five rules.

## D47. Every number carries its coverage and the rule that produced it

A mean with no count behind it cannot be argued with. `baselineFor` already returns the count, the date range, and the spread, and `ath stats` already prints them, but no other command does — so a reader outside `stats` has a number with no idea whether it rests on 90 nights or four.

Every command that prints a number now prints the observation count, the date range covered, days present against days expected, which source it came from, and the rule in words. Every command also gains `--json` carrying the same fields, because an agent reading anything other than `ath series` was parsing prose.

Naming the rule matters as much as the count. A sleep figure prints as actual sleep excluding time awake, because the schema holds both that and time in bed, and a reader cannot tell which one a bare number is.

Rejected alternatives:

- **A separate `ath coverage` command.** Rejected because coverage read separately is coverage nobody reads. It belongs next to the number it qualifies.
- **Coverage in the JSON only, to keep the text output short.** Rejected because the person at the terminal is the reader most likely to over-trust a number.

## D48. A benchmark result names the session it happened in, by source and start

Run Fran in 4:41 with a watch on and the file holds two records that know nothing about each other: a `benchmark_result` from `manual-1` and a `workout_session` from the watch. The evidence for a prediction wants both, because the heart rate during the attempt is the best record of how hard it actually was.

`BenchmarkResult` gains an optional `session` holding a source and a start time. A workout session is already uniquely identified by that pair — it is the key the importers use when reconciling duplicates — so the link survives a re-import unchanged.

Rejected alternatives:

- **Give workout sessions their own `id` and point at it.** Reads better. Rejected because every importer would have to generate the id and produce the identical one next time, and any drift silently breaks every link. The pair already exists and is already stable.
- **Store no link and match by overlapping time when the evidence is assembled.** No format change at all. Rejected because a workout at 6pm and a session at 6pm are only probably the same effort, and the file would never record which pairing was believed.

## D49. One skill, loaded progressively, not one per metric

`skill/` is a directory that `init` copies wholesale, which [v0.2.0 §8](../v0.2.0/spec.md) already settled. What it holds is decided here: one skill for `ath`, with `SKILL.md` short and the detail in sibling files an agent opens only when a question needs them.

Separate skills per metric would be justified by a real difference in workflow. There is none — sleep, HRV, and a benchmark result are read the same way, through the same commands, under the same rules.

Rejected alternatives:

- **One large `SKILL.md` holding everything.** Rejected because it is loaded on every activation, and most activations need none of the detail.
- **A skill per metric, or per provider.** Rejected as above, and because shared rules restated per file drift apart.

## D50. Help is written for someone who has never run the tool

`ath --help` lists commands and flags with no examples, and running `ath` alone prints the same list. That is a reference for someone who already knows the tool. Someone meeting it has no idea what to type first.

Commands are grouped by what the reader is trying to do. Every command carries worked examples with real values. Every option says when it would be used, not only what it is. Bare `ath` prints a short guide instead of the list, and says something different depending on whether a file exists in the folder. Errors name the remedy, which the series mismatch error already does and nothing else did.

Rejected alternatives:

- **Point at the README from `--help` and leave the help terse.** Rejected because the person reading `--help` is at a terminal and has already chosen not to open a browser.
- **An interactive tutorial command.** Rejected as a second thing to maintain that answers a question good help already answers.

## D51. A source records which devices wrote it, and over what window

D45 gave each writer its own source and recorded the physical devices in a list on it. The list has no dates and no counts, so replacing a watch that keeps its name leaves two entries and no way to tell when the change happened or how much each one wrote. Three years of readings sit under one name with no visible seam.

`Device` gains `from`, `to`, and `n` — the same words `series_ref` already uses for coverage. The importer accumulates them while streaming and writes the totals once at the end. Only records that survive deduplication are counted, so importing the same export twice does not double the numbers, and the window widens rather than resets.

Because every reading is timestamped, the windows usually let a reader trace a reading back to a device without the reading naming one. Where two windows genuinely overlap, the file shows the overlap rather than resolving it.

This extends D45 rather than reversing it. The source is still not split on hardware, for D45's reason: older Apple records carry no device attribute at all, so splitting on it would break one watch into two sources.

Only the per-device numbers are stored. A source's own window and count are computed at read time, because every hard signal names its source and every `series_ref` carries `from`, `to`, and `n`. The per-device numbers are stored because nothing else in the file can produce them.

Rejected alternatives:

- **Tag every reading with the device that wrote it.** Complete and unambiguous. Rejected for this version: it touches every signal type, the sidecar sample format, all three importers, and the fixture, and the tag would still be empty for the many Apple records with no device attribute and for everything from WHOOP and Oura. The windows answer most of the same question for a fraction of the change.
- **Store the source's window and count alongside the device's.** Rejected because a stored copy of a derivable number is a second thing to keep true.
- **Split the source on hardware after all, now that the window makes the seam visible.** Rejected on D45's evidence, which has not changed.

## D52. When the outside world changes, the file shows the seam

A replaced watch, a vendor renaming its writer, a route that stops carrying a quantity, and an export whose format changed are one kind of event: something outside changed, and the numbers moved for a reason that has nothing to do with the athlete. A record that absorbs that change into an existing average hides it exactly where it does the most damage.

So every importer records what it saw — the writer, the device, the route, the window, and the quantities — and the tool reports it. `ath stats` prints the makeup of every source, so a device or a source that stopped writing shows as a window that ends. The import summary names anything appearing for the first time: a new device under an existing source, a new writer, or a quantity that source has never written before.

This is the general form of the rule D51 applies to hardware. It is written down separately because the next importer, and the next vendor format change, will need it and will not be about a watch.

Rejected alternatives:

- **Detect format changes and adapt silently.** Rejected because an adaptation nobody was told about is indistinguishable from a bug, and this project has shipped three of those (D34, D42, D44).
- **Warn only when a source stops writing entirely.** Rejected as too narrow: a source that keeps writing while quietly dropping a quantity is the harder case and the more likely one.

## D53. A result and its session are matched by asking, and the match can be made later

Two records that overlap in time are probably the same effort. Probably is not good enough to write into the file, so the tool finds the candidates and the person confirms.

The confirmation goes in the one question `ath log` already asks. The best candidate appears as a line in the summary and is saved with everything else on a yes. A second candidate becomes an extra key on the same question rather than a second question.

The match usually cannot be made when the result is logged, because a workout is logged the evening it happened and the watch syncs days later. A benchmark result with no `session` is itself the record of a match still waiting, so nothing extra is stored to remember it. After every import, unlinked results whose date now has a session are offered again. `ath link` makes the attachment, and corrects one that went to the wrong session.

Rejected alternatives:

- **Link automatically when exactly one session overlaps.** Rejected because it writes a guess, and a wrong link is invisible afterwards.
- **Record a pending flag on results waiting for a match.** Rejected as state that can go stale: the absence of a link already says it.
- **Only offer the match at import, never at log time.** Rejected because the common case is logging a workout after the watch has already synced.

## D54. The CLI does not name a workout; an agent does, and the fallback is the date

A workout logged without a name still needs one, because the benchmark is how every later comparison finds it. Recognising that a paste is Fran, or a near variation of Fran with dumbbells, requires a model. The CLI has none, which has held since D7 with `backtest` as the single exception.

So the agent names it and passes the name to `ath log`. Where the workout is a known benchmark it uses that name, where it is a near variation it says so in the name, and where it is neither it makes something short. The skill carries the procedure and the reference list, in a file it opens only when a workout needs naming.

Without an agent, the benchmark is named after its date. `2026-09-04` already satisfies the `Id` pattern, so no new identifier rules are needed. The name is a label rather than a claim about what the workout was, and the definition holds the text word for word either way, so a date-named entry can be renamed later without losing anything.

Rejected alternatives:

- **Ship a workout dictionary in the CLI and match against it.** Rejected because the recognisable case is the easy half. Naming a variation is the useful half and it needs a model.
- **Refuse to log a workout with no name.** Rejected because it turns the most common entry into an error.
- **Call the LLM from the CLI when a key is present.** Rejected: it reverses D7 for a naming convenience, and it makes the same command behave differently depending on the environment.

## D55. One command per thing a person wants to do, and one command that writes

[v0.1.0 §3](../v0.1.0/spec.md) named the prediction loop `ath context` and `ath record-prediction`. Neither is a phrase anyone would reach for, and together they split one activity across two commands.

`ath predict <benchmark>` replaces both. It prints the evidence and says plainly that turning it into a number needs an agent. It never writes.

Every write goes through `ath log`, including a prediction. One write path is one thing to learn, one place to enforce validation, and one surface to test.

Rejected alternatives:

- **Keep `ath predict --record` for saving a prediction.** Keeps everything about predicting under one command. Rejected because it makes two write paths, and the second one exists only for one record type.
- **Have `ath predict` call a model when a key is present.** Rejected for D7's reason and D54's: the same command would behave differently depending on the environment.
- **Keep `ath context` as an alias.** Rejected as two names for one output, which is the discoverability problem restated.

## D56. A guess is shown before it is written; an ambiguous date is refused outright

`ath log` reads the score out of pasted text. `245 TOTAL REPS` becomes 245 reps. That is a guess, and guessing is what has cost this project the most: D34 lost all 1,305 rows of a WHOOP export to a timezone spelling, D42 lost every beat of an Apple export to a clock format, and D44 lost 324,542 more beats to an hour read against the wrong offset. Every one was a parser that accepted one spelling and said nothing about the rest.

The rule that separates this from those: a guess shown before it lands is not a silent failure. The tool prints what it understood and writes nothing until the question is answered. Anything it could not place is quoted back rather than dropped, which is D42's rule applied to typed input.

The date is the exception, because it is the one guess a person cannot check from the summary. `09-04-2026` is the 4th of September in the United States and the 9th of April in most of the world. A summary reading `2026-09-04` looks correct under either intent, so the tool names both readings and asks for an ISO date instead.

Rejected alternatives:

- **Accept US ordering, since the tool is written in English.** Rejected because the reader cannot tell from the output whether the tool agreed with them, which is what makes it different from every other guess here.
- **Use the locale to settle it.** Rejected on D42's evidence: reading a date against the machine's settings is how the Apple beat parser lost an entire export.
- **Ask a second question when the date is ambiguous.** Rejected because refusing is shorter, and there is a spelling that is never ambiguous.

## D57. The kind of record is decided first, shown first, and confirmed before anything is written

A text entry can become a measurement, a self-reported entry, or a benchmark result. That choice decides which side of the two-tier wall the record lands on, so it is held to a higher bar than the values are. A sentence about how someone felt, stored as a measurement, is the failure this format exists to prevent.

The kind is the first line of the summary, above the date and the score. Every other guess is a value a reader can eyeball. This one is the one to check.

From an agent there is no guess at all. A `type` from the hard list is a measurement, a `type` from the soft list is self-reported, and `predicted` with `confidence` and no `type` is a prediction. The three shapes do not overlap, so the dispatch is exact.

One sentence can produce several records. "Did Fran in 4:41, felt awful, slept about 5 hours" is a benchmark result and two self-reported entries. All of them are listed under the one question.

Rejected alternatives:

- **Require a flag naming the kind.** Unambiguous. Rejected because it puts the burden on every entry to prevent a mistake the summary already exposes.
- **Ask a second question when the kind is uncertain.** Rejected because a second question is the thing the one-question rule exists to avoid, and the kind line already carries the answer to be checked.

## D58. No quotes

A workout runs to several lines and often contains a `"` for a box height. A shell splits the first on newlines and breaks on the second, so `ath log` would never see an unquoted paste, and asking for quotes around a multi-line workout is asking for a shell lesson.

So `ath log` on its own reads what is pasted, until Ctrl-D. `ath log <short entry>` takes the line as written, for the one-line case. A leading ISO date sets the day.

Rejected alternatives:

- **Require quotes.** Rejected: the `"` inside the workout breaks them anyway.
- **Open the user's editor, the way `git commit` does.** Rejected as heavier than the task, and it makes pasting from a phone or a whiteboard photo harder rather than easier.
- **A `--text` flag reading from a file.** Kept as a possibility, rejected as the primary route: nobody writing down a workout wants to make a file first.

## D59. Without an agent, `ath log` matches a word list and can only fail into the self-reported tier

The parser is a word list of about forty terms, a body-region list, and patterns for numbers, ratings, units, and clock times. It does not understand language and does not pretend to. `sore quads 4/5` is read correctly and `quads are wrecked` becomes a plain note, because "wrecked" is not a word any maintainable list contains.

What makes that acceptable is the direction of failure rather than the rate of it.

- Promotion into the measured tier needs an exact hit: a known measurement name, a number, a unit that fits, and everything else that measurement requires. `slept 5 hours` stays a note, because a `sleep_session` needs a start and an end and "5 hours" gives neither.
- A name mapping to several measurements is refused rather than picked. `temperature 36.8` names the four types D28 keeps apart and asks which was meant.
- Everything else becomes a note.
- Landing in the wrong soft type costs almost nothing, because every self-reported entry is shown verbatim to whatever reads the file. The subtype is a convenience for counting.

So a misread can only land somewhere harmless, and the text is kept word for word in every case, so nothing a bare terminal misfiles is lost.

Rejected alternatives:

- **Drop the word list, so anything without a measurement name or a score becomes a plain note.** Simpler to explain and to test. Rejected narrowly: a closed list genuinely handles `sore quads 4/5`, and the fail-downward rule already removes the risk that made the simpler option attractive.
- **Grow the word list toward real coverage of plain English.** Rejected as a synonym table with no end, which would also blur the line between what the tool reads and what an agent reads.
- **Refuse free text entirely and require an agent.** Rejected because the tool has to be usable from a bare terminal.

## D60. The README shows `ath log` doing every kind of entry, and `--help` carries one worked example

Logging is the command used most and the only one that reads what a person typed, so its behaviour has to be visible before it is relied on rather than discovered by surprise.

The README gains a section with a worked example of each kind: a self-reported entry, a hand-typed measurement, a one-line workout, a pasted workout, and a past date. Alongside it, a table setting two columns against each other — what a bare terminal reads, and what the same words become with an agent connected. That difference is the reason to connect one, so it is shown rather than asserted.

`ath log --help` carries one example showing the whole shape at once: an entry, the summary it produces, and the question.

Rejected alternatives:

- **Document the word list itself.** Rejected as a list that goes stale the moment a term is added, and as more detail than a reader needs. The two columns show the boundary without enumerating it.
- **Show only the agent path, since that is the intended interface.** Rejected because it hides what happens when someone tries the tool on its own, which is how most people will first meet it.

## D61. A prediction that stated no range cannot be a hit

A hit is defined in [v0.1.0 §6](../v0.1.0/spec.md) as the actual landing inside the prediction's stated range. `range` is optional, so a prediction can arrive without one, and then there is no range for anything to land inside.

Such a prediction is graded on the error alone and is never a hit. The output says so in those words, and the miss dossier follows as it would for any other miss.

The reason is that a range is the claim about uncertainty, and grading is where a claim is tested. A prediction that made no claim about its own uncertainty should not collect the outcome reserved for one that did.

Rejected alternatives:

- **Treat an exact match as a hit when no range was given.** Rejected because an exact match on a time is chance, and rewarding it teaches the agent that a bare number is as good as a stated range.
- **Refuse to grade a prediction with no range.** Rejected because the error is still worth measuring, and refusing would leave the prediction open forever.
- **Make `range` required.** Rejected because it is a format change to fix a grading question, and a 0.2.0 file holding a prediction without a range would stop loading.

## D62. The agent's miss analysis is written back through `ath grade --analysis`, and every cause it names is checked

Step 3 of the grading procedure is the agent's: read the dossier and write `miss_analysis`. Nothing said how it reaches the file. Editing the file directly would put a second write path beside `ath log` (D55), and `ath log` appends records rather than filling in a field on one that exists.

So the analysis comes back through the command that owns the prediction record, as a second call: `ath grade <benchmark> --analysis '<json>'`.

One rule is enforced there rather than asked for. Every entry in `candidate_causes` names a tier, a type, and a day, and the tool checks that the file holds such a signal before writing anything. Inventing a plausible cause is the failure this step is most prone to, and a tool can check it, so the check belongs in the tool (D46). Where nothing explains the miss, `unexplained: true` is the honest answer and the tool accepts it with no causes at all.

Analysing a hit is refused, for the reason v0.1.0 gives: explaining a result that landed where it was meant to is a story told afterwards.

Rejected alternatives:

- **Let `ath log` take a prediction with an existing id and merge the analysis in.** Rejected because a command called log should add records, not quietly change ones already written.
- **A separate `ath analyse` command.** Rejected as a fourth command in a loop that already has three, for one field on one record.
- **Accept the analysis without checking the causes.** Rejected because that leaves the format's one auditable claim — that a cause exists in the file — resting on an instruction in a skill.

## D63. The dossier's anomaly test compares a day's mean against the spread of daily means

[v0.1.0 §6](../v0.1.0/spec.md) asks for readings in the last week more than 1.5 standard deviations from the athlete's baseline. A reading is not one thing: a device reporting one figure a night writes one reading, and a device sampling through the night writes thousands (D43).

Comparing one of those thousands against the spread of all of them answers a different question, and answers it with a far wider spread, so a bad night would never show. So the day's mean is compared against the mean and spread of daily means over the 90 days before it. Like is compared with like.

The dossier prints both numbers and the rule in words, so the comparison can be checked rather than taken on trust (D47).

Rejected alternatives:

- **Reuse `baselineFor`, which spreads over individual readings.** Rejected because the two numbers would be measuring different things while looking the same, which is the drift D22 warns about with SDNN and RMSSD.
- **Flag individual samples.** Rejected because one anomalous beat interval in a night of thousands is noise, and a dossier listing hundreds of them is a dossier nobody reads.
