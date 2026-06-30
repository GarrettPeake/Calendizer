// Detect the user's timezone (exact, no permission) and approximate location
// (via the Geolocation API) from the browser, and diff against the stored config.
import type { GlobalConfig } from 'calendizer';

export interface Detected {
  utcOffsetMinutes: number;
  tzName: string;
  lat?: number;
  lon?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function getPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round2(p.coords.latitude), lon: round2(p.coords.longitude) }),
      () => resolve(null),
      // A long maximumAge means a focus re-check reuses a cached fix instead of
      // re-prompting after the user has already decided.
      { timeout: 8000, maximumAge: 3_600_000 }
    );
  });
}

export async function detectEnvironment(): Promise<Detected> {
  const utcOffsetMinutes = -new Date().getTimezoneOffset(); // east-of-UTC positive
  let tzName = '';
  try {
    tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* ignore */
  }
  const loc = await getPosition();
  return { utcOffsetMinutes, tzName, lat: loc?.lat, lon: loc?.lon };
}

export interface GeoChange {
  label: string;
  from: string;
  to: string;
}
export interface GeoProposal {
  changes: GeoChange[];
  next: Partial<GlobalConfig>;
  sig: string;
  tzName: string;
}

function fmtOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `GMT${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Diff detected values against the config; null if nothing meaningfully changed. */
export function buildProposal(config: GlobalConfig, d: Detected): GeoProposal | null {
  const changes: GeoChange[] = [];
  const next: Partial<GlobalConfig> = {};

  if (d.utcOffsetMinutes !== (config.utcOffsetMinutes ?? 0)) {
    changes.push({ label: 'Timezone', from: fmtOffset(config.utcOffsetMinutes ?? 0), to: fmtOffset(d.utcOffsetMinutes) });
    next.utcOffsetMinutes = d.utcOffsetMinutes;
  }

  if (d.lat != null && d.lon != null) {
    const cl = config.location;
    const moved = !cl || Math.abs(cl.lat - d.lat) > 0.1 || Math.abs(cl.lon - d.lon) > 0.1;
    if (moved) {
      changes.push({ label: 'Location', from: cl ? `${cl.lat}, ${cl.lon}` : 'not set', to: `${d.lat}, ${d.lon}` });
      next.location = { lat: d.lat, lon: d.lon };
    }
  }

  if (changes.length === 0) return null;
  const lat = next.location?.lat ?? config.location?.lat ?? '';
  const lon = next.location?.lon ?? config.location?.lon ?? '';
  const sig = `${next.utcOffsetMinutes ?? config.utcOffsetMinutes ?? 0}|${lat}|${lon}`;
  return { changes, next, sig, tzName: d.tzName };
}
