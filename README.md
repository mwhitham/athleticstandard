# Athletic Standard

A file on your computer that holds your training and recovery data, in a form an AI can read and reason about.

## Why you might want it

**It's yours.** One plain text file you can open, copy, back up, or move to another tool. No account, no subscription, no company holding it.

**It keeps measured and self-reported apart.** Numbers from a watch (sleep, heart rate, workout times) are stored separately from things you report yourself (soreness, mood, stress). An AI reading the file always knows which numbers were measured and which you typed in, so it can weigh them differently.

**It knows what a workout is.** A benchmark is one specific effort with a real result, scored by time, reps, or weight: Fran or Murph, a 5k or a marathon, a 2k row, a 400m swim, a threshold bike test, an Olympic-distance triathlon, a back squat one-rep max, a HYROX station. You can define your own. Long efforts can also be broken into parts — a triathlon's swim, bike, and run, or the laps of a run — so a bad swim and a bad run don't blur into one finishing time.

**It writes predictions down before you train, then checks them.** Your agent predicts how a benchmark will go, records why, and after the attempt records whether it was right. Over time you can see how often it's actually correct. (Being built — see Status.)

Not an app. Not a coach. Not medical advice.

## Install

**1. Install Node.js.** Go to [nodejs.org](https://nodejs.org), download the version marked **LTS**, and open the installer. It's free.

**2. Open a terminal.** On a Mac, press Cmd+Space and type "terminal". On Windows, press Start and type "powershell". This is where you type the commands below.

Check Node arrived:

```
node -v
```

If it prints a number starting with `v20` or higher, you're set.

**3. Install this.**

```
npm install -g athleticstandard
```

`npm` comes with Node, so it's already there. This gives you a command called `ath`. If you already use pnpm or bun, `pnpm add -g athleticstandard` and `bun add -g athleticstandard` do the same thing.

To update later, run the install again.

If the install fails with a permissions error, or you'd rather not install anything at all, you can run it on the spot with `npx athleticstandard init`. That always fetches the current version. Then put `npx athleticstandard` in front of each command below instead of `ath`.

## Start

Make a new folder for your data and go into it:

```
mkdir my-training
cd my-training
ath init
```

Answer the questions (or skip them). You’ll get a file called `athlete.ath.json` in that folder. Everything else you run from here works on that file.

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
