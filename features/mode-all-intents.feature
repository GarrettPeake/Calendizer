Feature: Intents with mode "all" run everywhere
  An intent with mode "all" is the "no matter what" case (medication, vitamins).
  It is active during every mode span AND outside all modes, while "default"
  intents are suppressed inside a mode and mode-scoped intents only run inside it.
  These scenarios pin "all" intents across a horizon that mixes mode spans with
  dates outside them, and check inside-span, outside-span and boundary dates.

  Background:
    Given the planning horizon is "2026-07-04" to "2026-07-17"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes

  Scenario: Daily medication keeps firing right through a vacation
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
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
    Then there are 14 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And an occurrence of "take medication" is placed on "2026-07-06"
    And an occurrence of "take medication" is placed on "2026-07-09"
    And an occurrence of "take medication" is placed on "2026-07-12"
    And an occurrence of "take medication" is placed on "2026-07-15"
    And every occurrence of "take medication" starts at "08:00"
    And there are no conflicts

  Scenario: Medication survives on the very day a default standup is suppressed
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
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
        }
      ]
      """
    And I solve
    Then there are 14 occurrences of "take medication"
    And there are 7 occurrences of "team standup"
    And an occurrence of "take medication" is placed on "2026-07-08"
    And no occurrence of "team standup" is placed on "2026-07-08"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And an occurrence of "team standup" is placed on "2026-07-04"
    And there are no conflicts

  Scenario: An "all", a "default" and a mode-scoped intent all coexist
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
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
          "subject": "beach yoga", "mode": "vacation", "priority": 40,
          "duration": [60, 60],
          "window": { "starts_at": "10:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then there are 14 occurrences of "take medication"
    And there are 7 occurrences of "team standup"
    And there are 7 occurrences of "beach yoga"
    And an occurrence of "take medication" is placed on "2026-07-08"
    And an occurrence of "beach yoga" is placed on "2026-07-08"
    And no occurrence of "team standup" is placed on "2026-07-08"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And an occurrence of "team standup" is placed on "2026-07-04"
    And no occurrence of "beach yoga" is placed on "2026-07-04"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Morning and evening medication, two "all" intents at pinned times
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intents:
      """
      [
        {
          "subject": "morning meds", "mode": "all", "priority": 100,
          "duration": [1, 1],
          "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "evening meds", "mode": "all", "priority": 100,
          "duration": [1, 1],
          "window": { "starts_at": "20:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then there are 14 occurrences of "morning meds"
    And there are 14 occurrences of "evening meds"
    And every occurrence of "morning meds" starts at "08:00"
    And every occurrence of "evening meds" starts at "20:00"
    And an occurrence of "morning meds" is placed on "2026-07-09"
    And an occurrence of "evening meds" is placed on "2026-07-09"
    And an occurrence of "morning meds" is placed on "2026-07-15"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: One "all" intent runs across two separate, non-overlapping modes
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-09"
    And a mode "work trip" spanning "2026-07-13" to "2026-07-16"
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
    Then there are 14 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-07"
    And an occurrence of "take medication" is placed on "2026-07-14"
    And an occurrence of "take medication" is placed on "2026-07-11"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And an occurrence of "take medication" is placed on "2026-07-17"
    And every occurrence of "take medication" starts at "08:00"
    And there are no conflicts

  Scenario: Vitamins on explicit dates that straddle the mode boundaries
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "vitamins", "mode": "all", "priority": 90,
        "duration": [30, 30],
        "window": { "starts_at": "08:00" },
        "cardinality": { "days": { "dates": ["2026-07-05", "2026-07-06", "2026-07-09", "2026-07-12", "2026-07-13"] } }
      }
      """
    And I solve
    Then there are 5 occurrences of "vitamins"
    And the occurrences of "vitamins" are:
      | date       | start | end   |
      | 2026-07-05 | 08:00 | 08:30 |
      | 2026-07-06 | 08:00 | 08:30 |
      | 2026-07-09 | 08:00 | 08:30 |
      | 2026-07-12 | 08:00 | 08:30 |
      | 2026-07-13 | 08:00 | 08:30 |
    And there are no conflicts

  Scenario: A Mon/Wed/Fri gym habit runs the same inside and outside vacation
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "gym", "mode": "all", "priority": 60,
        "duration": [60, 60],
        "window": { "not_before": "17:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "weekdays": ["MO", "WE", "FR"] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "gym"
    And every occurrence of "gym" falls on a weekday in "MO,WE,FR"
    And an occurrence of "gym" is placed on "2026-07-08"
    And an occurrence of "gym" is placed on "2026-07-15"
    And no occurrence of "gym" is placed on "2026-07-07"
    And every occurrence of "gym" starts at or after "17:00"
    And every occurrence of "gym" ends at or before "21:00"
    And there are no conflicts

  Scenario: Hydrate twice a day, every day, including the whole vacation
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "hydrate", "mode": "all", "priority": 70,
        "duration": [15, 15],
        "window": { "not_before": "07:00", "not_after": "23:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 28 occurrences of "hydrate"
    And there are 2 occurrences of "hydrate" on "2026-07-08"
    And there are 2 occurrences of "hydrate" on "2026-07-15"
    And no two occurrences of "hydrate" overlap
    And every occurrence of "hydrate" starts at or after "07:00"
    And every occurrence of "hydrate" ends at or before "23:00"
    And there are no conflicts

  Scenario: With no modes defined an "all" intent still runs every day
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
    Then there are 14 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And an occurrence of "take medication" is placed on "2026-07-17"
    And every occurrence of "take medication" starts at "08:00"
    And there are no conflicts

  Scenario: Medication spans the boundary between two back-to-back modes
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-09"
    And a mode "staycation" spanning "2026-07-10" to "2026-07-13"
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
    Then there are 14 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-09"
    And an occurrence of "take medication" is placed on "2026-07-10"
    And an occurrence of "take medication" is placed on "2026-07-04"
    And every occurrence of "take medication" starts at "08:00"
    And there are no conflicts
