/**
 * Shared Cucumber World for the Calendizer suite.
 *
 * Holds the scenario's global config, intents, modes, existing calendar and
 * horizon, runs the deterministic solver, and exposes query helpers used by the
 * shared step definitions. Feature authors NEVER write step definitions — they
 * write `.feature` files against the vocabulary in features/step_definitions.
 */
import { setWorldConstructor, World, IWorldOptions } from '@cucumber/cucumber';
import {
  GlobalConfig,
  Intent,
  Mode,
  CalendarEvent,
  Instance,
  SolveOutput,
  ConflictReport,
  Update,
} from '../../src/types';
import { solve } from '../../src/solver';

export const DEFAULT_CONFIG: GlobalConfig = {
  wakeup: '07:00',
  sleep: '23:00',
  padding: 0,
  grid: 5,
  min_break: 15,
  max_block: 180,
  utcOffsetMinutes: 0,
};

/** Tolerant JSON: strips // and /* *\/ comments and trailing commas. */
export function parseLooseJson(text: string): any {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  const noTrailing = noLine.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailing);
}

export class CalendizerWorld extends World {
  config: GlobalConfig = { ...DEFAULT_CONFIG };
  intents: Intent[] = [];
  modes: Mode[] = [];
  existing: CalendarEvent[] = [];
  horizon: { start: string; end: string } = { start: '2026-01-01', end: '2026-01-07' };
  output: SolveOutput | null = null;

  constructor(options: IWorldOptions) {
    super(options);
  }

  run(): void {
    this.output = solve({
      config: this.config,
      intents: this.intents,
      modes: this.modes,
      existingCalendar: this.existing,
      horizon: this.horizon,
    });
  }

  ensureSolved(): SolveOutput {
    if (!this.output) this.run();
    return this.output!;
  }

  get instances(): Instance[] {
    return this.ensureSolved().instances;
  }

  get conflicts(): ConflictReport[] {
    return this.ensureSolved().conflicts;
  }

  get updates(): Update[] {
    return this.ensureSolved().updates;
  }

  /** All instances for a subject, chronological. */
  bySubject(subject: string): Instance[] {
    return this.instances
      .filter((i) => i.subject === subject)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  /** Instances for a subject on a given date. */
  onDate(subject: string, date: string): Instance[] {
    return this.bySubject(subject).filter((i) => i.date === date);
  }

  /** The single occurrence of a subject on a date (throws if 0 or >1). */
  oneOn(subject: string, date: string): Instance {
    const hits = this.onDate(subject, date);
    if (hits.length === 0) {
      throw new Error(
        `Expected one occurrence of "${subject}" on ${date}, found none. ` +
          `Placed: ${this.bySubject(subject).map((i) => i.start).join(', ') || '(none)'}`
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `Expected one occurrence of "${subject}" on ${date}, found ${hits.length}: ` +
          hits.map((i) => i.start).join(', ')
      );
    }
    return hits[0];
  }

  describeSchedule(): string {
    return this.instances
      .map((i) => `  ${i.start}–${i.end.split('T')[1]}  ${i.subject}`)
      .join('\n');
  }
}

setWorldConstructor(CalendizerWorld);
