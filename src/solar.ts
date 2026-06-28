/**
 * Deterministic solar time calculation (NOAA algorithm).
 *
 * Resolves sunrise / sunset (geometric, -0.833°) and dawn / dusk (civil
 * twilight, -6°) to minutes-from-local-midnight for a given date, location,
 * and fixed UTC offset. Pure and stable: same inputs → same output.
 */
import { ISODate, parseDate } from './time';

const DEG = Math.PI / 180;

function dayOfYear(d: ISODate): number {
  const dt = parseDate(d);
  const start = Date.UTC(dt.getUTCFullYear(), 0, 0);
  return Math.floor((dt.getTime() - start) / 86_400_000);
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Returns the event time in minutes-from-local-midnight, or null if the sun
 * never reaches that altitude on that day (polar day/night) — caller decides
 * a fallback.
 */
function solarEvent(
  d: ISODate,
  lat: number,
  lon: number,
  utcOffsetMinutes: number,
  zenithDeg: number,
  rising: boolean
): number | null {
  const dt = parseDate(d);
  const year = dt.getUTCFullYear();
  const N = dayOfYear(d);

  // Approximate the time of day to anchor the fractional-year calculation.
  const lngHour = lon / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;

  // Mean anomaly
  const M = 0.9856 * t - 3.289;
  // True longitude
  let L =
    M +
    1.916 * Math.sin(M * DEG) +
    0.02 * Math.sin(2 * M * DEG) +
    282.634;
  L = ((L % 360) + 360) % 360;

  // Right ascension
  let RA = Math.atan(0.91764 * Math.tan(L * DEG)) / DEG;
  RA = ((RA % 360) + 360) % 360;
  // Put RA in the same quadrant as L
  const Lquadrant = Math.floor(L / 90) * 90;
  const RAquadrant = Math.floor(RA / 90) * 90;
  RA = RA + (Lquadrant - RAquadrant);
  RA = RA / 15; // to hours

  // Declination
  const sinDec = 0.39782 * Math.sin(L * DEG);
  const cosDec = Math.cos(Math.asin(sinDec));

  // Local hour angle
  const cosH =
    (Math.cos(zenithDeg * DEG) - sinDec * Math.sin(lat * DEG)) /
    (cosDec * Math.cos(lat * DEG));
  if (cosH > 1 || cosH < -1) return null; // sun never reaches the zenith

  let H = rising ? 360 - Math.acos(cosH) / DEG : Math.acos(cosH) / DEG;
  H = H / 15;

  const T = H + RA - 0.06571 * t - 6.622; // local mean time
  let UT = T - lngHour; // universal time, hours
  UT = ((UT % 24) + 24) % 24;

  const localMinutes = UT * 60 + utcOffsetMinutes;
  return Math.round(((localMinutes % 1440) + 1440) % 1440);
}

export interface SolarTimes {
  sunrise: number;
  sunset: number;
  dawn: number;
  dusk: number;
}

const FALLBACK: SolarTimes = {
  // Sensible fallbacks for polar edge cases / missing location.
  sunrise: 6 * 60,
  dawn: 6 * 60 - 30,
  sunset: 18 * 60,
  dusk: 18 * 60 + 30,
};

export function solarTimes(
  d: ISODate,
  location: { lat: number; lon: number } | undefined,
  utcOffsetMinutes: number
): SolarTimes {
  if (!location) return { ...FALLBACK };
  const { lat, lon } = location;
  const sunrise = solarEvent(d, lat, lon, utcOffsetMinutes, 90.833, true);
  const sunset = solarEvent(d, lat, lon, utcOffsetMinutes, 90.833, false);
  const dawn = solarEvent(d, lat, lon, utcOffsetMinutes, 96, true);
  const dusk = solarEvent(d, lat, lon, utcOffsetMinutes, 96, false);
  return {
    sunrise: sunrise ?? FALLBACK.sunrise,
    sunset: sunset ?? FALLBACK.sunset,
    dawn: dawn ?? FALLBACK.dawn,
    dusk: dusk ?? FALLBACK.dusk,
  };
}
