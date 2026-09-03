## 1. Contract

- [x] 1.1 Add `menu` and `shop` to `GameState.phase`; add `SimState.mode` with default `survival`
- [x] 1.2 Add `Sim.toMenu()` and keep `toTitle()` as an alias; `start(mode = 'survival')`; `startTutorial()` sets `mission`
- [x] 1.3 Record both additive contract changes in DECISIONS.md
- [x] 1.4 Run the full suite and `npm run verify`; confirm nothing changes

## 2. Menu model

- [x] 2.1 Create `src/ui/menu.ts` with rows, cursor, screen stack, count buffer, search state and `feed(key): MenuAction`
- [x] 2.2 Implement `j`/`k` with counts, `gg`, `G`, `H`, `M`, `L`, clamping without wrap
- [x] 2.3 Implement `/text<CR>` search, `n`/`N`, `Esc` cancel, `E486` message
- [x] 2.4 Implement `Enter`/`l` select, `h`/`Esc` back, `i` start-survival override
- [x] 2.5 Add `tests/ui.test.ts` cases for every motion, search, clamp and select path

## 3. Drawing

- [x] 3.1 Add `Screens.drawMenu` replacing `drawTitle`, field visible behind with the existing overlay
- [x] 3.2 Add `drawOptions` reusing pause-card rows and handlers
- [x] 3.3 Add `drawLedgerScreen` sourced from the save's lifetime data, with the `NO RUNS YET` empty state
- [x] 3.4 Add `drawSaveScreen` showing version, updated time, runs, salvage, `e`/`m` actions and a result line
- [x] 3.5 Placeholder rows drawn dim with `soon` and a note when selected
- [x] 3.6 Extend `tests/ui-layout.test.ts` to cover all four screens with maximal content

## 4. Wiring

- [x] 4.1 Route `phase === 'menu'` keys through `Menu.feed` in `src/main.ts`; remove `t` from menu and death screen; add `Esc` on death screen to return to the menu
- [x] 4.2 Add canvas `click` handler mapping pixels to a cell row via `renderer.metrics()` and forwarding to the menu
- [x] 4.3 Wire options actions to the existing settings handlers; wire save actions to `player-save` export and import
- [x] 4.4 Print the menu in `text()` when `phase` is `menu`; document phases and menu keys in `AGENT.md`

## 5. Verification

- [x] 5.1 Update `README.md` controls section
- [x] 5.2 Add menu, options, ledger and save screens to `scripts/render-smoke.mts`
- [x] 5.3 Refresh `runs/shots/current/title.png` baseline and run `npm run verify`
