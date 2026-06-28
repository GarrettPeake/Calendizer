Feature: Explicit weekday selection (days.weekdays)
  When an intent names explicit weekdays, every listed weekday that falls in a
  period bucket gets an occurrence. Over a four-week horizon (Mon 2026-07-06 to
  Sun 2026-08-02, exactly four ISO weeks) each weekday appears four times, so the
  occurrence counts are fully deterministic.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-08-02"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Wednesday pottery — one session every week
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["WE"] }
        }
      }
      """
    And I solve
    Then there are 4 occurrences of "pottery"
    And every occurrence of "pottery" falls on a weekday in "WE"
    And occurrences of "pottery" fall on dates "2026-07-08, 2026-07-15, 2026-07-22, 2026-07-29"
    And the occurrence of "pottery" on "2026-07-08" runs from "09:00" to "10:00"
    And there are no conflicts

  Scenario: Strength training on Monday, Wednesday and Friday
    When I add the intent:
      """
      {
        "subject": "strength training", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "08:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] }
        }
      }
      """
    And I solve
    Then there are 12 occurrences of "strength training"
    And every occurrence of "strength training" falls on a weekday in "MO,WE,FR"
    And an occurrence of "strength training" is placed on "2026-07-06"
    And no occurrence of "strength training" is placed on "2026-07-07"
    And no two occurrences of "strength training" overlap
    And there are no conflicts

  Scenario: Take vitamins every single day of the week
    When I add the intent:
      """
      {
        "subject": "vitamins", "mode": "default", "priority": 70,
        "duration": [5, 5],
        "window": { "not_before": "08:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","WE","TH","FR","SA","SU"] }
        }
      }
      """
    And I solve
    Then there are 28 occurrences of "vitamins"
    And every occurrence of "vitamins" falls on a weekday in "MO,TU,WE,TH,FR,SA,SU"
    And every occurrence of "vitamins" starts at "08:00"
    And an occurrence of "vitamins" is placed on "2026-08-02"
    And there are no conflicts

  Scenario: Long hike only on weekends
    When I add the intent:
      """
      {
        "subject": "weekend hike", "mode": "default", "priority": 50,
        "duration": [120, 120],
        "window": { "not_before": "09:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["SA","SU"] }
        }
      }
      """
    And I solve
    Then there are 8 occurrences of "weekend hike"
    And every occurrence of "weekend hike" falls on a weekday in "SA,SU"
    And occurrences of "weekend hike" fall on dates "2026-07-11, 2026-07-12, 2026-07-18, 2026-07-19, 2026-07-25, 2026-07-26, 2026-08-01, 2026-08-02"
    And no occurrence of "weekend hike" is placed on "2026-07-06"
    And there are no conflicts

  Scenario: Tuesday and Thursday language drills, twice each day
    When I add the intent:
      """
      {
        "subject": "language drill", "mode": "default", "priority": 40,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["TU","TH"] },
          "per_day": { "count": [2, 2] }
        }
      }
      """
    And I solve
    Then there are 16 occurrences of "language drill"
    And every occurrence of "language drill" falls on a weekday in "TU,TH"
    And there are 2 occurrences of "language drill" on "2026-07-07"
    And every occurrence of "language drill" starts at or after "09:00"
    And every occurrence of "language drill" ends at or before "17:00"
    And no two occurrences of "language drill" overlap
    And there are no conflicts

  Scenario: Monday team standup never lands on other weekdays
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 60,
        "duration": [45, 45],
        "window": { "not_before": "10:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO"] }
        }
      }
      """
    And I solve
    Then there are 4 occurrences of "team standup"
    And every occurrence of "team standup" falls on a weekday in "MO"
    And the occurrence of "team standup" on "2026-07-13" runs from "10:00" to "10:45"
    And no occurrence of "team standup" is placed on "2026-07-07"
    And no occurrence of "team standup" is placed on "2026-07-08"
    And no occurrence of "team standup" is placed on "2026-07-12"
    And there are no conflicts

  Scenario: Friday evening review with an exact weekly schedule
    When I add the intent:
      """
      {
        "subject": "weekly review", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "18:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["FR"] }
        }
      }
      """
    And I solve
    Then every occurrence of "weekly review" falls on a weekday in "FR"
    And the occurrences of "weekly review" are:
      | date       | start | end   |
      | 2026-07-10 | 18:00 | 19:00 |
      | 2026-07-17 | 18:00 | 19:00 |
      | 2026-07-24 | 18:00 | 19:00 |
      | 2026-07-31 | 18:00 | 19:00 |
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Two Wednesday habits stack back-to-back without overlapping
    When I add the intents:
      """
      [
        {
          "subject": "yoga", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "07:00" },
          "cardinality": {
            "period": { "unit": "week", "interval": 1 },
            "days": { "weekdays": ["WE"] }
          }
        },
        {
          "subject": "meditation", "mode": "default", "priority": 40,
          "duration": [30, 30],
          "window": { "not_before": "07:00" },
          "cardinality": {
            "period": { "unit": "week", "interval": 1 },
            "days": { "weekdays": ["WE"] }
          }
        }
      ]
      """
    And I solve
    Then there are 4 occurrences of "yoga"
    And there are 4 occurrences of "meditation"
    And every occurrence of "yoga" falls on a weekday in "WE"
    And every occurrence of "meditation" falls on a weekday in "WE"
    And the occurrence of "yoga" on "2026-07-08" runs from "07:00" to "08:00"
    And the occurrence of "meditation" on "2026-07-08" runs from "08:00" to "08:30"
    And occurrences of "yoga" do not overlap occurrences of "meditation"
    And there are no conflicts

  Scenario: A total cap terminates a weekday recurrence early
    When I add the intent:
      """
      {
        "subject": "guitar practice", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "17:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] },
          "total": [null, 5]
        }
      }
      """
    And I solve
    Then there are 5 occurrences of "guitar practice"
    And every occurrence of "guitar practice" falls on a weekday in "MO,WE,FR"
    And occurrences of "guitar practice" fall on dates "2026-07-06, 2026-07-08, 2026-07-10, 2026-07-13, 2026-07-15"
    And no occurrence of "guitar practice" is placed on "2026-07-17"
    And there are no conflicts

  Scenario: Each weekend slot becomes its own create update
    When I add the intent:
      """
      {
        "subject": "meal prep", "mode": "default", "priority": 50,
        "duration": [90, 90],
        "window": { "not_before": "10:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["SA","SU"] }
        }
      }
      """
    And I solve
    Then there are 8 occurrences of "meal prep"
    And every occurrence of "meal prep" falls on a weekday in "SA,SU"
    And there are 8 "create" updates
    And the update for uid "meal-prep|week:2026-W28|0" is "create"
    And there are no conflicts
