/**
 * ICS feed rendering (render-only). Flattens derived instances into VEVENTs.
 * Children are rendered as their own VEVENTs back-referencing the parent UID.
 */
import { Instance } from './types';

function toICSStamp(dt: string): string {
  // Local floating time: YYYYMMDDTHHMMSS (no Z).
  return dt.replace(/[-:]/g, '') + '00';
}

export function renderICS(instances: Instance[], calName = 'Calendizer'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendizer//EN',
    `X-WR-CALNAME:${calName}`,
  ];
  for (const inst of instances) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${inst.uid}`);
    lines.push(`SUMMARY:${inst.subject}`);
    lines.push(`DTSTART:${toICSStamp(inst.start)}`);
    lines.push(`DTEND:${toICSStamp(inst.end)}`);
    lines.push(`X-INTENT-ID:${inst.intentId}`);
    lines.push('END:VEVENT');
    if (inst.children) {
      inst.children.forEach((c, i) => {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${inst.uid}::child${i}`);
        lines.push(`SUMMARY:${c.subject}`);
        lines.push(`DTSTART:${toICSStamp(c.start)}`);
        lines.push(`DTEND:${toICSStamp(c.end)}`);
        lines.push(`RELATED-TO:${inst.uid}`);
        lines.push('END:VEVENT');
      });
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
