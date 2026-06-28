# Calendizer

A deterministic calendar **manager** — not a calendar you fill in by hand, but one
you manage by **delegation**. You describe *what* you want ("find me 3 spots of
1–2 hours this week to practice guitar"); an LLM (out of scope here) translates that
into structured **intents**; this library's **solver** deterministically places
concrete **instances** that satisfy the constraints and emits the set of **updates**
to apply to your published calendar.

> **Intents are the source of truth. Instances are derived.**

The solver **always produces a placement**. It never returns "infeasible": when it
cannot satisfy everything it places anyway (overlapping if forced) and attaches a
**conflict report** naming the constraints in tension. Given the same inputs it
always yields the same output.

The authoritative domain spec is [`calendar-intent-schema.md`](./calendar-intent-schema.md);
the type definitions in `src/types.ts` mirror it.

## Install / build

```bash
npm install
npm run build      # compiles the library to dist/
npm run typecheck  # type-checks src + the Cucumber suite
npm test           # runs the full Cucumber suite
```

## Usage

```ts
import { solve } from 'calendizer';

const out = solve({
  config: {
    wakeup: '07:00', sleep: '23:00',
    padding: 0, grid: 5, min_break: 15, max_block: 180,
    location: { lat: 40.7, lon: -74.0 }, utcOffsetMinutes: -240,
  },
  intents: [
    {
      subject: 'guitar practice', mode: 'default', priority: 50,
      duration: [60, 120],
      window: { not_before: '17:00', not_after: '22:00' },
      cardinality: { period: { unit: 'week', interval: 1 }, days: { count: [3, 3] } },
    },
  ],
  modes: [],
  existingCalendar: [],
  horizon: { start: '2026-07-06', end: '2026-07-12' },
});

out.instances; // concrete placed events (stable UIDs)
out.updates;   // create / update / delete / unchanged, keyed by UID
out.conflicts; // constraints in tension, if any
```

`renderICS(out.instances)` flattens the result into an ICS feed.

## Architecture (`src/`)

| Module | Responsibility |
|--------|----------------|
| `types.ts`    | The data model (Intent, Mode, Window, Cardinality, Instance, Update, ConflictReport). |
| `time.ts`     | Pure date/time helpers (ISO ⇄ minutes, ISO weeks, weekday codes) with no host-tz drift. |
| `solar.ts`    | Deterministic NOAA sunrise/sunset/dawn/dusk from lat/lon/date/offset. |
| `markers.ts`  | Resolve symbolic time values + per-date windows (incl. weekday overrides). |
| `modes.ts`    | Active-set rules per date; mode-overlap detection. |
| `expand.ts`   | Expand an intent's cardinality into deterministic placement *slots*. |
| `children.ts` | Tile ordered children into a parent block (fixed + weight slack). |
| `solver.ts`   | The deterministic placer: priority-ordered, earliest-fit, sleep-yielding, conflict-reporting. |
| `ics.ts`      | Render instances to an ICS feed. |

## Determinism contract

The solver places the guaranteed **floor** of every range (`duration[0]`, the `min`
of a day/per_day count, `total.min`), spreads an intent's repetitions evenly across
days (load-balancing) and across the waking day (per_day banding), takes the
**earliest grid-aligned** free slot within each band (compact, habitual,
re-solve-stable), and yields the sleep blackout only when an event can land nowhere
else. `max` is treated as a weak aspiration not filled in this deterministic MVP.
The precise, testable rules are documented in [`features/DSL.md`](./features/DSL.md).

## Test suite

The behaviour is pinned by an extensive **Cucumber** suite — **284 scenarios** across
27 situation files plus seed examples, all sharing one step-definition vocabulary
(`features/step_definitions/steps.ts`, documented in `features/DSL.md`). Each file
sets up a calendar in its `Background` and asserts exactly how placements change as
intents are added: flexible/fixed durations, pinned times, ordered children, modes
(suppression, `all`, overlaps), sleep-yielding, solar & wakeup/sleep markers, window
overrides, per-day stacking, every cardinality shape (weekday/date/count/period/
interval/total), filler intents, priority contention, fixed-event obstacles, forced
overlaps, padding, grid snapping, re-solve update diffs, horizon boundaries, and
full-day integration.

```bash
npm test
```
