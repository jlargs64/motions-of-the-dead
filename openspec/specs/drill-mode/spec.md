# drill-mode Specification

## Purpose
The `drill` game mode: a sixty-second sprint through scenes of one drill
family, each generated from the sim RNG and accepted only when the oracle
agrees it teaches the family. Frozen horde, invulnerable wall, empty
magazine, one scene at a time; the score is kills, PERFECTs and scenes,
the best is kept in the save, and a new best pays salvage. The placement
family runs the store's real placement mode and is scored on the span.
Everything here is a sim rule, so a headless agent can play a drill and a
recorded log replays it byte for byte.

## Requirements

### Requirement: Drill mode rules
When `SimState.mode` is `drill`, the sim SHALL run a 60 000 ms clock, spawn zombies with zero speed, disable barricade damage, and set `dd` and `D` charges to 0 at the start of every scene (a drill has no magazine; see design D5). The drill SHALL end when the clock reaches zero and SHALL report `kills`, `perfect` and `scenes` cleared.

#### Scenario: Wall cannot fall
- **WHEN** a drill runs for its full duration with no input
- **THEN** barricade HP is unchanged and the drill ends by the clock

#### Scenario: Charges per scene
- **WHEN** a scene begins, whatever the charges read before it
- **THEN** `dd` and `D` are 0, and a `dd` typed in the scene is refused with a reason

### Requirement: Scenes
A drill SHALL present one scene at a time, built from the family's template with a designated target and a designated starting cursor. The scene SHALL be replaced when its target dies or when the player presses `r`. Killing a non-target zombie SHALL count as a kill and SHALL NOT clear the scene.

#### Scenario: Target dies
- **WHEN** the designated target is killed
- **THEN** `scenes` increments and the next scene is placed within the same tick

#### Scenario: Restart a scene
- **WHEN** the player presses `r` with no pending command
- **THEN** the current scene is discarded, the next scene is placed and `scenes` does not increment

### Requirement: Oracle-verified generation
Each scene SHALL be generated from the sim RNG and accepted only if one of the oracle's cheapest kills (the tie set, `optimalKills`) for the designated target from the designated cursor uses at least one token from the family's set; the `vertical` family SHALL also require a counted `j`/`k` or an absolute lane jump, and the `counts` family SHALL require the killing command itself to carry the count. The generator SHALL make at most 24 attempts per scene and on exhaustion SHALL use one of the family's fixture scenes chosen by the RNG. Every family SHALL ship at least three fixtures.

#### Scenario: Accepted scene uses the family
- **WHEN** a find-family scene is accepted
- **THEN** some `o` in `optimalKills(...)` has `tokensUsed(o.keys)` containing one of `f` `F` `t` `T`, and every such `o` costs the same as `optimalKill(...)`

#### Scenario: Acceptance rate
- **WHEN** 200 scenes are generated per family under fixed seeds in the test suite
- **THEN** every family accepts at least 30 percent of attempts

#### Scenario: Exhaustion
- **WHEN** 24 consecutive attempts are rejected
- **THEN** a fixture scene for that family is used and the drill continues

### Requirement: Determinism
A drill under a given seed SHALL produce identical scenes, kills and score for identical input, and the RNG cursor used for generation SHALL be `SimState.rngState` so `json()` is a complete snapshot.

#### Scenario: Replay
- **WHEN** a drill log is replayed through `scripts/replay.ts`
- **THEN** the per-input events and final state are identical to the original

### Requirement: Scoring and persistence
A kill of the scene's target SHALL be judged by the shared kill judgement module and SHALL increment `perfect` when judged PERFECT. At the end of a drill the result SHALL be compared to `save.drills[family].best` and, when `kills` is higher or `kills` is equal and `perfect` is higher, the best SHALL be replaced and salvage paid once.

#### Scenario: New best
- **WHEN** a drill ends with 22 kills and the stored best is 19
- **THEN** the save stores 22 with its perfect count and salvage is paid

#### Scenario: Not a best
- **WHEN** a drill ends with 15 kills and the stored best is 19
- **THEN** the save is unchanged and no salvage is paid

### Requirement: Harness support
`text()` SHALL show the drill family, seconds remaining, kills, perfect count and scenes cleared while a drill is running, and the `ZOMBIES` table SHALL mark the designated target.

#### Scenario: Agent reads the clock
- **WHEN** a drill has 41 300 ms left with 6 kills and 4 perfect
- **THEN** `text()` contains a `DRILL` line with the family, `41s`, `6` and `4`

### Requirement: Drill screens
The drills screen SHALL list every family with its best, its coach tag and the matching mission name, navigable with `j` `k` and started with `l` or Enter. The drill end card SHALL show kills, perfect count, scenes, the previous best, and offer `r` to run again and Esc to return. All strings SHALL be printable ASCII and SHALL pass the layout assertions with the longest values the save can hold.

#### Scenario: Layout holds at maximum values
- **WHEN** every family has a best of 999 kills and 999 perfect and every tag is present
- **THEN** nothing leaves its panel or overlaps on the drills screen or the end card
