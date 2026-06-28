Feature: The solver always places, overlapping and reporting when forced
  The deterministic solver never returns "infeasible". When hard constraints are
  in tension it still places every occurrence and attaches a conflict report
  naming the constraints involved. These scenarios exercise the two
  placement-level conflict kinds — "window-unsatisfiable" (a window too small for
  the duration floor) and "overlap" (events forced onto the same time) — and
  prove the placement count is never reduced by a conflict: the solver overlaps
  rather than dropping. Positive controls confirm a clean schedule has none.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Pottery three times this week fits comfortably — no conflicts
    When I add the intent:
      """
      {
        "subject": "pottery", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "pottery"
    And every occurrence of "pottery" starts at or after "09:00"
    And every occurrence of "pottery" ends at or before "19:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A 60-minute block crammed into a 30-minute window — window-unsatisfiable, still placed
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "09:30" },
        "cardinality": { "days": { "dates": ["2026-07-07"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "deep work"
    And the total number of placed occurrences is 1
    And there is a conflict
    And there is a conflict of kind "window-unsatisfiable"
    And there is a conflict involving "deep work"
    And an occurrence of "deep work" is placed on "2026-07-07"

  Scenario: A daily standup whose 15-minute window can never hold its 30-minute floor
    When I add the intent:
      """
      {
        "subject": "micro standup", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "09:15" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "micro standup"
    And the total number of placed occurrences is 7
    And there are 7 conflicts
    And there is a conflict of kind "window-unsatisfiable"
    And there is a conflict involving "micro standup"

  Scenario: Three back-to-back meetings all pinned to 9am — forced overlap, none dropped
    When I add the intents:
      """
      [
        {
          "subject": "budget review", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "client call", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        },
        {
          "subject": "design review", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } }
        }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 3
    And there is 1 occurrence of "budget review"
    And there is 1 occurrence of "client call"
    And there is 1 occurrence of "design review"
    And there are 2 conflicts
    And there is a conflict of kind "overlap"
    And there is a conflict involving "client call" and "budget review"
    And there is a conflict involving "design review" and "client call"

  Scenario: Two classes pinned to the same 10am slot — exactly one overlap conflict
    When I add the intents:
      """
      [
        {
          "subject": "yoga", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "starts_at": "10:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } }
        },
        {
          "subject": "pilates", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "starts_at": "10:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } }
        }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 2
    And there is 1 occurrence of "yoga"
    And there is 1 occurrence of "pilates"
    And there is a conflict
    And there is a conflict of kind "overlap"
    And there is a conflict involving "yoga" and "pilates"

  Scenario: Three interviews squeezed into a one-hour window — all placed, overlapping
    When I add the intent:
      """
      {
        "subject": "interview", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "10:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] }, "per_day": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "interview"
    And the total number of placed occurrences is 3
    And there are 2 conflicts
    And there is a conflict of kind "overlap"
    And there is a conflict involving "interview"

  Scenario: A focus block pinned over an immovable standup — overlaps the fixed event
    Given an existing fixed event "Standup" on "2026-07-06" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "deep focus", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "starts_at": "09:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "deep focus"
    And the total number of placed occurrences is 1
    And there is a conflict
    And there is a conflict of kind "overlap"
    And there is a conflict involving "deep focus" and "Standup"

  Scenario: A flexible block routes around the fixed standup when there is room — no conflict
    Given an existing fixed event "Standup" on "2026-07-06" from "09:00" to "09:30"
    When I add the intent:
      """
      {
        "subject": "writing", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "writing"
    And the occurrence of "writing" on "2026-07-06" starts at "09:30"
    And no occurrence overlaps the fixed event "Standup"
    And there are no conflicts

  Scenario: Vitamins and lunch pinned to different times — both placed, no conflicts
    When I add the intents:
      """
      [
        {
          "subject": "vitamins", "mode": "default", "priority": 50,
          "duration": [1, 1],
          "window": { "starts_at": "08:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        },
        {
          "subject": "lunch", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 2
    And the occurrence of "vitamins" on "2026-07-07" starts at "08:00"
    And the occurrence of "lunch" on "2026-07-07" starts at "12:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Both conflict kinds in one solve — a too-small window and a pinned collision
    When I add the intents:
      """
      [
        {
          "subject": "crammed call", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "14:00", "not_after": "14:30" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } }
        },
        {
          "subject": "team retro", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "16:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } }
        },
        {
          "subject": "team sync", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "starts_at": "16:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } }
        }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 3
    And there are 2 conflicts
    And there is a conflict of kind "window-unsatisfiable"
    And there is a conflict of kind "overlap"
    And there is a conflict involving "crammed call"
    And there is a conflict involving "team sync" and "team retro"
