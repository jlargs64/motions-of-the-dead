## 1. Copy and model

- [x] 1.1 Add `src/ui/about.ts`: `ABOUT_PAGES`, `ABOUT_ROWS`, `ABOUT_WIDTH`, `ABOUT_LINES`, `wrapPage()`
- [x] 1.2 Add `about` to `MenuScreenId` and as the eighth `MAIN_ROWS` entry; `rowsFor('about')`; `select()` pushes the screen
- [x] 1.3 `Menu.lines()` prints the current page's copy on the about screen

## 2. Drawing

- [x] 2.1 Grow the shared card to `P_ROW` -5 / `P_H` 24; move the main card's header up one row; rows on 1..15
- [x] 2.2 `FIRST NIGHT?  G  about` in the score slot when there is no high score
- [x] 2.3 `Screens.drawAbout`: tab strip with the active tab underlined, wrapped copy, footer
- [x] 2.4 Dispatch `about` in `src/main.ts` and `scripts/render-smoke.mts`; add `menu-about` shots

## 3. Tests and docs

- [x] 3.1 `tests/ui.test.ts`: eight rows, about open/turn/back, Enter is a no-op, `lines()` carries the copy, every page fits
- [x] 3.2 `tests/ui-layout.test.ts`: about on every page and with the longest footer
- [x] 3.3 `tests/harness.test.ts`: `G` lands on about and `G<CR>` prints it
- [x] 3.4 `README.md`, `AGENT.md`, DECISIONS #91
- [x] 3.5 Tests, `tsc`, `smoke`, `smoke:render`, `replay` pass; `title.png` refreshed and `menu-about*.png` added. `verify:browser` diverged on sim state while the `missions` change was editing `src/sim` in the same tree; rerun once that lands
