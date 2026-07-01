Feature: Pinning an occurrence's END (ends_at)
  ends_at fixes the END of an occurrence (start = end − duration), the mirror of
  starts_at. It lets a flexible-duration routine butt up against a marker like
  bedtime: at its floor it ends exactly at the pin; with "fill toward max" it grows
  its duration BACKWARD from the pin, up to the max, bounded by earlier obstacles
  and the morning blackout.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: A routine pinned to bedtime ends exactly there at its floor
    When I add the intent:
      """
      {
        "subject": "wind down", "mode": "default", "priority": 50,
        "duration": [30, 60],
        "window": { "ends_at": { "marker": "sleep" } },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "wind down" on "2026-07-07" runs from "22:30" to "23:00"
    And every occurrence of "wind down" lasts 30 minutes
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: With fill toward max the routine grows backward to butt up against bedtime
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "wind down", "mode": "default", "priority": 50,
        "duration": [30, 60],
        "window": { "ends_at": { "marker": "sleep" } },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "wind down" on "2026-07-07" runs from "22:00" to "23:00"
    And every occurrence of "wind down" lasts 60 minutes
    And there are no conflicts

  Scenario: A bedtime-pinned routine grows back only to a preceding obstacle
    Given fill toward max is enabled
    And an existing fixed event "call" on "2026-07-07" from "22:15" to "22:30"
    When I add the intent:
      """
      {
        "subject": "wind down", "mode": "default", "priority": 50,
        "duration": [30, 60],
        "window": { "ends_at": { "marker": "sleep" } },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "wind down" on "2026-07-07" runs from "22:30" to "23:00"
    And no occurrence overlaps the fixed event "call"
    And there are no conflicts

  Scenario: A clock-time end pin ends exactly at the clock
    When I add the intent:
      """
      {
        "subject": "review", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "ends_at": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then the occurrence of "review" on "2026-07-07" runs from "16:15" to "17:00"
    And there are no conflicts
