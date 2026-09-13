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
