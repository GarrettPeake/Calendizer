Feature: Aspiration occurrences are revived when coordination frees a slot
  fillToMax extras above the floor are placed only into clean slots. Greedy
  decides that at seed time against whatever already sits there — if a movable
  neighbour happens to occupy the only slot, the extra is dropped forever. The
  default solver co-ordinates: the neighbour shifts inside its own window and
  the aspiration lands cleanly. Extras must still NEVER force an overlap.
  (The first scenario places one fewer "walk" under @greedy.)

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-07"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes
    And fill toward max is enabled

  Scenario: A morning call slides later so the walk's day-extra fits
    When I add the intents:
      """
      [
        { "subject": "call", "mode": "default", "priority": 90,
          "duration": [30, 30],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "walk", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "10:00" },
          "cardinality": { "period": { "unit": "week" }, "days": { "count": [1, 2] } } }
      ]
      """
    And I solve
    Then there are 2 occurrences of "walk"
    And an occurrence of "walk" is placed on "2026-07-06"
    And an occurrence of "walk" is placed on "2026-07-07"
    And there is 1 occurrence of "call"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: An extra that fits nowhere clean stays dropped — never forced
    Given an existing fixed event "Course" on "2026-07-06" from "09:00" to "10:00"
    When I add the intent:
      """
      { "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "10:00" },
        "cardinality": { "period": { "unit": "week" }, "days": { "count": [1, 2] } } }
      """
    And I solve
    Then there is 1 occurrence of "walk"
    And an occurrence of "walk" is placed on "2026-07-07"
    And no occurrence overlaps the fixed event "Course"
    And there are no conflicts
