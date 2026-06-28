Feature: Padding (buffer) enforcement between occurrences
  Global `padding` is the minimum gap the solver keeps between any two placed
  occurrences (and between a derived occurrence and a fixed event). With
  earliest-fit, a contended occurrence lands exactly at the previous event's end
  plus `padding`, snapped up to the grid. These scenarios pin those exact times
  for padding 0/10/15/30, plus chains, per-day stacking, and fixed-event buffers.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes

  Scenario: Two back-to-back blocks with zero padding touch exactly (gap 0)
    Given padding is 0 minutes
    When I add the intents:
      """
      [
        {
          "subject": "morning email", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "code review", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "morning email" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "code review" on "2026-07-06" runs from "10:00" to "11:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Padding of 10 pushes the second block to first end plus 10 minutes
    Given padding is 10 minutes
    When I add the intents:
      """
      [
        {
          "subject": "morning email", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "code review", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "morning email" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "code review" on "2026-07-06" runs from "10:10" to "11:10"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Padding of 15 leaves a quarter-hour buffer between blocks
    Given padding is 15 minutes
    When I add the intents:
      """
      [
        {
          "subject": "morning email", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "code review", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "morning email" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "code review" on "2026-07-06" runs from "10:15" to "11:15"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Padding of 30 leaves a half-hour buffer between blocks
    Given padding is 30 minutes
    When I add the intents:
      """
      [
        {
          "subject": "morning email", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "13:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "code review", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "13:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "morning email" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "code review" on "2026-07-06" runs from "10:30" to "11:30"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A chain of three blocks each separated by 10 minutes of padding
    Given padding is 10 minutes
    When I add the intents:
      """
      [
        {
          "subject": "warmup", "mode": "default", "priority": 70,
          "duration": [30, 30],
          "window": { "not_before": "08:00", "not_after": "14:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "main set", "mode": "default", "priority": 60,
          "duration": [45, 45],
          "window": { "not_before": "08:00", "not_after": "14:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "cooldown", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "08:00", "not_after": "14:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "warmup" on "2026-07-06" runs from "08:00" to "08:30"
    And the occurrence of "main set" on "2026-07-06" runs from "08:40" to "09:25"
    And the occurrence of "cooldown" on "2026-07-06" runs from "09:35" to "10:05"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Stacking three hydration breaks in a day keeps them 20 minutes apart
    Given padding is 20 minutes
    When I add the intent:
      """
      {
        "subject": "hydration break", "mode": "default", "priority": 40,
        "duration": [15, 15],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": {
          "period": { "unit": "day", "interval": 1 },
          "days": { "dates": ["2026-07-06"] },
          "per_day": { "count": [3, 3] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "hydration break" on "2026-07-06"
    And occurrences of "hydration break" are at least 20 minutes apart
    And no two occurrences of "hydration break" overlap
    And every occurrence of "hydration break" starts at or after "09:00"
    And every occurrence of "hydration break" ends at or before "17:00"
    And there are no conflicts

  Scenario: A focus block routes to the standup's end plus padding
    Given padding is 15 minutes
    And an existing fixed event "Standup" on "2026-07-06" from "09:00" to "09:30"
    When I add the intent:
      """
      {
        "subject": "focus block", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "13:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "focus block" on "2026-07-06" runs from "09:45" to "10:45"
    And no occurrence overlaps the fixed event "Standup"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A report is forced past a midday meeting by padding
    Given padding is 10 minutes
    And an existing fixed event "Lunch" on "2026-07-06" from "12:00" to "13:00"
    When I add the intent:
      """
      {
        "subject": "quarterly report", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "11:00", "not_after": "15:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then the occurrence of "quarterly report" on "2026-07-06" runs from "13:10" to "14:10"
    And no occurrence overlaps the fixed event "Lunch"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: The exact padded schedule for two appointments on one day
    Given padding is 15 minutes
    When I add the intents:
      """
      [
        {
          "subject": "physio", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "massage", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the schedule is:
      | subject | date       | start | end   |
      | physio  | 2026-07-06 | 09:00 | 10:00 |
      | massage | 2026-07-06 | 10:15 | 11:15 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Daily standup and planning stay padded every day of the week
    Given padding is 20 minutes
    When I add the intents:
      """
      [
        {
          "subject": "standup", "mode": "default", "priority": 60,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": {
            "period": { "unit": "day", "interval": 1 },
            "per_day": { "count": [1, 1] }
          }
        },
        {
          "subject": "planning", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": {
            "period": { "unit": "day", "interval": 1 },
            "per_day": { "count": [1, 1] }
          }
        }
      ]
      """
    And I solve
    Then there are 7 occurrences of "standup"
    And there are 7 occurrences of "planning"
    And every occurrence of "standup" starts at "09:00"
    And every occurrence of "planning" starts at "09:50"
    And no two occurrences overlap
    And there are no conflicts
