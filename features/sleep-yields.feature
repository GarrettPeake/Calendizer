Feature: The yielding sleep blackout
  The sleep window blocks discretionary placement, but yields when an event can
  only run during sleep. Sleep is removed from a legal window only while that
  leaves room; if the sole legal slot is inside sleep, the event is placed there
  and marked "placed during sleep" with no conflict. Normal daytime events are
  never flagged.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes

  Scenario: A 3am fishing trip lands inside sleep with no complaint
    When I add the intent:
      """
      {
        "subject": "fishing", "mode": "default", "priority": 50,
        "duration": [240, 240],
        "window": { "starts_at": "03:00" },
        "cardinality": { "days": { "dates": ["2026-07-11"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "fishing"
    And the occurrence of "fishing" on "2026-07-11" starts at "03:00"
    And the occurrence of "fishing" on "2026-07-11" ends at "07:00"
    And the occurrence of "fishing" on "2026-07-11" is placed during sleep
    And there are no conflicts

  Scenario: Two pre-dawn fishing trips both yield silently
    When I add the intent:
      """
      {
        "subject": "fishing", "mode": "default", "priority": 50,
        "duration": [240, 240],
        "window": { "starts_at": "03:00" },
        "cardinality": { "days": { "dates": ["2026-07-07", "2026-07-11"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "fishing"
    And the occurrence of "fishing" on "2026-07-07" is placed during sleep
    And the occurrence of "fishing" on "2026-07-11" is placed during sleep
    And there are no conflicts

  Scenario: A late-night stargazing session pinned after bedtime yields
    When I add the intent:
      """
      {
        "subject": "stargazing", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "starts_at": "23:30" },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then the occurrence of "stargazing" on "2026-07-08" starts at "23:30"
    And the occurrence of "stargazing" on "2026-07-08" is placed during sleep
    And there are no conflicts

  Scenario: An aurora watch whose whole window sits inside sleep yields without a pin
    When I add the intent:
      """
      {
        "subject": "aurora watch", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "01:00", "not_after": "05:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then the occurrence of "aurora watch" on "2026-07-09" runs from "01:00" to "02:00"
    And the occurrence of "aurora watch" on "2026-07-09" is placed during sleep
    And there are no conflicts

  Scenario: Daily reading in a wide daytime window stays in waking hours
    When I add the intent:
      """
      {
        "subject": "reading", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "reading"
    And every occurrence of "reading" starts at "09:00"
    And every occurrence of "reading" ends at or before "17:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A lunch walk whose window is entirely within waking hours is never flagged
    When I add the intent:
      """
      {
        "subject": "lunch walk", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "12:00", "not_after": "13:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "lunch walk"
    And every occurrence of "lunch walk" starts at or after "12:00"
    And every occurrence of "lunch walk" ends at or before "13:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A morning jog whose window straddles wake-up keeps the waking room
    When I add the intent:
      """
      {
        "subject": "morning jog", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "05:00", "not_after": "10:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "morning jog"
    And every occurrence of "morning jog" starts at or after "07:00"
    And every occurrence of "morning jog" ends at or before "10:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: A pinned 9am standup is normal daytime and never marked placed-during-sleep
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
    Then there are 7 occurrences of "team standup"
    And every occurrence of "team standup" starts at "09:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: With an earlier 22:00 bedtime a 22:30 read yields to the new sleep window
    Given sleep is "22:00"
    When I add the intent:
      """
      {
        "subject": "night reading", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "22:30" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "night reading" on "2026-07-07" starts at "22:30"
    And the occurrence of "night reading" on "2026-07-07" is placed during sleep
    And there are no conflicts

  Scenario: With a later 06:30 wake-up a 4am hike finishing before wake-up still yields
    Given wakeup is "06:30"
    When I add the intent:
      """
      {
        "subject": "early hike", "mode": "default", "priority": 50,
        "duration": [120, 120],
        "window": { "starts_at": "04:00" },
        "cardinality": { "days": { "dates": ["2026-07-10"] } }
      }
      """
    And I solve
    Then the occurrence of "early hike" on "2026-07-10" starts at "04:00"
    And the occurrence of "early hike" on "2026-07-10" ends at "06:00"
    And the occurrence of "early hike" on "2026-07-10" is placed during sleep
    And there are no conflicts
