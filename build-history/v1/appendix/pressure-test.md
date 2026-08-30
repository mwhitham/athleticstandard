# Frontier-lab pressure test (2026-08-23 → 2026-08-29)

Informed **D14–D16**. The decisions themselves are in [`../decisions.md`](../decisions.md).

Before starting the build, the use case was pressure-tested against what the major labs shipped in 2026.

## The landscape as of August 2026

- **OpenAI — ChatGPT Health** (July 2026, all US users incl. free tier): connects Apple Health, medical records (Epic, Oracle, One Medical), MyFitnessPal, Peloton, Function. Health data informs any conversation. ~300M health queries/week.
- **Google — Health Coach** (May 2026, global): Fitbit app became Google Health; Gemini-powered 24/7 coach at $9.99/mo (bundled with AI Pro/Ultra). Adapts to goals/injuries; photo logging of meals and gym whiteboards. Requires Fitbit or Pixel Watch.
- **Anthropic — Claude health connectors** (Jan 2026, US Pro/Max): Apple Health, Android Health Connect, Function, HealthEx. Conversational analysis of sleep/HR/training trends.
- **Apple — retreat**: killed the standalone AI health coach (Project Mulberry/Health+) Feb 2026 after leadership change; features shipping piecemeal into the Health app instead.

## What this commoditized

1. **"Connect your wearable data to an AI and talk about it"** — now a built-in feature of ChatGPT and Claude. Athletic Standard must never be framed this way.
2. **Photo meal logging** — Google ships it. Stays in the spec (the format must represent it) but is not a differentiator.

## What still stands

1. **A prediction written before the workout, graded after, plus a backtest.** No lab product makes a testable prediction and prints its own error rate — and structurally none will (OpenAI was sued over health advice the day ChatGPT Health launched; no legal department ships a public list of its own misses). An open-source tool can.
2. **The open portable file.** 2026 produced four closed AI-health silos (OpenAI, Google, Anthropic, Apple). Nothing exportable, diffable, or portable between agents; track records locked in. Proliferating silos is historically the moment open interchange formats matter.
3. **Two-tier trust separation + sport-specificity.** Every lab product ingests device data and chat claims into one undifferentiated soup; none model named benchmarks (Fran, HYROX stations) or scaling.

## Grading procedure, restated

Write the prediction before the workout, then record whether it was right. Result inside the predicted range → one-line record, done. Outside the range → the agent must explain the miss using only evidence recorded in the file (sleep, HRV, reported soreness); if nothing explains it, it must say "unexplained" and ask the user one question rather than invent a cause. Each miss ends in a one-sentence lesson shown to the agent at the next prediction. The accumulated graded ledger is the product's core artifact — the thing no lab product will ever show.
