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

**A folder appears next to your file.** Things measured constantly, like heart rate all day, would make `athlete.ath.json` tens of megabytes and no longer something you can open and read. Those samples go into a `series/` folder beside it instead, and your file points at them. Nothing is thinned out or averaged away — it's all kept, just not in the middle of the document. Keep the folder with the file. If it goes missing, `ath check` says so and your file still works.

**Your own notes come across too.** If you answered WHOOP's daily questions about alcohol, caffeine, or how you slept, those come in as self-reported entries — kept separate from measurements, because you reported them rather than a sensor.

**Some things are skipped, and it tells you which.** Anything Athletic Standard doesn't have a name for is counted and reported rather than guessed at. Medical records from your health provider are left alone.

## Where this is up to

Early days. Version 0.2.

Working today: creating a file, loading exports from Apple Health, WHOOP, and Oura, checking the file, and summarizing it.

Coming next: the commands that record and grade predictions.

## Reference

[SPEC.md](SPEC.md) documents every field in the file. [docs/connections.md](docs/connections.md) covers what each wearable actually hands over, and what it holds back.
