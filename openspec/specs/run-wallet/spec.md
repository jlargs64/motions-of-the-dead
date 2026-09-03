# run-wallet Specification

## Purpose
The `supplies` number: how it accrues, how it resets, and how it is exposed.
Score is the record and is never spent; supplies are the money, earned
alongside score and spent by the survival store. It is part of `GameState`
because a wallet the store can spend has to survive a replay, and it is
written only by `src/sim` because the browser and the headless run must agree
on it byte for byte.

Filled by `medals`; spent by `survival-store`.
## Requirements
### Requirement: supplies is an additive GameState field
`GameState` SHALL gain `supplies: number`, initialised to 0 in `createState`, and it SHALL be written only by `src/sim`.

#### Scenario: Fresh state
- **WHEN** `createState(seed)` is called
- **THEN** `state.supplies` is 0

### Requirement: Supplies accrue per kill and per medal, separately from score
On each kill the sim SHALL add the killed zombie's text length to `supplies`. On each medal the sim SHALL add that medal's `bonus` to `supplies`. `score` SHALL continue to follow the existing formula and SHALL never be reduced by anything in this change.

#### Scenario: Plain kill
- **WHEN** a 5-letter walker is killed with combo 1
- **THEN** `score` rises by 55 and `supplies` rises by 5

#### Scenario: Medal bonus
- **WHEN** a `TRIPLE KILL` medal is emitted
- **THEN** `supplies` rises by the medal table's TRIPLE KILL bonus in addition to the per-kill amounts

### Requirement: Supplies reset with the run
`Sim.start()` SHALL set `supplies` to 0. When the warm-up rolls into wave 1 the sim SHALL set `supplies` to 0 along with score and kills.

#### Scenario: Warm-up cannot bank supplies
- **WHEN** a player earns supplies during the warm-up and it rolls into wave 1
- **THEN** `supplies` is 0 at the start of wave 1

### Requirement: Supplies are visible to agents and players
`text()` SHALL print a `SUPPLIES <n>` field alongside `SCORE`, and the HUD SHALL show the supplies count in the status block.

#### Scenario: Harness text
- **WHEN** `supplies` is 42
- **THEN** `text()` contains `SUPPLIES 42`

### Requirement: Payout tables live in one module
Per-kill, per-tier and per-style payouts SHALL be exported constants in `src/sim/medals.ts`, and tests SHALL assert payouts by reading those constants rather than literal numbers.

#### Scenario: Table is the source of truth
- **WHEN** the TRIPLE KILL bonus constant is changed
- **THEN** the multi-kill payout test still passes without edits

