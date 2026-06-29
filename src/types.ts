/**
 * Core data model for the Calendizer calendar manager.
 *
 * The design rests on one split (see schema):
 *   Intents are the source of truth. Instances are derived.
 *
 * All clock times inside the solver are represented as "minutes from local
 * midnight" on a given calendar date. The public boundary uses ISO strings.
 */

/** A calendar date, `YYYY-MM-DD`. */
export type ISODate = string;

/** A local wall-clock date-time without timezone, `YYYY-MM-DDTHH:MM`. */
export type ISODateTime = string;

/** The closed set of symbolic markers an intent may reference. */
export type Marker = 'wakeup' | 'sleep' | 'dawn' | 'dusk' | 'sunrise' | 'sunset';

/** A symbolic time value, optionally offset by minutes. */
export interface MarkerTime {
  marker: Marker;
  offset_min?: number;
}

/** Anywhere a time is expected: an absolute `"HH:MM"` clock string or a marker. */
export type TimeValue = string | MarkerTime;

/** Bounds where a single occurrence may sit. All fields optional. */
export interface Window {
  not_before?: TimeValue;
  not_after?: TimeValue;
  starts_at?: TimeValue;
  /** Per-weekday overrides keyed by comma-joined weekday codes, e.g. "TU,TH,SU". */
  overrides?: Record<string, Partial<Omit<Window, 'overrides'>>>;
}

/** A child sub-event: either a fixed duration or a slack-absorbing weight. */
export type Child =
  | { subject: string; duration: number }
  | { subject: string; weight: number };

export interface PeriodSpec {
  unit: 'day' | 'week' | 'month' | 'mode';
  /** Recurrence interval (defaults to 1). Ignored when unit === "mode". */
  interval?: number;
}

export type DaysSpec =
  | { count: [number, number] }
  | { weekdays: string[] }
  | { dates: ISODate[] };

export interface Cardinality {
  period?: PeriodSpec;
  days?: DaysSpec;
  per_day?: { count: [number, number] };
  /** Lifetime bound. `[min, max]`; null = open. */
  total?: [number | null, number | null];
}

/** The core declarative object. One intent generates many occurrences. */
export interface Intent {
  subject: string;
  /** "default" | "<mode name>" | "all" */
  mode: string;
  priority: number;
  /** [min, max] minutes. min === max ⇒ fixed. */
  duration: [number, number];
  window: Window;
  children?: Child[];
  cardinality: Cardinality;
  /** Optional stable id; defaults to a slug of the subject. */
  id?: string;
}

/** A named span during which a different active set of intents applies. */
export interface Mode {
  name: string;
  /** [startDate, endDate] inclusive. */
  span: [ISODate, ISODate];
}

/** Resolved-once global configuration shared by every intent. */
export interface GlobalConfig {
  /** Latitude/longitude for solar markers. */
  location?: { lat: number; lon: number };
  /** Fixed UTC offset in minutes used for solar resolution (e.g. -240 for EDT). */
  utcOffsetMinutes?: number;
  /** Clock time resolving the `wakeup` marker. */
  wakeup: TimeValue;
  /** Clock time resolving the `sleep` marker; also a yielding nightly blackout. */
  sleep: TimeValue;
  /** Minutes of buffer enforced around every placed occurrence. */
  padding: number;
  /** Base start-time resolution in minutes (e.g. 5). */
  grid: number;
  /** Shortest gap that counts as a real break (minutes). */
  min_break: number;
  /** Longest continuous run of activity before a break is wanted (minutes). */
  max_block: number;
  /**
   * When true, the solver fills flexible `days.count` ranges toward their `max`:
   * after guaranteeing the floor it adds the extra occurrences (spread across the
   * remaining days) wherever a clean, non-overlapping slot exists. Default false
   * (place exactly the floor). The `max` is still only an aspiration — extras are
   * never forced into an overlap.
   */
  fillToMax?: boolean;
}

/** An event already on the calendar (fixed, user-authored, immovable). */
export interface CalendarEvent {
  uid: string;
  subject: string;
  start: ISODateTime;
  end: ISODateTime;
  /** If derived from a previous solve, the producing intent id. */
  intentId?: string;
}

/** A concrete child placement within an instance. */
export interface SubInstance {
  subject: string;
  start: ISODateTime;
  end: ISODateTime;
}

/**
 * A concrete derived event produced by the solver. UID is keyed to the logical
 * slot (intent + period + index), never the time, for stable identity.
 */
export interface Instance {
  uid: string;
  intentId: string;
  subject: string;
  date: ISODate;
  start: ISODateTime;
  end: ISODateTime;
  /** Minutes. */
  durationMin: number;
  children?: SubInstance[];
  /** True when sleep blackout was dropped to place this (allowed, no conflict). */
  placedDuringSleep?: boolean;
}

export type UpdateKind = 'create' | 'update' | 'delete' | 'unchanged';

/** A single change to apply to the published calendar, keyed by stable UID. */
export interface Update {
  kind: UpdateKind;
  uid: string;
  instance?: Instance;
  /** For update: what it was before. */
  previous?: CalendarEvent;
}

export type ConflictKind =
  | 'overlap' // two placements forced to overlap
  | 'window-unsatisfiable' // window left empty after hard constraints
  | 'mode-overlap' // two modes overlap in time
  | 'floor-unmet'; // a guaranteed floor could not be placed

/** Names the specific constraints in tension so a human can resolve them. */
export interface ConflictReport {
  kind: ConflictKind;
  message: string;
  /** Subjects / intent ids / uids involved. */
  involved: string[];
  date?: ISODate;
}

export interface SolveInput {
  config: GlobalConfig;
  intents: Intent[];
  modes?: Mode[];
  existingCalendar?: CalendarEvent[];
  horizon: { start: ISODate; end: ISODate };
}

export interface SolveOutput {
  instances: Instance[];
  updates: Update[];
  conflicts: ConflictReport[];
}
