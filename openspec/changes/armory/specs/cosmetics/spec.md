## ADDED Requirements

### Requirement: Cosmetic registry
The game SHALL define a registry of cosmetic slots, each with an ordered list of items. Slot ids SHALL be `words`, `palette`, `guns`, `crosshair`, `dissolve`, `barricade`, `survivor`, `deaths`, `sound`, `voice`. Item ids SHALL be globally unique strings of the form `<slot>.<name>`. The first item of every slot SHALL be the default with price 0. Every price SHALL be a non-negative integer.

#### Scenario: Registry shape
- **WHEN** the registry is loaded in a test
- **THEN** every slot has at least two items, every first item has price 0, and no item id appears twice

### Requirement: Equipped set resolves to defaults
The equipped set SHALL be read from `settings.equipped` in the player save. A missing slot key, or a key naming an item that is not owned, SHALL resolve to the slot's default item.

#### Scenario: Missing key
- **WHEN** `settings.equipped` has no `palette` key
- **THEN** the resolved palette is `palette.moonlit`

#### Scenario: Unowned key
- **WHEN** `settings.equipped.guns` is `guns.flame` and `unlocks` does not contain `guns.flame`
- **THEN** the resolved guns item is the default

### Requirement: Renderer style object
The renderer SHALL expose a single `style` object covering palette, crosshair, guns, dissolve, barricade and survivor. Setting `style` SHALL take effect on the next frame and SHALL not allocate inside the draw loop. Each palette SHALL be baked once at module load.

#### Scenario: Palette swap
- **WHEN** `style.palette` changes from moonlit to bloodmoon between frames
- **THEN** the next frame uses bloodmoon's colours for sky, field, barricade and HUD, and no rgba string is constructed during `drawGame`

### Requirement: Palettes
The game SHALL ship five palettes: moonlit (default), sodium, bloodmoon, terminal, paper. Every palette SHALL supply every key of the palette table. Every palette SHALL pass the render smoke at all three gore levels and the card ink contrast assertions.

#### Scenario: Complete tables
- **WHEN** the palette test iterates every palette
- **THEN** each has exactly the same set of keys as the default

### Requirement: Crosshair glyphs
The crosshair slot SHALL offer block (default), underscore, bracket pair and beam. The crosshair SHALL keep its lock-on behaviour and its amber colour in every glyph; only its shape changes.

#### Scenario: Beam
- **WHEN** the beam crosshair is equipped and the crosshair is locked on a word
- **THEN** a one-cell-wide vertical bar is drawn at the locked column and the lock still rides the word

### Requirement: Guns
The guns slot SHALL map each operator to a tracer shape, a muzzle style and a shot sound. Sets: field (default), pistols, shotguns, flame, bow. Guns SHALL change only the `shot` visual and sound. The resolved span, the kills and the charge cost of every command SHALL be identical across gun sets.

#### Scenario: Cosmetic only
- **WHEN** the same replay log is run with the field set and the flame set
- **THEN** the final `GameState` is byte-identical

#### Scenario: Operator keyed
- **WHEN** the shotguns set is equipped and the player fires `dd`
- **THEN** the tracer is drawn as a spread across the lane and the shotgun sound plays

### Requirement: Kill dissolves
The dissolve slot SHALL offer chunks (default), ash, static, redacted. Gore level SHALL still govern blood and gibs; dissolve governs how the word's glyphs leave the field. With gore `off`, every dissolve SHALL remain a clean, bloodless effect.

#### Scenario: Ash under gore off
- **WHEN** gore is off and the ash dissolve is equipped and a walker dies
- **THEN** its glyphs drift upward and fade with no blood deposited on the field

### Requirement: Barricade materials and survivor silhouettes
The barricade slot SHALL offer timber (default), sandbags, bookshelves, hash wall. The survivor slot SHALL offer at least three silhouettes. The wall's HP ramp and the survivor's height SHALL be unchanged by the choice.

#### Scenario: Ramp preserved
- **WHEN** the hash wall is equipped and barricade HP is 40 of 100
- **THEN** the wall renders 40 percent of its ramp intact, exactly as timber would

### Requirement: Sound presets
The sound slot SHALL offer field (default), arcade, hush, typewriter. A preset SHALL define the kill profile per zombie kind, the key click and the shot sounds. Changing preset SHALL not require an audio unlock or a page reload.

#### Scenario: Preset swap while playing
- **WHEN** the player equips arcade and returns to a run
- **THEN** the next kill uses the arcade walker profile

### Requirement: Callout voices and death line packs
The voice slot SHALL offer announcer (default), vim, deadpan and SHALL supply the text for every medal defined by `medals-and-wallet`. The deaths slot SHALL offer the default pool plus at least two packs whose lines are unioned with the reactive death lines when equipped. All strings SHALL be printable ASCII.

#### Scenario: Vim voice
- **WHEN** the vim voice is equipped and a triple kill medal fires
- **THEN** the callout text is the vim voice's string for that medal, for example `3 fewer lines`

#### Scenario: ASCII enforced
- **WHEN** the ASCII test iterates every voice and death pack
- **THEN** every character is in the range 32..126

### Requirement: Affordable-unowned count
The registry SHALL expose the number of unowned items the player can currently afford, for the main menu badge.

#### Scenario: Badge count
- **WHEN** the player has 130 salvage and the unowned items cost 60, 120, 150
- **THEN** the count is 2
