Feature: Coordinated chain moves resolve overlaps single moves cannot
  The legacy greedy engine repairs overlaps one occurrence at a time: a move is
  taken only when it reduces that occurrence's own overlap, and occurrences that
  are not overlapping anything are never touched. When resolving a collision
  requires a CHAIN (shift a clean neighbour to free the only legal slot), greedy
  is stuck and reports a conflict. The default solver must find the chain.
  (These scenarios fail under @greedy — that gap is exactly what they pin down.)

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Three one-offs needing the chain C at 9, A at 10, B at 11
    When I add the intents:
      """
      [
        { "subject": "design review", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "11:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "inbox sweep", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "standup prep", "mode": "default", "priority": 40,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "10:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "standup prep" on "2026-07-07" runs from "09:00" to "10:00"
    And the occurrence of "design review" on "2026-07-07" runs from "10:00" to "11:00"
    And the occurrence of "inbox sweep" on "2026-07-07" runs from "11:00" to "12:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: The chain also routes around a fixed event
    Given an existing fixed event "All hands" on "2026-07-07" from "11:00" to "12:00"
    When I add the intents:
      """
      [
        { "subject": "deep dive", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "11:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "budget pass", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "13:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "one-on-one", "mode": "default", "priority": 40,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "10:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "one-on-one" on "2026-07-07" runs from "09:00" to "10:00"
    And the occurrence of "deep dive" on "2026-07-07" runs from "10:00" to "11:00"
    And the occurrence of "budget pass" on "2026-07-07" runs from "12:00" to "13:00"
    And no occurrence overlaps the fixed event "All hands"
    And no two occurrences overlap
    And there are no conflicts
