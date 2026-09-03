# field surface

## Purpose
Renderer requirements for the field surface of the Last Stand visual pass (see openspec/changes/archive).

## Requirements

### Requirement: No lane banding
The baked back layer SHALL NOT paint alternating per-lane stripes. Ground texture SHALL instead include 3 to 4 trodden ruts at deterministic rows that do not align with lane boundaries.

#### Scenario: Stripes gone
- **WHEN** the scene is baked
- **THEN** no rectangle aligned to a lane's top and bottom edge spanning the field width is drawn, and ruts are present

### Requirement: Gutter without scrim
The line-number gutter SHALL draw without a scrim pill, from the glyph atlas at cell scale (the atlas has one size; a fractional scale would fall back to per-frame `fillText`), in the dim palette colour with a one-pixel dark offset copy for legibility, and the current lane's number SHALL remain amber. The `lineNumbers` setting and its default of `relative` SHALL be unchanged.

#### Scenario: Relative numbers still count
- **WHEN** the cursor is on lane 6 with `lineNumbers` at `relative`
- **THEN** lane 6 shows its absolute number in amber and lane 9 shows `3`

#### Scenario: Off hides the gutter
- **WHEN** `lineNumbers` is `off`
- **THEN** no gutter text is drawn

### Requirement: Cursor lane tint remains the lane cue
The faint amber tint across the cursor's lane SHALL be retained as the primary `j`/`k` feedback.

#### Scenario: Lane tint follows cursor
- **WHEN** the cursor moves from lane 2 to lane 3
- **THEN** the lane tint moves from lane 2 to lane 3 on the next frame
