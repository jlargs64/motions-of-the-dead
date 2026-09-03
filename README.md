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
npm test             # 561 tests
npm run build        # -> dist/
npm run play         # play it from a terminal, no browser
```

## Stack

Vite + TypeScript + Canvas 2D. **Zero runtime dependencies.** Nothing the game
draws is an asset — every glyph and figure is drawn procedurally, every sound is
synthesized in WebAudio at load time, the only font is the system monospace
stack. The one exception is the browser's own furniture: `public/icon.svg` is
the favicon, and `npm run icons` bakes the PNG sizes iOS and Android insist on
plus the social card from it. No network calls, no analytics, no backend.
`localStorage` holds one versioned save blob under
`motd.save` — see [Your save](#your-save) — and the mute flag, and nothing else.

## Controls

Everything is Vim, starting with the menu. The title screen is an eight-row
menu you navigate the way you navigate a buffer:

| key | on the menu |
| --- | --- |
| `j` `k`, with counts (`3j`) | move the cursor; it clamps at both ends and never wraps |
| `gg` `G` `{n}G`, `H` `M` `L` | first row, last row, row *n*; first, middle, last |
| `/text<CR>`, then `n` / `N` | jump to the first row whose label contains `text` |
| `Enter` or `l` | open the row; `h` or `Esc` backs out of a sub-screen |
| `i` | start a survival run immediately, whatever the cursor is on |
| a mouse click | select the row you clicked, if you clicked on one |

The rows are `survival`, `missions`, `drills`, `armory`, `record`, `options`,
`save` and `about`. `drills` and `armory` are marked `soon` until they exist.
While a survival run is on hold (see pause, below) the first row reads
`resume  - night 7  score 1240` instead, and Enter picks it up; `i` still
starts a new run and leaves the held one alone.
`record` shows your lifetime motion stats without having to die first, and
`options` and `save` are below.

**`about`** is the introduction: four short pages - the idea, the keys, the
lesson, the build - under a tab strip, with `j`/`k` turning the page and `h`
backing out. Until you have a high score the menu header points at it
(`FIRST NIGHT?  G  about`), since `G` lands on the last row and that row is
`about`. The copy lives in `src/ui/about.ts` and is the same text `text()`
prints for an agent reading the screen headless.

**`missions`** opens a two-pane picker over all 41 missions: the eight
boot-camp steps, then one mission per lesson of the syllabus, under their
section headings, sixteen lines at a time (`{` and `}` skip a section). Every
row shows its stars; nothing locks, and a lesson past the one you are on is
only drawn dim. The right pane shows the selected mission's keycaps, its par
and your best, and plays the motion on a loop — a scripted keystroke string
fed one key at a time through the real Vim engine into a throwaway sim, so you
are watching the game play itself, keycaps lighting as they are pressed. Enter
starts the mission full-screen on the real field: a scripted scene with no
clock and an invulnerable wall, `r` to start over, and a par the oracle
computed for it. Finish it and the strip shows your keystrokes against par
and one to three stars; `n` goes to the next mission, `r` tries again, `Esc`
returns to the list. Stars and best keystrokes persist in the save, and a
survival wave card points at the mission when its lesson is unstarred.

In a run: `i` was the way in — insert mode is death, that is the joke. `Esc`
clears a half-typed command; `Esc` with nothing pending opens **pause &
options**, which carries the same three switches the menu's `options` screen
does — sound, gore (full / low / off) and the line-number gutter — and, in
survival, `w`: **save & quit**. The run is written to the save exactly as it
stands (the store between nights included; `Esc` on the store's list opens the
same card) and the menu offers it back as `resume`. One slot, cleared the
moment you pick it up, so a night cannot be replayed. There is no
global mute key; every letter worth binding is already a motion. On the death
screen `i` inserts you back into the horde, `Esc` returns to the menu, and
`:q<CR>` does what you would expect it to do.

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
src/ui/        the menu and its screens, wave card, death screen, service record
src/harness/   the headless Game facade, the stable text() surface, the CLI
scripts/       the rule-based smoke bot and the replay determinism checker
tests/         561 tests, including 92 Vim before/keys/after fixtures
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

## The service record

The point of the game. On the menu it is the `record` row; on the death screen
it is the `MOTIONS` block. (In the code it is still `Ledger` / `src/ui/ledger.ts`
- DECISIONS #76.) After every kill it recomputes the cheapest command that
would have worked from where your cursor actually was — brute force over the
motion set, verified by running each candidate through the real engine. At death
it shows your three most-used motions, three motions that were available and
would have been optimal but you never touched, and your keystrokes-per-kill
across runs. Stored in the save blob under `lifetime`.

## Your save

Everything that survives a run — lifetime motion stats, the last 40 runs, the
high score, settings, and the salvage, unlocks, mission stars and drill bests
later features will write — lives in one versioned JSON object in
`localStorage` under `motd.save`. One key, one schema, one write path
(`src/save/save.ts`), so nothing else in the game touches storage.

The `save` row on the main menu opens the save screen:

| key | what it does |
| --- | --- |
| `e` | download the save as `motd-save-YYYY-MM-DD-HHMM.json` |
| `y` | copy it to the clipboard |
| `o` | open a `.json` file you exported before |
| `p` | paste one in (falls back to a hidden box if the clipboard is blocked) |

Import never overwrites blindly. A file you choose is validated — version,
FNV-1a checksum, then field by field — and then shown to you before anything
changes, with two options:

- **merge** (the default): counters sum, high score and bests win, unlocks
  union, runs dedupe by timestamp. Bringing a save over from another browser
  cannot lose the progress already here.
- **replace**: the file wins outright. Offered as the default when the file's
  id matches this browser's, because re-importing your own backup would
  otherwise double every counter.

Esc cancels; nothing is written until you confirm. A corrupt or hand-edited
file reports a Vim-flavoured error (`E485: Can't read file - checksum
mismatch`) and leaves the local save alone. A save from a newer build still
imports; the fields this build does not know are carried through untouched.

Upgrading from an older build migrates `motd.ledger` and `motd.settings` into
the blob on first load and leaves both of them in place, so a rollback still
works.

## Design notes

Every judgment call this build made where the spec was silent is written down
in [`DECISIONS.md`](DECISIONS.md).
