Feature: Per-weekday window overrides (studio hours that differ by day)
  Real availability is rarely the same every day: a pottery studio is open
  9am-7pm most days but stays open until 9pm on Tue/Thu/Sun; a gym opens later
  on Monday; weekend classes start mid-afternoon. The intent expresses this with
  window.overrides keyed by comma-joined weekday codes (e.g. "TU,TH,SU"). Each
  override REPLACES the matching window fields on those weekdays only; every
  other weekday keeps the base window. These scenarios pin down that behaviour
  with explicit weekdays/dates cardinality so exactly one occurrence lands on
  each day under test and every clock time is deterministic.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Studio open late Tue/Thu/Sun, but earliest-fit still starts at 9am
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "TU,TH,SU": { "not_after": "21:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "pottery"
    And every occurrence of "pottery" falls on a weekday in "MO,TU,SU"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-07 | 09:00 | 10:00 |
      | 2026-07-12 | 09:00 | 10:00 |
    And every occurrence of "pottery" lasts between 60 and 120 minutes
    And every occurrence of "pottery" ends at or before "21:00"
    And every occurrence of "pottery" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: An evening-only override lets Tue/Thu sessions run past the base 7pm close
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "TU,TH,SU": { "not_before": "19:30", "not_after": "21:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","TH"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "pottery"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-07 | 19:30 | 20:30 |
      | 2026-07-09 | 19:30 | 20:30 |
    And the occurrence of "pottery" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "pottery" on "2026-07-07" runs from "19:30" to "20:30"
    And no occurrence is marked as placed during sleep
    And no two occurrences overlap
    And there are no conflicts

  Scenario: The gym opens later on Monday only (not_before override)
    When I add the intent:
      """
      {
        "subject": "gym", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "MO": { "not_before": "12:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 2 occurrences of "gym"
    And the occurrence of "gym" on "2026-07-06" runs from "12:00" to "13:00"
    And the occurrence of "gym" on "2026-07-07" runs from "09:00" to "10:00"
    And every occurrence of "gym" starts at or after "09:00"
    And there are no conflicts

  Scenario: Weekend classes are pinned to 3pm via a starts_at override
    When I add the intent:
      """
      {
        "subject": "ceramics class", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "SA,SU": { "starts_at": "15:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["FR","SA","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "ceramics class"
    And the occurrences of "ceramics class" are:
      | date       | start | end   |
      | 2026-07-10 | 09:00 | 10:00 |
      | 2026-07-11 | 15:00 | 16:00 |
      | 2026-07-12 | 15:00 | 16:00 |
    And every occurrence of "ceramics class" lasts between 60 and 120 minutes
    And every occurrence of "ceramics class" is aligned to the grid
    And there are no conflicts

  Scenario: Two override groups coexist in one window (Mon early, Fri late)
    When I add the intent:
      """
      {
        "subject": "studio time", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": {
            "MO": { "not_before": "08:00" },
            "FR": { "not_before": "16:00" }
          }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "studio time"
    And the occurrences of "studio time" are:
      | date       | start | end   |
      | 2026-07-06 | 08:00 | 09:00 |
      | 2026-07-08 | 09:00 | 10:00 |
      | 2026-07-10 | 16:00 | 17:00 |
    And the occurrence of "studio time" on "2026-07-08" runs from "09:00" to "10:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A comma-joined override key applies to every listed weekday
    When I add the intent:
      """
      {
        "subject": "afternoon kiln", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "TU,TH,SA": { "not_before": "14:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","TH","SA"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 4 occurrences of "afternoon kiln"
    And the occurrences of "afternoon kiln" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-07 | 14:00 | 15:00 |
      | 2026-07-09 | 14:00 | 15:00 |
      | 2026-07-11 | 14:00 | 15:00 |
    And there are no conflicts

  Scenario: Non-override weekdays fall back to the base window
    When I add the intent:
      """
      {
        "subject": "morning practice", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "12:00",
          "overrides": { "SU": { "not_before": "17:00", "not_after": "21:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 4 occurrences of "morning practice"
    And the occurrences of "morning practice" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-08 | 09:00 | 10:00 |
      | 2026-07-10 | 09:00 | 10:00 |
      | 2026-07-12 | 17:00 | 18:00 |
    And the occurrence of "morning practice" on "2026-07-12" runs from "17:00" to "18:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A starts_at override on one date pins it while the base date earliest-fits
    When I add the intent:
      """
      {
        "subject": "throwing session", "mode": "default", "priority": 50,
        "duration": [90, 150],
        "window": {
          "not_before": "09:00",
          "not_after": "20:00",
          "overrides": { "TH": { "starts_at": "18:00" } }
        },
        "cardinality": { "days": { "dates": ["2026-07-08", "2026-07-09"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "throwing session"
    And occurrences of "throwing session" fall on dates "2026-07-08, 2026-07-09"
    And the occurrences of "throwing session" are:
      | date       | start | end   |
      | 2026-07-08 | 09:00 | 10:30 |
      | 2026-07-09 | 18:00 | 19:30 |
    And every occurrence of "throwing session" lasts between 90 and 150 minutes
    And every occurrence of "throwing session" is aligned to the grid
    And there are no conflicts

  Scenario: A fixed obstacle pushes Thursday into the extended evening the override unlocks
    Given an existing fixed event "Morning class" on "2026-07-06" from "09:00" to "17:00"
    And an existing fixed event "Kiln firing" on "2026-07-09" from "09:00" to "19:00"
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "TU,TH,SU": { "not_after": "21:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TH"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 2 occurrences of "pottery"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-06 | 17:00 | 18:00 |
      | 2026-07-09 | 19:00 | 20:00 |
    And the occurrence of "pottery" on "2026-07-06" runs from "17:00" to "18:00"
    And the occurrence of "pottery" on "2026-07-09" runs from "19:00" to "20:00"
    And no occurrence overlaps the fixed event "Morning class"
    And no occurrence overlaps the fixed event "Kiln firing"
    And every occurrence of "pottery" ends at or before "21:00"
    And there are no conflicts

  Scenario: Full week of differing studio hours, each day inside its own window
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": {
          "not_before": "09:00",
          "not_after": "19:00",
          "overrides": { "TU,TH,SU": { "starts_at": "20:00", "not_after": "21:00" } }
        },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","WE","TH","FR","SA","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 7 occurrences of "pottery"
    And every occurrence of "pottery" falls on a weekday in "MO,TU,WE,TH,FR,SA,SU"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-07 | 20:00 | 21:00 |
      | 2026-07-08 | 09:00 | 10:00 |
      | 2026-07-09 | 20:00 | 21:00 |
      | 2026-07-10 | 09:00 | 10:00 |
      | 2026-07-11 | 09:00 | 10:00 |
      | 2026-07-12 | 20:00 | 21:00 |
    And every occurrence of "pottery" ends at or before "21:00"
    And no occurrence is marked as placed during sleep
    And no two occurrences overlap
    And there are no conflicts
