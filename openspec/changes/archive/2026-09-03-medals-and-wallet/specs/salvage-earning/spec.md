## ADDED Requirements

### Requirement: Medals credit lifetime salvage
Every `medal` event observed in the browser layer SHALL credit lifetime salvage through the save module: the tier number for a multi-kill medal, 1 for a style medal, 5 for FIRST BLOOD. Salvage SHALL never be reset by a new run or a death.

#### Scenario: Credit on medal
- **WHEN** a `KILLTACULAR` medal is emitted during a run
- **THEN** persisted salvage increases by 5

#### Scenario: Death keeps salvage
- **WHEN** the run ends in death
- **THEN** salvage persisted before death is unchanged and salvage earned in that run is retained

### Requirement: FIRST BLOOD is a browser-layer medal
The `Ledger` SHALL emit `{ t: 'medal', name: 'FIRST BLOOD', bonus: 0 }` the first time a motion or operator token is used across the player's lifetime, at most once per command, and SHALL credit salvage for it. The sim SHALL never emit FIRST BLOOD, and it SHALL never change `supplies`.

#### Scenario: First lifetime use of f
- **WHEN** the save shows `f` used 0 times and the player types `fd`
- **THEN** one FIRST BLOOD medal is emitted and `supplies` is unchanged by it

#### Scenario: Not repeated
- **WHEN** the player types `fd` again in the same or a later run
- **THEN** no FIRST BLOOD is emitted for `f`

### Requirement: Salvage persistence is delegated
Salvage SHALL be read and written only through the `player-save` module's API. If `player-save` is not yet present, the credit function SHALL persist under the ledger's existing storage key and the decision SHALL be recorded in DECISIONS.md for migration.

#### Scenario: Reload keeps salvage
- **WHEN** the page is reloaded after earning salvage
- **THEN** the persisted salvage total is the same as before reload
