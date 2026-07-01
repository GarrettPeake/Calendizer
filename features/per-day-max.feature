Feature: Filling per-day counts toward their max (fillToMax)
  By default the solver stacks exactly the guaranteed floor (per_day.count[0]) of
  occurrences on each chosen day. With "fill toward max" enabled it also adds the
  aspiration stacks up to per_day.count[1] — but only where a clean, non-overlapping
  slot exists in the day. The floor is always guaranteed; extras never overlap and
  never raise a conflict.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Default (floor only) — a 1–3/day range stacks exactly 1
    When I add the intent:
      """
      {
        "subject": "study", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "22:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] }, "per_day": { "count": [1, 3] } }
      }
      """
    And I solve
    Then there are 1 occurrences of "study"
    And there are no conflicts

  Scenario: Enabled on an open day — fills all the way to 3
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "study", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "22:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] }, "per_day": { "count": [1, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "study" on "2026-07-07"
    And no two occurrences of "study" overlap
    And every occurrence of "study" starts at or after "09:00"
    And every occurrence of "study" ends at or before "22:00"
    And there are no conflicts

  Scenario: Enabled but the day only fits the floor — no extras, no conflicts
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "study", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "07:00", "not_after": "08:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] }, "per_day": { "count": [1, 3] } }
      }
      """
    And I solve
    Then there are 1 occurrences of "study"
    And there are no conflicts

  Scenario: A fixed per-day count (min == max) gets no extras
    Given fill toward max is enabled
    When I add the intent:
      """
      {
        "subject": "meds", "mode": "default", "priority": 50,
        "duration": [15, 15],
        "window": { "not_before": "09:00", "not_after": "22:00" },
        "cardinality": { "days": { "dates": ["2026-07-07"] }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "meds" on "2026-07-07"
    And there are no conflicts
