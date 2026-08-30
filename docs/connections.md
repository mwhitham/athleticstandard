# Getting Data Into Athletic Standard: The Connections Study

**Researched August 2026.** Provider behavior changes; each section notes its sources. This is the living reference for what every connection path yields per provider and how Athletic Standard handles it. The governing decisions are D17–D22 in [`build-history/v1/decisions.md`](../build-history/v1/decisions.md).

## The principle

Every major wearable withholds its most valuable recovery data from Apple Health — universally including HRV, the signal Athletic Standard's predictions lean on hardest. The deepest data for each device lives behind that vendor's own connection (export file or API). Athletic Standard must therefore let users connect wearables **directly**, and treat Apple Health as one source among several — complete for Apple Watch's own data, incomplete for everyone else's.

Structurally this is already supported: every hard signal carries a `source` reference (vendor + kind), and imports deduplicate by (type, timestamp, source), so multiple paths can feed one file without double-counting — e.g. workouts via Apple Health and recovery data via WHOOP's CSV.

## What Athletic Standard actually needs

The prediction engine's core hard signals, in order of importance:

1. **HRV** (RMSSD preferred; SDNN accepted, never mixed — different statistics)
2. **Resting heart rate**
3. **Sleep** (duration, stages, efficiency)
4. **Workouts** (load, duration, HR, segments/splits)
5. Benchmark results (always hand-entered or agent-logged; no device knows what "Fran" is)

Grade each connection path against this list, not against total metric count.

---

## WHOOP

| Signal | CSV export (v1 path) | Direct API v2 | Via Open Wearables | Via Apple Health |
|---|---|---|---|---|
| HRV (RMSSD) | ✅ | ✅ `hrv_rmssd_milli` | ✅ implemented | ❌ **deliberately excluded** |
| Resting HR | ✅ | ✅ | ✅ | ✅ |
| Recovery score | ✅ | ✅ | ✅ | ❌ |
| Sleep stages + efficiency | ✅ | ✅ (stage totals, debt breakdown, resp. rate) | ✅ | ✅ (stages) |
| Workouts | ✅ | ✅ (+ HR zone durations, strain) | ✅ | ✅ (+ calories) |
| Strain | ✅ | ✅ | ⚠️ available, not yet implemented | ❌ |
| All-day HR | ❌ | ❌ (workout-only) | ❌ | ❌ |
| SpO2, skin temp | ✅ | ✅ | ✅ | SpO2 ✅ / temp ❌ |

- **Why Apple Health is lossy here:** WHOOP measures HRV as RMSSD during deep sleep; Apple Health stores HRV as SDNN. Rather than write incomparable numbers, WHOOP writes nothing — confirmed policy, unlikely to change. Recovery and strain scores also never cross.
- **API access:** free developer account, self-service app registration (client id/secret), OAuth2. Scopes: `read:recovery`, `read:sleep`, `read:workout`, `read:cycles`, `read:body_measurement`. Webhooks available.
- **Open Wearables status:** recovery (score, RHR, HRV, SpO2, skin temp), sleep, and workouts fully implemented; hourly polling + webhooks; no steps (device has no pedometer).
- **Athletic Standard handling:** v1 = CSV export importer (loses nothing that matters). Fast-follow = OW connector or direct API pull. Never advise WHOOP-via-Apple-Health as primary.

Sources: trainconstant.com WHOOP/Apple Health sync tables; WHOOP v2 OpenAPI specs; openwearables.io provider quirks.

## Oura

| Signal | CSV export (v1 path) | Direct API v2 | Via Open Wearables | Via Apple Health |
|---|---|---|---|---|
| HRV (RMSSD) | ✅ daily avg | ✅ **5-minute intervals all night** | ✅ timeseries | ❌ |
| Resting HR | ✅ | ✅ (+ nightly avg HR) | ✅ (lowest HR as daily RHR) | ❌ |
| Readiness score + contributors | ✅ | ✅ (HRV balance, RHR trend, temp deviation) | ✅ (as recovery score + temp deviations) | ❌ |
| Sleep stages + efficiency | ✅ | ✅ (+ latency, respiratory rate) | ✅ | ✅ (stages, 1-min HR) |
| Workouts | ✅ | ✅ (no HR — Oura API limitation) | ✅ | ✅ |
| Temperature deviation | ✅ | ✅ | ✅ | ❌ |
| VO2 max estimate | ❌ | ✅ (`heart_health` scope) | ✅ | ❌ |

- **The standout:** Oura offers **personal access tokens** — an individual can call the API with a pasted token, no OAuth app registration at all. Long-lived tokens. This makes Oura the easiest direct-API integration of any provider.
- **Why Apple Health is lossy here:** no HRV, no RHR, no readiness cross into Apple Health (community workarounds exist via iOS Shortcuts hitting the API — evidence the gap is real).
- **Open Wearables status:** sleep, readiness→recovery, 24/7 HR + HRV timeseries implemented via webhooks; per-sleep avg HR/HRV not yet persisted.
- **Athletic Standard handling:** v1 = CSV export importer. Fast-follow = **direct API pull with a personal access token** (cheaper than requiring OW for Oura-only users) and/or OW connector. Never advise Oura-via-Apple-Health as primary.

Sources: openwearables.io Oura blog + provider quirks; api-evangelist Oura OpenAPI; Oura API docs; TheQuantifyingStack shortcuts repo.

## Garmin

| Signal | Export (v1 path) | Direct API | Via Open Wearables | Via Apple Health |
|---|---|---|---|---|
| HRV (RMSSD, overnight) | ⚠️ in account data export | ✅ HRV webhook type | ✅ 24/7 timeseries | ❌ |
| Resting HR | ⚠️ in account data export | ✅ dailies | ✅ | ❌ |
| Sleep stages | ✅ | ✅ | ✅ (+ efficiency, HR biometrics) | ✅ (analysis only) |
| Workouts + splits | ✅ **FIT files** (per-second detail) | ✅ + activity details | ✅ (135+ type mappings) | ✅ (all-day HR, calories; **no GPS routes**) |
| Stress / Body Battery | ❌ | ✅ | ✅ (provider-specific types) | ❌ |

- **The catch:** Garmin's Health API requires **developer program application and approval** — not self-service. This makes bring-your-own-credentials harder for individuals than WHOOP/Oura.
- **Export reality:** Garmin Connect offers a full account data export (GDPR-style, includes FIT files and wellness data) — clunky but complete. FIT files carry the richest workout telemetry of any source (per-second GPS/HR — where run splits and HYROX station analysis would come from).
- **Open Wearables status:** the deepest OW integration — webhook-only (16 data types), 24/7 timeseries including HRV, backfill orchestration to 5 years.
- **Athletic Standard handling:** v1 = none dedicated (Garmin wearers can use the Apple Health export for workouts/sleep, accepting the HRV gap). Roadmap = FIT importer (also serves HYROX/run segment analysis) and the OW connector for those with API approval. Honest advice: Garmin is our weakest automated story today.

Sources: openwearables.io provider quirks; sensai.fit Apple Health sync comparison; Garmin developer program docs.

## Apple Watch (native)

| Signal | Health export.zip (v1 path) | Via iOS app (HealthKit, v2 direction) |
|---|---|---|
| HRV (**SDNN**, not RMSSD) | ✅ | ✅ |
| Resting HR | ✅ | ✅ |
| Sleep stages | ✅ | ✅ |
| Workouts + splits + running dynamics | ✅ | ✅ |
| VO2 max, HR recovery, wrist temp | ✅ | ✅ |

- **The exception to the lossiness rule:** for the Watch's *own* data, Apple Health *is* the direct connection — nothing is withheld. An Apple Watch athlete gets a complete Athletic Standard picture from Apple Health alone.
- **The caveat:** Apple's HRV is SDNN; WHOOP/Oura/Garmin use RMSSD. Athletic Standard stores these as distinct types (`hrv_sdnn` vs `hrv_rmssd`) and they must never be baselined together.
- **No cloud API exists.** On-device only: export.zip (manual, v1) or an app with HealthKit access (automated, v2). This is the only provider where automation inherently requires an iOS app.
- **Athletic Standard handling:** v1 = export.zip importer (first-built, per decision D15). v2 = the iOS companion app (near-automatic: HealthKit background delivery → Athletic Standard file in iCloud Drive).

## Open Wearables (the aggregator option)

- **What it is:** MIT-licensed self-hosted server (Docker: FastAPI + PostgreSQL + Redis). Solves OAuth flows, webhooks, polling, canonical units, dedup across all providers above plus Polar, Suunto, Fitbit, Strava, Ultrahuman, Health Connect.
- **What it costs the user:** running Docker on an always-on machine + registering their own developer app per provider (free, but a real step; Garmin additionally needs approval). No subscriptions anywhere.
- **What it uniquely enables:** multi-provider users (e.g. WHOOP + Garmin watch), continuous background sync, Android/Health Connect, and provider-specific extras (body battery, stress).
- **Athletic Standard handling:** the `ath pull` connector (fast-follow) reads OW's REST API and maps its already-canonical units 1:1 into Athletic Standard types — the spec was deliberately aligned with OW's vocabulary to make this mechanical.

---

## The advice we give users

By device, best-first:

| You wear | Today (v1) | When automation ships | Avoid |
|---|---|---|---|
| **Apple Watch** | Health app → Export All Health Data → `ath import export.zip` | the Athletic Standard iOS app (v2) | — (Apple Health is complete for you) |
| **WHOOP** | WHOOP app → Data Export → `ath import whoop.csv` | OW connector or direct API pull | relying on Apple Health — you'd lose HRV, recovery, strain |
| **Oura** | web dashboard → export → `ath import oura.csv` | direct pull with a personal access token (no OAuth app needed) or OW | relying on Apple Health — you'd lose HRV, RHR, readiness |
| **Garmin** | Apple Health export for workouts/sleep (accept the HRV gap) | FIT importer; OW if you have API approval | expecting HRV via Apple Health |
| **Multiple devices** | import each export; dedup handles overlap | Open Wearables (built for exactly this) | mixing SDNN and RMSSD baselines (Athletic Standard prevents this by typing them separately) |

Universal advice, stated in the README: a CSV or zip export has the data you need and costs nothing to set up. Connecting an API later is easier, not richer. (Garmin excepted, where the export path has a real HRV gap until the FIT importer ships.)

## How this maps to the build

| Tier | What | Status |
|---|---|---|
| 1 (v1) | Importers: Apple Health export.zip, WHOOP CSV, Oura CSV | in scope now |
| 2 (fast-follow) | `ath pull`: Oura personal-token pull (easiest), OW connector (multi-provider), WHOOP direct | designed-for (source kinds + dedup already in the spec) |
| 2.5 (roadmap) | Garmin FIT importer | roadmap |
| 3 (v2) | iOS companion app for Apple Watch users | v2 flagship |
