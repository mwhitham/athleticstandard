/**
 * Unit conversion for imported measurements.
 *
 * Every converter returns null when it does not recognise the unit, and callers
 * turn that into a counted skip naming the unit. That rule matters more than it
 * looks: Apple's unit strings vary with locale and with the wearer's display
 * settings, and a silently wrong conversion is worse than a dropped row, because
 * a mile stored as a metre still looks like real data. A refusal gets reported
 * and fixed; a bad number gets averaged into a baseline.
 */

export type Converter = (value: number, unit: string) => number | null;

const LB_TO_KG = 0.45359237;
const STONE_TO_KG = 6.35029318;

/** Normalize the punctuation and casing that vary between exports. */
function normalize(unit: string): string {
  return unit.trim().toLowerCase().replace(/·/g, "*").replace(/\s+/g, "");
}

/** Accepts any unit. For quantities with only one sensible unit, like VO2 max. */
export const passthrough: Converter = (v) => v;

export const perMinute: Converter = (v, unit) => {
  const n = normalize(unit);
  return n === "count/min" || n === "count/minute" || n === "bpm" || n === "" ? v : null;
};

export const toCount: Converter = (v, unit) => {
  const n = normalize(unit);
  return n === "count" || n === "" ? v : null;
};

export const toKilograms: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "kg":
      return v;
    case "g":
      return v / 1000;
    case "lb":
      return v * LB_TO_KG;
    case "st":
      return v * STONE_TO_KG;
    default:
      return null;
  }
};

export const toCentimeters: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "cm":
      return v;
    case "m":
      return v * 100;
    case "mm":
      return v / 10;
    case "in":
      return v * 2.54;
    case "ft":
      return v * 30.48;
    default:
      return null;
  }
};

export const toMetres: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "m":
      return v;
    case "km":
      return v * 1000;
    case "cm":
      return v / 100;
    case "mi":
      return v * 1609.344;
    case "yd":
      return v * 0.9144;
    case "ft":
      return v * 0.3048;
    case "in":
      return v * 0.0254;
    default:
      return null;
  }
};

export const toMetresPerSecond: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "m/s":
      return v;
    case "km/hr":
    case "km/h":
      return v / 3.6;
    case "mi/hr":
    case "mi/h":
      return v * 0.44704;
    case "ft/s":
      return v * 0.3048;
    default:
      return null;
  }
};

export const toMilliseconds: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "ms":
      return v;
    case "s":
    case "sec":
      return v * 1000;
    default:
      return null;
  }
};

export const toMinutes: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "min":
      return v;
    case "s":
    case "sec":
      return v / 60;
    case "hr":
    case "h":
      return v * 60;
    default:
      return null;
  }
};

export const toKilocalories: Converter = (v, unit) => {
  switch (normalize(unit)) {
    // Apple writes dietary Calories as "Cal", which are kilocalories.
    case "kcal":
    case "cal":
      return v;
    case "kj":
      return v / 4.184;
    default:
      return null;
  }
};

export const toCelsius: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "degc":
    case "°c":
    case "c":
      return v;
    case "degf":
    case "°f":
    case "f":
      return ((v - 32) * 5) / 9;
    default:
      return null;
  }
};

export const toWatts: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "w":
      return v;
    case "kw":
      return v * 1000;
    default:
      return null;
  }
};

export const toMillimetresMercury: Converter = (v, unit) =>
  normalize(unit) === "mmhg" ? v : null;

/** Physical effort is METs, which Apple writes as kcal/hr·kg. */
export const toMets: Converter = (v, unit) => {
  switch (normalize(unit)) {
    case "kcal/hr*kg":
    case "met":
    case "mets":
      return v;
    default:
      return null;
  }
};

/**
 * Percentages arrive either as a fraction or already scaled. Apple stores blood
 * oxygen as 0.97 and body fat as 0.18, but writes some percentages outright, so
 * values at or below 1 are treated as fractions.
 */
export const toPercent: Converter = (v, unit) => {
  const n = normalize(unit);
  if (n === "%" || n === "percent" || n === "") return v <= 1 ? v * 100 : v;
  return null;
};
