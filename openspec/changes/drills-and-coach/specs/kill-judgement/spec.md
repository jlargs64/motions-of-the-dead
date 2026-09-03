## ADDED Requirements

### Requirement: Shared kill judgement module
The sim SHALL provide a module under `src/sim` that, given the field snapshot at the anchor command, the keystrokes spent since that anchor, the killed zombie and the charges available at the anchor, returns the keystrokes spent, the oracle's cheapest command, the wasted keystrokes, the tokens of the oracle command, and whether the kill was PERFECT. The module SHALL import nothing from `src/render`, `src/audio` or `src/ui`.

#### Scenario: Ledger, medal and drill agree
- **WHEN** the same anchor, keystrokes and kill are judged by the ledger, by the PERFECT medal and by drill scoring
- **THEN** all three receive identical `spent`, `optimal`, `wasted` and `perfect` values

#### Scenario: Behaviour preserved from the ledger
- **WHEN** the existing ledger test fixtures run against the ledger rewired to the module
- **THEN** every fixture passes with unchanged expected values

### Requirement: PERFECT definition
A kill SHALL be judged PERFECT when the keystrokes spent since the anchor are less than or equal to the length of the oracle's cheapest command for that target from the anchor cursor. A kill whose target spawned after the anchor SHALL NOT be judged.

#### Scenario: Matching the oracle
- **WHEN** the oracle's cheapest kill is `fzdw` and the player typed `fzdw`
- **THEN** the kill is PERFECT and wasted is 0

#### Scenario: Beating the narrowed oracle
- **WHEN** the player's keystrokes are shorter than the oracle's answer
- **THEN** the kill is PERFECT and wasted is 0

#### Scenario: One extra keystroke
- **WHEN** the oracle's cheapest kill is 4 keystrokes and the player spent 5
- **THEN** the kill is not PERFECT and wasted is 1

### Requirement: Oracle search candidates
`optimalKill` SHALL include `*`, `#`, `/<target text><CR>` and `n` chained after `*` or `/` as candidates, verified through the same dry run as every other candidate.

#### Scenario: Far sibling
- **WHEN** the cursor is on the word `rot` in lane 2 and an identical `rot` stands alone in lane 13
- **THEN** the oracle's cheapest kill for the lane 13 zombie begins with `*` or `/rot<CR>`

#### Scenario: Existing verdicts unchanged
- **WHEN** a scene contains no duplicate words and the previous best was 3 keystrokes or fewer
- **THEN** the oracle returns the same command it returned before search candidates were added
