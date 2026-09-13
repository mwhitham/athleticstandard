/**
 * Help written for someone who has never run this (D50).
 *
 * The old help listed flags and nothing else, which tells a reader what exists and
 * not what to type. So every command carries worked examples with real values, the
 * command list is grouped by what the reader is trying to do, and bare `ath` says
 * what to do next rather than printing everything at once.
 *
 * `ath log` gets the longest example of any command, because it is the one used most
 * and the only one that reads what a person typed (D60).
 */
import { existsSync, readdirSync } from "node:fs";
import { FILE_SUFFIX } from "./file.js";

/** The four things a reader might be trying to do. Commander prints these as headings. */
export const GROUPS = {
  setUp: "Set up:",
  getIn: "Get your data in:",
  read: "Read your data:",
  predict: "Predict and grade:",
} as const;

/**
 * What bare `ath` prints.
 *
 * Different with and without a file, because the two readers want different things:
 * one has nothing yet and needs a first command, the other has a file and needs to
 * know what can be done to it.
 */
export function bareGuide(cwd: string): string {
  const files = existsSync(cwd) ? readdirSync(cwd).filter((f) => f.endsWith(FILE_SUFFIX)) : [];

  if (files.length === 0) {
    return [
      `ath — Athletic Standard, an open file format for your training and recovery data.`,
      ``,
      `There is no ${FILE_SUFFIX} file in this folder, so start with one:`,
      ``,
      `  ath init                       make the file, here`,
      `  ath import <export>            load an Apple Health, WHOOP or Oura export into it`,
      ``,
      `Then you can log what you did, read it back, and predict against it:`,
      ``,
      `  ath log slept badly, about 5 hours`,
      `  ath stats`,
      `  ath predict fran --json`,
      ``,
      `Every command explains itself: \`ath <command> --help\`, with examples.`,
      `The whole list: \`ath --help\`.`,
    ].join("\n");
  }

  const name = files[0]!;
  return [
    `ath — Athletic Standard. Working on ${name} in this folder.`,
    ``,
    `  ath stats                      what is in the file, and where it came from`,
    `  ath log HRV 61 this morning    write something down`,
    `  ath import <export>            load more device data`,
    `  ath predict fran               predict Fran — needs a model in a bare terminal`,
    `  ath check                      make sure the file is still sound`,
    ``,
    `Every command explains itself: \`ath <command> --help\`, with examples.`,
    `The whole list: \`ath --help\`.`,
  ].join("\n");
}

/** Worked examples, one block per command, with real values rather than placeholders. */
export const EXAMPLES: Record<string, string> = {
  init: `
Examples:

  Answer three questions, then write the file:
    $ ath init

  Skip the questions:
    $ ath init -y --name "Sam Reyes" --birth-year 1991 --sex female

The file is created here, called athlete${FILE_SUFFIX}, with the well-known
benchmarks already defined. Nothing leaves your machine.

If there is an agent folder here — .claude, .cursor or .agents — the agent
skill is copied into it, so an agent in this folder knows how to read and
write the file. Pass --no-skill to skip that.`,

  check: `
Examples:

  Check the file in this folder:
    $ ath check

  Check one somewhere else:
    $ ath check ~/training/athlete${FILE_SUFFIX}

An error means the file breaks a rule of the format and says which rule.
A warning means something is worth knowing but the file is still valid —
sample series travelling without their sidecar folder is the usual one.`,

  import: `
Examples:

  An Apple Health export, straight from the zip:
    $ ath import ~/Downloads/export.zip

  A WHOOP or Oura CSV:
    $ ath import ~/Downloads/physiological_cycles.csv

Importing the same export twice is safe: records already in the file are
recognised and skipped, so nothing is counted twice.

Each app or device inside an export becomes its own source, because a
watch and a ring measuring the same thing are two answers, not one. See
them with \`ath stats\`.

If a workout you logged earlier now has a device session on the same day,
the import offers to attach them.`,

  log: `
Examples:

  A note, taken exactly as typed. No quotes needed:
    $ ath log slept badly, about 5 hours

  A measurement read off a device by hand:
    $ ath log HRV 61 this morning

  How something felt, with a rating:
    $ ath log sore quads 4/5

  A one-line workout:
    $ ath log Fran in 4:41 rx

  Round times at the end. \`//\` marks the result; \`Times:\` does the same:
    $ ath log e5m x 6: 16 echo bike cals, 12 t2b, 8 deadlift at 225 // 1:46, 1:25

  A workout of several lines. Run \`ath log\` on its own, paste it, and
  press Ctrl-D. A box height writes as 20" and a shell would break on it,
  which is why it is pasted rather than quoted:
    $ ath log
    7 ROUNDS FOR REPS
    40s ALT DB SNATCH 55lbs / 20s REST
    40s BOX STEP UPS 20" / 20s REST
    245 TOTAL REPS
    ^D

  Nothing is written until you say so. First you see what was understood:

      kind     workout result
      date     2026-09-07  (today)
      score    245 reps
      name     2026-09-07
      attach   17:25 to 17:48 on whoop-1
      workout  7 ROUNDS FOR REPS
               40s ALT DB SNATCH 55lbs / 20s REST
               40s BOX STEP UPS 20" / 20s REST
               245 TOTAL REPS

    Save this?
      [y] yes, on the 17:25–17:48 session
      [n] no

  A workout from an earlier day. The date goes first, as year-month-day:
    $ ath log 2026-09-04

What this reads on its own: measurement names it knows, numbers, units,
ratings like 4/5, clock times, a list of round times, and rep totals.
Everything else becomes a note with your words kept exactly. It never
turns a sentence into a measurement on a guess — the worst it can do is
file something as a note. One command writes one record.

One workout on one day makes one result. Logging a second is refused,
because a duplicate is counted by every average afterwards and nothing
looks wrong. If you really did it twice, pass --again.

An agent connected to this file does more: it recognises that a paste is
Fran, names the benchmark, and passes structured JSON instead of text.`,

  link: `
Examples:

  Attach today's Fran to the session that started at 17:25:
    $ ath link fran 17:25

  When the benchmark has several results, say which day:
    $ ath link fran@2026-09-04 17:25

  When two devices recorded the same minute, say which one:
    $ ath link fran whoop-1@2026-09-04T17:25:00Z

Device data usually arrives days after the workout, so a result with no
session attached is normal rather than broken. Every import offers the
matches that have become possible; this command is for the rest, and for
fixing one that went to the wrong session.`,

  predict: `
Examples:

  Predict Fran. Needs a gateway key in a bare terminal:
    $ ath models
    $ ath predict fran --model qwen/qwen3-235b-a22b

  Save a usual model, then predict without naming it:
    $ ath models --default openai/gpt-oss-120b
    $ ath predict fran

  Evidence for a harness, not a prediction. No key needed:
    $ ath predict fran --json

A prediction needs a model. In Claude Code, Cursor, or Codex the model
is already there: pull evidence with --json, reason, write with
\`ath log\`. In a bare terminal this command calls the model you chose,
prints the number, and asks once before writing.

--as-of hides everything after that day and does not write. Replaying
the past is \`ath backtest\`.`,

  key: `
Examples:

  Save a Vercel or OpenRouter key in the computer's password store:
    $ ath key set vercel
    $ ath key set openrouter

  See which gateway is saved, not the key itself:
    $ ath key

  Delete it:
    $ ath key clear

There is no Athletic Standard subscription. A key is only for calling a
model from a bare terminal. Inside a harness you do not need one.

The key never goes in the athlete file. Agents read that file. If the
password store is missing, the command refuses. It will not write a
plaintext file. A key already in AI_GATEWAY_API_KEY or OPENROUTER_API_KEY
still works, for scripts.`,

  models: `
Examples:

  Every live text model that can reason, including open weights:
    $ ath models

  Save your usual model next to the athlete file:
    $ ath models --default openai/gpt-oss-120b

Needs a gateway key. The list is fetched each time, so a new open-weight
model appears without a new ath. Image, audio, and embedding models are
out. We do not pick a favourite lab for you.`,

  backtest: `
Examples:

  Replay history with the models you name:
    $ ath backtest --model qwen/qwen3-235b-a22b --model openai/gpt-oss-120b

  Every live text model that can reason, after showing the count:
    $ ath backtest --all

A prediction needs a model, so a key is required. No key → refuse. In a
harness, daily predictions use the harness model; this command is for
comparing models on a history you already have.

A result is replayed only when an earlier result on the same benchmark
exists. Evidence is as of the day before. The athlete file is not
written. The report's summary is the later share payload.`,

  share: `
Examples:

  Name the latest backtest report:
    $ ath share

Not built yet. The shareable part of a backtest is the summary in the
report file this names.`,

  grade: `
Examples:

  What actually happened, scored against the open prediction:
    $ ath grade fran --actual 4:32

  Reps and loads, in their own units:
    $ ath grade cindy --actual 245
    $ ath grade back-squat --actual 142.5kg

  An attempt from an earlier day:
    $ ath grade fran --actual 4:32 --date 2026-09-04

  See what it would write, and write nothing:
    $ ath grade fran --actual 4:32 --dry-run

Grading writes, so it shows what it will write and asks once, the same as
\`ath log\`. Where your watch recorded a session that day, it offers to
attach the result to it. The verdict comes after.

If the result is already in the file, it is graded rather than written
again. A different score on a day that already has one is refused: pass
--again if you really attempted it twice.

A result inside the prediction's stated range is a hit, and prints one
line. Anything else is a miss and prints the dossier: the day's own
measurements, everything self-reported in the 72 hours before, and any
day in the last week that sat far from your own baseline.

An agent reads that dossier and writes the analysis back:
    $ ath grade fran --analysis '{"direction":"slower", ...}'

Every cause it names is checked against the file first. Where nothing
explains the miss, "unexplained": true is the honest answer.

With no prediction open, the result is simply logged and grading stops.`,

  stats: `
Examples:

  What is in the file, and where it came from:
    $ ath stats

  As data, for an agent:
    $ ath stats --json

Baselines are listed per source and never averaged across them, because
two devices measuring one thing give two answers. Each carries how many
observations it rests on, over what days, and the rule used.

Each source also lists the devices seen writing under it, with the days
each one covered — which is where a replaced watch becomes visible.

Predictions are counted by who made them, so you can see which agent and
model has actually been right about you.`,

  series: `
Examples:

  One row per day:
    $ ath series heart_rate

  A window, and one device:
    $ ath series hrv_beats --from 2026-08-01 --to 2026-08-31 --source whoop-1

  Every sample, not a daily summary:
    $ ath series heart_rate --raw --from 2026-08-14 --to 2026-08-14

Dense sample streams live in files beside the document rather than in it,
so the document stays small enough to read. This command reads them back.
\`ath stats\` lists which series exist.`,
};

/** The line under the grouped command list on bare `ath --help`. */
export const HELP_FOOTER = `
Every command has examples of its own: \`ath <command> --help\`.

The file is yours and it is local. It is one JSON document you can read,
edit, back up, and move. Device measurements and things you reported
yourself are kept apart on purpose, and no command mixes them.

A prediction needs a model. In a harness the model is already there.
There is no Athletic Standard subscription.

Not an app, not a coach, not medical advice.`;
