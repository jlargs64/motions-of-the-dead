## ADDED Requirements

### Requirement: Word pack registry in the sim
The sim SHALL define a registry of word packs, each with pools for walkers, runners, bloaters and crawlers and an optional armorable pool. Pack ids SHALL be `horror`, `go`, `python`, `c`, `rust`, `javascript`, `polyglot`, `memes`, `corporate`, `lovecraft`, `shakespeare`. `horror` SHALL be the default and SHALL equal the current vocabulary.

#### Scenario: Default unchanged
- **WHEN** the horror pack's pools are compared with the pre-change constant arrays
- **THEN** they are identical

### Requirement: Entries are single Vim words
Every entry in every pool SHALL match `^[A-Za-z0-9_]+$`. No entry SHALL contain whitespace, brackets, quotes, backticks or any other punctuation.

#### Scenario: Content rule test
- **WHEN** the pack test iterates every entry of every pack
- **THEN** every entry matches the pattern

#### Scenario: One word per zombie
- **WHEN** 500 zombies are spawned from each pack and `w` is resolved from the first cell of each on an otherwise empty lane
- **THEN** the cursor lands past the end of that zombie's text in every case

### Requirement: Pools respect the kind rules
Crawler entries SHALL be exactly 1 character. Runner entries SHALL be 2 to 5 characters. Walker entries SHALL be 3 to 7 characters. Bloater entries SHALL be 8 to 12 characters. The armorable pool SHALL be non-empty and every entry at most 6 characters. Each pool SHALL have at least 8 entries, crawlers at least 6.

#### Scenario: Length rules
- **WHEN** the pack test measures every pool of every pack
- **THEN** every entry is within its kind's length range and every pool meets its minimum size

### Requirement: Armor wraps stay the same
Armored zombies SHALL be formed by wrapping an armorable entry in one of the existing wrap pairs `()`, `[]`, `{}`, `""`, `''`, regardless of pack.

#### Scenario: Armored from a language pack
- **WHEN** an armored zombie spawns on the rust pack
- **THEN** its text is a wrap pair around a rust armorable entry, for example `(unwrap)`

### Requirement: Pack is run config and is replayable
The selected pack id SHALL be stored in `SimState` as an additive optional field defaulting to `horror`, SHALL be set before the first spawn of a run, SHALL be accepted by the headless `Game` constructor, SHALL be written on the harness `init` log line, and SHALL be read back by the replay and browser replay scripts. Logs without the field SHALL replay as `horror`.

#### Scenario: Deterministic non-default pack
- **WHEN** seed 1 is played headless on the rust pack twice with the same inputs
- **THEN** the event streams and final states are identical

#### Scenario: Browser matches headless
- **WHEN** a log recorded on the memes pack is replayed through the built bundle
- **THEN** the final `GameState` is byte-identical to the headless replay

#### Scenario: Legacy log
- **WHEN** a log whose `init` line has no `wordPack` is replayed
- **THEN** the horror pack is used

### Requirement: Existing verification stays on the default pack
The smoke bot, the checked-in baseline replay logs and all pre-existing tests SHALL run on the horror pack and SHALL produce the same results as before this change.

#### Scenario: Smoke unchanged
- **WHEN** `npm run smoke` runs
- **THEN** the bot reaches wave 6 on seed 1 exactly as before

### Requirement: Content policy for the memes pack
The memes pack SHALL contain only PG-13 internet vocabulary, SHALL contain no slurs, no trademarked character names and no entry that targets a group of people.

#### Scenario: Review checklist
- **WHEN** the memes pack is changed
- **THEN** the pull request records that each entry was checked against the content policy
