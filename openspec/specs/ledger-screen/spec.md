# ledger-screen Specification

## Purpose
The service record: the lifetime stats page on the main menu. A per-motion
table of used, kills and missed sorted worst first and scrolled with `j`
and `k`, the keystrokes-per-kill trend, kill and medal totals, the high
score, and the coach's ranked families with a keycap each so `1`, `2` or
`3` starts the matching drill. Read-only over the save; every string is
printable ASCII and the layout is asserted at the widest values the save
can hold.

## Requirements

### Requirement: Ledger screen
The main menu SHALL offer a ledger screen that shows, from the save, a per-motion table of used, kills and missed sorted by missed descending then used descending, the keystrokes-per-kill values of the last eight runs, lifetime kills, lifetime medal counts, the high score, and the coach's ranked families. The screen SHALL be read-only.

#### Scenario: Table order
- **WHEN** `f` has missed 40, `$` has missed 40 with more used, and `w` has missed 2
- **THEN** the table lists `f` before `$` before `w`

#### Scenario: Empty save
- **WHEN** the save has no runs
- **THEN** the screen shows a neutral line and no table rows, and nothing overlaps

### Requirement: Scroll and jump to drill
The table SHALL scroll with `j` and `k` when it exceeds the panel, and the coach entries SHALL be labelled `1`, `2`, `3` so that pressing that key starts the matching drill. Esc SHALL return to the menu.

#### Scenario: Jump
- **WHEN** the coach's second entry is brackets and the player presses `2`
- **THEN** the brackets drill starts

#### Scenario: Scroll clamps
- **WHEN** the player presses `j` at the bottom of the table
- **THEN** the view does not move and no error is shown

### Requirement: Layout and ASCII
The ledger screen SHALL pass the layout assertions with the longest values the save can hold and SHALL render only printable ASCII.

#### Scenario: Maximum values
- **WHEN** every counter is 99999 and every token name is at its longest
- **THEN** nothing leaves the panel and nothing overlaps on the same row
