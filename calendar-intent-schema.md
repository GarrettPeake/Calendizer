# Calendar Intent Schema

## What this is

A self-hosted calendar you manage by **delegation** instead of by hand. You describe
what you want in natural language — *"pottery 1–2h, 3–4×/week, studio closes at 7 except
Tue/Thu/Sun"* — an LLM translates that into the structured **intents** defined below, a
deterministic **solver** places concrete events that satisfy the constraints, and the
result is published as a standard iCalendar (ICS) feed that any normal calendar app
(Google, Apple, Outlook) subscribes to.

The whole design rests on one split:

> **Intents are the source of truth. Instances are derived.**

Intents are compact, declarative records that live in your database. The solver expands
them into concrete dated events (**instances**) over a rolling horizon, and only those
instances are ever rendered into the ICS feed — clients never see intents. Each derived
instance keeps a back-reference to the intent that produced it, so when something has to
move, the original constraints are always recoverable.

### Division of labour

- **LLM — translator only.** Turns natural language into intents and emits *symbolic*
  time values (e.g. `sunset`). It never picks clock times and never resolves markers.
- **Solver — placer.** Resolves markers, enforces hard constraints, optimises soft ones,
  and produces the placement. It is deterministic and can be re-run without the LLM.
- **ICS feed — render only.** Flattens fixed events + derived instances into `VEVENT`s.

The solver **always produces a placement**. It never fails: when it cannot satisfy
everything it places anyway (overlapping if forced) and attaches a conflict report naming
the constraints in tension, so a human can resolve them.

---

## Global configuration

Resolved once and shared by every intent. The solver uses these to turn symbolic time
values into clock times.

| Field      | Meaning                                                          |
|------------|------------------------------------------------------------------|
| `location` | Lat/long. Resolves `dawn` / `dusk` / `sunrise` / `sunset`.       |
| `wakeup`   | Clock time. Resolves the `wakeup` marker.                        |
| `sleep`    | Clock time. Resolves the `sleep` marker and acts as a nightly blackout — but one that **yields** to events that can only run then (see Solver contract). |
| `padding`  | Minutes of buffer enforced around every placed occurrence.       |
| `grid`     | Base start-time resolution (e.g. 5 min). Occurrence starts snap to it — no `3:57` starts. |
| `min_break`| Shortest gap that counts as a real break. Gaps below it are "slivers" the solver avoids. |
| `max_block`| Longest continuous run of activity before a break is wanted. Bounds clump length. |

`grid`, `min_break`, and `max_block` drive the balance heuristics in *Solver behaviour*.

---

## Time values

Anywhere a time is expected, the value is one of:

```
"16:00"                                 // absolute clock time
{ marker: "sunset", offset_min: -30 }   // a marker, optionally offset in minutes
```

`marker` is drawn from a **closed set**:

```
wakeup | sleep | dawn | dusk | sunrise | sunset
```

There are no event-relative values (`Z.end`) and no calendar-date markers. The LLM emits
the symbol; the solver resolves it per date and location at solve time.

---

## Intent

The core object. One intent generates many occurrences.

```
INTENT {
  subject:   string                 // always defined; even "free time" is a subject
  mode:      string                 // "default" | "<mode name>" | "all"   (see Modes)
  priority:  number                 // higher wins contention

  duration:  [min, max]             // minutes; min == max ⇒ fixed

  window:    Window                 // when an occurrence may sit (see below)
  children?: Child[]                // ordered internal structure (see below)
  cardinality: Cardinality          // how many occurrences (see below)
}
```

### Window

Bounds where a single occurrence may sit. All fields are **time values** and all are
optional.

```
Window {
  not_before?: TimeValue            // occurrence may not start before this
  not_after?:  TimeValue            // occurrence may not end after this
  starts_at?:  TimeValue            // pins the start; only needed with a flexible duration
  overrides?:  { "<weekdays>": Partial<Window> }   // per-day variation
}
```

- `not_before` + `not_after` express *"between"*; either alone expresses *"after"* / *"before"*.
- `starts_at` is only required for the pinned-start-with-flexible-duration case
  (e.g. *"at 4pm for 1–2h"*); with a fixed duration the box pins it and `starts_at` is redundant.
- `overrides` keyed by weekday(s) replace the matching fields on those days. This is how
  per-day availability (studio hours that differ Tue/Thu/Sun) is expressed.

### Children (sub-events)

An occurrence can be tiled by ordered children — useful for routines that must run in a
set order, as distinct events, with **no padding between them**.

```
Child =
  { subject: string, duration: number }   // fixed minutes, OR
  { subject: string, weight:   number }    // absorbs leftover slack proportionally
```

Rules:

- Children are placed in **declared order**, contiguously, filling the parent block.
- Global `padding` applies only at the parent's outer boundary — never between siblings.
- **At least one weight child is required** so the parent always tiles exactly, whatever
  duration the solver chooses for it.
- `sum(fixed child durations) ≤ parent.duration.min`, so the fixed children fit even when
  the parent is at its shortest; weight children share whatever remains.

### Cardinality

How many occurrences, and how they are distributed.

```
Cardinality {
  period?:  { unit: "day" | "week" | "month" | "mode", interval: number }
  days?:    { count: [min, max] } | { weekdays: string[] } | { dates: string[] }
  per_day?: { count: [min, max] }
  total?:   [min, max]              // bound on TOTAL occurrences over the intent's life
}
```

- `period` is the recurring bucket. `unit: "mode"` means the period **is** the active
  mode's span (see Modes); `interval` is then ignored.
- `days` selects which/how many days inside each period — a count (solver chooses),
  explicit weekdays, or explicit dates.
- `per_day` stacks multiple occurrences within a chosen day.
- `total` bounds the **lifetime** occurrence count and composes with the nested fields:
  - alone (typically with `period.unit: "mode"` or another bounded span) it is a flat
    quota — *"at least twice during vacation"* → `[2, null]`;
  - alongside a recurring nested spec its **max caps lifetime occurrences and terminates
    the recurrence**. A recurring intent with no `total.max` runs **indefinitely**.

All `[min, max]` ranges follow the same convention: `min` is the guaranteed floor (placed
or flagged, never silently dropped), `max` is the aspiration the solver fills toward as
capacity allows, and `null` means open. `min: 0` makes an intent pure filler.

---

## Modes

A second intent type. A mode is a named span during which a **different set of intents
applies** — the mechanism behind "clear my calendar for this."

```
MODE {
  name: string
  span: [startDate, endDate]        // concrete dates (MVP)
}
```

Semantics:

- During a mode's span the **active set** is every intent whose `mode` equals that mode's
  name **or** equals `"all"`. Intents with `mode: "default"` are **suppressed** for the
  span — that is what "cleared calendar" means.
- Outside any mode span the active set is `mode: "default"` plus `mode: "all"`.
- `mode: "all"` intents (medication, etc.) run in **every** mode, always.
- Modes do **not** overlap; an overlap is a conflict to flag.

A vacation, a marathon day, and a backpacking trip are all just modes of different lengths.

---

## The solver contract

- **Always places.** Never returns "infeasible." When forced, it overlaps and reports the
  specific constraints in tension.
- **Hard constraints** (best-effort inviolable): the resolved window (incl. overrides),
  the duration floor, and the children tiling invariants.
- **Soft constraints** (penalised, violable with a report): non-overlap, reaching the
  `max` of a range, and all the balance preferences in *Solver behaviour* below.
- **Sleep yields to necessity.** The `sleep` blackout blocks *discretionary* placement —
  the solver never puts an event into sleep hours when it could go elsewhere — but it is
  not an absolute wall. Sleep is intersected into each intent's legal window only while
  that leaves the window non-empty; if removing sleep is the *only* way to place the
  event (a 3am fishing trip whose window starts at `03:00`), sleep is dropped for that
  intent, the occurrence is placed, and **no conflict is reported**, because running then
  is exactly what was asked for.
- **Graceful degradation** comes from ranges: shed the gap between `min` and `max` before
  ever overlapping.
- **Stable identity.** Derived instances get UIDs keyed to their logical slot (intent +
  period + index), not their time, so re-solving updates events in place instead of
  duplicating them.
- **Minimal perturbation.** A change re-solves only the affected window/intents and
  penalises moving events that were already placed.

---

## Solver behaviour — soft objectives

Among all schedules that satisfy the hard constraints, the solver maximises a weighted sum
of the terms below. These only ever choose *between* feasible schedules — they never
override a hard constraint or suppress a conflict report. The weights are the scheduler's
personality: start with sensible defaults and tune from real use.

**Spread an intent's own repetitions.** When an intent fires *K* times in a bucket, target
even spacing (low gap variance) across the *available* time in that bucket, not the wall
clock. It nests with cardinality: `per_day` repetitions spread across the waking day,
`days` spread across the period. When repetitions need to be batched rather than spread, or
held a guaranteed distance apart, model them as separate windowed intents instead.

**`max` is a weak, diminishing aspiration.** The floor is guaranteed; each occurrence above
it earns a small reward that decays and is easily outweighed by the balance terms below.
So `per_day: [2,3]` only schedules the 3rd when it lands *well* — never just because the
room exists.

**Shape the day into a few clumps — not one block, not confetti.** The instinct to
"protect whitespace" is wrong; what matters is the *shape* of the free time, not its
amount. Minimising the space between events collapses the day into one exhausting block;
maximising it shatters the day into useless slivers. The target — a handful of
concentrated runs separated by real breaks — falls out of three terms:

- *Few gaps.* Penalise the **number** of distinct gaps, not their existence. Consolidating
  into fewer, larger breaks beats scattering many small ones — this is what stops the
  "tattered" schedule.
- *No slivers.* A gap should be either ≈ 0 (events butt together inside a clump) or
  ≥ `min_break` (a real break). Penalise gaps in the dead zone between — a 12-minute hole
  is worse than both closing it and widening it.
- *Bounded clumps.* Penalise any continuous run longer than `max_block`, forcing a break
  and preventing the single-monolith day.

The number of clumps is then **emergent** — roughly `active_time ÷ max_block` — which for a
normal day lands at the two or three you'd want, with no hardcoded count.

This reconciles with spreading because the two act at different scopes: spread operates
*within one intent's repetitions* (push them apart), clumping operates on the *whole day's
silhouette* (across all intents). So your morning and evening stretches land in *different*
clumps, while a run of unrelated chores batches *inside* one — momentum kept, repetitions
still distributed.

**Round the start times.** Snap every occurrence start to the `grid` (so never `3:57`), and
among legal placements prefer the coarsest boundary — top of the hour, then half, then
quarter, then 5 minutes. Rounding stays inside the legal window (never before `not_before`
or past `not_after`) and applies to the occurrence's own start, not to internal child
boundaries, which are fixed by tiling. Coarser for longer events: a two-hour block wants
the hour or half-hour, a 15-minute task can sit on a 5. It's also a free performance win —
quantising starts shrinks the search space the local-search pass explores.

**Load-balance across the period.** "3 days a week" shouldn't collapse onto Mon–Tue–Wed;
distribute the chosen days across the period the same way repetitions spread across a day.

**Favour regular, habitual times.** Reward low variance in an intent's start time across
repetitions — the same morning slot each day beats a different one daily. Routine is part
of what makes recurrence valuable.

**Place naturally within a window.** Absent a reason, don't jam an occurrence at the extreme
edge of its window; prefer the natural interior.

**Let priority decide who compromises.** Weight every soft penalty by intent priority, so
when spacing tightens or a slot gets crowded the cost lands on low-priority intents while
high-priority ones keep their best placements.

**Stay stable across re-solves.** Penalise moving an already-placed occurrence so a small
edit yields a small diff (also stated in the contract above).

**How they combine.** A greedy pass seeds placements in priority order, then a local search
(shifts and swaps) improves the total weighted objective; the space is small for a personal
calendar. Defaults are tuned so the common intent needs no knobs.

**Lean MVP cut.** Spread + diminishing-`max` + the three clump terms + round-to-grid +
priority weighting gets you most of "feels balanced." Regularity, window-centering, and
period load-balancing are refinements to layer in later.

---

## Worked examples

Each example shows the natural-language prompt a user might give and the intent the LLM
would produce from it.

**Pottery** — flexible duration, per-day window overrides, weekly day-count.

> *"Schedule pottery for 1–2 hours, 3–4 times a week. The studio is open 9am–7pm most
> days but stays open until 9pm on Tuesday, Thursday, and Sunday."*

```
{
  subject: "pottery", mode: "default", priority: 50,
  duration: [60, 120],
  window: {
    not_before: "09:00",
    not_after:  "19:00",
    overrides:  { "TU,TH,SU": { not_after: "21:00" } }
  },
  cardinality: { period: { unit: "week", interval: 1 }, days: { count: [3, 4] } }
}
```

**Morning routine** — ordered children, no internal padding; "do hair" absorbs slack.

> *"Set up my morning routine for right after I wake up, every day: brush my teeth
> (3 min), do my hair, then shower (10 min) — in that order, back to back, no gaps."*

```
{
  subject: "morning routine", mode: "default", priority: 80,
  duration: [13, 20],
  window: { not_before: { marker: "wakeup" } },
  children: [
    { subject: "brush teeth", duration: 3 },
    { subject: "do hair",     weight: 1 },
    { subject: "shower",      duration: 10 }
  ],
  cardinality: {
    period:  { unit: "week", interval: 1 },
    days:    { weekdays: ["MO","TU","WE","TH","FR","SA","SU"] },
    per_day: { count: [1, 1] }
  }
}
```

**Mai Tais on vacation** — a mode plus a flat lifetime floor over the mode span.

> *"I'm on vacation July 6–12. During my vacation I want to drink Mai Tais at the beach
> around noon, at least twice."*

```
MODE { name: "vacation", span: ["2026-07-06", "2026-07-12"] }

{
  subject: "Mai Tai at the beach", mode: "vacation", priority: 40,
  duration: [60, 120],
  window: { not_before: "11:00", not_after: "13:00" },
  cardinality: { period: { unit: "mode" }, total: [2, null] }   // at least twice
}
```

**Stretching** — nested distribution with a total cap that terminates the recurrence.

> *"Remind me to stretch twice a day, three days a week, for about the next month."*

```
{
  subject: "stretching", mode: "default", priority: 30,
  duration: [10, 10],
  window: { not_before: { marker: "wakeup" }, not_after: { marker: "sleep" } },
  cardinality: {
    period:  { unit: "week", interval: 1 },
    days:    { count: [3, 3] },
    per_day: { count: [2, 2] },
    total:   [null, 24]        // ≈4 weeks, then stops; omit for infinite recurrence
  }
}
```

**Fishing** — a window that can only land during sleep; the blackout yields silently.

> *"Put a fishing trip on the calendar this Saturday — I'm heading out at 3am for about
> four hours."*

```
{
  subject: "fishing", mode: "default", priority: 50,
  duration: [240, 240],
  window: { starts_at: "03:00" },
  cardinality: { days: { dates: ["2026-06-27"] } }
}
```

The `03:00` start sits squarely inside the `sleep` blackout, but because the window admits
no slot outside it, the solver places the trip there and raises no conflict — running then
is the whole point.

**Medication** — runs in every mode, including vacation.

> *"I take my medication every day at 8am — this has to happen no matter what, even when
> I'm on vacation."*

```
{
  subject: "take medication", mode: "all", priority: 100,
  duration: [1, 1],
  window: { starts_at: "08:00" },
  cardinality: { period: { unit: "day", interval: 1 }, per_day: { count: [1, 1] } }
}
```

---

## Out of scope (MVP)

- **Travel time** — a sequence-dependent transition between adjacent placements that
  couples their times; turns per-day placement into TSP-with-time-windows. The per-day
  step is built as an ordered pass with a `transition(a, b)` function (currently constant
  `padding`) so this can be added later without a rewrite.
- **Event-relative time values** (`Z.end`) and general inter-event relations — replaced in
  bounded form by ordered children inside an intent.
- **A shared resource concept** (e.g. studio hours as a reusable entity) — folded into
  per-day `window.overrides`.
