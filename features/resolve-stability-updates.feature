Feature: Re-solve stability and the create/update/delete/unchanged diff
  Intents are the source of truth; instances are derived and carry a stable UID
  keyed to (intentId + bucketKey + perDayIndex), never to a clock time. Re-solving
  therefore updates events in place: a slot whose new placement equals the prior
  one is "unchanged"; the same UID at a different time or subject is an "update";
  a previously derived UID the new solve no longer produces is a "delete"; a UID
  with no prior derived event is a "create". These scenarios pin down that diff
  from every angle — stable no-ops, moved slots, retimed windows, renamed
  subjects, cancelled and shortened recurrences, brand-new intents, and mixes —
  using daily, per-day-stacked, mode-quota and weekly cardinalities whose UIDs and
  placements are computed from the deterministic contract.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-08"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Re-solving an unchanged daily walk is a no-op — every slot is unchanged
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I re-solve
    Then there are 3 occurrences of "walk"
    And there are 3 "unchanged" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And the update for uid "walk|day:2026-07-06|0" is "unchanged"
    And the update for uid "walk|day:2026-07-07|0" is "unchanged"
    And the update for uid "walk|day:2026-07-08|0" is "unchanged"
    And there are no conflicts

  Scenario: A draft with one slot drafted an hour early re-solves to a single update
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "08:00" to "09:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I re-solve
    Then the update for uid "walk|day:2026-07-07|0" is "update"
    And the update for uid "walk|day:2026-07-06|0" is "unchanged"
    And the update for uid "walk|day:2026-07-08|0" is "unchanged"
    And there are 1 "update" updates
    And there are 2 "unchanged" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And the occurrence of "walk" on "2026-07-07" runs from "09:00" to "10:00"

  Scenario: Pushing the walk window later moves every slot — all three become updates
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "10:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I re-solve
    Then there are 3 "update" updates
    And there are 0 "unchanged" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And the update for uid "walk|day:2026-07-06|0" is "update"
    And the occurrence of "walk" on "2026-07-06" runs from "10:00" to "11:00"

  Scenario: Renaming the subject keeps the UID and time but counts as an update
    Given a previously derived instance "stroll" with uid "walk|day:2026-07-06|0" for intent "walk" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I re-solve
    Then the update for uid "walk|day:2026-07-06|0" is "update"
    And the update for uid "walk|day:2026-07-07|0" is "unchanged"
    And the update for uid "walk|day:2026-07-08|0" is "unchanged"
    And there are 1 "update" updates
    And there are 2 "unchanged" updates
    And there are no conflicts

  Scenario: Cancelling the walk intent deletes every previously derived slot
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I solve
    Then there are no occurrences of "walk"
    And there are 3 "delete" updates
    And there are 0 "unchanged" updates
    And there are 0 "create" updates
    And the update for uid "walk|day:2026-07-07|0" is "delete"

  Scenario: Capping the recurrence with total.max deletes the tail UID
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] }, "total": [null, 2] }
      }
      """
    And I re-solve
    Then there are 2 occurrences of "walk"
    And the update for uid "walk|day:2026-07-06|0" is "unchanged"
    And the update for uid "walk|day:2026-07-07|0" is "unchanged"
    And the update for uid "walk|day:2026-07-08|0" is "delete"
    And there are 1 "delete" updates
    And there are 2 "unchanged" updates
    And there are 0 "create" updates

  Scenario: A brand-new daily intent with no prior calendar is all creates
    When I add the intent:
      """
      {
        "subject": "walk", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "walk"
    And there are 3 "create" updates
    And there are 0 "unchanged" updates
    And there are 0 "delete" updates
    And the update for uid "walk|day:2026-07-06|0" is "create"

  Scenario: One edit, three diff kinds — keep the walks, add swims, drop a stale jog
    Given a previously derived instance for intent "walk" with uid "walk|day:2026-07-06|0" on "2026-07-06" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-07|0" on "2026-07-07" from "09:00" to "10:00"
    And a previously derived instance for intent "walk" with uid "walk|day:2026-07-08|0" on "2026-07-08" from "09:00" to "10:00"
    And a previously derived instance for intent "jog" with uid "jog|day:2026-07-06|0" on "2026-07-06" from "07:00" to "07:30"
    When I add the intents:
      """
      [
        {
          "subject": "walk", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "19:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
        },
        {
          "subject": "swim", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "08:00", "not_after": "20:00" },
          "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [2, 2] } }
        }
      ]
      """
    And I re-solve
    Then the total number of placed occurrences is 9
    And there are 3 "unchanged" updates
    And there are 6 "create" updates
    And there is a "delete" update
    And the update for uid "jog|day:2026-07-06|0" is "delete"
    And the update for uid "swim|day:2026-07-06|0" is "create"
    And the update for uid "walk|day:2026-07-06|0" is "unchanged"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Re-solving stacked per-day swims is stable across both bands
    Given a previously derived instance for intent "swim" with uid "swim|day:2026-07-06|0" on "2026-07-06" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-06|1" on "2026-07-06" from "13:30" to "14:30"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-07|0" on "2026-07-07" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-07|1" on "2026-07-07" from "13:30" to "14:30"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-08|0" on "2026-07-08" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-08|1" on "2026-07-08" from "13:30" to "14:30"
    When I add the intent:
      """
      {
        "subject": "swim", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [2, 2] } }
      }
      """
    And I re-solve
    Then there are 6 occurrences of "swim"
    And there are 6 "unchanged" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And the update for uid "swim|day:2026-07-06|1" is "unchanged"

  Scenario: Only the moved afternoon swim band re-solves to an update
    Given a previously derived instance for intent "swim" with uid "swim|day:2026-07-06|0" on "2026-07-06" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-06|1" on "2026-07-06" from "13:30" to "14:30"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-07|0" on "2026-07-07" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-07|1" on "2026-07-07" from "14:00" to "15:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-08|0" on "2026-07-08" from "08:00" to "09:00"
    And a previously derived instance for intent "swim" with uid "swim|day:2026-07-08|1" on "2026-07-08" from "13:30" to "14:30"
    When I add the intent:
      """
      {
        "subject": "swim", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [2, 2] } }
      }
      """
    And I re-solve
    Then the update for uid "swim|day:2026-07-07|1" is "update"
    And the update for uid "swim|day:2026-07-07|0" is "unchanged"
    And there are 1 "update" updates
    And there are 5 "unchanged" updates
    And there are 0 "delete" updates

  Scenario: A mode-quota's span-keyed slots re-solve unchanged during vacation
    Given a mode "vacation" spanning "2026-07-06" to "2026-07-08"
    And a previously derived instance for intent "cocktail" with uid "cocktail|span|0" on "2026-07-06" from "11:00" to "12:00"
    And a previously derived instance for intent "cocktail" with uid "cocktail|span|1" on "2026-07-08" from "11:00" to "12:00"
    When I add the intent:
      """
      {
        "subject": "cocktail", "mode": "vacation", "priority": 40,
        "duration": [60, 60],
        "window": { "not_before": "11:00", "not_after": "13:00" },
        "cardinality": { "period": { "unit": "mode" }, "total": [2, null] }
      }
      """
    And I re-solve
    Then there are 2 occurrences of "cocktail"
    And the update for uid "cocktail|span|0" is "unchanged"
    And the update for uid "cocktail|span|1" is "unchanged"
    And there are 2 "unchanged" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And there are no conflicts

  Scenario: A weekly single-day slot keeps its week-keyed UID when its time changes
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And a previously derived instance for intent "yoga" with uid "yoga|week:2026-W28|0" on "2026-07-09" from "08:00" to "09:00"
    When I add the intent:
      """
      {
        "subject": "yoga", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "19:00" },
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [1, 1] } }
      }
      """
    And I re-solve
    Then there is 1 occurrence of "yoga"
    And an occurrence of "yoga" is placed on "2026-07-09"
    And the update for uid "yoga|week:2026-W28|0" is "update"
    And there are 1 "update" updates
    And there are 0 "create" updates
    And there are 0 "delete" updates
    And the occurrence of "yoga" on "2026-07-09" runs from "09:00" to "10:00"
