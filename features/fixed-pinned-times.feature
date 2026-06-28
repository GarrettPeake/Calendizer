Feature: Fixed and pinned-time intents
  The medication / standup family: occurrences nailed to an exact clock time
  via window.starts_at, and events whose duration floor (min == max, or a flexible
  floor) is fixed. Pinned times are hard, so we can predict starts, ends, durations
  and counts exactly — and we can prove that pinned times only collide when they
  are deliberately scheduled on top of each other.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Take medication every day at 8am, no matter what
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
    And the total number of placed occurrences is 7
    And every occurrence of "take medication" starts at "08:00"
    And every occurrence of "take medication" lasts 1 minutes
    And the occurrence of "take medication" on "2026-07-08" runs from "08:00" to "08:01"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Daily standup pinned to 9am for exactly 30 minutes, weekdays only
    When I add the intent:
      """
      {
        "subject": "standup", "mode": "default", "priority": 60,
        "duration": [30, 30],
        "window": { "starts_at": "09:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","WE","TH","FR"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 5 occurrences of "standup"
    And every occurrence of "standup" starts at "09:00"
    And every occurrence of "standup" lasts 30 minutes
    And every occurrence of "standup" falls on a weekday in "MO,TU,WE,TH,FR"
    And no occurrence of "standup" is placed on "2026-07-11"
    And no occurrence of "standup" is placed on "2026-07-12"
    And the occurrence of "standup" on "2026-07-06" runs from "09:00" to "09:30"
    And there are no conflicts

  Scenario: Afternoon meditation pinned at 4pm for 30 to 60 minutes
    When I add the intent:
      """
      {
        "subject": "meditation", "mode": "default", "priority": 40,
        "duration": [30, 60],
        "window": { "starts_at": "16:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "meditation"
    And every occurrence of "meditation" starts at "16:00"
    And every occurrence of "meditation" lasts between 30 and 60 minutes
    And the occurrence of "meditation" on "2026-07-07" runs from "16:00" to "16:30"
    And no two occurrences of "meditation" overlap
    And there are no conflicts

  Scenario: Podcast recording — a fixed 90-minute block on two specific dates
    When I add the intent:
      """
      {
        "subject": "podcast recording", "mode": "default", "priority": 50,
        "duration": [90, 90],
        "window": { "starts_at": "14:00" },
        "cardinality": { "days": { "dates": ["2026-07-07", "2026-07-09"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "podcast recording"
    And occurrences of "podcast recording" fall on dates "2026-07-07, 2026-07-09"
    And every occurrence of "podcast recording" starts at "14:00"
    And every occurrence of "podcast recording" lasts 90 minutes
    And the occurrence of "podcast recording" on "2026-07-07" runs from "14:00" to "15:30"
    And there are no conflicts

  Scenario: Therapy every Tuesday and Thursday at 10am for 50 minutes
    When I add the intent:
      """
      {
        "subject": "therapy", "mode": "default", "priority": 70,
        "duration": [50, 50],
        "window": { "starts_at": "10:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["TU","TH"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 2 occurrences of "therapy"
    And every occurrence of "therapy" starts at "10:00"
    And every occurrence of "therapy" lasts 50 minutes
    And every occurrence of "therapy" falls on a weekday in "TU,TH"
    And the occurrences of "therapy" are:
      | date       | start | end   |
      | 2026-07-07 | 10:00 | 10:50 |
      | 2026-07-09 | 10:00 | 10:50 |
    And there are no conflicts

  Scenario: A conference call pinned to 11am — assert the exact end time
    When I add the intent:
      """
      {
        "subject": "conference call", "mode": "default", "priority": 55,
        "duration": [60, 60],
        "window": { "starts_at": "11:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "conference call"
    And the occurrence of "conference call" on "2026-07-08" starts at "11:00"
    And the occurrence of "conference call" on "2026-07-08" ends at "12:00"
    And the occurrence of "conference call" on "2026-07-08" runs from "11:00" to "12:00"
    And there are no conflicts

  Scenario: Several pinned intents at different times never collide
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
          "subject": "standup", "mode": "default", "priority": 60,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "evening walk", "mode": "default", "priority": 30,
          "duration": [45, 45],
          "window": { "starts_at": "18:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        }
      ]
      """
    And I solve
    Then there are 7 occurrences of "take medication"
    And there are 7 occurrences of "standup"
    And there are 7 occurrences of "evening walk"
    And the total number of placed occurrences is 21
    And every occurrence of "take medication" starts at "08:00"
    And every occurrence of "standup" starts at "09:00"
    And every occurrence of "evening walk" starts at "18:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Two pills pinned to the same minute on the same day must overlap
    When I add the intents:
      """
      [
        {
          "subject": "morning pill", "mode": "default", "priority": 90,
          "duration": [5, 5],
          "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "morning vitamin", "mode": "default", "priority": 50,
          "duration": [5, 5],
          "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then there is 1 occurrence of "morning pill"
    And there is 1 occurrence of "morning vitamin"
    And every occurrence of "morning pill" starts at "08:00"
    And every occurrence of "morning vitamin" starts at "08:00"
    And there is a conflict
    And there is a conflict of kind "overlap"
    And there is a conflict involving "morning pill" and "morning vitamin"
    And the schedule is:
      | subject         | date       | start | end   |
      | morning pill    | 2026-07-06 | 08:00 | 08:05 |
      | morning vitamin | 2026-07-06 | 08:00 | 08:05 |

  Scenario: An early dose pinned to 6am sits inside sleep but raises no conflict
    When I add the intent:
      """
      {
        "subject": "early medication", "mode": "all", "priority": 100,
        "duration": [1, 1],
        "window": { "starts_at": "06:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "early medication"
    And every occurrence of "early medication" starts at "06:00"
    And the occurrence of "early medication" on "2026-07-10" is placed during sleep
    And there are no conflicts

  Scenario: A daily fixed appointment fills exactly one slot per day
    When I add the intent:
      """
      {
        "subject": "blood pressure check", "mode": "default", "priority": 65,
        "duration": [10, 10],
        "window": { "starts_at": "07:30" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "blood pressure check"
    And an occurrence of "blood pressure check" is placed on "2026-07-06"
    And every occurrence of "blood pressure check" starts at "07:30"
    And every occurrence of "blood pressure check" lasts 10 minutes
    And the occurrence of "blood pressure check" on "2026-07-12" runs from "07:30" to "07:40"
    And no two occurrences overlap
    And there are no conflicts
