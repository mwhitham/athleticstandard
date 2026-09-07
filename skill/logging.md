# Logging what someone said

`ath log` is the only command that writes. It takes either what a person typed, or
structured JSON from you. Use the JSON.

## Pass JSON, and let the shape decide

Three shapes, and they do not overlap, so nothing is guessed:

- A `type` from the measured list is a measurement.
- A `type` from the self-reported list is a self-reported entry.
- `predicted` and `confidence`, with no `type`, is a prediction.

Pass one object, or an array of them for one sentence that produced several records.

```
ath log '{"type":"hrv_rmssd","value":61,"unit":"ms","recorded_at":"2026-09-07T06:10:00-07:00"}'
```

Leave `source` off a measurement and it goes to the manual source, which is right:
the athlete read it off a screen and typed it. Only name a device source for data an
importer actually wrote.

## Echo the interpretation back before you write

Say what you understood, in one short summary, and let the athlete correct it. `ath
log` shows its own summary and asks once when a person runs it; when you run it with
`-y` there is nobody to ask, so you are the one who has to ask.

The thing worth checking is the kind. Which side of the wall a record lands on is the
one guess that cannot be undone by eye later: a sentence filed as a measurement looks
like a measurement forever.

## Rules that are yours to keep

- **Never write a device source for a number someone typed.**
- **Keep the athlete's words.** Put the sentence in `note`. Your paraphrase is not the
  record.
- **A rating needs its scale.** `4/5` is `rating: 4, scale: "1-5"`.
- **Free text is never a prediction.** A prediction is reasoned from evidence, and it
  gets written only after you have read `ath predict`.
- **When you are unsure between a measurement and a note, write the note.** A note
  loses nothing. A wrong measurement corrupts a baseline.

## Naming a workout

A workout logged without a name still gets one, because the benchmark is how every
later comparison finds it. Without you, `ath log` names it after its date. That works
and loses nothing — the definition holds the text word for word either way — but a
date is a poor name for something that has one.

So name it, and pass `--benchmark <name>`. Three cases:

1. **It is a known benchmark, as written.** Use that name: `fran`, `grace`, `murph`.
   Check the definition matches, including loads and rep scheme. Fran at 43 kg is
   Fran; Fran at 30 kg is not.
2. **It is a near variation.** Say so in the name: `fran-dumbbell`, `helen-rowing`,
   `murph-partitioned`. The name should tell a reader in a year what changed.
3. **It is neither.** Make something short and memorable that gestures at the work:
   `emom-30-snatch`, `chipper-2026-09-04`. Two words at most.

A benchmark that does not exist yet is created by `ath log`, not refused. Use the
same name again when the same workout is repeated, or the comparison the benchmark
exists for will not work.

Score type follows the workout: for time is `time`, for reps or rounds is `reps`, a
one-rep max is `load`. A benchmark's score type cannot change once results exist, so
if a repeat is scored differently, it is a different benchmark.

## The reference list

Enough to recognise the common ones. Definitions are the standard versions; check the
loads before matching.

**CrossFit benchmarks (time unless noted)**

| Name | Work |
|---|---|
| fran | 21-15-9 thrusters 43/29 kg, pull-ups |
| grace | 30 clean and jerks 61/43 kg |
| isabel | 30 snatches 61/43 kg |
| elizabeth | 21-15-9 cleans 61/43 kg, ring dips |
| diane | 21-15-9 deadlifts 102/70 kg, handstand push-ups |
| helen | 3 rounds: 400 m run, 21 kettlebell swings 24/16 kg, 12 pull-ups |
| jackie | 1000 m row, 50 thrusters 20/15 kg, 30 pull-ups |
| karen | 150 wall balls 9/6 kg |
| annie | 50-40-30-20-10 double-unders, sit-ups |
| barbara | 5 rounds: 20 pull-ups, 30 push-ups, 40 sit-ups, 50 squats, 3 min rest |
| chelsea | EMOM 30 min: 5 pull-ups, 10 push-ups, 15 squats (reps) |
| cindy | 20 min AMRAP: 5 pull-ups, 10 push-ups, 15 squats (reps) |
| angie | 100 each: pull-ups, push-ups, sit-ups, squats |
| nancy | 5 rounds: 400 m run, 15 overhead squats 43/29 kg |
| kelly | 5 rounds: 400 m run, 30 box jumps 24/20 in, 30 wall balls |
| linda | 10-9-8…1 deadlift 1.5x bw, bench 1x bw, clean 0.75x bw |
| mary | 20 min AMRAP: 5 handstand push-ups, 10 pistols, 15 pull-ups (reps) |
| nicole | 20 min AMRAP: 400 m run, max pull-ups (reps) |

**Hero workouts (time)**

| Name | Work |
|---|---|
| murph | 1 mile run, 100 pull-ups, 200 push-ups, 300 squats, 1 mile run, vest 9/6 kg |
| dt | 5 rounds: 12 deadlifts, 9 hang power cleans, 6 push jerks, 70/47 kg |
| chad | 1000 box step-ups 20 in, ruck 20/14 kg |
| jt | 21-15-9 handstand push-ups, ring dips, push-ups |
| randy | 75 power snatches 34/24 kg |
| the-seven | 7 rounds: 7 each of handstand push-ups, thrusters, knees-to-elbows, deadlifts, burpees, kettlebell swings, pull-ups |

**HYROX (time)**

Full: 8 × (1 km run + station), stations in order — ski erg 1000 m, sled push 50 m,
sled pull 50 m, burpee broad jumps 80 m, row 1000 m, farmers carry 200 m, sandbag
lunges 100 m, wall balls 100/75 reps. Also `hyrox-doubles`, `hyrox-relay`, and the
single stations when trained alone.

**Running and endurance (time)**

`1-mile-run`, `5k-run`, `10k-run`, `half-marathon`, `marathon`, `70.3`, `ironman`.

**Lifts (load)**

`back-squat`, `front-squat`, `deadlift`, `bench-press`, `strict-press`, `power-clean`,
`clean-and-jerk`, `snatch`. Name the rep count when it is not a single:
`back-squat-3rm`.
