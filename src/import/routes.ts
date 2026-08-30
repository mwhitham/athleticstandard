/**
 * Workout routes: turning a GPS track into splits.
 *
 * An Apple export carries a GPX file per outdoor workout in `workout-routes/`, with a
 * position and a timestamp for every point along the way. On its own a route says
 * where you went, which this format has no use for. What it yields once processed is
 * the thing a run prediction needs and a summary cannot give: how each kilometre
 * compared with the last, and how much climbing was involved.
 *
 * The raw coordinates are deliberately not stored. A GPS track starts and ends at
 * someone's home, and the format has no reason to hold that. Splits and elevation gain
 * are the useful residue, and they carry none of it.
 */

export interface TrackPoint {
  latitude: number;
  longitude: number;
  elevationM: number | null;
  at: string;
}

export interface RouteSplit {
  label: string;
  duration_s: number;
  distance_m: number;
}

export interface RouteSummary {
  start: string;
  end: string;
  splits: RouteSplit[];
  distanceM: number;
  elevationGainM: number;
}

/** One split per kilometre, matching how runners actually talk about a run. */
const SPLIT_DISTANCE_M = 1000;

/**
 * Ignore elevation changes below this between points.
 *
 * GPS altitude is noisy by several metres even when standing still, and summing every
 * positive wobble over a long run turns a flat course into a mountain. A threshold
 * discards the noise while keeping real climbing.
 */
const ELEVATION_NOISE_M = 1;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two positions. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Pull track points out of a GPX file.
 *
 * Parsed with regular expressions rather than an XML parser on purpose: a route file
 * is small, flat, and machine-written, and its shape does not vary. Points missing a
 * position or a time are skipped, since neither can be inferred.
 */
export function parseGpx(text: string): TrackPoint[] {
  const points: TrackPoint[] = [];
  const trkptPattern = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/g;

  let match: RegExpExecArray | null;
  while ((match = trkptPattern.exec(text)) !== null) {
    const attrs = match[1] ?? match[3] ?? "";
    const body = match[2] ?? "";

    const latitude = Number(/\blat\s*=\s*"([^"]+)"/.exec(attrs)?.[1]);
    const longitude = Number(/\blon\s*=\s*"([^"]+)"/.exec(attrs)?.[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const at = /<time>([^<]+)<\/time>/.exec(body)?.[1]?.trim();
    if (!at || Number.isNaN(Date.parse(at))) continue;

    const rawElevation = /<ele>([^<]+)<\/ele>/.exec(body)?.[1];
    const elevation = rawElevation === undefined ? NaN : Number(rawElevation);

    points.push({
      latitude,
      longitude,
      elevationM: Number.isFinite(elevation) ? elevation : null,
      at,
    });
  }

  return points;
}

/**
 * Splits and elevation gain from a track.
 *
 * Distance accumulates point to point, and a split closes each time another kilometre
 * is complete. The time for a split is interpolated at the boundary rather than
 * snapped to the nearest point, because points arrive every second or so and snapping
 * would put a second or two of error into every split.
 */
export function summarizeRoute(points: TrackPoint[]): RouteSummary | null {
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const startMs = Date.parse(sorted[0]!.at);

  let cumulativeM = 0;
  let elevationGainM = 0;
  let splitStartMs = startMs;
  let nextBoundaryM = SPLIT_DISTANCE_M;
  let lastElevationUsed = sorted[0]!.elevationM;

  const splits: RouteSplit[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;

    const segmentM = haversineM(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    );
    const previousCumulativeM = cumulativeM;
    cumulativeM += segmentM;

    if (current.elevationM !== null && lastElevationUsed !== null) {
      const rise = current.elevationM - lastElevationUsed;
      if (Math.abs(rise) >= ELEVATION_NOISE_M) {
        if (rise > 0) elevationGainM += rise;
        lastElevationUsed = current.elevationM;
      }
    } else if (current.elevationM !== null) {
      lastElevationUsed = current.elevationM;
    }

    // A single leg can cross more than one boundary if GPS dropped out.
    while (cumulativeM >= nextBoundaryM) {
      const previousMs = Date.parse(previous.at);
      const currentMs = Date.parse(current.at);
      const fraction = segmentM > 0 ? (nextBoundaryM - previousCumulativeM) / segmentM : 1;
      const boundaryMs = previousMs + (currentMs - previousMs) * Math.min(1, Math.max(0, fraction));

      splits.push({
        label: `km ${splits.length + 1}`,
        duration_s: Math.round((boundaryMs - splitStartMs) / 100) / 10,
        distance_m: SPLIT_DISTANCE_M,
      });

      splitStartMs = boundaryMs;
      nextBoundaryM += SPLIT_DISTANCE_M;
    }
  }

  // The remainder, when it is long enough to say anything about.
  const endMs = Date.parse(sorted[sorted.length - 1]!.at);
  const remainderM = cumulativeM - (nextBoundaryM - SPLIT_DISTANCE_M);
  if (remainderM >= 100) {
    splits.push({
      label: `km ${splits.length + 1} (partial)`,
      duration_s: Math.round((endMs - splitStartMs) / 100) / 10,
      distance_m: Math.round(remainderM),
    });
  }

  return {
    start: sorted[0]!.at,
    end: sorted[sorted.length - 1]!.at,
    splits,
    distanceM: Math.round(cumulativeM),
    elevationGainM: Math.round(elevationGainM),
  };
}
