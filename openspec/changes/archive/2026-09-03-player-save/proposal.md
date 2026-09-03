## Why

Progress lives in two unrelated localStorage keys (`motd.ledger`, `motd.settings`) with no version, no export, and no room for the things the game is about to grow: lifetime stats, salvage, unlocks, mission stars, drill bests. A cleared browser erases everything, and nothing downstream (menu, medals, store, missions, drills, armory) can persist without a home. This is the foundation change: one versioned save that the player can back up and restore.

## What Changes

- Introduce a single versioned save blob under one localStorage key, `motd.save`, owned by a new `src/save/` module with `load`, `save`, `exportSave`, `importSave`, `merge`.
- Migrate the existing `motd.ledger` and `motd.settings` payloads into the blob on first load, then leave the old keys untouched so a rollback still works.
- Export as a downloadable `.json` file and as a copy-to-clipboard string; import from a file picker and from a pasted string. Both surfaces are DOM elements owned by `main.ts`; the canvas UI only draws the save screen.
- Import is a **merge**, not an overwrite: counters sum, high score and bests take the max, unlocks union, settings from the imported file win only when the user chooses "replace".
- Reserve fields for later changes so they need no migration: `salvage`, `unlocks`, `missions`, `drills`, `lifetime.medals`, `entitlements`.
- Ledger keeps its in-run analysis; its persistence moves to the save module. The Ledger class stops touching localStorage directly.
- **BREAKING** for anyone reading `motd.ledger` directly: nothing in the repo does, but `tests/harness.test.ts` style tests that stub localStorage must be updated to the new key.

## Capabilities

### New Capabilities
- `player-save`: the versioned save blob, its schema, load and save rules, migration from the legacy keys, and the merge semantics that make import and later cloud sync safe.
- `save-transfer`: exporting the save to a file or clipboard and importing it from a file or pasted text, including validation, error reporting, and the save screen the player uses.

### Modified Capabilities

(none of the existing renderer specs change requirements)

## Impact

- New: `src/save/save.ts`, `src/save/schema.ts`, `src/ui/savescreen.ts`, `tests/save.test.ts`.
- Changed: `src/ui/ledger.ts` (persistence moves out), `src/ui/settings.ts` (becomes a view over the save), `src/main.ts` (hidden file input, download anchor, clipboard calls, save screen wiring), `index.html` (the two hidden elements), `tests/ui-layout.test.ts` (new card), `README.md` (localStorage paragraph), `DECISIONS.md` (new entries).
- Downstream changes that write to the blob: `main-menu` (menu entry), `medals-and-wallet` (salvage, medals), `missions` (stars), `drills-and-coach` (bests), `armory` (unlocks, equipped).
- Later monetization: `entitlements` is an empty object today. A Firebase-backed store later implements the same `SaveStore` interface and syncs by calling `merge`, so cloud sync is a second store, not a migration.
- No new runtime dependencies. No network calls.
