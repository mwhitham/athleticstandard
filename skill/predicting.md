# Making a prediction

Run `ath predict <benchmark> --json`. It prints evidence and never a number, because
the CLI has no model. You are the model.

## What comes back

Four sections, and a list of gaps the tool found for you.

1. **Prior results on this benchmark**, plus results on benchmarks of the same kind.
   This is the strongest evidence there is: the same work, done before, by this
   athlete. The twenty most recent are shown; if there are more, the section says how
   many and `ath stats` counts them all.
2. **The last 28 days, day by day.** Actual rows, one per day per source, with sleep,
   training sessions, vendor scores, and every self-reported entry in the window word
   for word. The section ends with what it rests on: readings counted, days present
   out of days in the window.
3. **Long-range averages**, each carrying its count, its date range, its spread, and
   the source it came from. One source each, never pooled.
4. **Past predictions on this benchmark**, with their grades, who made each one, and
   the lesson from each miss.

Sections 2 and 3 overlap on purpose. Check a few of the averages against the rows
before you lean on them. A summary that does not match the rows underneath it is the
failure this layout exists to catch.

## How to read it

**Start with section 1.** How many results are there, over what span, and which way
are they moving? Two results eleven months apart is not a trend.

**Then section 4.** If you have been wrong on this benchmark before, the lesson from
that miss is the most useful sentence in the whole package. Apply it before you reason
from anything else. Each entry names the agent and model that made it, so check
whether the misses belong to one of them or to all of them.

**Then section 2, for the last week.** You are looking for whether the recent days
depart from the athlete's normal, and section 3 tells you what normal is. Read the
sleep column as two numbers: actual sleep and time in bed are different, and a bad
night can be either short or broken.

**Read the gaps last, and take them seriously.** Days with no data, a benchmark with
one prior result, two sources disagreeing — each of those should widen your range or
lower your confidence, and you should say which one did it.

## Writing the prediction

The number comes from measured signals. Self-reported entries widen or narrow the
range and explain a result afterwards; they do not move the number. Vendor scores —
WHOOP recovery, Oura readiness — may corroborate, and are not evidence on their own,
because nobody outside the vendor knows what goes into them.

**Always state a range.** A prediction with no range cannot be graded as a hit; it is
scored on error alone and counted as a miss whatever it does. The range is the claim
about how sure you are, and grading is where that claim is tested. Make it narrow
enough to be wrong.

**Reasoning must cite dates and values.** "HRV has been steady" is not reasoning.
"HRV 60–63 ms every night from 2026-08-01 to 2026-08-10, against a 90-day mean of
60.5" is.

**Say how thin the evidence is, in the reasoning itself.** One prior result means a
wide range and low confidence, and the reasoning should say so in those words.

Write it with `ath log`:

```
ath log '{
  "id": "fran-2026-09-07",
  "benchmark": "fran",
  "created_at": "2026-09-07T09:00:00-07:00",
  "predicted": { "duration_s": 275 },
  "range": { "low": { "duration_s": 265 }, "high": { "duration_s": 290 } },
  "confidence": "moderate",
  "reasoning": "Four prior results, 5:07 down to 4:35 over 15 months...",
  "evidence_window": { "from": "2026-08-11", "to": "2026-09-07" },
  "model": "<your model name>",
  "agent": "<the program you are running in, e.g. Claude Code>"
}' -y
```

`confidence` is `low`, `moderate`, or `high`. The score field must match how the
benchmark is scored: `duration_s` for time, `reps` for reps, `weight_kg` for load.

**`agent` is required and `ath log` refuses a prediction without it.** A prediction is
a claim, and six months from now a claim nobody signed cannot be weighed against the
ones that were right. Name the program you are running in, not the model — `model` is
already a separate field, and the same model behaves differently under different
scaffolding.

Do not send `ath_version`. The tool writes its own version and overwrites anything you
pass, because that is a fact it knows and you would be guessing at.

## Testing yourself on the past

`ath predict <benchmark> --as-of <date>` hides everything after that day. Make the
prediction from what was knowable then, then look at what happened. That is the only
honest way to find out whether your reasoning works on this athlete.
