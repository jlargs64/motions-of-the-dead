## ADDED Requirements

### Requirement: Multi-kill medals are judged per command
The sim SHALL award exactly one multi-kill medal when a single command kills two or more zombies, named by the number of victims in that command's plan: 2 DOUBLE KILL, 3 TRIPLE KILL, 4 OVERKILL, 5 KILLTACULAR, 6 KILLTROCITY, 7 KILLIMANJARO, 8 KILLTASTROPHE, 9 KILLPOCALYPSE, 10 or more KILLIONAIRE. Victims of `J` crushes and `dd`/`D` splash SHALL count. Kills that are consecutive but come from separate commands SHALL NOT earn a multi-kill medal.

#### Scenario: d3w across three walkers
- **WHEN** three adjacent walkers share a lane and the player fires `d3w` from the first one
- **THEN** one `medal` event with name `TRIPLE KILL` is emitted after the three `kill` events

#### Scenario: Two separate dw kills
- **WHEN** the player kills one walker with `dw`, then within 2.5 s kills another with `dw`
- **THEN** the combo reaches 2 and no multi-kill medal is emitted

#### Scenario: dd on a crowded lane
- **WHEN** a lane holds five walkers and the player fires `dd` on it with a charge available
- **THEN** one `medal` event with name `KILLTACULAR` is emitted

### Requirement: Medal events are additive to the frozen event contract
`GameEvent` SHALL gain `{ t: 'medal'; name: string; bonus: number }` and `{ t: 'kill_judged'; zombieId: number; spent: number; optimal: string | null }` as additive variants. Every string in a medal name SHALL be printable ASCII.

#### Scenario: Names are renderable
- **WHEN** every medal name in the medal table is checked against the glyph atlas range 32..127
- **THEN** all characters are in range

### Requirement: PERFECT is judged against the oracle
The sim SHALL snapshot the field (zombies, cursor, charges) at the first command after run start or after a kill, count keystrokes from that command, and on the next kill compare the count to `optimalKill` from the snapshot for the killed zombie. When the count is less than or equal to the oracle's length the sim SHALL emit a `PERFECT` medal. A kill whose `via` starts with `trap:` SHALL NOT be judged. In all cases it SHALL emit `kill_judged` with the keystrokes spent and the oracle's keystring or `null`. Only the first kill of a sequence SHALL be judged; later victims of the same command and kills before a new anchor are not.

#### Scenario: Optimal single kill
- **WHEN** the crosshair is one `w` from a lone walker and the player types `wdw`
- **THEN** the kill emits `kill_judged` with spent 3 and optimal `wdw`, followed by a `PERFECT` medal

#### Scenario: Wasteful approach
- **WHEN** the same walker is reached with `llllllldw`
- **THEN** `kill_judged` reports spent 9 and optimal `wdw`, and no `PERFECT` medal is emitted

#### Scenario: Zombie spawned after the anchor
- **WHEN** the killed zombie is not present in the anchor snapshot
- **THEN** no `kill_judged` and no `PERFECT` are emitted for that kill and the anchor is cleared

### Requirement: SNIPE, BREACH and CALLED SHOT style medals
The sim SHALL emit `SNIPE` when the killing command's motion is `f`, `F`, `t` or `T` (including `;`/`,` expansions) and a victim was a runner; `BREACH` when the killing command uses a text object and a victim was armored at plan time; `CALLED SHOT` when the anchoring command of the sequence was a search (`/`, `?`, `*`, `#`) and the first kill of the sequence is the zombie that search landed on. A command whose plan contains an overkill SHALL earn no style medal. Multiple style medals MAY fire on one kill.

#### Scenario: Find then cut a runner
- **WHEN** a runner `dash` is in the lane and the player types `fddw`
- **THEN** a `SNIPE` medal is emitted alongside the kill

#### Scenario: Text object through armor
- **WHEN** an armored `(lurch)` is under the crosshair and the player types `da(`
- **THEN** a `BREACH` medal is emitted

#### Scenario: Search then kill
- **WHEN** the player types `/husk<CR>` and the crosshair lands on `husk`, then types `dw` on it
- **THEN** a `CALLED SHOT` medal is emitted on that kill

#### Scenario: Overkill blocks style
- **WHEN** the player kills a crawler with `dw`
- **THEN** no style medal is emitted even if the motion was a find

### Requirement: Medal judging is deterministic and headless
Medal and `kill_judged` events SHALL be produced by `src/sim` from `GameState` and inputs only. `src/sim/medals.ts` SHALL import nothing from `src/ui`, `src/render` or `src/audio`. The harness replay checker and the browser-vs-headless check SHALL produce identical medal event streams for the same log.

#### Scenario: Replay equality
- **WHEN** a run log containing multi-kill and style medals is replayed with `npm run replay`
- **THEN** the per-input event streams, including `medal` and `kill_judged`, are identical

### Requirement: The Motion Ledger consumes judging events
`Ledger` SHALL derive `wasted`, `missed` and never-used-but-optimal statistics from `kill_judged` events and SHALL NOT call `optimalKill` itself. The death screen SHALL show the same statistics it shows today.

#### Scenario: Ledger totals match
- **WHEN** a run ends after a sequence judged as spent 9, optimal `wdw`
- **THEN** the ledger reports 6 wasted keystrokes and credits `w` and `d` to the missed table if the player never used them that run
