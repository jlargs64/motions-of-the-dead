## ADDED Requirements

### Requirement: Junk-heap barricade
The barricade SHALL be drawn as a leaning heap spanning approximately columns 50.0 to 55.0 across all 16 lanes, composed per lane of 2 to 3 planks at deterministic angles between -18 and +18 degrees plus one large prop per group of lanes: chain-link panel (lanes 0..2), car door (lanes 3..5), fridge (lanes 8..10), tyre stack (lanes 13..15). The heap MUST be identical on every frame for a given barricade state.

#### Scenario: Deterministic heap
- **WHEN** two frames are rendered with the same barricade HP
- **THEN** every plank angle, prop and splinter is in the same position

#### Scenario: Props by lane group
- **WHEN** the barricade is at full HP
- **THEN** a lattice is visible in lanes 0..2, a tyre stack in lanes 13..15, and planks are present in every lane

### Requirement: Per-lane degradation and breach
The heap SHALL degrade per lane according to the existing wall level 4..0 from `barricadeGlyphs`: level 4 draws all material; level 3 drops one plank; level 2 reduces the prop to an outline and adds splinters; level 1 leaves a single plank stub; level 0 is a breach showing the void, plank stubs, and a red glow.

#### Scenario: Failure order follows the glyph ramp
- **WHEN** barricade HP falls to 40% of max
- **THEN** the lanes `barricadeGlyphs` marks as breached (lane 0 first, per the frozen field contract) show breaches or stubs while the lanes it marks `#` remain at level 4

#### Scenario: Breach glow
- **WHEN** a lane's level is 0
- **THEN** that lane shows void, two stubs and a red glow, and no barbed wire

### Requirement: Dressing and caking
Sandbags SHALL pile at the foot of the heap in lanes 12..15, barbed wire SHALL run across intact lanes only, and accumulated wall gore SHALL cake the base per lane exactly as today, gated by gore level.

#### Scenario: Gore off
- **WHEN** gore is `off`
- **THEN** no blood caking is drawn on the heap, but sandbags, wire and planks are unchanged

### Requirement: East set
The baked back layer SHALL show, east of the heap, a narrow paving strip, a dark house wall from approximately column 55.5 to 60 with one lit window in rows -2..4, and the floodlight post whose lamp head is the origin of the scene light. The oil drums and crates SHALL be removed.

#### Scenario: House wall present
- **WHEN** the scene is baked
- **THEN** the region east of column 55.5 is a dark wall tone with one lit window and a post, and no drums or crates are drawn
