## Context

`src/main.ts` routes keys by `state.phase`: `title` accepts `i` and `t`, `dead` hands keys to `Screens.feedDeathKey`, and everything else goes to the Vim engine. The pause card is a UI-layer boolean in `main.ts`, not a sim phase. Screens are drawn on the canvas through the Renderer glyph API (`panel`, `text`, `centerText`, `keycap`, `rule`) and layout is asserted by `tests/ui-layout.test.ts` with a measuring `Ruler` stand-in. The renderer exposes `metrics()` with cell width, cell height and origin, which is enough to map a click to a cell row.

The sim is headless and deterministic. `GameState.phase` is a frozen union. `Sim.start()` begins survival, `startTutorial()` begins the warm-up, `toTitle()` returns.

## Goals / Non-Goals

**Goals:**
- One menu surface that every later change adds a row to without touching key routing.
- Menu navigation that is real Vim: counts, `gg`/`G`, screen-relative `H`/`M`/`L`, `/` search.
- Mouse works, without a DOM overlay.
- Zero simulation impact beyond `phase` and `mode`.
- Layout asserted, not eyeballed.

**Non-Goals:**
- Any content for missions, drills, armory or the store. Those rows are placeholders here.
- Save serialization. `player-save` owns it; this change only draws the screen and calls its functions.
- Menu animation or sound design beyond the existing key click.

## Decisions

**D1. The menu is a UI-layer state machine, like `paused`, but the sim reports `phase: 'menu'`.**
Alternative: keep `phase: 'title'` and put everything in `main.ts`. Rejected because the harness, the smoke bot and `text()` need to know the game is not in a run, and because `'shop'` later needs to be a sim phase anyway (purchases change sim state). Adding `'menu'` and `'shop'` to the union is additive; `'title'` remains accepted so no existing fixture breaks. Recorded in DECISIONS.md as an additive contract change.

**D2. `SimState.mode` is set by `Sim.start(mode)` and never read by the menu.**
The menu decides what to launch; the sim decides what the rules are. `mode` defaults to `'survival'`. `startTutorial()` sets `'mission'` so the `missions` change has a home for its rules. Existing `start()` with no argument means survival, so tests and the smoke bot are unchanged.

**D3. A `Menu` model separate from drawing.**
`src/ui/menu.ts` holds `rows`, `cursor`, `search`, `pending count`, and a `feed(key): MenuAction` method. Drawing lives in `Screens.drawMenu(r, menu, ...)`. The model is pure and testable in Node; it is the same split as `VimEngine` versus `Renderer`. Alternative: put menu state in `Screens`. Rejected because `Screens` already mixes death-screen command-line state and would become the junk drawer.

**D4. Menu motions are a small hand-written matcher, not the `VimEngine`.**
The engine emits `Command` objects tuned for the field (operators, text objects, target lock). The menu needs `j`, `k`, counts, `gg`, `G`, `H`, `M`, `L`, `/`, `Enter`, `l`, `h`, `Esc`. Reusing the engine would mean handling every operator as an unknown key and stripping motions back out. A 60-line matcher is clearer. `/text<CR>` selects the first row whose label contains the text, case-insensitive; `n` repeats forward, `N` backward, matching field behaviour.

**D5. Sub-screens are a stack.**
`menu -> options`, `menu -> ledger`, `menu -> save`. `h` or `Esc` pops. Each sub-screen is its own row list driven by the same `Menu` model, so `j`/`k` and Enter work identically everywhere. The options sub-screen reuses the pause card's toggle handlers so there is one source of truth for sound, gore and line numbers.

**D6. Mouse hit-testing uses `renderer.metrics()`.**
`row = floor((clientY - oy) / ch)` in cell units, adjusted for the UI band offset. A click on a menu row moves the cursor and selects; a click elsewhere on the menu does nothing. No DOM elements are added, which keeps `scripts/render-smoke.mts` and the mock-canvas replay valid. Hover is not tracked; the cursor only moves on click so keyboard and mouse never fight.

**D7. Placeholder rows are drawn dimmed with a `soon` tag and are selectable.**
Selecting one shows a one-line note on the menu and does nothing else. Later changes replace the row's action. This keeps the row order stable from day one so screenshots and layout tests do not churn.

**D8. `i` starts survival from the menu regardless of cursor position; `t` is gone.**
`i` is the game's signature. `t` was a stopgap before missions existed and the menu row replaces it. The death screen's `t` shortcut is also removed; the death screen gains `Esc` to return to the menu, alongside the existing `:q!`.

**D9. `text()` prints the menu when `phase === 'menu'`.**
Rows with a `>` marker on the cursor row, so an agent can drive the menu with `j`/`k`/`Enter`. `AGENT.md` documents it.

## Risks / Trade-offs

- [The frozen `phase` union is edited] -> Additive only, `'title'` kept, DECISIONS.md entry, every existing test still passes unmodified.
- [Two menu matchers drift from real Vim] -> `tests/ui.test.ts` pins `3j`, `gg`, `G`, `H`, `M`, `L`, `/`, `n`, `N` against expected cursor rows; the matcher never accepts a key Vim would not.
- [Mouse click lands between rows on narrow viewports] -> Rows are whole cells and the layout test asserts a one-cell gap is never required; clicks on gaps are ignored, never mis-selected.
- [Placeholder rows look like broken features] -> `soon` tag in dim ink and a note when selected. Removed as each change lands.
- [Blur auto-pause during the menu] -> `paused` is only set when `phase === 'playing'`, unchanged.

## Migration Plan

1. Add `phase` values and `mode` field, DECISIONS entries; run the full suite, nothing changes.
2. Land `Menu` model with tests, no drawing.
3. Replace `drawTitle` with `drawMenu` and route keys; keep `game.sim.toTitle()` as an alias of `toMenu()`.
4. Add options, ledger and save sub-screens; wire the save screen to `player-save` functions.
5. Update `AGENT.md`, `README.md` controls section, screenshot baselines under `runs/shots`.

Rollback: the menu is one module and one routing branch in `main.ts`; reverting restores `drawTitle`.

## Open Questions

- Should the menu show the field behind it as the title does today? Default: yes, same overlay, because it is the best-looking thing in the game.
- Whether `:q!` from the menu should do anything. Default: no; the joke belongs to the death screen.
