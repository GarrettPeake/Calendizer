/**
 * Pure, shared form validators. Used by the web editors (gate Save + inline
 * messages) AND the API handlers (so the AI `/smart` path is covered too).
 *
 * Each validator returns an errors/warnings split:
 *   - errors   → the data is invalid or produces garbage; block Save / reject.
 *   - warnings → the data saves but the result is surprising or inert; inform.
 *
 * Every issue carries a dotted `field` path so a UI can attach it to an input.
 * Rationale for each rule is documented in VALIDATION.md.
 */
import { GlobalConfig, Intent, ISODate, Mode, TimeValue } from './types';
import { slugify } from './expand';

export type Severity = 'error' | 'warning';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: Severity;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Convenience: true when there are no errors. */
  ok: boolean;
}

/* ---------------- primitives ---------------- */

const CLOCK_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidClock(s: string): boolean {
  return CLOCK_RE.test(s.trim());
}

/** Strict YYYY-MM-DD AND a real calendar date (rejects 2026-02-30, 2026-13-01). */
export function isValidISODate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Minutes for a clock-valued TimeValue; null for markers, unset, or malformed. */
function clockMinutes(tv: TimeValue | undefined): number | null {
  if (typeof tv !== 'string') return null;
  if (!isValidClock(tv)) return null;
  const [h, m] = tv.split(':').map(Number);
  return h * 60 + m;
}

const isMarker = (tv: TimeValue | undefined): boolean => typeof tv === 'object' && tv !== null;

class Bag {
  errors: ValidationIssue[] = [];
  warnings: ValidationIssue[] = [];
  err(field: string, message: string) {
    this.errors.push({ field, message, severity: 'error' });
  }
  warn(field: string, message: string) {
    this.warnings.push({ field, message, severity: 'warning' });
  }
  result(): ValidationResult {
    return { errors: this.errors, warnings: this.warnings, ok: this.errors.length === 0 };
  }
}

/* ---------------- Intent ---------------- */

export interface IntentValidationContext {
  config?: GlobalConfig;
  modes?: Mode[];
  horizon?: { start: ISODate; end: ISODate };
}

export function validateIntent(intent: Intent, ctx: IntentValidationContext = {}): ValidationResult {
  const b = new Bag();
  const card = intent.cardinality ?? {};

  /* --- Basics --- */
  if (!intent.subject || !intent.subject.trim()) {
    b.err('subject', 'Give this intent a name.');
  } else if (!intent.id && slugify(intent.subject) === '') {
    b.err('subject', 'Name must contain at least one letter or number.');
  }

  if (!isInt(intent.priority)) {
    b.err('priority', 'Priority must be a whole number from 0 to 100.');
  } else if (intent.priority < 0 || intent.priority > 100) {
    b.warn('priority', 'Priority is usually between 0 and 100.');
  }

  const [dMin, dMax] = intent.duration ?? [NaN, NaN];
  if (!isInt(dMin) || !isInt(dMax)) {
    b.err('duration', 'Durations must be whole numbers of minutes.');
  } else {
    if (dMin > dMax) b.err('duration', "Min duration can't be more than max duration.");
    if (dMin < 0) b.err('duration', 'Min duration must be a positive number of minutes.');
    if (dMax <= 0) b.err('duration', 'Max duration must be greater than zero.');
    const hasRealSchedule = hasCardinalityFloor(card);
    if (dMin === 0 && hasRealSchedule) {
      b.warn('duration', "A 0-minute duration schedules nothing — use it only for a 'free time' filler.");
    }
  }

  /* --- Window / timing --- */
  const win = intent.window ?? {};
  if (win.starts_at !== undefined && win.ends_at !== undefined) {
    b.err('window.ends_at', 'Pin either a fixed start or a fixed end, not both.');
  }
  for (const [key, label] of [
    ['not_before', "'Can't start before'"],
    ['not_after', "'Can't end after'"],
    ['starts_at', "'Starts exactly at'"],
    ['ends_at', "'Ends exactly at'"],
  ] as const) {
    const tv = win[key];
    if (typeof tv === 'string' && !isValidClock(tv)) {
      b.err(`window.${key}`, `${label} must be a time like HH:MM (00:00–23:59).`);
    }
    if (isMarker(tv)) {
      const off = (tv as { offset_min?: number }).offset_min ?? 0;
      if (!isInt(off)) b.err(`window.${key}`, `${label} offset must be a whole number of minutes.`);
      else if (Math.abs(off) >= 1440) b.warn(`window.${key}`, `${label} offset can push the time outside the day.`);
    }
  }

  const nb = clockMinutes(win.not_before);
  const na = clockMinutes(win.not_after);
  if (nb != null && na != null && nb > na) {
    b.err('window.not_after', "'Can't start before' must be earlier than 'Can't end after'.");
  }

  // Per-weekday overrides: a valid weekday key plus the same per-field rules.
  const WEEKDAY_CODES = new Set(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
  for (const [key, partial] of Object.entries(win.overrides ?? {})) {
    const codes = key.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
    const label = codes.join(',') || '(no days)';
    if (codes.length === 0 || codes.some((c) => !WEEKDAY_CODES.has(c))) {
      b.err('window.overrides', `Override "${key}" must target valid weekdays (MO, TU, WE, TH, FR, SA, SU).`);
    }
    if (partial.starts_at !== undefined && partial.ends_at !== undefined) {
      b.err('window.overrides', `Override for ${label}: pin either a fixed start or a fixed end, not both.`);
    }
    for (const [k, fieldLabel] of [
      ['not_before', "'Can't start before'"],
      ['not_after', "'Can't end after'"],
      ['starts_at', "'Starts exactly at'"],
      ['ends_at', "'Ends exactly at'"],
    ] as const) {
      const tv = partial[k];
      if (typeof tv === 'string' && !isValidClock(tv)) {
        b.err('window.overrides', `Override for ${label}: ${fieldLabel} must be a time like HH:MM.`);
      } else if (isMarker(tv) && !isInt((tv as { offset_min?: number }).offset_min ?? 0)) {
        b.err('window.overrides', `Override for ${label}: ${fieldLabel} offset must be a whole number of minutes.`);
      }
    }
    const onb = clockMinutes(partial.not_before);
    const ona = clockMinutes(partial.not_after);
    if (onb != null && ona != null && onb > ona) {
      b.err('window.overrides', `Override for ${label}: 'Can't start before' must be earlier than 'Can't end after'.`);
    }
  }
  // Min duration can't fit a clock-bounded window. (Marker-relative bounds resolve
  // per-date, so we only flag the case where both bounds are concrete clock times;
  // a marker window that truly can't fit surfaces as a solver conflict instead.)
  if (isInt(dMin) && dMin > 0) {
    const lo = nb ?? (isMarker(win.not_before) ? null : 0);
    const hi = na ?? (isMarker(win.not_after) ? null : 1440);
    if (lo != null && hi != null && hi - lo < dMin) {
      b.err('duration', 'This won’t fit: the allowed window is shorter than the minimum duration.');
    }
  }
  // (The "pinned start overrides the window" notice is shown contextually by the
  //  editor, which also greys out those bounds — no validator warning needed.)
  // Window fully inside the sleep blackout.
  if (ctx.config) {
    const wake = clockMinutes(ctx.config.wakeup);
    const sleep = clockMinutes(ctx.config.sleep);
    if (wake != null && sleep != null && wake < sleep && nb != null && na != null) {
      const insideNight = na <= wake || nb >= sleep;
      if (insideNight) b.warn('window.not_before', 'This window falls during your sleep hours — it’ll be scheduled there anyway.');
    }
  }

  /* --- Cardinality: period + interval --- */
  if (card.period) {
    const iv = card.period.interval;
    if (iv != null && (!isInt(iv) || iv < 1)) {
      b.err('period.interval', 'Repeat interval must be a whole number of 1 or more.');
    }
    if (card.period.unit === 'mode' && (intent.mode === 'default' || intent.mode === 'all')) {
      b.warn('period', "'Per calendar mode' works best when this intent is tied to a specific mode, not 'normal' or 'all'.");
    }
  }

  /* --- Cardinality: days --- */
  const days = card.days;
  if (days && 'count' in days) {
    const [cMin, cMax] = days.count;
    if (!isInt(cMin) || !isInt(cMax)) b.err('days.count', 'Day counts must be whole numbers.');
    else {
      if (cMin > cMax) b.err('days.count', "Min days can't exceed max days.");
      if (cMin < 0) b.err('days.count', 'Min days must be 0 or more.');
      const cap = bucketDayCap(card.period?.unit);
      if (cap != null && cMin > cap) {
        b.warn('days.count', `A ${card.period?.unit} only has ~${cap} days — only that many will be scheduled.`);
      }
    }
  } else if (days && 'weekdays' in days) {
    if (!days.weekdays || days.weekdays.length === 0) b.err('days.weekdays', 'Pick at least one weekday.');
  } else if (days && 'dates' in days) {
    if (!days.dates || days.dates.length === 0) {
      b.err('days.dates', 'Add at least one date.');
    } else {
      for (const d of days.dates) {
        if (!isValidISODate(d)) {
          b.err('days.dates', `“${d}” isn’t a valid date — use YYYY-MM-DD.`);
        } else if (ctx.horizon && (d < ctx.horizon.start || d > ctx.horizon.end)) {
          b.warn('days.dates', `${d} is outside the 12-month planning window and will be ignored.`);
        }
      }
    }
  }

  /* --- Cardinality: per_day --- */
  if (card.per_day) {
    const [pMin, pMax] = card.per_day.count;
    if (!isInt(pMin) || !isInt(pMax)) b.err('per_day', 'Per-day counts must be whole numbers.');
    else {
      if (pMin > pMax) b.err('per_day', "Min per day can't exceed max per day.");
      if (pMin < 0) b.err('per_day', 'Per-day count must be 0 or more.');
    }
  }

  /* --- Cardinality: total --- */
  if (card.total) {
    const [tMin, tMax] = card.total;
    if (tMin != null && !isInt(tMin)) b.err('total', 'Total min must be a whole number (or blank).');
    if (tMax != null && !isInt(tMax)) b.err('total', 'Total max must be a whole number (or blank).');
    if (isInt(tMin) && isInt(tMax) && tMin > tMax) b.err('total', "Total min can't be more than total max.");
    if (isInt(tMax) && tMax <= 0) b.err('total', "A total max of 0 means this never happens — turn off 'Limit total' or set a positive max.");
  }

  /* --- Mode reference --- */
  if (ctx.modes && intent.mode !== 'default' && intent.mode !== 'all') {
    const known = ctx.modes.some((m) => m.name === intent.mode) || (ctx.modes as (Mode & { id?: string })[]).some((m) => m.id === intent.mode);
    if (!known) b.warn('mode', "This mode no longer exists — the intent falls back to 'normal'. Pick a current mode.");
  }

  /* --- Children --- */
  if (intent.children && intent.children.length > 0) {
    let fixedTotal = 0;
    let hasWeight = false;
    intent.children.forEach((c, i) => {
      if (!c.subject || !c.subject.trim()) b.err(`children.${i}.subject`, 'Every child needs a name.');
      if ('weight' in c) {
        hasWeight = true;
        if (!isInt(c.weight) || c.weight <= 0) b.err(`children.${i}.weight`, 'Fill weight must be a whole positive number.');
      } else {
        if (!isInt(c.duration) || c.duration <= 0) b.err(`children.${i}.duration`, 'Child duration must be a whole positive number of minutes.');
        else fixedTotal += c.duration;
      }
    });
    if (!hasWeight) b.err('children', "Add at least one 'Fill' child so the block is fully covered.");
    if (isInt(dMin) && fixedTotal > dMin) {
      b.err('children', "Fixed children add up to more than the min duration — they won't fit inside the block.");
    }
  }

  return b.result();
}

function hasCardinalityFloor(card: Intent['cardinality']): boolean {
  if (!card) return false;
  const d = card.days;
  if (d && 'count' in d && d.count[0] > 0) return true;
  if (d && 'weekdays' in d && d.weekdays.length > 0) return true;
  if (d && 'dates' in d && d.dates.length > 0) return true;
  if (card.per_day && card.per_day.count[0] > 0) return true;
  if (card.total && (card.total[0] ?? 0) > 0) return true;
  return false;
}

/** Approx. max distinct days a single period bucket can hold. */
function bucketDayCap(unit?: string): number | null {
  if (unit === 'day') return 1;
  if (unit === 'week') return 7;
  if (unit === 'month') return 28;
  return null;
}

/* ---------------- Mode ---------------- */

export interface ModeValidationContext {
  /** Other existing modes (exclude the one being edited, by id). */
  others?: (Mode & { id?: string })[];
  horizon?: { start: ISODate; end: ISODate };
}

export function validateMode(mode: Mode, ctx: ModeValidationContext = {}): ValidationResult {
  const b = new Bag();
  const [from, to] = mode.span ?? ['', ''];

  if (!mode.name || !mode.name.trim()) b.err('name', 'Give the mode a name.');
  else if (mode.name.trim().length > 80) b.warn('name', 'Keep the name under 80 characters.');

  if (ctx.others && mode.name?.trim()) {
    if (ctx.others.some((m) => m.name.trim().toLowerCase() === mode.name.trim().toLowerCase())) {
      b.warn('name', `Another mode is already called “${mode.name.trim()}” — they’ll be hard to tell apart.`);
    }
  }

  const fromOk = isValidISODate(from);
  const toOk = isValidISODate(to);
  if (!fromOk) b.err('span.from', 'Start date must be a real date in YYYY-MM-DD form.');
  if (!toOk) b.err('span.to', 'End date must be a real date in YYYY-MM-DD form.');

  if (fromOk && toOk) {
    if (from > to) {
      b.err('span.to', 'The end date must be on or after the start date.');
    } else {
      // Inclusive overlap with any other mode (D4).
      if (ctx.others) {
        for (const o of ctx.others) {
          const [oa, ob] = o.span;
          if (isValidISODate(oa) && isValidISODate(ob) && from <= ob && oa <= to) {
            b.err('span', `These dates overlap mode “${o.name}” (${oa} to ${ob}). Modes can’t share any day.`);
            break;
          }
        }
      }
      // Horizon awareness.
      if (ctx.horizon) {
        if (to < ctx.horizon.start || from > ctx.horizon.end) {
          b.warn('span', 'This span is outside the next 12 months, so it won’t affect your calendar yet.');
        } else if (from < ctx.horizon.start || to > ctx.horizon.end) {
          b.warn('span', 'Part of this span is beyond the 12-month window; only the portion within it is scheduled.');
        }
      }
    }
  }

  return b.result();
}

/* ---------------- Global config ---------------- */

export function validateConfig(config: GlobalConfig): ValidationResult {
  const b = new Bag();

  const wake = clockMinutes(config.wakeup);
  const sleep = clockMinutes(config.sleep);
  if (wake == null) b.err('wakeup', 'Wakeup must be a time like HH:MM (00:00–23:59).');
  if (sleep == null) b.err('sleep', 'Bedtime must be a time like HH:MM (00:00–23:59).');
  if (wake != null && sleep != null) {
    if (wake === sleep) b.warn('sleep', 'Wakeup and bedtime are the same — there’ll be no protected sleep window.');
    else if (sleep < wake) b.warn('sleep', 'Bedtime is earlier than wakeup — the sleep window may not be enforced as expected.');
  }

  if (!isInt(config.grid) || config.grid < 1) b.err('grid', 'Grid must be a whole number of minutes, at least 1.');
  else if (config.grid > 1440) b.warn('grid', 'That grid is larger than a day — most events won’t find a valid start time.');

  if (!isNum(config.padding) || config.padding < 0) b.err('padding', 'Padding must be zero or a positive number.');
  else if (config.padding > 1440) b.warn('padding', 'This much padding leaves no room for events to coexist.');

  if (config.utcOffsetMinutes != null && (!isNum(config.utcOffsetMinutes) || config.utcOffsetMinutes < -720 || config.utcOffsetMinutes > 840)) {
    b.err('utcOffsetMinutes', 'Timezone offset must be between -12:00 and +14:00.');
  }

  return b.result();
}

/* ---------------- Credentials (login / register) ---------------- */

export interface CredentialInput {
  username: string;
  password: string;
  invite?: string;
  confirm?: string;
}

const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

export function validateCredentials(mode: 'login' | 'register', v: CredentialInput): ValidationResult {
  const b = new Bag();
  const username = (v.username ?? '').trim();

  if (!username) b.err('username', 'Enter a username.');
  else if (mode === 'register') {
    if (username.length < 3) b.err('username', 'Username must be at least 3 characters.');
    if (username.length > 32) b.err('username', 'Username must be 32 characters or fewer.');
    if (!USERNAME_RE.test(username)) b.err('username', 'Use letters, numbers, dots, underscores, or hyphens only.');
  }

  const password = v.password ?? '';
  if (!password) b.err('password', 'Enter your password.');
  else if (mode === 'register') {
    if (password.length < 8) b.err('password', 'Password must be at least 8 characters.');
    if (password.length > 128) b.err('password', 'Password must be 128 characters or fewer.');
    if (password !== password.trim()) b.warn('password', 'Your password has leading or trailing spaces — they’ll be part of it.');
  }

  if (mode === 'register') {
    if (!v.invite || !v.invite.trim()) b.err('invite', 'An invite code is required to register.');
    if (v.confirm != null && v.confirm !== password) b.err('confirm', 'Passwords don’t match.');
  }

  return b.result();
}
