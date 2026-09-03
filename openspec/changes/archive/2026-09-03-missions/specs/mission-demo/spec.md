## ADDED Requirements

### Requirement: Demo is a keystroke string run through the engine
Each mission's `demo` SHALL be a `DemoScript`: a keystroke string in the engine's notation (`<Esc>`, `<CR>` for specials), a pane-sized spawn list (every column under `DEMO_COLS`), a start cursor and an optional goal override. The select screen's pane (`MissionDemo`) SHALL feed one key every `DEMO_KEY_MS` through a real `VimEngine` into its own `Sim`, so the engine state machine and `resolve()` run for real and the live `GameState` is never touched.

#### Scenario: Keys are fed on the pane clock
- **WHEN** a mission with demo `dw` is loaded and `advance(DEMO_KEY_MS * 2)` is called
- **THEN** `position` is 2 and the walker has been killed by the engine, not removed directly

#### Scenario: Determinism
- **WHEN** the same mission demo is advanced twice from a fresh pane with identical calls
- **THEN** the two pane states are byte-identical

### Requirement: Demo loops until Enter
When the demo string is exhausted the pane SHALL rest `DEMO_LOOP_MS`, then respawn the scene, reset the cursor to the start cursor and set `position` to 0. Enter on the list starts the mission's TRY beat full-screen.

#### Scenario: Loop
- **WHEN** a demo of 2 keys has finished and `DEMO_LOOP_MS` more time passes
- **THEN** the scene is respawned and `position` is 0

### Requirement: Lit keycaps
The pane SHALL light each keycap on the strip once the demo has pressed it; lit keycaps stay lit until the loop resets. The `{n}` keycap SHALL light when any digit has been pressed.

#### Scenario: Lighting follows the demo
- **WHEN** the strip shows keycaps `d` `w` and the demo `dw` has fed 1 key
- **THEN** keycap `d` is lit and keycap `w` is lit only after the second key

### Requirement: Every demo clears its goal
A test SHALL load every mission into a pane, run its demo string to the end, and assert the demo's goal (its override, else the mission's) is met. The test SHALL also assert every keycap in `keys` lights, every demo scene fits `DEMO_COLS` and at most four lanes.

#### Scenario: Demo test passes for the whole table
- **WHEN** the demo test runs over `MISSIONS`
- **THEN** every mission reaches its goal within one pass of its demo and no assertion fails

#### Scenario: Keycaps are demonstrated
- **WHEN** a mission's `keys` contains `$`
- **THEN** its `demo.keys` contains `$`
