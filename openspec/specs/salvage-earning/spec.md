# salvage-earning Specification

## Purpose
How medals turn into lifetime salvage, the currency that outlives a run. Every
medal credits salvage through the `player-save` module - the rung number for a
multi-kill, 1 for a style medal, 5 for FIRST BLOOD - and nothing resets it, not
a new run and not a death.

FIRST BLOOD is the exception that shapes this capability: it fires on the first
*lifetime* kill made with a motion, which the sim cannot know without reading
the save, so it is judged in the browser layer and pays salvage only.

Filled by `medals`; persisted by `player-save`; spent by `armory`.
## Requirements
### Requirement: Medals credit lifetime salvage
Every `medal` event observed in the browser layer SHALL credit lifetime salvage through the save module: the tier number for a multi-kill medal, 1 for a style medal, 5 for FIRST BLOOD. Salvage SHALL never be reset by a new run or a death.

#### Scenario: Credit on medal
- **WHEN** a `KILLTACULAR` medal is emitted during a run
- **THEN** persisted salvage increases by 5

#### Scenario: Death keeps salvage
- **WHEN** the run ends in death
- **THEN** salvage persisted before death is unchanged and salvage earned in that run is retained

### Requirement: FIRST BLOOD is a browser-layer medal, earned on a kill
The `Ledger` SHALL emit `{ t: 'medal', name: 'FIRST BLOOD', bonus: 0 }` the first time a motion or operator token takes a kill across the player's lifetime, at most once per kill, and SHALL credit salvage for it. It SHALL NOT fire on a keypress that takes no kill, so plain movement never earns it. The sim SHALL never emit FIRST BLOOD, and it SHALL never change `supplies`.

#### Scenario: First lifetime kill with f
- **WHEN** the save shows `f` with 0 kills and the player kills a zombie with `fx`
- **THEN** one FIRST BLOOD medal is emitted and `supplies` is unchanged by it

#### Scenario: Not repeated
- **WHEN** the player kills with `fx` again in the same or a later run
- **THEN** no FIRST BLOOD is emitted for `f`

#### Scenario: Movement is not first blood
- **WHEN** the player presses a token for the first time and it takes no kill
- **THEN** no FIRST BLOOD is emitted, and the token's `used` count still rises

#### Scenario: One per kill
- **WHEN** a kill is made with a command whose tokens are all new
- **THEN** exactly one FIRST BLOOD is emitted, not one per token

### Requirement: Salvage persistence is delegated
Salvage SHALL be read and written only through the `player-save` module's API. If `player-save` is not yet present, the credit function SHALL persist under the ledger's existing storage key and the decision SHALL be recorded in DECISIONS.md for migration.

#### Scenario: Reload keeps salvage
- **WHEN** the page is reloaded after earning salvage
- **THEN** the persisted salvage total is the same as before reload

