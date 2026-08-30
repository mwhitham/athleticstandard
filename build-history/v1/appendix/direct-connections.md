# Direct connections (2026-08-29)

Informed **D17–D22**. The decisions themselves are in [`../decisions.md`](../decisions.md). The living per-provider tables are in [`docs/connections.md`](../../../docs/connections.md).

Follow-up to D15/D16, prompted by the question: does WHOOP via Open Wearables get more data than WHOOP via an iOS app reading Apple Health? Answer: yes, decisively.

## Finding

Every major wearable withholds its most valuable recovery data from Apple Health — **universally including HRV**, the signal Athletic Standard predictions lean on hardest:

- **WHOOP → Apple Health:** no HRV (deliberate: RMSSD vs SDNN incompatibility), no recovery score, no strain. Sleep, RHR, respiratory rate, SpO2, workouts do cross.
- **Oura → Apple Health:** no HRV, no RHR, no readiness. Sleep, HR, respiratory rate, workouts cross.
- **Garmin → Apple Health:** no HRV, no RHR; workouts/sleep cross, push-only.
- **Apple Watch:** the exception — its own data (HRV as SDNN, RHR, sleep stages, workouts) is complete in Apple Health.

The deep data lives behind each vendor's own connection: WHOOP API v2 (`hrv_rmssd_milli`, recovery score, sleep-debt breakdown, HR zones), Oura API v2 (5-minute HRV intervals all night, readiness contributors, personal access tokens — no OAuth app needed), Garmin Health API (overnight HRV, 16 webhook data types, but requires developer-program approval).
