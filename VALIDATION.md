# Calendizer — Form Validation & Entry-Disablement Spec

Consolidated from a code-traced audit of all four forms (Intent editor, Mode editor,
Global config, Login/Register). Each rule names the field, the condition, the
**consequence traced through the actual solver/server code**, a severity, and the
recommended UX.

Severity legend:
- **BLOCK** — disable Save / reject; the data is invalid or produces garbage.
- **WARN** — allow Save but show an inline caution; the result is surprising or inert.
- **DISABLE/HIDE** — entry-disablement: the field is ignored in this state, so don't let the user enter it.

---

## 0. Cross-cutting findings (read first — these shape everything)

1. **The solver never throws and never reports "infeasible."** Bad input either (a)
   silently corrupts arithmetic with `NaN` (→ `"NaN:NaN"` times, non-deterministic
   sort order), (b) silently produces **zero** occurrences, or (c) emits a post-hoc
   `ConflictReport`. There is no engine-level signal, so **validation is entirely a
   front-end + API responsibility.**
2. **The API does ZERO validation.** Every route (`api/src/index.ts`) and repo write
   (`api/src/repo.ts`) accepts raw values; the AI `/smart` path can also create
   intents/modes and bypasses any client-only checks. Error-level rules should be
   mirrored server-side, not just in React.
3. **`min === 0` is a legitimate "filler" intent** (`features/filler-min-zero.feature`):
   a `0` floor on `days.count` / `per_day.count` / `total` intentionally schedules
   nothing. **Never block a `0` floor** — only block negatives and `min > max`.
4. **`min_break` and `max_block` are collected by the config form but NEVER read by
   any solver code** (only references are `types.ts` + `Sidebar.tsx`). → **RESOLVED (D1):
   remove both fields from the config form.**
5. **`fillToMax` (a global) silently governs whether several Intent "max" fields do
   anything.** With it off (the default), `Max duration` and `Max days` are inert;
   `per_day Max` was inert *unconditionally*. → **RESOLVED (D2): implement `per_day`
   max in the solver (extend fillToMax to add per-day stacks, with tests); leave
   `Max duration`/`Max days` always editable and rely on a hint (no greying).**
6. **A shared numeric-coercion guard kills a whole class of bugs.** Every
   `onChange={Number(e.target.value)}` yields `NaN` on empty input and accepts
   negatives/floats. One integer+range helper on every numeric field removes most of
   the `NaN`-propagation rules below at once.
7. **Marker-relative bounds resolve per-date**, so window rules involving a marker
   should generally be **WARN**, not BLOCK (the editor can't know the resolved minute
   at edit time). Clock-vs-clock comparisons can be hard BLOCKs.

### Decisions (RESOLVED)
- **D1 — min_break / max_block:** ✅ **Remove both from the config form.**
- **D2 — inert "max" fields:** ✅ **Implement `per_day` max in the solver** (extend
  the fillToMax logic to add per-day stacks when there's room; add Cucumber tests).
  **`Max duration` / `Max days` stay always-editable** with an explanatory hint
  (they only take effect when the global "Maximize events" is on) — no greying.
- **D3 — pickers:** ✅ **Yes** — Mode From/To → native `<input type="date">`; config
  `wakeup`/`sleep` → `<input type="time">`.
- **D4 — Mode overlap:** ✅ **Block at Save, treating spans as INCLUSIVE** — a mode
  `10/3–10/5` reserves 10/3, 10/4, and 10/5; any other mode touching those days
  (including shared endpoints) is rejected. Matches the solver's inclusive check.
- **D5 — Login:** ✅ **Full hardening** — client mirrors of the server rules +
  confirm-password field + HTTP-status→field error mapping + input-attribute fixes.

---

## 1. Intent editor (`web/src/components/IntentEditor.tsx`)

### 1a. Validations

**Basics**
| Field | Invalid when | Severity | Message / consequence |
|---|---|---|---|
| Name | empty/whitespace | BLOCK | "Give this intent a name." (already gates Save) |
| Name | non-empty but slugifies to empty (e.g. `"!!!"`, emoji) and no explicit id | BLOCK | "Name must contain at least one letter or number." (empty slug → UID collisions in `expand.ts`) |
| Priority | non-integer / NaN | BLOCK | "Priority must be a whole number from 0 to 100." (NaN → non-deterministic sort in `solver.ts`) |
| Priority | finite but outside 0–100 | WARN | out-of-range silently out-ranks everything |
| Min/Max duration | `min > max` | BLOCK | "Min duration can't be more than max duration." |
| Min duration | `< 0` | BLOCK | "Min duration must be a positive number of minutes." |
| Min duration | `= 0` **with** a non-zero cardinality floor | WARN | "Use 0 only for a 'free time' filler." |
| Durations | non-integer / NaN / max ≤ 0 | BLOCK | "Durations must be whole positive minutes." (NaN → `"NaN:NaN"` ISO times) |
| Min duration | larger than window (`not_after − not_before < min`), both clock | BLOCK | "This won't fit: the window is shorter than the minimum duration." (→ `window-unsatisfiable` every day) |
| Min duration | larger than window, a bound is a marker | WARN | same, but per-date |

**Timing / window**
| Field | Invalid when | Severity | Message / consequence |
|---|---|---|---|
| not_before / not_after | resolved `not_before > not_after`, both clock | BLOCK | "'Can't start before' must be earlier than 'Can't end after'." |
| same, a bound is a marker | WARN | per-date resolution can vary |
| starts_at (pin) | set, while not_before/not_after also set | WARN | "A fixed start time overrides the start/end window — those bounds will be ignored." (pin wins unconditionally in `bestPlacement`) |
| any marker + offset | offset pushes resolved time `< 0` or `> 1440` | WARN | "This offset can push the time outside the day." (no clamping in `markers.ts`; spill rolls onto next date) |
| clock string | not `^([01]\d|2[0-3]):[0-5]\d$` | BLOCK | "Enter a time as HH:MM (00:00–23:59)." (`hhmmToMinutes` → NaN) |
| window vs sleep | window fully inside sleep blackout | WARN | "This window falls during your sleep hours — it'll be scheduled there anyway." (no conflict; sets `placedDuringSleep`) |

**Scheduling / cardinality**
| Field | Invalid when | Severity | Message / consequence |
|---|---|---|---|
| interval | `< 1` or non-integer | BLOCK (coerce <1→1) | "Repeat interval must be a whole number of 1 or more." |
| days.count | `min > max` | BLOCK | "Min days can't exceed max days." |
| days.count min | `< 0` or non-integer (0 is valid) | BLOCK | "Min days must be a whole number (0 or more)." |
| days.count min | exceeds available days in a bucket (e.g. 8×/week) | WARN | "A period only has Y available days — only Y will be scheduled." (silently under-fills, NO conflict) |
| weekdays | empty selection | BLOCK | "Pick at least one weekday." (→ zero occurrences) |
| weekdays | none occur in the active period/mode | WARN | "None of the selected weekdays occur — nothing will be scheduled." |
| dates | empty | BLOCK | "Add at least one date." |
| dates | any not `YYYY-MM-DD` | BLOCK | "Dates must be in YYYY-MM-DD format." (never matches → silent) |
| dates | outside the 12-month horizon | WARN | "This date is outside the planning window and will be ignored." |
| dates | not active for the chosen mode | WARN | "This date isn't active for the chosen mode." |
| per_day | `min > max` | BLOCK | "Min per day can't exceed max per day." |
| per_day min | `< 0` / non-integer (0 valid) | BLOCK | "Per-day count must be a whole number (0 or more)." |
| per_day | count too high to fit (count × (dur+padding) > waking window) | WARN | "This many per day won't fit — some will overlap." |
| total | `min > max` | BLOCK | "Total min can't be more than total max." |
| total max | `= 0` or `< 0` | BLOCK | "A total max of 0 means this never happens — uncheck 'Limit total' or set a positive max." |
| total min | unreachable within horizon | WARN | "There aren't enough available days to reach this total." (silent under-fill) |
| total max | lower than the per-period floors would produce | WARN | "Your total cap is lower than the schedule would produce — only X kept." |
| total min/max | non-integer / NaN | BLOCK | "Total min/max must be whole numbers (or blank)." |

**Mode reference**
| Field | Invalid when | Severity | Message |
|---|---|---|---|
| Mode | references a deleted/dangling mode (shows "(unknown mode)") | WARN | "This mode no longer exists; it'll fall back to 'normal'. Pick a current mode." (`resolveModeName` → 'default') |

**Children**
| Field | Invalid when | Severity | Message |
|---|---|---|---|
| Children | no "Fill" (weight) child exists | BLOCK | "Add at least one 'Fill' child so the block is fully covered." (can't absorb slack) |
| Children | sum of fixed durations `> min duration` | BLOCK | "Fixed children add up to more than the min duration — they won't fit." (children spill past parent) |
| Child name | empty/whitespace | BLOCK | "Every child needs a name." |
| Child fixed duration | `≤ 0` / non-integer | BLOCK | "Child duration must be a whole positive number of minutes." |
| Child weight | `≤ 0` / non-integer | BLOCK | "Fill weight must be a whole positive number." (zero total weight → under-tiled block) |

**Cross-field**
| Condition | Severity | Message |
|---|---|---|
| weekdays selected don't fall in the mode span | WARN | "None of the chosen weekdays fall inside this mode's date range." |
| per_day × duration × padding impossible after sleep | WARN | "This many per day, at this length/padding, won't fit your waking hours." |
| period = "Calendar Mode" but intent.mode = normal/all | WARN | "'Per calendar mode' works best when this intent is tied to a specific mode." |

### 1b. Entry disablement / field relevance

| Field | Disable/Hide/Ignored when | Why (code) | Behavior |
|---|---|---|---|
| Interval | period is "One time" OR "Calendar Mode" | `mergeIntervalBuckets` no-op; mode buckets ignore it | DISABLE (already done) |
| Max days | `fillToMax` OFF (cross-form) | only read in the `if (fillToMax && isCountDays)` block | KEEP EDITABLE + hint "only used when Maximize is on" |
| Min/Max days | days-mode ≠ "count" | only rendered for count (already) | already hidden |
| "Count, spread across the period" label | period = "One time" | bucket is `'all'` (whole horizon), not a period | RELABEL dynamically ("…across the whole horizon") |
| days "none" + "One time" | always | `chooseDays` returns **every** day → an event daily | WARN / require a days selection when period is "One time" |
| per_day + "One time" + days "none" | always | fans out across every horizon day | WARN (needs a day anchor) |
| per_day Max | (was never read — being IMPLEMENTED per D2) | extend fillToMax to add per-day stacks toward `count[1]` | KEEP as min/max range; wire into solver + tests |
| total Min | a days/per_day selection exists | flat-quota path only runs without nested selection | HINT (it becomes a safety floor, not a quota) |
| Max duration | `fillToMax` OFF (cross-form); also single/uncontended occurrences even when ON | only `distributeDurations` (gated on fillToMax, needs ≥2 contending) reads `duration[1]` | KEEP EDITABLE + hint "only used when Maximize is on" |
| not_before / not_after | `starts_at` (pin) is set | pin short-circuits window resolution | DISABLE both while pinned |
| "(unknown mode)" option | `d.mode` matches no known id/name | dangling-ref round-trip | keep option + WARN |

**Summary of the "max" fields:**
| Field | Max ever used? | Gated by fillToMax? |
|---|---|---|
| duration[1] | yes (`distributeDurations`) | yes (+ needs ≥2 contending) |
| days.count[1] | yes (aspiration slots) | yes |
| per_day.count[1] | being implemented (D2) | yes (new fillToMax per-day stacks) |
| total[1] | yes — caps recurrence always | no (always live) |

---

## 2. Mode editor (`web/src/components/ModeEditor.tsx`)

### 2a. Validations
| Field | Invalid when | Severity | Message / consequence |
|---|---|---|---|
| Name | empty/whitespace | BLOCK | "Give the mode a name." (already gates Save) |
| Name | duplicates another mode's name | WARN | "Another mode is already called 'X' — they'll be hard to tell apart." (intents bind by id, so legal) |
| Name | > ~80 chars | WARN | "Keep the name under 80 characters." |
| From / To | not strict `YYYY-MM-DD` (e.g. `2026-2-3`, `next week`, slashes, `T00:00`) | BLOCK | "Use YYYY-MM-DD with zero-padded month/day." **Most dangerous case:** unpadded-but-numeric parses fine yet breaks the **lexicographic** comparisons in `modes.ts` → mis-scoped mode |
| From / To | impossible calendar date (`2026-13-40`, `2026-02-30`) | BLOCK | "That isn't a real calendar date." (`parseDate` silently rolls over via `Date.UTC`) |
| From / To | `from > to` (inverted) | BLOCK | "The end date must be on or after the start date." (mode never matches any day → dead) |
| From / To | `from === to` | VALID | single-day mode is legitimate — don't block |
| From / To | span entirely outside the 12-month horizon | WARN | "This span is outside the next 12 months, so it won't affect your calendar yet." (inert) |
| From / To | span partially outside horizon | WARN | "Only the portion within the planning window will be scheduled." |
| From / To | shares ANY day with another mode's span, treating both spans INCLUSIVELY (incl. shared endpoints, e.g. `10/1–10/3` vs `10/3–10/5`) | BLOCK (D4) | "These dates overlap mode 'X' (which reserves D1–D2). Pick dates that don't share any day." |
| (whole mode) | no intents bound to it | WARN | "No intents are assigned — during its span your default routine pauses and only 'all' intents run." (modes suppress `default` intents) |

### 2b. Affordances / disablement
- **Native date pickers** for From/To (`<input type="date">`) — emits exactly the
  `YYYY-MM-DD` the model needs, eliminates the entire malformed-date class. (D3)
- **Bind To's `min` to From** (and From's `max` to To) so an inverted span is
  structurally impossible.
- **Auto-fill To = From + 6** when To is empty and From changes (mirrors the
  existing new-mode default in `App.tsx`).
- **Gate Save** additionally on: valid dates + `from ≤ to` (BLOCK) + **no inclusive
  overlap with any other mode (BLOCK, D4)**. Out-of-horizon / duplicate-name → WARN.
- **Normalize Name** on blur/save (trim, collapse internal whitespace).
- **No fields to hide** — all three are always relevant.
- Pass the **other modes** (excluding self by id) and the **horizon** into the editor
  (it currently receives neither) to enable overlap/horizon checks.

---

## 3. Global config (`ConfigCard` in `web/src/components/Sidebar.tsx`)

### 3a. Validations
| Field | Invalid when | Severity | Message / consequence |
|---|---|---|---|
| wakeup / sleep | not `HH:MM` (00:00–23:59) | BLOCK | "Enter a time as HH:MM." (`hhmmToMinutes`→NaN corrupts blackout + all markers) |
| wakeup / sleep | `wakeup === sleep` | WARN | "No protected sleep window." (blackout collapses) |
| wakeup / sleep | `sleep < wakeup` | WARN | "Bedtime is earlier than wakeup — sleep may not be enforced as expected." (solver & calendar disagree on asleep hours) |
| grid | `≤ 0` / NaN / non-integer | BLOCK | "Grid must be a whole number of minutes, at least 1." (NaN grid → all starts NaN) |
| grid | absurdly large (> usable window) | WARN | "Larger than a usable day — most events won't find a start time." |
| padding | `< 0` / NaN | BLOCK | "Padding can't be negative." (NaN disables overlap detection → silent stacking) |
| padding | absurdly large | WARN | "Leaves no room for events to coexist." (spurious overlap conflicts) |
| ~~min_break / max_block~~ | — | — | **REMOVED from the form (D1).** |
| city / location | unset while an intent uses a solar marker (sunrise/sunset/dawn/dusk) | WARN | "Set your city for real sunrise/sunset — otherwise a default 6am/6pm is used." (`solar.ts` FALLBACK) |
| utcOffsetMinutes | NaN / outside [-720, 840] | BLOCK | "Timezone offset must be between -12:00 and +14:00." (only reachable via injected data; not directly editable) |
| city vs location | city name set (IP-detected, not in list) but location null | WARN | "We know your city name but not its coordinates — pick the nearest listed city." |
| awake window | too short to fit required floors | WARN | "Your awake window is very short — events may be scheduled during sleep." |
| any numeric | field cleared (NaN) | BLOCK | "Enter a number." |

### 3b. Affordances / disablement
- **wakeup / sleep → `<input type="time">`** with `step={60}` (D3). Guard `onChange`
  so a cleared (`""`) value doesn't overwrite a valid time.
- **grid** → `min={1} step={1}` (+ maybe a `<select>` of 1/5/10/15/30). The solver
  already clamps to ≥1, so `0` is silently ignored today — `min={1}` makes the input honest.
- **padding** → `min={0} step={5}` + sane max.
- **min_break / max_block** → **removed from the form (D1).**
- **City is already the sole writer** of location/utcOffset/city — confirmed, no raw
  lat/lon inputs remain. **Keep `utcOffsetMinutes` non-editable** (pure derived value;
  editing it alone only desyncs from the city). Note: offset is a snapshot at
  selection time (DST drift until reselect/auto-detect).
- **fillToMax** — surface its cross-form effect (it only matters when intents have
  ranges; makes Intent `Max duration`/`Max days` operative). Consider a hint or a
  "Maximize is on" badge near the range fields.

---

## 4. Login / Register (`web/src/Login.tsx`, server `api/src/index.ts`)

### 4a. Server ground truth (authoritative)
- Username trimmed; **password NOT trimmed** (spaces significant).
- Register requires: `INVITE_CODE` configured (`403` if not), `invite === env.INVITE_CODE`
  (`403`), trimmed username ≥3 **and** password ≥8 (`400`, one combined message).
- Username uniqueness via `TEXT UNIQUE` (**case-sensitive** BINARY collation); pre-check
  → `409 "Username taken"`.
- Login: opaque `401 "Invalid username or password"` for any failure (no enumeration).
- **No** username max/char rule, **no** password max/strength rule, **no** password reset.

### 4b. Validations (client should enforce before the round-trip)
| Field | Invalid when | Severity | Message |
|---|---|---|---|
| Username | empty/whitespace | BLOCK | "Enter a username." |
| Username | trimmed length < 3 | BLOCK | "Username must be at least 3 characters." |
| Username | > 32 (server has no max) | WARN/BLOCK (client policy) | "Username must be 32 characters or fewer." |
| Username | chars outside `[A-Za-z0-9._-]` (server allows any) | WARN/BLOCK (client policy) | "Use letters, numbers, dots, underscores, or hyphens only." |
| Username | (case-sensitivity) | INFO | "Usernames are case-sensitive." |
| Username | taken (server `409`) | BLOCK (post-submit) | "That username is already taken." (map 409 → Username field) |
| Password | empty | BLOCK | "Enter your password." |
| Password | length < 8 | BLOCK | "Password must be at least 8 characters." |
| Password | leading/trailing spaces | WARN | "Your password contains leading/trailing spaces — they'll be part of it." |
| Password | > 128 (no server cap) | WARN/BLOCK (client policy) | "Password must be 128 characters or fewer." |
| Confirm password | ≠ password (**field doesn't exist — add it**, D5) | BLOCK | "Passwords don't match." (no reset flow → typo = lockout) |
| Invite (register) | empty | BLOCK | "An invite code is required to register." |
| Invite (register) | wrong / disabled (server `403`) | BLOCK (post-submit) | "That invite code isn't valid." / "Registration is currently closed." |
| Login failure | server `401` | BLOCK (post-submit) | "Incorrect username or password." (form-level, not field-level) |

### 4c. Affordances / disablement
- **Submit gating**: currently `busy`-only. Add per-mode empty-field gating
  (`username.trim()`, `password !== ''`, and register: `invite.trim()`). Early-return
  in `submit` when not submittable (onSubmit fires even when the button is disabled).
- **Clear on tab switch**: reset `error` + `invite`; **keep** username/password.
  (Stale `invite` persists in state today even though the input is hidden in login.)
- **Disable inputs + tab buttons while `busy`** (not just the submit button).
- **Map HTTP status → friendly, field-targeted errors** (409/403/401/400/500). The
  request layer (`api.ts`) currently discards `res.status` before throwing — surface it.
- **Input attributes**: invite needs an `autoComplete`; add `autoCapitalize="none"`
  `spellCheck={false}` `autoCorrect="off"` to username + invite (case-sensitive!);
  add a show/hide **password toggle** (`type="button"`); consider `name` attrs.
- Already correct: invite hidden in login, password `autoComplete` switches
  current/new, username `autoFocus`/`autoComplete`, real `<form>` Enter-to-submit,
  tabs are `type="button"`.
- **Server robustness** (out of client scope): wrap `createUser` to map the UNIQUE
  violation to `409` (the check-then-insert has a TOCTOU race that currently 500s).

---

## Suggested implementation approach
- A shared **`Field` validation primitive** (value + rule → error string) and an
  **integer/range numeric input** wrapper handle ~60% of these declaratively.
- A small **`validateIntent(intent, config, modes, horizon)`** pure function returns
  `{ errors: [], warnings: [] }` — reuse it client-side (gate Save + inline) AND in
  the API handler (so the `/smart` path is covered too).
- Mirror the same for `validateMode`, `validateConfig`, `validateCredentials`.
- Resolve D1–D5 first; they change which fields exist and which rules are BLOCK vs WARN.
