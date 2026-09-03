## ADDED Requirements

### Requirement: Supplies and trap readout
The top-left status block SHALL show `SUPPLIES n` beneath the magazine strip while `phase` is `shop` or `playing` in survival mode, and SHALL show `TRAPS n` beside it when `traps` is non-empty. Both strings SHALL stay within columns 0.5..14 and SHALL NOT overlap the zombies-remaining strip.

#### Scenario: Readout present
- **WHEN** `supplies` is 240 and two traps are planted during play
- **THEN** the HUD shows `SUPPLIES 240` and `TRAPS 2` within the status block bounds

## MODIFIED Requirements

### Requirement: Supplies readout
The top-left status block SHALL show the run's `supplies` count on its own row
beneath the magazine strip, labelled `SUPPLIES`, and it SHALL update on every
change. This replaces the abbreviated `SUP` beside the magazine strip: the
store made the wallet the number the player plans around, and the trap count
needs the column the abbreviation was borrowing (DECISIONS #77).

#### Scenario: Wallet updates
- **WHEN** `state.supplies` changes from 40 to 55
- **THEN** the status block shows `SUPPLIES 55` on the next frame

#### Scenario: Status block still clears the callout stack
- **WHEN** `supplies` is 9999999
- **THEN** `HUD_BOUNDS.hudReach` is at or left of `CALLOUT_BAND.col0`
