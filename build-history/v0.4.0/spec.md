# Athletic Standard v0.4.0 — Build Specification

This version takes over v0.1.0 build step 6, `ath backtest` and the evals, which is the last step of that plan still open. What the backtest contains, and how, is still to be decided together before it is built. [v0.1.0 §7](../v0.1.0/spec.md) holds the original design and is the starting point for that conversation, not the plan.

The log rules below landed first. They do not wait on the backtest.

## `ath log`

### One command is one entry (D72)

Typed text becomes one record. Commas stay inside the text. They do not start a new record.

```
ath log slept badly, about 5 hours
ath log Fran in 4:41, felt awful
ath log 2026-09-11 e5m x 6: 16 echo bike cals, 12 t2b, 8 deadlift at 225 // 1:46, 1:25, 1:25, 1:38, 2:31, 2:58
```

The first is a sleep entry. The second is one workout, words kept as written. The third is one workout whose result is the list of times after `//`.

Quotes are not required (D58). To mark the result without quotes, put `//` between the write-up and the times, or write `Times:` and the clocks at the end.

A feeling on its own is a second command. Agent JSON can still be an array; that path does not parse prose.

### A list of round times is the result (D73)

Several clocks at the end are stored as `segments` on the `benchmark_result`. The summary shows the list. The file also keeps the sum as `result.duration_s`.

The segments live on the hand-logged result, not on the device session.

The workout text is the benchmark's definition, and the summary prints that text.

### The question names the recording (D74)

```
  kind     workout result
  date     2026-09-11
  score    1:46, 1:25, 1:25, 1:38, 2:31, 2:58
  name     2026-09-11
  attach   17:45 to 18:13 on whoop-1
  workout  e5m x 6: 16 echo bike cals, 12 t2b, 8 deadlift at 225. Times: 1: 1:46, …

Save this?
  [y] yes, on the 17:45–18:13 session
  [n] no
  [2] the 19:02–19:40 session instead
```

Each choice is on its own line. One question, still. A match is confirmed, never inferred (D53).
