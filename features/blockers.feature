Feature: Blocker intents
  A blocker reserves time like any intent — everything else schedules around it
  at full priority — but its occurrences are scenery, not events: they are
  drawn as a shaded area, excluded from the ICS feed, and an event forced to
  overlap one is LABELED (blockedBy, like placedDuringSleep) rather than
  reported as a conflict.

  Background:
    Given wakeup is "08:00" and sleep is "23:00"
    And the planning horizon is "2026-01-05" to "2026-01-11"

  Scenario: everything schedules around a blocker
    Given the intents:
      """
      [
        { "subject": "Work", "mode": "default", "priority": 95, "duration": [480, 480],
          "blocker": true,
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day" }, "days": { "weekdays": ["MO", "TU", "WE", "TH", "FR"] } } },
        { "subject": "errand", "mode": "default", "priority": 50, "duration": [60, 60],
          "window": { "not_before": "09:00", "not_after": "21:00" },
          "cardinality": { "days": { "dates": ["2026-01-06"] } } }
      ]
      """
    Then occurrences of "errand" do not overlap occurrences of "Work"
    And the occurrence of "Work" on "2026-01-06" is a blocker
    And the occurrence of "errand" on "2026-01-06" is not marked blocked
    And there are no conflicts

  Scenario: a forced overlap with a blocker is labeled, not reported
    Given the intents:
      """
      [
        { "subject": "Work", "mode": "default", "priority": 95, "duration": [480, 480],
          "blocker": true,
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day" }, "days": { "weekdays": ["MO", "TU", "WE", "TH", "FR"] } } },
        { "subject": "standup call", "mode": "default", "priority": 60, "duration": [30, 30],
          "window": { "not_before": "10:00", "not_after": "12:00" },
          "cardinality": { "days": { "dates": ["2026-01-06"] } } }
      ]
      """
    Then an occurrence of "standup call" is placed on "2026-01-06"
    And the occurrence of "standup call" on "2026-01-06" is blocked by "Work"
    And there are no conflicts

  Scenario: real events forced together still conflict normally next to a blocker
    Given the intents:
      """
      [
        { "subject": "Work", "mode": "default", "priority": 95, "duration": [480, 480],
          "blocker": true,
          "window": { "starts_at": "09:00" },
          "cardinality": { "period": { "unit": "day" }, "days": { "weekdays": ["MO", "TU", "WE", "TH", "FR"] } } },
        { "subject": "dinner", "mode": "default", "priority": 70, "duration": [120, 120],
          "window": { "starts_at": "19:00" },
          "cardinality": { "days": { "dates": ["2026-01-06"] } } },
        { "subject": "concert", "mode": "default", "priority": 60, "duration": [120, 120],
          "window": { "starts_at": "20:00" },
          "cardinality": { "days": { "dates": ["2026-01-06"] } } }
      ]
      """
    Then there is a conflict involving "dinner" and "concert"
