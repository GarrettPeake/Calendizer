Feature: Mode overlaps and boundary semantics
  Modes describe non-overlapping spans during which a different set of intents
  applies. Two modes whose spans overlap must raise a "mode-overlap" conflict
  naming both modes, while modes that merely sit on consecutive days are fine.
  Overlap is reported even though the solver still places every intent, and a
  mode span is inclusive of both its first and last day.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-31"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes

  Scenario: Booking a vacation on top of a work crunch flags the clash
    Given a mode "family vacation" spanning "2026-07-06" to "2026-07-14"
    And a mode "work crunch" spanning "2026-07-10" to "2026-07-20"
    When I solve
    Then there are 1 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "family vacation" and "work crunch"

  Scenario: A sprint and a recovery week on consecutive days do not overlap
    Given a mode "sprint" spanning "2026-07-06" to "2026-07-12"
    And a mode "recovery" spanning "2026-07-13" to "2026-07-18"
    When I solve
    Then there are no conflicts

  Scenario: Two phases that share a single handover day still overlap
    Given a mode "phase one" spanning "2026-07-06" to "2026-07-12"
    And a mode "phase two" spanning "2026-07-12" to "2026-07-18"
    When I solve
    Then there are 1 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "phase one" and "phase two"

  Scenario: A short mode nested entirely inside a longer one clashes
    Given a mode "semester" spanning "2026-07-06" to "2026-07-28"
    And a mode "midterms" spanning "2026-07-12" to "2026-07-16"
    When I solve
    Then there are 1 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "semester" and "midterms"

  Scenario: Three modes where only one pair collides
    Given a mode "work" spanning "2026-07-06" to "2026-07-10"
    And a mode "vacation" spanning "2026-07-11" to "2026-07-15"
    And a mode "conference" spanning "2026-07-13" to "2026-07-18"
    When I solve
    Then there are 1 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "vacation" and "conference"

  Scenario: A clean chain of three back-to-back modes raises nothing
    Given a mode "prep" spanning "2026-07-06" to "2026-07-10"
    And a mode "event" spanning "2026-07-11" to "2026-07-15"
    And a mode "wrap up" spanning "2026-07-16" to "2026-07-20"
    When I solve
    Then there are no conflicts

  Scenario: Three mutually overlapping modes produce one conflict per pair
    Given a mode "alpha" spanning "2026-07-06" to "2026-07-20"
    And a mode "beta" spanning "2026-07-08" to "2026-07-22"
    And a mode "gamma" spanning "2026-07-10" to "2026-07-24"
    When I solve
    Then there are 3 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "alpha" and "beta"
    And there is a conflict involving "alpha" and "gamma"
    And there is a conflict involving "beta" and "gamma"

  Scenario: A mode-scoped routine lands on both the first and last day of the span
    Given a mode "retreat" spanning "2026-07-06" to "2026-07-12"
    When I add the intent:
      """
      {
        "subject": "daily check-in", "mode": "retreat", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "daily check-in"
    And an occurrence of "daily check-in" is placed on "2026-07-06"
    And an occurrence of "daily check-in" is placed on "2026-07-12"
    And no occurrence of "daily check-in" is placed on "2026-07-13"
    And there are no conflicts

  Scenario: Overlapping modes still place every intent that was asked for
    Given a mode "alpha" spanning "2026-07-06" to "2026-07-14"
    And a mode "beta" spanning "2026-07-10" to "2026-07-18"
    When I add the intents:
      """
      [
        {
          "subject": "sunrise paddle", "mode": "alpha", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } }
        },
        {
          "subject": "evening sail", "mode": "beta", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "15:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-16"] } }
        }
      ]
      """
    And I solve
    Then there is a conflict of kind "mode-overlap"
    And there is a conflict involving "alpha" and "beta"
    And there is 1 occurrence of "sunrise paddle"
    And an occurrence of "sunrise paddle" is placed on "2026-07-07"
    And there is 1 occurrence of "evening sail"
    And an occurrence of "evening sail" is placed on "2026-07-16"

  Scenario: Two modes booked over the exact same span collide
    Given a mode "trip a" spanning "2026-07-06" to "2026-07-12"
    And a mode "trip b" spanning "2026-07-06" to "2026-07-12"
    When I solve
    Then there are 1 conflicts
    And there is a conflict of kind "mode-overlap"
    And there is a conflict involving "trip a" and "trip b"
