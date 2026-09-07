# Athletic Standard

A file on your computer that holds your training and recovery data, in a form an AI can read and reason about.

## Why you might want it

**It's yours.** One plain text file you can open, copy, back up, or move to another tool. No account, no subscription, no company holding it.

**It keeps measured and self-reported apart.** Numbers from a watch (sleep, heart rate, workout times) are stored separately from things you report yourself (soreness, mood, stress). An AI reading the file always knows which numbers were measured and which you typed in, so it can weigh them differently.

**It knows what a workout is.** A benchmark is one specific effort with a real result, scored by time, reps, or weight: Fran or Murph, a 5k or a marathon, a 2k row, a 400m swim, a threshold bike test, an Olympic-distance triathlon, a back squat one-rep max, a HYROX station. You can define your own. Long efforts can also be broken into parts — a triathlon's swim, bike, and run, or the laps of a run — so a bad swim and a bad run don't blur into one finishing time.

**It writes predictions down before you train, then checks them.** Your agent predicts how a benchmark will go, records why, and after the attempt records whether it was right. Over time you can see how often it's actually correct.

Not an app. Not a coach. Not medical advice.

## Setting up

**1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the version marked **LTS**, and open the installer. It's free. This is the program that runs Athletic Standard.

**2. Open a terminal.** On a Mac, press Cmd+Space and type "terminal". On Windows, press Start and type "powershell". A window opens where you type commands. That's where everything below goes.

To confirm Node installed, type this and press Enter:

```
node -v
```

If it prints a number starting with `v20` or higher, you're ready.

**3. Install Athletic Standard.**

```
npm install -g athleticstandard
```

`npm` came with Node, so it's already on your machine. This installs a command called `ath`, which is what you'll type from now on. If you already use pnpm or bun, `pnpm add -g athleticstandard` and `bun add -g athleticstandard` do the same thing.

To get a newer version later, run that install command again.

If it fails with a permissions error, or you'd rather not install anything at all, you can skip this step. Type `npx athleticstandard` instead of `ath` every time — it fetches and runs the current version on the spot.

## Creating your file

Make a folder to keep your training data in, then create the file inside it:

```
mkdir my-training
cd my-training
ath init
```

`ath init` asks for your name, birth year, and sex. All three are optional — press Enter to skip any of them. It then writes a file called `athlete.ath.json`, already stocked with some common benchmarks like Fran and a 5k.

Every command below reads and writes that one file, so run them from this same folder.

If you keep an agent folder here — `.claude`, `.cursor`, or `.agents` — `ath init` also copies a skill into it, so an agent working in this folder knows how to read and write the file properly. Pass `--no-skill` if you'd rather it didn't.

Typing `ath` on its own tells you what to do next. Every command has examples of its own under `ath <command> --help`.

## Writing things down

`ath log` is the only command that writes. It takes a workout result, a measurement you read off a screen, or how something felt — and you never need quotes.

**Something you want written down.** Type it on the line, and it's kept in your words:

```
ath log slept badly, about 5 hours
```

That one it files under sleep. Anything it doesn't recognise is kept as a plain note instead, and your words are kept either way.

**How something felt, with a rating.** It picks up the rating and the body part:

```
ath log sore quads 4/5
```

**A measurement you typed in yourself.** It's filed under "hand-entered", never as if a device measured it:

```
ath log HRV 61 this morning
```

**A one-line workout:**

```
ath log Fran in 4:41 rx
```

**A workout that runs to several lines.** Run `ath log` on its own, paste it in, and press Ctrl-D. A box height is written `20"` and a shell would break on that, which is why it's pasted rather than quoted:

```
ath log
```

```
7 ROUNDS FOR REPS
40s ALT DB SNATCH 55lbs / 20s REST
40s BOX STEP UPS 20" / 20s REST
245 TOTAL REPS
```

**A workout from an earlier day.** The date goes first, written year-month-day:

```
ath log 2026-09-04
```

Nothing is written until you say so. First you see exactly what it understood:

```
  kind     workout result
  date     2026-09-07  (today)
  score    245 reps
  name     2026-09-07  (no agent connected, so named after the day)
  session  17:25 to 17:48 on whoop-1
  workout  saved word for word

Save this? [y] yes  [n] no
```

The first line is the one worth reading. It says which side of the wall the entry lands on — measured, or something you reported — and that's the decision you can't spot by eye later.

That `session` line is the tool noticing you have a recorded workout at the same time as the result, and offering to attach the two. Usually your watch hasn't synced yet, so there's nothing to attach; the next `ath import` offers the match once the data arrives, and `ath link` does it by hand.

### What it reads on its own, and what changes with an agent

The terminal has no AI in it. It matches a list of measurement names, numbers, units, ratings like `4/5`, clock times, and rep totals. That's the whole of it — and it can only fail downward, into a note. Nothing it misreads can become a measurement, because that needs an exact hit on a name it knows plus a number and a unit that fits.

| You type | A bare terminal writes | With an agent connected |
|---|---|---|
| `slept badly, about 5 hours` | a sleep entry, your words kept exactly | the same |
| `sore quads 4/5` | soreness, quads, 4 out of 5 | the same |
| `HRV 61 this morning` | a hand-entered HRV measurement of 61 ms | the same |
| `quads are wrecked` | a plain note — "wrecked" is in no list | soreness, quads, unrated |
| `slept 5 hours` | a sleep entry, not a measured night — a sleep record needs a start and an end | the same, for the same reason |
| a pasted 21-15-9 thruster and pull-up workout | a workout result named after the day | a workout result named `fran` |
| a pasted 21-15-9 with dumbbells | a workout result named after the day | a workout result named `fran-dumbbell` |
| `temperature 36.8` | refused — it names four different measurements, and asks which | the same refusal |

Your words are kept exactly in every one of those cases, so nothing a bare terminal files as a note is lost. The difference an agent makes is recognising a workout and naming it, which is what lets you compare the same effort a year apart.

## Reading your file

Two commands tell you what's in it.

**`ath stats`** prints a plain summary — how many measurements you have, the dates they cover, your recent averages, and which benchmarks you've recorded results for.

```
ath stats
```

**`ath check`** confirms the file is still valid: nothing missing, nothing contradicting itself. Worth running after you or an AI has edited the file.

```
ath check
```

The file is ordinary text, so you can also just open `athlete.ath.json` in any text editor and read it yourself.

## Loading data from your watch

Download an export from your device, then hand it over in one command. A normal export already has what's needed, so there is nothing to connect, authorize, or pay for.

```
ath import ~/Downloads/export.zip
```

That works for an Apple Health `export.zip`, a WHOOP CSV export, or an Oura export. You don't say which is which — it works that out. It prints what it added, and importing the same file twice adds nothing.

**Where to get the export:**

| Device | How |
|---|---|
| Apple Watch | Health app → your picture → Export All Health Data |
| WHOOP | WHOOP app → More → Data Export |
| Oura | Membership Hub → Export data |

You can import from more than one device. Readings are never mixed together: each one keeps a note of which device measured it, and the averages in `ath stats` are listed per device. That matters because devices genuinely disagree about heart rate variability — by more than the day-to-day change you'd be looking for — so a single blended number would be misleading. Resting heart rate is a different story: devices agree closely on that.

This holds inside one export too. An Apple Health export carries readings from everything that writes into Health — the watch, the phone in your pocket, a smart scale, a blood-pressure cuff, and other wearables' apps. Each is filed under its own name (`apple-watch-1`, `iphone-1`, `withings-1`, and so on), and `ath stats` lists them all with what wrote them. Numbers you typed into the Health app yourself are filed as hand-entered, not as a device.

**Running data comes across in detail.** If you run outdoors with a watch that records it, you get speed, power, stride length, ground contact time, and how much your body rises with each stride — not just the total distance. That's the difference between knowing a run was slow and knowing whether your form fell apart in the last mile.

**Your runs get split up.** Apple saves the route of every outdoor workout, so each run is broken into per-kilometre times plus how much climbing you did. A single finishing time can't tell you the last kilometre was 40% slower than the first; splits can. The route itself is thrown away after the splits are worked out — your file never stores where you actually went, because that would be a map of your home and your regular routes.

**If you've taken ECGs, they're used as a reference.** Your watch measures heart rate variability with a light sensor all day, and studies put that roughly 29% off from a proper chest strap. But an ECG measures the electrical signal directly, and that *is* the accurate way. So each ECG you've recorded is read for its heartbeat timing and stored separately from your everyday readings — which lets you see how far your own watch drifts, for you, rather than trusting an average from a study of strangers.

Two things it won't do with those. It doesn't keep the ECG trace itself or what the Health app concluded about your heart rhythm; that belongs with your doctor, not in a training file. And if a recording wasn't a normal rhythm, it's skipped rather than used, because heartbeat variation only means "well recovered" when the rhythm is normal in the first place.

**A folder appears next to your file.** Things measured constantly, like heart rate all day, would make `athlete.ath.json` tens of megabytes and no longer something you can open and read. Those samples go into a `series/` folder beside it instead. Nothing is thinned out or averaged away — it's all kept, just not in the middle of the document. There's one small file per day per measurement, so asking about last week reads seven files rather than a whole year.

Your file keeps a one-line summary of each measurement — what it covers and how many samples — rather than a line per day. With eleven years of step counts that's the difference between a readable file and a ten-megabyte one.

**Where a measurement lands depends on how often your device takes it.** An Apple Watch checks your breathing rate, HRV and blood oxygen many times a night, so those go to the folder. WHOOP and Oura report one figure per night for the same three, and one figure per night stays in the file. Both are the same measurement and you ask for them the same way; a night of readings and a single figure summarising that night are just not the same thing, so they aren't stored as though they were.

Keep the folder with the file. If it goes missing, `ath check` says so and your file still works.

## Reading the detailed data

`ath stats` gives you the overview. For the day-by-day detail, `ath series`:

```
ath series heart_rate
```

```
heart_rate (bpm) — 7 days

  2026-08-24  n=288  min 48  max 171  mean 64.2
  2026-08-25  n=291  min 47  max 166  mean 63.8
  ...
```

Narrow it with `--from` and `--to`, pick a device with `--source`, get every individual reading with `--raw`, or ask for JSON with `--json`.

**Your own notes come across too.** If you answered WHOOP's daily questions about alcohol, caffeine, or how you slept, those come in as self-reported entries — kept separate from measurements, because you reported them rather than a sensor.

**Some things are skipped, and it tells you which.** Anything Athletic Standard doesn't have a name for is counted and reported rather than guessed at, with an example so you can see what it was. The same goes for a measurement in an unfamiliar unit: it gets reported instead of assumed, because a distance in miles quietly stored as metres would look like perfectly good data.

Deliberately left out: medical records from your health provider, and findings that belong with a doctor rather than a training file — irregular heart rhythm notifications, for instance. Also hearing and headphone volume, which have nothing to do with training. Blood pressure *is* kept, because it genuinely bears on how hard a session is on you.

## Predicting, and finding out whether you were right

This is the part the file exists for. A record of training that never commits to a claim about tomorrow can't be shown to be right or wrong.

**`ath predict fran`** prints everything a prediction would rest on: every previous Fran in full, the last 28 days day by day, your long-range averages with the count and spread behind each one, and how your past predictions on Fran turned out. It also names what's missing — days with no data, a benchmark with only one prior result, two devices that disagree.

It doesn't give you a number. Turning evidence into a prediction takes a model, and there isn't one in the terminal. An agent reads this, reasons, and writes its answer back. Add `--as-of 2026-06-01` to hide everything after a past day, which is how you test whether the reasoning actually works on you.

**`ath grade fran --actual 4:32`** records what happened and scores the open prediction against it. Inside the range it stated is a hit, and prints one line. Anything else is a miss, and prints the dossier: last night's sleep, that morning's readings, everything you reported in the 72 hours before, and any day in the last week that sat far from your own normal. Your agent reads that and writes up what it thinks went wrong — and every cause it names is checked against the file first, so it can't invent one.

If no prediction was open, the result is simply recorded and that's that.

## Where this is up to

Early days. Version 0.3.

Working today: creating a file, loading exports from Apple Health, WHOOP, and Oura, checking and summarizing it, reading the detailed measurements back, logging what you did, and the full prediction loop — predict, log, grade, explain the miss.

Coming next: measuring the agent's reasoning against a held-back history, so there's a number for how often it's right.

## Reference

[SPEC.md](SPEC.md) documents every field in the file. [docs/connections.md](docs/connections.md) covers what each wearable actually hands over, and what it holds back. [skill/](skill/) is the agent skill `ath init` installs — worth reading even if you never use an agent, because it says plainly what the tools guarantee and what they don't.
