Feature: Vacation mode suppression and activation
  A "vacation" mode clears the default calendar for its span: default intents are
  suppressed on those dates while mode-scoped and "all" intents take over. The span
  straddles the horizon, so default intents appear before and after the vacation but
  never inside it, and the first and last day of the span count as inside.

  Background:
    Given the planning horizon is "2026-07-04" to "2026-07-15"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And a mode "vacation" spanning "2026-07-08" to "2026-07-11"

  Scenario: Daily standup brackets the vacation but goes quiet inside it
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "09:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 8 occurrences of "team standup"
    And an occurrence of "team standup" is placed on "2026-07-06"
    And an occurrence of "team standup" is placed on "2026-07-14"
    And no occurrence of "team standup" is placed on "2026-07-09"
    And no occurrence of "team standup" is placed on "2026-07-10"

  Scenario: The first and last vacation days still suppress the default standup
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "09:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then no occurrence of "team standup" is placed on "2026-07-08"
    And no occurrence of "team standup" is placed on "2026-07-11"
    And an occurrence of "team standup" is placed on "2026-07-07"
    And an occurrence of "team standup" is placed on "2026-07-12"

  Scenario: A daily beach walk shows up only while I'm on vacation
    When I add the intent:
      """
      {
        "subject": "beach walk", "mode": "vacation", "priority": 40,
        "duration": [60, 60],
        "window": { "starts_at": "10:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "beach walk"
    And an occurrence of "beach walk" is placed on "2026-07-09"
    And an occurrence of "beach walk" is placed on "2026-07-10"
    And no occurrence of "beach walk" is placed on "2026-07-06"
    And no occurrence of "beach walk" is placed on "2026-07-14"

  Scenario: The beach walk runs on both boundary days but not the days flanking them
    When I add the intent:
      """
      {
        "subject": "beach walk", "mode": "vacation", "priority": 40,
        "duration": [60, 60],
        "window": { "starts_at": "10:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then an occurrence of "beach walk" is placed on "2026-07-08"
    And an occurrence of "beach walk" is placed on "2026-07-11"
    And no occurrence of "beach walk" is placed on "2026-07-07"
    And no occurrence of "beach walk" is placed on "2026-07-12"

  Scenario: Mai Tais at least twice over the whole vacation
    When I add the intent:
      """
      {
        "subject": "Mai Tai at the beach", "mode": "vacation", "priority": 40,
        "duration": [60, 120],
        "window": { "not_before": "11:00", "not_after": "13:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
      }
      """
    And I solve
    Then there are 2 occurrences of "Mai Tai at the beach"
    And every occurrence of "Mai Tai at the beach" starts at or after "11:00"
    And every occurrence of "Mai Tai at the beach" ends at or before "13:00"
    And no occurrence of "Mai Tai at the beach" is placed on "2026-07-05"
    And no occurrence of "Mai Tai at the beach" is placed on "2026-07-14"

  Scenario: A larger mode quota of three sunset swims over the vacation span
    When I add the intent:
      """
      {
        "subject": "sunset swim", "mode": "vacation", "priority": 35,
        "duration": [45, 90],
        "window": { "not_before": "17:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [3, null] }
      }
      """
    And I solve
    Then there are 3 occurrences of "sunset swim"
    And every occurrence of "sunset swim" starts at or after "17:00"
    And every occurrence of "sunset swim" ends at or before "20:00"
    And no occurrence of "sunset swim" is placed on "2026-07-07"

  Scenario: Medication runs every single day, vacation or not
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
    Then there are 12 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-06"
    And an occurrence of "take medication" is placed on "2026-07-09"
    And an occurrence of "take medication" is placed on "2026-07-08"
    And an occurrence of "take medication" is placed on "2026-07-11"

  Scenario: Outside the span the default runs alongside the always-on medication
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
          "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1],
          "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then an occurrence of "team standup" is placed on "2026-07-05"
    And an occurrence of "take medication" is placed on "2026-07-05"
    And no occurrence of "team standup" is placed on "2026-07-10"
    And an occurrence of "take medication" is placed on "2026-07-10"

  Scenario: Inside the span the vacation walk replaces the suppressed default standup
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
          "subject": "beach walk", "mode": "vacation", "priority": 40,
          "duration": [60, 60],
          "window": { "starts_at": "10:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then there are 8 occurrences of "team standup"
    And there are 4 occurrences of "beach walk"
    And an occurrence of "beach walk" is placed on "2026-07-09"
    And no occurrence of "team standup" is placed on "2026-07-09"
    And an occurrence of "team standup" is placed on "2026-07-06"
    And no occurrence of "beach walk" is placed on "2026-07-06"

  Scenario: Default, vacation, and always-on intents coexist cleanly across the boundary
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
          "subject": "beach walk", "mode": "vacation", "priority": 40,
          "duration": [60, 60],
          "window": { "starts_at": "10:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1],
          "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 24
    And there are no conflicts
    And no two occurrences overlap
