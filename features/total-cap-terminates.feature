Feature: total.max as a lifetime cap that terminates recurrence
  A recurring intent expands its nested cardinality (period + days + per_day)
  into occurrences chronologically; total.max truncates that global list to the
  earliest N. This is the "stretch twice a day, three days a week, for about a
  month — then stop" case. The horizon below is six ISO weeks (2026-07-06 Mon …
  2026-08-16 Sun), so a four-week cap genuinely bites: later weeks get nothing.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-08-16"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  # Nested production over 6 weeks = 3 days/wk x 2/day x 6 = 36. Cap 24 keeps the
  # earliest 24 = the first FOUR weeks (W28-W31), then recurrence stops. Weeks
  # W32 (Aug 3-9) and W33 (Aug 10-16) get nothing.
  Scenario: Stretch twice a day, three days a week, for about a month then stop
    When I add the intent:
      """
      {
        "subject": "stretching", "mode": "default", "priority": 30,
        "duration": [10, 10],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 24]
        }
      }
      """
    And I solve
    Then there are 24 occurrences of "stretching"
    And the total number of placed occurrences is 24
    And there are 2 occurrences of "stretching" on "2026-07-07"
    And an occurrence of "stretching" is placed on "2026-08-01"
    And no occurrence of "stretching" is placed on "2026-08-04"
    And no occurrence of "stretching" is placed on "2026-08-08"
    And no occurrence of "stretching" is placed on "2026-08-15"
    And every occurrence of "stretching" lasts 10 minutes
    And no two occurrences of "stretching" overlap
    And there are no conflicts

  # Cap (100) far above what the horizon can produce (36): recurrence runs fully,
  # count equals the nested production, last week still fires.
  Scenario: A roomy lifetime cap is never reached, so recurrence runs the full horizon
    When I add the intent:
      """
      {
        "subject": "stretching", "mode": "default", "priority": 30,
        "duration": [10, 10],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 100]
        }
      }
      """
    And I solve
    Then there are 36 occurrences of "stretching"
    And the total number of placed occurrences is 36
    And an occurrence of "stretching" is placed on "2026-07-07"
    And an occurrence of "stretching" is placed on "2026-08-15"
    And no two occurrences of "stretching" overlap
    And there are no conflicts

  # Cap (36) exactly equals nested production: nothing is truncated, all six weeks fire.
  Scenario: A lifetime cap exactly equal to production changes nothing
    When I add the intent:
      """
      {
        "subject": "stretching", "mode": "default", "priority": 30,
        "duration": [10, 10],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 36]
        }
      }
      """
    And I solve
    Then there are 36 occurrences of "stretching"
    And the total number of placed occurrences is 36
    And there are 2 occurrences of "stretching" on "2026-08-15"
    And there are no conflicts

  # Simple daily intent, lifetime cap 10 over a 42-day horizon: exactly the first
  # ten days (2026-07-06 … 2026-07-15) get an occurrence; day eleven and beyond none.
  Scenario: Take vitamins daily, but I only have ten left in the bottle
    When I add the intent:
      """
      {
        "subject": "take vitamins", "mode": "default", "priority": 60,
        "duration": [1, 1],
        "window": { "starts_at": "08:00" },
        "cardinality": {
          "period": { "unit": "day", "interval": 1 },
          "per_day": { "count": [1, 1] },
          "total": [null, 10]
        }
      }
      """
    And I solve
    Then there are 10 occurrences of "take vitamins"
    And the total number of placed occurrences is 10
    And an occurrence of "take vitamins" is placed on "2026-07-06"
    And an occurrence of "take vitamins" is placed on "2026-07-15"
    And no occurrence of "take vitamins" is placed on "2026-07-16"
    And no occurrence of "take vitamins" is placed on "2026-08-16"
    And every occurrence of "take vitamins" starts at "08:00"
    And there are no conflicts

  # The tightest cap: total.max of 1 over a daily intent yields a single occurrence
  # on the very first day of the horizon.
  Scenario: A one-shot daily reminder fires only on the first day
    When I add the intent:
      """
      {
        "subject": "water the new plant", "mode": "default", "priority": 40,
        "duration": [5, 5],
        "window": { "starts_at": "07:00" },
        "cardinality": {
          "period": { "unit": "day", "interval": 1 },
          "per_day": { "count": [1, 1] },
          "total": [null, 1]
        }
      }
      """
    And I solve
    Then there is 1 occurrence of "water the new plant"
    And the total number of placed occurrences is 1
    And an occurrence of "water the new plant" is placed on "2026-07-06"
    And no occurrence of "water the new plant" is placed on "2026-07-07"
    And there are no conflicts

  # Weekly day-count (3 of 7 -> Tue/Thu/Sat), one per day. Production = 18. Cap 10
  # keeps the earliest 10 = all of W28-W30 (9) plus W31's Tuesday (2026-07-28).
  # The rest of W31 onward is cut.
  Scenario: Guitar lesson three times a week until my ten-lesson pass runs out
    When I add the intent:
      """
      {
        "subject": "guitar lesson", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "total": [null, 10]
        }
      }
      """
    And I solve
    Then there are 10 occurrences of "guitar lesson"
    And the total number of placed occurrences is 10
    And an occurrence of "guitar lesson" is placed on "2026-07-07"
    And an occurrence of "guitar lesson" is placed on "2026-07-28"
    And no occurrence of "guitar lesson" is placed on "2026-07-30"
    And no occurrence of "guitar lesson" is placed on "2026-08-01"
    And every occurrence of "guitar lesson" falls on a weekday in "TU,TH,SA"
    And there are no conflicts

  # Same weekly 3x shape, cap (18) exactly equal to production: nothing truncated,
  # the final Saturday still fires.
  Scenario: Three swims a week with a cap that matches the season exactly
    When I add the intent:
      """
      {
        "subject": "swim", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "total": [null, 18]
        }
      }
      """
    And I solve
    Then there are 18 occurrences of "swim"
    And the total number of placed occurrences is 18
    And an occurrence of "swim" is placed on "2026-07-07"
    And an occurrence of "swim" is placed on "2026-08-15"
    And every occurrence of "swim" falls on a weekday in "TU,TH,SA"
    And there are no conflicts

  # The cap can cut mid-day: per_day 2 on Tue/Thu/Sat, cap 5. Order is
  # Tue#0, Tue#1, Thu#0, Thu#1, Sat#0 — so Saturday (2026-07-11) keeps only ONE
  # of its two, and everything after is gone.
  Scenario: Physio exercises twice daily, capped right in the middle of a day
    When I add the intent:
      """
      {
        "subject": "physio", "mode": "default", "priority": 30,
        "duration": [10, 10],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 5]
        }
      }
      """
    And I solve
    Then there are 5 occurrences of "physio"
    And the total number of placed occurrences is 5
    And there are 2 occurrences of "physio" on "2026-07-07"
    And there are 2 occurrences of "physio" on "2026-07-09"
    And an occurrence of "physio" is placed on "2026-07-11"
    And no occurrence of "physio" is placed on "2026-07-14"
    And no two occurrences of "physio" overlap
    And there are no conflicts

  # Cap (6) lands exactly on a week boundary: per_day 2 x 3 days = 6 per week, so
  # week one (W28) fires in full and the recurrence stops cleanly at the boundary.
  Scenario: Two meditations a day for exactly one week, then done
    When I add the intent:
      """
      {
        "subject": "meditation", "mode": "default", "priority": 30,
        "duration": [15, 15],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] },
          "total": [null, 6]
        }
      }
      """
    And I solve
    Then there are 6 occurrences of "meditation"
    And the total number of placed occurrences is 6
    And there are 2 occurrences of "meditation" on "2026-07-07"
    And there are 2 occurrences of "meditation" on "2026-07-09"
    And there are 2 occurrences of "meditation" on "2026-07-11"
    And no occurrence of "meditation" is placed on "2026-07-14"
    And no two occurrences of "meditation" overlap
    And there are no conflicts

  # Explicit weekdays (Mon/Wed/Fri), one per day. Production = 18. Cap 7 keeps the
  # earliest 7 = W28 Mon/Wed/Fri, W29 Mon/Wed/Fri, then W30 Monday (2026-07-20).
  # The remainder of W30 onward is terminated.
  Scenario: Commute by bike on Mon/Wed/Fri until the seven-ride challenge is met
    When I add the intent:
      """
      {
        "subject": "bike commute", "mode": "default", "priority": 50,
        "duration": [40, 40],
        "window": { "not_before": "07:00", "not_after": "10:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] },
          "total": [null, 7]
        }
      }
      """
    And I solve
    Then there are 7 occurrences of "bike commute"
    And the total number of placed occurrences is 7
    And an occurrence of "bike commute" is placed on "2026-07-06"
    And an occurrence of "bike commute" is placed on "2026-07-20"
    And no occurrence of "bike commute" is placed on "2026-07-22"
    And no occurrence of "bike commute" is placed on "2026-07-24"
    And every occurrence of "bike commute" falls on a weekday in "MO,WE,FR"
    And there are no conflicts
