# Athletic Standard v1 — Build Specification

Status: **approved for build** (2026-08-10)
Working name: `athleticstandard` (final name unresolved; naming is confined to the file extension, CLI name, npm package name, and the `athleticstandard_version` field so a rename is a find-replace).

## 0. What this is

An open standard — a versioned file format — for representing a functional-fitness athlete's training and recovery state over time, designed for AI agents to reason over. Not an app, not a coach. Plus a reference implementation that proves the format works: an agent that predicts performance on named benchmarks, records its predictions before the workout, and grades itself against reality.

The one opinionated design choice (the differentiator): **two-tier signal separation**. Device-measured data and self-reported data never mix. Measured signals drive predictions; self-reported signals adjust confidence and explain misses.

Pitch line: *"An open format for training and recovery data that keeps measured signals apart from self-reported ones — so an AI can tell you whether to train hard today, and show what it weighed."*

## 1. What ships

A GitHub repo containing four artifacts:

| Artifact | What it is |
|---|---|
| `SPEC.md` + JSON Schema | The file format — the actual product |
| `athleticstandard` npm package | TypeScript core library + deterministic CLI |
| The Skill (`SKILL.md`) | Reasoning instructions for the user's own agent |
| README | Pitch, quickstart, worked example, prior-art study |

## 2. The file format

One JSON document, `athlete.athleticstandard.json`, local, portable, human-inspectable. **The file is the database** — no server, no DBMS, no accounts. Design principle: the format must be fully usable with nothing but a text editor and an LLM. Photos live in a sibling `attachments/` folder; the file itself stays pure text.

### Top level

```json
{
  "athleticstandard_version": "0.1.0",
  "athlete": {
    "name": "…",
    "birth_year": 1990,
    "sex": "male",
    "units": "imperial"
  },
  "sources": [],
  "hard_signals": [],
  "soft_signals": [],
  "benchmarks": [],
  "predictions": []
}
```

`athleticstandard_version` is semver; minor versions may only add optional fields. Every timestamp in the file is ISO 8601 UTC with original timezone offset preserved (Open Wearables convention).

### `sources` — where data came from

Every hard signal must point at one of these; this is what makes "hard" enforceable.

```json
{
  "id": "whoop-1",
  "kind": "wearable",
  "vendor": "whoop",
  "detail": "WHOOP 4.0 via CSV export 2026-08-09"
}
```

`kind` is one of `wearable | export_file | connector | manual`. A source of kind `manual` exists so typed-in numbers ("HRV was 54") can be stored as measurements *without* claiming device provenance — they carry visibly lower trust.

### `hard_signals` — measured data

Types and units adopted verbatim from Open Wearables' canonical table (HRV in ms, HR in bpm, distance in meters, duration in seconds, °C, timestamps UTC). Two shapes, mirroring OW's Time Series / Events split:

**Point measurements:**

```json
{ "type": "hrv_rmssd", "value": 62, "unit": "ms",
  "recorded_at": "2026-08-09T06:12:00Z", "source": "whoop-1" }
```

v1 point types: `hrv_rmssd`, `hrv_sdnn`, `resting_heart_rate`, `body_weight`, `respiratory_rate`.

**Sessions (start, end, aggregates):**

```json
{ "type": "sleep_session", "start": "…", "end": "…", "source": "whoop-1",
  "aggregates": { "duration_s": 26100, "efficiency_pct": 89,
                  "deep_s": 5400, "rem_s": 6300, "interruptions": 2 } }
```

```json
{ "type": "workout_session", "start": "…", "end": "…", "source": "oura-1",
  "aggregates": { "activity": "crossfit", "avg_hr_bpm": 152, "max_hr_bpm": 178,
                  "energy_kcal": 540, "distance_m": null },
  "segments": [ { "label": "run 1km", "duration_s": 261 } ] }
```

`segments` is how run splits and HYROX station times are represented — ordered, labeled sub-efforts inside a session.

**Benchmark results** are a third hard-signal type (a result is measured fact even when hand-entered — but its `source` will be `manual` unless it came from a device):

```json
{ "type": "benchmark_result", "benchmark": "fran",
  "recorded_at": "2026-08-09T17:30:00Z", "source": "manual-1",
  "result": { "duration_s": 281 }, "scaling": "rx",
  "note": "unbroken thrusters first round" }
```

### `soft_signals` — self-reported data

```json
{ "type": "sleep_quality", "reported_at": "2026-08-09T07:00:00Z",
  "rating": 2, "scale": "1-5",
  "note": "neighbor's dog, maybe 5 hours",
  "provenance": { "via": "text" } }
```

v1 types: `sleep_quality`, `soreness` (with optional `body_region`), `stress`, `mood`, `energy`, `nutrition`, `note` (freeform). All fields optional except `type` and `reported_at`. Provenance records how the entry came to exist (`via`: `text | voice | photo`), and for AI-interpreted entries, which model did the interpreting:

```json
{ "type": "nutrition", "reported_at": "…",
  "note": "grilled chicken bowl, rice, avocado — est. 700-900 kcal",
  "provenance": { "via": "photo", "interpreted_by": "claude-sonnet-4-5",
                  "attachment": { "file": "2026-08-09-lunch.jpg", "sha256": "…" } } }
```

**The two-tier wall, as validation rules:** hard signals require a `source` reference and fixed units; soft signals must **not** reference a device source, and ratings must carry an explicit `scale`. A self-reported feeling in `hard_signals` fails `check`, and vice versa.

### `benchmarks` — definitions

```json
{ "id": "fran", "kind": "named_wod", "score_type": "time",
  "definition": "21-15-9 reps for time: thrusters 95/65 lb, pull-ups" }
```

Ships with a small seed library (Fran, Grace, Helen, Murph, 5k run, 1-mile run, HYROX full); users add their own. Custom benchmarks are first-class.

### `predictions` — the ledger

Written by the agent before the attempt; graded after. Append-only by convention (`check` warns if an existing prediction was mutated).

```json
{ "id": "pred-2026-08-09-fran", "benchmark": "fran",
  "created_at": "2026-08-09T15:00:00Z",
  "predicted": { "duration_s": 275 },
  "range": { "low_s": 265, "high_s": 290 },
  "confidence": "moderate",
  "reasoning": "Last Fran 4:41 on Jun 2. HRV 61-66ms all week vs 63ms baseline…",
  "evidence_window": { "from": "2026-06-01", "to": "2026-08-09" },
  "model": "claude-sonnet-4-5",
  "actual": null,
  "grade": null,
  "miss_analysis": null
}
```

`actual`, `grade`, and `miss_analysis` are populated by the grading procedure (§6).

### SPEC.md contents

Field-level reference for all of the above (types, units, required/optional, examples), the two-tier rationale, the local-first principle, versioning policy, and the **prior-art appendix**: mapping table from Open Wearables' model → Athletic Standard, plus one-paragraph treatments of Apple HealthKit export, Garmin FIT, WHOOP export CSV, Terra's API model, and Open mHealth, explaining what each got right and why Athletic Standard anchors to OW's vocabulary. JSON Schema (draft 2020-12) generated from the Zod definitions, committed to `schema/athleticstandard.schema.json`.

## 3. The CLI

Deterministic, no LLM calls (one exception: `backtest`). All commands operate on the file in the current directory (or `--file` path). Installed via npm registry: `pnpm add -g athleticstandard`, or zero-install via `npx athleticstandard` / `pnpm dlx athleticstandard`.

| Command | What it does |
|---|---|
| `ath init` | Interactive: creates the file, seeds benchmark library, offers to install the Skill into `.claude/skills/` / `.cursor/` (detects what's present) |
| `ath import <path>` | Detects format (WHOOP CSV bundle, Apple Health export.zip, Oura CSV), parses, converts to canonical units, dedupes by (type, timestamp, source), appends. Prints a summary of what was added |
| `ath log <json>` | Structured append — takes a JSON payload for one signal/result, validates it, writes it. This is the write-path the *agent* uses; humans use conversation, not this |
| `ath context <benchmark> [--as-of <date>]` | Emits the evidence package (§5) as markdown to stdout. `--as-of` truncates history to what was known on that date — this is what makes backtesting honest |
| `ath record-prediction <json>` | Validates and appends a prediction entry |
| `ath grade <benchmark> --actual <score>` | Runs the grading procedure (§6): computes the delta, classifies hit/miss, and emits the material the agent needs to write a miss analysis |
| `ath check` | Schema validation + semantic rules (source refs resolve, tier rules, unit sanity, timestamp ordering, prediction immutability). Exit code for CI use |
| `ath backtest [--model <m>]` | Replays history to measure prediction accuracy (§7). Needs `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (or `--model ollama:…`) — the only command that does |
| `ath stats` | Quick human-readable summary of file contents (date ranges, counts, baselines) |

### Human surface area

A person touches the terminal twice, ever:

```bash
npx athleticstandard init
npx athleticstandard import ~/Downloads/whoop_export.csv
```

After that they open their agent (Claude Code, Cursor, any Skill-compatible client) in that folder and talk: "did Fran today, 4:41" / "slept terribly" / "should I go hard tomorrow?" The agent reads the Skill, runs the CLI, reasons, and writes to the file. The one other command worth typing by hand is `npx athleticstandard backtest`.

## 4. The Skill

`skill/SKILL.md` in the repo, installed by `init`. Contents:

- **When to activate:** the user mentions training, recovery, logging a workout/meal/feeling, or asks for a prediction, and an `.athleticstandard.json` file is present.
- **Logging procedure:** parse the user's natural language into the structured payload, **echo back the interpretation for confirmation**, then call `ath log`. Rules: typed-in device numbers get `source: manual`, never a device source; photos → interpret, write description + provenance, reference the attachment.
- **Prediction procedure:** run `ath context <benchmark>`, reason over it, then `ath record-prediction`. Hard rules: the prediction number derives from hard signals only; soft signals may only widen/narrow confidence and inform explanation; reasoning must cite specific dates and values; cross-check every summary statistic against the raw rows before relying on it; state data sufficiency plainly ("only 1 prior Fran — wide range").
- **Grading procedure:** follow §6 exactly, including the miss-analysis structure and the ask-the-user step for unexplained misses.
- Reference: compact cheat-sheet of the format's types and units (so the agent rarely needs to open SPEC.md).

## 5. The evidence package (`ath context` output)

The anti-over-indexing design, concretely. The worry: hand an LLM a tidy summary and it parrots the summary without reading actual data. Mitigation is structural — the context always contains raw rows, and summaries carry receipts. Markdown with four sections:

1. **Benchmark history** — every prior result for this benchmark, full detail, plus results from related benchmarks (same modality).
2. **Raw recent window** — last 28 days of hard signals as a day-by-day table (HRV, RHR, sleep duration/efficiency, training sessions), and *all* soft signals in the window verbatim. Not summarized — actual rows.
3. **Long-horizon summaries with receipts** — e.g. `hrv_rmssd 90-day baseline: 63ms (n=87, 2026-05-11→2026-08-08, sd 6.2)`. Every stat carries n, date range, and spread, so the agent can verify against section 2 where they overlap.
4. **Track record for this benchmark** — past graded predictions and their miss analyses, including each `lesson` (§6), so athlete-specific patterns compound instead of being relearned.

Target size ~2–4k tokens for a year of data: small enough to never crowd an agent's context, complete enough that nothing load-bearing is pre-digested away.

## 6. Grading procedure

Triggered when the user reports a result for a benchmark that has an open prediction (via conversation → agent runs `ath grade <benchmark> --actual <score>`).

### Step 1 — Match and measure (CLI, deterministic)

- Find the most recent ungraded prediction for that benchmark. If none exists, the result is logged as a normal `benchmark_result` and grading stops — no prediction, nothing to grade.
- Write the actual result into the prediction's `actual` field (and log it as a `benchmark_result` hard signal).
- Compute and write `grade`:

```json
{ "signed_error_s": -3, "abs_error_pct": 1.1, "in_range": true }
```

### Step 2 — Classify (CLI, deterministic)

| Outcome | Definition |
|---|---|
| **Hit** | Actual falls inside the prediction's stated range |
| **Miss — minor** | Outside range, absolute error < 5% |
| **Miss — significant** | Outside range, absolute error 5–15% |
| **Miss — severe** | Outside range, absolute error > 15% |

On a **hit**: the CLI prints the one-line comparison ("Predicted 4:35, actual 4:32 — off by 3s, inside your stated range"), the agent relays it, done. No analysis — analyzing hits breeds post-hoc storytelling.

On any **miss**: the CLI additionally emits the *miss dossier* — the raw material for analysis: all soft signals from the 72h before the attempt, day-of hard signals (that morning's HRV, RHR, last night's sleep session), and any 7-day anomalies (signals >1.5 sd from the athlete's baseline).

### Step 3 — Miss analysis (agent, using the dossier)

The agent writes `miss_analysis` into the prediction, with this structure:

```json
{
  "direction": "slower",
  "severity": "significant",
  "candidate_causes": [
    { "signal": { "tier": "hard", "type": "sleep_session", "date": "2026-08-08" },
      "explanation": "5.1h sleep vs 7.4h baseline the night before" },
    { "signal": { "tier": "soft", "type": "soreness", "date": "2026-08-08" },
      "explanation": "reported quad soreness 4/5 after Thursday squats" }
  ],
  "unexplained": false,
  "lesson": "poor sleep the night before cost ~8% on a short high-power benchmark"
}
```

Rules the Skill enforces:

1. **Causes must exist in the file.** Every `candidate_causes` entry references a real signal (tier + type + date). The agent may not invent causes that aren't recorded.
2. **Precedence order:** day-of hard signals first (trusted), then soft signals from the 72h window, then 7-day anomalies. Listed in that order.
3. **If the dossier explains nothing**, set `unexplained: true` — and ask the user **one** question: "The prediction missed by 12% and nothing in your data explains it. Anything unusual — sick, judged to stricter standards, new equipment?" The answer is logged as a soft signal (timestamped now, referencing the attempt) and added as a cause. If the user has nothing, `unexplained` stays true. Do not invent a cause.
4. **`lesson` is one sentence**, written to be useful to a future prediction (it surfaces in §5 section 4). Examples: "poor sleep reliably costs this athlete time on short benchmarks"; "soreness reports have not correlated with outcomes — weight them less."
5. Misses in the *fast* direction get the same treatment — beating the prediction by 15% is the same size of model failure as missing by 15%.

## 7. Backtest

### What it is, plainly

You shouldn't have to use Athletic Standard for six months to find out whether the predictions are any good. A backtest answers it in one command by **time-traveling through the data you already imported**: for each benchmark result already in your file, pretend it's the day before that workout — the agent is shown only data from before that date (`context --as-of`), asked to predict, and then we compare its prediction to the result we already know happened. Prediction with the answer key hidden, repeated across your whole history.

### Worked example

Your imported history contains three Fran results:

| Date | Actual result |
|---|---|
| 2025-11-02 | 5:10 |
| 2026-03-15 | 4:48 |
| 2026-06-02 | 4:41 |

The backtest replays:

- **2026-03-15:** agent sees everything up to 2026-03-14 (including the 5:10 from November) → predicts, say, 4:55 → actual was 4:48 → error 2.4%.
- **2026-06-02:** agent sees everything up to 2026-06-01 (including both prior Frans) → predicts 4:44 → actual was 4:41 → error 1.1%.

- **2025-11-02 is not replayed.** The prediction method is benchmark-anchored — it starts from your previous result on that same benchmark and adjusts for current readiness. On 2025-11-01 there *was* no previous Fran, so there is nothing to anchor to; the agent would be guessing from general fitness, which is a different (and much weaker) kind of estimate. Scoring those guesses alongside real anchored predictions would pollute the accuracy number with a case the tool explicitly doesn't claim to handle. So the rule is: **a result is replayed only if at least one earlier result of the same benchmark exists.** First-ever results on each benchmark serve as anchors, not test cases.

### Output

```
replayed 9 benchmark results (2 skipped: first-ever result, nothing to anchor to)
median abs error: 4.2%   ·   mean: 5.1%
calibration: actual within stated range 7/9 (78%)
by history depth: 1 prior → 9.8% (n=3) · 2-3 priors → 4.0% (n=4) · 4+ → 2.1% (n=2)
```

- **median/mean abs error** — how far off the predictions were, overall.
- **calibration** — when the agent stated a range, how often reality landed inside it. This should roughly match the stated confidence; a well-calibrated forecaster knows when it's likely to be wrong.
- **by history depth** — the cold-start answer, measured: how accuracy improves as the athlete accumulates results on a benchmark. This line tells a new user how much data they need before trusting the numbers, measured from their own data rather than asserted.

### Roles in the codebase

- Backtest is the **regression test for the harness**: any change to the prompt, the evidence package, or the summaries must not worsen the fixture athlete's backtest score.
- CI runs the **planted-contradiction eval** on the fixture file: a long-horizon summary says sleep is fine while the raw rows show two terrible recent nights; assert the prediction responds to the raw rows. This is the falsifiable check against summary over-indexing (§5).

## 8. Importers (v1)

- **WHOOP CSV export** — physiological cycles, sleeps, workouts → `hrv_rmssd`, `resting_heart_rate`, `sleep_session`, `workout_session`.
- **Apple Health export.zip** — streaming XML parse of export.xml (these get huge); pulls HRV (SDNN), resting HR, sleep stages, workouts with segments.
- **Oura CSV export** — sleep, readiness contributors → HRV, RHR, sleep sessions.

Each importer is a mapping table in code + documented in SPEC.md's prior-art appendix. Unknown rows are skipped with a count, never guessed at. No developer accounts, OAuth, or Docker required for any of these — download your export, run `ath import`.

## 9. Tech stack

TypeScript, Node ≥ 20, published to npm as `athleticstandard`. Dependencies kept minimal and boring: `zod` (schemas → source of truth), `zod-to-json-schema`, `commander` (CLI), `papaparse` (CSV), `sax` (streaming XML), official Anthropic/OpenAI SDKs (backtest only). Vitest for tests. No framework; `tsup` to bundle.

**Tests:** unit tests for every importer against fixture exports; `check` rule tests (each tier violation caught); `context` snapshot tests; grading-procedure tests (hit, each miss severity, no-open-prediction case, dossier contents); backtest harness test with a mocked LLM; the planted-contradiction eval (real LLM, runs on demand, not in default CI).

**Fixture:** `examples/demo-athlete/` — a synthetic but realistic athlete: ~14 months of daily WHOOP-shaped data, 11 benchmark results across 4 benchmarks, soft signals sprinkled realistically. Used by tests, backtest demo, and README examples.

## 10. README

Order: pitch line → 60-second quickstart (`npx athleticstandard init`, `import`, then "open your agent and talk") → a real prediction/grade transcript → `backtest` output → the two-tier diagram and why → format-in-30-seconds with a sample JSON snippet → prior art and positioning → roadmap → explicit non-goals (not an app, not a coach, not medical advice).

## 11. Explicitly out of v1 (roadmap)

- **Open Wearables connector** (`ath pull`) — automated device sync via a self-hosted [Open Wearables](https://github.com/the-momentum/open-wearables) instance (MIT-licensed, runs locally via docker compose with its own bundled PostgreSQL; no subscriptions — deployments bring their own free per-provider OAuth credentials). The spec adopts OW's vocabulary and canonical units now so this connector is mechanical later.
- **Hosted OAuth broker** ("ath connect") — one shared app registration per provider so users skip creating developer apps; the Home Assistant/Nabu Casa pattern. A standing service with ToS/rate-limit obligations — deliberately deferred. Connector layer treats credentials as pluggable (bring-your-own keys or a broker URL) so no client code changes when it exists.
- **MCP server** — per the 2026 CLI-vs-MCP evidence, MCP earns its 4–32x token overhead only for live systems with auth/state. Athletic Standard v1 is local files and deterministic transforms: CLI + Skill. MCP re-enters if/when the broker (a live authenticated system) exists.
- Garmin FIT / Strava importers, multi-athlete files, encryption at rest, any web UI.

## 12. Build order

1. Zod schemas + JSON Schema + `SPEC.md` + fixture file
2. `check`, `init`, `stats` (the file becomes real)
3. Importers (WHOOP → Apple → Oura)
4. `context`, `log`, `record-prediction`, `grade` (incl. §6 grading procedure)
5. The Skill
6. `backtest` + evals
7. README + polish

Each step lands as its own commit(s); the repo is coherent (builds, tests pass) after every step.

## 13. Process rule: build history

This folder (`build-history/`) permanently retains the spec and decision log for every plan we build, versioned (`v1/`, `v2/`, …), append-only, kept forever. Future plans must write their spec here before or as they are built. See `build-history/README.md`.
