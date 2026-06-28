Feature: Ordered children tiling
  An occurrence can be tiled by ordered children that fill the parent block
  contiguously, in declared order, with no padding between siblings. The parent
  is placed at its duration floor; fixed children take their exact minutes and
  weight children share the leftover slack proportionally (last weight child
  absorbs any remainder). These scenarios verify child order, contiguity, and
  individual child durations, combined with daily and weekday cardinality.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 10 minutes

  Scenario: Deep work — a single weight child absorbs all the slack
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00" },
        "children": [
          { "subject": "warm-up", "duration": 10 },
          { "subject": "focus", "weight": 1 }
        ],
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "deep work"
    And the occurrence of "deep work" on "2026-07-06" runs from "09:00" to "10:00"
    And the occurrence of "deep work" on "2026-07-06" has children in order "warm-up, focus"
    And the children of "deep work" on "2026-07-06" are contiguous
    And the child "warm-up" of "deep work" on "2026-07-06" lasts 10 minutes
    And the child "focus" of "deep work" on "2026-07-06" lasts 50 minutes
    And there are no conflicts

  Scenario: Workout — two fixed children bracket one weight child in the middle
    When I add the intent:
      """
      {
        "subject": "workout", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:00" },
        "children": [
          { "subject": "warmup", "duration": 10 },
          { "subject": "main set", "weight": 1 },
          { "subject": "cooldown", "duration": 5 }
        ],
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [1, 1] } }
      }
      """
    And I solve
    Then there are 7 occurrences of "workout"
    And the occurrence of "workout" on "2026-07-07" runs from "08:00" to "09:00"
    And the occurrence of "workout" on "2026-07-07" has children in order "warmup, main set, cooldown"
    And the children of "workout" on "2026-07-07" are contiguous
    And the child "warmup" of "workout" on "2026-07-07" lasts 10 minutes
    And the child "main set" of "workout" on "2026-07-07" lasts 45 minutes
    And the child "cooldown" of "workout" on "2026-07-07" lasts 5 minutes
    And there are no conflicts

  Scenario: Study block — two equal weight children split the slack in half
    When I add the intent:
      """
      {
        "subject": "study block", "mode": "default", "priority": 40,
        "duration": [60, 60],
        "window": { "not_before": "10:00" },
        "children": [
          { "subject": "reading", "weight": 1 },
          { "subject": "exercises", "weight": 1 }
        ],
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "study block"
    And the occurrence of "study block" on "2026-07-06" runs from "10:00" to "11:00"
    And the occurrence of "study block" on "2026-07-06" has children in order "reading, exercises"
    And the children of "study block" on "2026-07-06" are contiguous
    And the child "reading" of "study block" on "2026-07-06" lasts 30 minutes
    And the child "exercises" of "study block" on "2026-07-06" lasts 30 minutes
    And there are no conflicts

  Scenario: Project sprint — fixed prep plus weighted build and review split 1:3
    When I add the intent:
      """
      {
        "subject": "project sprint", "mode": "default", "priority": 60,
        "duration": [80, 80],
        "window": { "not_before": "09:00" },
        "children": [
          { "subject": "prep", "duration": 20 },
          { "subject": "build", "weight": 1 },
          { "subject": "review", "weight": 3 }
        ],
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "project sprint"
    And the occurrence of "project sprint" on "2026-07-08" runs from "09:00" to "10:20"
    And the occurrence of "project sprint" on "2026-07-08" has children in order "prep, build, review"
    And the children of "project sprint" on "2026-07-08" are contiguous
    And the child "prep" of "project sprint" on "2026-07-08" lasts 20 minutes
    And the child "build" of "project sprint" on "2026-07-08" lasts 15 minutes
    And the child "review" of "project sprint" on "2026-07-08" lasts 45 minutes
    And there are no conflicts

  Scenario: Practice session — three weight children, the last absorbs the remainder
    When I add the intent:
      """
      {
        "subject": "practice session", "mode": "default", "priority": 45,
        "duration": [100, 100],
        "window": { "not_before": "13:00" },
        "children": [
          { "subject": "scales", "weight": 1 },
          { "subject": "etudes", "weight": 1 },
          { "subject": "repertoire", "weight": 1 }
        ],
        "cardinality": { "days": { "dates": ["2026-07-09"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "practice session"
    And the occurrence of "practice session" on "2026-07-09" runs from "13:00" to "14:40"
    And the occurrence of "practice session" on "2026-07-09" has children in order "scales, etudes, repertoire"
    And the children of "practice session" on "2026-07-09" are contiguous
    And the child "scales" of "practice session" on "2026-07-09" lasts 33 minutes
    And the child "etudes" of "practice session" on "2026-07-09" lasts 33 minutes
    And the child "repertoire" of "practice session" on "2026-07-09" lasts 34 minutes
    And there are no conflicts

  Scenario: Morning routine — fixed children fill the floor exactly, weight child is empty
    When I add the intent:
      """
      {
        "subject": "morning routine", "mode": "default", "priority": 80,
        "duration": [13, 13],
        "window": { "not_before": { "marker": "wakeup" } },
        "children": [
          { "subject": "brush teeth", "duration": 3 },
          { "subject": "do hair", "weight": 1 },
          { "subject": "shower", "duration": 10 }
        ],
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","TU","WE","TH","FR","SA","SU"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 7 occurrences of "morning routine"
    And the occurrence of "morning routine" on "2026-07-06" runs from "07:00" to "07:13"
    And the occurrence of "morning routine" on "2026-07-06" has children in order "brush teeth, do hair, shower"
    And the children of "morning routine" on "2026-07-06" are contiguous
    And the child "brush teeth" of "morning routine" on "2026-07-06" lasts 3 minutes
    And the child "do hair" of "morning routine" on "2026-07-06" lasts 0 minutes
    And the child "shower" of "morning routine" on "2026-07-06" lasts 10 minutes
    And there are no conflicts

  Scenario: Gym circuit — children tiling on explicit Mon/Wed/Fri weekdays
    When I add the intent:
      """
      {
        "subject": "gym circuit", "mode": "default", "priority": 55,
        "duration": [50, 50],
        "window": { "not_before": "17:00" },
        "children": [
          { "subject": "stretch", "duration": 10 },
          { "subject": "circuit", "weight": 1 }
        ],
        "cardinality": {
          "period": { "unit": "week", "interval": 1 },
          "days": { "weekdays": ["MO","WE","FR"] },
          "per_day": { "count": [1, 1] }
        }
      }
      """
    And I solve
    Then there are 3 occurrences of "gym circuit"
    And an occurrence of "gym circuit" is placed on "2026-07-06"
    And an occurrence of "gym circuit" is placed on "2026-07-08"
    And an occurrence of "gym circuit" is placed on "2026-07-10"
    And every occurrence of "gym circuit" falls on a weekday in "MO,WE,FR"
    And the occurrence of "gym circuit" on "2026-07-10" has children in order "stretch, circuit"
    And the children of "gym circuit" on "2026-07-10" are contiguous
    And the child "stretch" of "gym circuit" on "2026-07-10" lasts 10 minutes
    And the child "circuit" of "gym circuit" on "2026-07-10" lasts 40 minutes
    And there are no conflicts

  Scenario: Language practice — weekly day-count of 3 with weighted children split 2:1
    When I add the intent:
      """
      {
        "subject": "language practice", "mode": "default", "priority": 35,
        "duration": [45, 45],
        "window": { "not_before": "12:00", "not_after": "20:00" },
        "children": [
          { "subject": "vocab", "weight": 2 },
          { "subject": "grammar", "weight": 1 }
        ],
        "cardinality": { "period": { "unit": "week", "interval": 1 }, "days": { "count": [3, 3] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "language practice"
    And every occurrence of "language practice" falls on a weekday in "TU,TH,SA"
    And the occurrence of "language practice" on "2026-07-07" has children in order "vocab, grammar"
    And the children of "language practice" on "2026-07-07" are contiguous
    And the child "vocab" of "language practice" on "2026-07-07" lasts 30 minutes
    And the child "grammar" of "language practice" on "2026-07-07" lasts 15 minutes
    And there are no conflicts

  Scenario: Stretch routine — two tiled occurrences per day never overlap
    When I add the intent:
      """
      {
        "subject": "stretch routine", "mode": "default", "priority": 30,
        "duration": [20, 20],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "children": [
          { "subject": "neck", "duration": 5 },
          { "subject": "flow", "weight": 1 },
          { "subject": "breathe", "duration": 5 }
        ],
        "cardinality": { "period": { "unit": "day", "interval": 1 }, "per_day": { "count": [2, 2] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "stretch routine" on "2026-07-06"
    And every occurrence of "stretch routine" lasts 20 minutes
    And every occurrence of "stretch routine" starts at or after "08:00"
    And every occurrence of "stretch routine" ends at or before "20:00"
    And no two occurrences of "stretch routine" overlap
    And there are no conflicts

  Scenario: Evening routine routes around a fixed meeting but still tiles cleanly
    Given an existing fixed event "Standup" on "2026-07-06" from "09:00" to "09:30"
    When I add the intent:
      """
      {
        "subject": "evening routine", "mode": "default", "priority": 50,
        "duration": [40, 40],
        "window": { "not_before": "09:00" },
        "children": [
          { "subject": "intro", "duration": 10 },
          { "subject": "work", "weight": 1 }
        ],
        "cardinality": { "days": { "dates": ["2026-07-06"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "evening routine"
    And no occurrence overlaps the fixed event "Standup"
    And the occurrence of "evening routine" on "2026-07-06" runs from "09:40" to "10:20"
    And the occurrence of "evening routine" on "2026-07-06" has children in order "intro, work"
    And the children of "evening routine" on "2026-07-06" are contiguous
    And the child "intro" of "evening routine" on "2026-07-06" lasts 10 minutes
    And the child "work" of "evening routine" on "2026-07-06" lasts 30 minutes
    And there are no conflicts
