# MOTIONS OF THE DEAD

A gory, nocturnal survival shooter where the only input is Vim normal-mode
motions and operators. The field is a text buffer read side-on: 16 lanes, 52
columns of open ground. Zombies are words. They come out of the west and walk
east toward your barricade. Your cursor is the crosshair. You kill by editing.

Every horizontal motion — `w b e f t ; $ 0 ^ _` — runs along the axis the
threat travels. `j` and `k` change lanes. Inefficient motions get you killed.
That is the entire pedagogy, and the waves follow vim-hero's syllabus one
lesson at a time.

```
npm install
npm run dev          # http://localhost:5173
npm test             # 203 tests
npm run build        # -> dist/
npm run play         # play it from a terminal, no browser
```

## Stack

Vite + TypeScript + Canvas 2D. **Zero runtime dependencies.** No assets — every
glyph is drawn procedurally, every sound is synthesized in WebAudio at load
time, the only font is the system monospace stack. No network calls, no
analytics, no backend. `localStorage` holds the high score and the motion
ledger and nothing else.

## Controls

Everything is Vim. `i` on the title screen starts a run — insert mode is death,
that is the joke. `Esc` clears a half-typed command; `Esc` with nothing pending
opens **pause & options**, where you can toggle sound and set gore to full, low
or off. `m` mutes from anywhere (`M` is taken — it is the middle-lane motion).
`:q<CR>` on the death screen does what you would expect it to do.

Put the crosshair on a word and it **locks on** — the aim rides that zombie east
as it walks, so you can take your time composing a command.

Full motion list with semantics: [`AGENT.md`](AGENT.md).

## Layout

```
src/core/      frozen contracts — types, event bus, seeded RNG, field geometry, GameState
src/vim/       the Vim engine (an explicit state machine) and resolve() — real Vim semantics
src/sim/       tick(dt), spawning, kill resolution, waves, the optimality heuristic
src/render/    Canvas 2D renderer, glyph atlas, pooled particles, screen shake, gore
src/audio/     WebAudio synthesis — every sound generated at runtime
src/ui/        title / wave card / death screen, and the Motion Ledger
src/harness/   the headless Game facade, the stable text() surface, the CLI
scripts/       the rule-based smoke bot and the replay determinism checker
tests/         203 tests, including 92 Vim before/keys/after fixtures
```

`src/sim` and `src/vim` import nothing from `src/render`, `src/audio` or
`src/ui`, so the whole simulation runs headless in Node. That is enforced by
the harness tests, which never touch a DOM.

## Agent-playable

The simulation runs with no canvas, no DOM and no WebAudio, and exposes the
full game state as parseable text. An LLM agent with a terminal can play a
complete run by reading text and typing keys:

```
npm run play
```

Read [`AGENT.md`](AGENT.md) first — it is written so a fresh agent with only
that file and the CLI can play well.

The browser build exposes the same API on `window.__motd` (dev always,
production behind `?agent=1`), so a browser agent can drive the real renderer
without touching a pixel.

```
npm run smoke           # rule-based bot must reach wave 6 on seed 1
npm run replay          # replay the newest runs/*.jsonl, assert identical events + final state
npm run verify:browser  # replay that same log through dist/ via window.__motd
npm run verify          # all of the above, plus tests and a clean build
```

`verify:browser` loads the **built** bundle in Node behind a mock canvas, drives
it through `window.__motd`, renders a real frame after every input, and asserts
the resulting `GameState` is byte-identical to the headless one. That is the
proof that the browser build and the terminal build are the same game.

## Deploying to Cloudflare Pages

Static files, no server.

| setting | value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 or newer |

```
npx wrangler pages deploy dist
```

`vite.config.ts` sets `base: './'`, so `dist/` also works from a subdirectory
or straight off any static host. It does **not** work from a `file://` URL —
ES modules need an origin. Serve it:

```
npm run build && npx vite preview
```

## The Motion Ledger

The point of the game. After every kill it recomputes the cheapest command that
would have worked from where your cursor actually was — brute force over the
motion set, verified by running each candidate through the real engine. At death
it shows your three most-used motions, three motions that were available and
would have been optimal but you never touched, and your keystrokes-per-kill
across runs. Stored in `localStorage` under `motd.ledger`.

## Design notes

Every judgment call this build made where the spec was silent is written down
in [`DECISIONS.md`](DECISIONS.md).
