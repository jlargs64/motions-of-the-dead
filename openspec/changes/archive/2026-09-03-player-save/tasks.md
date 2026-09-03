## 1. Schema and store

- [x] 1.1 Create `src/save/schema.ts` with the `Save` type, `SAVE_VERSION = 1`, `defaultSave()`, and per-field coercion helpers that accept partial or malformed input
- [x] 1.2 Create `src/save/save.ts` with `load()`, the legacy migration from `motd.ledger` and `motd.settings`, and the `SaveStore` class with debounced `set()` and `flush()`
- [x] 1.3 Implement `merge(local, incoming, mode)` per the spec rules, including runs dedupe and `bestKeys` minimum
- [x] 1.4 Wire `visibilitychange` and `beforeunload` flushes in `main.ts`
- [x] 1.5 Write `tests/save.test.ts`: fresh install, migration, idempotence, unknown-key round trip, storage failures, debounce, every merge rule

## 2. Transfer

- [x] 2.1 Add canonical JSON and FNV-1a helpers; implement `exportSave()` and `importSave()` with the version, checksum and structural validation errors
- [x] 2.2 Add self-import detection (`id` compare) to the import result
- [x] 2.3 Add the hidden anchor, file input and textarea to `index.html`; implement download, clipboard write, file read and paste fallback in `main.ts`
- [x] 2.4 Tests: round trip, corrupted byte, future version warning, own-backup detection

## 3. Ledger and settings become views

- [x] 3.1 Change `Ledger` to take a `SaveStore` and read and write `save.lifetime`; remove its localStorage code
- [x] 3.2 Change `loadSettings`/`saveSettings` to read and write `save.settings` through the store; add the `equipped` map with an empty default
- [x] 3.3 Update existing tests that stub `motd.ledger` or `motd.settings` to go through the store

## 4. Save screen

- [x] 4.1 Create `src/ui/savescreen.ts` drawing the actions, local summary and status line with the ink palette; add the confirmation card with `merge` and `replace`
- [x] 4.2 Add key handling for export-file, export-clipboard, import-file, import-paste, confirm, cancel; return actions to `main.ts` the way `feedPauseKey` does
- [x] 4.3 Add the screen to `tests/ui-layout.test.ts` with longest values and every error string
- [x] 4.4 Add the screen to `scripts/render-smoke.mts`
- [x] 4.5 Temporary entry point until `main-menu` lands: `S` on the title screen opens the save screen, Esc returns

## 5. Docs and verification

- [x] 5.1 Update `README.md` localStorage paragraph and add a Save section describing export and import
- [x] 5.2 Add DECISIONS entries for the single-blob choice, merge rules, legacy keys left in place, and DOM elements in `main.ts` only
- [x] 5.3 Run `npm run verify` and confirm the harness still runs with no localStorage
