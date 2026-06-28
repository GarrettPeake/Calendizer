import type { CalendarEvent } from 'calendizer';
import type { BaseCalendar } from '../data/calendars';
import { weekDates, weekdayCode } from './dates';

/** Materialise a base calendar's fixed events across the given weeks. */
export function expandFixed(cal: BaseCalendar, mondays: string[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const allDates = mondays.flatMap((m) => weekDates(m));

  for (const t of cal.recurring) {
    const wd = new Set(t.weekdays.map((w) => w.toUpperCase()));
    for (const date of allDates) {
      if (wd.has(weekdayCode(date))) {
        events.push({
          uid: `fixed-${cal.id}-${t.subject}-${date}`,
          subject: t.subject,
          start: `${date}T${t.start}`,
          end: `${date}T${t.end}`,
        });
      }
    }
  }
  for (const o of cal.oneOff ?? []) {
    events.push({
      uid: `fixed-${cal.id}-${o.subject}-${o.date}`,
      subject: o.subject,
      start: `${o.date}T${o.start}`,
      end: `${o.date}T${o.end}`,
    });
  }
  return events;
}
