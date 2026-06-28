Feature: Even-spread day-count selection (load balancing)
  "3 days a week" must not collapse onto Mon-Tue-Wed. When an intent asks for a
  flexible count of days per period, the solver places the guaranteed FLOOR and
  picks the days with the deterministic even-spread rule
  index = clamp(round((i + 0.5) * n / k - 0.5)), de-duplicated and chronological.
  All expected dates below are computed from DSL.md section 2 over ISO weeks.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 10 minutes

  Scenario: Guitar practice 3x this week spreads to Tue, Thu, Sat
    When I add the intent:
      """
      {
        "subject": "guitar practice", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "guitar practice"
    And occurrences of "guitar practice" fall on dates "2026-07-07,2026-07-09,2026-07-11"
    And every occurrence of "guitar practice" falls on a weekday in "TU,TH,SA"
    And every occurrence of "guitar practice" starts at "09:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Swimming twice a week lands on Tue and Sat
    When I add the intent:
      """
      {
        "subject": "swimming", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "swimming"
    And occurrences of "swimming" fall on dates "2026-07-07,2026-07-11"
    And every occurrence of "swimming" falls on a weekday in "TU,SA"
    And there are no conflicts

  Scenario: A single weekly therapy session settles mid-week on Thursday
    When I add the intent:
      """
      {
        "subject": "therapy", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "therapy"
    And occurrences of "therapy" fall on dates "2026-07-09"
    And an occurrence of "therapy" is placed on "2026-07-09"
    And there are no conflicts

  Scenario: Four runs a week distribute to Mon, Wed, Fri, Sun
    When I add the intent:
      """
      {
        "subject": "running", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [4, 4] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "running"
    And occurrences of "running" fall on dates "2026-07-06,2026-07-08,2026-07-10,2026-07-12"
    And every occurrence of "running" falls on a weekday in "MO,WE,FR,SU"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Five study sessions a week spread to Mon, Wed, Thu, Fri, Sun
    When I add the intent:
      """
      {
        "subject": "study", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [5, 5] } }
      }
      """
    And I solve
    Then there are 5 occurrences of "study"
    And occurrences of "study" fall on dates "2026-07-06,2026-07-08,2026-07-09,2026-07-10,2026-07-12"
    And every occurrence of "study" falls on a weekday in "MO,WE,TH,FR,SU"
    And there are no conflicts

  Scenario: A 3-4 times a week range places the floor of 3, still spread
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 4] } }
      }
      """
    And I solve
    Then "pottery" has between 3 and 4 occurrences
    And there are 3 occurrences of "pottery"
    And occurrences of "pottery" fall on dates "2026-07-07,2026-07-09,2026-07-11"
    And there are no conflicts

  Scenario: With only weekdays available, two sessions land on Tue and Thu
    Given the planning horizon is "2026-07-06" to "2026-07-10"
    When I add the intent:
      """
      {
        "subject": "spanish lesson", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "spanish lesson"
    And occurrences of "spanish lesson" fall on dates "2026-07-07,2026-07-09"
    And every occurrence of "spanish lesson" falls on a weekday in "TU,TH"
    And no occurrence of "spanish lesson" is placed on "2026-07-11"
    And there are no conflicts

  Scenario: Over two weeks the Tue-Thu-Sat pattern repeats every ISO week
    Given the planning horizon is "2026-07-06" to "2026-07-19"
    When I add the intent:
      """
      {
        "subject": "yoga", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "yoga"
    And occurrences of "yoga" fall on dates "2026-07-07,2026-07-09,2026-07-11,2026-07-14,2026-07-16,2026-07-18"
    And every occurrence of "yoga" falls on a weekday in "TU,TH,SA"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Over three weeks twice-a-week repeats as Tue and Sat each week
    Given the planning horizon is "2026-07-06" to "2026-07-26"
    When I add the intent:
      """
      {
        "subject": "climbing", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 6 occurrences of "climbing"
    And occurrences of "climbing" fall on dates "2026-07-07,2026-07-11,2026-07-14,2026-07-18,2026-07-21,2026-07-25"
    And every occurrence of "climbing" falls on a weekday in "TU,SA"
    And there are no conflicts

  Scenario: A partial week starting Wednesday spreads three days over the days available
    Given the planning horizon is "2026-07-08" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "painting", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "painting"
    And occurrences of "painting" fall on dates "2026-07-08,2026-07-10,2026-07-12"
    And every occurrence of "painting" falls on a weekday in "WE,FR,SU"
    And no occurrence of "painting" is placed on "2026-07-09"
    And there are no conflicts

  Scenario: A partial week starting Wednesday spreads two days to Thu and Sat
    Given the planning horizon is "2026-07-08" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "baking", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "baking"
    And occurrences of "baking" fall on dates "2026-07-09,2026-07-11"
    And every occurrence of "baking" falls on a weekday in "TH,SA"
    And there are no conflicts
