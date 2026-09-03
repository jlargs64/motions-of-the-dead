## ADDED Requirements

### Requirement: Menu rows
The main menu SHALL present the rows `survival`, `missions`, `drills`, `armory`, `ledger`, `options`, `save` in that order. A row whose feature is not yet implemented SHALL be drawn in dim ink with a `soon` tag and SHALL remain selectable. All rendered strings SHALL be printable ASCII.

#### Scenario: Initial menu
- **WHEN** the game loads and `phase` is `menu`
- **THEN** the seven rows are drawn in order with the cursor on `survival`

#### Scenario: Placeholder selected
- **WHEN** the player selects a row tagged `soon`
- **THEN** a one-line note appears on the menu and no phase change occurs

### Requirement: Vim navigation
The menu SHALL move its cursor with `j` and `k`, accept a numeric count before them, and SHALL support `gg` (first row), `G` (last row), `H` (first row), `M` (middle row) and `L` (last row). Movement SHALL clamp at the first and last row and SHALL NOT wrap.

#### Scenario: Count
- **WHEN** the cursor is on `survival` and the player types `3j`
- **THEN** the cursor is on `armory`

#### Scenario: Clamp
- **WHEN** the cursor is on `save` and the player types `j`
- **THEN** the cursor stays on `save`

#### Scenario: Absolute jumps
- **WHEN** the player types `G` then `gg` then `M`
- **THEN** the cursor lands on `save`, then `survival`, then `armory`

### Requirement: Search to select
The menu SHALL accept `/`, then typed characters, then `Enter`, and SHALL move the cursor to the first row whose label contains the typed text, case-insensitive, searching forward from the cursor and wrapping. `n` SHALL repeat the search forward and `N` backward. `Esc` during typing SHALL cancel the search. A search with no match SHALL leave the cursor unchanged and show `E486: Pattern not found: <text>`.

#### Scenario: Match
- **WHEN** the cursor is on `survival` and the player types `/led<CR>`
- **THEN** the cursor is on `ledger`

#### Scenario: No match
- **WHEN** the player types `/xyz<CR>`
- **THEN** the cursor does not move and the menu shows `E486: Pattern not found: xyz`

### Requirement: Select and back
`Enter` or `l` SHALL activate the row under the cursor. `h` or `Esc` on a sub-screen SHALL return to the previous screen. `Esc` on the main menu SHALL do nothing.

#### Scenario: Enter options and leave
- **WHEN** the cursor is on `options` and the player presses `l`, then `Esc`
- **THEN** the options screen is shown, then the main menu is shown with the cursor still on `options`

### Requirement: The insert key
`i` on the main menu SHALL start a survival run immediately, regardless of cursor position. The `t` key SHALL have no effect on the menu or the death screen.

#### Scenario: Insert yourself
- **WHEN** the cursor is on `armory` and the player presses `i`
- **THEN** `phase` becomes `playing` with `mode` `survival`

### Requirement: Mouse selection
A mouse click whose pointer lies within a menu row's cell row SHALL move the cursor to that row and activate it. A click outside every row SHALL do nothing. Hit-testing SHALL use the renderer's cell metrics and SHALL NOT add DOM elements.

#### Scenario: Click a row
- **WHEN** the player clicks inside the cell row where `ledger` is drawn
- **THEN** the ledger screen is shown

#### Scenario: Click the gap
- **WHEN** the player clicks on the panel between two rows
- **THEN** the cursor does not move and no screen changes

### Requirement: Options sub-screen
The options screen SHALL expose the sound, gore and line-number toggles with the same keys and labels as the pause card, and changes SHALL persist through the same settings path the pause card uses.

#### Scenario: Cycle gore from the menu
- **WHEN** the player presses `g` on the options screen twice
- **THEN** gore is `OFF` and the pause card shows `OFF` on the next run

### Requirement: Ledger sub-screen
The ledger screen SHALL show lifetime high score, total kills, the three most-used motions, the three most-missed motions, and keystrokes-per-kill for the last eight runs, all sourced from the persistent save.

#### Scenario: Fresh profile
- **WHEN** no runs have been recorded
- **THEN** the screen shows `NO RUNS YET` and no empty tables

### Requirement: Save sub-screen
The save screen SHALL show the save version, last-updated time, run count and salvage, and SHALL offer `e` export and `m` import actions that call the `player-save` functions. It SHALL show the result line those functions return.

#### Scenario: Export
- **WHEN** the player presses `e` on the save screen
- **THEN** the export function is invoked and its result line is drawn on the screen

### Requirement: Layout is asserted
Every menu screen SHALL pass the layout assertions in `tests/ui-layout.test.ts`: nothing leaves the 60-column grid, nothing leaves its panel, nothing overlaps on a row, with the longest label and the longest result line each screen can hold.

#### Scenario: Layout test
- **WHEN** the layout suite renders the main menu, options, ledger and save screens with maximal content
- **THEN** no assertion fails

### Requirement: Harness surface
When `phase` is `menu`, `text()` SHALL print the menu rows one per line with `>` before the cursor row, and `keys()` SHALL drive the menu with the same key vocabulary the browser uses.

#### Scenario: Agent drives menu
- **WHEN** an agent calls `keys('jj')` then `text()`
- **THEN** the output marks `drills` with `>`
