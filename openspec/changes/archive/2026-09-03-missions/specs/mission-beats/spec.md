## ADDED Requirements

### Requirement: Two beats in order
A mission SHALL proceed TRY, then DONE. The sim SHALL record the current beat in `SimState.missionBeat` as `try` or `done`, and SHALL set `SimState.mode` to `mission` and `SimState.mission` to the mission index while either beat is active. Nothing SHALL advance out of DONE on a timer. (The WATCH beat of the original proposal lives on the select screen's demo pane instead, see `mission-demo`.)

#### Scenario: Start lands in TRY
- **WHEN** a mission is started
- **THEN** `missionBeat` is `try`, the mission's scene is spawned, the cursor is at the mission's start cursor, `missionKeys` is 0 and `mode` is `mission`

#### Scenario: Waiting is free in DONE
- **WHEN** 60 seconds of sim time pass during DONE with no input
- **THEN** `missionBeat` is still `done` and `mission` is unchanged

### Requirement: TRY rules
During TRY the wall SHALL take no damage, charges SHALL be refilled at the start of the beat and on every retry, zombies SHALL move at the speed given in the spawn tuple, `r` with nothing pending SHALL reset the beat, and every keystroke fed SHALL increment `missionKeys`. The goal check SHALL be: `reach` is met when the crosshair is on a zombie; `clear` is met when the field is empty; `plant` is met when a trap of the mission's item spanning at least the mission's lane count is planted; an empty field satisfies `reach` and `clear` only when the player emptied it.

#### Scenario: Wall is invulnerable
- **WHEN** a zombie walks into the wall during TRY
- **THEN** barricade HP is unchanged, the zombie is removed, and the beat restarts once the field is empty

#### Scenario: Retry refills
- **WHEN** both `dd` charges are spent during TRY and `r` is pressed
- **THEN** `charges.dd` is back to its maximum, the scene is respawned, and `missionKeys` is 0

#### Scenario: Keys are counted
- **WHEN** `3jdw` is typed during TRY
- **THEN** `missionKeys` is 4

#### Scenario: Reach goal
- **WHEN** the mission goal is `reach` and the crosshair lands inside a zombie's span
- **THEN** `missionHold` is set and after it elapses `missionBeat` is `done`

### Requirement: Par is derived from the oracle
For every mission the game SHALL compute `par` in `src/sim/optimal.ts` as `parFor(mission)`: for `clear`, the greedy sequential sum of oracle-optimal keystroke counts (from the start cursor with full charges, repeatedly pick the zombie whose `optimalKill` is cheapest, add its key length, apply it, continue until the field is empty); for `reach`, the cheapest motion-only path to any zombie; for `plant`, the keys of the shortest planting sequence (`<CR>`, a counted `j`, `<CR>`). A mission MAY override par with an explicit `par` field where its lesson's motion is outside the oracle's vocabulary (the search lessons). Par SHALL be finite for every mission and SHALL never exceed the mission's demo length. `missionPar(id)` memoises it.

#### Scenario: Single word
- **WHEN** the scene is one walker `shamble` at lane 8 column 24 with the cursor at lane 8 column 0 and the goal is `clear`
- **THEN** par is 3 (`fsdw` is 4, `24ldw` is 5, `wdw` is 3)

#### Scenario: Par bounded by demo
- **WHEN** par is computed for every mission
- **THEN** each par is a finite positive integer and `par <= splitKeys(demo.keys).length`

### Requirement: Stars by ratio to par
On goal met the game SHALL award 3 stars when `missionKeys <= par`, 2 stars when `missionKeys <= ceil(par * 1.5)`, and 1 star otherwise.

#### Scenario: Thresholds
- **WHEN** par is 6 and the mission is cleared in 6, 9 and 10 keys on three separate attempts
- **THEN** the attempts award 3, 2 and 1 stars respectively

### Requirement: DONE waits for a key
DONE SHALL display keystrokes versus par and the stars, and SHALL respond to `n` (start the next mission in table order, or return to the main menu after the last), `r` (restart the same mission at TRY), and Esc (return to the mission list with the selection on this mission). Any other key SHALL do nothing.

#### Scenario: Next
- **WHEN** `n` is pressed on DONE for mission index 3
- **THEN** mission index 4 starts in TRY

#### Scenario: Retry from DONE
- **WHEN** `r` is pressed on DONE
- **THEN** the same mission is in TRY with a fresh scene and `missionKeys` 0

#### Scenario: Last mission
- **WHEN** `n` is pressed on DONE for the last mission in the table
- **THEN** the game returns to the main menu (`phase` `menu`), not survival

### Requirement: Mission strip
While in a mission the game SHALL draw a strip along the top of the field showing the beat name (`TRY` or `DONE`) with the mission's number in the table, the title, the keystroke count and par, the keycaps and the hint in TRY, and the stars and the keys `n r Esc` in DONE. The field SHALL stay fully visible beneath it. All strings SHALL be ASCII and SHALL pass the layout test for every mission and beat.

#### Scenario: Strip per beat
- **WHEN** the layout test draws the strip for every mission in each beat, with and without the GOOD hold
- **THEN** nothing leaves the panel, nothing overlaps on a row, and the beat name matches `missionBeat`

### Requirement: Headless text surface
`text()` SHALL include a line starting `MISSION <id> <TRY|DONE> keys=<n> par=<p>` while in a mission.

#### Scenario: Header line
- **WHEN** the headless game is in TRY for mission `boot-fire` with 2 keys fed (par is 3: `wdw`)
- **THEN** `text()` contains `MISSION boot-fire TRY keys=2 par=3`
