## Why

The title card names the game and lists what you can do, but nowhere does it say what the game *is*: that the horde is a text buffer, that you kill by editing, that inefficient motions get you killed, or how to get around this menu. A new player's introduction is currently a one-line tagline. The menu should carry a proper about page, and the first run should be pointed at it.

## What Changes

- The main menu gains an eighth row, `about`, after `save`. It opens a card with four short pages under a tab strip: the idea, the keys, the lesson, the build. `j`/`k` turn the page; `h`/`Esc` back out; Enter does nothing on a page.
- The about copy lives in `src/ui/about.ts` as data. The menu, the card and `text()` all read the same words, and a test asserts every page fits the card unwrapped and untruncated.
- Until there is a high score, the menu header's score slot reads `FIRST NIGHT?  G  about`, since `G` lands on the last row and that row is `about`. This is the whole first-run nudge; no modal, no save flag.
- The shared menu card grows one row at the top (`P_ROW` -5) so eight rows keep their blank line before the footer. The header moves up one row; sub-screens keep their layout.
- **Modified**: the `main-menu` row list is eight rows, not seven.

## Capabilities

### New Capabilities
- `about-screen`: the about row, its pages, tab strip, page turning and the headless text surface.

### Modified Capabilities
- `main-menu`: eight rows; the card's panel origin; the first-night header line.

## Impact

- `src/ui/about.ts` (new), `src/ui/menu.ts`, `src/ui/screens.ts`, `src/main.ts`.
- `scripts/render-smoke.mts`, `scripts/shot.mts`: the about card is smoked and shot.
- `tests/ui.test.ts`, `tests/ui-layout.test.ts`, `tests/harness.test.ts`: eighth row, page turning, fit, layout.
- `README.md`, `AGENT.md`, DECISIONS #91.
