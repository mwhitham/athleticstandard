# Athletic Standard v1 — Decision Log

The choices made for v1, with the alternatives that were considered and rejected. Recorded because the rejected options are the part everyone forgets. New v1 decisions are appended here.

## D1. Product shape: an open file format + one reference agent, not an app

The product is a versioned file format for an athlete's training and recovery state, designed for AI agents to reason over, plus one reference agent proving it works. Not an app, not a coach, not a service.

## D2. The differentiator: two-tier signal separation, enforced structurally

- **Hard signals** — device-measured, high trust (HRV, sleep, resting HR, benchmark times, run splits, HYROX stations). Drive predictions.
- **Soft signals** — self-reported, low confidence, optional, timestamped (mood, soreness, stress, nutrition). Adjust confidence and explain misses.

Enforced by the schema and validator, not by convention: hard signals require device provenance; soft signals may not claim it. Typed-in numbers ("HRV was 54") get a `manual` source — stored as measurements but visibly lower trust. Photo-derived entries (food photos) are soft signals with `provenance.via: photo` and the interpreting model recorded.

## D3. Reference agent's one job: benchmark-anchored readiness prediction

Predict performance on a named benchmark (e.g. Fran), show reasoning, get graded against the actual result. Falsifiable. Misses are explained from soft signals. Rejected: general coaching, readiness scores without a testable claim ("you're 82% recovered" is unfalsifiable adjectives).

## D4. Local-first, no database

The file is the database. Usable with nothing but a text editor and an LLM. No server, no accounts, no Docker for the core loop. This was elevated to an explicit spec principle after the requirement that everything run locally without subscriptions.

## D5. Data ingestion: anchor the spec to Open Wearables, but don't depend on it in v1

[Open Wearables](https://github.com/the-momentum/open-wearables) (MIT, self-hosted, docker compose with bundled PostgreSQL + Redis) was evaluated as the ingestion layer. Findings:

- It solves per-provider plumbing (Garmin webhooks, Polar/Suunto polling, WHOOP OAuth, Apple SDK) and normalizes to canonical units. No subscription — but each *deployment* registers its own free developer app per provider (per-deployment, not per-user; Oura offers personal tokens; Garmin has an approval process).
- It's early-stage: workout sync works for Garmin/Polar/Suunto; core health endpoints (sleep/HRV summaries) were still "in development" at planning time.

Decision: **adopt OW's vocabulary, canonical units, and Events/Time-Series split in the Athletic Standard spec now** (so a future connector is mechanical), but v1 ingestion is **file-based imports** (WHOOP CSV export, Apple Health export.zip, Oura CSV) which need no infra and work today. The `ath pull` OW connector is the first fast-follow.

What Athletic Standard adds over OW (why Athletic Standard exists at all): the soft-signal tier, benchmark definitions/results, the prediction ledger, and being a portable file rather than a database+API. Open Wearables moves data between devices and a store. Athletic Standard is the file you keep.

## D6. Hosted OAuth broker: deferred, designed-for

"Be everyone's proxy" so users skip creating developer apps (the Home Assistant/Nabu Casa and rclone shared-client-ID pattern). Viable and a plausible second act, but it's a standing service (uptime, token custody, per-app rate limits, per-provider ToS review). Deferred past v1; the connector layer treats OAuth credentials as pluggable (bring-your-own keys or broker URL) so no client changes when it exists.

## D7. Agent interface: CLI + Skill, not MCP (reversed twice during planning — final)

Path taken during planning, recorded honestly: started as "CLI with an embedded LLM," pivoted to "MCP server" on the argument that users talk to agents rather than memorize commands, then **researched properly and landed on CLI + Skill**:

- 2026 evidence (Scalekit, Apideck benchmarks; Perplexity's public retreat from internal MCP): MCP costs 4–32x tokens vs equivalent CLI calls and earns it only for live systems with auth/state/sessions.
- Agent Skills (`SKILL.md`, open standard since Dec 2025, portable across Claude Code, Cursor, Codex, Gemini CLI) are the converged answer for procedure + judgment over local data: ~100 tokens until triggered.
- Athletic Standard is local files + deterministic transforms + a reasoning procedure: the textbook CLI + Skill case.

Final shape: **deterministic CLI** (no NL parsing, no LLM calls except `backtest`) + **a Skill** that teaches the user's own agent to parse natural language, log with confirmation, and run the prediction/grading procedures. The NL understanding happens in the agent the user already talks to — no second LLM inside the CLI, and no separate API key for daily use. MCP is noted (not a local/remote issue — stdio MCP servers are local; a cost/fit issue) and reserved for the broker if it ever exists.

Humans touch the terminal twice (`init`, `import`); everything else is conversation with their agent. `backtest` is the one other command worth typing.

## D8. Language: TypeScript (decided on criteria, after a flip-flop worth recording)

Initially Python "for data handling" (a default, not a decision), briefly TypeScript-because-pnpm (pattern matching, called out as such). Final decision on stated criteria:

1. `npx`/`pnpm dlx` zero-install execution — the two-command onboarding depends on it; Python's `uvx`/`pipx` are a step behind in ubiquity.
2. Schema-first project: Zod as single source of truth with JSON Schema generated from it — spec and implementation cannot drift.
3. The workload (CSV/XML parsing, simple arithmetic, file I/O) doesn't need Python's scientific stack — the only real argument on the other side.

Distribution: published to the npm registry; pnpm/npm/bun all work (`pnpm add -g athleticstandard`, `pnpm dlx athleticstandard`, `npx athleticstandard`).

## D9. Anti-over-indexing: raw rows always ride along, summaries carry receipts

Concern: an LLM handed a tidy summary parrots it instead of reading data. Mitigations (structural, not aspirational): the evidence package always includes the raw 28-day window as day-by-day rows and all soft signals verbatim; long-horizon summaries carry n, date range, and spread; the Skill demands dated, valued citations in reasoning; CI includes a planted-contradiction eval (summary says sleep is fine, raw rows show two bad nights — prediction must respond to the rows).

## D10. Evaluation is built into the format and the tool

- The predictions ledger stores predictions made before attempts, then the results (append-only by convention).
- `ath backtest` answers "is this any good / how much data does it need" by replaying history with `context --as-of` truncation. Anchor rule: only results with at least one earlier result on the same benchmark are replayed (benchmark-anchored prediction has nothing to anchor to on a first-ever result; scoring unanchored guesses would pollute the metric). Reports median/mean error, calibration coverage, and error-by-history-depth (the measured cold-start curve).
- Backtest doubles as the regression test for any harness change.

## D11. Grading and misses follow a fixed procedure

Hit/miss classified deterministically by the CLI (in/out of stated range; miss severity by error %: <5% minor, 5–15% significant, >15% severe). Hits get no analysis (avoids post-hoc storytelling). Misses get a structured `miss_analysis` where every candidate cause must reference a real signal in the file (precedence: day-of hard signals → 72h soft signals → 7-day anomalies), honest `unexplained: true` is required over fabricated stories (with one follow-up question to the user, logged as a soft signal), and a one-sentence `lesson` feeds future predictions via the evidence package. Fast misses are analyzed the same as slow ones.

## D12. Naming: build under `athleticstandard`

Final name unresolved (AthleteCapacity was clean everywhere including the .com but flagged as too heavy; "engine" family unexplored). Working name `athleticstandard` matches the repo; naming is confined to file extension, CLI/package name, and the version field so a rename is a find-replace.

## D13. Process: permanent build history

Every plan's spec is written into `build-history/<version>/` before or as it is built. Within a version, all decisions go in that version's `decisions.md` — append new D-numbers, don't rewrite earlier ones. If a decision is superseded, append a new D that says so. Supporting research — the long write-up, not a restatement of the D-number — goes in `appendix/` in the same version folder and is linked from the decision. A new version folder is only for a new plan (`v2/`). Don't create addendum files.

## D14. Positioning narrowed (2026-08-29)

Before the build, the use case was checked against what the major labs shipped in 2026:

- **OpenAI — ChatGPT Health** (July 2026): Apple Health, medical records, MyFitnessPal, Peloton, Function. Health data informs any conversation.
- **Google — Health Coach** (May 2026): Fitbit app became Google Health; Gemini coach. Photo logging of meals and gym whiteboards. Requires Fitbit or Pixel Watch.
- **Anthropic — Claude health connectors** (Jan 2026): Apple Health, Android Health Connect, Function, HealthEx.
- **Apple:** killed the standalone AI health coach (Feb 2026); features shipping into the Health app instead.

"Connect your wearable data to an AI and talk about it" is now a built-in ChatGPT and Claude feature. Athletic Standard must not be framed that way. Photo meal logging stays in the format (it has to represent it) but is not a differentiator.

What still stands: write a prediction before the workout and record whether it was right; keep an open portable file; keep measured signals apart from self-reported ones, including named benchmarks.

README must not lead with "chat with your fitness data."

Full write-up: [appendix/pressure-test.md](appendix/pressure-test.md).

## D15. Apple Health export.zip is the first importer

Both OpenAI and Anthropic standardized on Apple Health as the consumer aggregation hub — every wearable syncs into it. WHOOP/Oura CSVs second. Open Wearables remains the self-hosted roadmap path.

## D16. Raw exports first, automation later

- **Tier 1 (v1):** Apple Health "Export All Health Data" zip, WHOOP CSV, Oura CSV → `ath import`. No mobile app, no OAuth, no infra.
- **Tier 2 (fast-follow):** WHOOP/Oura/Garmin cloud APIs via `ath pull` / Open Wearables connector. Still no mobile app.
- **Tier 3 (deferred):** automatic Apple Health sync. HealthKit is on-device; Apple offers no cloud API, so this needs an iPhone app. Not v1, not fast-follow.

## D17. Connect wearables directly (2026-08-29)

Follow-up to D15/D16: WHOOP via Open Wearables has more data than WHOOP via Apple Health.

Every major wearable withholds its most useful recovery data from Apple Health, including HRV:

- **WHOOP → Apple Health:** no HRV (RMSSD vs SDNN), no recovery score, no strain.
- **Oura → Apple Health:** no HRV, no RHR, no readiness.
- **Garmin → Apple Health:** no HRV, no RHR; workouts/sleep cross.
- **Apple Watch:** the exception — its own data is complete in Apple Health.

Users must be able to connect wearables directly. Apple Health is the complete source for Apple Watch data and incomplete for everything else. Per-signal `source` plus dedup by type/timestamp/source already lets multiple paths feed one file.

Full write-up: [appendix/connections.md](appendix/connections.md). Living tables: [`docs/connections.md`](../../docs/connections.md).

## D18. The iOS app (v2) is for Apple Watch users

It does not replace direct connections. For WHOOP/Oura wearers an Apple Health-only app would drop HRV and recovery. v2 automation is app-for-Watch plus direct API / Open Wearables for everyone else.

## D19. Oura personal access token is in the fast-follow tier

No OAuth app registration; long-lived pasted token.

## D20. Garmin: weakest automated path

The API needs approval. v1 advice: Apple Health export for workouts/sleep, accept the HRV gap. FIT importer is on the roadmap (also the source for run-split / HYROX segment analysis).

## D21. Export files for v1

A CSV or zip export has the data you need and costs nothing to set up. Connecting an API later is easier, not richer (Garmin excepted until the FIT importer ships). Per-device advice lives in `docs/connections.md`.

## D22. SDNN and RMSSD never mix

Apple measures HRV as SDNN, everyone else as RMSSD. The format types them separately (`hrv_sdnn` / `hrv_rmssd`). Baselines must never combine them.

## D23. File extension is `.ath.json` (2026-08-29)

Default filename `athlete.ath.json`, not `.athleticstandard.json`. Filenames are typed constantly; the extension matches the `ath` CLI; same idea as `typescript` → `.ts`. Collision risk of `*.ath.json` is negligible.

The full `athleticstandard` name stays on identity surfaces: the npm package, the schema filename and `$id` URL (`athleticstandard.ai`), and the `athleticstandard_version` field inside the file.

Supersedes the `.athleticstandard.json` extension used in `spec.md` §2.

## D24. Say the rule in plain words (2026-08-30)

Committed writing — SPEC, docs, comments, CLI copy, Skills, README, and this file — should read like an explanation to a teammate.

- Short sentences. Ordinary words. State what the thing is and what it does.
- No slogans. No metaphor used as if it were the rule. No antithesis wordplay (*an* vs *the*, "X is the pipe, Y is the document", "never a data upgrade").
- Don't use "vibes", "bet", "scoreboard", "on-ramp", or "doctrine" as stand-ins for the actual idea.
- Named principles are allowed when they name a real rule: "two-tier wall", "the file is the database", "not an app, not a coach, not medical advice". After the name, state the rule in ordinary words in the same paragraph.

