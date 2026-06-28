Feature: Full-day and full-week integration
  Many intents solved together — a believable life modelled end to end. Each
  scenario adds several intents at once and asserts the resulting placement as a
  whole schedule, proving the priority ordering, clumping, mode suppression and
  routing-around-fixed-events all compose correctly.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 10 minutes

  Scenario: Plan a focused Monday working from home
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "morning routine", "mode": "default", "priority": 80,
          "duration": [30, 30],
          "window": { "not_before": { "marker": "wakeup" } },
          "children": [
            { "subject": "brush teeth", "duration": 5 },
            { "subject": "do hair", "weight": 1 },
            { "subject": "shower", "duration": 15 }
          ],
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "deep work", "mode": "default", "priority": 60,
          "duration": [120, 120],
          "window": { "not_before": "09:00", "not_after": "12:30" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "lunch", "mode": "default", "priority": 70,
          "duration": [45, 45], "window": { "starts_at": "12:30" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "afternoon work", "mode": "default", "priority": 60,
          "duration": [120, 120],
          "window": { "not_before": "13:30", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "evening reading", "mode": "default", "priority": 40,
          "duration": [45, 45], "window": { "not_before": "20:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject         | date       | start | end   |
      | morning routine | 2026-07-06 | 07:00 | 07:30 |
      | take medication | 2026-07-06 | 08:00 | 08:01 |
      | deep work       | 2026-07-06 | 09:00 | 11:00 |
      | lunch           | 2026-07-06 | 12:30 | 13:15 |
      | afternoon work  | 2026-07-06 | 13:30 | 15:30 |
      | evening reading | 2026-07-06 | 20:00 | 20:45 |
    And the children of "morning routine" on "2026-07-06" are contiguous
    And no two occurrences overlap
    And there are no conflicts

  Scenario: That Monday now has to route around a fixed dentist appointment
    Given an existing fixed event "Dentist" on "2026-07-06" from "11:00" to "12:00"
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "deep work", "mode": "default", "priority": 60,
          "duration": [90, 90],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "errands", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject         | date       | start | end   |
      | take medication | 2026-07-06 | 08:00 | 08:01 |
      | deep work       | 2026-07-06 | 09:00 | 10:30 |
      | errands         | 2026-07-06 | 12:10 | 13:10 |
    And no two occurrences overlap
    And no occurrence overlaps the fixed event "Dentist"
    And there are no conflicts

  Scenario: Three discretionary tasks clump back-to-back by priority
    When I add the intents:
      """
      [
        { "subject": "answer email", "mode": "default", "priority": 90,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "budget review", "mode": "default", "priority": 70,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "call mom", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject       | date       | start | end   |
      | answer email  | 2026-07-07 | 09:00 | 09:30 |
      | budget review | 2026-07-07 | 09:40 | 10:10 |
      | call mom      | 2026-07-07 | 10:20 | 10:50 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A recurring workout three times this week alongside daily medication
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } } },
        { "subject": "workout", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "17:00", "not_after": "20:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } } }
      ]
      """
    And I solve
    Then there are 7 occurrences of "take medication"
    And there are 3 occurrences of "workout"
    And the occurrences of "workout" are:
      | date       | start | end   |
      | 2026-07-07 | 17:00 | 18:00 |
      | 2026-07-09 | 17:00 | 18:00 |
      | 2026-07-11 | 17:00 | 18:00 |
    And every occurrence of "workout" falls on a weekday in "TU,TH,SA"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A single day with a morning routine and twice-daily stretching
    When I add the intents:
      """
      [
        { "subject": "morning routine", "mode": "default", "priority": 80,
          "duration": [30, 30],
          "window": { "not_before": { "marker": "wakeup" } },
          "children": [
            { "subject": "brush teeth", "duration": 5 },
            { "subject": "do hair", "weight": 1 },
            { "subject": "shower", "duration": 15 }
          ],
          "cardinality": { "days": { "dates": ["2026-07-08"] } } },
        { "subject": "stretching", "mode": "default", "priority": 30,
          "duration": [10, 10],
          "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
          "cardinality": { "days": { "dates": ["2026-07-08"] }, "per_day": { "count": [2, 2] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject         | date       | start | end   |
      | morning routine | 2026-07-08 | 07:00 | 07:30 |
      | stretching      | 2026-07-08 | 07:40 | 07:50 |
      | stretching      | 2026-07-08 | 14:55 | 15:05 |
    And there are 2 occurrences of "stretching" on "2026-07-08"
    And no two occurrences of "stretching" overlap
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A vacation day clears the default calendar but keeps medication
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } },
        { "subject": "team standup", "mode": "default", "priority": 60,
          "duration": [30, 30], "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } },
        { "subject": "beach time", "mode": "vacation", "priority": 40,
          "duration": [120, 120],
          "window": { "not_before": "11:00", "not_after": "16:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } },
        { "subject": "sunset cocktail", "mode": "vacation", "priority": 30,
          "duration": [60, 60],
          "window": { "not_before": "18:00", "not_after": "21:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject         | date       | start | end   |
      | take medication | 2026-07-09 | 08:00 | 08:01 |
      | beach time      | 2026-07-09 | 11:00 | 13:00 |
      | sunset cocktail | 2026-07-09 | 18:00 | 19:00 |
    And there are no occurrences of "team standup"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Normal day versus vacation day in the same week
    Given a mode "vacation" spanning "2026-07-09" to "2026-07-12"
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } } },
        { "subject": "team standup", "mode": "default", "priority": 60,
          "duration": [30, 30], "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } } },
        { "subject": "beach time", "mode": "vacation", "priority": 40,
          "duration": [120, 120],
          "window": { "not_before": "11:00", "not_after": "16:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } } }
      ]
      """
    And I solve
    Then an occurrence of "team standup" is placed on "2026-07-06"
    And no occurrence of "team standup" is placed on "2026-07-09"
    And an occurrence of "beach time" is placed on "2026-07-09"
    And no occurrence of "beach time" is placed on "2026-07-06"
    And an occurrence of "take medication" is placed on "2026-07-06"
    And an occurrence of "take medication" is placed on "2026-07-09"
    And the total number of placed occurrences is 14
    And no two occurrences overlap
    And there are no conflicts

  Scenario: An evening wind-down routine after a pinned dinner
    When I add the intents:
      """
      [
        { "subject": "dinner", "mode": "default", "priority": 80,
          "duration": [45, 45], "window": { "starts_at": "18:30" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } },
        { "subject": "tidy kitchen", "mode": "default", "priority": 60,
          "duration": [20, 20], "window": { "not_before": "19:00" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } },
        { "subject": "evening reading", "mode": "default", "priority": 40,
          "duration": [45, 45], "window": { "not_before": "20:00" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject         | date       | start | end   |
      | dinner          | 2026-07-10 | 18:30 | 19:15 |
      | tidy kitchen    | 2026-07-10 | 19:25 | 19:45 |
      | evening reading | 2026-07-10 | 20:00 | 20:45 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A work-from-home day of deep-work blocks around meals
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "breakfast", "mode": "default", "priority": 75,
          "duration": [30, 30], "window": { "starts_at": "08:30" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "lunch", "mode": "default", "priority": 75,
          "duration": [45, 45], "window": { "starts_at": "12:30" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "morning deep work", "mode": "default", "priority": 60,
          "duration": [150, 150],
          "window": { "not_before": "09:00", "not_after": "12:30" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "afternoon deep work", "mode": "default", "priority": 60,
          "duration": [150, 150],
          "window": { "not_before": "13:30", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject             | date       | start | end   |
      | take medication     | 2026-07-07 | 08:00 | 08:01 |
      | breakfast           | 2026-07-07 | 08:30 | 09:00 |
      | morning deep work   | 2026-07-07 | 09:10 | 11:40 |
      | lunch               | 2026-07-07 | 12:30 | 13:15 |
      | afternoon deep work | 2026-07-07 | 13:30 | 16:00 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A whole week of layered routines and recurring commitments
    When I add the intents:
      """
      [
        { "subject": "take medication", "mode": "all", "priority": 100,
          "duration": [1, 1], "window": { "starts_at": "08:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } } },
        { "subject": "morning routine", "mode": "default", "priority": 80,
          "duration": [30, 30],
          "window": { "not_before": { "marker": "wakeup" } },
          "children": [
            { "subject": "brush teeth", "duration": 5 },
            { "subject": "do hair", "weight": 1 },
            { "subject": "shower", "duration": 15 }
          ],
          "cardinality": { "period": { "unit": "week", "interval": 1 },
            "days": { "weekdays": ["MO","TU","WE","TH","FR","SA","SU"] },
            "per_day": { "count": [1, 1] } } },
        { "subject": "workout", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "17:00", "not_after": "20:00" },
          "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } } }
      ]
      """
    And I solve
    Then there are 7 occurrences of "take medication"
    And there are 7 occurrences of "morning routine"
    And there are 3 occurrences of "workout"
    And the total number of placed occurrences is 17
    And every occurrence of "take medication" starts at "08:00"
    And no two occurrences overlap
    And there are no conflicts
