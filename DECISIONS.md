# DECISIONS

Every judgment call this build made where the spec was silent, ambiguous, or
internally contradictory. Numbered so they can be argued with individually.

---

## Contracts (Phase 0)

**1. `Command.motion.repeatFind?: true` was added to the frozen `Command`.**
Additive optional field. `resolve(cmd, buffer, cursor)` is pure, so it has no
access to the last-used `f`/`t` character, but real Vim's `;` after a `t` must
skip an adjacent match. The engine therefore expands `;`/`,` into the concrete
`f`/`F`/`t`/`T` they repeat and flags the expansion. `MotionKind` still contains
`';'`/`','` per the contract; the engine simply never emits them.

**2. `GameState.sim: SimState` was added.**
The contract's `GameState` has no room for wave timers, the spawn queue, the
RNG cursor, or run statistics. All of it lives in one clearly Phase-B-owned
sub-object rather than being hidden inside the `Sim` class, so `json()` is a
complete, replayable snapshot and the determinism check is meaningful.

**3. The game runs with Vim's `virtualedit=all`. The cursor is clamped to the
60-column grid, not to the row's text.**
This replaces an earlier attempt (a remembered "sticky column") that was simply
wrong, and shipped broken: because rows are right-trimmed (#5), the only legal
column on a blank row was 0 — so `l` was a silent no-op almost everywhere, and
the instant the word you were standing on moved down or died, you snapped back
to column 0. Clamping to the text is correct for an editor, where every column
the cursor can reach has a character in it. It is wrong for a gun sight over a
mostly-empty field. `virtualedit=all` is Vim's own answer to exactly this, so
the game stays honest: `l` walks into empty space out to column 59, `j`/`k`
carry the column unchanged, motions still operate on the real text, and an
operator fired into empty space whiffs and costs no charge.
`tests/vim-resolve.test.ts` pins this as the one deliberate divergence from
stock Vim, and `tests/sim.test.ts` has the two reported bugs as regressions.

**4. `Bus.drain()` exists alongside `on()`.**
The harness needs "what happened during this call" without subscribing to nine
tags. `emit` still dispatches synchronously to subscribers; `drain` just takes
the log.

---

## The field was rotated (revision 2)

**R1. Lanes run west to east; the barricade is a vertical wall on the right.**
The first build had zombies marching top-to-bottom onto a horizontal wall. The
user asked for left-to-right, and it is straightforwardly the better design:
every horizontal Vim motion — `w b e f t ; $ 0 ^ _` — now runs along the axis
the threat actually travels, and `j`/`k` are lane changes. `$` means "the one
nearest the wall" and `^`/`_` means "the one furthest away", which are the two
things a player wants most. Geometry is now `ROWS = 16` lanes,
`FIELD_COLS = 52` walkable columns, wall at column 52, survivor behind it.
`Zombie.speed` is columns per second.

**R2. `text()` prints all 16 lanes with a column ruler.**
The old format omitted blank rows to save space. With a fixed 16-lane field and
a wall glyph per lane, printing every lane keeps columns vertically aligned so
an agent can read a position straight off the ruler. Alignment beats brevity.

**R3. The wave curriculum follows vim-hero's syllabus.**
The user pointed at vim-hero's lesson list. Waves are now one-lesson-each,
grouped into its sections (Basic Vim, Basic Operators, Essential Motions,
Advanced Vertical Movement, Search, Text Objects — Brackets / Quotes / Words),
each section closed by a review wave. 33 lessons, then "The Long Night".
Horde composition is scheduled to arrive with the lesson that answers it, so
**armored zombies now first appear at wave 22**, when text objects are taught,
rather than wave 5. Lessons that make no sense in a shooter are dropped: insert
mode (it is the death joke), `o`/`O`, `y`/`p`/`P` (nothing to yank), and
`Ctrl-u`/`Ctrl-d` (no viewport to scroll).

**R4. `_`, `?`, `n`, `N`, `*` and `#` were added to the engine.**
The syllabus demands them. `_` is linewise-first-non-blank (`d_` == `dd`).
`?` is a backward search; `n`/`N` repeat and reverse it. `*`/`#` search the
word under the crosshair as a whole word — which in this game means "jump to
the next zombie with the same name", and zombies travel in families, so it is
genuinely the strongest snipe in the set. `MotionKind` gained `'_'` and
`Command.search` gained optional `backward` and `wordUnderCursor`.

**R5. A `shot` GameEvent was added.**
`{ t: 'shot'; row; colStart; colEnd; hits }`, one per affected lane. The
renderer needs to know where the survivor just fired to draw the muzzle flash,
the tracer, and the span highlight; deriving it from `command` would use the
pre-move cursor and be wrong.

**R6. Speed was cut and the ramp un-capped.**
The user said the zombies moved too fast. Wave 1 is now 1.1 columns/second —
47 seconds to cross 52 columns, which is enough time to compose a command as a
beginner. The ramp then keeps climbing instead of plateauing, because the
plateau version had no difficulty ceiling at all: the smoke bot reached wave
200 with the barricade untouched. Measured after: perfect machine play dies
around wave 87, a quick human (120ms/keystroke, optimal motions) around wave
34, an average human (220ms) around wave 23. The 33-lesson syllabus lands right
at the quick-human ceiling.

**R7. Pause is `Esc` when nothing is pending.**
There was no pause at all. `Esc` already means "clear a half-typed command", so
it only opens the pause/options card when the command buffer is empty — no key
is overloaded ambiguously, and it matches the reference's `ESC: OPTIONS`. The
card carries the sound and gore toggles. The window also auto-pauses on blur.

**R8. Gore is a three-way setting, defaulted to full.**
`full` / `low` / `off`, persisted in `localStorage` under `motd.settings`, and
`off` must stay genuinely playable — kills get a clean grey dissolve so a
squeamish player still reads the feedback.

**R15. A partial hit erodes the word instead of missing.**
Reported as: "we shouldn't have just DW, x should whittle down words 1 char at
a time." It was the wrong feedback — `x` on a seven-letter walker did *nothing*
and broke your combo, which teaches "x is useless" rather than "x is slow". Now
any command covering part of a word deletes exactly those letters and the rest
closes up: survivors keep their columns, and a carved-out middle joins back
together. Seven presses of `x` kill what `dw` kills in two keystrokes, which is
the lesson stated in the mechanic instead of in a tooltip. Eroding keeps the
combo and, since eroded cells count as useful work in the waste calculation
(#21), costs no charge — but it scores nothing, because only kills score.
Armor is deliberately exempt: a non-text-object hit still chips a bracket, so
"armor needs a text object" survives intact. Difficulty is unchanged at every
skill level, because optimal play never partially hits; this only stops
punishing people for being new.

**R16. A line-number gutter, `nu` / `rnu` / off.**
Asked for directly. Relative is the default and is the right default for this
game: the number printed next to a lane *is* the count you type for `j`/`k`, so
the gutter turns "count the lanes" into "read the lane". The current lane shows
its absolute number, exactly as Vim's `set nu rnu` does. Numbers are **1-based**
so `7G` lands on the lane marked 7. The harness's `text()` stays 0-based because
it mirrors `json()`, and `AGENT.md` states the relationship; a machine reading
the state and a human reading the screen want different things here. The gutter
draws in the margin left of the field, falling back to an inset scrim on
viewports too narrow for a margin.

**R17. The warm-up cannot be lost.**
Reported as: "the 7G tutorial is also brittle if you screw up, add a redo
button." `r` restarts the current step (it is Vim's replace, which this game
does not implement, so nothing is displaced), and charges refill on every step
so a wasted `dd` can never make a step unwinnable.

**R13. There is no mute key. Sound lives on the pause card.**
`m` was bound to mute because `M` is a motion. The user's verdict: "m being mute
is stupid. Remove it." They are right — the game's whole premise is that the
keyboard is Vim, and carving one letter out for a volume control undermines it
for a setting people touch once. `Esc` opens the options card; `s` toggles
sound, `g` cycles gore. `m` is an unknown key again, which is what it should
have been: Vim's `m` sets a mark, and this game does not implement marks.

**R14. Card layout is asserted, not eyeballed.**
Shipped a title screen where the high score printed on top of a keycap row and
four strings ran off the right edge of the panel. `tests/ui-layout.test.ts` now
draws every card through a stub renderer that reproduces the real placement
arithmetic and asserts: nothing leaves the 60-column grid, nothing leaves the
panel it is printed on, nothing sits outside the drawable row band, and nothing
overlaps anything else on the same row. It runs over every lesson's wave card,
every warm-up step, every gore level, and a death screen loaded with the longest
values it can hold. Dynamic strings go through `fit()` / `wrap()` so a long
lesson description truncates instead of escaping.

**R9. Target lock: the crosshair rides the word it is on.**
Reported as "there is no lock on to words - once the zombie moves you lose
focus." It was true and it was miserable: you would aim, start composing a
command, and the horde would take a step out from under you. When the crosshair
is inside a zombie's span the sim now records `(lockId, lockOffset)` and
re-derives the column from that zombie every tick. Step off the word, or kill
it, and the lock drops. This costs the player nothing they should be practising
— the skill is *getting there* in few keystrokes, not tracking a moving target
by hand — and it makes "aim, think, fire" possible at all.

**R10. Cards are paper, so card text is ink.**
The `panel()` primitive draws weathered paper, but `src/ui/screens.ts` was still
passing the field palette — bone, dim, amber — which is built for a near-black
scene. On paper it was nearly invisible. Cards now use their own ink set
(`#1b1a17` pencil, `#6b6355` faded, `#7a1512` / `#9c1f14` red). Reported as "the
UI contrast sucks", and it did.

**R11. Everything drawn on the canvas must be printable ASCII.**
The glyph atlas bakes char codes 32..127 only, so every em dash I had written
into the curriculum and the options card rendered as a **blank**. That is how
"gore FULL - chunks" shipped looking like "gore FULL   chunks". All rendered
strings are ASCII now, and `tests/sim.test.ts` asserts it over the curriculum,
the warm-up, the word pools and the gore labels so it cannot come back. Docs and
the terminal harness still use em dashes — those are not going through the atlas.

**R12. A seven-step warm-up, `t` from the title.**
Wave 1 previously *was* the tutorial, which meant a first-timer met a clock
before they had pressed `dw` once. The warm-up has no spawn clock, an
invulnerable wall, and a step gate on each lesson: take aim, fire, jump by
words, `{n}G` to a lane, `x` on a crawler, `d3w`, and finally a lane where they
move. Score and kills are wiped when it rolls into wave 1, so it cannot pad a
high score. A player who already knows `dw` and shoots the step-1 zombie instead
of walking onto it is advanced rather than stranded — the goal check treats an
empty field as satisfied.

## The buffer and the field

**5. Derived rows are right-trimmed.**
`$`, `e`, and `dw`-at-end-of-line are meaningless if every row is padded to 60
columns. The cost is that the cursor's legal column changes as zombies die,
which is what #3 exists to absorb.

**6. Row 23 is the barricade and is part of the buffer.**
It is a real 60-character line, so `G` and `L` land on it and `}` treats it as
non-blank. Nothing can be killed there. This is more honest than pretending the
buffer is 23 rows and having `G` mean something invisible.

**7. Barricade glyphs are a left-to-right ramp with a 35%-wide transition.**
`#` → `=` → `-` → `.` → ` `. The wall's front starts off the right edge at full
HP so 100/100 renders as a solid, undamaged wall.

**8. Zombies block each other and pile up.**
A zombie only advances into row *r+1* if its span plus one cell of clearance is
free there. Otherwise it waits. This keeps derived rows unambiguous (no two
zombies ever overlap, so a row's text always maps 1:1 onto zombies) and produces
the traffic jams that make `dd` and `J` worth their charges. Movement is
resolved nearest-the-barricade-first so a stalled column releases cleanly.

**9. Spawn placement retries 24 random columns, then defers 250ms.**
Deterministic under the seeded RNG. A hard entity cap of 64 stops late waves
from unbounded growth.

---

## Vim semantics

**10. `w`/`W` with an operator never carries past the end of the last word it
moved over.** This is `:h word`, and it is why `dw` on the final word of a line
stops at end of line instead of eating the newline. Implemented by checking
whether the motion target is actually the start of a word; if it is not, the
motion ran off the end and the span clamps to the line end.

**11. An inclusive motion stays inclusive when it runs backwards.**
`d%` from a closing bracket deletes both brackets. Exclusive backward motions
(`b`, `F`, `T`, `0`, `h`) still exclude the character under the cursor.

**12. `cw` behaves like `ce` on a non-blank** (and `cW` like `cE`), as in real
Vim. `c2w` likewise becomes `c2e`.

**13. `.` repeats the last command that had an operator or a text object.**
Pure motions are not repeatable — the same rule Vim uses. A lone `.` after only
motions is an unknown key.

**14. `i` and `a` are only text-object prefixes.** Outside an operator they are
unknown keys, which is the joke: insert mode is death. (`i` on the title and
death screens is intercepted by the UI before the engine sees it.)

**15. `cc` is not supported.** `Operator` does not contain it, so `c` followed
by `c` is an unknown key.

**16. Quote text objects pair naively left-to-right**, which is what Vim does.
The word pools contain no apostrophes, so two `'`-armored zombies on one row
still pair correctly.

**17. `a"`/`a'`/`a(` take the delimiters but not Vim's trailing whitespace.**
The nuance buys nothing here and would make `da"` cover blank ground it did not
need, which under #21 would cost a charge.

---

## Game rules

**18. `J` crushes.** The spec unlocks `J` at wave 7 without saying what it does
to a horde. Joining row *r+1* into row *r* drags those zombies **away** from the
barricade; any that collide with what is already on row *r* are crushed and
count as kills. It is the only move in the game that buys time rather than
space, and it costs nothing but position.

**19. Plain movement never breaks the combo.**
The spec breaks combo on "an emitted command that affected nothing", which read
literally would break it on every `w`. It is scoped to *operators* that hit
nothing. Navigation is free; whiffing an attack is not.

**20. `dd` and `D` always spend their charge, whether or not they kill.**
The spec rations them; a charge that is only spent on success is not rationed.

**21. Any operator that wastes more than 4 cells of empty ground also spends a
`D` charge.** *This is the most consequential decision in the build.* Without
it, `d$` from column 0 is a free two-keystroke wipe of any row, `dd` has an
uncharged synonym, and every horizontal motion in the game is decorative — the
smoke bot found this within seconds and never pressed `f`, `w` or `t` again.
Waste is `cells covered − length of what actually died`, so a tight `dw`, a
`daw`, and a `d3w` across three adjacent words are all free, while a sweep
across blank ground is not. It makes the lesson literal: **move precisely, then
cut.** Moving is always free.

**22. Combo decay emits `combo_break` with reason `combo timed out`.**
The spec says a combo counts kills within 2.5s but does not say what happens
when the window lapses. It resets to 0 and says so, so the FX and the agent both
learn about it.

**23. `combo_break` is emitted even when the combo was already 0.**
It is the game's only "that did nothing" signal, and the harness needs it. The
renderer only shatters when there was something to shatter.

**24. Overkill still scores.** A crawler killed with `dw` dies and pays out at
the multiplier it earned; the break happens after. Only crawlers can be
overkilled — the spec names no other case, and generalising it would collide
with #21, which already punishes sloppiness through charges.

**25. Armored chipping does not break the combo.** It affected something, and it
is progress toward stripping the armor. It just does not score.

**26. `dd`/`D` splash is scoped to rows where a bloater was actually hit.**
On a bloater's row, everything the span touches dies even if only partly
covered. Elsewhere, normal coverage rules apply.

**27. Wave composition weights** (the spec gives the unlock order, not the mix):
waves 1–2 walkers only; 3–4 add runners at 30%; 5–6 add armored at 20%; 7–8 add
bloaters 12% and crawlers 10%; 9+ settles at 34/22/18/13/13.

**28. Base speed is `min(2.5, 1 + (wave-1) × 1.5/14)`** rows per second, so it
reaches 2.5 at wave 15 exactly. Runners are 2× that.

**29. A wave clears when the spawn queue is empty and the field is empty**,
provided at least one zombie was spawned *or* resolved. The second clause lets
tests build frozen scenes without a spawn queue.

**30. The unlock curriculum carries two lists.** `wave_start.unlocks` is typed
`MotionKind[]`, but waves 5, 6 and 7 teach text objects, `.`, and `dd`/`J` —
none of which are motions. The event carries only the motions; the wave card
reads a parallel `lessons` table in `src/sim/waves.ts` that can name any key.

---

## Input and UI

**31. `m` mutes, not `M`.** The spec asks for `M` as "the one non-Vim key", but
`M` is in the contract's `MotionKind` (middle of screen) and the curriculum
teaches it. Lowercase `m` is in no operator, motion or text-object set, so it is
the actual free key. On the title, pause and death screens, where no Vim input
is live, `M` mutes too. The user reported "M doesn't unmute" — it was doing
exactly what it was designed to do (aiming at the middle lane), which is a
discoverability failure, not a logic one. Fixed by putting the sound toggle on
the new pause/options card (#R7), showing a MUTED indicator in the HUD, and
saying it on the title screen.

**32. `:q<CR>` on the death screen prints `E37: No write since last change (add
! to override)` and stays put. `:q!<CR>` quits to the title.** Committing to the
bit properly means `:q` has to refuse. Any other `:command` gets a real-looking
`E492`.

**33. Unknown keys are reported through `VimEngine.onError`,** an optional
callback rather than a new return type, so the frozen `feed(): Command | null`
signature stands. `main.ts` uses it to flash the field and count arrow-key
reaches for the death line.

**34. Arrow keys, `v`, `p`, `u` and friends reach the engine unmapped** and fail
as unknown keys. That is deliberate: the death screen counts them.

**35. The renderer's cell grid is 60×28** — the 24-row field plus two HUD rows
above and below — but `Metrics.rows` is 24 and cell (0,0) is the field origin,
so `centerText(s, 12)` means the middle of the playfield and rows `-2`/`25` are
HUD. See `src/render/NOTES.md`.

**36. Waste is measured per kill *sequence*, not per command.**
The ledger anchors on the first command after each kill and counts every
keystroke until the next one, then brute-forces the cheapest single command that
would have killed that same zombie from the anchor's cursor. Measuring
per-command instead scored `jjjjllllllllldw` as thirteen perfect one-key moves
followed by an optimal `dw` — which is exactly the play the ledger exists to
catch. A zombie that spawned after the anchor is skipped.

**36a. The optimality search treats a charge as worth 3 extra keystrokes.**
Ranking purely by length makes `D` the answer to everything, so the ledger's
advice collapses to "you should have pressed D" and the smoke bot never presses
`f`, `w` or `t`. The penalty is refunded 2 keystrokes per extra zombie the
command kills, so `dd` on a crowded row still wins. Candidates whose plan
contains *any* overkill — including a crawler caught as splash collateral — are
rejected outright: the heuristic never recommends a combo-breaker.

**37. The optimality search narrows before it brute-forces.** Row candidates
(`{n}j`, `{n}k`, `{n}G`, `gg`, `H`, `M`, `{`, `}`), then a per-column cheapest-
keystrokes map built by running every plausible horizontal motion once, then the
operators that can kill that kind. Every surviving candidate is then *verified*
by running it through the real `VimEngine` and `resolve`, so the narrowing can
only make it miss a cheaper answer, never recommend a wrong one. It shares
`rules.ts` with the sim, so the two can never disagree about what a command does.

---

## Harness

**38. `Game`'s constructor starts a run; the browser passes `autoStart: false`.**
An agent should not have to press `i` to begin, but the browser needs its title
screen.

**39. `text()` always shows the cursor's row**, even when blank, and always
prints a `^` line under it. Everything else blank is omitted, per spec.

**40. `text()` carries a `ZOMBIES` table as well as a `LEGEND` line.**
The spec asks for "every zombie's kind in a legend line". A static legend
explains the five kinds; the table then states each live zombie's row, column,
kind and exact text, so an agent never has to infer `(lurch)` is armored by
parsing brackets out of a padded row.

**41. The `CHARGES` note is in `text()`** because it is a rule an agent cannot
deduce from the field, and this was found by actually playing a run from the
terminal and getting it wrong. A `STICKY_COL` field lived here too until #3
removed the concept it was reporting.

**42. The CLI writes `{t:"init"}`, one `{t:"in"}` per input line, and a final
`{t:"final",state}` on exit.** `scripts/replay.ts` compares both the per-input
event streams and the final state. If a log has no final line (the process was
killed), it replays twice and compares the two.

**43. `auto on` logs an explicit `step <ms>` line before each command**, so a
real-time session still replays deterministically.

**44. The smoke bot charges 55ms per keystroke.** Time has to cost something or
the bot is infinitely fast and the regression proves nothing. At that rate it
reaches wave ~53 before drowning, and wave 6 on seed 1 with the barricade
untouched.

---

**44a. The browser-vs-headless check was passing for the wrong reason.**
`scripts/browser-replay.mts` hardcoded `?seed=99` in its fake `location`, so it
only compared like with like while the newest log happened to be seed 99. It now
reads the log's `init.seed` *before* importing the bundle (which reads `?seed=`
at module load), asserts the bundle actually came up on that seed, and fails
loudly otherwise. Verified by corrupting one keystroke in a log and confirming
the check goes red.

**44b. A headless render smoke lives at `scripts/render-smoke.mts`.**
The renderer got large enough that "it typechecks" stopped meaning much. This
drives the real `Renderer` + `Screens` against a Proxy canvas that throws on any
non-finite argument, across title / play / pause / death, at 320x240, 1600x900
and 3840x2160, at all three gore levels, and checks `save`/`restore` balance.
It is in `npm run verify`.

**45. The browser-vs-headless proof uses a mock canvas, not Playwright.**
`scripts/browser-replay.mts` loads the real `dist/assets/*.js`, stubs the
handful of DOM surfaces Vite's preload shim and the renderer touch, drives the
production `window.__motd`, renders a frame through the actual draw path after
every input, and compares the final `GameState` byte-for-byte against the
headless log. A real browser would have meant a Playwright dependency, which
the "zero dependencies" constraint does not leave room for — and this catches
the thing that actually matters, which is the sim diverging between builds.

## Subsystem notes

Renderer-specific and audio-specific calls — glyph atlas, particle pooling,
flicker thresholds, kill-sound weighting, voice caps, the brown-noise
approximation — are written up in `src/render/NOTES.md` and
`src/audio/NOTES.md` respectively.
