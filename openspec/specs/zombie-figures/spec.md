# zombie figures

## Purpose
Renderer requirements for the zombie figures of the Last Stand visual pass (see openspec/changes/archive).

## Requirements

### Requirement: Tall silhouette figures
Zombie figures SHALL be drawn as dark silhouettes with a lit rim on the east edge, with heights in cells of approximately 3.2 (walker, armoured), 3.0 (runner), 3.35 (bloater) and 1.1 (crawler), each scaled per zombie by a deterministic factor in 0.9..1.1 derived from the zombie id.

#### Scenario: Height by kind
- **WHEN** `figureHeightCells` is queried for each kind index
- **THEN** walker and armoured return >= 3.0, runner >= 2.8, bloater >= 3.2, crawler <= 1.3

#### Scenario: Per-zombie variation is stable
- **WHEN** the same zombie id is drawn on two consecutive frames
- **THEN** its height scale, hunch, hem shape and head shape are identical on both frames

### Requirement: Words are never occluded by figures
All figures for all 16 lanes SHALL be drawn before any word, every word SHALL sit on its own scrim with core alpha >= 0.70, and a figure's head top SHALL sit at least 1.05 cells below its word's row.

#### Scenario: Head clearance
- **WHEN** a figure is drawn for a zombie on row r
- **THEN** the top of its head is at or below row r + 1.05

#### Scenario: Stacked lanes
- **WHEN** zombies occupy the same columns on lanes 3 and 5
- **THEN** the lane-5 word is fully legible over the lane-3 figure that hangs into lane 5

### Requirement: Kind is readable from the silhouette
Each figure kind SHALL be distinguishable by shape alone: armoured carries a chest plate in the bracket green, runner leans at least 20% forward with a longer stride, bloater is at least 0.7 of its height wide with a distended gut, crawler is prone.

#### Scenario: Armoured plate
- **WHEN** an armoured zombie is drawn
- **THEN** a plate in `#4a7c3f` is drawn across the torso, at every shade step

### Requirement: Figure draw cost budget
A figure SHALL cost no more than 10 canvas operations, and rendering a frame with 40 zombies and no particles SHALL complete within 8 ms on the render smoke harness.

#### Scenario: Smoke timing guard
- **WHEN** `npm run smoke:render` renders a frame with 40 zombies
- **THEN** the measured frame time is under 8 ms and the script exits 0

### Requirement: Survivor scale
The survivor SHALL be approximately 5.5 cells tall, stand on a raised step east of the barricade heap, and continue to aim his front arm at the cursor with the muzzle position written to the caller-owned buffer.

#### Scenario: Aim still tracks
- **WHEN** the cursor moves from lane 0 to lane 15
- **THEN** the survivor's arm angle changes and the muzzle position output changes accordingly, with `dx <= -1` in pixel space
