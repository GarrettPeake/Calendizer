Feature: Existing fixed events as immovable obstacles
  Fixed events on the existing calendar are immovable: a derived occurrence may
  not sit in a slot a fixed event blocks (within padding). Earliest-fit skips
  past the obstacle, snapping the start up to the grid; when a window is fully
  blocked the solver places anyway and reports an "overlap" conflict.

  All fixed obstacles below sit on Monday 2026-07-06, so intents on other days
  are unaffected — which keeps each placement easy to predict from DSL.md §2.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes
    And an existing fixed event "Standup" on "2026-07-06" from "09:00" to "09:30"
    And an existing fixed event "Dentist" on "2026-07-06" from "11:00" to "12:00"
    And an existing fixed event "Flight" from "2026-07-06T18:00" to "2026-07-06T21:00"

  Scenario: A fixed event at not_before forces the event to start right after it
    # Studio opens at 09:00 but Standup holds 09:00-09:30, so earliest-fit is 09:30.
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "deep work"
    And the occurrence of "deep work" on "2026-07-06" runs from "09:30" to "10:30"
    And no occurrence overlaps the fixed event "Standup"
    And every occurrence of "deep work" is aligned to the grid
    And there are no conflicts

  Scenario: A mid-window fixed event the derived event has to jump over
    # Window 10:30-17:00; Dentist 11:00-12:00 leaves only 30 min before it,
    # too little for the 60-min floor, so the event lands after the obstacle.
    When I add the intent:
      """
      {
        "subject": "client call", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "10:30", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "client call" on "2026-07-06" runs from "12:00" to "13:00"
    And no occurrence overlaps the fixed event "Dentist"
    And there are no conflicts

  Scenario: Multiple fixed events fragment the window; stacked occurrences fall in separate fragments
    # Standup, Dentist and Flight cut Monday into pieces; per_day=2 bands the day,
    # the first slot routing past Standup, the second landing in the afternoon gap.
    When I add the intent:
      """
      {
        "subject": "study", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "study" on "2026-07-06"
    And the occurrences of "study" are:
      | date       | start | end   |
      | 2026-07-06 | 09:30 | 10:30 |
      | 2026-07-06 | 13:00 | 14:00 |
    And no occurrence overlaps the fixed event "Standup"
    And no occurrence overlaps the fixed event "Dentist"
    And no two occurrences of "study" overlap
    And there are no conflicts

  Scenario: A datetime-form fixed event is an obstacle; the evening event runs right after it
    # "Flight" was given in datetime form (18:00-21:00). An evening window starting
    # at 18:00 is pushed to 21:00 = fixed end + padding (0), snapped to grid.
    When I add the intent:
      """
      {
        "subject": "dinner", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "18:00", "not_after": "23:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "dinner" on "2026-07-06" runs from "21:00" to "22:00"
    And no occurrence overlaps the fixed event "Flight"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: With padding, the event starts a padded gap after the fixed event
    # padding 10: start must clear Standup's 09:30 end by 10 min => 09:40 (grid-aligned).
    Given padding is 10 minutes
    When I add the intent:
      """
      {
        "subject": "focus block", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "focus block" on "2026-07-06" runs from "09:40" to "10:40"
    And no occurrence overlaps the fixed event "Standup"
    And there are no conflicts

  Scenario: Padding pushes the start past the grid, so it snaps up to the next aligned slot
    # "Sync" ends 09:23; +10 min padding = 09:33, which is off-grid, so the start
    # snaps up to the next 5-min boundary at 09:35.
    Given padding is 10 minutes
    And an existing fixed event "Sync" on "2026-07-07" from "09:00" to "09:23"
    When I add the intent:
      """
      {
        "subject": "writing", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "writing" on "2026-07-07" runs from "09:35" to "10:35"
    And every occurrence of "writing" is aligned to the grid
    And no occurrence overlaps the fixed event "Sync"
    And there are no conflicts

  Scenario: A window fully blocked by a fixed event forces an overlap conflict
    # An all-day offsite covers the entire 09:00-17:00 window, so the solver is
    # forced to overlap and reports it rather than failing.
    Given an existing fixed event "Offsite" on "2026-07-08" from "09:00" to "17:00"
    When I add the intent:
      """
      {
        "subject": "errand", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "errand"
    And the occurrence of "errand" on "2026-07-08" runs from "09:00" to "10:00"
    And there is a conflict of kind "overlap"
    And there is a conflict involving "errand" and "Offsite"

  Scenario: A daily habit shifts only on the obstacle day and keeps its slot elsewhere
    # The morning workout wants 09:00 every day; only Monday (Standup) is pushed to 09:30.
    When I add the intent:
      """
      {
        "subject": "workout", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "workout"
    And the occurrence of "workout" on "2026-07-06" runs from "09:30" to "10:30"
    And the occurrence of "workout" on "2026-07-07" runs from "09:00" to "10:00"
    And the occurrence of "workout" on "2026-07-12" runs from "09:00" to "10:00"
    And every occurrence of "workout" starts at or after "09:00"
    And no occurrence overlaps the fixed event "Standup"
    And no occurrence overlaps the fixed event "Dentist"
    And no occurrence overlaps the fixed event "Flight"
    And there are no conflicts

  Scenario: A fixed obstacle that appeared since last solve moves a previously derived instance
    # The instance was placed at 09:00 before Standup existed; re-solving routes it
    # to 09:30, so its update is an "update".
    Given a previously derived instance for intent "yoga" with uid "yoga|all|0" on "2026-07-06" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "yoga", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "yoga" on "2026-07-06" runs from "09:30" to "10:30"
    And the update for uid "yoga|all|0" is "update"
    And no occurrence overlaps the fixed event "Standup"
    And there are no conflicts

  Scenario: Priority decides who gets the slot next to the obstacle; the other routes further out
    # Both want 09:00-17:00. Higher-priority "pilates" takes 09:30 (right after Standup);
    # "reading" then routes past Dentist into the afternoon.
    When I add the intents:
      """
      [
        {
          "subject": "pilates", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "17:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "reading", "mode": "default", "priority": 40,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "17:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "pilates" on "2026-07-06" runs from "09:30" to "10:30"
    And the occurrence of "reading" on "2026-07-06" runs from "12:00" to "13:00"
    And occurrences of "pilates" do not overlap occurrences of "reading"
    And no occurrence overlaps the fixed event "Standup"
    And no occurrence overlaps the fixed event "Dentist"
    And no two occurrences overlap
    And there are no conflicts
