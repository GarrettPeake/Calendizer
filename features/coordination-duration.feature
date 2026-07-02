Feature: Duration growth never needlessly shortens or collides (fillToMax)
  The "needless shrink" bug class: greedy hands the growth slack out in priority
  order and then re-packs, which can strand a narrow-window neighbour — in the
  worst case leaving it OVERLAPPED by the grown event. The default solver
  chooses the order and the sizes together: everything fits, and the total
  scheduled time is maximal for the window capacity.
  (The first scenario leaves a conflict under @greedy.)

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes
    And fill toward max is enabled

  Scenario: A narrow-window task yields its early slot so both fill cleanly
    When I add the intents:
      """
      [
        { "subject": "writing", "mode": "default", "priority": 60,
          "duration": [60, 120],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "errands", "mode": "default", "priority": 50,
          "duration": [60, 120],
          "window": { "not_before": "09:00", "not_after": "11:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "errands" on "2026-07-07" runs from "09:00" to "10:00"
    And the occurrence of "writing" on "2026-07-07" runs from "10:00" to "12:00"
    And every occurrence of "writing" lasts 120 minutes
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Growth fills the whole window across three flexible tasks
    When I add the intents:
      """
      [
        { "subject": "study", "mode": "default", "priority": 70,
          "duration": [30, 120],
          "window": { "not_before": "13:00", "not_after": "17:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } },
        { "subject": "practice", "mode": "default", "priority": 60,
          "duration": [30, 120],
          "window": { "not_before": "13:00", "not_after": "17:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } },
        { "subject": "chores", "mode": "default", "priority": 50,
          "duration": [30, 60],
          "window": { "not_before": "13:00", "not_after": "17:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } }
      ]
      """
    And I solve
    Then every occurrence of "study" lasts 120 minutes
    And every occurrence of "practice" lasts between 90 and 120 minutes
    And no two occurrences overlap
    And there are no conflicts
