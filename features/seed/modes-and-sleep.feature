Feature: Modes and sleep-yielding
  Validates mode suppression and the yielding sleep blackout.

  Background:
    Given the planning horizon is "2026-07-04" to "2026-07-13"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes

  Scenario: Mai Tais only during the vacation mode
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
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
    And every occurrence of "Mai Tai at the beach" starts at or after "11:00"
    And every occurrence of "Mai Tai at the beach" ends at or before "13:00"

  Scenario: Default intents are suppressed during a mode
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "team standup", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "starts_at": "09:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then no occurrence of "team standup" is placed on "2026-07-08"
    And an occurrence of "team standup" is placed on "2026-07-04"

  Scenario: Fishing at 3am — sleep yields silently
    When I add the intent:
      """
      {
        "subject": "fishing", "mode": "default", "priority": 50,
        "duration": [240, 240],
        "window": { "starts_at": "03:00" },
        "cardinality": { "days": { "dates": ["2026-07-11"] } }
      }
      """
    And I solve
    Then the occurrence of "fishing" on "2026-07-11" starts at "03:00"
    And the occurrence of "fishing" on "2026-07-11" is placed during sleep
    And there are no conflicts
