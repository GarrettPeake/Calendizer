// A library of ready-to-use intents you can drop onto the calendar with one click,
// then tweak. Drawn from the schema's worked examples plus a few everyday extras.
import type { Intent } from 'calendizer';

export interface IntentPreset {
  id: string;
  label: string;
  description: string;
  /** If set, adding this preset is most useful alongside this mode. */
  needsMode?: string;
  intent: Intent;
}

export const INTENT_LIBRARY: IntentPreset[] = [
  {
    id: 'pottery',
    label: '🏺 Pottery 3–4×/week',
    description: '1–2h, studio open 9–7 (until 9 Tue/Thu/Sun).',
    intent: {
      subject: 'pottery',
      mode: 'default',
      priority: 50,
      duration: [60, 120],
      window: { not_before: '09:00', not_after: '19:00', overrides: { 'TU,TH,SU': { not_after: '21:00' } } },
      cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [3, 4] } },
    },
  },
  {
    id: 'morning-routine',
    label: '🪥 Morning routine',
    description: 'Brush · do hair · shower, back-to-back right after wakeup.',
    intent: {
      subject: 'morning routine',
      mode: 'default',
      priority: 80,
      duration: [13, 20],
      window: { not_before: { marker: 'wakeup' } },
      children: [
        { subject: 'brush teeth', duration: 3 },
        { subject: 'do hair', weight: 1 },
        { subject: 'shower', duration: 10 },
      ],
      cardinality: {
        period: { unit: 'week', interval: 1 },
        days: { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] },
        per_day: { count: [1, 1] },
      },
    },
  },
  {
    id: 'medication',
    label: '💊 Medication (every day, any mode)',
    description: 'Pinned 8am, runs in every mode.',
    intent: {
      subject: 'take medication',
      mode: 'all',
      priority: 100,
      duration: [1, 1],
      window: { starts_at: '08:00' },
      cardinality: { period: { unit: 'day', interval: 1 }, per_day: { count: [1, 1] } },
    },
  },
  {
    id: 'stretching',
    label: '🤸 Stretch 2×/day, 3 days/week',
    description: '10 min, capped at 24 lifetime occurrences.',
    intent: {
      subject: 'stretching',
      mode: 'default',
      priority: 30,
      duration: [10, 10],
      window: { not_before: { marker: 'wakeup' }, not_after: { marker: 'sleep' } },
      cardinality: {
        period: { unit: 'week', interval: 1 },
        days: { count: [3, 3] },
        per_day: { count: [2, 2] },
        total: [null, 24],
      },
    },
  },
  {
    id: 'mai-tai',
    label: '🍹 Mai Tai on vacation (≥2)',
    description: 'Around noon, at least twice — needs a "vacation" mode.',
    needsMode: 'vacation',
    intent: {
      subject: 'Mai Tai at the beach',
      mode: 'vacation',
      priority: 40,
      duration: [60, 120],
      window: { not_before: '11:00', not_after: '13:00' },
      cardinality: { period: { unit: 'mode' }, total: [2, null] },
    },
  },
  {
    id: 'fishing',
    label: '🎣 Fishing trip (one-off, 3am)',
    description: 'Sat 4h from 3am — the sleep blackout yields.',
    intent: {
      subject: 'fishing',
      mode: 'default',
      priority: 50,
      duration: [240, 240],
      window: { starts_at: '03:00' },
      cardinality: { days: { dates: ['2026-06-27'] } },
    },
  },
  {
    id: 'guitar',
    label: '🎸 Guitar practice 3×/week',
    description: '1–2h in the evening.',
    intent: {
      subject: 'guitar practice',
      mode: 'default',
      priority: 45,
      duration: [60, 120],
      window: { not_before: '17:00', not_after: '22:00' },
      cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [3, 3] } },
    },
  },
  {
    id: 'gym',
    label: '🏋️ Gym Mon/Wed/Fri',
    description: 'Fixed weekdays, mornings.',
    intent: {
      subject: 'gym',
      mode: 'default',
      priority: 55,
      duration: [60, 60],
      window: { not_before: '07:00', not_after: '10:00' },
      cardinality: { period: { unit: 'week', interval: 1 }, days: { weekdays: ['MO', 'WE', 'FR'] } },
    },
  },
  {
    id: 'deep-work',
    label: '🧠 Deep work block (daily)',
    description: '2h of focus every weekday afternoon.',
    intent: {
      subject: 'deep work',
      mode: 'default',
      priority: 60,
      duration: [120, 120],
      window: { not_before: '13:00', not_after: '18:00' },
      cardinality: { period: { unit: 'week', interval: 1 }, days: { weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] } },
    },
  },
  {
    id: 'reading',
    label: '📚 Wind-down reading',
    description: '30 min before bed, every night.',
    intent: {
      subject: 'reading',
      mode: 'default',
      priority: 20,
      duration: [30, 30],
      window: { not_before: '21:00', not_after: { marker: 'sleep' } },
      cardinality: { period: { unit: 'day', interval: 1 }, per_day: { count: [1, 1] } },
    },
  },
];
