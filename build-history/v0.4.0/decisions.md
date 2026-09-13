# Athletic Standard v0.4.0 — Decision Log

Decisions for this version, continuing the numbering from [v0.1.0](../v0.1.0/decisions.md) (D1–D24), [v0.2.0](../v0.2.0/decisions.md) (D25–D45), and [v0.3.0](../v0.3.0/decisions.md) (D46–D71). The rejected alternatives are recorded because they are the part everyone forgets.

## D72. One `ath log` is one entry

Each time someone types `ath log`, one record is written. Commas stay inside the text. They do not start a new record.

A workout lists movements with commas. Splitting on those commas is what turned `16 echo bike cals, 12 t2b, 8 deadlift at 225. Times: 1: 1:46, 2: 1:25` into several notes and one guessed score. The split was meant for mixed kinds — a result and a feeling in one sentence (D57). A movement list is one workout.

Quotes are still not required. That is D58: a workout often contains `"` for a box height, and the shell breaks on it.

To mark the result without quotes, put `//` between the write-up and the times, or write `Times:` and the clocks at the end. Neither character is special to the shell, and `/` is already used inside workouts (`55lbs / 20s REST`), so the marker is `//`.

A feeling still gets written down. It is a second command: `ath log felt awful`.

Agent JSON can still be an array. That path does not parse prose.

This supersedes the comma-split part of D57. The kind is still decided first, shown first, and confirmed before anything is written.

Rejected alternatives:

- **Require quotes around the workout.** Rejected for D58's reason: the `"` inside the workout breaks them.
- **Keep the comma split for mixed kinds.** Rejected because the same rule is what chopped a movement list into notes.
- **Use `/` as the marker.** Rejected because workouts already write `/` between movements and rest.
- **Use `|` as the marker.** Rejected because the shell treats it as a pipe.

## D73. A list of round times is the result

When the result at the end of the text is several clocks, each clock is stored as a `segment` on the `benchmark_result`. The score shown in the summary is the list. The file also keeps the sum as `result.duration_s`, because averages and predictions still need one number.

The segments live on the hand-logged result, not on the device session. The session is what the watch measured. The round times are what the person wrote down. Mixing them into the session would put a hand-timed list on the measured side of the two-tier wall.

The workout text is kept word for word as the benchmark's definition, and that text is shown in the summary. "Saved word for word" told the reader nothing they could check (D56).

Several clocks with no `//` and no `Times:` are a trailing list if they sit at the end as comma-separated clocks. A single clock at the end is still a finish time. The last clock of a list is not taken as the finish.

Rejected alternatives:

- **Take the last clock as the finish time.** Rejected because it is one round, not the workout.
- **Write the times onto the device session.** Rejected because that mixes a hand-timed list into a measured recording.
- **Drop the score and keep only the text.** Rejected because a result without a number cannot be averaged or predicted against.
- **A new score type for a list of times.** Rejected because the existing segment shape already names ordered sub-efforts.

## D74. The question says which recording the write-up attaches to

The summary line for the device session is labelled `attach`. The question puts each choice on its own line: yes (on this recording), no, and another recording when there is one.

`[2] use the 17:45 one instead` next to a session line that already said 17:45 read as a choice between a new workout and an existing one. It is a choice of which device recording to attach to.

```
Save this?
  [y] yes, on the 17:45–18:13 session
  [n] no
  [2] the 19:02–19:40 session instead
```

Extra keys use start, end, and the source when two recordings share a start clock, so they stay distinct. One recording is yes and no only. No recording that day is yes and no, and the attach line says so.

The name is the benchmark id. It no longer adds `(no agent connected, so named after the day)`.

This is still one question. A second candidate is still an extra key, not a second question (D53). `--yes` still attaches one candidate and leaves two or more alone (D68).

Rejected alternatives:

- **Keep the keys on one line.** Rejected because the labels now carry start, end, and sometimes the source, and that line is no longer readable.
- **Ask a second question for the session.** Rejected: that is the thing D53 exists to avoid.
- **Attach without asking.** Rejected for D53's reason: a wrong link is invisible afterwards.

## D75. No Athletic Standard subscription; the key is optional and never in the file

There is no Athletic Standard account and no monthly fee. A gateway key is only for calling a model from a bare terminal. Inside Claude Code, Cursor, or Codex the harness already has a model, so no key is needed.

`ath key set vercel` or `ath key set openrouter` saves the key in the computer's password store: Keychain on a Mac, Credential Manager on Windows, the secret service on Linux. The OS encrypts it and unlocks it when the person is logged in. The key never goes in the athlete file. Agents read that file.

`ath key` says which gateway is saved, not the key itself. `ath key clear` deletes it. If the password store is missing, the command refuses and says so. It does not write a plaintext file.

A key already in the environment still works, for scripts: `AI_GATEWAY_API_KEY` for Vercel, `OPENROUTER_API_KEY` for OpenRouter. The saved store is the path for a person.

No key is a valid install. `ath log`, `import`, `stats`, and `grade` keep working. Bare `ath predict` and `ath backtest` refuse and tell them `ath key set`, or to open the folder in a harness.

This does not rewrite D7. The CLI still does not parse English. It now calls a model for predict and backtest only, through a gateway the person opted into.

Rejected alternatives:

- **A monthly Athletic Standard subscription.** Rejected because the product is a file on their machine, not a service they pay us for.
- **Store the key in the athlete file.** Rejected because agents read that file.
- **Write an encrypted file of our own.** Rejected because the OS already has a password store, and we would be inventing a lock.
- **Require a key for every command.** Rejected because a harness already has a model, and the rest of the CLI is plumbing.

## D76. Bare `ath predict` is a prediction; `--json` is evidence

A prediction needs a model. Where that model lives depends on where you run.

In a bare terminal, `ath predict` calls the model you chose, prints the number, the range, the model, then the evidence it used, and asks once before writing. It writes through `applyDraft` with `agent: "ath predict"` and that model. No key → refuse. Do not print the evidence and stop as if that were the answer.

`--json` prints the evidence object for a harness. It does not need a key. The words on the screen, and in help, say it is evidence, not a prediction. Evidence alone is never a prediction.

Inside a harness the model is the one already running. The skill is unchanged: pull evidence with `ath predict fran --json`, reason, write with `ath log`, naming that agent and that model (D66).

`--as-of` does not write. Replaying the past is `ath backtest`. `--dry-run` writes nothing. `--yes` writes.

You choose the model. `--model` is this one run. `ath models --default <name>` saves your usual model next to the athlete file. If you have chosen neither, we stop and tell you to run `ath models`. We do not guess. We do not silently reuse last week's backtest winner.

This does not rewrite D55. A harness still writes predictions through `ath log`. When the CLI itself produced the number, `ath predict` writes it.

Rejected alternatives:

- **Print the evidence package and stop.** Rejected because that is not a prediction, and it is the thing this version removes.
- **Pick a default model when none was named.** Rejected because a silent pick is a claim we did not ask them to make.
- **Reuse last week's winner.** Rejected for the same reason.
- **Dump evidence when no key is present.** Rejected because the same command would then pretend evidence was the answer.
- **Rewrite D7 or D55.** Rejected: append, do not rewrite.

## D77. Bare `ath backtest` needs a model and writes a report, not the athlete file

`ath backtest` is a prediction repeated over history, so it needs a model, so it needs a key. No key → refuse. Point at the harness for daily predictions that use the harness model.

Replay only results that have an earlier result on the same benchmark (D10). Evidence is as of the day before (D69). Grade with the same math as `ath grade`. Do not write the athlete file.

The table is per model: how many results, median and mean error, how often the actual landed in the stated range, error by how many prior results that benchmark had, and which model won on this file.

The report file has `replays` (local) and `summary` (no name, no path, no workout dates). `summary` is the later share payload. `ath share` is not built. It refuses and names the latest report.

Rejected alternatives:

- **Write the replayed predictions into the athlete file.** Rejected because a backtest is a test, not a claim the athlete made that day.
- **Run without a model and print evidence.** Rejected for D76's reason: evidence is not a prediction.
- **Build the network share in this version.** Rejected: the report's `summary` is enough to share later; the network is not.

## D78. The live list is every text model that can reason

`ath models` fetches the gateway's catalog each time. The list is every model that takes text, returns text, and that the catalog marks as able to reason. Open-weight models are included. Image, audio, and embedding models are out. We do not keep a favourite-labs list. A new open-weight model appears without a new `ath`.

`--model` must be on that live list, or we say so and show close names.

`ath backtest --all` runs every model on that list. We print how many and ask once, because it can be a long and costly run. To compare a few, pass `--model` more than once.

Rejected alternatives:

- **A hardcoded list of lab models.** Rejected because it would hide open weights and go stale.
- **Every chat model, whether the catalog marks reasoning or not.** Rejected because the rule is the catalog's mark, not our guess.
- **Run `--all` without asking.** Rejected because the person should see the count before paying for it.
