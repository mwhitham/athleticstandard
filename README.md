# Athletic Standard

A file on your computer that holds your training and recovery data, in a form an AI can read and reason about.

## Why you might want it

**It's yours.** One plain text file you can open, copy, back up, or move to another tool. No account, no subscription, no company holding it.

**It keeps measured and self-reported apart.** Numbers from a watch (sleep, heart rate, workout times) are stored separately from things you report yourself (soreness, mood, stress). An AI reading the file always knows which numbers were measured and which you typed in, so it can weigh them differently.

**It knows what a workout is.** A benchmark is one specific effort with a real result, scored by time, reps, or weight: Fran or Murph, a 5k or a marathon, a 2k row, a 400m swim, a threshold bike test, an Olympic-distance triathlon, a back squat one-rep max, a HYROX station. You can define your own. Long efforts can also be broken into parts — a triathlon's swim, bike, and run, or the laps of a run — so a bad swim and a bad run don't blur into one finishing time.

**It writes predictions down before you train, then checks them.** Your agent predicts how a benchmark will go, records why, and after the attempt records whether it was right. Over time you can see how often it's actually correct. (Being built — see Status.)

Not an app. Not a coach. Not medical advice.

## Install

You need [Node.js](https://nodejs.org) 20 or later. Node comes with `npm`, which installs this:

```
npm install -g athleticstandard
```

That gives you a command called `ath`. If you already use pnpm or bun, `pnpm add -g athleticstandard` and `bun add -g athleticstandard` do the same thing.

To update later, run the install again.

If you'd rather not install anything, `npx athleticstandard init` runs it on the spot and always fetches the current version. Then put `npx athleticstandard` in front of each command below instead of `ath`.

## Start

Open a terminal in an empty folder and run:

```
ath init
```

Answer the questions (or skip them). You’ll get a file called `athlete.ath.json`.

## Look at it

```
ath check
ath stats
```

`check` makes sure the file is valid. `stats` prints a short summary. You can also open `athlete.ath.json` in any text editor.

## Load data from a watch

Not ready yet. When it is, you export from Apple Health, WHOOP, or Oura and load that file. A normal export already has the data you need, so there's nothing to connect or authorize.

## Status

Early. Version 0.1.

Working now: create a file, check it, print a summary.

Next: loading exports from Apple Health, WHOOP, and Oura, then the prediction and grading commands.

## More

The field-by-field format is in [SPEC.md](SPEC.md). What each wearable actually gives you is in [docs/connections.md](docs/connections.md).
