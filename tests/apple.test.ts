import { describe, expect, it } from "vitest";
import { beatOffsetMs, parseAppleDate } from "../src/import/apple.js";

/** A one-minute HRV reading, the shape Apple's export writes. */
const START = "2026-08-09T06:12:00-07:00";
const END = "2026-08-09T06:13:01-07:00";

describe("parseAppleDate", () => {
  it("keeps the offset, since a local time without one is not an instant", () => {
    expect(parseAppleDate("2026-08-09 06:12:00 -0700")).toBe("2026-08-09T06:12:00-07:00");
  });

  it("refuses a date it cannot read rather than guessing", () => {
    expect(parseAppleDate("9 Aug 2026, 6:12am")).toBeNull();
  });
});

describe("beatOffsetMs", () => {
  it("reads a 24-hour clock", () => {
    expect(beatOffsetMs(START, END, "6:12:30.50")).toBe(30_500);
    expect(beatOffsetMs(START, END, "06:12:30.50")).toBe(30_500);
  });

  it("reads a 12-hour clock, whatever marks the half of the day", () => {
    // The marker is ignored rather than translated. Knowing which language wrote
    // "PM" is unnecessary when the record states its own window.
    expect(beatOffsetMs(START, END, "6:12:30.50 AM")).toBe(30_500);
    expect(beatOffsetMs(START, END, "오전 6:12:30.50")).toBe(30_500);
    expect(beatOffsetMs(START, END, "6:12:30.50 a.m.")).toBe(30_500);
  });

  it("reads a comma as the decimal separator", () => {
    expect(beatOffsetMs(START, END, "6:12:30,50")).toBe(30_500);
  });

  it("uses the window to settle what a 12-hour clock leaves ambiguous", () => {
    const afternoonStart = "2017-10-31T13:40:43+00:00";
    const afternoonEnd = "2017-10-31T13:41:54+00:00";
    expect(beatOffsetMs(afternoonStart, afternoonEnd, "1:40:45.22 PM")).toBe(2_220);
    expect(beatOffsetMs(afternoonStart, afternoonEnd, "13:40:45.22")).toBe(2_220);
    // 6:12 in the morning cannot belong to an afternoon reading.
    expect(beatOffsetMs(afternoonStart, afternoonEnd, "6:12:30.50")).toBeNull();
  });

  it("handles noon and midnight, which a 12-hour clock both write as 12", () => {
    expect(beatOffsetMs("2026-08-09T12:00:00-07:00", "2026-08-09T12:01:01-07:00", "12:00:30.00")).toBe(
      30_000,
    );
    expect(
      beatOffsetMs("2026-08-09T00:00:00-07:00", "2026-08-09T00:01:01-07:00", "12:00:30.00 AM"),
    ).toBe(30_000);
  });

  it("wraps a window that crosses midnight", () => {
    const offset = beatOffsetMs("2026-08-09T23:59:40-07:00", "2026-08-10T00:00:41-07:00", "12:00:15.00 AM");
    expect(offset).toBe(35_000);
  });

  it("returns null for a clock that fits nowhere in the window", () => {
    expect(beatOffsetMs(START, END, "quarter past six")).toBeNull();
    expect(beatOffsetMs(START, END, "99:99:99")).toBeNull();
    expect(beatOffsetMs(START, END, "6:45:00.00")).toBeNull();
  });

  it("still places a beat when the record states no end time", () => {
    expect(beatOffsetMs(START, null, "6:12:30.50")).toBe(30_500);
  });
});
