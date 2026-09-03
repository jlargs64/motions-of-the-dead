## ADDED Requirements

### Requirement: Wave clear opens the store in survival
When a wave clears while `sim.mode` is `survival`, the sim SHALL set `phase` to `shop`, SHALL leave `sim.breather` at 0, and SHALL NOT advance `sim.time`, spawn, move zombies or decay the combo until the store is left. In every other mode the existing breather SHALL be used.

#### Scenario: Survival wave clear
- **WHEN** the last zombie of night 3 dies in survival mode
- **THEN** `wave_clear` is emitted, `phase` becomes `shop`, and after `step(60000)` the wave number is still 3 and `sim.time` is unchanged

#### Scenario: Mission wave clear keeps the breather
- **WHEN** a wave clears while `sim.mode` is not `survival`
- **THEN** `phase` stays `playing` and `sim.breather` is set as before

### Requirement: Store list navigation
The store SHALL present a list of items followed by a NEXT NIGHT row, and SHALL move its selection cursor with pure vertical motions fed through the shared Vim engine: `j`, `k`, counted `{n}j` / `{n}k`, `gg`, `G`, `H`, `M`, `L`. The cursor SHALL clamp to the list bounds. Operators, searches and unknown keys SHALL leave the selection unchanged and SHALL trigger the unknown-key flash.

#### Scenario: Counted move
- **WHEN** the store cursor is on row 0 and the player types `3j`
- **THEN** the cursor is on row 3

#### Scenario: G goes to NEXT NIGHT
- **WHEN** the player types `G` in the store list
- **THEN** the cursor is on the NEXT NIGHT row

#### Scenario: Operator ignored
- **WHEN** the player types `dd` in the store list
- **THEN** the cursor does not move, `sim.flashUntil` is set, and no `buy` event is emitted

### Requirement: Buying is a sim input
Pressing `l` or `<CR>` on an instant item SHALL call `Sim.buy(itemId)`. A purchase SHALL succeed only when `supplies` is at least the price and the item's owned count is below its cap; on success the sim SHALL debit `supplies`, apply the item's effect, increment `purchases[itemId]`, and emit `{ t: 'buy'; item; cost }`. On failure the sim SHALL emit nothing but the unknown-key flash and SHALL leave state unchanged.

#### Scenario: Affordable purchase
- **WHEN** `supplies` is 100 and the player presses `l` on Planks priced 80 with the wall at 50 HP
- **THEN** `supplies` is 20, the wall is at 75 HP, `purchases.planks` is 1, and a `buy` event with `item: 'planks'` and `cost: 80` is emitted

#### Scenario: Cannot afford
- **WHEN** `supplies` is 30 and the player presses `l` on Planks priced 80
- **THEN** `supplies` is 30, the wall is unchanged, and no `buy` event is emitted

#### Scenario: Cap reached
- **WHEN** `purchases.flare` is 1 and the player presses `l` on Flare
- **THEN** no `buy` event is emitted and `supplies` is unchanged

### Requirement: Leaving the store
Pressing `n` in list mode, or `<CR>` on the NEXT NIGHT row, SHALL set `phase` to `playing` and start the next wave. `<Esc>` in list mode SHALL do nothing. The store SHALL NOT be re-enterable for the same night once left.

#### Scenario: Next night
- **WHEN** the store is open after night 3 and the player presses `n`
- **THEN** `phase` is `playing`, `wave` is 4, and `wave_start` with `n: 4` is emitted

### Requirement: Shop input goes through the harness key path
`Game.keys()` SHALL route every key in phase `shop`: intercepting `<CR>`, `<Esc>`, and in list mode `l` and `n`, and feeding all other keys to the Vim engine. `main.ts` SHALL call `game.keys()` for shop keys rather than handling them itself, so a `runs/*.jsonl` log containing shop keystrokes replays identically headless and through `dist/`.

#### Scenario: Replay through the store
- **WHEN** a recorded log includes `wave_clear`, `jjl`, `n` and further play
- **THEN** `npm run replay` and `npm run verify:browser` both report identical event streams and final state

### Requirement: Store text surface
While `phase` is `shop`, `text()` SHALL emit a `STORE` block containing the night cleared, `SUPPLIES`, the next night number, a keys line, one line per item showing a `>` marker on the selected row, the item id in brackets, name, price and `owned x/cap`, a `[next] NEXT NIGHT` row, and a `MANIFEST` line that reads `locked` unless Manifest was bought. In every phase `text()` SHALL emit a `TRAPS` table with one row per planted trap: id, kind, lanes, cols, charges, or `(none)`.

#### Scenario: Store block present
- **WHEN** the store is open with the cursor on the second item and 240 supplies
- **THEN** `text()` contains `STORE`, `SUPPLIES 240`, exactly one line beginning with `> `, and `[next]`

#### Scenario: Traps table
- **WHEN** a tripwire with id 1 is planted on lane 5 column 30 and play resumes
- **THEN** `text()` contains a `TRAPS` row with `1`, `tripwire`, `5`, `30` and `1`

### Requirement: Survival ammo economy
In survival mode `startWave` SHALL NOT refill `charges`. A run SHALL start with `charges` of `dd: 2, D: 3` and `chargeCap` of `dd: 2, D: 3`. Buying a charge SHALL increment that charge by one, never above its cap. In every other mode charges SHALL refill as before.

#### Scenario: No refill in survival
- **WHEN** the player spends both `dd` charges on night 2 and starts night 3 without buying
- **THEN** `charges.dd` is 0 on night 3

#### Scenario: Charge purchase respects cap
- **WHEN** `charges.D` is 3, `chargeCap.D` is 3, and the player buys a `D` charge
- **THEN** no `buy` event is emitted and `supplies` is unchanged

### Requirement: Store card layout is asserted
The store card SHALL fit its panel at every cursor position, with the longest item name, price and owned string, and SHALL contain only printable ASCII. `tests/ui-layout.test.ts` SHALL cover the store card and the placement strip.

#### Scenario: Layout test covers the store
- **WHEN** the layout test draws the store card with the cursor on each row
- **THEN** no text leaves the panel, no two strings overlap on a row, and every string is ASCII

### Requirement: The store announces itself with a page turn
Entering the store SHALL play a page turn: a sheet of paper sweeping across the
viewport that reveals the card behind it, over `PAGE_TURN_MS`. The card SHALL
carry `STORE` as its heading, at a larger scale than any other string on it,
with the night cleared and the supplies balance beside it. The turn SHALL
restart on each store visit and SHALL NOT restart when placement mode returns
to the list.

#### Scenario: A new night turns the page
- **WHEN** the store opens after night 3, and again after night 4
- **THEN** the page turn plays once per visit, and the card reads `STORE`

#### Scenario: Cancelling a placement does not turn the page
- **WHEN** the player enters placement mode and presses `<Esc>`
- **THEN** the card returns with no page turn

### Requirement: Item text is printed in full
The store card SHALL print the blurb of the selected item only, on one
full-width line, and every blurb in `ITEMS` SHALL fit that line without
truncation. A row whose owned count is at its cap SHALL read `full`; a row the
wallet cannot afford SHALL read `--` and print its price in the warning
colour. No row SHALL carry a truncated blurb.

#### Scenario: Every blurb fits
- **WHEN** `ITEMS` and `manifestCard` are measured against `CARD_LINE`
- **THEN** no string exceeds it

#### Scenario: Full is not the same as unaffordable
- **WHEN** `charges.dd` is at `chargeCap.dd` and the wallet covers the price
- **THEN** the `dd` row reads `full` and its price is not in the warning colour
