# hud chrome

## Purpose
Renderer requirements for the hud chrome of the Last Stand visual pass (see openspec/changes/archive).

## Requirements

### Requirement: NIGHT label
The HUD SHALL label the current wave as `NIGHT n`, matching the title card, wave card and death summary. The string `WAVE` SHALL NOT appear anywhere in the rendered game.

#### Scenario: Label text
- **WHEN** `state.wave` is 3
- **THEN** the HUD shows `NIGHT 3`

### Requirement: Top-left status block
The HUD SHALL draw, top-left in the sky band (rows approximately -5.4..-3.2, columns 0.5..14), the NIGHT label, a barricade bar with deterministic crack lines whose fill is proportional to HP and whose colour turns amber at or below 50% and bright blood at or below 25%, the HP numeral, and a magazine strip showing the `dd` and `D` charge counts. The mute glyph SHALL sit to the right of the NIGHT label when muted.

#### Scenario: Bar colour thresholds
- **WHEN** barricade HP is 50, 49 and 25 of a max 100
- **THEN** the bar is white at 50, amber at 49, and bright blood at 25

#### Scenario: Charges shown
- **WHEN** `charges.dd` is 2 and `charges.D` is 3
- **THEN** the magazine strip shows `2` beside `dd` and `3` beside `D`

### Requirement: Zombies-remaining strip
The HUD SHALL draw a thin strip along the top edge (row approximately -5.7, columns 16..44) whose fill is proportional to the zombies not yet killed in the current wave.

#### Scenario: Strip drains
- **WHEN** a wave of 14 has 7 killed
- **THEN** the strip is half full, and after all 14 are killed it is empty

### Requirement: Combo counter relocates
The combo counter SHALL be drawn bottom-anchored at row -2.6 with its left edge at column 46, growing upward, and SHALL not overlap the zombies-remaining strip.

#### Scenario: No collision at max scale
- **WHEN** combo is 18 or higher
- **THEN** the combo glyphs stay within columns 46..59 and rows -5.5..-2.6

### Requirement: Film grain and vignette
The baked front layer SHALL include a static grain field with alpha between 0.04 and 0.06 whose grain size scales with the cell height, under a radial vignette reaching alpha 0.32 at 62% of the radius and 0.74 at the corners. Both SHALL be present at every gore level and MUST NOT shake with the camera.

#### Scenario: Front layer is one blit
- **WHEN** a frame is rendered
- **THEN** grain and vignette are delivered by the single front-layer `drawImage`, with the shake transform undone

### Requirement: Death card headline
The death card headline SHALL read `YOU DID NOT SURVIVE THE NIGHT`.

#### Scenario: Death text
- **WHEN** the phase becomes `dead`
- **THEN** the death card's first line is `YOU DID NOT SURVIVE THE NIGHT` and the existing summary line and ledger remain
