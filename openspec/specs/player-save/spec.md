# player save

## Purpose
The versioned save blob, its schema, load and save rules, migration from the legacy `motd.ledger` and `motd.settings` keys, and the merge semantics that make import and later cloud sync safe (see openspec/changes/archive).

## Requirements

### Requirement: Single versioned save blob
The game SHALL persist all player progress in one localStorage entry under the key `motd.save`, as a JSON object with an integer `version` field, `createdAt` and `updatedAt` millisecond timestamps, a random 64-bit `id` assigned at creation, and the sections `lifetime`, `salvage`, `unlocks`, `missions`, `drills`, `settings` and `entitlements`.

#### Scenario: Fresh install
- **WHEN** no `motd.save`, `motd.ledger` or `motd.settings` entry exists
- **THEN** `load()` returns a save with `version` 1, empty collections, `salvage` 0, default settings, and writes it under `motd.save`

#### Scenario: Unknown keys survive a round trip
- **WHEN** the stored blob contains a top-level key this build does not know
- **THEN** `load()` preserves it and `save()` writes it back unchanged

### Requirement: Migration from legacy keys
When `motd.save` is absent and `motd.ledger` or `motd.settings` is present, `load()` SHALL build the v1 blob from them, copying `motions`, `missed`, `runs` and `highScore` into `lifetime` and `gore` and `lineNumbers` into `settings`, SHALL write it under `motd.save`, and SHALL NOT delete or modify the legacy entries.

#### Scenario: Existing player upgrades
- **WHEN** `motd.ledger` holds a high score of 4200 and `motd.settings` holds gore `low`, and no `motd.save` exists
- **THEN** after `load()`, `motd.save` has `lifetime.highScore` 4200 and `settings.gore` `low`, and both legacy keys still hold their original strings

#### Scenario: Migration is idempotent
- **WHEN** `load()` runs a second time with `motd.save` present
- **THEN** the legacy keys are not read and the save is unchanged

### Requirement: Every write goes through one store
All progress writes SHALL go through a `SaveStore` whose `set(mutate)` applies the mutation in memory, stamps `updatedAt`, and schedules a persist on the next macrotask. The store SHALL flush pending writes on `visibilitychange` to hidden and on `beforeunload`. The `Ledger` and settings modules SHALL NOT call localStorage directly.

#### Scenario: Burst of writes
- **WHEN** `set()` is called 50 times within one frame
- **THEN** localStorage `setItem` is called once, after the frame, with the final state

#### Scenario: Tab hidden
- **WHEN** a write is pending and the document becomes hidden
- **THEN** the write is flushed before the visibility handler returns

### Requirement: Storage failures never throw
`load()` and `save()` SHALL catch every localStorage error, including a missing `localStorage` global, and SHALL fall back to an in-memory save so the game remains playable.

#### Scenario: Node harness
- **WHEN** `globalThis.localStorage` is undefined
- **THEN** `load()` returns a default save and later `set()` calls succeed without persisting

#### Scenario: Quota exceeded
- **WHEN** `setItem` throws
- **THEN** the in-memory save keeps the new value and no exception escapes

### Requirement: Merge semantics
The save module SHALL expose `merge(local, incoming, mode)` where `mode` is `merge` or `replace`. In `merge` mode: counters (`lifetime.motions.*.used`, `lifetime.motions.*.kills`, `lifetime.missed.*`, `lifetime.kills`, `lifetime.medals.*`, `salvage`) SHALL sum; `lifetime.highScore`, `missions.*.stars` and `drills.*.best` SHALL take the maximum; `missions.*.bestKeys` SHALL take the minimum; `unlocks` SHALL union; `lifetime.runs` SHALL concatenate, dedupe on `at`, sort ascending by `at`, and keep the last 40; `settings` SHALL keep the local copy; `createdAt` SHALL take the minimum. In `replace` mode the incoming save SHALL be used wholesale after validation. In both modes `updatedAt` SHALL be set to now and `id` SHALL keep the local value.

#### Scenario: Two devices merge
- **WHEN** local has `lifetime.kills` 100, `highScore` 900, `unlocks` `[a]` and incoming has `kills` 40, `highScore` 1200, `unlocks` `[b]`
- **THEN** the result has `kills` 140, `highScore` 1200, `unlocks` `[a, b]`

#### Scenario: Mission best keystrokes
- **WHEN** local `missions.m3.bestKeys` is 9 and incoming is 7
- **THEN** the merged value is 7

#### Scenario: Runs dedupe
- **WHEN** both saves contain a run with `at` 1700000000000
- **THEN** the merged `runs` contains it once

### Requirement: Self-import detection
The merge path SHALL compare the incoming `id` to the local `id`. When they match, the save screen SHALL label the file as the player's own backup and default the action to `replace`, so importing one's own export does not double counters.

#### Scenario: Own backup
- **WHEN** an imported file's `id` equals the local save's `id`
- **THEN** the save screen shows `this is your own backup` and the highlighted action is `replace`

### Requirement: Reserved sections
The save SHALL include `salvage` (number), `unlocks` (string array), `missions` (object keyed by mission id), `drills` (object keyed by drill family), `lifetime.medals` (object keyed by medal name) and `entitlements` (object) from version 1, initialised empty, so later features write to them without a schema migration.

#### Scenario: Reserved fields present on fresh save
- **WHEN** a fresh save is created
- **THEN** it contains `salvage` 0, `unlocks` `[]`, `missions` `{}`, `drills` `{}`, `lifetime.medals` `{}` and `entitlements` `{}`

### Requirement: Sim isolation
Nothing under `src/sim`, `src/vim` or `src/core` SHALL import from `src/save`, and `src/save` SHALL NOT import from `src/sim`, `src/render` or `src/audio`.

#### Scenario: Headless run
- **WHEN** the CLI harness runs a full game in Node
- **THEN** no save module code executes and no localStorage access is attempted
