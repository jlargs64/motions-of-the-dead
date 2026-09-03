## ADDED Requirements

### Requirement: Armory is reachable from the main menu
The main menu SHALL list an `armory` entry that opens the armory card. The card SHALL show the player's current salvage in its header and SHALL return to the main menu on `<Esc>` or `h` at the slot column.

#### Scenario: Open and close
- **WHEN** the player selects `armory` from the main menu and then presses `<Esc>`
- **THEN** the armory card is drawn, and after `<Esc>` the main menu is drawn with `armory` still focused

#### Scenario: Salvage shown
- **WHEN** the save holds 340 salvage
- **THEN** the armory header reads `SALVAGE 340`

### Requirement: Two-axis navigation
The armory card SHALL list every slot vertically and the focused slot's items horizontally. `j` and `k` SHALL move the slot focus, `h` and `l` SHALL move the item focus within the slot, `gg` and `G` SHALL jump to the first and last slot, and mouse clicks on a slot row or an item cell SHALL focus that slot or item.

#### Scenario: Slot then item
- **WHEN** the player presses `j` twice then `l` once from the first slot's default item
- **THEN** the third slot is focused and its second item is focused

#### Scenario: Focus is clamped
- **WHEN** the player presses `l` on the last item of a slot
- **THEN** the item focus does not change

#### Scenario: Mouse focus
- **WHEN** the player clicks the cell of the fourth item of the palette slot
- **THEN** the palette slot and its fourth item are focused

### Requirement: Item state is legible
Each item SHALL be drawn in one of three states: equipped (marked with `*`), owned (plain), or unowned (price shown). An unowned item the player cannot afford SHALL draw its price in the card's red ink. The default item of every slot SHALL always be owned.

#### Scenario: States
- **WHEN** the palette slot's items are moonlit (equipped), sodium (owned) and bloodmoon (unowned, 120) and the player has 90 salvage
- **THEN** moonlit shows `*`, sodium shows no marker, and bloodmoon shows `120` in red

### Requirement: Enter buys or equips
On `<CR>` or `l` past the item column, an unowned affordable item SHALL be purchased: its price is subtracted from salvage, its id is added to `unlocks`, and it becomes equipped. An owned item SHALL become equipped. An unaffordable item SHALL flash the price and change nothing. Every state change SHALL be saved through the `player-save` API immediately.

#### Scenario: Purchase
- **WHEN** the player has 200 salvage, focuses an unowned item priced 120 and presses `<CR>`
- **THEN** salvage is 80, `unlocks` contains the item id, `settings.equipped` maps the slot to the item id, and the save is written

#### Scenario: Cannot afford
- **WHEN** the player has 50 salvage, focuses an unowned item priced 120 and presses `<CR>`
- **THEN** salvage is 50, `unlocks` is unchanged, the price flashes, and nothing is saved

#### Scenario: Equip owned
- **WHEN** the player focuses an owned, unequipped item and presses `<CR>`
- **THEN** `settings.equipped` maps the slot to that item and the save is written

### Requirement: Live preview
While an item is focused the game SHALL render the idle field behind the card with that one slot temporarily set to the focused item. For word packs the card SHALL print one sample word per zombie kind from the focused pack. For sound presets the focused preset's walker kill sound SHALL play once when focus lands on it. Preview SHALL never change the saved equipped set.

#### Scenario: Palette preview
- **WHEN** the player focuses the unowned bloodmoon palette
- **THEN** the field behind the card is drawn in the bloodmoon palette and `settings.equipped.palette` is unchanged

#### Scenario: Word pack sample
- **WHEN** the player focuses the rust word pack
- **THEN** the card shows five sample words, one each labelled crawler, runner, walker, armored and bloater, all drawn from the rust pack

### Requirement: Card layout is asserted
The armory card SHALL pass the layout test: every string stays inside the panel and the 60-column grid, nothing overlaps on a row, for every slot focused and for the longest item label and price in the registry.

#### Scenario: Layout test
- **WHEN** the layout test draws the armory card with each slot focused in turn
- **THEN** no string escapes the panel and no two strings overlap
