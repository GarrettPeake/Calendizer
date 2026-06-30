import type { Intent, Cardinality } from 'calendizer';

export function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function dur(intent: Intent): string {
  const [a, b] = intent.duration;
  return a === b ? `${a}m` : `${a}–${b}m`;
}

function cardSummary(c: Cardinality): string {
  const parts: string[] = [];
  if (c.days) {
    if ('weekdays' in c.days) parts.push(c.days.weekdays.join('/'));
    else if ('dates' in c.days) parts.push(`${c.days.dates.length} date(s)`);
    else parts.push(`${c.days.count[0]}–${c.days.count[1]} days`);
  }
  if (c.period) {
    const iv = c.period.interval ?? 1;
    parts.push(`/${iv > 1 ? iv + ' ' : ''}${c.period.unit}`);
  }
  if (c.per_day) parts.push(`${c.per_day.count[0]}×/day`);
  if (c.total) parts.push(`total ${c.total[0] ?? '0'}–${c.total[1] ?? '∞'}`);
  return parts.join(' ');
}

export function summarize(intent: Intent, modeLabel?: string): string {
  const bits = [modeLabel ?? intent.mode, `p${intent.priority}`, dur(intent), cardSummary(intent.cardinality)];
  if (intent.children?.length) bits.push(`${intent.children.length} children`);
  return bits.filter(Boolean).join(' · ');
}
