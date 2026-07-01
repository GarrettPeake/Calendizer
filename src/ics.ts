/**
 * ICS feed rendering (render-only). Flattens derived instances into VEVENTs.
 *
 * Children are, by default, folded into the parent event's DESCRIPTION as a
 * schedule ("7:05-7:15 (10m): Brush teeth") so the calendar shows ONE event per
 * instance. When `subtasksAsEvents` is on they are emitted as their own VEVENTs
 * back-referencing the parent UID instead.
 *
 * Times are the solver's LOCAL wall-clock, computed in the user's fixed UTC
 * offset. We must not emit them as "floating" (no Z, no TZID): Google Calendar
 * interprets a floating DATE-TIME as UTC, so 23:30 shows up shifted by the
 * viewer's offset (e.g. 4:30 PM in GMT-7). Instead we emit a fixed-offset
 * VTIMEZONE and tag every DTSTART/DTEND with its TZID, so the wall-clock time
 * displays verbatim in any viewer's calendar.
 */
import { Instance, SubInstance } from './types';

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

/** Escape a TEXT property value per RFC 5545 (backslash, semicolon, comma, newline). */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** "2026-06-30T07:05" → "7:05" (hour without a leading zero). */
function clock(dt: string): string {
  const [h, m] = dt.slice(11, 16).split(':');
  return `${parseInt(h, 10)}:${m}`;
}

/** Minutes between two same-day (or wrapping) wall-clock ISO date-times. */
function durationOf(startDt: string, endDt: string): number {
  const min = (dt: string) => {
    const [h, m] = dt.slice(11, 16).split(':').map(Number);
    return h * 60 + m;
  };
  let d = min(endDt) - min(startDt);
  if (d < 0) d += 1440;
  return d;
}

/** One DESCRIPTION line per child, e.g. "7:05-7:15 (10m): Brush teeth". */
function describeChildren(children: SubInstance[]): string {
  return children
    .map((c) => `${clock(c.start)}-${clock(c.end)} (${durationOf(c.start, c.end)}m): ${c.subject}`)
    .join('\n');
}

/** Fold a content line to <=75 octets with CRLF + single-space continuation. */
function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let curBytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    // Continuation lines start with a space, so they can hold 74 more octets.
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + n > limit) {
      out.push(cur);
      cur = '';
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function renderICS(
  instances: Instance[],
  calName = 'Calendizer',
  utcOffsetMinutes?: number,
  subtasksAsEvents = false
): string {
  // When we know the user's offset, pin every event to a fixed-offset zone so it
  // renders at the intended wall-clock time regardless of the viewer's timezone.
  const useTz = typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes);
  const off = useTz ? formatOffset(utcOffsetMinutes as number) : '';
  // No colon in the TZID: an unquoted colon in a property PARAMETER value (e.g.
  // `DTSTART;TZID=...:VALUE`) ends the parameter, so parsers would read a
  // truncated TZID and a garbage value — and drop every event.
  const tzid = useTz ? `Calendizer/UTC${off}` : '';
  const dtProp = (name: 'DTSTART' | 'DTEND', dt: string) =>
    useTz ? `${name};TZID=${tzid}:${toICSStamp(dt)}` : `${name}:${toICSStamp(dt)}`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendizer//EN',
    `X-WR-CALNAME:${escapeText(calName)}`,
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
    const hasChildren = !!(inst.children && inst.children.length > 0);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${inst.uid}`);
    lines.push(`SUMMARY:${escapeText(inst.subject)}`);
    lines.push(dtProp('DTSTART', inst.start));
    lines.push(dtProp('DTEND', inst.end));
    if (hasChildren && !subtasksAsEvents) {
      lines.push(`DESCRIPTION:${escapeText(describeChildren(inst.children!))}`);
    }
    lines.push(`X-INTENT-ID:${inst.intentId}`);
    lines.push('END:VEVENT');
    if (hasChildren && subtasksAsEvents) {
      inst.children!.forEach((c, i) => {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${inst.uid}::child${i}`);
        lines.push(`SUMMARY:${escapeText(c.subject)}`);
        lines.push(dtProp('DTSTART', c.start));
        lines.push(dtProp('DTEND', c.end));
        lines.push(`RELATED-TO:${inst.uid}`);
        lines.push('END:VEVENT');
      });
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n');
}
