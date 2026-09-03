## ADDED Requirements

### Requirement: About is reachable from the main menu
The main menu SHALL list an `about` row as its last row. Selecting it SHALL open the about card. `h` or `Esc` on the card SHALL return to the main menu with the cursor still on `about`.

#### Scenario: Open and close
- **WHEN** the player presses `G` then `Enter` on the main menu, then `h`
- **THEN** the about card is drawn, then the main menu is drawn with `about` under the cursor

### Requirement: Pages under a tab strip
The about card SHALL present its pages as a tab strip on one row, the active tab in hot ink with a rule under it, and the active page's copy wrapped beneath at 44 cells wide and at most 15 rows. `j` and `k` SHALL turn the page, clamping at the first and last page. `Enter` and `l` on a page SHALL do nothing.

#### Scenario: Turn the page
- **WHEN** the card is open and the player presses `j` twice
- **THEN** the third tab is active and its copy is shown

#### Scenario: A page is not a row
- **WHEN** the player presses `Enter` on a page
- **THEN** nothing changes and the card stays open

### Requirement: The copy fits and is plain
Every about page SHALL be printable ASCII and SHALL wrap to at most 15 lines of 44 cells with no word lost. A test SHALL assert this for every page.

#### Scenario: A page that runs long
- **WHEN** a page's paragraphs wrap to more than 15 lines
- **THEN** `tests/ui.test.ts` fails naming the page

### Requirement: Headless surface
When the menu is on the about screen, `text()` SHALL print `MENU about`, one row per page with `>` on the active one, a blank line, and the active page's wrapped copy indented two cells.

#### Scenario: An agent reads the page
- **WHEN** the harness sends `G<CR>`
- **THEN** `text()` contains `MENU about` and the first page's opening sentence
