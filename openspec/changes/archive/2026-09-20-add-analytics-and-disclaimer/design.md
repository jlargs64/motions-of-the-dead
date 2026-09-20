## Context

The game has never made a network call. `grep -rn "fetch(\|sendBeacon\|XMLHttpRequest" src scripts`
returns nothing, `package.json` has zero runtime dependencies, and every asset is inlined by
`assetsInlineLimit: 100000000`. The build is a single `index.html` plus one ~228K JS file that
runs from any path because `vite.config.ts` sets `base: './'`.

That build is about to be copied into `justin-largo-blog` at `static/games/motions-of-the-dead/`
and iframed from the projects page by the existing `layouts/shortcodes/game.html`. Same origin,
`justinlargo.com`. The blog's Umami tag lives in `layouts/partials/footer.html` and is injected by
Hugo — it is nowhere in the game's Vite-built `index.html`, so today an embedded play session is
completely invisible.

Two constraints shape everything below. First, `src/core/bus.ts` is a **frozen contract**: a typed
synchronous bus where "every workstream communicates ONLY via GameEvents and the read-only
GameState." Analytics must be a listener, never a new channel. Second, the same `src/` is compiled
for the browser, for `npm run play` under node, and for four headless scripts; anything that
touches `window` has to be invisible to all of them.

## Goals / Non-Goals

**Goals:**
- Know how many people load the embedded game, and of those, how many start a run, survive past
  wave one, die, or finish a mission or drill.
- Keep game traffic in its own Umami website so the blog's post analytics stay readable.
- Zero effect on the headless harness, the CLI, the smoke scripts, the replay determinism check,
  and the 561-test suite.
- Warn a reader about gore, flashing, analytics and local storage *before* the iframe loads.

**Non-Goals:**
- Per-kill, per-command or per-frame telemetry. The bus emits thousands of `kill`, `shot` and
  `command` events per run; forwarding any of them is a denial-of-service on my own dashboard.
- Any form of player identity, cross-session linking, funnels, session replay, or heatmaps.
- An in-game opt-out, a consent banner, or a first-run panel inside the game.
- Self-hosting Umami. Cloud, same as the blog.
- Making the disclaimer visible to someone who opens `/games/motions-of-the-dead/` directly. That
  path is accepted, not solved — see Risks.

## Decisions

**The blog's website ID, with auto-track off.** A separate website was the first choice and is not
available: the account's Hobby plan returns "Website limit reached" at one site, whatever the
published tier tables say. The remaining options were to pay $20/mo for Pro, add a second vendor,
or share the ID. Sharing wins, because the objection to sharing turned out to be fixable.

The objection was pollution: an iframe pageview would double-count every `/projects/` visit, and a
game session — one URL, many minutes — would drag the blog's average session duration and bounce
rate around. `data-auto-track="false"` removes it. The game's tag sends **no pageview at all**,
only the four custom events, so the load count stays where it already is (the blog footer's
`/projects/` pageview, which is the truer number anyway because the iframe is lazy-loaded) and the
game contributes nothing to the blog's page tables. What lands is four named events on the game's
URL, separable by either axis. *Alternatives considered:* Pro at $20/mo — real money for a
dashboard split on a personal project; a second vendor for the game alone — a second script and a
second privacy paragraph to dodge a filter; self-hosting — a backend, which the project does not
have and does not want.

**The tag goes in `index.html`, gated by `data-domains="justinlargo.com"`.** Umami's own attribute
drops any report whose hostname does not match, so `localhost:5173`, `vite preview` and anyone's
fork are silent without a build-time environment switch. *Alternative considered:* injecting the
tag from TS behind an `import.meta.env.PROD` check — rejected, it moves a static concern into the
bundle and still fires on a production build served from localhost.

**`data-do-not-track="true"`.** The blog's privacy policy already tells readers Umami respects DNT.
Shipping the game without the attribute would make that page a lie by extension.

**A four-event allowlist, mapped from real bus tags.** `src/analytics/index.ts` subscribes to
exactly four of the 25-odd `GameEvent` tags and translates them:

| bus event | condition | umami event | payload |
|---|---|---|---|
| `wave_start` | `n === 1` | `run_start` | `{}` |
| `death` | always | `run_end` | `{ wave, score }` |
| `mission_done` | always | `mission_done` | `{ id, stars }` |
| `drill_done` | always | `drill_done` | `{ family, perfect, scenes }` |

An allowlist, not a denylist: a future bus event is silent until someone adds it here on purpose.
Payload fields are integers and short enums only — `keys`, `par`, `kills` and `zombieId` are
dropped as noise, and nothing derived from `motd.save` is ever read.

**`src/analytics/umami.ts` is the only file that knows `window` exists.** It exports one function,
`track(name, data)`, which resolves `window.umami` at call time and returns silently if it is
absent, not a function, or throws. Absent covers: node, a blocked script, an ad blocker, an offline
player, and the seconds before the deferred script loads. *Alternative considered:* a queue that
replays events once `umami` appears — rejected, it adds state to the one module that must never
fail, to recover at most one `run_start`.

**Wired in `src/main.ts` only.** `main.ts` is the browser entry; its first statement is already
`document.getElementById('screen')`. `attachAnalytics(game.bus)` goes beside the existing
`game.bus.on('mission_done', …)` at line 66. `src/harness/` never imports it, so the node paths
cannot regress by construction.

**The disclaimer is Hugo content, not a game surface.** It renders in `content/projects.md`
immediately above the `{{< game >}}` shortcode, which means it is on screen before the lazy-loaded
iframe is. Keeping it out of the game means no title-screen redesign, no new card in the menu's
eight rows, and no fifth thing competing with `FIRST NIGHT?  G  about`.

## Amended during implementation

Three things moved between design and merge, recorded here rather than by rewriting
the decisions above.

**The disclaimer lives on the project's own page, not on `/projects/`.** `/projects/`
became a grid of project cards — title plus a one-sentence hook, `kind = "play"` or a
write-up — and the embed moved to `content/projects/motions-of-the-dead.md`, with the
four-topic disclaimer immediately above its `{{< game >}}` shortcode. The disclaimer and
the iframe are still on the same page as each other and the index carries no iframe at
all, so the guarantee is unchanged and the pageview for a game load is now more precise
than `/projects/` was. `mainSections = ['posts']` keeps project pages out of the
homepage and `All posts`.

**The privacy policy describes one shared website, not two.** The spec was drafted before
the Hobby-plan refusal was confirmed and still said "a second, separate Umami website".
The policy now says what is true: the same website, `data-auto-track="false"`, no pageview
of its own, and the four events with the fields each carries.

**DECISIONS #15 was taken.** The file runs to #97, so this change is **#98**. The two
source comments citing #15 were corrected. `src/ui/about.ts` also carried the retracted
"No network calls, no analytics" claim on its "the build" tab and was rewritten alongside
README and `AGENT.md`.

**The shortcode's fullscreen button never worked.** `{{ $id | jsonify }}` was
double-escaped by Go's contextual escaper into `getElementById("\"game-1\"")`, so `root`
was `null` and the whole IIFE threw on its second line — killing click-to-play and the
focus prompt along with fullscreen. Fixed in the same change, since the spec requires
those three controls to keep working.

## Risks / Trade-offs

- **The README's headline claim becomes false.** → Rewrite the "Stack" paragraph in the same
  commit as the tag, and log it as DECISIONS #15. "Zero runtime dependencies" survives — no npm
  dependency is added; "no network calls" does not.
- **Someone opens `/games/motions-of-the-dead/` directly and sees no disclaimer.** → Accepted for
  this change. The direct URL is not linked from anywhere the blog controls except the shortcode's
  own "Open in a new tab" button, which sits *below* a disclaimer the reader has already passed.
- **The disclaimer links to `/privacy`, which currently 404s.** `content/privacy.md` is
  `draft = true`. → Flipping it to false is a task in this change, not an afterthought.
- **An ad blocker eats `cloud.umami.is/script.js`.** → Numbers are a floor, not a census. The
  game must not notice, which is exactly what the no-op contract buys.
- **Published Umami tier tables do not match the account.** Every aggregator says Hobby allows 3
  websites; the dashboard refused a second at 1. → Trust the dashboard. Nothing else in this
  design depends on a tier number, and the event ceiling (100K/month) is not binding: at four
  events per session that is thousands of runs a month.
- **Six-month retention on the free tier.** Launch-week numbers age out. → Export before they do,
  or move to Pro, but not as part of this change.
- **The game's events live in the blog's dashboard.** Reading either cleanly needs a URL or
  event-name filter. → Accepted, and cheap: the blog sends zero custom events today, so all four
  event names are unambiguous the moment they appear.
- **Umami counts well and slices poorly.** It will answer "how many people started a run and how
  many finished a mission" precisely, and "what is the distribution of the wave players die on"
  only as a flat breakdown of `run_end` property values. → Accepted: the four events were chosen
  as a funnel of counts, not as a dataset. If the distribution question ever becomes the point,
  that is a reason to revisit the vendor, not to widen the allowlist.
- **A third-party script in the page the game runs in.** → It is `defer`red and touches nothing
  the game owns: no canvas, no keyboard, no `motd.save`. The game's own storage contract in
  `openspec/specs/player-save` is untouched.
