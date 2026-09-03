## ADDED Requirements

### Requirement: Additive phase values
`GameState.phase` SHALL accept `menu` and `shop` in addition to `title`, `playing`, `dead` and `stats`. `title` SHALL remain accepted and SHALL be treated as `menu` by the UI layer. The addition SHALL be recorded in DECISIONS.md as an additive contract change.

#### Scenario: Return to menu
- **WHEN** the sim's `toMenu()` is called from any phase
- **THEN** `phase` is `menu` and buffer, cursor, score and combo are reset as `toTitle()` reset them before

#### Scenario: Legacy alias
- **WHEN** existing code or a test calls `toTitle()`
- **THEN** the behaviour is identical to `toMenu()`

### Requirement: Simulation mode
`SimState` SHALL carry `mode`, one of `survival`, `mission`, `drill`, defaulting to `survival`. `Sim.start()` with no argument SHALL set `survival`. `startTutorial()` SHALL set `mission`. `mode` SHALL be included in `json()` so replays capture it.

#### Scenario: Default mode
- **WHEN** `start()` is called with no argument
- **THEN** `sim.mode` is `survival`

#### Scenario: Replay carries mode
- **WHEN** a run is recorded and replayed through `scripts/replay.ts`
- **THEN** the final state, including `mode`, is byte-identical

### Requirement: Menu isolation
The menu SHALL NOT read or write any `GameState` field other than `phase` for display, and SHALL enter a run only through `Sim.start(mode)` or `startTutorial()`.

#### Scenario: Determinism preserved
- **WHEN** `npm run verify` runs after the menu lands
- **THEN** tests, smoke, replay and browser replay all pass
