Feature: Flexible-duration intents with weekly day-count cardinality (the pottery family)
  Hobbies described as "X for 1-2 hours, N times a week". The duration is a
  [min,max] range but the deterministic solver always places the floor; the
  weekly day-count chooses exactly the floor number of evenly-spread days; and
  with an otherwise-empty window each occurrence lands at not_before snapped up
  to the grid. These scenarios pin down those guarantees across durations,
  windows, day-count floors, grid sizes, and multi-week horizons.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Pottery 1-2h, 3-4 times this week lands the floor of 3 even days
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
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "pottery"
    And every occurrence of "pottery" falls on a weekday in "TU,TH,SA"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-07 | 09:00 | 10:00 |
      | 2026-07-09 | 09:00 | 10:00 |
      | 2026-07-11 | 09:00 | 10:00 |
    And every occurrence of "pottery" lasts between 60 and 120 minutes
    And every occurrence of "pottery" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Guitar practice 30-90 min, 2-3 times a week takes the 2-day floor
    When I add the intent:
      """
      {
        "subject": "guitar", "mode": "default", "priority": 50,
        "duration": [30, 90],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    And the grid is 15 minutes
    Then there are 2 occurrences of "guitar"
    And every occurrence of "guitar" falls on a weekday in "TU,SA"
    And the occurrences of "guitar" are:
      | date       | start | end   |
      | 2026-07-07 | 08:00 | 08:30 |
      | 2026-07-11 | 08:00 | 08:30 |
    And every occurrence of "guitar" lasts 30 minutes
    And every occurrence of "guitar" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Yoga 45 min fixed, 1-2 times a week collapses to a single Thursday
    When I add the intent:
      """
      {
        "subject": "yoga", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "10:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [1, 2] } }
      }
      """
    And the grid is 30 minutes
    And I solve
    Then there is 1 occurrence of "yoga"
    And an occurrence of "yoga" is placed on "2026-07-09"
    And no occurrence of "yoga" is placed on "2026-07-06"
    And no occurrence of "yoga" is placed on "2026-07-07"
    And every occurrence of "yoga" falls on a weekday in "TH"
    And the occurrence of "yoga" on "2026-07-09" runs from "10:00" to "10:45"
    And every occurrence of "yoga" lasts 45 minutes
    And every occurrence of "yoga" is aligned to the grid
    And there are no conflicts

  Scenario: Pottery 4-5 times a week spreads its 4-day floor across the whole week
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [4, 5] } }
      }
      """
    And the grid is 60 minutes
    And I solve
    Then there are 4 occurrences of "pottery"
    And every occurrence of "pottery" falls on a weekday in "MO,WE,FR,SU"
    And no occurrence of "pottery" is placed on "2026-07-07"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-08 | 09:00 | 10:00 |
      | 2026-07-10 | 09:00 | 10:00 |
      | 2026-07-12 | 09:00 | 10:00 |
    And every occurrence of "pottery" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A not_before of 09:10 on a 30-minute grid snaps up to 09:30
    When I add the intent:
      """
      {
        "subject": "ceramics", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:10", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And the grid is 30 minutes
    And I solve
    Then there are 3 occurrences of "ceramics"
    And the occurrences of "ceramics" are:
      | date       | start | end   |
      | 2026-07-07 | 09:30 | 10:30 |
      | 2026-07-09 | 09:30 | 10:30 |
      | 2026-07-11 | 09:30 | 10:30 |
    And every occurrence of "ceramics" starts at or after "09:10"
    And every occurrence of "ceramics" ends at or before "19:00"
    And every occurrence of "ceramics" is aligned to the grid
    And there are no conflicts

  Scenario: A not_before of 08:50 on a 15-minute grid snaps up to 09:00
    When I add the intent:
      """
      {
        "subject": "painting", "mode": "default", "priority": 50,
        "duration": [30, 90],
        "window": { "not_before": "08:50", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And the grid is 15 minutes
    And I solve
    Then there are 2 occurrences of "painting"
    And the occurrences of "painting" are:
      | date       | start | end   |
      | 2026-07-07 | 09:00 | 09:30 |
      | 2026-07-11 | 09:00 | 09:30 |
    And every occurrence of "painting" starts at or after "08:50"
    And every occurrence of "painting" lasts 30 minutes
    And every occurrence of "painting" is aligned to the grid
    And there are no conflicts

  Scenario: A not_before of 09:20 on a 60-minute grid snaps up to 10:00
    When I add the intent:
      """
      {
        "subject": "woodworking", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "09:20", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [1, 2] } }
      }
      """
    And the grid is 60 minutes
    And I solve
    Then there is 1 occurrence of "woodworking"
    And the occurrence of "woodworking" on "2026-07-09" runs from "10:00" to "10:45"
    And every occurrence of "woodworking" starts at or after "09:20"
    And every occurrence of "woodworking" is aligned to the grid
    And there are no conflicts

  Scenario: An evening-only window keeps every occurrence inside its tight box
    When I add the intent:
      """
      {
        "subject": "climbing", "mode": "default", "priority": 50,
        "duration": [30, 90],
        "window": { "not_before": "18:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "climbing"
    And every occurrence of "climbing" falls on a weekday in "TU,TH,SA"
    And the occurrence of "climbing" on "2026-07-07" runs from "18:00" to "18:30"
    And every occurrence of "climbing" starts at or after "18:00"
    And every occurrence of "climbing" ends at or before "19:00"
    And every occurrence of "climbing" lasts between 30 and 90 minutes
    And every occurrence of "climbing" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Over two weeks the 3-day-per-week floor repeats each ISO week
    Given the planning horizon is "2026-07-06" to "2026-07-19"
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "pottery"
    And an occurrence of "pottery" is placed on "2026-07-07"
    And an occurrence of "pottery" is placed on "2026-07-14"
    And an occurrence of "pottery" is placed on "2026-07-16"
    And every occurrence of "pottery" falls on a weekday in "TU,TH,SA"
    And every occurrence of "pottery" starts at or after "09:00"
    And every occurrence of "pottery" ends at or before "19:00"
    And every occurrence of "pottery" lasts between 60 and 120 minutes
    And every occurrence of "pottery" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Over three weeks the 2-day-per-week floor yields six occurrences
    Given the planning horizon is "2026-07-06" to "2026-07-26"
    When I add the intent:
      """
      {
        "subject": "sketching", "mode": "default", "priority": 50,
        "duration": [30, 90],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "sketching"
    And every occurrence of "sketching" falls on a weekday in "TU,SA"
    And an occurrence of "sketching" is placed on "2026-07-21"
    And an occurrence of "sketching" is placed on "2026-07-25"
    And every occurrence of "sketching" lasts 30 minutes
    And every occurrence of "sketching" starts at or after "08:00"
    And every occurrence of "sketching" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: The floor, not the max, is placed for both duration and day-count
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then "pottery" has between 3 and 4 occurrences
    And there are 3 occurrences of "pottery"
    And every occurrence of "pottery" lasts 60 minutes
    And the occurrence of "pottery" on "2026-07-07" runs from "09:00" to "10:00"
    And there are no conflicts
