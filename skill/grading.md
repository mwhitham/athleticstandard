# Grading a prediction

When the athlete reports a result on a benchmark, grade it. Run:

```
ath grade fran --actual 4:32
```

Write the score in the benchmark's own unit: a clock for time, a plain number for
reps, a number with a unit for load. Add `--date` when the attempt was not today.

The command records the result, writes the actual into the open prediction, and
computes the error. If no prediction was open, it logs the result and stops. There
was no claim, so there is nothing to be right or wrong about.

## Hit

The result landed inside the stated range. The command prints one comparison line.
Relay it and stop.

Do not analyse a hit. Explaining why a prediction landed where it was meant to is a
story told afterwards, and the story will sound convincing whether or not it is true.

## Miss

Anything outside the range, and anything predicted without a range. The command
classifies it — minor under 5 percent, significant to 15, severe above — and prints
the dossier.

Beating the prediction is a miss too. Coming in 15 percent faster is the same size of
modelling failure as coming in 15 percent slower, and it gets the same treatment.

## The dossier

Three parts, in the order they should be weighed:

1. **The day of the attempt.** Last night's sleep, that morning's measurements, the
   session itself. Most trusted, because it is measured and it is closest in time.
2. **Everything self-reported in the 72 hours before**, word for word.
3. **Days in the last week that sat far from the athlete's own baseline.** Each one
   shows the day's figure, the baseline it is measured against, the spread, and how
   many standard deviations out it is.

Nothing in the dossier is a cause. It is the material from which a cause might be
argued.

## Writing the analysis

Send it back through the same command:

```
ath grade fran --analysis '{
  "direction": "slower",
  "severity": "significant",
  "candidate_causes": [
    { "signal": { "tier": "hard", "type": "sleep_session", "date": "2026-09-07" },
      "explanation": "5h01m of actual sleep against a 7h04m average over the last 90 nights" }
  ],
  "unexplained": false,
  "lesson": "short sleep the night before costs this athlete time on short benchmarks"
}'
```

Rules, and the first one is checked by the tool before anything is written:

1. **Every cause names a signal in the file** — its tier, its type, and its day. A
   cause the file does not hold is rejected and nothing is saved.
2. **Order them by trust**: the day's measured signals first, then the self-reported
   entries from the 72-hour window, then the week's unusual days.
3. **When nothing explains it, set `unexplained: true`** and leave the causes empty.
   Then ask the athlete one question — "the prediction missed by 12 percent and
   nothing in the data explains it. Anything unusual? Ill, judged more strictly, new
   equipment?" — and log whatever they say with `ath log` as a self-reported entry. If
   they have nothing, it stays unexplained. Do not invent a cause to fill the field.
4. **`lesson` is one sentence, written for a future prediction.** It appears in
   section 4 of the evidence package next time, which is the whole point of writing
   it. "Poor sleep costs this athlete time on short benchmarks" is useful. "The
   prediction was too optimistic" is not.

`direction` is `faster`, `slower`, `higher`, or `lower` — the first two for a time,
the last two for reps or load.
