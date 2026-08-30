import { describe, expect, it } from "vitest";
import { ATHLETIC_STANDARD_VERSION, type AthleticStandardFileT } from "../src/schema.js";
import { baselineFor } from "../src/stats.js";

function fileWithHrv(points: { recorded_at: string; value: number }[]): AthleticStandardFileT {
  return {
    athleticstandard_version: ATHLETIC_STANDARD_VERSION,
    athlete: {},
    sources: [{ id: "whoop-1", kind: "wearable", vendor: "whoop" }],
    hard_signals: points.map((p) => ({
      type: "hrv_rmssd" as const,
      value: p.value,
      unit: "ms" as const,
      recorded_at: p.recorded_at,
      source: "whoop-1",
    })),
    soft_signals: [],
    benchmarks: [],
    predictions: [],
  };
}

describe("baselineFor", () => {
  it("orders by instant, not string, so offset timestamps pick the true latest", () => {
    // 2026-08-30T20:00:00-07:00 == 2026-08-31T03:00:00Z, which is after 01:00Z.
    // Lexicographic string compare would pick the Z timestamp as "later".
    const file = fileWithHrv([
      { recorded_at: "2026-08-31T01:00:00Z", value: 50 },
      { recorded_at: "2026-08-30T20:00:00-07:00", value: 70 },
    ]);
    const b = baselineFor(file, "hrv_rmssd");
    expect(b).not.toBeNull();
    expect(b!.to).toBe("2026-08-30");
    expect(b!.mean).toBe(60);
  });

  it("does not assume input order when reporting the window start", () => {
    const file = fileWithHrv([
      { recorded_at: "2026-08-20T06:00:00Z", value: 80 },
      { recorded_at: "2026-08-01T06:00:00Z", value: 40 },
      { recorded_at: "2026-08-10T06:00:00Z", value: 60 },
    ]);
    const b = baselineFor(file, "hrv_rmssd");
    expect(b).not.toBeNull();
    expect(b!.from).toBe("2026-08-01");
    expect(b!.to).toBe("2026-08-20");
    expect(b!.n).toBe(3);
    expect(b!.mean).toBe(60);
  });

  it("excludes points older than the trailing window of the latest instant", () => {
    const file = fileWithHrv([
      { recorded_at: "2026-01-01T00:00:00Z", value: 10 },
      { recorded_at: "2026-08-01T00:00:00Z", value: 50 },
      { recorded_at: "2026-08-30T00:00:00Z", value: 70 },
    ]);
    const b = baselineFor(file, "hrv_rmssd", 90);
    expect(b).not.toBeNull();
    expect(b!.n).toBe(2);
    expect(b!.mean).toBe(60);
    expect(b!.from).toBe("2026-08-01");
    expect(b!.to).toBe("2026-08-30");
  });
});
