Feature: Filler intents with a zero floor place nothing
  A min:0 cardinality marks an intent as pure filler ("free time"). The
  deterministic MVP places exactly the guaranteed floor and never fills toward
  max, so a zero floor — whether on days.count, per_day.count, or total —
  yields zero occurrences. These fillers must coexist with real intents
  without stealing slots, raising conflicts, or crashing the solver.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: "Leave some free time" each week schedules nothing
    When I add the intent:
      """
      {
        "subject": "free time", "mode": "default", "priority": 10,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 3] } }
      }
      """
    And I solve
    Then there are no occurrences of "free time"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: A zero per-day stack never lands on any day
    When I add the intent:
      """
      {
        "subject": "downtime", "mode": "default", "priority": 10,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [0, 2] } }
      }
      """
    And I solve
    Then there are no occurrences of "downtime"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: A flexible day-count with a zero lifetime floor places nothing
    When I add the intent:
      """
      {
        "subject": "buffer time", "mode": "default", "priority": 10,
        "duration": [45, 90],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [0, 3] },
          "total": [0, null]
        }
      }
      """
    And I solve
    Then there are no occurrences of "buffer time"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: An open total cap over a zero floor still yields nothing
    When I add the intent:
      """
      {
        "subject": "open block", "mode": "default", "priority": 10,
        "duration": [60, 60],
        "window": { "not_before": "10:00", "not_after": "18:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [0, 2] },
          "total": [null, 5]
        }
      }
      """
    And I solve
    Then there are no occurrences of "open block"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: A windowed filler with a zero floor is not forced into its window
    When I add the intent:
      """
      {
        "subject": "free time", "mode": "default", "priority": 10,
        "duration": [120, 120],
        "window": { "not_before": "13:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 1] } }
      }
      """
    And I solve
    Then there are no occurrences of "free time"
    And no occurrence of "free time" is placed on "2026-07-09"
    And there are no conflicts

  Scenario: Two fillers at once both place nothing and the solver stays clean
    When I add the intents:
      """
      [
        {
          "subject": "free time", "mode": "default", "priority": 10,
          "duration": [60, 90],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 3] } }
        },
        {
          "subject": "downtime", "mode": "default", "priority": 5,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "17:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [0, 1] } }
        }
      ]
      """
    And I solve
    Then there are no occurrences of "free time"
    And there are no occurrences of "downtime"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: A "free time" filler coexists with a daily standup that does land
    When I add the intents:
      """
      [
        {
          "subject": "team standup", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "free time", "mode": "default", "priority": 10,
          "duration": [60, 120],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 3] } }
        }
      ]
      """
    And I solve
    Then there are 7 occurrences of "team standup"
    And there are no occurrences of "free time"
    And the total number of placed occurrences is 7
    And every occurrence of "team standup" starts at "09:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A [0,4] filler beside a [2,2] real intent — only the real one lands
    When I add the intents:
      """
      [
        {
          "subject": "guitar practice", "mode": "default", "priority": 50,
          "duration": [60, 120],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
        },
        {
          "subject": "free time", "mode": "default", "priority": 10,
          "duration": [60, 120],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 4] } }
        }
      ]
      """
    And I solve
    Then there are 2 occurrences of "guitar practice"
    And there are no occurrences of "free time"
    And the total number of placed occurrences is 2
    And every occurrence of "guitar practice" lasts 60 minutes
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A zero-floor filler does not disturb two real intents of differing priority
    When I add the intents:
      """
      [
        {
          "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1],
          "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "team standup", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "free time", "mode": "default", "priority": 10,
          "duration": [90, 120],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 5] } }
        }
      ]
      """
    And I solve
    Then there are 7 occurrences of "take medication"
    And there are 7 occurrences of "team standup"
    And there are no occurrences of "free time"
    And the total number of placed occurrences is 14
    And every occurrence of "take medication" starts at "08:00"
    And every occurrence of "team standup" starts at "09:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A subject with spaces and a zero day-count produces a clean empty result
    When I add the intent:
      """
      {
        "subject": "free time", "mode": "default", "priority": 10,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [0, 2] } }
      }
      """
    And I solve
    Then there are no occurrences of "free time"
    And the total number of placed occurrences is 0
    And no occurrence is marked as placed during sleep
    And there are no conflicts
