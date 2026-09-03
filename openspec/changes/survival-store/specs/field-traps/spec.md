## ADDED Requirements

### Requirement: Placement mode over the survey grid
Pressing `l` or `<CR>` on a trap item SHALL enter placement mode with `shop.mode` set to `place`, `shop.item` set to the trap id, `shop.anchor` null, and `shop.place` at the last play cursor. In placement mode the sim SHALL resolve pure motions from the Vim engine against a survey buffer whose 16 rows are the 52-column ruler `0....5....10...15...20...25...30...35...40...45...50.` and SHALL clamp the result to the grid. Vertical motions (`j`, `k`, counts, `gg`, `G`, `{n}G`, `H`, `M`, `L`) and horizontal motions (`h`, `l`, `w`, `b`, `e`, `0`, `^`, `$`, `f`, `F`, `t`, `T`, `;`, `,`) SHALL all move the placement crosshair. Operators and searches SHALL be ignored with the unknown-key flash.

#### Scenario: Find character on the ruler
- **WHEN** the placement crosshair is at column 0 and the player types `f3`
- **THEN** the crosshair is at column 30

#### Scenario: Counted lane jump
- **WHEN** the player types `7G` in placement mode
- **THEN** the crosshair is on lane 7 (row index 6)

### Requirement: Tripwire planting
With a Tripwire selected, `<CR>` SHALL debit the price, append `{ id, kind: 'tripwire', row0: row, row1: row, col0: col, col1: col, charges: 1 }` to `traps`, emit `buy`, and return to list mode. `<Esc>` SHALL return to list mode without debiting.

#### Scenario: Plant
- **WHEN** the crosshair is on lane 5 column 30 with 100 supplies and the player presses `<CR>` on a Tripwire
- **THEN** `supplies` is 50, `traps` has one tripwire on row 4 columns 30..30 with 1 charge, and `shop.mode` is `list`

#### Scenario: Cancel
- **WHEN** the player presses `<Esc>` during Tripwire placement
- **THEN** `traps` is unchanged, `supplies` is unchanged, and `shop.mode` is `list`

### Requirement: Wire fence spans lanes by anchor and vertical motion
With a Wire fence selected, the first `<CR>` SHALL set `shop.anchor`. The second `<CR>` SHALL plant a fence covering rows `min(anchor.row, place.row)..max(...)` at `anchor.col`, with one charge per lane and a cost of the per-lane price times the lane count. A fence whose cost exceeds `supplies` SHALL be refused with the unknown-key flash and the anchor kept. A horizontal move between the two `<CR>` presses SHALL NOT change the fence column.

#### Scenario: Three-lane fence via 2j
- **WHEN** the player anchors on lane 3 column 20, types `2j`, and presses `<CR>` with 200 supplies
- **THEN** a fence covering rows 2..4 at column 20 with 3 charges is planted and `supplies` is 80

#### Scenario: Unaffordable span
- **WHEN** the player anchors, types `9j`, and presses `<CR>` with 100 supplies
- **THEN** no trap is planted, `supplies` is 100, and `shop.anchor` is still set

### Requirement: Minefield spans columns by anchor and horizontal motion
With a Minefield selected, the first `<CR>` SHALL set `shop.anchor`. The second `<CR>` SHALL plant a minefield on `anchor.row` covering columns `min(anchor.col, place.col)..max(...)`, with charges equal to `ceil(width / 5)` and cost of the per-5-column price times that count. A vertical move between the two presses SHALL NOT change the row.

#### Scenario: Field via 2w
- **WHEN** the player anchors on lane 8 column 20, types `2w` landing on column 30, and presses `<CR>` with 100 supplies
- **THEN** a minefield on row 7 covering columns 20..30 with 3 charges is planted and `supplies` is 10

### Requirement: Traps fire during movement
Inside `moveZombies`, after a zombie advances one column, the sim SHALL check every trap whose rows include the zombie's row and whose columns intersect the zombie's span. On a hit the sim SHALL decrement the trap's `charges`, remove the trap when charges reach 0, emit `{ t: 'trap_fire'; trapId; row; col }`, and resolve the zombie: a non-armored zombie dies; an armored zombie loses one hp as a chip and is not killed. A zombie that hits the barricade on the same step SHALL be resolved by the barricade, not the trap.

#### Scenario: Runner cannot skip a wire
- **WHEN** a runner advances two columns in one tick across a tripwire column
- **THEN** the runner dies on the step that crossed the wire and the tripwire is removed

#### Scenario: Armored chip
- **WHEN** an armored zombie with hp 2 crosses a tripwire
- **THEN** the zombie has hp 1, is still alive, and the tripwire is consumed

### Requirement: Trap kill accounting
A trap kill SHALL increment `sim.kills` and `sim.resolvedThisWave`, add `10 * text.length` to `score` with no combo multiplier, emit `kill` with `via` of the form `trap:<kind>:<id>` and `overkill: false`, and SHALL NOT change `combo`, `lastKillAt`, `longestCombo` or `supplies`. Killing a crawler with a trap SHALL NOT count as overkill.

#### Scenario: Score without combo
- **WHEN** `combo` is 4 and a 6-letter walker dies to tripwire 2
- **THEN** `score` increases by 60, `combo` is still 4, and a `kill` event with `via: 'trap:tripwire:2'` is emitted

### Requirement: Trap kill drops the lock
When the zombie carrying the target lock dies to a trap, the lock SHALL clear on the next refresh and the cursor SHALL stay at its last column.

#### Scenario: Locked zombie trapped
- **WHEN** the cursor is locked to a zombie that then dies to a fence
- **THEN** `sim.lockId` is 0 and the cursor column is unchanged from the last frame

### Requirement: Traps persist across nights
Planted traps SHALL remain in `traps` across `startWave` until their charges are spent and SHALL be cleared on `start()` and `toTitle()`.

#### Scenario: Unfired trap survives
- **WHEN** a tripwire is planted after night 2 and nothing crosses it during night 3
- **THEN** it is still listed in `traps` during the night 3 store

### Requirement: Placement teaches itself on first use
While `shop.mode` is `place` and the run has planted nothing, the placement
strip SHALL carry a teaching region saying that the field is now a survey
ruler and that the ordinary motions resolve against it. The region SHALL
disappear once anything has been planted this run, SHALL be derived from state
rather than from a stored flag, and SHALL be capped so it cannot reach the
first lane.

#### Scenario: First placement of a run
- **WHEN** placement opens and `purchases` shows no trap planted
- **THEN** the strip says the lanes are a ruler and gives a motion example

#### Scenario: After the first plant
- **WHEN** a trap has been planted this run and placement opens again
- **THEN** the teaching region is gone and the strip is its usual three rows

### Requirement: A boot-camp mission teaches placement
The warm-up SHALL include a mission whose goal is `plant`. It SHALL open with
`phase` set to `shop` and `shop.mode` set to `place`, armed with the mission's
item and a wallet large enough for any span, so the mission drives the real
placement path rather than a copy of it. The mission SHALL complete only when
the planted span covers at least the lanes it asked for; a shorter span SHALL
re-arm placement with the anchor cleared. `<Esc>` SHALL clear the anchor
rather than return to the store list, and `r` SHALL restart the step and
remove what was planted.

#### Scenario: The mission is finished by planting
- **WHEN** the player presses `<CR>`, `2j`, `<CR>` on the placement mission
- **THEN** a three-lane fence is planted, `phase` returns to `playing`, and the warm-up advances

#### Scenario: A short span is a retry
- **WHEN** the player anchors and plants on the same lane
- **THEN** the one-lane fence stays on the field, placement is re-armed, the anchor is null, and the warm-up does not advance

#### Scenario: Escape has no store to fall back to
- **WHEN** the player presses `<Esc>` during the placement mission with an anchor set
- **THEN** the anchor is cleared, `shop.mode` is still `place`, and no store card is reachable

#### Scenario: The mission leaves nothing behind
- **WHEN** the placement mission is finished and the run rolls into wave 1
- **THEN** `traps` is empty and `supplies` is 0
