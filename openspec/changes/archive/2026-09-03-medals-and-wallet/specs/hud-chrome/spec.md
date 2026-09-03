## ADDED Requirements

### Requirement: Medal callout stack
The HUD SHALL draw medal callouts centered in the sky band (rows approximately -5.5..-3.0) as a stack of at most three, newest on top, each visible for about 1100 ms with a brief scale-in, at a text scale that rises with multi-kill tier. Callouts SHALL NOT overlap the combo counter or the zombies-remaining strip, and all callout text SHALL be printable ASCII.

#### Scenario: Three medals in quick succession
- **WHEN** `TRIPLE KILL`, `PERFECT` and `SNIPE` are emitted within 300 ms
- **THEN** all three are visible, stacked, and none extends outside the sky band or over the combo glyphs

#### Scenario: Fourth medal
- **WHEN** a fourth medal arrives while three are visible
- **THEN** the oldest is dropped and the newest is shown on top

### Requirement: Supplies readout
The top-left status block SHALL show the run's `supplies` count beside the magazine strip, labelled `SUP`, and it SHALL update on every change.

#### Scenario: Readout tracks state
- **WHEN** `state.supplies` changes from 40 to 55
- **THEN** the status block shows `SUP 55` on the next frame

### Requirement: Medal stings
The audio layer SHALL play a synthesized sting on each `medal` event: multi-kill stings rise in pitch and layer count with tier; style medals use a distinct two-note figure. Stings SHALL respect the mute setting and the existing voice cap.

#### Scenario: Muted
- **WHEN** sound is off and a medal is emitted
- **THEN** no sting is scheduled
