// Detect the user's timezone from the browser's own clock (exact, no permission).
// Approximate location comes from the server's IP-based geo (Cloudflare request.cf)
// via /api/geo — no browser location prompt. Diff both against the stored config.
import type { GlobalConfig } from 'calendizer';

export interface Detected {
  utcOffsetMinutes: number;
  tzName: string;
  lat?: number;
  lon?: number;
}

/** Timezone from the browser clock — synchronous, no permission. */
export function detectTimezone(): { utcOffsetMinutes: number; tzName: string } {
  const utcOffsetMinutes = -new Date().getTimezoneOffset(); // east-of-UTC positive
  let tzName = '';
  try {
    tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* ignore */
  }
  return { utcOffsetMinutes, tzName };
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
