## ADDED Requirements

### Requirement: Item table
The sim SHALL define every store item in one table `ITEMS` in `src/sim/store.ts` with id, name, one-line blurb, price, owned cap and kind (`instant` or `trap`). Prices SHALL be tunable constants. The initial ids SHALL be `dd`, `D`, `bandolier`, `whetstone`, `repeater`, `planks`, `sandbags`, `flare`, `wire`, `tripwire`, `fence`, `minefield`, `spotter`, `manifest`, `secondwind`. The table SHALL NOT contain any item that permanently changes speed, waste allowance, lane count or aiming.

#### Scenario: Table is complete
- **WHEN** `ITEMS` is read
- **THEN** it contains exactly the fifteen ids above, each with a positive price and an ASCII name and blurb

### Requirement: Bandolier
Buying Bandolier SHALL raise both `chargeCap.dd` and `chargeCap.D` by one, at most three times per run, and SHALL NOT itself add charges.

#### Scenario: Cap raised
- **WHEN** `chargeCap` is `{ dd: 2, D: 3 }` and the player buys Bandolier
- **THEN** `chargeCap` is `{ dd: 3, D: 4 }` and `charges` is unchanged

### Requirement: Whetstone
Buying Whetstone SHALL set `wasteBonus` to 1 so that `chargeKindFor` uses an allowance of `WASTE_ALLOWANCE + 1` during the next night only. `startWave` for the night after that SHALL reset `wasteBonus` to 0.

#### Scenario: One night only
- **WHEN** Whetstone is bought after night 4 and a command wastes exactly 5 cells during night 5
- **THEN** no charge is spent during night 5, and the same command during night 6 spends a `D` charge

### Requirement: Repeater
Buying Repeater SHALL bank one free repeat, up to three. When a `.` command would spend a charge and `freeRepeat` is positive, the sim SHALL decrement `freeRepeat` and SHALL NOT spend the charge.

#### Scenario: Free repeat
- **WHEN** `freeRepeat` is 1, `charges.D` is 1, and the player repeats a `D` with `.`
- **THEN** the kill resolves, `charges.D` is still 1 and `freeRepeat` is 0

### Requirement: Planks and Sandbags
Planks SHALL restore 25 barricade HP, never above `maxHp`. Sandbags SHALL raise `maxHp` by 10 and `hp` by 10, at most five times per run.

#### Scenario: Planks clamp
- **WHEN** the wall is at 90 of 100 and the player buys Planks
- **THEN** the wall is at 100 of 100

#### Scenario: Sandbags
- **WHEN** the wall is at 40 of 100 and the player buys Sandbags
- **THEN** the wall is at 50 of 110

### Requirement: Flare
Buying Flare SHALL set `flare` so that the next `startWave` multiplies every queued spawn speed by 0.7 and then clears the flag. Runners SHALL keep their 2x relation to the reduced base.

#### Scenario: Slowed night
- **WHEN** Flare is bought after night 5 and `baseSpeed(6)` is 1.82
- **THEN** every walker queued for night 6 has speed 1.274 and every runner 2.548, and night 7 spawns at full speed

### Requirement: Barbed wire
Barbed wire SHALL be placed per lane through placement mode with the column fixed at the wall. When a zombie on a wired lane would first hit the barricade, the sim SHALL clear that lane's wire and hold the zombie in place for one second before it advances again. Wire SHALL persist across nights until consumed.

#### Scenario: One second hold
- **WHEN** lane 4 is wired and a zombie on lane 4 reaches the wall at `sim.time` 10000
- **THEN** the barricade takes no damage until `sim.time` 11000, and lane 4 is no longer wired

### Requirement: Spotter
Buying Spotter SHALL set `spotter` to 3. While `spotter` is positive the renderer and `text()` SHALL show the oracle's cheapest command for the zombie nearest the wall, and each `kill` SHALL decrement `spotter`.

#### Scenario: Hint shown and consumed
- **WHEN** Spotter is bought and the next wave has a walker at lane 2 column 40 nearest the wall
- **THEN** `text()` contains `SPOTTER` followed by the keys `optimalKill` returns, and after three kills the line is gone

### Requirement: Manifest
Buying Manifest SHALL reveal the next night's size, base speed and composition percentages in the store card and the `MANIFEST` text line for the remainder of that store visit. The preview SHALL be computed from `waveSize`, `baseSpeed` and `composition` without consuming RNG.

#### Scenario: Preview is deterministic
- **WHEN** Manifest is bought after night 7
- **THEN** the `MANIFEST` line reads `night 8: 22 bodies` with the speed and percentages from the pure wave functions, and `sim.rngState` is unchanged

### Requirement: Second Wind
Buying Second Wind SHALL bank one revive. When the barricade reaches 0 HP with `secondWind` set, the sim SHALL set HP to 30, clear the flag, emit `{ t: 'revive' }`, break the combo, and SHALL NOT enter phase `dead`.

#### Scenario: Revive
- **WHEN** `secondWind` is set and a bloater brings the wall to 0
- **THEN** `phase` is `playing`, the wall is at 30 HP, `revive` is emitted, and a second breach ends the run
