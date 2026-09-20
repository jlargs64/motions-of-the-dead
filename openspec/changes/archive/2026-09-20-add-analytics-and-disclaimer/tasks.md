## 1. The tag

- [x] 1.1 Add the deferred `cloud.umami.is/script.js` tag to `index.html` with `data-website-id="52e96d3b-5dfa-472a-bf54-422c61c7de68"`, `data-domains="justinlargo.com"`, `data-do-not-track="true"`, `data-auto-track="false"`
- [ ] 1.2 Confirm in the browser that loading the game fires no pageview — only the four events do, and `/projects/` still counts once
- [x] 1.3 Run `npm run build` and confirm the tag survives into `dist/index.html` unmangled and that the bundle still has no other network call

## 2. `src/analytics/`

- [x] 2.1 Write `src/analytics/umami.ts`: one exported `track(name, data)` that resolves `window.umami` at call time and returns silently when it is undefined, not a function, or throws — no queue, no retry, no module state
- [x] 2.2 Write `src/analytics/index.ts`: `attachAnalytics(bus)` subscribing to `wave_start` (only `n === 1`), `death`, `mission_done`, `drill_done`, mapping each to its allowlisted payload per the design's table
- [x] 2.3 Wire `attachAnalytics(game.bus)` into `src/main.ts` beside the existing `game.bus.on('mission_done', …)` around line 66 — browser entry only, never `src/harness/`

## 3. Tests

- [x] 3.1 Add `tests/analytics.test.ts` with a `window.umami` stub that captures every call
- [x] 3.2 Assert the full-run case sends exactly `run_start` then `run_end`, and that a run emitting `kill`, `shot`, `command`, `combo`, `kill_judged` and `barricade_hit` sends nothing for them
- [x] 3.3 Assert payload shape: keys are a subset of the allowlist for that event, values are numbers or strings of at most 32 characters
- [x] 3.4 Assert the no-op paths: no `window`, `umami` undefined, `umami.track` throwing — none throw and none break the frame
- [x] 3.5 Add the source-level guard: grep `src/` and `scripts/` for `fetch(`, `sendBeacon`, `XMLHttpRequest` and fail on any match outside `src/analytics/`
- [x] 3.6 Run `npm run verify` — the full suite, build, smoke, render smoke, replay and browser replay must all still pass

## 4. Retract the claim

- [x] 4.1 Rewrite README's Stack paragraph: keep "zero runtime dependencies" and "no backend", drop "no network calls, no analytics", state the one tag and the four events
- [x] 4.2 Check `AGENT.md` for the same claim and fix it if present
- [x] 4.3 Add DECISIONS #15 covering the separate website, the allowlist over a denylist, and the no-op contract

## 5. Ship the build to the blog

- [x] 5.1 `npm run build`, then rsync `dist/` into `justin-largo-blog/static/games/motions-of-the-dead/` — the copy there is stale (`index-n0S5O4a2.js` against the current `index-zLITMuzS.js`)
- [x] 5.2 Add `scripts/sync-game.sh` in the blog repo wrapping that rsync so future releases are one command

## 6. The disclaimer (sibling repo `justin-largo-blog`)

- [x] 6.1 Write the four-topic disclaimer into `content/projects.md` directly above the `{{< game >}}` shortcode: gore, flashing/photosensitivity, cookieless Umami analytics with a link to `/privacy/`, and `motd.save` living only in the reader's browser
- [x] 6.2 Flip `content/privacy.md` from `draft = true` to `false` — the disclaimer's link 404s until this lands
- [x] 6.3 Extend the privacy policy's Analytics section to name the game's second Umami website and list the four events it sends
- [x] 6.4 `hugo server`, check `/projects/` at 375px wide: disclaimer fully visible above the frame, no horizontal scroll, iframe still `loading="lazy"`
- [x] 6.5 Click the overlay and confirm keys reach the game, fullscreen works, and "Open in a new tab" still works — the disclaimer gates nothing

## 7. Verify live

- [ ] 7.1 Push both repos, wait for the blog's Pages deploy
- [ ] 7.2 Load `/projects/`, play one short run to a death, and confirm `run_start` and `run_end` appear in the Umami events list against the game's URL — and that `/projects/` gained exactly one pageview, not two
