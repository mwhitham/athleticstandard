# Athletic Standard

A file on your computer that holds your training and recovery data, in a form an AI can read and reason about.

## Why you might want it

**It's yours.** One plain text file you can open, copy, back up, or move to another tool. No account, no subscription, no company holding it.

**It keeps measured and self-reported apart.** Numbers from a watch (sleep, heart rate, workout times) are stored separately from things you report yourself (soreness, mood, stress). An AI reading the file always knows which numbers were measured and which you typed in, so it can weigh them differently.

**It knows what a workout is.** A benchmark is one specific effort with a real result, scored by time, reps, or weight: Fran or Murph, a 5k or a marathon, a 2k row, a 400m swim, a threshold bike test, an Olympic-distance triathlon, a back squat one-rep max, a HYROX station. You can define your own. Long efforts can also be broken into parts — a triathlon's swim, bike, and run, or the laps of a run — so a bad swim and a bad run don't blur into one finishing time.

**It writes predictions down before you train, then checks them.** Your agent predicts how a benchmark will go, records why, and after the attempt records whether it was right. Over time you can see how often it's actually correct. This part isn't built yet — see [Where this is up to](#where-this-is-up-to).

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

**Running data comes across in detail.** If you run outdoors with a watch that records it, you get speed, power, stride length, ground contact time, and how much your body rises with each stride — not just the total distance. That's the difference between knowing a run was slow and knowing whether your form fell apart in the last mile.

**Your runs get split up.** Apple saves the route of every outdoor workout, so each run is broken into per-kilometre times plus how much climbing you did. A single finishing time can't tell you the last kilometre was 40% slower than the first; splits can. The route itself is thrown away after the splits are worked out — your file never stores where you actually went, because that would be a map of your home and your regular routes.

**If you've taken ECGs, they're used as a reference.** Your watch measures heart rate variability with a light sensor all day, and studies put that roughly 29% off from a proper chest strap. But an ECG measures the electrical signal directly, and that *is* the accurate way. So each ECG you've recorded is read for its heartbeat timing and stored separately from your everyday readings — which lets you see how far your own watch drifts, for you, rather than trusting an average from a study of strangers.

Two things it won't do with those. It doesn't keep the ECG trace itself or what the Health app concluded about your heart rhythm; that belongs with your doctor, not in a training file. And if a recording wasn't a normal rhythm, it's skipped rather than used, because heartbeat variation only means "well recovered" when the rhythm is normal in the first place.

**A folder appears next to your file.** Things measured constantly, like heart rate all day, would make `athlete.ath.json` tens of megabytes and no longer something you can open and read. Those samples go into a `series/` folder beside it instead. Nothing is thinned out or averaged away — it's all kept, just not in the middle of the document. There's one small file per day per measurement, so asking about last week reads seven files rather than a whole year.

Your file keeps a one-line summary of each measurement — what it covers and how many samples — rather than a line per day. With eleven years of step counts that's the difference between a readable file and a ten-megabyte one.

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

## Where this is up to

Early days. Version 0.2.

Working today: creating a file, loading exports from Apple Health, WHOOP, and Oura, checking the file, summarizing it, and reading the detailed measurements back.

Coming next: the commands that record and grade predictions.

## Reference

[SPEC.md](SPEC.md) documents every field in the file. [docs/connections.md](docs/connections.md) covers what each wearable actually hands over, and what it holds back.
