# v1 Addendum 2 — Direct connections principle (2026-08-29)

Follow-up research to Addendum 1's D15/D16, prompted by the question: does WHOOP via Open Wearables get more data than WHOOP via an iOS app reading Apple Health? Answer: yes, decisively. Full study in [`docs/connections.md`](../../docs/connections.md) (living doc; this addendum records the decisions).

## Finding

Every major wearable withholds its most valuable recovery data from Apple Health — **universally including HRV**, the signal Athletic Standard predictions lean on hardest:

- **WHOOP → Apple Health:** no HRV (deliberate: RMSSD vs SDNN incompatibility), no recovery score, no strain. Sleep, RHR, respiratory rate, SpO2, workouts do cross.
- **Oura → Apple Health:** no HRV, no RHR, no readiness. Sleep, HR, respiratory rate, workouts cross.
- **Garmin → Apple Health:** no HRV, no RHR; workouts/sleep cross, push-only.
- **Apple Watch:** the exception — its own data (HRV as SDNN, RHR, sleep stages, workouts) is complete in Apple Health.

The deep data lives behind each vendor's own connection: WHOOP API v2 (`hrv_rmssd_milli`, recovery score, sleep-debt breakdown, HR zones), Oura API v2 (5-minute HRV intervals all night, readiness contributors, personal access tokens — no OAuth app needed), Garmin Health API (overnight HRV, 16 webhook data types, but requires developer-program approval).

## Decisions

- **D17. Direct-connection principle.** The architecture must let users connect wearables directly. Apple Health is the complete source for Apple Watch data and incomplete for everything else. (Already structurally supported: per-signal `source` provenance + dedup by type/timestamp/source lets multiple paths feed one file.)
- **D18. The iOS app (v2) serves Apple Watch users; it does not replace direct connections.** Corrects the earlier framing that the app could displace Open Wearables: for WHOOP/Oura wearers it would silently lose HRV/recovery. v2 automation is app-for-Watch + direct-API/OW-for-others.
- **D19. Oura direct pull via personal access token** is added to the fast-follow tier (uniquely easy: no OAuth app registration; long-lived pasted token).
- **D20. Garmin honesty.** Weakest automated story (API needs approval). v1 advice: Apple Health export for workouts/sleep, accept the HRV gap; FIT importer on the roadmap (also the data source for run-split/HYROX segment analysis).
- **D21. User advice for the README:** a CSV or zip export has the data you need and costs nothing to set up. Connecting an API later is easier, not richer (Garmin excepted until the FIT importer ships). Per-device advice table lives in `docs/connections.md`.
- **D22. SDNN/RMSSD never mix.** Apple measures HRV as SDNN, everyone else as RMSSD; the format already types them separately (`hrv_sdnn` / `hrv_rmssd`) and baselines must never combine them. Elevated from implementation detail to recorded rule.
