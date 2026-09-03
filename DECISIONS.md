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
as unknown keys. That is deliberate: the death screen counts them. They are
silent, though - see #88.

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

## Player save (Phase F)

**46. One localStorage key, one versioned blob.** `motd.save` holds
`{version, id, createdAt, updatedAt, lifetime, salvage, unlocks, missions,
drills, settings, entitlements}`. The alternative — a key per feature, which is
what `motd.ledger` and `motd.settings` were — would have made export enumerate
keys and given every new feature its own migration surface. With one blob,
export is `JSON.stringify` and import is one validation path. `salvage`,
`unlocks`, `missions`, `drills`, `lifetime.medals` and `entitlements` are all
present and empty in version 1 precisely so the six changes that follow this
one need no schema migration.

**47. Unknown top-level keys are preserved, never stripped.** `coerceSave`
copies through any key it does not recognise, so a save exported by a newer
build and imported into an older one round-trips intact rather than silently
losing the newer sections.

**48. Import is a merge, with the rules written down once.** Counters sum
(`lifetime.motions.*.used/kills`, `missed.*`, `lifetime.kills`,
`lifetime.medals.*`, `salvage`); bests take the max (`highScore`,
`missions.*.stars`, `drills.*.best`); `missions.*.bestKeys` takes the *min*,
because fewer keystrokes is better — with 0 read as "no record", not as a
perfect run; `unlocks` unions; `runs` concatenate, dedupe on `at`, sort by `at`
and keep the newest 40; `settings` and `id` stay local; `createdAt` takes the
min. Overwrite-on-import was rejected: a player restoring an old backup onto a
newer local save would lose the newer progress, which is the exact failure this
feature exists to prevent. The same function is what a Firestore store will
call to sync, so cloud sync is a second store, not a migration.

**49. Merge doubles counters if you import your own export, so the export
carries an `id`.** The `id` is random hex assigned once at creation. An import
whose `id` matches the local save is labelled `this is your own backup` and the
confirmation card highlights `replace` instead of `merge`. Sums stay correct
for the case that matters, which is merging two different devices.

**50. The legacy keys are read once and never written or deleted.** Migration
runs inside `load()` when `motd.save` is absent; the presence of `motd.save` is
the marker that it already happened, so there is no `migratedFrom` field and
re-running `load()` is harmless. `motd.ledger` and `motd.settings` are left
exactly as they were, so a rollback to the previous build still finds its data.
Removing the legacy read path is a later cleanup.

**51. Writes are debounced, not synchronous.** `SaveStore.set()` mutates in
memory, stamps `updatedAt` and schedules one persist on the next macrotask;
`visibilitychange` and `beforeunload` flush. localStorage writes are
synchronous and medals and drills will write several times a second at 60 Hz.
The cost is losing the last frame's writes on a hard crash, which is acceptable
because every deliberate exit — tab close, navigation, backgrounding — flushes.

**52. `Ledger` and settings are views over the save, not owners of storage.**
Both take a `SaveStore`; neither touches `localStorage`. `Ledger.data` is a
getter onto the live `save.lifetime`, so the per-keystroke hot path stays a
plain object mutation and the persist happens once, at `endRun()`. One write
path is what makes a later cloud store a drop-in.

**53. The save screen's three DOM elements live in `index.html` and are driven
from `main.ts` only.** A hidden `<a download>` for the file export, a hidden
`<input type="file">` for the import, and a hidden `<textarea>` for the paste
fallback when `navigator.clipboard.readText` is unavailable or refused.
Drawing a text box on the canvas and capturing paste events was rejected:
keyboard paste into a canvas is fragile across browsers, and two hidden
elements are a smaller cost than a canvas text editor. The "no DOM in
`src/ui`" rule stands — `src/ui/savescreen.ts` only draws.

**54. The checksum detects corruption, not cheating.** 32-bit FNV-1a over the
canonical JSON (keys sorted recursively) of the export without its `checksum`
field. A local save is the player's own file; there is nothing to defend
against and any real leaderboard would need server-side validation anyway.
Errors are Vim-numbered to match the death screen's `E37`: `E482` for a blocked
clipboard, `E484` for a file that will not open, `E485` for one that will not
read.

**55. `src/save` and `src/sim` do not know about each other.** Nothing under
`src/sim`, `src/vim` or `src/core` imports from `src/save`, and `src/save`
imports from none of `src/sim`, `src/render` or `src/audio` — which is why the
two string unions the renderer also declares are restated in
`src/save/schema.ts` rather than imported. Asserted by a test that greps the
trees. The CLI harness and the replay chain run with no save at all, which is
what keeps `verify:browser` meaningful.

## The main menu (Phase G)

**56. `GameState.phase` gained `menu` and `shop`; `SimState` gained `mode`.**
Both additive, both here because the frozen contract says they have to be.
`phase` needed `menu` because the title screen is now a seven-row menu with
sub-screens, and the harness, the smoke bot and `text()` all need to know the
game is not in a run — `title` could no longer carry that alone. `shop` is
added in the same breath rather than later because a purchase changes sim state,
so `survival-store` will need a real phase and adding it now costs one union
member instead of a second contract edit. `title` is still accepted and the UI
layer treats it as `menu`, so `autoStart: false`, hand-set fixtures and
`Sim.toTitle()` (now an alias of `toMenu()`) all keep working unchanged.
`SimState.mode` is `survival` | `mission` | `drill`, set only by
`Sim.start(mode)` and `startTutorial()` (which sets `mission`), never read by
the menu: the menu decides what to launch, the sim decides what the rules are.
It is in `json()` so a replay carries it.

**57. The menu has its own key matcher, not the `VimEngine`.**
`src/ui/menu.ts` is a ~60-line matcher over `j k gg G H M L / n N Enter l h Esc`
plus counts. Routing menu keys through the engine would mean receiving `Command`
objects built for the field — operators, text objects, target lock — and
stripping the motions back out of them, and every operator key would arrive as
an unknown key and beep. The model is pure and lives apart from the drawing, the
same split as `VimEngine` versus `Renderer`, so `tests/ui.test.ts` pins every
motion in Node.

**58. On the options screen `g` cycles gore, so `gg` does not work there.**
The spec asks for both "`gg` goes to the first row" and "the same keys as the
pause card", and the pause card's gore key is `g`. One of them has to lose on
that one screen. Gore wins: a player who opened `options` came to press `g`, and
`H` and `1G`-style jumps still reach the first row. Every other screen keeps
`gg`. The per-screen direct-key map makes this explicit rather than accidental.

**59. Mouse hit-testing reads back the rows the draw actually placed.**
`Screens.drawMenu` records each row's cell row as it draws it, and
`Screens.menuHit(cellRow)` maps a click back through that list. The alternative
— layout constants duplicated in `main.ts` — is the same bug R14 exists to
prevent, one layer up. `main.ts` converts the pointer to a cell row with
`renderer.metrics()` (`floor((clientY - rect.top - oy) / ch)`), so no DOM
element is added and the mock-canvas replay stays valid. A click on a row the
draw did not place — the gaps between rows, the header, the footer — returns -1
and does nothing. Hover is not tracked, so keyboard and mouse never fight.

**60. The save row opens the existing `player-save` screen, keys and all.**
The change's spec says the save screen offers "`e` export and `m` import",
which was written before `player-save` shipped. That screen already exists with
four keys — `e` download, `y` clipboard, `o` open a file, `p` paste — all
documented in the README and asserted in `tests/ui-layout.test.ts`, and `m`
already means `merge` on its confirmation card. Renaming `o` to `m` would break
a shipped, documented surface to satisfy a placeholder. `e` is unchanged and
import is still one keypress; the screen gained the version, run-count and
salvage lines the requirement asked for.

**61. `missions` launches the warm-up; only `drills` and `armory` are `soon`.**
The proposal says the warm-up moves behind the `missions` row and also lists
`missions` among the placeholders. A row cannot both launch a run and be a
placeholder that changes no phase, so `missions` is a real row labelled `the
warm-up, for now` and the `missions` change will replace its content. `t` is
gone from the menu, the death screen and `Game.keys()`; the death screen gained
`Esc` back to the menu alongside `:q!`.

**62. The mission select screen is two panes, and the demo runs on its own Sim.**
Asked for directly: "the left side shows the mission type and what you will
learn, and the right is a preview of the hotkeys and an interactive demo of how
it works." Left pane is the seven boot-camp missions; right pane is that
mission's keycaps, its own small field, and its hint. The demo feeds one key of
a scripted string through a real `VimEngine` into a real `Sim` every
`DEMO_KEY_MS`, so the command form, the motion, the coverage rules and the kill
are resolved by the same code a live game runs - the player is watching the
game play itself, not an animation. Keycaps light as they are pressed and go
dark when the loop restarts.

The demo owns a **separate** `Sim`, which is what lets the menu keep the
isolation rule in the `game-mode-contract` spec: browsing never reads or writes
the live `GameState`. It also never calls `tick()`. No clock means nothing
walks, nothing spawns, the barricade is never hit, and a demo can loop forever
without the warm-up state machine advancing underneath it. `Sim.startScene()`
exists for exactly this one caller.

**63. Demo scenes are authored separately from the missions they teach.**
A mission scene is spread across 52 columns; the demo pane has 19. Rather than
scroll a viewport - which would leave the crosshair and its target off-screen at
opposite ends of the pass - each step carries its own compact `demo` scene, and
it is allowed to be simpler than the mission. "Now they move" is three walkers
and a runner in the mission and one runner in the demo, because `$` is the
lesson and a crowd is not. `tests/ui.test.ts` drives every demo through the
engine and asserts it actually meets its mission's goal and presses every
keycap on the strip, so a demo that stops working fails `npm test` rather than
looking broken on the card.

**64. The mission number goes in front of the title, not after it.**
Shipped with `n/7` in a right-hand column and `Pick your lane` - the longest
title, at exactly the column budget - printed flush against `4/7`. The layout
test passed it, because a box ending exactly where the next one starts is not
an overlap by the assertion's arithmetic. Moving the number to the left of the
title gave the titles the whole pane and removed the class of bug. The same pass
found the pane divider drawn straight through the footer, which the layout test
cannot see at all because `fillCells` is decorative and the Ruler no-ops it.
Screenshots are still worth taking (#R14 asserts, it does not see).

**65. The warm-up teaches `{n}j`/`{n}k`, not `{n}G`, and both ends of a lane.**
Reported as "7G is a motion that DOES NOT make sense", and it does not - for a
human. The mechanic was never broken: `7G` lands on lane 7 at its first
non-blank, exactly as documented. The *lesson* was wrong twice over. A zombie's
absolute lane number is random noise that changes every spawn, so there is
never a lane `n` you want; and the gutter the player actually runs is relative,
whose printed number is the count for `j`/`k` and is meaningless to `G` (#R16
says as much). The step had to force `absoluteGutter: true` to make its own
lesson legible, which was the tell. Step 4 is now `3k` / `3j`, with every
zombie in the scene sharing a column so the lesson lands on the real insight -
`j` and `k` carry the column with them, so hitting the lane hits the word.
`absoluteGutter?: true` became `gutter?: 'absolute' | 'relative'`, since a
counted motion needs its count printed next to the lane either way.

Step 7 gained `0` alongside `$` in the same pass, also asked for directly. The
rotation (#R1) made those the two most useful horizontal motions in the game -
`$` is whatever is closest to the wall, `0` is whatever just walked on - and
teaching one without the other left the lane with one end.

`{n}G` remains in the engine and remains the right motion for an *agent*, which
reads absolute lane numbers straight out of `text()`. `AGENT.md` still
recommends it and says why the human curriculum does not.

**66. Card strings have asserted length budgets now, not just asserted bounds.**
Both new hints overflowed the mission strip's `fit(hint, 49)` and were silently
truncated - and so was step 5's, which had shipped that way. `fit()` guarantees
a string cannot leave its panel, so the layout suite (#R14) was green the whole
time: truncation is not an overflow. `tests/sim.test.ts` now asserts every
warm-up hint fits the strip un-truncated, wraps into three 22-cell lines for the
select screen's pane, and that every title fits the list column.

## Medals and the run wallet (Phase F)

**67. Three additive contract fields, and the reason for each.**
`GameEvent` gains `{ t: 'medal'; name; bonus }` and
`{ t: 'kill_judged'; zombieId; spent; optimal }`; `GameState` gains
`supplies: number`; `SimState` gains `judge: JudgeAnchor | null`. The medal
event is what the callout stack, the medal sting and the salvage credit all
listen to, so there is one source for a medal rather than three. `kill_judged`
is the sim publishing the oracle comparison it already ran, which is what lets
the Motion Ledger keep `wasted` / `missed` / never-used without running
`optimalKill` a second time. `supplies` is in `GameState` and not in the Ledger
because the survival store spends it and `json()` has to be a complete
snapshot. `judge` is in `SimState` for the same reason: a private field on
`Sim` would leave a replay able to diverge on whether the next kill was
PERFECT.

**68. Kill judging moved out of the Ledger and into the sim.**
The anchor snapshot, the keystroke count and the `optimalKill` comparison used
to live in `src/ui/ledger.ts`, which runs only in the browser. Paying a wallet
out of a browser-only judgment would make `verify:browser` fail by
construction: the headless harness, the smoke bot and the replay checker would
all disagree with the page about `supplies`. So `src/sim/judgement.ts` owns
`beginAnchor` / `judgeKill` and `src/sim/medals.ts` owns the ladder and the
payout tables, both pure, and the Ledger became a listener. The cost is that
the oracle now runs in the headless path too - it already ran per kill in the
browser, and `npm run smoke` is where that is measured.

**69. Overkill suppresses SNIPE, BREACH and CALLED SHOT. It does not suppress
PERFECT.**
The specs disagreed with themselves here: the design lists PERFECT among the
style medals, which are blanket-suppressed by an overkill, while the PERFECT
requirement carries its own exception list (trap kills, kills that are not the
first of a sequence, a zombie missing from the anchor) and does not mention
overkill. The requirement won, because it is the more specific text and because
the combined case is nearly unreachable: `optimalKill` refuses to recommend a
plan containing an overkill, so beating the oracle *with* an overkill needs the
messy command to be no longer than the clean one. When it happens the player
gets the callout and loses the combo, which reads as the joke it is.

**70. Trap kills are excluded at the source, before traps exist.**
`survival-store` will kill with a `via` of `trap:<name>`. `isTrapKill(via)` is
in `medals.ts` now and every judging and payout path is already guarded by it,
so the store lands without having to revisit the medal code. Traps pay base
score and nothing else.

**71. FIRST BLOOD is the one medal the sim does not emit.**
It fires on the first *lifetime* use of a token, which the sim cannot know
without taking the save as an input - and a sim that reads the save is a sim
whose replays depend on it. So the Ledger emits
`{ t: 'medal', name: 'FIRST BLOOD', bonus: 0 }` onto the same bus, at most once
per command, and it pays salvage only. The harness never emits it, and its zero
bonus is what keeps `supplies` identical between the browser and the headless
run.

**72. Salvage is credited through `player-save`, which had already landed.**
Design decision 10 allowed a fallback to the legacy `motd.ledger` key if this
change shipped first; it did not, so `creditSalvage(store, n)` sits in
`src/save/save.ts` alongside the other write paths and there is nothing to
migrate. The Ledger also counts each medal into `lifetime.medals`, the field
`player-save` reserved for exactly this (#46).

**73. Pre-medal `runs/*.jsonl` logs are not byte-comparable.**
`supplies` and `sim.judge` are in the final state and `medal` / `kill_judged`
are in the per-input event streams, so a log recorded before this change
replays correctly as a *game* but fails the identity check. The baselines were
regenerated. `createState` defaults the new fields, so a hand-written fixture
state still loads.

**74. SNIPE is judged over the sequence, not over the killing command alone.**
`medals/spec.md` asks for a SNIPE on `fddw`, but the command that kills there
is `dw` - the `fd` only aimed. Reading SNIPE off the killing command's own
motion, as design decision 5 does, would fail the spec's own scenario, so the
anchor carries a sticky `find` flag: any `f`/`F`/`t`/`T` since the anchor makes
the kill that ends the sequence a snipe. That covers `dfh` on a runner as well,
where the killing command is itself the find. `;`/`,` arrive already expanded to
the concrete find they repeat (#1), so they count with no extra case. BREACH
stays on the killing command, because a text object *is* the kill.

**75. Moving the oracle into the sim cost nothing measurable.**
Design decision 3 flagged the risk and set the bar at a 2x regression in
`npm run smoke`, with a narrowed candidate set as the fallback. Measured on
this machine over three runs each, with `judge()` short-circuited for the
"before" figure: `npm run smoke` 0.40s -> 0.41s, `npm run smoke:render` 0.94s
-> 0.96s. The oracle runs once per *kill sequence*, not per keystroke, and the
smoke bot was already calling it once per turn, so the mitigation was not
applied and `optimalKill` is untouched. `npm run smoke` now prints the bot's
supplies and supplies-per-wave, which is the number `survival-store` will
price against.

**76. The stats screen is called `record` in the UI and `Ledger` in the code.**
"Ledger" is bookkeeping jargon, and it was on a menu row next to `survival`,
`armory` and `save` - which all speak the game's own register - describing a
screen that is really a personal performance record. Reported directly: "wtf is
a ledger. that makes no sense in the UI." The three player-visible strings are
now the `record` menu row ("your service record"), the `SERVICE RECORD` screen
title, and the `MOTIONS` block on the death screen.

The class, the file and the screen *id* keep the old name. The id is the stable
key the screen stack, `{ t: 'screen', screen: 'ledger' }` and `text()`'s
`MENU ledger` header all use, so renaming it is an API change rather than a
copy change, and it would have dragged `MenuScreenId`, the `screens.ts` and
`main.ts` dispatch and a dozen assertions along with it for no player-visible
gain. `MenuRow.id` and `MenuRow.label` were always separate fields; this is the
first row where they diverge, which is what the fields are for.

The one visible seam: an agent inside the screen still reads `MENU ledger`
while the row it arrived from reads `record`. `AGENT.md` says so out loud.

Menu search matches on `label`, so `/led<CR>` no longer finds it - `/rec<CR>`
does.

**77. `SimState` grew twelve fields and `GameEvent` three variants for the
survival store.**
Additive only, every field defaulted in `createState()`, so `json()` stays a
complete snapshot and a hand-written fixture still loads. The fields are
`shop`, `traps`, `nextTrapId`, `chargeCap`, `purchases`, `wasteBonus`, `flare`,
`wireLanes`, `spotter`, `manifest`, `secondWind` and `freeRepeat`; the events
are `buy`, `trap_fire` and `revive`.

The store cursor is sim state rather than screen state because the list cursor
decides what `l` buys, which decides sim state — a replay that did not carry it
would buy a different item. For the same reason every purchase is a keystroke
that reaches the sim through `Game.keys()`, and `main.ts` routes shop keys
through `game.keys()` instead of its own switch, which is the divergence
`verify:browser` exists to catch.

`ItemId`, `ITEM_IDS`, `TrapKind`, `Trap` and `ShopState` are declared in
`core/state.ts` and re-exported from `sim/store.ts` and `sim/traps.ts`, the
same shape `JudgeAnchor` already had (#67): `core` may not import `sim`, and
these are the shape of state. The *tables* — names, blurbs, prices, caps — live
in `sim/store.ts`, which is the file the spec names and the file a tuning pass
will edit.

**78. Charges no longer refill between nights in survival.**
`startWave` refills `charges` only when `sim.mode !== 'survival'`. A run still
starts with `dd: 2, D: 3` and a `chargeCap` of the same, so the first night is
unchanged; thereafter `dd` and `D` are ammunition bought in the store, and
Bandolier raises both caps. Missions, drills and the warm-up keep the per-step
refill, so no scripted step can be made unwinnable by a wasted `dd`.

This is the most consequential rule change in the store proposal and it makes
the game harder before the store makes it easier. `scripts/agent-smoke.ts`
therefore shops - it tops up `D`, then `dd`, while the wallet allows - and the
seed-1 wave-6 assertion is unchanged.

Measured, though, the bot buys **nothing**: `npm run smoke` reports
`bought nothing` on seeds 1, 7 and 91, out to wave 12. `optimalKill` prices a
charge op at `CHARGE_PENALTY` (3) keystrokes over its length, and on a field
this sparse a plain `dw` is always cheaper, so the bot never spends a charge
and never needs to replace one. The shop routine still runs every night and is
what proves the store is reachable from `Game.keys()` alone; the ammo economy
is simply not what constrains a machine playing optimally. It constrains a
human reaching for `dd` on a crowded lane, which is who it is for - and it is
the first number a tuning pass should revisit, because right now the wallet
grows at ~190-330 supplies a night with nothing it must be spent on.

**79. The survey grid is the generated 52-column ruler, not the literal one in
the design.**
`field-traps/spec.md` prints the placement ruler as
`0....5....10...15...20...25...30...35...40...45...50.`, which is 53 characters
and whose word boundaries do not match the spec's own scenarios: `2w` from
column 20 lands on 25 on that string, and the scenario asks for 30. The grid is
built the way `format.ts` already builds its ruler — a digit every tenth column,
`.` elsewhere, `FIELD_COLS` wide — which gives `0.........1.........2....`, is
exactly 52 columns as the requirement says, and satisfies both scenarios: `f3`
lands on 30 and `2w` from 20 lands on 30.

**80. Trap kills pay score and nothing else.**
`trapKill()` is a separate path from `kill()`: it adds `10 * text.length` with
no combo multiplier, increments `kills` and `resolvedThisWave`, emits `kill`
with `via: 'trap:<kind>:<id>'` plus a `trap_fire`, and leaves `combo`,
`lastKillAt`, `longestCombo`, `overkills` and `supplies` alone. `isTrapKill`
(#70) already excluded the `trap:` prefix from medals and the wallet. A trap is
a wall you paid for, not a gun, and a crawler taken by a minefield is not an
overkill.

Traps fire inside the movement loop, after each single-column step, so a runner
covering two columns in one tick cannot skip a wire. A zombie that reaches the
barricade on the same step is resolved by the barricade, which makes a trap at
the wall's foot honestly useless — the placement strip says so.

**81. Manifest is the one item capped per store visit rather than per run.**
Every other cap counts `purchases[id]` (or, for `dd`/`D`, the charge against
`chargeCap`, and for Repeater the banked `freeRepeat`). Manifest reveals the
next night "for the remainder of that store visit", so a `purchases` cap of 1
would make it 20 supplies of dead money after the first night. It is gated on
the `manifest` flag instead, which `openShop()` clears, so it is re-buyable
each night. Whetstone is cleared the same way — `openShop()` zeroes
`wasteBonus`, which is what makes it last exactly the one night it was bought
for without a second field to remember which night that was.

**82. Pre-store `runs/*.jsonl` logs are skipped, not replayed.**
An old log replays as a *game* but diverges at the first `wave_clear`, because
in survival that no longer sets a breather. The `init` line now carries
`version` (`LOG_VERSION` in `src/harness/repl.ts`); `scripts/replay.ts` and
`scripts/browser-replay.mts` pick the newest log at or above it and print which
older ones they skipped, rather than failing on a log that was never wrong. A
new baseline was recorded. Rollback is reverting the change: run wallets and
traps die with the run, so no stored save format is affected.

**83. The store card prints one blurb, not fifteen.**
The first cut of the card gave every row its own description column, 20 cells
wide against blurbs of 40 to 53. Reported on sight: "the store is hard to
read." Fifteen sentences each ending in a truncation dot is not a description
of anything, so only the *selected* item's blurb is printed now, on a
full-width line under a hairline at the foot of the card. That paid for name,
price and owned columns wide enough to read at a glance, and
`CARD_LINE` (52) is asserted over the real `ITEMS` table and over
`manifestCard` at ten different nights, so a blurb that would truncate fails
the suite instead of the eye.

Two other things came out of the same look. The header rule was drawn one row
under a two-cell-tall `STORE` heading and struck through its baseline, so the
heading now separates the header on its own. And a single red row meant both
"you cannot afford this" and "your magazine is full"; the price goes red only
for money now, and a capped row says `full`.

**84. Entering the store is a page turn.**
Nothing announced the store: the card simply replaced the field, with no
heading and no transition, and the same report said so. `Renderer.pageTurn(p)`
sweeps a sheet of paper west across the whole viewport - in from the right,
covering, out to the left - so the card is *revealed* behind it rather than
faded in over it. That needs no alpha on text and no clipping, which is why it
is a canvas sweep drawn after the finished card rather than a transform around
it.

`Screens` owns the clock, keyed on `state.wave`: `drawStore` only runs while
the store is open, so a change of wave number is a new visit and a new page.
`tests/ui-layout.test.ts` draws at `tMs` 0, which is `p` 0 - the card is
measured in full underneath - and `scripts/render-smoke.mts` holds still for
`PAGE_TURN_MS + 40` so every frame of the sweep goes through the real draw
path.

**85. Placement is taught in three places, and none of them is a paragraph.**
Asked directly whether there was a tutorial for setting a trap, there was not:
the store's placement mode shipped with one line on its strip
("Enter anchor, then move and Enter again"), which states the mechanism and
never makes anyone do it. Three answers, at three costs:

*The strip teaches on first use.* `drawPlacement` gained a `teach` region that
grows the panel a row per line, capped at four so it cannot reach the first
lane. Until a run has planted anything - derived from `purchases`, so there is
no flag to keep - it says the one thing about placement that is not guessable:
the lanes below stopped being the horde and became a ruler.

*Boot-camp mission 8, `Set a trap`.* It runs the **real** placement mode, not a
mock: `phase` is `shop` and `shop.mode` is `place`, which is what routes keys
to `shopCommand` and what makes the renderer draw the survey grid. What the
mission takes away is the store - there is no card behind it - and the economy,
via `TUTORIAL_SUPPLIES`. Three consequences worth naming: `<Esc>` clears a
half-set anchor instead of opening a store that is not there; `r` had to be
handled in `feedShop` too, because during this mission `r` is not a Vim key;
and a fence narrower than the three lanes asked for re-arms placement with the
stub left on the field, so a short span is a retry rather than a dead end.

The mission is the last step deliberately. It is the only one that cannot be
finished by killing things, so every automated walk of the warm-up - two sim
tests and `scripts/render-smoke.mts` - had to learn to plant. That is the
lesson doing its job, not a test tax.

The demo pane cannot enter placement (it has no store and never leaves
`apply`), so `DemoScript` gained an optional `goal`: a `plant` mission's pane
proves the counted motion the plant is made of and declares `clear` for
itself. The pane teaches the keystroke, not the scene, which is what it always
claimed to do.

*The drill is specified, not built.* A placement drill needs `drill` mode,
which `drills-and-coach` owns and which does not exist yet; building it here
would have been starting a different 28-task change uninvited. It is written
into that change instead as design D9 plus three tasks - the one family scored
on a span rather than on a kill, with `cheapestPlacement` for its PERFECT rule,
because the oracle has nothing to say about a plant.

The mission count is now derived from `TUTORIAL.length` in the six places that
hard-coded seven (`repl.ts` help, the render-smoke banner, and four test
assertions). Adding the eighth mission broke all of them, which is the sort of
thing that should break once.

**86. A refused command now says so, which is what "the game randomly ends" was.**
Reported as: "Ive noticed the game is randomly ending." There is exactly one
path to `phase = 'dead'` - `hitBarricade` reaching 0 HP - so the run was not
ending randomly, the wall was coming down. What was random was the *feedback*.

A command the sim declines to run produced nothing at all on screen. It emits
no `shot`, kills nothing, moves nothing, and its only signal was
`combo_break`, which the renderer answers by shattering the combo digits - and
the combo is already 0 in exactly the situation that matters. Type `dd` with an
empty magazine and the game did nothing, said nothing, and drew nothing. Do
that four times on a crowded lane and the wall is gone.

#78 made this common and predicted it in the abstract - "it constrains a human
reaching for `dd` on a crowded lane" - without noticing that the constraint was
invisible. The ammo economy is not being rolled back; the silence is fixed:

- `combo_break` gains an additive `refused?: true` (frozen contract, additive
  only). The sim marks it rather than the renderer or the log pattern-matching
  the reason text, which is a coupling that breaks the moment the wording
  changes - and it did, mid-change, which is how the flag earned its keep.
- A refusal flashes the field red - feedback an unknown key used to share,
  until #88 made unknown keys silent - and prints its reason under the OVERKILL
  row for `NOTICE_MS`.
- Two cases are refusals: an empty magazine, and a motion that resolved to
  nothing (`dfq` with no `q` on the lane). A command that fires into empty
  ground stays an ordinary break - `emitShots` already draws the tracer, so it
  was never silent.
- The `dd` and `D` counts in the HUD go red at zero. In survival they do not
  refill, so empty is a state you have to be able to see without being told.

The no-charge message names the store, because buying one is now the only way
to get another.

**87. Logging is a ring buffer, a level, and an optional sink.**
Asked for as "maybe just a query param in the url debug=1, log only info level
stuff otherwise". `src/core/log.ts` imports nothing and touches no DOM at
module scope, so importing it headless is inert and a test that installs no
sink prints nothing. `?debug=1` raises the level to `debug` and installs a
console sink; without it the level is `info`.

The ring is kept regardless of the flag and regardless of the sink, capped at
`RING_MAX`. That is the part that actually answers the reported bug: a player
who has just watched a run end can call `__motd.logs()` and read back every
breach, what they had in the magazine at each one, and what they had been
typing since the last kill. A flag you have to set *before* the thing happens
is no use for something that happens randomly.

`src/core/watch.ts` narrates the bus rather than the sim calling a logger, so
the sim needs no logging code and a log line cannot change what it does. That
last part is asserted directly: two games, one watched at `debug` and one not,
fed identical keys, must produce byte-identical `json()`. Otherwise
`verify:browser` would be comparing two different games.

Levels are chosen around the one question worth answering after the fact:
every breach, every night, every purchase and every refused command are `info`
or worse; the play-by-play of commands, kills and medals is `debug`.


**88. An unknown key is silent.**
Reported as "why does pressing v cause the screen to flash", then "make it
silent because people are gonna fat finger things". `v` is the common one -
there is no visual mode - but every unbound key washed the field red for 80 ms.

Vim beeps at you; this does not. A red field is the same signal the game uses
for a *refusal* (#86), where it is earned: you typed a real command and the sim
declined it, and you need to know why. A mistyped key has no such story, and
punishing the reach makes the keyboard feel hostile to the exact player who is
still learning where the motions are.

So `unknownKey` only breaks the combo. `screens.unknownKeys` still counts them
for the death line's arrow-key joke (#34), which was always the better feedback:
it lands once, after the run, instead of eighty milliseconds at a time.

This removed the last caller of `Renderer.flashError` and `FlashFx.error`, so
both are gone; the refusal wash runs off `sim.flashUntil` alone.

**89. A night nobody fought is a loss, not a wave you cleared.**
Reported as: "I let every zombie come in and kill me. Instead of a game over
screen, it let me progress to the next map." Both halves were true, and the
second one was the bug.

The wall is a health bar and there was exactly one way to die - `hitBarricade`
reaching 0 HP (#86). Wave 1 is 8 walkers and a walker costs its word length, so
an entirely ignored first night deals about 41 of 100 damage. The field empties,
`wave_clear` fires, the store opens, and night 2 starts. You die on night 2, one
map after the one you stopped playing, which reads as the game ignoring you and
then killing you for no reason.

Raising breach damage until one wave could take the whole wall was the other
candidate and was rejected: it re-tunes every night for every player to fix the
one night nobody played, and it invalidates the #6 baselines (machine ~87, quick
human ~34). The wall's cost per breach is the difficulty curve and it is not
what was wrong.

So the clear condition gained the missing half. `SimState.killsThisWave` counts
what the *player* resolved - a trap kill counts, because a trap is something you
bought and placed - and an empty field with zero of them, on a night that fully
spawned, is `die('overrun')` instead of `wave_clear`.

`die` takes a cause for the same reason. Second Wind buys back wall HP, so it
answers a breach and not an overrun: reviving the wall after a night you did not
fight would only hand you the next one. The "fully spawned" half of the test is
what keeps the two apart - a partial wave the wall happened to absorb is a
breach, which is what Second Wind is for.

The warm-up got the same rule for a different reason. `hitBarricade` returns
early while a mission is live, so a zombie that walked past you was silently
deleted and the empty field it left behind advanced the mission. Every mission
spawn is speed 0 today, so nothing could reach the wall and the hole was
unreachable - but the `missions` change makes them move. It now sets
`tutorialEscaped`, which restarts the step rather than passing it. The warm-up
still cannot be lost; it just cannot be idled through either.

`LOG_VERSION` is 3: `SimState` gained two fields, so a version-2 log's recorded
final state is missing them (#82).

**90. A browser key name is one token, never a run of letters.**
Reported as: "pressing a bum key like down on the arrow keys caused me to
accidentally close the shop and start the next wave."

`Game.keys()` reads its string one character at a time, with `<...>` as the
only multi-character token (#77). `main.ts` passed `KeyboardEvent.key` through
raw, and outside `Escape`/`Enter`/`Backspace` a browser key name is a word:
`ArrowDown` became the nine keystrokes `A r r o w D o w n`. In the store `n` is
NEXT NIGHT, so the down arrow bought nothing, moved nothing, and started night
two. The same split fed `Shift` as `S h i f t` before every capital letter.

`src/ui/keys.ts` now owns the translation. A printable character is itself;
the three Vim specials keep their names; any other name is wrapped once, so
`<ArrowDown>` reaches the engine as a single key and fails as one unknown key,
counted for the death line as #34 always intended. A press that is only a
modifier (`Shift`, `Meta`, `CapsLock`, `Dead`, ...) is not a keystroke and is
dropped before the click sound.

Mapping arrows to `hjkl` was rejected: the death line's arrow-key count is the
game's answer to arrows, and it only works if reaching for one fails.

**92. Shooting letters off a zombie shoots pieces off the zombie.**
Reported as: "when you press X it should shoot off parts of the zombie until it
becomes a crawler."

Erosion (#R15) already took letters off the word and left the figure whole,
which read as the word and the body being two different things. Now each
letter lost costs a body part, in a fixed order the renderer derives from how
many letters have gone: the near arm, the far arm, a hole through the flank,
the top of the skull, then a second wound. The piece comes off as a gib that
lands on the grass, with a squirt in the direction the shot went.

The sim's half: a word eroded to its last letter **becomes a crawler**, kind
and all. It already drew as one (`figureKind` treats one letter as a crawler),
so this only makes the rules agree with the picture: `x` is the clean kill and
anything wider is overkill (#R15's "armor needs a text object" has a twin now,
"a crawler needs `x`"). A runner that gets there has lost its legs and drops to
half speed. Armor is exempt: chipping brackets off is not flesh, and a stripped
`(a)` is a walker as before. Optimal play is untouched, because the oracle
never partially hits; this is a consequence for the player who does.

**91. The menu got an about page, and the card grew upward to make room.**
Asked for: "improve the main menu to have more of an about page / introduction".

The title card had nowhere to say what the game is. `about` is now the eighth
row, and it opens four short pages - the idea, the keys, the lesson, the build
- under a tab strip. The pages are rows in the `Menu` model (`ABOUT_ROWS`,
derived from `ABOUT_PAGES` in `src/ui/about.ts`), so `j`/`k` turn them with no
new state, `h` backs out, and `text()` prints the page under the tab list for
an agent to read. Enter on a page does nothing: a page is read, not activated.

Eight rows at the menu's two-cell stride need fifteen cells, and the seventh row
already sat on 15 with 16 blank and the footer on 17. Rather than lose the
blank row before the footer (the reason the footer never looked like an extra
row, #59), the shared card grew one row at the top: `P_ROW` is -5 and the title,
tagline, score line and rule each moved up one. Every menu screen shares the
panel, so none of them jumps; the sub-screens simply have a row more of paper
above their title.

`about` is the last row on purpose. `G` is the one motion a new player is
guaranteed to learn on the menu, and the header slot that shows the high score
reads `FIRST NIGHT?  G  about` until there is one. That is the whole first-run
introduction: one line, no modal, no flag in the save. Auto-opening the page on
first boot was rejected - the title with the field behind it is the best thing
the game has to look at, and the harness and every test expect `MENU main`.

The copy is plain ASCII, wrapped at draw time to 44 cells and 15 rows;
`tests/ui.test.ts` asserts every page fits with nothing truncated, so a
rewrite that runs long fails a test instead of losing its last line.

**93. Missions replace the warm-up: forty-one scenes, a par each, nothing locked.**
The seven-step warm-up (#R12) was the only self-paced teaching in the game and
it covered five motions once, then rolled you into wave 1. The 33-lesson
syllabus only existed as a four-second wave card in survival. `src/sim/missions.ts`
now holds one table: boot camp (the eight warm-up steps, verbatim, #65 and #85
included) followed by one mission per `CURRICULUM` lesson, whose `section`,
`title` and `keys` are *read from `waveDef(n)`* so the two tables cannot drift
on wording. Only the scene, the hint and the demo are authored per lesson.

Two beats, not three. The proposal had WATCH / TRY / DONE with the demo run
inside the sim; `main-menu` shipped the demo on the select screen's right pane
first (#62, #63), and that is the better home: you watch while you browse, and
Enter goes straight to TRY. `SimState.missionBeat` is `try` or `done`.
`tutorial`, `tutorialHold` and `tutorialEscaped` became `mission`,
`missionBeat`, `missionHold`, `missionKeys` and `missionEscaped`, so a
mission's keystrokes are in the snapshot and a replay judges it identically
(`LOG_VERSION` 4). TRY is the warm-up mechanic unchanged: invulnerable wall,
magazine refilled per attempt, `r` from the top, an escape restarts (#89).

**Par comes from the oracle, and it is judged with an empty magazine unless
the lesson is about the magazine.** `parFor` runs `optimalKill` greedily over
the scene - cheapest kill first, applied for real through `dryRun` and
`planKills`, repeat - so par can never disagree with what the game accepts,
and a smarter kill order than the greedy one is simply a run that beats par.
The first cut gave "Stop walking" a par of 1, because with two `dd` and three
`D` the cheapest clear of a lane is `D`; three stars would have meant never
pressing `w`. A mission whose keycaps do not name `dd` or `D` is judged at zero
charges. The player still has the full magazine in TRY. The search lessons
carry an explicit `par`: the oracle does not model `/`, `n` or `*`, and its
answer to "Search" would have been `3jfgdw`. Stars are 3 at or under par, 2
within half again, 1 for finishing; `mission_done` carries all of it and
`recordMission` writes stars up and best keys down, never the reverse.

The list is the two-pane card widened to the store's panel (cols 2..58): a
`>`, a three-glyph star column and a 22-cell title need 28 cells, and the
19-column demo pane with its lane numbers needs 22 more, which the 52-cell menu
panel cannot hold. Lines are section headings plus one row per mission,
sixteen at a time, scrolled minimally like a Vim window with `^ n more` /
`v n more` when clipped; `{` and `}` jump between sections. A lesson past the
highest starred lesson plus one draws in `INK_DIM`, and Enter still starts it:
dim is ink, not a lock. Stars are the pull. `n` on the last mission's DONE
returns to the main menu, never into survival - rolling into a run without
asking was the pacing complaint. The wave card gained one dim line when the
night's lesson has no stars. Salvage for stars is not paid: `medals-and-wallet`
defines no rate for them, so the sim emits and the save records, and that is
all.

**94. `x` shoots the legs out: the first one halves a zombie's speed for good.**
Reported as: "Zombie legs should be shot off with X too to slow them down."

Erosion (#R15, #92) made `x` a seven-keystroke kill on a seven-letter word,
which is never the right answer, so the only time a player pressed it on a
walker was by accident. Now the first `x` or `X` that erodes a word sets
`Zombie.hobbled` (additive, optional, never cleared) and multiplies `speed` by
`HOBBLE_FACTOR` (0.5). Once: a second `x` takes another letter and nothing
else, and a crawler has no legs to lose. Only a single-cell operator does it -
`dw` from the middle still erodes the tail and leaves the legs alone - because
the whole point is that one cheap keystroke buys time, not that partial cuts
are rewarded. A runner hobbled and then shot down to one letter is not halved
twice; #92's "a runner that loses its legs crawls at half speed" reads
`!hobbled` now and the existing test still passes (4 -> 2). The figure loses
its far shin below the knee and drags the stump, and its stride shortens;
`text()` prints `[hobbled]` after the word in the ZOMBIES table so an agent
can see it. The oracle never partially hits, so par is untouched. `LOG_VERSION`
is 5: a version-4 log with an `x` in it walks its horde at a different pace.

**95. Lanes are ruled, the cursor's lane goes hot when it holds a target, and
the gutter says which lanes are occupied.**
Reported as: "It's hard to see what zombies are next to each other when they
are in adjacent lanes. If I hit d2j, it may or may not hit," and "if my cursor
is on the same row as a zombie, we should make a 'getting warmer' type colour."

The cause is the figure layout (`src/render/NOTES.md`, per-lane vertical
layout): a figure hangs three lanes below its word, so a body that *looks*
level with the cursor belongs to a word two lanes up. Three fixes, all in the
renderer, none in the sim:

- **Bands.** Every other lane gets a dark band (`RGBA.laneBand`, alpha 0.16)
  across the 52 walkable columns, with a pale hairline on the top edge of
  every lane, drawn under the barricade and the figures. This revokes the
  "no lane stripes" call in the scene bake: the words are what you cut, and
  two words on the same band are the same lane. It is a ruled page now.
- **The hot lane.** The cursor's lane tint was amber at alpha 0.055. When any
  zombie stands in that lane it is a warmer orange at 0.16 with a bright edge
  top and bottom (`laneCursorHot`, `laneCursorEdge`), so `d$`, `D`, `dw` and
  `f` have a visible target before they are typed. `indexZombies` keeps a
  16-bit `laneMask` for this; nothing is allocated.
- **The gutter.** A lane with a zombie in it prints its number in bone, an
  empty lane in dim. With relative numbers that is the answer to `d2j`: if
  the `2` below the cursor is bright, the cut lands.

**96. A survival run can be put down and picked back up.**
Reported as: "You should be able to pause a run at any time and resume it.
Right now if it starts, you can't save and stop."

Pause existed (Esc, #D5) but only held the tab open. Now the pause card has a
`w` row - `save & quit` - in survival, and the main menu's `survival` row
becomes `resume  - night 7  score 1240` while a run is on hold. Rules:

- **What is saved.** `Sim.snapshot()`: a deep copy of `GameState` (which is
  `json()`, the complete replayable snapshot, #6) plus `progress` - each
  zombie's fraction of a column walked, the one thing the state never carried
  because it was private to `moveZombies`. `Sim.restore()` writes it back
  *into* the existing state object, because the renderer, the ledger and
  `Game.json()` all hold that object, then seeds the RNG from `sim.rngState`.
  A test proves a restored run steps and prints identically to the run it was
  cut from, twelve commands on.
- **Where it lives.** `Save.suspended: SuspendedRun | null`, one slot, coerced
  by `coerceSuspended` (must be `phase` playing or shop, `sim.mode` survival,
  a night of at least 1; anything deeper is the sim's to reject, and
  `resumeRun` drops a snapshot the sim throws on with an E484 line rather
  than a crash). `merge` keeps the local slot and takes the import's only when
  local has none. Export carries it, so a run can move between browsers,
  which was half the complaint.
- **No replaying a night.** The slot is cleared the moment the run is back on
  the field. Suspend, die, and there is nothing to go back to. Starting a
  fresh run does *not* clear it: `i` is one keystroke from the header and a
  night should not be lost to it. A second suspend replaces the first.
- **Survival only.** A mission is a minute long, `r` restarts it, and its
  keystrokes are judged against par. The card does not draw the row for one,
  and `main.ts` refuses the action if it arrives anyway.
- **The store too.** Between nights is where a player wants to stop, so in the
  browser `<Esc>` on the store's list opens the pause card (placement still
  cancels, a plant mission still clears its anchor). Headless the store's
  `<Esc>` in list mode still does nothing, as `AGENT.md` has always said. A
  run suspended at the store resumes at the store.
- **Eight rows, still.** A ninth main-menu row would land on the footer's
  cell (#59's even-row layout). Replacing `survival` in place keeps the card,
  the click map and the `MAIN_ROWS` test as they were; the footer reads
  `Enter  pick it up    i  new run` while the slot is full. `Menu.suspended`
  is a setter so `rows` is not rebuilt per frame.

The pause panel grew from 15 to 18 rows to fit the row and its blurb;
`tests/ui-layout.test.ts` draws both variants.

## Drills and the coach

**97. Drills are sixty seconds of oracle-verified scenes; the coach reads the
ledger and names one.** `src/sim/drills.ts` holds ten families in curriculum
order - counts, placement, line ends, find, vertical, paragraph, search,
brackets, quotes, word objects - each with the ledger tokens it owns, a scene
template, at least three hand-written fixtures, and the mission that teaches
it. A drill is `mode = 'drill'`: a 60 000 ms clock in `SimState.drillLeft`, a
frozen horde, an invulnerable wall, one scene at a time, replaced the moment
its designated target dies or the player presses `r`. Scenes are drawn from
the sim RNG and accepted only when the oracle agrees they teach the family;
twenty-four rejections in a row fall back to a fixture picked by the same RNG,
so `json()` stays a complete snapshot and `scripts/replay.ts` covers a drill
unchanged (`LOG_VERSION` 6). Score is kills, PERFECTs and scenes; `drill_done`
carries it, `recordDrill` keeps the best (more kills, then more PERFECTs) and
a new best pays ten salvage, once, through the wallet.

**Verification is against the oracle's tie set, not its single answer.**
`optimalKill` breaks ties lexicographically, and a digit sorts before a
letter: `2wcw` and `fgcw` are four keys each and `2wcw` wins every time, so a
find drill that asked the single answer to name `f` would have rejected every
scene a find genuinely solves as cheaply as anything. `optimalKills` returns
everything tied for cheapest; a scene verifies when one of them exercises the
family. PERFECT stays `spent <= cost`, so the player who types the find gets
it. Two families needed more than tokens: `vertical` requires a counted `j`/`k`
or an absolute jump (a bare `j` is not the lesson) and `counts` requires the
killing command itself to carry the count (`d3e`, not `2wcw`).

**The oracle grew, additively.** Search candidates `*`, `#`, `/text<CR>` and
`n` chained on each; `}j` and `{k`, because `}` alone lands on a blank lane
and could never be part of a kill; counted operators `d2w d3w d2e d3e` and
`2x 3x`, and `dj d2j d3j dk d2k d3k` issued from where the cursor stands. A
search or a counted answer is ranked half a keystroke dearer than a plain one
of the same length, so `*cw` never displaces `wcw`, `2x` never displaces
`lx`, and they win only where they are genuinely shorter - as `*` is for a
far sibling, and `d3e` for three adjacent words. `tokensUsed` now names `*`,
`#` and `n` as themselves, and a count as `{n}`, spelled like the
curriculum's keycap; without that last one the ledger could not see the
counts lesson at all, and neither could the coach.

**A drill has no magazine.** The design asked for `dd` and `D` at one each per
scene so a charge answer stayed possible but never optimal. It is always
optimal: the ranking refunds two keystrokes of a charge's penalty per extra
victim, so on any lane of two words `dd` costs what `cw` costs and `D` costs
less, and no horizontal motion could ever have verified a scene. Every scene
starts at zero charges, the refusal says so, and the lesson is the game's own
rule stated flat: cut the word, not the gap.

**The placement family is scored on the span.** It runs the store's real
placement path exactly as boot-camp mission 8 does - `phase` is `shop`,
`shop.mode` is `place`, the wallet is `MISSION_SUPPLIES` - and the drill clock
keeps running from that phase. An order is a hit only on the exact span, the
next order is dealt either way, and PERFECT is `keystrokes <=
cheapestPlacement(order, cursor).cost`, computed over the survey grid with the
oracle's own motion set (`moveKeys`, which allows one hop between motions
because column 38 of the ruler is neither a mark nor within thirty `l` of a
far cursor). The coach ranks placement from the counted motions, as it does
`counts`, and lists it second when both are due.

**The coach.** `need(t) = missed(t) / (1 + used(t))`, ignored under three
lifetime misses, summed per family, top three, ties by curriculum order. It
is shown as `overdue` on the drills screen, as three keycapped entries with
the token that drove each on the record screen (`1` `2` `3` start that drill;
the per-motion table scrolls with `j` `k`), and as one line on the death
screen. The ledger records `used` and `kills` during a drill but not
`missed` - every scene has a known answer - and pays no medal salvage there:
the personal best is a drill's only economy touch.

## Subsystem notes

Renderer-specific and audio-specific calls — glyph atlas, particle pooling,
flicker thresholds, kill-sound weighting, voice caps, the brown-noise
approximation — are written up in `src/render/NOTES.md` and
`src/audio/NOTES.md` respectively.
