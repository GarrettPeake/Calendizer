// A library of base calendars you can load and mess about with. Each preset is a
// set of *fixed* (immovable) events plus optional modes — i.e. the existing
// calendar the solver routes around. Recurring events are weekday templates that
// get materialised across the visible horizon; one-offs are concrete dates.
import type { Mode, GlobalConfig } from 'calendizer';

export interface RecurringTemplate {
  weekdays: string[]; // e.g. ["MO","WE","FR"]
  start: string; // "HH:MM"
  end: string;
  subject: string;
}
export interface OneOffEvent {
  date: string; // "YYYY-MM-DD"
  start: string;
  end: string;
  subject: string;
}
export interface BaseCalendar {
  id: string;
  name: string;
  description: string;
  recurring: RecurringTemplate[];
  oneOff?: OneOffEvent[];
  modes?: Mode[];
  configPatch?: Partial<GlobalConfig>;
}

export const BASE_CALENDARS: BaseCalendar[] = [
  {
    id: 'empty',
    name: 'Empty calendar',
    description: 'A blank slate — no fixed commitments. Great for seeing how intents place on their own.',
    recurring: [],
  },
  {
    id: 'professional',
    name: 'Busy professional',
    description: 'Daily standup, recurring meetings, a blocked lunch, and a Friday demo.',
    recurring: [
      { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], start: '09:00', end: '09:15', subject: 'Standup' },
      { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], start: '12:30', end: '13:30', subject: 'Lunch' },
      { weekdays: ['MO'], start: '10:00', end: '11:00', subject: '1:1 with manager' },
      { weekdays: ['TU', 'TH'], start: '14:00', end: '15:00', subject: 'Team sync' },
      { weekdays: ['FR'], start: '16:00', end: '17:00', subject: 'Sprint demo' },
    ],
  },
  {
    id: 'student',
    name: 'University student',
    description: 'Lectures and labs across the week, with a part-time shift on Saturday.',
    recurring: [
      { weekdays: ['MO', 'WE', 'FR'], start: '09:00', end: '10:30', subject: 'Algorithms lecture' },
      { weekdays: ['TU', 'TH'], start: '11:00', end: '12:30', subject: 'Linear Algebra' },
      { weekdays: ['WE'], start: '14:00', end: '16:00', subject: 'Physics lab' },
      { weekdays: ['SA'], start: '10:00', end: '15:00', subject: 'Cafe shift' },
    ],
  },
  {
    id: 'family',
    name: 'Family logistics',
    description: 'School runs, soccer practice, and a standing weekend brunch.',
    recurring: [
      { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], start: '08:00', end: '08:45', subject: 'School drop-off' },
      { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], start: '15:00', end: '15:45', subject: 'School pick-up' },
      { weekdays: ['TU', 'TH'], start: '17:30', end: '18:30', subject: "Kids' soccer" },
      { weekdays: ['SU'], start: '10:00', end: '11:30', subject: 'Family brunch' },
    ],
  },
  {
    id: 'vacation',
    name: 'Vacation week',
    description: 'A 7-day "vacation" mode (suppresses default intents) plus a couple of fixed travel events.',
    recurring: [],
    oneOff: [
      { date: '2026-06-22', start: '06:00', end: '09:00', subject: 'Flight out' },
      { date: '2026-06-28', start: '18:00', end: '21:00', subject: 'Flight home' },
    ],
    modes: [{ name: 'vacation', span: ['2026-06-22', '2026-06-28'] }],
  },
];
