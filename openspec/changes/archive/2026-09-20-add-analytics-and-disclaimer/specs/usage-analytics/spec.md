## ADDED Requirements

### Requirement: One tag, the blog's website, no pageview of its own
The built `index.html` SHALL carry exactly one third-party script, `https://cloud.umami.is/script.js`, loaded `defer`. It SHALL carry `data-website-id="52e96d3b-5dfa-472a-bf54-422c61c7de68"` — the blog's website, because the account's plan allows only one — together with `data-domains="justinlargo.com"`, `data-do-not-track="true"`, and `data-auto-track="false"`. No other network call SHALL exist anywhere in `src/` or `scripts/`.

#### Scenario: Played from the blog
- **WHEN** a player loads `https://justinlargo.com/games/motions-of-the-dead/` inside the project page's iframe
- **THEN** one request to `cloud.umami.is` is made, and no pageview is recorded for the iframe URL

#### Scenario: One visit is not two pageviews
- **WHEN** a reader opens `/projects/motions-of-the-dead/` and the lazy iframe loads
- **THEN** the blog footer's tag records exactly one pageview for that page, and the game's tag records none, so the visit is not double-counted

#### Scenario: Events are still attributable to the game
- **WHEN** any of the four allowlisted events fires
- **THEN** it is recorded against the blog's website with the iframe's own URL, so game events can be separated from blog traffic by URL and by event name

#### Scenario: Played from a dev server
- **WHEN** the game runs on `localhost:5173` or under `vite preview`
- **THEN** the script loads but reports nothing, because the hostname does not match `data-domains`

#### Scenario: No second network call sneaks in
- **WHEN** `tests/analytics.test.ts` greps `src/` and `scripts/` for `fetch(`, `sendBeacon` and `XMLHttpRequest`
- **THEN** the only match is inside `src/analytics/`, and that file makes no call of its own

### Requirement: A four-event allowlist over the bus
`attachAnalytics(bus)` SHALL subscribe to exactly four `GameEvent` tags and SHALL translate them as follows, sending nothing else: `wave_start` with `n === 1` becomes `run_start` with an empty payload; `death` becomes `run_end` with `{ wave, score }`; `mission_done` becomes `mission_done` with `{ id, stars }`; `drill_done` becomes `drill_done` with `{ family, perfect, scenes }`. Every payload value SHALL be a number or a short enum string.

#### Scenario: A full run
- **WHEN** a player starts a run, clears four waves and dies on wave five
- **THEN** exactly two events are sent — `run_start`, then `run_end` with that wave and score

#### Scenario: A wave that is not the first
- **WHEN** `wave_start` fires with `n` of 3
- **THEN** nothing is sent

#### Scenario: The loud events stay silent
- **WHEN** a run emits `kill`, `shot`, `command`, `combo`, `kill_judged` and `barricade_hit`
- **THEN** no analytics call is made for any of them

#### Scenario: A new bus event is silent by default
- **WHEN** a tag is added to `GameEvent` and not to the allowlist
- **THEN** it is never sent, and `tests/analytics.test.ts` still passes

### Requirement: Nothing identifying leaves the browser
The analytics module SHALL NOT read `localStorage`, the `motd.save` blob, the save `id`, the seed, the `runs/` log, or any field not named in the allowlist table. It SHALL NOT set a cookie, and SHALL NOT pass free-form player-supplied text as an event name or payload value.

#### Scenario: Save is untouched
- **WHEN** analytics is attached and a full run is played
- **THEN** no read of `motd.save` originates from `src/analytics/`, and the save's `updatedAt` is unchanged by it

#### Scenario: Payload shape is asserted
- **WHEN** `tests/analytics.test.ts` captures every sent event through a stub
- **THEN** each payload's keys are a subset of the allowlist's fields for that event, and every value is a number or a string of at most 32 characters

### Requirement: Analytics never fails the game
`track(name, data)` SHALL resolve `window.umami` at call time and SHALL return without effect when it is undefined, is not a function, or throws. No exception SHALL escape `src/analytics/`, and no other module SHALL import anything from it except the single wiring call in `src/main.ts`.

#### Scenario: Node harness
- **WHEN** `npm run play`, `npm run smoke`, `npm run replay` or the test suite runs with no `window`
- **THEN** every call is a no-op and nothing throws

#### Scenario: Blocked by an extension
- **WHEN** `cloud.umami.is/script.js` is blocked and `window.umami` is never defined
- **THEN** the game plays identically and no error reaches the console

#### Scenario: The tag throws
- **WHEN** `window.umami.track` throws
- **THEN** the exception is swallowed inside `src/analytics/` and the frame completes

#### Scenario: Fired before the deferred script lands
- **WHEN** `run_start` fires while `window.umami` is still undefined
- **THEN** that event is dropped and no queue or retry state is kept

### Requirement: The build's claims match the build
`README.md` SHALL NOT claim the game makes no network calls or carries no analytics. It SHALL state, in the Stack section, that one third-party tag reports four events and that there is still no backend and no npm runtime dependency. `AGENT.md` SHALL NOT repeat the retracted claim.

#### Scenario: Docs audited with the change
- **WHEN** the tag ships
- **THEN** README's Stack paragraph names Umami and the four events, and DECISIONS.md records why
