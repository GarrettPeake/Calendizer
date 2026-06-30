# Calendizer — Copy Review

This file contains every piece of user-facing copy in the web app, each with a
stable identifier. **Edit only the text in the blockquote (`>`) lines** — leave the
`` `id` `` lines and headings untouched. When you're done, I'll reinstate the
updated copy into the source.

Notes:
- `{...}` marks a runtime value injected into the string (e.g. `{count}`) — keep
  these tokens where they belong, but you can move them within the sentence.
- A `/` between two blockquotes under one id means the copy varies by state
  (e.g. idle vs. busy); both variants are editable.
- Tooltips/`title` attributes and `aria-label`s are included — they're copy too.

---

## Login screen — `web/src/Login.tsx`

- **`login.title`** — app name heading
  > Calendizer
- **`login.tagline`** — subtitle under the title
  > Create a dynamic calendar that just works
- **`login.tab.login`** — tab to switch to the login form
  > Log in
- **`login.tab.register`** — tab to switch to the register form
  > Register
- **`login.field.username`** — username input label
  > Username
- **`login.field.password`** — password input label
  > Password
- **`login.field.invite`** — invite-code input label (register only)
  > Invite code
- **`login.submit.login`** — submit button, login mode
  > Log in
- **`login.submit.register`** — submit button, register mode
  > Create account
- **`login.submit.busy`** — submit button while request is in flight
  > …

---

## App shell & calendar toolbar — `web/src/App.tsx`

- **`app.boot`** — full-screen loading state on startup
  > Loading…
- **`app.week.empty`** — week-range label when no week is loaded
  > —
- **`app.week.counter`** — pill showing position in the horizon
  > Week {current} of {total}
- **`app.legend.sleepTag`** — the small tag itself, shown on events placed during sleep
  > sleep
- **`app.legend.sleep`** — legend text describing the sleep tag
  > During sleep hours
- **`app.legend.overlap`** — legend text describing the overlap outline
  > Overlap
- **`app.error.prefix`** — bold label on the error banner
  > Error:
- **`app.error.dismiss`** — button to dismiss the error banner
  > Dismiss
- **`app.conflicts.heading`** — bold heading on the conflicts banner
  > {count} conflict{s} this week:
- **`app.conflicts.item`** — one conflict line (format only)
  > {message}

---

## Sidebar — `web/src/components/Sidebar.tsx`

- **`sidebar.title`** — sidebar app-name heading
  > Calendizer
- **`sidebar.tagline`** — event/conflict counts under the title
  > {events} events · {conflicts} conflict{s}
- **`sidebar.logout`** — log-out button label
  > Log out
- **`sidebar.logout.tip`** — log-out button tooltip
  > Signed in as {username}

### Active intents section

- **`sidebar.intents.title`** — section header
  > {count} Active intents
- **`sidebar.intents.hint`** — section header tooltip
  > The things you intend to do. Click one to edit it.
- **`sidebar.intents.empty`** — shown when there are no intents
  > What do you intend to get done?
- **`sidebar.intents.rowTip`** — tooltip on an intent row
  > Click to edit
- **`sidebar.intents.deleteTip`** — tooltip on the × delete button
  > Remove
- **`sidebar.intents.add`** — add-intent button
  > + new intent

### Modes section

- **`sidebar.modes.title`** — section header
  > Calendar Modes
- **`sidebar.modes.hint`** — section header tooltip
  > Time ranges that behave differently, like a vacation. Intents are mode-specific or global, so you won't be scheduled to sip Mai Tais at the beach during a normal week, only during vacation mode.
- **`sidebar.modes.empty`** — shown when there are no modes
  > Time to plan a vacation?
- **`sidebar.modes.rowTip`** — tooltip on a mode row
  > Click to edit
- **`sidebar.modes.deleteTip`** — tooltip on the × delete button
  > Remove mode
- **`sidebar.modes.add`** — add-mode button
  > + new mode

### Global config section

- **`config.title`** — section header
  > Calendar config
- **`config.hint`** — section header tooltip
  > Settings applied to your whole calendar, hover over each to see what it does
- **`config.wakeup.label`** — field label
  > Wakeup time
- **`config.wakeup.hint`** — field tooltip
  > Your wake time (HH:MM). Useful to schedule intents for 'wakeup' or 'wakeup + 15m'
- **`config.sleep.label`** — field label
  > Bedtime
- **`config.sleep.hint`** — field tooltip
  > Your bedtime (HH:MM). Useful to schedule intents for 'bedtime - 30m'
- **`config.grid.label`** — field label
  > Time grid (min)
- **`config.grid.hint`** — field tooltip
  > Events snap to this many minutes (i.e. no 3:57 starts)
- **`config.padding.label`** — field label
  > Padding (min)
- **`config.padding.hint`** — field tooltip
  > Minimum buffer enforced between events
- **`config.minBreak.label`** — field label
  > Min break
- **`config.minBreak.hint`** — field tooltip
  > Shortest gap that counts as a real "break," anything smaller is avoided so the calendar flows smoothly
- **`config.maxBlock.label`** — field label
  > Max block
- **`config.maxBlock.hint`** — field tooltip
  > Longest continuous run of events before a break is wanted
- **`config.city.label`** — field label
  > City
- **`config.city.hint`** — field tooltip
  > Sets your rough location which allows scheduling things for sunrise/sunset. Also needed to compute your timezone offset. Auto-detected from your IP; change it here to override
- **`config.city.placeholder`** — empty-state option in the city dropdown
  > When is your sunset?
- **`config.city.detectedSuffix`** — appended to a detected city not in the list (e.g. "Reno (detected)")
  > (detected)
- **`config.fillToMax.label`** — checkbox label
  > Maximize events
- **`config.fillToMax.hint`** — checkbox tooltip
  > Always try to schedule the max of a range. An intent 3-5 times a week will schedule 5 times, or an intent that's 2-3 hours long will schedule for 3hours if there's space.

---

## Describe-an-event (AI composer) — `web/src/components/AIComposer.tsx`

- **`ai.title`** — section header
  > Describe your event or intention
- **`ai.hint`** — section header tooltip
  > Describe an intent in plain language and AI will do all the form filling
- **`ai.placeholder`** — textarea placeholder
  > e.g. "Coffee date tomorrow at 7", "Find me 3 evenings this week to practice guitar for 1–2 hours", or "I work out at 7pm on MWF"
- **`ai.submit`** — submit button (idle)
  > Add with AI
- **`ai.submit.busy`** — submit button (in flight)
  > Processing…
- **`ai.note.default`** — fallback confirmation when the model returns no explanation
  > Added
- **`ai.footer`** — helper text under the button
  > <REMOVE>

---

## Calendar feed panel — `web/src/components/FeedPanel.tsx`

- **`feed.title`** — section header
  > Calendar feed
- **`feed.hint`** — section header tooltip
  > Add this calendar to your Calendar app with the below URL (you can rotate the URL to revoke access at any time)
- **`feed.subscribe`** — instruction above the URL field
  > Add this calendar to your Calendar app with this secret URL:
- **`feed.copy`** — copy button (idle)
  > Copy
- **`feed.copy.done`** — copy button (just copied)
  > Copied!
- **`feed.rotate`** — rotate button (idle)
  > Rotate
- **`feed.rotate.confirm`** — confirm dialog before rotating
  > Rotate the secret URL? Any calendar currently subscribed will stop updating.
- **`feed.stats`** — solve summary line; `{in ... ms}` and `{(cached)}` are optional fragments
  > <REMOVE>

---

## Location/timezone detection banner — `web/src/components/DetectBanner.tsx`

- **`detect.heading`** — bold prompt
  > Update location & timezone?
- **`detect.tz`** — follows the heading when a timezone was detected
  > Detected {tzName}.
- **`detect.changed`** — follows the heading when only a generic change was detected
  > Detected a change.
- **`detect.change.item`** — one change line (format only)
  > {label}: {from} → {to}
- **`detect.apply`** — apply button
  > Apply
- **`detect.dismiss`** — dismiss button
  > Dismiss

---

## Theme toggle — `web/src/components/ThemeToggle.tsx`

- **`theme.toggle.tip`** — button tooltip & aria-label; `{next}` is "light" or "dark"
  > Switch to {next} mode

---

## Intent editor (modal) — `web/src/components/IntentEditor.tsx`

- **`intent.head.new`** — modal title, new intent
  > New intent
- **`intent.head.edit`** — modal title, editing; `{subject}` is the intent name
  > Edit "{subject}"

### Modify-with-AI box

- **`intent.ai.placeholder`** — instruction input placeholder
  > Modify with AI — e.g. "make it 4x a week in the mornings"
- **`intent.ai.apply`** — apply button (idle)
  > Apply
- **`intent.ai.apply.busy`** — apply button (in flight)
  > Processing…
- **`intent.ai.reviewSuffix`** — appended to the AI summary, prompting review
  > — review below, then save

### Section group titles

- **`intent.group.basics`**
  > Basics
- **`intent.group.window`**
  > Timing (when an occurrences are placed)
- **`intent.group.cardinality`**
  > Scheduling (how many & how often)
- **`intent.group.children`**
  > Children (break it down into smaller items)

### Basics

- **`intent.field.subject`** — label
  > Name
- **`intent.field.mode`** — label
  > Mode
- **`intent.mode.default`** — dropdown option
  > normal
- **`intent.mode.all`** — dropdown option
  > all (happens in every mode)
- **`intent.mode.unknown`** — dropdown option for a dangling mode reference
  > (unknown mode)
- **`intent.field.priority`** — label
  > Priority
- **`intent.field.durMin`** — label
  > Min duration (m)
- **`intent.field.durMax`** — label
  > Max duration (m)
- **`intent.dur.hint`** — inline hint beside duration
  > <REMOVE>

### Window

- **`intent.window.notBefore`** — label
  > Can't start before
- **`intent.window.notAfter`** — label
  > Can't end after
- **`intent.window.startsAt`** — label
  > Starts exactly at (pin)
- **`intent.window.overrides`** — hint shown when per-weekday overrides exist; `{keys}` lists them
  > Has per-weekday overrides ({keys}) — preserved <NOTE THIS COPY IS CURRENTLY NOT ACTUALLY VISIBLE IN FRONTEND>

### Cardinality

- **`intent.period.unit`** — label
  > Time period to spread occurences in
- **`intent.period.unit.none`** — option
  > One time
- **`intent.period.unit.day`** — option
  > Day
- **`intent.period.unit.week`** — option
  > Week
- **`intent.period.unit.month`** — option
  > Month
- **`intent.period.unit.mode`** — option
  > Calendar Mode
- **`intent.period.interval`** — label
  > <REMOVE>
- **`intent.days.selection`** — label
  > What days?
- **`intent.days.none`** — option
  > — none — <WHAT IS THIS OPTION FOR?>
- **`intent.days.count`** — option
  > Count, spread across the period
- **`intent.days.weekdays`** — option
  > Specific weekdays
- **`intent.days.dates`** — option
  > Specific dates
- **`intent.days.minDays`** — label
  > Min days
- **`intent.days.maxDays`** — label
  > Max days
- **`intent.days.bucketHint`** — inline hint
  > per period bucket <THIS COPY DOES NOT EXIST ON FRONTEND>
- **`intent.days.weekdaysLabel`** — label for the weekday toggle row
  > <REMOVE>
- **`intent.days.datesLabel`** — label for the dates input
  > Dates (YYYY-MM-DD format, separate multiple with commas)
- **`intent.perDay.toggle`** — checkbox label
  > Schedule multiple per day
- **`intent.perDay.min`** — label
  > Min
- **`intent.perDay.max`** — label
  > Max
- **`intent.total.toggle`** — checkbox label
  > Limit total occurences
- **`intent.total.min`** — label
  > Min (leave blank for no min)
- **`intent.total.max`** — label
  > Max (leave blank for ∞)

### Children

- **`intent.children.toggle`** — checkbox label
  > Has children
- **`intent.children.subjectPlaceholder`** — child subject input placeholder
  > Name
- **`intent.children.type.duration`** — child type option
  > Fixed time (min)
- **`intent.children.type.weight`** — child type option
  > Fill (weight)
- **`intent.children.add`** — add-child button
  > + add child
- **`intent.children.hint`** — explanatory hint under the children list
  > Children fill the block in order, no gaps. Must keep at least one "fill" child and fixed children must sum to at most the min duration. <MOVE THIS TO THE TOP OF THE CHILDREN SECTION UNDER "HAS CHILDREN">

### Footer

- **`intent.cancel`** — cancel button
  > Cancel
- **`intent.save.new`** — save button, new intent
  > Add intent
- **`intent.save.edit`** — save button, editing
  > Save changes

### Time-value sub-control (used by window fields)

- **`intent.tv.none`** — option
  > — unset —
- **`intent.tv.clock`** — option
  > clock time
- **`intent.tv.clockPlaceholder`** — clock-time input placeholder
  > HH:MM
- **`intent.tv.offsetTip`** — tooltip on the marker offset input
  > offset minutes
- **`intent.tv.offsetSuffix`** — suffix shown beside a marker offset
  > ±min

---

## Mode editor (modal) — `web/src/components/ModeEditor.tsx`

- **`mode.head.new`** — modal title, new mode
  > New mode
- **`mode.head.edit`** — modal title, editing; `{name}` is the mode name
  > Edit "{name}"
- **`mode.field.name`** — label
  > Name
- **`mode.field.namePlaceholder`** — name input placeholder
  > e.g. Bahamas Cruise
- **`mode.field.from`** — label
  > From
- **`mode.field.to`** — label
  > To
- **`mode.field.datePlaceholder`** — from/to date input placeholder
  > YYYY-MM-DD
- **`mode.hint`** — explanatory hint
  > During this span, only intents set to this mode (plus "all") are active
- **`mode.cancel`** — cancel button
  > Cancel
- **`mode.save.new`** — save button, new mode
  > Add mode
- **`mode.save.edit`** — save button, editing
  > Save changes
