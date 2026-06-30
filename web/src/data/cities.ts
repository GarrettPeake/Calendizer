// A curated list of cities for the location selector. Picking one sets the
// config's lat/lon and a DST-aware UTC offset (computed from the IANA timezone).
// Cloudflare's IP geo can name cities beyond this list; the detected city is
// honoured/added as an option so the selector mirrors what the header reports.
export interface City {
  name: string;
  lat: number;
  lon: number;
  tz: string;
}

export const CITIES: City[] = [
  { name: 'Amsterdam', lat: 52.37, lon: 4.9, tz: 'Europe/Amsterdam' },
  { name: 'Anchorage', lat: 61.22, lon: -149.9, tz: 'America/Anchorage' },
  { name: 'Athens', lat: 37.98, lon: 23.73, tz: 'Europe/Athens' },
  { name: 'Atlanta', lat: 33.75, lon: -84.39, tz: 'America/New_York' },
  { name: 'Auckland', lat: -36.85, lon: 174.76, tz: 'Pacific/Auckland' },
  { name: 'Bangkok', lat: 13.76, lon: 100.5, tz: 'Asia/Bangkok' },
  { name: 'Beijing', lat: 39.9, lon: 116.41, tz: 'Asia/Shanghai' },
  { name: 'Berlin', lat: 52.52, lon: 13.4, tz: 'Europe/Berlin' },
  { name: 'Boston', lat: 42.36, lon: -71.06, tz: 'America/New_York' },
  { name: 'Buenos Aires', lat: -34.6, lon: -58.38, tz: 'America/Argentina/Buenos_Aires' },
  { name: 'Cairo', lat: 30.04, lon: 31.24, tz: 'Africa/Cairo' },
  { name: 'Chicago', lat: 41.88, lon: -87.63, tz: 'America/Chicago' },
  { name: 'Dallas', lat: 32.78, lon: -96.8, tz: 'America/Chicago' },
  { name: 'Delhi', lat: 28.61, lon: 77.21, tz: 'Asia/Kolkata' },
  { name: 'Denver', lat: 39.74, lon: -104.99, tz: 'America/Denver' },
  { name: 'Dubai', lat: 25.2, lon: 55.27, tz: 'Asia/Dubai' },
  { name: 'Dublin', lat: 53.35, lon: -6.26, tz: 'Europe/Dublin' },
  { name: 'Hong Kong', lat: 22.32, lon: 114.17, tz: 'Asia/Hong_Kong' },
  { name: 'Honolulu', lat: 21.31, lon: -157.86, tz: 'Pacific/Honolulu' },
  { name: 'Istanbul', lat: 41.01, lon: 28.98, tz: 'Europe/Istanbul' },
  { name: 'Johannesburg', lat: -26.2, lon: 28.05, tz: 'Africa/Johannesburg' },
  { name: 'Lagos', lat: 6.52, lon: 3.38, tz: 'Africa/Lagos' },
  { name: 'Lisbon', lat: 38.72, lon: -9.14, tz: 'Europe/Lisbon' },
  { name: 'London', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24, tz: 'America/Los_Angeles' },
  { name: 'Madrid', lat: 40.42, lon: -3.7, tz: 'Europe/Madrid' },
  { name: 'Melbourne', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' },
  { name: 'Mexico City', lat: 19.43, lon: -99.13, tz: 'America/Mexico_City' },
  { name: 'Miami', lat: 25.76, lon: -80.19, tz: 'America/New_York' },
  { name: 'Moscow', lat: 55.76, lon: 37.62, tz: 'Europe/Moscow' },
  { name: 'Mumbai', lat: 19.08, lon: 72.88, tz: 'Asia/Kolkata' },
  { name: 'Nairobi', lat: -1.29, lon: 36.82, tz: 'Africa/Nairobi' },
  { name: 'New York', lat: 40.71, lon: -74.01, tz: 'America/New_York' },
  { name: 'Paris', lat: 48.85, lon: 2.35, tz: 'Europe/Paris' },
  { name: 'Phoenix', lat: 33.45, lon: -112.07, tz: 'America/Phoenix' },
  { name: 'Rome', lat: 41.9, lon: 12.5, tz: 'Europe/Rome' },
  { name: 'San Francisco', lat: 37.77, lon: -122.42, tz: 'America/Los_Angeles' },
  { name: 'Santa Monica', lat: 34.02, lon: -118.49, tz: 'America/Los_Angeles' },
  { name: 'Sao Paulo', lat: -23.55, lon: -46.63, tz: 'America/Sao_Paulo' },
  { name: 'Seattle', lat: 47.61, lon: -122.33, tz: 'America/Los_Angeles' },
  { name: 'Seoul', lat: 37.57, lon: 126.98, tz: 'Asia/Seoul' },
  { name: 'Shanghai', lat: 31.23, lon: 121.47, tz: 'Asia/Shanghai' },
  { name: 'Singapore', lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' },
  { name: 'Stockholm', lat: 59.33, lon: 18.07, tz: 'Europe/Stockholm' },
  { name: 'Sydney', lat: -33.87, lon: 151.21, tz: 'Australia/Sydney' },
  { name: 'Tokyo', lat: 35.68, lon: 139.69, tz: 'Asia/Tokyo' },
  { name: 'Toronto', lat: 43.65, lon: -79.38, tz: 'America/Toronto' },
  { name: 'Vancouver', lat: 49.28, lon: -123.12, tz: 'America/Vancouver' },
  { name: 'Zurich', lat: 47.37, lon: 8.54, tz: 'Europe/Zurich' },
];

export function findCity(name?: string): City | undefined {
  return name ? CITIES.find((c) => c.name === name) : undefined;
}

/** Current (DST-aware) UTC offset in minutes for an IANA timezone, east positive. */
export function tzOffsetMinutes(tz: string, at = new Date()): number {
  try {
    const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(at.toLocaleString('en-US', { timeZone: tz }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return 0;
  }
}
