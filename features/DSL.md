# Calendizer Cucumber DSL — authoring reference

You are writing **one `.feature` file**. The library and **all** step definitions
already exist — **do not** write or modify any `.ts` files, the World, or step
definitions. Use **only** the steps listed here, verbatim. If you think you need a
step that doesn't exist, rephrase your scenario to use what's available.

The solver is **deterministic**: same inputs → same output, every time. Your
assertions must match the documented behaviour below exactly.

---

## 1. The intent JSON (what you place)

Intents are added via a docstring of JSON (keys quoted; `//` comments allowed).
Full field semantics are in `/Users/gepeake/Downloads/calendar-intent-schema.md` —
read it. Shape:

```json
{
  "subject": "pottery",            // required; identifies occurrences in assertions
  "mode": "default",               // "default" | "<mode name>" | "all"
  "priority": 50,                  // higher wins contention
  "duration": [60, 120],           // [min,max] minutes; min==max ⇒ fixed
  "window": {
    "not_before": "09:00",         // TimeValue: "HH:MM" or {"marker":"sunset","offset_min":-30}
    "not_after": "19:00",
    "starts_at": "08:00",          // pins start (only needed with flexible duration)
    "overrides": { "TU,TH": { "not_after": "21:00" } }
  },
  "children": [                    // optional ordered tiling; needs >=1 weight child
    { "subject": "warmup", "duration": 10 },
    { "subject": "main", "weight": 1 }
  ],
  "cardinality": {
    "period": { "unit": "week", "interval": 1 },   // day|week|month|mode
    "days": { "count": [3, 4] },                   // or {"weekdays":[...]} or {"dates":[...]}
    "per_day": { "count": [1, 1] },
    "total": [2, null]                              // lifetime [min,max]; null = open
  },
  "id": "optional-stable-id"       // defaults to slug of subject
}
```

Markers (closed set): `wakeup | sleep | dawn | dusk | sunrise | sunset`.

---

## 2. Deterministic behaviour contract — predict outputs from THIS

**Duration.** Every occurrence is placed at the **floor** `duration[0]`. `max` is a
weak aspiration the deterministic MVP does **not** fill. So a `[60,120]` event is
always 60 minutes. Assert exact durations against the floor; or use the "between"
step.

**How many occurrences are placed (the floor is what you get):**
- `days.count: [min,max]` → exactly **min** days are chosen per period bucket.
- `days.weekdays` → every listed weekday present in the bucket.
- `days.dates` → exactly those dates (that fall in the horizon).
- `per_day.count: [min,max]` → exactly **min** occurrences per chosen day.
- `total: [min, max]` → `max` caps & terminates lifetime count; a `min` with **no**
  `days`/`per_day` spec is a flat quota of **min** occurrences spread across the span.
- No `days`/`per_day` and a periodic bucket → **1** day per bucket.

**Which days get chosen (even spread, deterministic).** When the solver chooses `k`
of `n` available days, it uses this exact rule — for `i` in `0..k-1`:
`index = clamp(round((i + 0.5) * n / k - 0.5))`, de-duplicated, returned in
chronological order. Examples you can rely on:
- choose 3 of 7 (Mon–Sun) → indices **1, 3, 5** → **Tue, Thu, Sat**.
- choose 2 of 7 → indices **1, 5** → **Tue, Sat**.
- choose 1 of 7 → index **3** → **Thu**.
- choose 4 of 7 → indices **0, 2, 4, 6** → Mon, Wed, Fri, Sun.
- choose 2 of 5 (Mon–Fri) → indices **1, 3** → Tue, Thu.

**Period buckets.** `week` = ISO week (Mon–Sun). `month` = calendar month. `day` =
each date. `mode` = the named mode's span. `interval > 1` merges consecutive buckets
into groups of `interval`.

**Where in the day an occurrence lands (earliest-fit):**
- If `starts_at` is set → the start is **pinned** to that exact time (hard).
- Otherwise the start is the **earliest grid-aligned time ≥ `not_before`** at which
  the occurrence fits without overlapping anything already placed (respecting
  `padding` as the minimum gap). With nothing else in the window, a single daily
  occurrence starts **exactly at `not_before`** (snapped up to the grid).
- `not_before` defaults to 00:00, `not_after` to 24:00 when omitted.

**per_day spread.** Multiple occurrences on one day are banded across the legal
window: occurrence `j` of `n` searches from `not_before + floor(span*j/n)` (snapped
to grid) and takes the earliest free slot there. They never overlap.

**Priority & clumping.** Intents are placed **priority desc**, then subject A→Z.
Earlier-placed events are obstacles for later ones, so contended events stack
**back-to-back** (separated by `padding`). The highest-priority intent keeps its
preferred (earliest) slot.

**Grid.** Starts snap **up** to a multiple of `grid` minutes. (Pinned `starts_at`
times are used as-is — keep them grid-aligned in your intent if you assert grid.)

**Sleep blackout (yields).** Discretionary placement avoids `[sleep, wakeup]`. The
sleep window is removed from an intent's legal window **only while that leaves room**;
if the only legal slot is inside sleep (e.g. a `starts_at: "03:00"` with `wakeup`
later), the event is placed there, marked "placed during sleep", and **no conflict**
is raised. Normal daytime events are **not** marked placed-during-sleep.

**Modes.**
- During a mode span: active = intents with `mode` == that mode's name **or** `"all"`;
  `default` intents are **suppressed**.
- Outside any mode: active = `default` + `all`.
- `all` intents run in **every** mode.
- Overlapping mode spans raise a `mode-overlap` conflict.

**Conflicts.** The solver **always places**. It raises a conflict when forced to
**overlap** (`kind: "overlap"`), when a window is too small for the duration floor
(`window-unsatisfiable`), or when modes overlap (`mode-overlap`). A clean schedule
has **no conflicts**.

**Existing calendar.** Fixed events (added via the Background) are **immovable
obstacles** — derived occurrences route around them (or overlap + conflict if forced).
Previously-derived instances re-solve to `create`/`update`/`delete`/`unchanged`.

---

## 3. Step vocabulary (use these EXACTLY)

### Background / setup (`Given` / `And`)
```
Given the planning horizon is "2026-07-06" to "2026-07-12"
And wakeup is "07:00" and sleep is "23:00"
And wakeup is "06:30"
And sleep is "22:00"
And the grid is 5 minutes
And padding is 10 minutes
And the minimum break is 15 minutes
And the maximum block is 180 minutes
And the location is latitude 40.7 longitude -74.0
And the UTC offset is -240 minutes
And a mode "vacation" spanning "2026-07-06" to "2026-07-12"
And an existing fixed event "Standup" on "2026-07-06" from "09:00" to "09:30"
And an existing fixed event "Flight" from "2026-07-06T18:00" to "2026-07-06T21:00"
And a previously derived instance for intent "pottery" with uid "pottery|week:2026-W28|0" on "2026-07-07" from "09:00" to "10:00"
```

### Adding intents & solving
```
When I add the intent:
  """
  { ...intent JSON... }
  """
When I add the intents:
  """
  [ { ...intent... }, { ...intent... } ]
  """
When I solve
When I re-solve
```
(You may also use `Given the intent:` / `Given the intents:` in the Background.)

### Counts
```
Then there are 3 occurrences of "pottery"
Then there is 1 occurrence of "fishing"
Then there are no occurrences of "team standup"
Then "pottery" has between 3 and 4 occurrences
Then there are 2 occurrences of "stretching" on "2026-07-07"
Then the total number of placed occurrences is 10
```

### Placement & timing
```
Then an occurrence of "pottery" is placed on "2026-07-07"
Then no occurrence of "pottery" is placed on "2026-07-06"
Then the occurrence of "fishing" on "2026-07-11" starts at "03:00"
Then the occurrence of "fishing" on "2026-07-11" ends at "07:00"
Then the occurrence of "pottery" on "2026-07-07" runs from "09:00" to "10:00"
Then every occurrence of "pottery" starts at or after "09:00"
Then every occurrence of "pottery" ends at or before "19:00"
Then every occurrence of "pottery" starts at or before "12:00"
Then every occurrence of "take medication" starts at "08:00"
Then every occurrence of "stretching" lasts 10 minutes
Then every occurrence of "pottery" lasts between 60 and 120 minutes
Then every occurrence of "pottery" is aligned to the grid
Then every occurrence is aligned to the grid
Then every occurrence of "pottery" falls on a weekday in "TU,TH,SA"
Then occurrences of "fishing" fall on dates "2026-07-11"
```

### Overlap / spacing
```
Then no two occurrences overlap
Then no two occurrences of "stretching" overlap
Then occurrences of "pottery" do not overlap occurrences of "yoga"
Then no occurrence overlaps the fixed event "Standup"
Then occurrences of "stretching" are at least 60 minutes apart
```

### Children
```
Then the occurrence of "morning routine" on "2026-07-06" has children in order "brush teeth, do hair, shower"
Then the children of "morning routine" on "2026-07-06" are contiguous
Then the child "shower" of "morning routine" on "2026-07-06" lasts 10 minutes
```

### Sleep
```
Then the occurrence of "fishing" on "2026-07-11" is placed during sleep
Then no occurrence is marked as placed during sleep
```

### Conflicts
```
Then there are no conflicts
Then there is a conflict
Then there are 2 conflicts
Then there is a conflict involving "pottery"
Then there is a conflict involving "pottery" and "yoga"
Then there is a conflict of kind "overlap"
```
Conflict kinds: `overlap`, `window-unsatisfiable`, `mode-overlap`, `floor-unmet`.

### Updates / re-solve
```
Then the update for uid "pottery|week:2026-W28|0" is "unchanged"
Then there are 3 "create" updates
Then there is a "delete" update
```
Update kinds: `create`, `update`, `delete`, `unchanged`. The UID for a derived slot
is `"<intentId>|<bucketKey>|<perDayIndex>"`, where bucketKey is e.g.
`week:2026-W28`, `day:2026-07-07`, `month:2026-07`, `mode:vacation`, `span`, or
`all`. intentId defaults to the slugified subject (lowercase, non-alnum → `-`).

### Exact-schedule tables
```
Then the occurrences of "pottery" are:
  | date       | start | end   |
  | 2026-07-07 | 09:00 | 10:00 |
  | 2026-07-09 | 09:00 | 10:00 |
  | 2026-07-11 | 09:00 | 10:00 |

Then the schedule is:
  | subject  | date       | start | end   |
  | pottery  | 2026-07-07 | 09:00 | 10:00 |
```
(`the schedule is:` lists ALL instances, ordered by start time then subject.)

### Debug (optional, remove before finalising)
```
Then print the schedule
```

---

## 4. Rules for your feature file

1. **One `Feature:`** with a short description, a `Background:` that sets up config
   + (optionally) an existing calendar/modes, and **multiple `Scenario:`s** (aim for
   6–12) — each adds intents and asserts the resulting placement.
2. Cover your assigned **situation** thoroughly and from multiple angles. Vary
   durations, windows, counts, priorities, edge times.
3. **Every scenario must end green** against the documented behaviour. Compute
   expected values using §2. When unsure of an exact clock time, assert an
   **invariant** (range / ordering / count / non-overlap / within-window) instead of
   an exact time — these are always safe.
4. Prefer realistic, human prompts in scenario names (e.g. "Schedule guitar practice
   3× this week").
5. Keep dates inside your declared horizon. Use 2026 dates.
6. Do **not** add new step phrasings. Do **not** touch `src/`, `features/support/`,
   or `features/step_definitions/`.
7. Name your file exactly as instructed and put it in `features/`.
```
