## Context

`src/ui/menu.ts` is a pure model: rows per screen, a cursor per screen, a screen stack, `feed(key)`. Drawing lives in `Screens`, dispatch on `menu.screen` in `main.ts`. Every menu card shares one panel so backing in and out does not make the card jump. Seven rows sat on odd cell rows 3..15 with 16 blank and the footer on 17.

## Decisions

**D1. Pages are rows.** The about screen's rows are one per page, so `j`/`k` turn pages through the cursor the model already has. No new state, no new action type. `select()` falls through to `null` on a page: a page is read, not activated.

**D2. Copy is data in its own module.** `ABOUT_PAGES` (id, label, hint, paragraphs) and `wrapPage()` live in `src/ui/about.ts`, imported by `menu.ts` (rows, `lines()`), `screens.ts` (drawing) and the tests (fit). One source for the words.

**D3. Tabs across, prose below.** Four labels on one row, active in hot ink with a rule under it, then 15 rows of 44-cell copy. Alternative: two panes like the mission list. Rejected: 22-cell prose reads badly; the mission pane earns its width with a live demo, this card does not.

**D4. The card grows up, not down.** Eight rows at stride two need 15 cells plus the blank before the footer; the footer is pinned at 17. `P_ROW` becomes -5 (the UI band starts at -6) and the main card's header moves up one. Alternatives rejected: single-spaced rows (cramped), dropping the blank before the footer (#59's reason to keep it), a ninth-row footer at 18 (outside the panel's usable band).

**D5. The first-run nudge is one line.** `FIRST NIGHT?  G  about` in the high-score slot until a high score exists. Auto-opening the page on first boot was rejected: it hides the title, and the harness and tests expect `MENU main` on boot.

**D6. Nothing on the about card is clickable.** The tabs share a cell row, and `menuHit` maps by row. `rowCells` is cleared on draw.

## Risks

- [Copy runs long after an edit] -> `tests/ui.test.ts` asserts each page wraps to at most `ABOUT_LINES` lines of `ABOUT_WIDTH` cells with no word lost.
- [Header crowding after the move up] -> the layout test checks nothing overlaps; the screenshot baseline is refreshed.
