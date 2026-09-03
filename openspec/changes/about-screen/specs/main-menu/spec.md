## MODIFIED Requirements

### Requirement: Menu rows
The main menu SHALL present the rows `survival`, `missions`, `drills`, `armory`, `ledger`, `options`, `save`, `about` in that order. A row whose feature is not yet implemented SHALL be drawn in dim ink with a `soon` tag and SHALL remain selectable. All rendered strings SHALL be printable ASCII. The rows SHALL sit on odd cell rows 1..15 of a card whose panel starts at row -5, with row 16 blank and the footer on row 17.

#### Scenario: Initial menu
- **WHEN** the game loads and `phase` is `menu`
- **THEN** the eight rows are drawn in order with the cursor on `survival`

#### Scenario: Last row
- **WHEN** the player presses `G` or `L`
- **THEN** the cursor is on `about`

### Requirement: First-night header
The main card's score slot SHALL read `HIGH SCORE  <n>` when a high score exists and `FIRST NIGHT?  G  about` otherwise.

#### Scenario: Fresh profile
- **WHEN** the save has no high score
- **THEN** the header reads `FIRST NIGHT?  G  about`
