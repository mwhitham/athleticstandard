# Athletic Standard v0.4.0 — Build Specification

This version takes over v0.1.0 build step 6, `ath backtest` and the evals. A prediction needs a model. Where that model lives depends on where you run.

Evidence is not a prediction. Printing the file and stopping is the thing this version removes.

**Bare terminal.** You typed `ath predict` or `ath backtest`. A model is required. That means a Vercel or OpenRouter key, and the CLI calls the model. No key → refuse. Name the env var. Say they can instead open the folder in Claude Code, Cursor, or Codex, where the harness already has a model. Do not dump the evidence package as if that were the answer.

**Inside a harness.** The model is the one that harness is already running. No gateway key. The skill is the harness plan: pull evidence with `ath predict fran --json`, reason, write the prediction with `ath log`, naming that agent and that model (D66). `--json` is evidence for the harness. It is not titled or sold as a prediction.

The CLI has no monthly fee. You do not subscribe to Athletic Standard. You pay for the harness you already use, or you pay per call at the gateway if you want the terminal to call models itself (D75).

A later network share is not built. The backtest report's `summary` is the later share payload (D77).

The log rules below landed first. They stay.

## `ath log`

### One command is one entry (D72)

Typed text becomes one record. Commas stay inside the text. They do not start a new record.

```
ath log slept badly, about 5 hours
ath log Fran in 4:41, felt awful
ath log 2026-09-11 e5m x 6: 16 echo bike cals, 12 t2b, 8 deadlift at 225 // 1:46, 1:25, 1:25, 1:38, 2:31, 2:58
```

The first is a sleep entry. The second is one workout, words kept as written. The third is one workout whose result is the list of times after `//`.

Quotes are not required (D58). To mark the result without quotes, put `//` between the write-up and the times, or write `Times:` and the clocks at the end.

A feeling on its own is a second command. Agent JSON can still be an array; that path does not parse prose.

### A list of round times is the result (D73)

Several clocks at the end are stored as `segments` on the `benchmark_result`. The summary shows the list. The file also keeps the sum as `result.duration_s`.

The segments live on the hand-logged result, not on the device session.

The workout text is the benchmark's definition, and the summary prints that text.

### The question names the recording (D74)

```
  kind     workout result
  date     2026-09-11
  score    1:46, 1:25, 1:25, 1:38, 2:31, 2:58
  name     2026-09-11
  attach   17:45 to 18:13 on whoop-1
  workout  e5m x 6: 16 echo bike cals, 12 t2b, 8 deadlift at 225. Times: 1: 1:46, …

Save this?
  [y] yes, on the 17:45–18:13 session
  [n] no
  [2] the 19:02–19:40 session instead
```

Each choice is on its own line. One question, still. A match is confirmed, never inferred (D53).

## The key (D75)

The key never goes in the athlete file. Agents read that file.

```
ath key set vercel
ath key set openrouter
ath key clear
```

`ath key set` asks for the key with hidden input. It writes to the OS password store: Keychain on a Mac, Credential Manager on Windows, the secret service on Linux. The OS encrypts it and unlocks it when they are logged in. We do not invent our own lock.

`ath key` says which gateway is saved, not the key itself. `ath key clear` deletes it.

If the password store is missing (some locked-down Linux boxes), we refuse and say so. We do not write a plaintext file.

A key already in the environment still works, for scripts. `AI_GATEWAY_API_KEY` is Vercel. `OPENROUTER_API_KEY` is OpenRouter. The saved store is the path for a person.

Gateways: Vercel (`https://ai-gateway.vercel.sh/v1`) or OpenRouter (`https://openrouter.ai/api/v1`). Whichever is saved is the one we use. Both saved → `--gateway vercel|openrouter`.

No key is a valid install. Harness use, `ath log`, `import`, `stats`, `grade` keep working. Bare `ath predict` and `ath backtest` refuse and tell them `ath key set`.

One client in `src/gateway.ts`. Live `GET /v1/models`. No per-provider SDKs.

## The live model list (D78)

Needs a key. Fetched each time, so a new open-weight model appears without a new `ath`.

We do not keep a favourite-labs list. The list is: text in, text out, and the catalog marks it as able to reason. That includes open weights. Image, audio, and embedding models are out.

`--model` must be on that live list, or we say so and show close names.

```
ath models
ath models --default openai/gpt-oss-120b
ath predict fran --model qwen/qwen3-235b-a22b
ath predict fran
```

- `ath models` lists every live text model that can reason.
- `--model` on the command is this one run.
- `ath models --default <name>` saves your usual model next to the athlete file. The next `ath predict` uses it.
- If you have not chosen either, we stop and tell you to run `ath models`. We do not guess. We do not silently reuse last week's backtest winner.

`ath backtest --all` runs every model on that list. We print how many and ask once, because it can be a long (and costly) run. To compare a few, pass `--model` more than once.

```
ath backtest --model qwen/qwen3-235b-a22b --model openai/gpt-oss-120b
ath backtest --all
```

## `ath predict` in the terminal (D76)

You choose the model. We do not pick one for you. Needs a gateway key. Then:

1. Build evidence (`evidenceFor`).
2. Call the model you chose.
3. Print the number, the range, the model, then the evidence it used.
4. Ask once. Yes writes through `applyDraft` with `agent: "ath predict"` and that model. `--dry-run` writes nothing. `--yes` writes.

`--as-of` does not write. Replaying the past is `ath backtest`.

`--json` without a key is allowed. It prints the evidence object for a harness. The words on the screen (and in help) say it is evidence, not a prediction.

D7: the CLI still does not parse English. In a bare terminal it now calls a model for predict and backtest, through a gateway you opted into.

D55: a harness still writes predictions through `ath log`. When the CLI itself produced the number, `ath predict` writes it.

## `ath backtest` (D77)

Bare terminal, same rule: a model is required, so a key is required. Refuse without one. Point at the harness for daily predictions that use the harness model.

- Replay only results with an earlier result on the same benchmark (D10).
- Evidence as of the day before (D69).
- Grade with the same math as `ath grade`.
- Do not write the athlete file.

Table: per model, n, median / mean error, in-range rate, error by history depth, which model won on this file.

Report file: `replays` (local) + `summary` (shareable). `ath share` refuses and names the file.

## Evals

Help and README use those two sentences: a prediction needs a model; in a harness the model is already there.

- Tests: TTY predict without a key refuses; `--json` without a key is evidence; with a fake gateway, predict writes a signed number; backtest ranks two models. Key set/clear talks to a fake password store in tests, not the real one.
- Planted-contradiction on the evidence rows (D9). CI does not call a live gateway.
- Skill: harness plan unchanged — `--json`, then `ath log`.
