Feature: Worked examples from the schema
  Sanity coverage of the canonical examples to validate the engine and DSL.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Pottery — flexible duration, weekly day-count floor
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
    Then "pottery" has between 3 and 4 occurrences
    And every occurrence of "pottery" starts at or after "09:00"
    And every occurrence of "pottery" lasts between 60 and 120 minutes
    And every occurrence of "pottery" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Morning routine — ordered children, no internal padding
    When I add the intent:
      """
      {
        "subject": "morning routine", "mode": "default", "priority": 80,
        "duration": [13, 20],
        "window": { "not_before": { "marker": "wakeup" } },
        "children": [
          { "subject": "brush teeth", "duration": 3 },
          { "subject": "do hair", "weight": 1 },
          { "subject": "shower", "duration": 10 }
        ],
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","WE","TH","FR","SA","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 7 occurrences of "morning routine"
    And the occurrence of "morning routine" on "2026-07-06" has children in order "brush teeth, do hair, shower"
    And the children of "morning routine" on "2026-07-06" are contiguous
    And every occurrence of "morning routine" starts at or after "07:00"

  Scenario: Medication — runs every day at a pinned time
    When I add the intent:
      """
      {
        "subject": "take medication", "mode": "all", "priority": 100,
        "duration": [1, 1],
        "window": { "starts_at": "08:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "take medication"
    And every occurrence of "take medication" starts at "08:00"
    And no occurrence is marked as placed during sleep

  Scenario: Stretching — nested distribution within a week
    When I add the intent:
      """
      {
        "subject": "stretching", "mode": "default", "priority": 30,
        "duration": [10, 10],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 24]
        }
      }
      """
    And I solve
    Then there are 6 occurrences of "stretching"
    And every occurrence of "stretching" lasts 10 minutes
    And every occurrence of "stretching" starts at or after "07:00"
    And every occurrence of "stretching" ends at or before "23:00"
    And no two occurrences of "stretching" overlap
