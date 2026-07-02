/**
 * Shared Cucumber World for the Calendizer suite.
 *
 * Holds the scenario's global config, intents, modes, existing calendar and
 * horizon, runs the deterministic solver, and exposes query helpers used by the
 * shared step definitions. Feature authors NEVER write step definitions — they
 * write `.feature` files against the vocabulary in features/step_definitions.
 *
 * Solver selection: scenarios run against the DEFAULT solver (the MIP,
 * `createMilpSolver`) unless tagged `@greedy`, which pins the legacy greedy
 * engine. Greedy-tagged scenarios encode the exact placement contract of the
 * old solver (earliest-fit tables under contention); untagged scenarios state
 * behaviour both engines must satisfy — plus whatever the optimizer does
 * strictly better.
 */
import { setWorldConstructor, World, IWorldOptions, BeforeAll, Before } from '@cucumber/cucumber';
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
import { solve, Solver } from '../../src/solver';
import { createMilpSolver } from '../../src/milp/milpSolver';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadHighs = require('highs');

let milpSolver: Solver | null = null;
BeforeAll(async function () {
  milpSolver = createMilpSolver(await loadHighs());
});

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
  /** Set by the @greedy tag: pin this scenario to the legacy greedy engine. */
  useGreedy = false;

  constructor(options: IWorldOptions) {
    super(options);
  }

  run(): void {
    const input = {
      config: this.config,
      intents: this.intents,
      modes: this.modes,
      existingCalendar: this.existing,
      horizon: this.horizon,
    };
    this.output = this.useGreedy || !milpSolver ? solve(input) : milpSolver.solve(input);
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

Before(function (this: CalendizerWorld, { pickle }) {
  // CAL_FORCE_GREEDY=1 runs the WHOLE suite against the greedy engine (A/B
  // sanity: the coordination features are expected to fail there).
  this.useGreedy = pickle.tags.some((t) => t.name === '@greedy') || !!process.env.CAL_FORCE_GREEDY;
});
