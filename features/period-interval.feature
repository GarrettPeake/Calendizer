Feature: Recurrence intervals greater than one
  Exercises cardinality.period.interval > 1. Per the DSL contract, base buckets
  (week / month / day) are computed, then merged into consecutive groups of
  `interval`; the day-count / per_day selection then applies PER MERGED GROUP.
  So a larger interval yields fewer occurrences over the same horizon. All
  scenarios are deterministic, daytime, and conflict-free.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-08-02"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Guitar lesson once a week — interval 1 baseline over four weeks
    When I add the intent:
      """
      {
        "subject": "guitar lesson", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "guitar lesson"
    And every occurrence of "guitar lesson" falls on a weekday in "TH"
    And every occurrence of "guitar lesson" lasts 60 minutes
    And every occurrence of "guitar lesson" starts at "09:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Deep clean every two weeks — interval 2 halves the count
    When I add the intent:
      """
      {
        "subject": "deep clean", "mode": "default", "priority": 50,
        "duration": [90, 90],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "week", "interval": 2 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "deep clean"
    And an occurrence of "deep clean" is placed on "2026-07-13"
    And an occurrence of "deep clean" is placed on "2026-07-27"
    And no occurrence of "deep clean" is placed on "2026-07-06"
    And no occurrence of "deep clean" is placed on "2026-07-20"
    And there are no conflicts

  Scenario: Therapy twice a week — interval 1 with a day-count of two
    When I add the intent:
      """
      {
        "subject": "therapy", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 8 occurrences of "therapy"
    And every occurrence of "therapy" falls on a weekday in "TU,SA"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Therapy twice every other week — interval 2 with a day-count of two
    When I add the intent:
      """
      {
        "subject": "therapy", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "week", "interval": 2 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "therapy"
    And an occurrence of "therapy" is placed on "2026-07-09"
    And an occurrence of "therapy" is placed on "2026-07-23"
    And no occurrence of "therapy" is placed on "2026-07-06"
    And every occurrence of "therapy" falls on a weekday in "TH"
    And there are no conflicts

  Scenario: Daily walk — interval 1 over a twelve-day stretch
    Given the planning horizon is "2026-07-06" to "2026-07-17"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 40,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "11:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 12 occurrences of "walk"
    And an occurrence of "walk" is placed on "2026-07-06"
    And every occurrence of "walk" starts at "09:00"
    And there are no conflicts

  Scenario: Workout every other day — day interval 2 picks one of each pair
    Given the planning horizon is "2026-07-06" to "2026-07-17"
    When I add the intent:
      """
      {
        "subject": "workout", "mode": "default", "priority": 40,
        "duration": [45, 45],
        "window": { "not_before": "09:00", "not_after": "11:00" },
        "cardinality": { "period": { "unit": "day", "interval": 2 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "workout"
    And an occurrence of "workout" is placed on "2026-07-07"
    And an occurrence of "workout" is placed on "2026-07-17"
    And no occurrence of "workout" is placed on "2026-07-06"
    And no occurrence of "workout" is placed on "2026-07-08"
    And there are no conflicts

  Scenario: Stretch twice a day every other day — interval 2 with per_day stacking
    Given the planning horizon is "2026-07-06" to "2026-07-17"
    When I add the intent:
      """
      {
        "subject": "stretch", "mode": "default", "priority": 30,
        "duration": [15, 15],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": {
          "period": { "unit": "day", "interval": 2 },
          "days": { "count": [1, 1] },
          "per_day": { "count": [2, 2] }
        }
      }
      """
    And I solve
    Then there are 12 occurrences of "stretch"
    And there are 2 occurrences of "stretch" on "2026-07-07"
    And no occurrence of "stretch" is placed on "2026-07-06"
    And every occurrence of "stretch" lasts 15 minutes
    And no two occurrences of "stretch" overlap
    And there are no conflicts

  Scenario: Water the garden every three days — day interval 3
    Given the planning horizon is "2026-07-06" to "2026-07-17"
    When I add the intent:
      """
      {
        "subject": "water garden", "mode": "default", "priority": 35,
        "duration": [20, 20],
        "window": { "not_before": "08:00", "not_after": "10:00" },
        "cardinality": { "period": { "unit": "day", "interval": 3 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "water garden"
    And an occurrence of "water garden" is placed on "2026-07-07"
    And an occurrence of "water garden" is placed on "2026-07-10"
    And an occurrence of "water garden" is placed on "2026-07-13"
    And an occurrence of "water garden" is placed on "2026-07-16"
    And there are no conflicts

  Scenario: Monthly budget review — month interval 1 across half a year
    Given the planning horizon is "2026-07-01" to "2026-12-31"
    When I add the intent:
      """
      {
        "subject": "budget review", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "budget review"
    And an occurrence of "budget review" is placed on "2026-07-16"
    And every occurrence of "budget review" starts at "09:00"
    And there are no conflicts

  Scenario: Bi-monthly deep review — month interval 2 thirds the count
    Given the planning horizon is "2026-07-01" to "2026-12-31"
    When I add the intent:
      """
      {
        "subject": "deep review", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "period": { "unit": "month", "interval": 2 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "deep review"
    And an occurrence of "deep review" is placed on "2026-08-01"
    And an occurrence of "deep review" is placed on "2026-10-01"
    And an occurrence of "deep review" is placed on "2026-12-01"
    And every occurrence of "deep review" starts at "09:00"
    And there are no conflicts

  Scenario: A lifetime cap terminates the merged-bucket recurrence early
    When I add the intent:
      """
      {
        "subject": "audit", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 2 },
          "days": { "count": [1, 1] },
          "total": [null, 1]
        }
      }
      """
    And I solve
    Then there is 1 occurrence of "audit"
    And an occurrence of "audit" is placed on "2026-07-13"
    And no occurrence of "audit" is placed on "2026-07-27"
    And there are no conflicts
