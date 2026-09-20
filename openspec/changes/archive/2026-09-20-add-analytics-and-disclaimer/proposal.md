## Why

The game is about to stop being a localhost toy: `dist/` gets copied into the blog at
`/games/motions-of-the-dead/` and embedded on the projects page. Once it is in front of
strangers, two things are missing. There is no way to tell whether anyone who loaded the
page actually pressed a key, got past wave one, or finished a mission — the blog's Umami
tag sits in the Hugo footer and never fires inside the iframe. And nothing anywhere warns
a reader that the thing about to autoload is a gore game with a strobing red screen that
writes to their browser's storage.

## What Changes

- The game reports to the blog's existing Umami website, `52e96d3b-5dfa-472a-bf54-422c61c7de68`.
  A second website is not available: the account's Hobby plan refuses one at a single site.
- The game's tag sets `data-auto-track="false"`, so the iframe sends **no pageview of its own** —
  only the four custom events below. The projects-page pageview the blog's footer already records
  is the load count, and it is the more honest one, since the iframe is lazy-loaded.
- `data-domains="justinlargo.com"` keeps dev servers, `vite preview` and anyone's local checkout
  silent.
- A new `src/analytics/` subscribes to the existing `bus` and maps a **four-event allowlist**
  (`run_start`, `run_end`, `mission_done`, `drill_done`) onto Umami custom events. Per-kill,
  per-command and per-frame events are never sent; the bus fires thousands of those a run.
- The analytics module is a no-op — not an error — when `window.umami` is absent: the node
  harness, `npm run play`, the smoke scripts, a blocked script, an offline player. No code
  path outside `src/analytics/` learns that analytics exists.
- Nothing that identifies a player is sent: not the `motd.save` `id`, not the save blob, not
  localStorage, not a cursor position. The allowlist carries integers and short enums only.
- `data-do-not-track="true"` on the tag, matching the claim the blog's privacy policy already
  makes about Umami.
- **BREAKING (documentation):** README's "**Zero runtime dependencies.** … No network calls,
  no analytics, no backend" is no longer true. The claim gets rewritten, not deleted — the
  honest version is one third-party tag, four events, no backend of my own.
- A disclaimer block renders on the blog page above the embed, covering four things: gore,
  flashing/photosensitivity, anonymous analytics, and progress saved locally in the browser.
  It lives in `justin-largo-blog`, not here — see Impact.

## Capabilities

### New Capabilities
- `usage-analytics`: the tag and its attributes, the four-event allowlist and payload shape,
  what is never sent, and the no-op contract that keeps the headless harness and tests dry.
- `embed-disclaimer`: the notice shown with the embedded game — its four topics, where it
  renders relative to the iframe, and what a player who opens the game URL directly sees.

### Modified Capabilities
<!-- None. No existing requirement changes: analytics only listens to the bus, and the
     disclaimer is page furniture outside the game's own surfaces. -->

## Impact

- **This repo.** `src/analytics/umami.ts` and `src/analytics/index.ts` (new), one wiring line
  in `src/main.ts`, the script tag in `index.html`. `tests/analytics.test.ts` (new) asserts the
  allowlist, the no-op path, and that no payload field reaches outside the allowlist.
  `README.md` ("Stack" paragraph), `AGENT.md` if it repeats the claim, DECISIONS #15.
- **Sibling repo `justin-largo-blog`.** The disclaimer copy in `content/projects.md` around the
  `{{< game >}}` shortcode, and `content/privacy.md` gains a line naming the game's separate
  Umami site. `content/privacy.md` is currently `draft = true`, so `/privacy` 404s in
  production — the disclaimer cannot link to it until that flips.
- **Manual, outside any repo.** None. The website ID already exists and is already public in the
  blog's `layouts/partials/footer.html`; no dashboard step blocks this change.
- **Not in scope.** An in-game opt-out toggle on the options menu; a first-run panel inside the
  game; self-hosting Umami; any consent banner. Umami is cookieless and honours DNT, which is
  the same footing the blog already operates on.
