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

Not built yet. When it is, you'll download an export file from Apple Health, WHOOP, or Oura and hand it to Athletic Standard in one command. A normal export already contains what's needed, so there'll be nothing to connect, authorize, or pay for.

## Where this is up to

Early days. Version 0.1.

Working today: creating a file, checking it, and summarizing it.

Coming next: loading exports from Apple Health, WHOOP, and Oura, then the commands that record and grade predictions.

## Reference

[SPEC.md](SPEC.md) documents every field in the file. [docs/connections.md](docs/connections.md) covers what each wearable actually hands over, and what it holds back.
