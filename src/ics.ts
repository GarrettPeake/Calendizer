/**
 * ICS feed rendering (render-only). Flattens derived instances into VEVENTs.
 * Children are rendered as their own VEVENTs back-referencing the parent UID.
 *
 * Times are the solver's LOCAL wall-clock, computed in the user's fixed UTC
 * offset. We must not emit them as "floating" (no Z, no TZID): Google Calendar
 * interprets a floating DATE-TIME as UTC, so 23:30 shows up shifted by the
 * viewer's offset (e.g. 4:30 PM in GMT-7). Instead we emit a fixed-offset
 * VTIMEZONE and tag every DTSTART/DTEND with its TZID, so the wall-clock time
 * displays verbatim in any viewer's calendar.
 */
import { Instance } from './types';

function toICSStamp(dt: string): string {
  // YYYYMMDDTHHMMSS (seconds appended).
  return dt.replace(/[-:]/g, '') + '00';
}

/** Format minutes-from-UTC as an iCalendar offset, e.g. -420 → "-0700". */
function formatOffset(mins: number): string {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  const hh = String(Math.floor(a / 60)).padStart(2, '0');
  const mm = String(a % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

export function renderICS(instances: Instance[], calName = 'Calendizer', utcOffsetMinutes?: number): string {
  // When we know the user's offset, pin every event to a fixed-offset zone so it
  // renders at the intended wall-clock time regardless of the viewer's timezone.
  const useTz = typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes);
  const off = useTz ? formatOffset(utcOffsetMinutes as number) : '';
  const tzid = useTz ? `Calendizer/UTC${off.slice(0, 3)}:${off.slice(3)}` : '';
  const dtProp = (name: 'DTSTART' | 'DTEND', dt: string) =>
    useTz ? `${name};TZID=${tzid}:${toICSStamp(dt)}` : `${name}:${toICSStamp(dt)}`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendizer//EN',
    `X-WR-CALNAME:${calName}`,
  ];
  if (useTz) {
    lines.push(
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${off}`,
      `TZOFFSETTO:${off}`,
      `TZNAME:${off}`,
      'END:STANDARD',
      'END:VTIMEZONE'
    );
  }
  for (const inst of instances) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${inst.uid}`);
    lines.push(`SUMMARY:${inst.subject}`);
    lines.push(dtProp('DTSTART', inst.start));
    lines.push(dtProp('DTEND', inst.end));
    lines.push(`X-INTENT-ID:${inst.intentId}`);
    lines.push('END:VEVENT');
    if (inst.children) {
      inst.children.forEach((c, i) => {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${inst.uid}::child${i}`);
        lines.push(`SUMMARY:${c.subject}`);
        lines.push(dtProp('DTSTART', c.start));
        lines.push(dtProp('DTEND', c.end));
        lines.push(`RELATED-TO:${inst.uid}`);
        lines.push('END:VEVENT');
      });
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
