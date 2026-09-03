# scene lighting

## Purpose
Renderer requirements for the scene lighting of the Last Stand visual pass (see openspec/changes/archive).

## Requirements

### Requirement: Single baked light source
The scene SHALL have exactly one light source, a floodlight on the barricade side, baked into the static back layer as a cone whose brightness falls off westward, with the western edge of the field reaching near-black by column 4. The bake MUST NOT be recomputed per frame.

#### Scenario: Back layer shows the cone
- **WHEN** the scene is baked at any viewport size
- **THEN** the back layer is brightest within 10 columns west of the barricade and darkest at column 0, and the back layer is drawn with one `drawImage` per frame

#### Scenario: Lighting is independent of gore level
- **WHEN** gore is set to `off`, `low` or `full`
- **THEN** the light cone and westward darkening are identical across all three levels

### Requirement: Light table
The renderer SHALL maintain a light table of 60 values in the range 0..1, one per column, built in `resize()` from the same falloff function as the bake, and SHALL use it to select figure shading.

#### Scenario: Table matches the bake
- **WHEN** the light table is built
- **THEN** it is monotonically non-decreasing from column 0 to the light's column, with `lightAt[0] <= 0.15` and `lightAt[48] >= 0.85`

#### Scenario: No per-frame allocation
- **WHEN** a frame is rendered
- **THEN** the light table is read but not rebuilt

### Requirement: Figure shading from the light table
Each zombie figure SHALL be drawn with a shade derived from the light table at its centre column, selecting body and rim colours from a pre-baked ramp of at least 6 steps. Words MUST NOT be shaded.

#### Scenario: Dark at spawn, lit at the wall
- **WHEN** a walker is at column 2 and another identical walker is at column 46
- **THEN** the column-2 figure uses a darker ramp step than the column-46 figure, and both words render in their normal full-contrast colour

### Requirement: Muzzle flash lights nearby figures
During the muzzle-flash window of a shot, figures whose centre column is within 6 columns of the covered span's near end and whose lane is within 1 lane of the shot row SHALL be drawn at a brighter shade than the light table alone gives, decaying with the flash.

#### Scenario: Flash boost
- **WHEN** a `shot` event fires on lane 5 covering columns 30..34 and a figure stands at column 28 on lane 6
- **THEN** for the duration of the muzzle flash that figure's shade is greater than its resting shade, and a figure at column 10 on lane 5 is unaffected

#### Scenario: Boost expires
- **WHEN** the muzzle flash timer reaches zero
- **THEN** all figures return to their light-table shade
