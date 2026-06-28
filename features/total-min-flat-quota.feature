Feature: total.min flat quota — "at least N times during this span"
  A `total.min` with no days/per_day spec is a flat quota: exactly `min`
  occurrences are placed, spread across the available dates of the span using the
  deterministic even-spread (choose-k-of-n) rule. The floor is what you get — the
  solver never places more than `min` just because there is room. The span is the
  mode span when `period.unit` is "mode", otherwise the whole active horizon.

  Background:
    Given the planning horizon is "2026-07-01" to "2026-07-14"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And a mode "vacation" spanning "2026-07-06" to "2026-07-12"

  Scenario: Mai Tais at the beach at least twice on vacation
    When I add the intent:
      """
      {
        "subject": "Mai Tai at the beach", "mode": "vacation", "priority": 40,
        "duration": [60, 120],
        "window": { "not_before": "11:00", "not_after": "13:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
      }
      """
    And I solve
    Then there are 2 occurrences of "Mai Tai at the beach"
    And occurrences of "Mai Tai at the beach" fall on dates "2026-07-07,2026-07-11"
    And every occurrence of "Mai Tai at the beach" starts at or after "11:00"
    And every occurrence of "Mai Tai at the beach" ends at or before "13:00"
    And there are no conflicts

  Scenario: Beach yoga at least three times during the vacation span
    When I add the intent:
      """
      {
        "subject": "beach yoga", "mode": "vacation", "priority": 35,
        "duration": [45, 45],
        "window": { "not_before": "08:00", "not_after": "10:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [3, null] }
      }
      """
    And I solve
    Then there are 3 occurrences of "beach yoga"
    And occurrences of "beach yoga" fall on dates "2026-07-07,2026-07-09,2026-07-11"
    And every occurrence of "beach yoga" starts at or after "08:00"
    And every occurrence of "beach yoga" ends at or before "10:00"
    And there are no conflicts

  Scenario: Catch a sunset photo four times across the trip
    When I add the intent:
      """
      {
        "subject": "sunset photos", "mode": "vacation", "priority": 30,
        "duration": [30, 60],
        "window": { "not_before": "18:00", "not_after": "21:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [4, null] }
      }
      """
    And I solve
    Then there are 4 occurrences of "sunset photos"
    And occurrences of "sunset photos" fall on dates "2026-07-06,2026-07-08,2026-07-10,2026-07-12"
    And there are no conflicts

  Scenario: A different span length — diner stops twice on a road trip
    Given a mode "road trip" spanning "2026-07-01" to "2026-07-05"
    When I add the intent:
      """
      {
        "subject": "roadside diner", "mode": "road trip", "priority": 40,
        "duration": [60, 90],
        "window": { "not_before": "12:00", "not_after": "14:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
      }
      """
    And I solve
    Then there are 2 occurrences of "roadside diner"
    And occurrences of "roadside diner" fall on dates "2026-07-02,2026-07-04"
    And there are no conflicts

  Scenario: Three scenic hikes spread over the five-day road trip
    Given a mode "road trip" spanning "2026-07-01" to "2026-07-05"
    When I add the intent:
      """
      {
        "subject": "scenic hike", "mode": "road trip", "priority": 45,
        "duration": [120, 120],
        "window": { "not_before": "09:00", "not_after": "15:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [3, null] }
      }
      """
    And I solve
    Then there are 3 occurrences of "scenic hike"
    And occurrences of "scenic hike" fall on dates "2026-07-01,2026-07-03,2026-07-05"
    And every occurrence of "scenic hike" lasts 120 minutes
    And there are no conflicts

  Scenario: No period at all — quota spread across the whole horizon
    When I add the intent:
      """
      {
        "subject": "call a friend", "mode": "all", "priority": 20,
        "duration": [30, 30],
        "window": { "not_before": "17:00", "not_after": "20:00" },
        "cardinality": { "total": [2, null] }
      }
      """
    And I solve
    Then there are 2 occurrences of "call a friend"
    And occurrences of "call a friend" fall on dates "2026-07-04,2026-07-11"
    And there are no conflicts

  Scenario: Three whole-horizon occurrences when there is no period
    When I add the intent:
      """
      {
        "subject": "deep clean the apartment", "mode": "all", "priority": 25,
        "duration": [90, 90],
        "window": { "not_before": "10:00", "not_after": "16:00" },
        "cardinality": { "total": [3, null] }
      }
      """
    And I solve
    Then there are 3 occurrences of "deep clean the apartment"
    And occurrences of "deep clean the apartment" fall on dates "2026-07-03,2026-07-08,2026-07-12"
    And there are no conflicts

  Scenario: The window constrains the time-of-day of every quota occurrence
    When I add the intent:
      """
      {
        "subject": "morning swim", "mode": "vacation", "priority": 38,
        "duration": [30, 30],
        "window": { "not_before": "06:30", "not_after": "08:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [3, null] }
      }
      """
    And I solve
    Then there are 3 occurrences of "morning swim"
    And occurrences of "morning swim" fall on dates "2026-07-07,2026-07-09,2026-07-11"
    And every occurrence of "morning swim" starts at or after "06:30"
    And every occurrence of "morning swim" ends at or before "08:00"
    And every occurrence of "morning swim" is aligned to the grid
    And there are no conflicts

  Scenario: The count is the floor — never more than min even with room to spare
    When I add the intent:
      """
      {
        "subject": "fancy dinner out", "mode": "vacation", "priority": 60,
        "duration": [60, 60],
        "window": { "not_before": "19:00", "not_after": "22:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
      }
      """
    And I solve
    Then there are 2 occurrences of "fancy dinner out"
    And occurrences of "fancy dinner out" fall on dates "2026-07-07,2026-07-11"
    And no two occurrences of "fancy dinner out" overlap
    And there are no conflicts

  Scenario: Two flat quotas in different modes coexist without contention
    Given a mode "road trip" spanning "2026-07-01" to "2026-07-05"
    When I add the intents:
      """
      [
        {
          "subject": "souvenir shopping", "mode": "road trip", "priority": 30,
          "duration": [45, 45],
          "window": { "not_before": "10:00", "not_after": "12:00" },
          "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
        },
        {
          "subject": "spa afternoon", "mode": "vacation", "priority": 30,
          "duration": [90, 90],
          "window": { "not_before": "14:00", "not_after": "17:00" },
          "cardinality": { "period": { "unit": "mode" }, "total": [3, null] }
        }
      ]
      """
    And I solve
    Then there are 2 occurrences of "souvenir shopping"
    And occurrences of "souvenir shopping" fall on dates "2026-07-02,2026-07-04"
    And there are 3 occurrences of "spa afternoon"
    And occurrences of "spa afternoon" fall on dates "2026-07-07,2026-07-09,2026-07-11"
    And no two occurrences overlap
    And there are no conflicts
