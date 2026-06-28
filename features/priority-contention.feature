Feature: Priority contention and back-to-back clumping
  When several intents want the same opening time, the solver places them in
  priority order (desc), breaking ties by subject A→Z. The highest-priority
  intent keeps the earliest preferred slot; every later intent routes around the
  events already placed, so the contenders stack back-to-back separated by
  exactly the configured padding — with the windows wide enough that nobody is
  forced to overlap.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-12"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Two intents grab for the same 9am opening — priority keeps the earliest slot
    When I add the intents:
      """
      [
        { "subject": "design review", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "inbox zero", "mode": "default", "priority": 40,
          "duration": [45, 45],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject       | date       | start | end   |
      | design review | 2026-07-07 | 09:00 | 10:00 |
      | inbox zero    | 2026-07-07 | 10:00 | 10:45 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Same contention with 10-minute padding leaves exactly a 10-minute gap
    Given padding is 10 minutes
    When I add the intents:
      """
      [
        { "subject": "design review", "mode": "default", "priority": 60,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "inbox zero", "mode": "default", "priority": 40,
          "duration": [45, 45],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "design review" on "2026-07-07" runs from "09:00" to "10:00"
    And the occurrence of "inbox zero" on "2026-07-07" runs from "10:10" to "10:55"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Three intents fighting for the 8am start stack in priority order
    When I add the intents:
      """
      [
        { "subject": "deep work", "mode": "default", "priority": 70,
          "duration": [30, 30],
          "window": { "not_before": "08:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } },
        { "subject": "email triage", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "08:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } },
        { "subject": "reading", "mode": "default", "priority": 30,
          "duration": [30, 30],
          "window": { "not_before": "08:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-08"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject      | date       | start | end   |
      | deep work    | 2026-07-08 | 08:00 | 08:30 |
      | email triage | 2026-07-08 | 08:30 | 09:00 |
      | reading      | 2026-07-08 | 09:00 | 09:30 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Equal priority is broken alphabetically — the A subject takes the earlier slot
    When I add the intents:
      """
      [
        { "subject": "bananas", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } },
        { "subject": "apples", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-09"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject | date       | start | end   |
      | apples  | 2026-07-09 | 09:00 | 10:00 |
      | bananas | 2026-07-09 | 10:00 | 11:00 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Three equal-priority intents stack in strict alphabetical order
    When I add the intents:
      """
      [
        { "subject": "cheetah", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "10:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } },
        { "subject": "aardvark", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "10:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } },
        { "subject": "beaver", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "10:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-10"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject  | date       | start | end   |
      | aardvark | 2026-07-10 | 10:00 | 10:30 |
      | beaver   | 2026-07-10 | 10:30 | 11:00 |
      | cheetah  | 2026-07-10 | 11:00 | 11:30 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A high-priority pinned standup forces a flexible focus block to start after it
    When I add the intents:
      """
      [
        { "subject": "standup", "mode": "default", "priority": 100,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "focus block", "mode": "default", "priority": 40,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "standup" on "2026-07-07" runs from "09:00" to "09:30"
    And the occurrence of "focus block" on "2026-07-07" runs from "09:30" to "10:30"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: The pinned obstacle plus padding pushes the flexible event a full padding later
    Given padding is 10 minutes
    When I add the intents:
      """
      [
        { "subject": "standup", "mode": "default", "priority": 100,
          "duration": [30, 30],
          "window": { "starts_at": "09:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } },
        { "subject": "focus block", "mode": "default", "priority": 40,
          "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-07"] } } }
      ]
      """
    And I solve
    Then the occurrence of "standup" on "2026-07-07" runs from "09:00" to "09:30"
    And the occurrence of "focus block" on "2026-07-07" runs from "09:40" to "10:40"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A clear priority winner then an alphabetical tie-break, all in one afternoon clump
    When I add the intents:
      """
      [
        { "subject": "captain", "mode": "default", "priority": 80,
          "duration": [30, 30],
          "window": { "not_before": "14:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-11"] } } },
        { "subject": "bravo", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "14:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-11"] } } },
        { "subject": "alpha", "mode": "default", "priority": 50,
          "duration": [30, 30],
          "window": { "not_before": "14:00", "not_after": "18:00" },
          "cardinality": { "days": { "dates": ["2026-07-11"] } } }
      ]
      """
    And I solve
    Then the schedule is:
      | subject | date       | start | end   |
      | captain | 2026-07-11 | 14:00 | 14:30 |
      | alpha   | 2026-07-11 | 14:30 | 15:00 |
      | bravo   | 2026-07-11 | 15:00 | 15:30 |
    And no two occurrences overlap
    And there are no conflicts

  Scenario: Two equal-priority workouts stack with the gap equal to a 15-minute padding
    Given padding is 15 minutes
    When I add the intents:
      """
      [
        { "subject": "swim", "mode": "default", "priority": 50,
          "duration": [60, 60],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-12"] } } },
        { "subject": "tennis", "mode": "default", "priority": 50,
          "duration": [45, 45],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-12"] } } }
      ]
      """
    And I solve
    Then the occurrence of "swim" on "2026-07-12" runs from "07:00" to "08:00"
    And the occurrence of "tennis" on "2026-07-12" runs from "08:15" to "09:00"
    And no two occurrences overlap
    And there are no conflicts

  Scenario: A four-way contention resolves into one clean back-to-back clump
    When I add the intents:
      """
      [
        { "subject": "a-task", "mode": "default", "priority": 90,
          "duration": [45, 45],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "b-task", "mode": "default", "priority": 70,
          "duration": [45, 45],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "c-task", "mode": "default", "priority": 50,
          "duration": [45, 45],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } },
        { "subject": "d-task", "mode": "default", "priority": 30,
          "duration": [45, 45],
          "window": { "not_before": "07:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-07-06"] } } }
      ]
      """
    And I solve
    Then the total number of placed occurrences is 4
    And the schedule is:
      | subject | date       | start | end   |
      | a-task  | 2026-07-06 | 07:00 | 07:45 |
      | b-task  | 2026-07-06 | 07:45 | 08:30 |
      | c-task  | 2026-07-06 | 08:30 | 09:15 |
      | d-task  | 2026-07-06 | 09:15 | 10:00 |
    And no two occurrences overlap
    And every occurrence of "a-task" starts at or after "07:00"
    And every occurrence of "d-task" ends at or before "12:00"
    And every occurrence is aligned to the grid
    And there are no conflicts
