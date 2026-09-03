## Why

The title screen is a single card with two hidden keys (`i` to start, `t` for the warm-up). The game is growing a store, missions, drills, an armory, a stats page and a save screen, and none of those has anywhere to live. A menu that is itself navigated with Vim motions turns "getting to the game" into a first rep of the game's own lesson, and it gives every later change a place to add one row.

## What Changes

- The title screen becomes a main menu with the rows `survival`, `missions`, `drills`, `armory`, `ledger`, `options`, `save`. Rows for capabilities that do not exist yet are drawn dimmed and marked `soon`; later changes replace the placeholder with a real screen.
- Menu navigation is Vim: `j`/`k` with counts, `gg`/`G`/`H`/`M`/`L`, `/text<CR>` search-to-select, `Enter` or `l` to select, `h` or `Esc` to back out of a sub-screen. Mouse click selects the row under the pointer by hit-testing renderer cell rows.
- `i` on the menu still starts survival immediately. The `t` key is removed; the warm-up is reached through the `missions` row (the `missions` change replaces its content; until then the row launches the existing warm-up).
- The pause card's option toggles (sound, gore, line numbers) move into an `options` sub-screen reachable from the menu; the pause card keeps its toggles too.
- The `save` row opens a screen that shows the save summary and the export/import actions. This change owns the row and the screen layout; the logic comes from `player-save`.
- The `ledger` row opens a lifetime stats card showing the data the death screen already computes, without having to die first.
- **Contract, additive**: `GameState.phase` gains `'menu'` and `'shop'`. `SimState` gains `mode: 'survival' | 'mission' | 'drill'`. Both recorded in DECISIONS.md. `'title'` stays as a synonym the harness accepts so `autoStart: false` and existing tests keep working.
- Layout of every menu screen is asserted in `tests/ui-layout.test.ts` style: nothing leaves the grid or its panel, nothing overlaps.

## Capabilities

### New Capabilities
- `main-menu`: the menu model (rows, cursor, search), its Vim key handling, mouse hit-testing, and the menu, options, ledger and save screen layouts.
- `game-mode-contract`: the additive `phase` values and `SimState.mode` field, how the sim reports them, and the guarantee that the menu never touches simulation state beyond entering a mode.

### Modified Capabilities
- none. `hud-chrome` and the other visual-pass specs describe the playfield, which this change does not alter.

## Impact

- `src/core/state.ts`, `src/core/types.ts`: additive fields only, with DECISIONS.md entries.
- `src/sim/sim.ts`: `toTitle()` becomes `toMenu()` (the old name stays as an alias), `start()` takes a mode.
- `src/ui/screens.ts`: title drawing replaced by a `Menu` class in a new `src/ui/menu.ts`; pause card unchanged except that it reuses the options rows.
- `src/main.ts`: key routing for `phase === 'menu'`, a `click` handler that converts pixel coordinates to a cell row via `renderer.metrics()`.
- `src/harness/api.ts`, `AGENT.md`: `phase` vocabulary documented; `text()` prints the menu rows when in the menu so an agent can drive it.
- `tests/ui-layout.test.ts`, `tests/ui.test.ts`: new cases for every menu screen and for key handling.
- Depends on `player-save` for the save screen's export/import actions. `missions`, `drills-and-coach`, `armory`, `survival-store` each later replace one placeholder row.
