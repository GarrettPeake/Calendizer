Feature: Solar markers resolved from location and UTC offset
  Sunrise, sunset, dawn and dusk are symbolic markers the solver resolves per
  date from the configured location and UTC offset. Their exact clock times are
  deterministic but hard to predict by hand, so these scenarios assert robust
  invariants — generous bounds, grid alignment, ordering, non-overlap and a
  clean schedule — rather than hand-computed sun times.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "04:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes
    And the location is latitude 40.7 longitude -74.0
    And the UTC offset is -240 minutes

  Scenario: A morning run that may not start before sunrise
    When I add the intent:
      """
      {
        "subject": "sunrise run", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "sunrise" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "sunrise run"
    And every occurrence of "sunrise run" starts at or after "05:00"
    And every occurrence of "sunrise run" starts at or before "06:30"
    And every occurrence of "sunrise run" lasts 30 minutes
    And every occurrence of "sunrise run" is aligned to the grid
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Gardening that must wrap up before sunset
    When I add the intent:
      """
      {
        "subject": "evening gardening", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": { "marker": "sunset" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "evening gardening"
    And every occurrence of "evening gardening" starts at or after "17:00"
    And every occurrence of "evening gardening" ends at or before "20:30"
    And every occurrence of "evening gardening" is aligned to the grid
    And there are no conflicts

  Scenario: A daylight walk sitting between dawn and dusk
    When I add the intent:
      """
      {
        "subject": "daylight walk", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": { "marker": "dawn" }, "not_after": { "marker": "dusk" } },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "daylight walk"
    And every occurrence of "daylight walk" starts at or after "04:30"
    And every occurrence of "daylight walk" starts at or before "05:30"
    And every occurrence of "daylight walk" ends at or before "21:30"
    And every occurrence of "daylight walk" is aligned to the grid
    And there are no conflicts

  Scenario: A daily walk stays inside the dawn-to-dusk window all week
    When I add the intent:
      """
      {
        "subject": "nature walk", "mode": "default", "priority": 50,
        "duration": [40, 40],
        "window": { "not_before": { "marker": "dawn" }, "not_after": { "marker": "dusk" } },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "nature walk"
    And every occurrence of "nature walk" starts at or after "00:00"
    And every occurrence of "nature walk" ends at or before "24:00"
    And every occurrence of "nature walk" starts at or before "06:00"
    And every occurrence of "nature walk" ends at or before "21:30"
    And every occurrence of "nature walk" is aligned to the grid
    And no two occurrences of "nature walk" overlap
    And there are no conflicts

  Scenario: Golden-hour photography starting 30 minutes before sunset
    When I add the intent:
      """
      {
        "subject": "golden hour photos", "mode": "default", "priority": 50,
        "duration": [20, 20],
        "window": { "not_before": { "marker": "sunset", "offset_min": -30 } },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "golden hour photos"
    And every occurrence of "golden hour photos" starts at or after "19:30"
    And every occurrence of "golden hour photos" starts at or before "20:30"
    And every occurrence of "golden hour photos" ends at or before "23:00"
    And every occurrence of "golden hour photos" lasts 20 minutes
    And every occurrence of "golden hour photos" is aligned to the grid
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Stargazing only begins after dusk
    When I add the intent:
      """
      {
        "subject": "stargazing", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "dusk" } },
        "cardinality": { "days": { "dates": ["2026-07-10"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "stargazing"
    And every occurrence of "stargazing" starts at or after "20:30"
    And every occurrence of "stargazing" starts at or before "21:30"
    And every occurrence of "stargazing" ends at or before "23:00"
    And every occurrence of "stargazing" is aligned to the grid
    And there are no conflicts

  Scenario: Watching the sky an offset past sunset
    When I add the intent:
      """
      {
        "subject": "after-sunset sky watch", "mode": "default", "priority": 50,
        "duration": [25, 25],
        "window": { "not_before": { "marker": "sunset", "offset_min": 15 } },
        "cardinality": { "days": { "dates": ["2026-07-11"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "after-sunset sky watch"
    And every occurrence of "after-sunset sky watch" starts at or after "20:30"
    And every occurrence of "after-sunset sky watch" starts at or before "21:30"
    And every occurrence of "after-sunset sky watch" ends at or before "23:00"
    And every occurrence of "after-sunset sky watch" is aligned to the grid
    And there are no conflicts

  Scenario: The same sunrise intent lands much later on a winter date
    Given the planning horizon is "2026-01-05" to "2026-01-11"
    When I add the intent:
      """
      {
        "subject": "winter sunrise run", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "sunrise" } },
        "cardinality": { "days": { "dates": ["2026-01-07"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "winter sunrise run"
    And every occurrence of "winter sunrise run" starts at or after "07:30"
    And every occurrence of "winter sunrise run" starts at or before "09:00"
    And every occurrence of "winter sunrise run" ends at or before "09:30"
    And every occurrence of "winter sunrise run" is aligned to the grid
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A sunrise run and an evening stargaze never collide
    When I add the intents:
      """
      [
        {
          "subject": "sunrise run", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": { "marker": "sunrise" } },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "stargazing", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": { "marker": "dusk" } },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then there are 7 occurrences of "sunrise run"
    And there are 7 occurrences of "stargazing"
    And the total number of placed occurrences is 14
    And every occurrence of "sunrise run" ends at or before "12:00"
    And every occurrence of "stargazing" starts at or after "12:00"
    And no two occurrences overlap
    And every occurrence is aligned to the grid
    And there are no conflicts

  Scenario: A solar window large enough for a flexible block places at its floor
    When I add the intent:
      """
      {
        "subject": "outdoor sketching", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": { "marker": "sunrise" }, "not_after": { "marker": "sunset" } },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "outdoor sketching"
    And every occurrence of "outdoor sketching" lasts between 60 and 120 minutes
    And every occurrence of "outdoor sketching" starts at or after "05:00"
    And every occurrence of "outdoor sketching" ends at or before "20:30"
    And every occurrence of "outdoor sketching" is aligned to the grid
    And there are no conflicts
