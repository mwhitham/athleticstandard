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

## D64. Three records describe one attempt, and two links join them

A prediction is a claim made before a workout. A benchmark result is what happened. A workout session is the wearable's record of the same effort. Those are three records about one event.

Only one link existed. A result names its session by source and start (D48), and `ath check` verifies it. A prediction held a copy of the score and a timestamp, and pointed at nothing. Correct the result afterwards and the prediction still claimed the old number, with nothing in the file to say the two disagreed.

The reference was already there in fact. A benchmark result is identified by its benchmark and its instant, and a graded prediction already stored both. So `prediction.actual.recorded_at` is stated to be that reference, and `ath check` verifies that the result exists and that the two scores agree. No field was added.

The chain can now be walked from either end: prediction to result to session.

Nothing else is linked. A morning HRV reading does not point at a workout, because it carries a timestamp and that is enough to line things up. A link is worth having only where two records describe the same event and one can be corrected without the other. Every link is one more thing that can go stale and has to be checked on every save.

Rejected alternatives:

- **Give every benchmark result an id and have the prediction reference it.** Rejected for the reason D48 gives for the session link: an id has to be invented, kept unique, and preserved across a re-import, and the file already identifies a result without one.
- **Store the result inside the prediction and drop the separate record.** Rejected because a result is a measured signal and belongs in `hard_signals` with the rest, where every baseline and trend can see it.
- **Warn rather than error when the two disagree.** Rejected because a prediction graded against a score the file does not hold is not a mild problem: it is the ledger claiming something that cannot be checked, which is the one thing the ledger is for.
- **Link the prediction to the session as well.** Rejected as a third edge that says nothing the other two do not. One hop each way is enough.

## D65. `ath grade` shows what it will write and asks, the same as `ath log`

`ath log` prints a summary of every guess it made and asks one question before anything reaches the file (D56). `ath grade` wrote immediately. Both write, so both should write the same way.

Grading now runs in two halves. `planGrade` works out the result, the grade, and the dossier and writes none of it; `applyGrade` commits. In between, the reader sees the summary and answers once. The result goes in through `applyDraft`, which is `ath log`'s write path, so it picks up the session offer, the sort order and the manual source from the one place that does those (D55).

The verdict is printed after the write, not before the question. Showing the grade above the question would be asking permission for something already said.

`ath grade` also offers the session match, which it previously only hinted at. The match is the same match whichever command records the result, so it is made the same way: by asking (D53).

Rejected alternatives:

- **Leave grade writing immediately, since an agent drives it.** Rejected because a person runs it too, and because the argument would apply equally to `ath log`, which does ask.
- **Keep the hint and skip the offer.** Rejected because a hint is a second command the reader has to remember to run, and the tool already knows both halves.
- **Print the verdict, then ask.** Rejected because there is nothing left to consent to once the answer is on the screen.

## D66. A prediction records who made it, and the tool writes its own version

A prediction is a claim, and a claim with no author cannot be weighed against the next one. Asking six months later which model to trust means knowing which model said what.

Three things are recorded. `model` was already there. `agent` is the program the model ran inside, which is a different fact: the same model behaves differently under different scaffolding. `ath_version` is the version of the tool that wrote the prediction, which matters per prediction rather than per file, because a file upgraded later does not change what a past prediction was made with.

The split is by who knows the answer. The agent supplies the model and the agent name, because only it knows them. The tool writes the version and overwrites anything it was handed, because that is a fact the tool knows and the caller would be guessing at.

`ath log` refuses a prediction that does not name its agent. The field is optional in the schema so a 0.2.0 file still loads, and required at the write path so nothing new arrives unsigned. That is D46: a rule a tool can enforce should not live in a skill.

`ath predict` prints the author of every past prediction alongside its grade, so a run of misses from one model is visible rather than averaged in with everyone else's.

Rejected alternatives:

- **Group the three under one `author` object.** Rejected because `model` already exists at the top level, and moving it is a breaking change to a required field in a minor version.
- **Make the fields required in the schema.** Rejected because a minor version may only add optional fields, and a 0.2.0 file holding a prediction would stop loading.
- **Trust the version the agent passes.** Rejected because the tool knows its own version and the agent is reading it off something. Where the tool knows, the tool writes.
- **Infer the agent from the environment.** Rejected as a guess dressed as a fact. Every agent runs `ath` the same way, and there is nothing reliable to read.

## D67. One attempt makes one result, and a second one says so

Running `ath grade fran --actual 4:32` twice made two Fran results and said nothing. So did logging the same workout twice. Almost every repeat is the same command run twice.

The cost is not untidiness. A duplicate result is counted by every baseline, every trend and every prediction that reads the benchmark's history, and nothing about the file looks wrong afterwards. It is the quiet kind of wrong this format exists to avoid.

So a second result for a benchmark on a day that already has one is refused, and the refusal names the result already there. A real second attempt passes `--again`.

Grading has one exception, because logging a result and then grading it is the ordinary order. A result already logged with the same score is the one being graded, not a duplicate to refuse: the grade attaches to it and nothing is written twice. A different score on the same day is refused, because one of the two is wrong and writing both leaves the file claiming each.

Rejected alternatives:

- **Warn and write anyway.** Rejected because a warning scrolls past and the duplicate stays. The whole problem is that nothing looks wrong afterwards.
- **Silently replace the earlier result.** Rejected because it throws away a record without asking, and the earlier one may be the correct one.
- **Match on the score as well, so only identical repeats are refused.** Rejected because two different scores on one day is the more alarming case, not the more permissible one.

## D68. `--yes` agrees with what would have been shown; it does not choose

`--yes` skips the question. It was also attaching the result to the nearest workout session that day even when three sessions could have been it.

Those are different things. `--yes` means "I agree with what you would have shown me". Picking one of three real efforts is not something that was going to be shown; it is a choice the reader would have made. D53 says a match is made by asking and never by inference, and the nearest start time is inference.

So there are three amounts of consent, and the session match respects the difference. With a terminal, the question is put and the reader can change the answer. With `--yes`, one candidate is attached and two or more are left alone, with the reason on the screen. With neither, nothing is attached and `ath link` or the next import picks it up.

Rejected alternatives:

- **Attach the nearest one under `--yes`, as before.** Rejected because a wrong session link is invisible afterwards and quietly attributes a workout's heart rate to the wrong effort.
- **Refuse `--yes` outright when several sessions match.** Rejected because the result itself is fine to write, and refusing the whole entry over an optional link is out of proportion.
- **Attach nothing under `--yes` even when there is one candidate.** Rejected because one candidate on the same day is the ordinary case, and refusing to link it makes `--yes` useless for the scripts it exists for.

## D69. `--as-of` hides readings; it never changes how a number is computed

A backtest hides what happened after a date so a prediction can be tested against what was knowable at the time.

There were two baseline functions. One anchored its ninety-day window on the latest reading and measured back from that reading's own instant. The other anchored on the as-of date and applied no instant cutoff. The same data gave two different means depending on whether a date was passed.

That makes a backtest measure the tool rather than the reasoning. So there is one function, and it takes the day to stop at. The window is still anchored on the latest reading it can see, still measured back from that reading's instant, still bounded before any sidecar is opened. The rule string is the same either way, which is what lets a bounded number and an unbounded one be compared at all.

Rejected alternatives:

- **Keep the second function and document that the two differ.** Rejected because a documented inconsistency is still an inconsistency, and the reader comparing two runs would have to know to look.
- **Anchor both on the as-of date.** Rejected because without a date there is no such day, and the latest reading is the only anchor that always exists.

## D70. Vendor scores appear in the evidence, labelled

WHOOP recovery and Oura readiness are numbers a vendor computed, not numbers a sensor read (D27). They are imported, they are counted in `ath stats`, they appear in the miss dossier, and the skill tells an agent they may corroborate a claim.

They did not appear in `ath predict`. So an agent could weigh a recovery score when explaining a miss and not when trying to avoid one, and the skill described something the evidence did not contain.

They now appear in the day-by-day rows in a column of their own, headed so the reader cannot mistake them for measurements, with the rule stated in the section text: they may corroborate a claim and cannot be the basis of one.

Rejected alternatives:

- **Leave them out, since a prediction should rest on measurements.** Rejected because the skill and the dossier already say otherwise, and three places giving two answers is worse than either answer.
- **Put them in the baselines section.** Rejected because a mean of a proprietary composite is a number about a formula nobody outside the vendor has seen.
- **Mix them into the measurement columns.** Rejected because the whole point of D27 is that they are a different kind of thing, and a shared column would say they are not.

## D71. `ath predict` shows the most recent results and counts what it left out

Every result ever recorded on a benchmark was printed. An athlete with years of Fran attempts would get all of them, and an evidence package too long to read is one that gets skimmed.

The twenty most recent are shown, and the ten most recent for related benchmarks. What was left out is stated in the same place: how many are shown, how many exist, and that `ath stats` counts them all.

Saying so is the part that matters. A reader who cannot see how much was dropped cannot tell a short history from a truncated one, and would read four results as the whole story when there were forty.

Rejected alternatives:

- **Print everything.** Rejected because the package is read by a model with a context limit, and the older results are the least informative ones.
- **Trim silently.** Rejected for the reason D47 exists: a number with no statement of what it rests on cannot be argued with.
- **Cut by date rather than by count.** Rejected because a benchmark attempted twice a year and one attempted weekly need different windows, and a count adapts where a window does not.
