Feature: Planning-horizon boundaries
  Occurrences are only placed on dates within the inclusive horizon [start, end].
  Recurrence never spills outside it, and partial first/last weeks (or months)
  still receive their floor count chosen from only the days available inside the
  horizon, via the deterministic choose-k-of-n even spread.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Daily reminder over a short three-day trip — one per day, endpoints inclusive
    Given the planning horizon is "2026-07-06" to "2026-07-08"
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
    Then there are 3 occurrences of "take medication"
    And an occurrence of "take medication" is placed on "2026-07-06"
    And an occurrence of "take medication" is placed on "2026-07-08"
    And the total number of placed occurrences is 3
    And every occurrence of "take medication" starts at "08:00"
    And there are no conflicts

  Scenario: Single-day horizon (start == end) — a daily intent fires exactly once
    Given the planning horizon is "2026-07-06" to "2026-07-06"
    When I add the intent:
      """
      {
        "subject": "morning walk", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "08:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "morning walk"
    And an occurrence of "morning walk" is placed on "2026-07-06"
    And the total number of placed occurrences is 1
    And there are no conflicts

  Scenario: Single-day horizon clamps a weekly day-count floor to the one available day
    Given the planning horizon is "2026-07-08" to "2026-07-08"
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "pottery"
    And an occurrence of "pottery" is placed on "2026-07-08"
    And the total number of placed occurrences is 1
    And there are no conflicts

  Scenario: Practice twice a week, starting mid-week — partial first week picks from in-horizon days only
    Given the planning horizon is "2026-07-09" to "2026-07-19"
    When I add the intent:
      """
      {
        "subject": "guitar practice", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "guitar practice"
    And an occurrence of "guitar practice" is placed on "2026-07-10"
    And an occurrence of "guitar practice" is placed on "2026-07-12"
    And an occurrence of "guitar practice" is placed on "2026-07-14"
    And an occurrence of "guitar practice" is placed on "2026-07-18"
    And no occurrence of "guitar practice" is placed on "2026-07-09"
    And no occurrence of "guitar practice" is placed on "2026-07-11"
    And the total number of placed occurrences is 4
    And there are no conflicts

  Scenario: Last partial week still meets its floor from the available days
    Given the planning horizon is "2026-07-06" to "2026-07-15"
    When I add the intent:
      """
      {
        "subject": "swim", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "swim"
    And an occurrence of "swim" is placed on "2026-07-07"
    And an occurrence of "swim" is placed on "2026-07-11"
    And an occurrence of "swim" is placed on "2026-07-13"
    And an occurrence of "swim" is placed on "2026-07-15"
    And no occurrence of "swim" is placed on "2026-07-14"
    And the total number of placed occurrences is 4
    And there are no conflicts

  Scenario: Explicit dates straddling the horizon edges — only the in-horizon ones are placed
    When I add the intent:
      """
      {
        "subject": "dentist", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-01", "2026-07-08", "2026-07-12", "2026-07-20"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "dentist"
    And occurrences of "dentist" fall on dates "2026-07-08,2026-07-12"
    And an occurrence of "dentist" is placed on "2026-07-12"
    And the total number of placed occurrences is 2
    And there are no conflicts

  Scenario: Explicit dates entirely outside the horizon — nothing is placed
    When I add the intent:
      """
      {
        "subject": "reunion", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-01", "2026-07-20"] } }
      }
      """
    And I solve
    Then there are no occurrences of "reunion"
    And the total number of placed occurrences is 0
    And there are no conflicts

  Scenario: Weekly recurrence does not spill past the horizon end
    Given the planning horizon is "2026-07-06" to "2026-07-15"
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "09:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "weekdays": ["MO", "TH"] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "team standup"
    And an occurrence of "team standup" is placed on "2026-07-06"
    And an occurrence of "team standup" is placed on "2026-07-09"
    And an occurrence of "team standup" is placed on "2026-07-13"
    And no occurrence of "team standup" is placed on "2026-07-16"
    And the total number of placed occurrences is 3
    And there are no conflicts

  Scenario: Daily recurrence stops at the last day, nothing the day after
    Given the planning horizon is "2026-07-06" to "2026-07-10"
    When I add the intent:
      """
      {
        "subject": "journal", "mode": "default", "priority": 50,
        "duration": [15, 15],
        "window": { "starts_at": "20:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 5 occurrences of "journal"
    And an occurrence of "journal" is placed on "2026-07-06"
    And an occurrence of "journal" is placed on "2026-07-10"
    And no occurrence of "journal" is placed on "2026-07-11"
    And the total number of placed occurrences is 5
    And there are no conflicts

  Scenario: Partial month bucket draws its floor from only the in-horizon days
    When I add the intent:
      """
      {
        "subject": "museum visit", "mode": "default", "priority": 50,
        "duration": [90, 90],
        "window": { "not_before": "10:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "month", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "museum visit"
    And an occurrence of "museum visit" is placed on "2026-07-07"
    And an occurrence of "museum visit" is placed on "2026-07-09"
    And an occurrence of "museum visit" is placed on "2026-07-11"
    And the total number of placed occurrences is 3
    And there are no conflicts
