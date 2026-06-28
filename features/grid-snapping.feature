Feature: Grid snapping of start times
  An occurrence's earliest-fit start is its not_before rounded UP to the next
  multiple of the global grid. A start that already sits on the grid stays put,
  marker-resolved not_before values snap the same way, back-to-back stacking
  still lands on grid multiples, and a fixed event whose end falls off-grid
  pushes the next derived start up to the following grid boundary. Pinned
  starts_at times are excluded here so every derived start is grid-aligned.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Guitar practice at 9:07 snaps up to the quarter hour on a 15-minute grid
    Given the grid is 15 minutes
    When I add the intent:
      """
      {
        "subject": "guitar practice", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:07", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "guitar practice"
    And the occurrence of "guitar practice" on "2026-07-09" runs from "09:15" to "10:15"
    And every occurrence of "guitar practice" is aligned to the grid
    And there are no conflicts

  Scenario: Email triage at 9:01 snaps up to 9:05 on a 5-minute grid
    Given the grid is 5 minutes
    When I add the intent:
      """
      {
        "subject": "email triage", "mode": "default", "priority": 40,
        "duration": [30, 30],
        "window": { "not_before": "09:01", "not_after": "11:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "email triage"
    And the occurrence of "email triage" on "2026-07-09" runs from "09:05" to "09:35"
    And every occurrence of "email triage" is aligned to the grid
    And there are no conflicts

  Scenario: Yoga at 8:50 snaps up to the top of the hour on a 30-minute grid
    Given the grid is 30 minutes
    When I add the intent:
      """
      {
        "subject": "yoga flow", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:50", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "yoga flow"
    And the occurrence of "yoga flow" on "2026-07-09" runs from "09:00" to "10:00"
    And every occurrence of "yoga flow" is aligned to the grid
    And there are no conflicts

  Scenario: A deep-work block at 9:20 snaps up to the next whole hour on a 60-minute grid
    Given the grid is 60 minutes
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 60,
        "duration": [60, 60],
        "window": { "not_before": "09:20", "not_after": "13:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "deep work"
    And the occurrence of "deep work" on "2026-07-09" runs from "10:00" to "11:00"
    And every occurrence of "deep work" is aligned to the grid
    And there are no conflicts

  Scenario: A not_before that already sits on the grid stays exactly put
    Given the grid is 15 minutes
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "team standup"
    And the occurrence of "team standup" on "2026-07-09" runs from "09:00" to "10:00"
    And every occurrence of "team standup" is aligned to the grid
    And there are no conflicts

  Scenario: Meditation right after an off-grid wakeup snaps up to the grid
    Given wakeup is "06:23"
    And the grid is 15 minutes
    When I add the intent:
      """
      {
        "subject": "morning meditation", "mode": "default", "priority": 45,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "morning meditation"
    And the occurrence of "morning meditation" on "2026-07-09" runs from "06:30" to "07:00"
    And every occurrence of "morning meditation" is aligned to the grid
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Back-to-back stacking still lands the second block on a grid multiple
    Given the grid is 15 minutes
    And padding is 10 minutes
    When I add the intents:
      """
      [
        {
          "subject": "morning workout", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "13:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } }
        },
        {
          "subject": "stretch session", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "13:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "morning workout" on "2026-07-09" runs from "09:00" to "10:00"
    And the occurrence of "stretch session" on "2026-07-09" runs from "10:15" to "11:15"
    And every occurrence is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A fixed event ending off-grid pushes the next start up to the following grid line
    Given the grid is 15 minutes
    And an existing fixed event "Standup" on "2026-07-09" from "09:00" to "09:37"
    When I add the intent:
      """
      {
        "subject": "code review", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then the occurrence of "code review" on "2026-07-09" runs from "09:45" to "10:15"
    And every occurrence of "code review" is aligned to the grid
    And no occurrence overlaps the fixed event "Standup"
    And there are no conflicts

  Scenario: A language lesson at 9:03 snaps up to 9:10 on a 10-minute grid
    Given the grid is 10 minutes
    When I add the intent:
      """
      {
        "subject": "language lesson", "mode": "default", "priority": 35,
        "duration": [45, 45],
        "window": { "not_before": "09:03", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "language lesson"
    And the occurrence of "language lesson" on "2026-07-09" runs from "09:10" to "09:55"
    And every occurrence of "language lesson" is aligned to the grid
    And there are no conflicts

  Scenario: Off-grid windows across several weekly days all snap to a 30-minute grid
    Given the grid is 30 minutes
    When I add the intents:
      """
      [
        {
          "subject": "yoga", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "07:10", "not_after": "12:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
        },
        {
          "subject": "reading", "mode": "default", "priority": 30,
          "duration": [30, 30],
          "window": { "not_before": "13:17", "not_after": "18:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
        }
      ]
      """
    And I solve
    Then there are 3 occurrences of "yoga"
    And there are 2 occurrences of "reading"
    And every occurrence of "yoga" starts at or after "07:10"
    And every occurrence of "reading" starts at or after "13:17"
    And every occurrence is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Banded per-day repetitions from an off-grid window each land on the grid
    Given the grid is 15 minutes
    When I add the intent:
      """
      {
        "subject": "writing sprint", "mode": "default", "priority": 40,
        "duration": [30, 30],
        "window": { "not_before": "09:07", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "writing sprint"
    And there are 2 occurrences of "writing sprint" on "2026-07-09"
    And every occurrence of "writing sprint" starts at or after "09:07"
    And every occurrence of "writing sprint" ends at or before "17:00"
    And every occurrence of "writing sprint" is aligned to the grid
    And no two occurrences of "writing sprint" overlap
    And there are no conflicts
