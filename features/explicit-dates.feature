Feature: Explicit dates (days.dates) selection
  Validates days.dates: occurrences land on exactly the listed dates that fall
  within the planning horizon. Dates outside the horizon are silently ignored.
  Covers one-off events, several dates, per_day stacking on those dates, pinned
  and flexible durations, and that non-listed dates stay empty.

  Background:
    Given the planning horizon is "2026-07-06" to "2026-07-19"
    And wakeup is "07:00" and sleep is "23:00"
    And the grid is 5 minutes
    And padding is 0 minutes

  Scenario: Book a one-off dentist appointment for one specific day
    When I add the intent:
      """
      {
        "subject": "dentist appointment", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "dentist appointment"
    And an occurrence of "dentist appointment" is placed on "2026-07-08"
    And occurrences of "dentist appointment" fall on dates "2026-07-08"
    And the occurrence of "dentist appointment" on "2026-07-08" runs from "09:00" to "10:00"
    And there are no conflicts

  Scenario: Schedule guitar lessons on four chosen dates
    When I add the intent:
      """
      {
        "subject": "guitar lesson", "mode": "default", "priority": 50,
        "duration": [45, 45],
        "window": { "not_before": "16:00", "not_after": "19:00" },
        "cardinality": { "days": { "dates": ["2026-07-07", "2026-07-10", "2026-07-14", "2026-07-17"] } }
      }
      """
    And I solve
    Then there are 4 occurrences of "guitar lesson"
    And occurrences of "guitar lesson" fall on dates "2026-07-07, 2026-07-10, 2026-07-14, 2026-07-17"
    And every occurrence of "guitar lesson" starts at "16:00"
    And every occurrence of "guitar lesson" lasts 45 minutes
    And no two occurrences of "guitar lesson" overlap
    And there are no conflicts

  Scenario: Stack three physio sessions on each of two specific dates
    When I add the intent:
      """
      {
        "subject": "physio", "mode": "default", "priority": 50,
        "duration": [30, 30],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": {
          "days": { "dates": ["2026-07-09", "2026-07-16"] },
          "per_day": { "count": [3, 3] }
        }
      }
      """
    And I solve
    Then there are 6 occurrences of "physio"
    And there are 3 occurrences of "physio" on "2026-07-09"
    And there are 3 occurrences of "physio" on "2026-07-16"
    And occurrences of "physio" fall on dates "2026-07-09, 2026-07-16"
    And every occurrence of "physio" starts at or after "09:00"
    And every occurrence of "physio" ends at or before "17:00"
    And no two occurrences of "physio" overlap
    And there are no conflicts

  Scenario: Some listed dates fall outside the horizon and are ignored
    When I add the intent:
      """
      {
        "subject": "garden cleanup", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "10:00", "not_after": "16:00" },
        "cardinality": {
          "days": { "dates": ["2026-07-05", "2026-07-08", "2026-07-12", "2026-07-20", "2026-08-01"] }
        }
      }
      """
    And I solve
    Then there are 2 occurrences of "garden cleanup"
    And occurrences of "garden cleanup" fall on dates "2026-07-08, 2026-07-12"
    And no occurrence of "garden cleanup" is placed on "2026-07-05"
    And no occurrence of "garden cleanup" is placed on "2026-07-20"
    And there are no conflicts

  Scenario: Pin exact times on two specific dates with starts_at
    When I add the intent:
      """
      {
        "subject": "client call", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "starts_at": "14:00" },
        "cardinality": { "days": { "dates": ["2026-07-07", "2026-07-13"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "client call"
    And every occurrence of "client call" starts at "14:00"
    And the occurrence of "client call" on "2026-07-07" runs from "14:00" to "15:00"
    And the occurrence of "client call" on "2026-07-13" runs from "14:00" to "15:00"
    And no occurrence is marked as placed during sleep
    And there are no conflicts

  Scenario: Flexible duration on explicit dates lands on the floor inside a window
    When I add the intent:
      """
      {
        "subject": "studio session", "mode": "default", "priority": 50,
        "duration": [60, 120],
        "window": { "not_before": "09:00", "not_after": "12:00" },
        "cardinality": { "days": { "dates": ["2026-07-10", "2026-07-15"] } }
      }
      """
    And I solve
    Then there are 2 occurrences of "studio session"
    And every occurrence of "studio session" lasts between 60 and 120 minutes
    And every occurrence of "studio session" starts at or after "09:00"
    And every occurrence of "studio session" ends at or before "12:00"
    And the occurrence of "studio session" on "2026-07-10" runs from "09:00" to "10:00"
    And there are no conflicts

  Scenario: Flexible duration pinned with starts_at on a single date
    When I add the intent:
      """
      {
        "subject": "deep work", "mode": "default", "priority": 50,
        "duration": [90, 150],
        "window": { "starts_at": "15:00" },
        "cardinality": { "days": { "dates": ["2026-07-14"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "deep work"
    And the occurrence of "deep work" on "2026-07-14" runs from "15:00" to "16:30"
    And every occurrence of "deep work" lasts between 90 and 150 minutes
    And there are no conflicts

  Scenario: Only the listed dates get an occurrence, the gaps stay empty
    When I add the intent:
      """
      {
        "subject": "tutoring", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "18:00" },
        "cardinality": { "days": { "dates": ["2026-07-07", "2026-07-09", "2026-07-11"] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "tutoring"
    And an occurrence of "tutoring" is placed on "2026-07-07"
    And an occurrence of "tutoring" is placed on "2026-07-09"
    And an occurrence of "tutoring" is placed on "2026-07-11"
    And no occurrence of "tutoring" is placed on "2026-07-08"
    And no occurrence of "tutoring" is placed on "2026-07-10"
    And there are no conflicts

  Scenario: Explicit dates spanning two weeks of the horizon
    When I add the intent:
      """
      {
        "subject": "swim", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "08:00", "not_after": "20:00" },
        "cardinality": { "days": { "dates": ["2026-07-06", "2026-07-13", "2026-07-18"] } }
      }
      """
    And I solve
    Then there are 3 occurrences of "swim"
    And the total number of placed occurrences is 3
    And occurrences of "swim" fall on dates "2026-07-06, 2026-07-13, 2026-07-18"
    And every occurrence of "swim" starts at "08:00"
    And there are no conflicts

  Scenario: An occurrence on an explicit date routes around an existing fixed event
    Given an existing fixed event "Lunch meeting" on "2026-07-08" from "09:00" to "10:00"
    When I add the intent:
      """
      {
        "subject": "errands", "mode": "default", "priority": 50,
        "duration": [60, 60],
        "window": { "not_before": "09:00", "not_after": "17:00" },
        "cardinality": { "days": { "dates": ["2026-07-08"] } }
      }
      """
    And I solve
    Then there is 1 occurrence of "errands"
    And the occurrence of "errands" on "2026-07-08" runs from "10:00" to "11:00"
    And no occurrence overlaps the fixed event "Lunch meeting"
    And there are no conflicts
