import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { haversineM, parseGpx, summarizeRoute } from "../src/import/routes.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROUTE = resolve(here, "fixtures/exports/apple/workout-routes/route_2026-08-09_7.00pm.gpx");
const gpx = readFileSync(ROUTE, "utf8");

/** A straight northward track at a given pace, for building known cases. */
function track(paces: number[], pointEverySeconds = 5) {
  const startMs = Date.parse("2026-08-09T19:00:00-07:00");
  const points: string[] = [];
  let latitude = 37.7749;
  let t = startMs;
  let km = 0;
  let into = 0;
  for (let step = 0; step < 2000 && km < paces.length; step++) {
    const metresPerSecond = 1000 / paces[km]!;
    const distance = metresPerSecond * pointEverySeconds;
    latitude += distance / 111_320;
    into += distance;
    t += pointEverySeconds * 1000;
    points.push(
      `<trkpt lat="${latitude.toFixed(6)}" lon="-122.4194"><ele>20.0</ele><time>${new Date(t).toISOString()}</time></trkpt>`,
    );
    if (into >= 1000) {
      km++;
      into -= 1000;
    }
  }
  return `<gpx><trk><trkseg>${points.join("")}</trkseg></trk></gpx>`;
}

describe("haversineM", () => {
  it("measures a degree of latitude at about 111 km", () => {
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
  });

  it("returns zero for the same point", () => {
    expect(haversineM(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
  });
});

describe("parseGpx", () => {
  it("reads position, elevation, and time from every track point", () => {
    const points = parseGpx(gpx);
    expect(points.length).toBeGreaterThan(100);
    expect(points[0]!.latitude).toBeCloseTo(37.77, 1);
    expect(points[0]!.elevationM).not.toBeNull();
    expect(Number.isNaN(Date.parse(points[0]!.at))).toBe(false);
  });

  it("skips points with no time, since it cannot be inferred", () => {
    const withGap =
      '<gpx><trk><trkseg>' +
      '<trkpt lat="37.0" lon="-122.0"><ele>10</ele><time>2026-08-09T19:00:00Z</time></trkpt>' +
      '<trkpt lat="37.1" lon="-122.0"><ele>11</ele></trkpt>' +
      '</trkseg></trk></gpx>';
    expect(parseGpx(withGap)).toHaveLength(1);
  });

  it("handles a point with no elevation", () => {
    const noEle =
      '<gpx><trk><trkseg>' +
      '<trkpt lat="37.0" lon="-122.0"><time>2026-08-09T19:00:00Z</time></trkpt>' +
      '</trkseg></trk></gpx>';
    expect(parseGpx(noEle)[0]!.elevationM).toBeNull();
  });

  it("returns nothing for a file with no track", () => {
    expect(parseGpx("<gpx></gpx>")).toHaveLength(0);
  });
});

describe("summarizeRoute", () => {
  it("splits per kilometre with the time interpolated at the boundary", () => {
    // Two kilometres at five minutes each. Points arrive every five seconds, so
    // snapping to the nearest point instead of interpolating would cost seconds.
    const summary = summarizeRoute(parseGpx(track([300, 300])))!;
    expect(summary.splits[0]!.duration_s).toBeCloseTo(300, 0);
    expect(summary.splits[1]!.duration_s).toBeCloseTo(300, 0);
    expect(summary.splits[0]!.distance_m).toBe(1000);
  });

  it("shows a fade rather than averaging it away", () => {
    // This is the point of splits: the last kilometre was 40% slower, which a single
    // finishing time cannot tell you.
    const summary = summarizeRoute(parseGpx(track([300, 300, 420])))!;
    expect(summary.splits).toHaveLength(3);
    expect(summary.splits[2]!.duration_s).toBeGreaterThan(400);
  });

  it("labels a trailing part-kilometre as partial", () => {
    const summary = summarizeRoute(parseGpx(gpx))!;
    const last = summary.splits[summary.splits.length - 1]!;
    expect(last.label).toContain("partial");
    expect(last.distance_m).toBeLessThan(1000);
  });

  it("sums climbing while ignoring GPS altitude wobble", () => {
    // A flat course whose recorded elevation jitters by under a metre must not
    // accumulate into a hill.
    const jittery =
      '<gpx><trk><trkseg>' +
      Array.from({ length: 200 }, (_, i) => {
        const lat = 37.7749 + i * 0.00009;
        const ele = 20 + (i % 2 === 0 ? 0.4 : -0.4);
        const at = new Date(Date.parse("2026-08-09T19:00:00Z") + i * 5000).toISOString();
        return `<trkpt lat="${lat.toFixed(6)}" lon="-122.4194"><ele>${ele}</ele><time>${at}</time></trkpt>`;
      }).join("") +
      '</trkseg></trk></gpx>';
    expect(summarizeRoute(parseGpx(jittery))!.elevationGainM).toBe(0);
  });

  it("counts real climbing", () => {
    const climbing =
      '<gpx><trk><trkseg>' +
      Array.from({ length: 100 }, (_, i) => {
        const lat = 37.7749 + i * 0.00009;
        const at = new Date(Date.parse("2026-08-09T19:00:00Z") + i * 5000).toISOString();
        return `<trkpt lat="${lat.toFixed(6)}" lon="-122.4194"><ele>${20 + i * 2}</ele><time>${at}</time></trkpt>`;
      }).join("") +
      '</trkseg></trk></gpx>';
    // 99 rises of 2 m each.
    expect(summarizeRoute(parseGpx(climbing))!.elevationGainM).toBe(198);
  });

  it("returns nothing for a track too short to summarize", () => {
    expect(summarizeRoute([])).toBeNull();
    expect(
      summarizeRoute([
        { latitude: 37, longitude: -122, elevationM: 10, at: "2026-08-09T19:00:00Z" },
      ]),
    ).toBeNull();
  });

  it("orders by time rather than trusting file order", () => {
    const reversed = parseGpx(track([300, 300])).reverse();
    const summary = summarizeRoute(reversed)!;
    expect(Date.parse(summary.start)).toBeLessThan(Date.parse(summary.end));
    expect(summary.splits[0]!.duration_s).toBeGreaterThan(0);
  });
});
