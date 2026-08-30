import { describe, expect, it } from "vitest";
import { normalizeOffset, withOffset } from "../src/import/csv.js";

describe("normalizeOffset", () => {
  it("reads WHOOP's UTC-prefixed offsets", () => {
    // The real export writes `UTC-07:00`. An earlier version accepted only the
    // bare form, so every row in a real export was skipped.
    expect(normalizeOffset("UTC-07:00")).toBe("-07:00");
    expect(normalizeOffset("UTC+02:00")).toBe("+02:00");
    expect(normalizeOffset("UTC+05:30")).toBe("+05:30");
  });

  it("reads bare offsets too, in either punctuation", () => {
    expect(normalizeOffset("-0700")).toBe("-07:00");
    expect(normalizeOffset("-07:00")).toBe("-07:00");
    expect(normalizeOffset("+01:00")).toBe("+01:00");
  });

  it("treats every spelling of zero offset as UTC", () => {
    expect(normalizeOffset("Z")).toBe("Z");
    expect(normalizeOffset("UTC")).toBe("Z");
    expect(normalizeOffset("GMT")).toBe("Z");
    expect(normalizeOffset("UTC+00:00")).toBe("Z");
    expect(normalizeOffset("UTC-00:00")).toBe("Z");
    // WHOOP writes `UTCZ` for rows it recorded in UTC, seen around daylight-saving
    // transitions where the local offset is ambiguous.
    expect(normalizeOffset("UTCZ")).toBe("Z");
  });

  it("refuses what it cannot read rather than guessing", () => {
    // A named zone is not an offset: the same name means different offsets
    // depending on the date, so guessing would silently shift timestamps.
    expect(normalizeOffset("America/Los_Angeles")).toBeNull();
    expect(normalizeOffset("PST")).toBeNull();
    expect(normalizeOffset("")).toBeNull();
    expect(normalizeOffset(undefined)).toBeNull();
  });
});

describe("withOffset", () => {
  it("combines a local time with WHOOP's timezone column", () => {
    expect(withOffset("2026-08-09 06:20:00", "UTC-07:00")).toBe("2026-08-09T06:20:00-07:00");
  });

  it("fills in seconds when the export omits them", () => {
    expect(withOffset("2026-08-09 06:20", "UTC-07:00")).toBe("2026-08-09T06:20:00-07:00");
  });

  it("keeps an offset the value already carries", () => {
    expect(withOffset("2026-08-09T06:20:00-07:00", undefined)).toBe("2026-08-09T06:20:00-07:00");
    expect(withOffset("2026-08-09T06:20:00Z", undefined)).toBe("2026-08-09T06:20:00Z");
  });

  it("returns null on a blank or unreadable time", () => {
    // A local time with no offset is not a valid timestamp in this format.
    expect(withOffset("2026-08-09 06:20:00", undefined)).toBeNull();
    expect(withOffset(undefined, "UTC-07:00")).toBeNull();
    expect(withOffset("not a date", "UTC-07:00")).toBeNull();
  });
});
