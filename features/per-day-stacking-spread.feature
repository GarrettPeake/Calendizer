Feature: Per-day stacking spread across the legal window
  When one intent fires several times on the same day, the solver bands those
  occurrences across the day's legal window: occurrence j of n searches from
  not_before + floor(span * j / n) (snapped up to the grid) and takes the
  earliest free slot there. They never overlap, they stay inside the window,
  and every start snaps to the grid.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Two pottery sessions on the same Tuesday, banded morning and afternoon
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "pottery"
    And there are 2 occurrences of "pottery" on "2026-07-07"
    And no two occurrences of "pottery" overlap
    And every occurrence of "pottery" is aligned to the grid
    And every occurrence of "pottery" starts at or after "09:00"
    And every occurrence of "pottery" ends at or before "17:00"
    And the occurrences of "pottery" are:
      | date       | start | end   |
      | 2026-07-07 | 09:00 | 10:00 |
      | 2026-07-07 | 12:30 | 13:30 |
    And there are no conflicts

  Scenario: Three guitar practices spread evenly across a single Thursday
    When I add the intent:
      """
      {
        "subject": "guitar", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "days": { "dates": ["2026-07-09"] }, "per_day": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "guitar"
    And there are 3 occurrences of "guitar" on "2026-07-09"
    And no two occurrences of "guitar" overlap
    And occurrences of "guitar" are at least 60 minutes apart
    And every occurrence of "guitar" is aligned to the grid
    And the occurrences of "guitar" are:
      | date       | start | end   |
      | 2026-07-09 | 08:00 | 09:00 |
      | 2026-07-09 | 11:40 | 12:40 |
      | 2026-07-09 | 15:20 | 16:20 |
    And there are no conflicts

  Scenario: Stretch twice a day, three days a week — banding nests inside day selection
    When I add the intent:
      """
      {
        "subject": "stretching", "mode": "default", "priority": 30,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "count": [3, 3] },
          "per_day": { "count": [2, 2] }
        }
      }
      """
    And I solve
    Then there are 6 occurrences of "stretching"
    And the total number of placed occurrences is 6
    And every occurrence of "stretching" falls on a weekday in "TU,TH,SA"
    And there are 2 occurrences of "stretching" on "2026-07-07"
    And there are 2 occurrences of "stretching" on "2026-07-09"
    And there are 2 occurrences of "stretching" on "2026-07-11"
    And no two occurrences of "stretching" overlap
    And occurrences of "stretching" are at least 60 minutes apart
    And every occurrence of "stretching" is aligned to the grid
    And the occurrences of "stretching" are:
      | date       | start | end   |
      | 2026-07-07 | 09:00 | 10:00 |
      | 2026-07-07 | 13:30 | 14:30 |
      | 2026-07-09 | 09:00 | 10:00 |
      | 2026-07-09 | 13:30 | 14:30 |
      | 2026-07-11 | 09:00 | 10:00 |
      | 2026-07-11 | 13:30 | 14:30 |
    And there are no conflicts

  Scenario: Three water breaks on Mondays, Wednesdays and Fridays
    When I add the intent:
      """
      {
        "subject": "water break", "mode": "default", "priority": 40,
        "duration": [60, 60],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] },
          "per_day": { "count": [3, 3] }
        }
      }
      """
    And I solve
    Then there are 9 occurrences of "water break"
    And the total number of placed occurrences is 9
    And every occurrence of "water break" falls on a weekday in "MO,WE,FR"
    And there are 3 occurrences of "water break" on "2026-07-06"
    And there are 3 occurrences of "water break" on "2026-07-08"
    And there are 3 occurrences of "water break" on "2026-07-10"
    And no two occurrences of "water break" overlap
    And every occurrence of "water break" is aligned to the grid
    And every occurrence of "water break" starts at or after "08:00"
    And every occurrence of "water break" ends at or before "20:00"
    And there are no conflicts

  Scenario: Two 90-minute deep-work blocks banded across a Wednesday
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 60,
        "duration": [90, 90],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "deep work"
    And every occurrence of "deep work" lasts 90 minutes
    And no two occurrences of "deep work" overlap
    And occurrences of "deep work" are at least 60 minutes apart
    And every occurrence of "deep work" is aligned to the grid
    And the occurrences of "deep work" are:
      | date       | start | end   |
      | 2026-07-08 | 09:00 | 10:30 |
      | 2026-07-08 | 12:45 | 14:15 |
    And there are no conflicts

  Scenario: Banded starts snap up to the grid when the span does not divide evenly
    When I add the intent:
      """
      {
        "subject": "language drill", "mode": "default", "priority": 35,
        "duration": [50, 50],
        "window": { "not_before": "09:00", "not_after": "16:40" },
        "cardinality": { "days": { "dates": ["2026-07-10"] }, "per_day": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "language drill"
    And every occurrence of "language drill" lasts 50 minutes
    And no two occurrences of "language drill" overlap
    And every occurrence of "language drill" is aligned to the grid
    And every occurrence of "language drill" ends at or before "16:40"
    And the occurrences of "language drill" are:
      | date       | start | end   |
      | 2026-07-10 | 09:00 | 09:50 |
      | 2026-07-10 | 11:20 | 12:10 |
      | 2026-07-10 | 13:35 | 14:25 |
    And there are no conflicts

  Scenario: Two physio sessions on each of two explicit dates
    When I add the intent:
      """
      {
        "subject": "physio", "mode": "default", "priority": 45,
        "duration": [60, 60],
        "window": { "not_before": "10:00", "not_after": "18:00" },
        "cardinality": { "days": { "dates": ["2026-07-07","2026-07-11"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "physio"
    And the total number of placed occurrences is 4
    And occurrences of "physio" fall on dates "2026-07-07,2026-07-11"
    And there are 2 occurrences of "physio" on "2026-07-07"
    And there are 2 occurrences of "physio" on "2026-07-11"
    And no two occurrences of "physio" overlap
    And occurrences of "physio" are at least 60 minutes apart
    And the occurrences of "physio" are:
      | date       | start | end   |
      | 2026-07-07 | 10:00 | 11:00 |
      | 2026-07-07 | 13:30 | 14:30 |
      | 2026-07-11 | 10:00 | 11:00 |
      | 2026-07-11 | 13:30 | 14:30 |
    And there are no conflicts

  Scenario: Three short meditations on a Sunday stay inside a wide window
    When I add the intent:
      """
      {
        "subject": "meditation", "mode": "default", "priority": 30,
        "duration": [45, 45],
        "window": { "not_before": "09:00", "not_after": "21:00" },
        "cardinality": { "days": { "dates": ["2026-07-12"] }, "per_day": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "meditation"
    And there are 3 occurrences of "meditation" on "2026-07-12"
    And no two occurrences of "meditation" overlap
    And occurrences of "meditation" are at least 60 minutes apart
    And every occurrence of "meditation" is aligned to the grid
    And every occurrence of "meditation" starts at or after "09:00"
    And every occurrence of "meditation" ends at or before "21:00"
    And every occurrence of "meditation" lasts 45 minutes
    And there are no conflicts

  Scenario: Two 2-hour rehearsals banded across a long Monday window
    When I add the intent:
      """
      {
        "subject": "rehearsal", "mode": "default", "priority": 55,
        "duration": [120, 120],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "rehearsal"
    And every occurrence of "rehearsal" lasts 120 minutes
    And no two occurrences of "rehearsal" overlap
    And occurrences of "rehearsal" are at least 60 minutes apart
    And every occurrence of "rehearsal" is aligned to the grid
    And the occurrences of "rehearsal" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 11:00 |
      | 2026-07-06 | 13:00 | 15:00 |
    And there are no conflicts

  Scenario: Three posture checks on Tuesday banded between wakeup and sleep
    When I add the intent:
      """
      {
        "subject": "posture check", "mode": "default", "priority": 25,
        "duration": [30, 30],
        "window": { "not_before": { "marker": "wakeup" }, "not_after": { "marker": "sleep" } },
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["TU"] },
          "per_day": { "count": [3, 3] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "posture check"
    And there are 3 occurrences of "posture check" on "2026-07-07"
    And no two occurrences of "posture check" overlap
    And occurrences of "posture check" are at least 60 minutes apart
    And every occurrence of "posture check" is aligned to the grid
    And every occurrence of "posture check" starts at or after "07:00"
    And every occurrence of "posture check" ends at or before "23:00"
    And no occurrence is marked as placed during sleep
    And the occurrences of "posture check" are:
      | date       | start | end   |
      | 2026-07-07 | 07:00 | 07:30 |
      | 2026-07-07 | 12:10 | 12:40 |
      | 2026-07-07 | 17:20 | 17:50 |
    And there are no conflicts
