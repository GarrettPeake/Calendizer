Feature: Monthly period bucketing with day-count spread (period unit "month")
  Intents described as "N times a month over the next few months". The recurring
  bucket is the calendar month, so each month independently gets exactly the floor
  of days.count, chosen by the deterministic even-spread rule over that month's
  available dates in chronological order. These scenarios pin down the per-month
  occurrence count, that occurrences land in every month, how partial months at
  the ends of the horizon still earn their floor from their available days, the
  one-per-month versus several-per-month cases, weekday selection inside a monthly
  bucket, and composition with per_day stacking.

  Background:
    Given the planning horizon is "2026-07-01" to "2026-09-30"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Massage once a month lands one evenly-centred day in each month
    When I add the intent:
      """
      {
        "subject": "massage", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [1, 2] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "massage"
    And an occurrence of "massage" is placed on "2026-07-16"
    And an occurrence of "massage" is placed on "2026-08-16"
    And an occurrence of "massage" is placed on "2026-09-16"
    And the occurrences of "massage" are:
      | date       | start | end   |
      | 2026-07-16 | 09:00 | 10:00 |
      | 2026-08-16 | 09:00 | 10:00 |
      | 2026-09-16 | 09:00 | 10:00 |
    And every occurrence of "massage" lasts between 60 and 120 minutes
    And every occurrence of "massage" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Deep-clean twice a month gives each calendar month its own two days
    When I add the intent:
      """
      {
        "subject": "deep clean", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "deep clean"
    And an occurrence of "deep clean" is placed on "2026-07-08"
    And an occurrence of "deep clean" is placed on "2026-08-08"
    And an occurrence of "deep clean" is placed on "2026-09-08"
    And the occurrences of "deep clean" are:
      | date       | start | end   |
      | 2026-07-08 | 08:00 | 08:30 |
      | 2026-07-24 | 08:00 | 08:30 |
      | 2026-08-08 | 08:00 | 08:30 |
      | 2026-08-24 | 08:00 | 08:30 |
      | 2026-09-08 | 08:00 | 08:30 |
      | 2026-09-23 | 08:00 | 08:30 |
    And every occurrence of "deep clean" lasts 30 minutes
    And every occurrence of "deep clean" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Volunteering three times a month spreads three days across every month
    When I add the intent:
      """
      {
        "subject": "volunteering", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then there are 9 occurrences of "volunteering"
    And the occurrences of "volunteering" are:
      | date       | start | end   |
      | 2026-07-06 | 09:00 | 10:00 |
      | 2026-07-16 | 09:00 | 10:00 |
      | 2026-07-26 | 09:00 | 10:00 |
      | 2026-08-06 | 09:00 | 10:00 |
      | 2026-08-16 | 09:00 | 10:00 |
      | 2026-08-26 | 09:00 | 10:00 |
      | 2026-09-06 | 09:00 | 10:00 |
      | 2026-09-16 | 09:00 | 10:00 |
      | 2026-09-26 | 09:00 | 10:00 |
    And every occurrence of "volunteering" starts at or after "09:00"
    And every occurrence of "volunteering" ends at or before "18:00"
    And every occurrence of "volunteering" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A four-a-month plan fills twelve evenly-spread days over the quarter
    When I add the intent:
      """
      {
        "subject": "studio time", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "10:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [4, 5] } }
      }
      """
    And I solve
    Then there are 12 occurrences of "studio time"
    And the occurrences of "studio time" are:
      | date       | start | end   |
      | 2026-07-04 | 10:00 | 10:45 |
      | 2026-07-12 | 10:00 | 10:45 |
      | 2026-07-20 | 10:00 | 10:45 |
      | 2026-07-28 | 10:00 | 10:45 |
      | 2026-08-04 | 10:00 | 10:45 |
      | 2026-08-12 | 10:00 | 10:45 |
      | 2026-08-20 | 10:00 | 10:45 |
      | 2026-08-28 | 10:00 | 10:45 |
      | 2026-09-04 | 10:00 | 10:45 |
      | 2026-09-12 | 10:00 | 10:45 |
      | 2026-09-19 | 10:00 | 10:45 |
      | 2026-09-27 | 10:00 | 10:45 |
    And every occurrence of "studio time" lasts 45 minutes
    And every occurrence of "studio time" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A horizon that starts mid-July still gives July its two-day floor
    Given the planning horizon is "2026-07-15" to "2026-09-30"
    When I add the intent:
      """
      {
        "subject": "town hall", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "town hall"
    And an occurrence of "town hall" is placed on "2026-07-19"
    And an occurrence of "town hall" is placed on "2026-08-08"
    And an occurrence of "town hall" is placed on "2026-09-08"
    And no occurrence of "town hall" is placed on "2026-07-08"
    And the occurrences of "town hall" are:
      | date       | start | end   |
      | 2026-07-19 | 09:00 | 09:30 |
      | 2026-07-27 | 09:00 | 09:30 |
      | 2026-08-08 | 09:00 | 09:30 |
      | 2026-08-24 | 09:00 | 09:30 |
      | 2026-09-08 | 09:00 | 09:30 |
      | 2026-09-23 | 09:00 | 09:30 |
    And every occurrence of "town hall" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A horizon that ends mid-September still gives September its two-day floor
    Given the planning horizon is "2026-07-01" to "2026-09-20"
    When I add the intent:
      """
      {
        "subject": "book club", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "book club"
    And an occurrence of "book club" is placed on "2026-09-06"
    And an occurrence of "book club" is placed on "2026-09-16"
    And no occurrence of "book club" is placed on "2026-09-23"
    And the occurrences of "book club" are:
      | date       | start | end   |
      | 2026-07-08 | 09:00 | 09:30 |
      | 2026-07-24 | 09:00 | 09:30 |
      | 2026-08-08 | 09:00 | 09:30 |
      | 2026-08-24 | 09:00 | 09:30 |
      | 2026-09-06 | 09:00 | 09:30 |
      | 2026-09-16 | 09:00 | 09:30 |
    And every occurrence of "book club" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Selecting Mondays inside a monthly bucket places every Monday in range
    When I add the intent:
      """
      {
        "subject": "monday reset", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "weekdays": ["MO"] } }
      }
      """
    And I solve
    Then there are 13 occurrences of "monday reset"
    And every occurrence of "monday reset" falls on a weekday in "MO"
    And an occurrence of "monday reset" is placed on "2026-07-06"
    And an occurrence of "monday reset" is placed on "2026-08-03"
    And an occurrence of "monday reset" is placed on "2026-09-07"
    And no occurrence of "monday reset" is placed on "2026-07-07"
    And every occurrence of "monday reset" lasts 30 minutes
    And every occurrence of "monday reset" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Twice a month, twice each chosen day stacks per_day on the monthly days
    When I add the intent:
      """
      {
        "subject": "physio", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": {
          "period": { "unit": "month", "interval": 1 },
          "days": { "count": [2, 3] },
          "per_day": { "count": [2, 2] }
        }
      }
      """
    And I solve
    Then there are 12 occurrences of "physio"
    And there are 2 occurrences of "physio" on "2026-07-08"
    And there are 2 occurrences of "physio" on "2026-08-24"
    And there are 2 occurrences of "physio" on "2026-09-08"
    And every occurrence of "physio" starts at or after "08:00"
    And every occurrence of "physio" ends at or before "20:00"
    And every occurrence of "physio" lasts 30 minutes
    And every occurrence of "physio" is aligned to the grid
    And no two occurrences of "physio" overlap
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A monthly errand in a tight evening window honours a coarser grid
    When I add the intent:
      """
      {
        "subject": "night market", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "18:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [1, 2] } }
      }
      """
    And the grid is 30 minutes
    And I solve
    Then there are 3 occurrences of "night market"
    And the occurrences of "night market" are:
      | date       | start | end   |
      | 2026-07-16 | 18:00 | 19:00 |
      | 2026-08-16 | 18:00 | 19:00 |
      | 2026-09-16 | 18:00 | 19:00 |
    And every occurrence of "night market" starts at or after "18:00"
    And every occurrence of "night market" ends at or before "21:00"
    And every occurrence of "night market" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Each calendar month is an independent bucket over a two-month horizon
    Given the planning horizon is "2026-07-01" to "2026-08-31"
    When I add the intent:
      """
      {
        "subject": "haircut", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "10:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "haircut"
    And the occurrences of "haircut" are:
      | date       | start | end   |
      | 2026-07-08 | 10:00 | 10:30 |
      | 2026-07-24 | 10:00 | 10:30 |
      | 2026-08-08 | 10:00 | 10:30 |
      | 2026-08-24 | 10:00 | 10:30 |
    And every occurrence of "haircut" is aligned to the grid
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A fresh solve emits one create update per derived monthly slot
    When I add the intent:
      """
      {
        "subject": "budget review", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [2, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "budget review"
    And there are 6 "create" updates
    And no two occurrences overlap
    And there are no conflicts
