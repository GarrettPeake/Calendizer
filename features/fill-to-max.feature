Feature: Filling flexible counts toward their max (fillToMax)
  By default the solver places exactly the guaranteed floor of a days.count range.
  With "fill toward max" enabled it also schedules the aspiration occurrences up
  to the max — spread across the days the floor didn't claim — but only where a
  clean, non-overlapping slot exists. The floor is always guaranteed; extras are
  never forced into an overlap and never raise a conflict.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Default (floor only) — a 3–5×/week range places exactly 3
    When I add the intent:
      """
      {
        "subject": "bike", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 5] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "bike"
    And there are no conflicts

  Scenario: Enabled on an empty week — fills all the way to 5
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "bike", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 5] } }
      }
      """
    And I solve
    Then there are 5 occurrences of "bike"
    And occurrences of "bike" fall on dates "2026-07-07, 2026-07-08, 2026-07-09, 2026-07-11, 2026-07-12"
    And every occurrence of "bike" starts at or after "17:00"
    And every occurrence of "bike" ends at or before "21:00"
    And no two occurrences of "bike" overlap
    And there are no conflicts

  Scenario: Enabled but no spare room — only the floor is placed, no conflicts
    Given fill toward max is enabled
    And an existing fixed event "blocked" on "2026-07-06" from "17:00" to "21:00"
    And an existing fixed event "blocked" on "2026-07-08" from "17:00" to "21:00"
    And an existing fixed event "blocked" on "2026-07-10" from "17:00" to "21:00"
    And an existing fixed event "blocked" on "2026-07-12" from "17:00" to "21:00"
    When I add the intent:
      """
      {
        "subject": "bike", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 5] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "bike"
    And occurrences of "bike" fall on dates "2026-07-07, 2026-07-09, 2026-07-11"
    And there are no conflicts

  Scenario: The floor is always met even with extras enabled
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "bike", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 5] } }
      }
      """
    And I solve
    Then "bike" has between 3 and 5 occurrences

  Scenario: A fixed count (min == max) gets no extras
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "yoga", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "07:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "yoga"

  Scenario: Explicit weekdays are unaffected by fill toward max
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "gym", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "07:00", "not_after": "10:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "weekdays": ["MO", "WE", "FR"] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "gym"
    And every occurrence of "gym" falls on a weekday in "MO,WE,FR"

  Scenario: Two flexible-duration tasks split a contended hour by priority
    Given fill toward max is enabled
    When I add the intents:
      """
      [
        {
          "subject": "deep work", "mode": "default", "priority": 100,
          "duration": [30, 60],
          "window": { "not_before": "07:00", "not_after": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        },
        {
          "subject": "email", "mode": "default", "priority": 99,
          "duration": [15, 60],
          "window": { "not_before": "07:00", "not_after": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        }
      ]
      """
    And I solve
    Then every occurrence of "deep work" lasts 45 minutes
    And every occurrence of "email" lasts 15 minutes
    And the occurrence of "deep work" on "2026-07-07" runs from "07:00" to "07:45"
    And the occurrence of "email" on "2026-07-07" runs from "07:45" to "08:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A lone flexible-duration task grows to its max within its window
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "17:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "pottery" on "2026-07-07" runs from "17:00" to "19:00"
    And every occurrence of "pottery" lasts 120 minutes
    And there are no conflicts

  Scenario: A lone flexible task grows only up to the next obstacle
    Given fill toward max is enabled
    And an existing fixed event "call" on "2026-07-07" from "18:00" to "19:00"
    When I add the intent:
      """
      {
        "subject": "workout", "mode": "default", "priority": 50,
        "duration": [30, 90],
        "window": { "not_before": "17:00", "not_after": "20:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "workout" on "2026-07-07" runs from "17:00" to "18:00"
    And no occurrence overlaps the fixed event "call"
    And there are no conflicts

  Scenario: With fill toward max OFF a lone flexible task stays at its floor
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "17:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "pottery" on "2026-07-07" runs from "17:00" to "18:00"
    And every occurrence of "pottery" lasts 60 minutes
    And there are no conflicts

  Scenario: Extras fill each week across a multi-week horizon
    Given the planning horizon is "2026-07-06" to "2026-07-19"
    And fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "bike", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 5] } }
      }
      """
    And I solve
    Then there are 10 occurrences of "bike"
    And there are no conflicts
