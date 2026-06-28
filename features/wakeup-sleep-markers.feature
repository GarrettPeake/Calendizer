Feature: Wakeup and sleep markers in windows
  The "wakeup" and "sleep" markers resolve to the configured clock times.
  An intent whose window starts at the wakeup marker (earliest-fit) lands
  exactly at the wakeup time, an offset shifts it by that many minutes, and a
  window between wakeup and sleep spans the whole waking day. Because these
  markers resolve to exact config times, we can assert exact clock times here.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Morning meditation kicks off the moment I wake up
    When I add the intent:
      """
      {
        "subject": "morning meditation", "mode": "default", "priority": 50,
        "duration": [20, 20],
        "window": { "not_before": { "marker": "wakeup" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "morning meditation"
    And every occurrence of "morning meditation" starts at "07:00"
    And the occurrence of "morning meditation" on "2026-07-08" runs from "07:00" to "07:20"
    And every occurrence of "morning meditation" is aligned to the grid
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Workout 30 minutes after I wake up
    When I add the intent:
      """
      {
        "subject": "workout", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "wakeup", "offset_min": 30 } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "workout"
    And every occurrence of "workout" starts at "07:30"
    And the occurrence of "workout" on "2026-07-06" runs from "07:30" to "08:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Reading anywhere across the waking day
    When I add the intent:
      """
      {
        "subject": "reading", "mode": "default", "priority": 40,
        "duration": [60, 60],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "reading"
    And every occurrence of "reading" starts at "07:00"
    And every occurrence of "reading" ends at or before "23:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: An earlier wake-up time pulls the start earlier
    Given wakeup is "06:30"
    When I add the intent:
      """
      {
        "subject": "journaling", "mode": "default", "priority": 50,
        "duration": [15, 15],
        "window": { "not_before": { "marker": "wakeup" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "journaling"
    And every occurrence of "journaling" starts at "06:30"
    And the occurrence of "journaling" on "2026-07-10" runs from "06:30" to "06:45"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A later wake-up and earlier sleep reshape the waking window
    Given wakeup is "08:00"
    And sleep is "22:00"
    When I add the intent:
      """
      {
        "subject": "language practice", "mode": "default", "priority": 45,
        "duration": [45, 45],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "language practice"
    And every occurrence of "language practice" starts at "08:00"
    And every occurrence of "language practice" ends at or before "22:00"
    And the occurrence of "language practice" on "2026-07-07" runs from "08:00" to "08:45"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A fixed 45-minute routine right after wakeup
    When I add the intent:
      """
      {
        "subject": "breakfast prep", "mode": "default", "priority": 60,
        "duration": [45, 45],
        "window": { "not_before": { "marker": "wakeup" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "breakfast prep"
    And the occurrence of "breakfast prep" on "2026-07-06" runs from "07:00" to "07:45"
    And every occurrence of "breakfast prep" starts at "07:00"
    And every occurrence of "breakfast prep" is aligned to the grid
    And there are no conflicts

  Scenario: A full hour after wakeup with a positive offset
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 70,
        "duration": [90, 90],
        "window": { "not_before": { "marker": "wakeup", "offset_min": 60 } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "deep work"
    And every occurrence of "deep work" starts at "08:00"
    And the occurrence of "deep work" on "2026-07-12" runs from "08:00" to "09:30"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A study block that must end before bedtime via the sleep marker
    When I add the intent:
      """
      {
        "subject": "evening study", "mode": "default", "priority": 55,
        "duration": [120, 120],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep", "offset_min": -120 } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "evening study"
    And every occurrence of "evening study" starts at "07:00"
    And the occurrence of "evening study" on "2026-07-09" runs from "07:00" to "09:00"
    And every occurrence of "evening study" ends at or before "21:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A habitual three-times-a-week class always at the same wakeup time
    When I add the intent:
      """
      {
        "subject": "sunrise yoga", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": { "marker": "wakeup" } },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "sunrise yoga"
    And the occurrences of "sunrise yoga" are:
      | date       | start | end   |
      | 2026-07-07 | 07:00 | 08:00 |
      | 2026-07-09 | 07:00 | 08:00 |
      | 2026-07-11 | 07:00 | 08:00 |
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A custom wake-up time with an offset stacks correctly
    Given wakeup is "06:30"
    When I add the intent:
      """
      {
        "subject": "dawn run", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "wakeup", "offset_min": 30 } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "dawn run"
    And every occurrence of "dawn run" starts at "07:00"
    And the occurrence of "dawn run" on "2026-07-11" runs from "07:00" to "07:30"
    And no occurrence is marked as placed during sleep
    And there are no conflicts
