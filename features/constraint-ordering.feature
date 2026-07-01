Feature: Most-constrained-first placement (window slack)
  When two occurrences of equal priority contend for the same time, the one with
  the tighter window (less room per occurrence) is placed first, so a neighbour
  that could sit anywhere routes around it instead of squatting the one slot it
  needs. Slack = resolved window width / duration floor; smaller wins.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "08:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: A narrow-window task wins its slot over an equal-priority open-window neighbour
    # "park" can only sit in 11:30-14:00; "game" (a fixed 3h block) may sit anywhere
    # from 11:00 on. Naively "game" grabs 11:00-14:00 and forces "park" to overlap.
    # Placing the tighter "park" first lets "game" slide to right after it.
    Given fill toward max is enabled
    When I add the intents:
      """
      [
        {
          "subject": "park", "mode": "default", "priority": 45,
          "duration": [45, 75],
          "window": { "not_before": "11:30", "not_after": "14:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        },
        {
          "subject": "game", "mode": "default", "priority": 45,
          "duration": [180, 180],
          "window": { "not_before": "11:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        }
      ]
      """
    And I solve
    Then the occurrence of "park" on "2026-07-07" runs from "11:30" to "12:45"
    And the occurrence of "game" on "2026-07-07" runs from "12:45" to "15:45"
    And no two occurrences overlap
    And there are no conflicts
