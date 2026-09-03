# Playing MOTIONS OF THE DEAD from a terminal

You are the last thing between a horde and a barricade. The field is a text
buffer read side-on: **16 lanes**, 52 columns of open ground. Zombies are
**words**. They enter at **column 0 in the west and walk east** toward the
barricade at **column 52**. You stand behind it. Your cursor is the crosshair.

**The only input is Vim normal-mode motions and operators.** You kill by
editing. Every horizontal motion — `w b e f t ; $ 0 ^ _` — runs along the axis
the threat travels. `j` and `k` change lanes.

Everything you need is in this file. You do not need to see the game.

---

## Start

```
npm install
npm run play          # seed 1
npm run play -- 42    # seed 42
```

Each line you type on stdin is one command. **The world only moves when you
tell it to**, so you can think as long as you like:

| you type      | what happens |
|---------------|--------------|
| `d2w`         | keystrokes fed to the Vim engine, then the state is printed |
| `step 500`    | advance the simulation 500ms, then print |
| `state`       | dump the whole `GameState` as JSON |
| `seed 42`     | abandon this run, start a fresh one on seed 42 |
| `auto on`     | let real time pass between commands (for feel; off by default) |
| `t` / `t 12`  | start mission n (1..41, default 1); 1..8 is boot camp — see [Missions](#missions) |
| `j` `3j` `gg` | on the menu, these move the menu cursor — see [The menu](#the-menu) |
| `r`           | during a mission only: restart it (`n` and `<Esc>` on DONE, see [Missions](#missions)) |
| `l` `n` `<CR>`| in the store, these buy / start the night / do both — see [The store](#the-store) |
| `quit`        | exit 0 |

Specials use Vim notation: `<Esc>`, `<CR>`, `<BS>`. A search is `/fester<CR>`.

Every command and its events are appended to `runs/<seed>-<timestamp>.jsonl`.
`npm run replay` feeds that back and proves the run was deterministic.

---

## The menu

Before a run, `phase` is `menu` and `text()` prints the menu instead of the
field — there is no field to describe:

```
PHASE menu  MODE survival  (not in a run)
MENU main
> survival  - the endless night
  missions  - learn one motion at a time
  drills  - one motion, repeated
  armory  (soon)  - what you look like doing it
  record  - your service record
  options  - sound, gore, line numbers
  save  - carry it to another browser
  about  - the idea, and the keys
KEYS  j k (with counts)  gg G H M L  /text<CR>  n N  Enter or l  h or Esc back  i starts survival
```

`keys()` drives it with the keys a player uses, so nothing about the menu needs
a special API:

| you type      | what happens |
|---------------|--------------|
| `j` `k` `3j`  | move the cursor; it clamps at both ends and never wraps |
| `gg` `G` `{n}G` | first row, last row, row *n* |
| `H` `M` `L`   | first, middle, last — as in a Vim window |
| `/rec<CR>`    | jump to the first row whose label contains `rec`, wrapping |
| `n` `N`       | repeat that search forward / backward |
| `<CR>` or `l` | activate the row under the cursor |
| `h` or `<Esc>`| back out of a sub-screen (`<Esc>` on the main menu does nothing) |
| `i`           | start a survival run immediately, from any row |

A row tagged `(soon)` is a placeholder: selecting it prints a note and changes
no phase. `about` (the last row, so `G<CR>` opens it) is the game's
introduction: four pages under a tab strip, one row per page, `j`/`k` to turn
them, `h` back. `text()` prints the page being read under its rows, so an agent
can read the same copy a player does:

```
MENU about
> the idea  - a shooter you edit
  the keys  - everything is Vim
  the lesson  - why it is a game
  the build  - no assets, no network

  The field is a text buffer read side-on: 16
  lanes, 52 columns of open ground. ...
``` **`t` does nothing any more** — on the menu, on the death screen, or
through `keys()`. From the CLI, type `t` as a *command* (see the table above),
not as a keystroke.

### The mission list

`missions` opens a second screen: every mission, under its section heading,
navigated with the same keys plus `{` / `}` to skip a section. `text()` prints
it the same way, one line per mission with a `-- Section --` line before each
group:

```
PHASE menu  MODE survival  (not in a run)
MENU missions
-- Boot camp --
> Take aim  - h j k l
  Fire  - d w
  ...
-- Basic Vim --
  Basic Movement  - h j k l
  Moving by Words  - w e b
  ...
```

Enter on a row starts that mission full-screen on the real field, so
`keys('j<CR>')` then `keys('3j<CR>')` starts mission 4. `json().sim.mission`
is the mission index, `sim.missionBeat` is `try` or `done`, and `sim.mode` is
`mission`. Headless the list opens on the first row; in the browser it opens
on the first mission without stars.

In the browser the right-hand half of that screen plays the mission's motion
on a loop — a scripted keystroke string fed through a real engine into a
throwaway `Sim`. It is presentation only: it has no clock, it never touches
`json()`, and it does not exist headless.

`phase` is one of:

| phase | meaning |
|---|---|
| `menu` | the main menu. Not in a run. `title` is the old name and still means this. |
| `playing` | a live run. `sim.mode` says which rules: `survival`, `mission` or `drill`. |
| `dead` | the death screen. `i` restarts, `<Esc>` or `:q!<CR>` returns to the menu. |

In the browser a survival run can be **suspended** from the pause card (`Esc`,
then `w`) and picked up later: the `survival` row on the main menu reads
`resume  - night 7  score 1240` while one is on hold, and Enter on it restores
the exact `json()` snapshot. Headless there is no save to hold it, so the row
never appears; `Game.restore(state, progress)` is the same entry point, and
`Sim.snapshot()` is what it takes (DECISIONS #96).
| `stats` | reserved. |
| `shop` | the survival store, between nights. Time is stopped. See [The store](#the-store). |

`sim.mode` is set only when a run starts and is part of `json()`, so a replay
carries it.

---

## Reading `text()`

```
WAVE 4 "Delete Words"  SCORE 1240  SUPPLIES 318  COMBO x7  BARRICADE 82/100  dd:2 D:3  PENDING: d2
PHASE playing  TIME 41.2s  SPAWNED 12/14  ALIVE 6  BREATHER 0.0s  LONGEST_COMBO 9
LESSON  Basic Operators / Delete Words — d w : dw deletes from the crosshair to the start of the next word
LEGEND  ...
CHARGES ...
FIELD   ...
        0.........1.........2.........3.........4.........5.
lane  0                                                     #
lane  1     pale                                            #
        ^
lane  2             lurch                    (blight)       =
...
lane 15  decay                                              .
ZOMBIES  lane col kind     cols_to_wall  text
           1   4 walker             44  pale
           2  12 walker             35  lurch
NEAREST lane 2 col 38 armored "(blight)"  cols_to_wall 6
CURSOR lane 1 col 4  (on: "pale" walker col 4..7)
```

- The **ruler** marks every tenth column: `0` at 0, `1` at 10, and so on.
- Every lane is always printed, padded to 52 columns, so columns line up
  vertically and you can read a position straight off the ruler.
- The glyph **after** each lane is that lane's slice of the barricade:
  `#` intact, then `=`, `-`, `.`, and blank for a **breach**. The wall fails
  from the bottom lane upward.
- The line after the cursor's lane is a `^` under the cursor column (offset by
  the 8-character `lane NN ` prefix — the ruler shares that offset).
- The **ZOMBIES** table is ground truth: lane, column, kind, exact text, and
  `cols_to_wall` — how many columns of ground it has left. That is your clock.
- **NEAREST** is whoever has the least ground left. Usually your target.
- A line ending in `[hobbled]` is a zombie whose legs have been shot out: it
  walks at half speed for the rest of its life (see `x`, below).

Columns are 0-based. A zombie at `col 38` with text `(blight)` occupies columns
38 through 45 inclusive.

**The cursor is a crosshair, not a text caret.** The game runs Vim's
`virtualedit=all`: `l` walks into empty ground, `j`/`k` carry your column
unchanged, and you keep your column when the word under you walks on or dies.

---

## The five kinds, and how each one dies

| kind | looks like | kills it | do not |
|---|---|---|---|
| **walker** | `shamble` | any operator whose span **fully covers** it | — |
| **runner** | `spit` | same, but it crosses the field at 2× speed | dawdle |
| **armored** | `(lurch)` `"creep"` `[rot]` `{gnaw}` `'bile'` | **a text object only** — `di(`, `ca"`, `diw`, `daw`, `ci[` … | any other operator: it chips one bracket glyph. Two chips strip it to a plain walker |
| **bloater** | `putrescent` (8+ chars) | `dw`/`daw`/`diw` is fine. `dd` or `D` **bursts** it, killing everything the span touches in that lane — and costs a charge | — |
| **crawler** | `z` (1 char) | `x`, and only `x` | anything else kills it but counts as an **OVERKILL** and breaks your combo |

`diw` and `daw` are text objects, so they cut armor too — often the cheapest
answer when you are already standing on the word.

## Coverage: what "kills" actually means

A command produces a set of affected cells — exactly what Vim would delete. A
zombie dies when **every one of its cells** is inside that set.

- `dw` from a word's **first** character covers exactly that word. Clean kill.
- `dw` from the **middle** covers only the tail. No kill.
- `daw`/`diw` cover the whole word from anywhere inside it.
- `x` covers one cell — a crawler, or one letter of anything else. A partial
  hit erodes: the covered letters are gone and the word closes up.
- **The first `x` (or `X`) into a word shoots its legs out**: the zombie is
  `hobbled` and its speed is halved for good. Once per zombie, and only for the
  single-cell operators — `dw` from the middle erodes but does not slow. It
  scores nothing, but it buys the time to do the real kill properly, or to go
  and deal with someone closer to the wall first.

### Where the cursor ends up

The easiest thing to get wrong, and it will cost you a command.

- After **any operator** the cursor lands on the **first cell of what you cut**.
  It does not stay where you were.
- Pure motions leave you exactly where the motion says, empty ground included.
- **Re-read `text()` between commands** instead of planning a chain of five.
  Chaining is where plans die: your third command starts from a cursor you
  predicted rather than one you read.

`{n}G` sidesteps all of it: it jumps to lane `n-1` **and** to that lane's first
non-blank, which is its westernmost zombie. `7Gdw` is four keystrokes and needs
no knowledge of where you were standing. `$` goes the other way — to the last
character of the lane, which is the zombie **nearest the wall**.

---

## Charges: why you must move before you cut

You start a run with **2 `dd`** and **3 `D`**. In **survival they do not refill**
— they are ammunition, bought in [the store](#the-store) between nights, and
`chargeCap` in `json()` is the ceiling (Bandolier raises it). In missions,
drills and missions they still refill on every wave and every attempt.

A charge is spent by:

- `dd` — always
- `D` — always
- **any other operator that destroys more than 4 cells of empty ground beyond
  what it kills.** `d$` from column 0 at a word on column 40 wastes 40 columns:
  that is a sweep, and it costs a `D`.

At zero charges the command is **refused**: nothing is cut, the field flashes
red, and the reason is printed on screen for a moment. It is also a `warn` in
the log. `combo_break` carries `refused: true` for it, so an agent can watch
for that rather than parsing the message.
**Moving is always free.** Good: `7Gdw`. Bad: `7Gd$`.

A banked **Repeater** pays for one `.` instead of the magazine, and a
**Whetstone** raises the 4-cell waste allowance to 5 for one night.

## Combo

+1 per kill within 2.5s of the last. Score is
`round(10 × text.length × (1 + combo/10))`. It breaks on an overkill, a command
that hit nothing, a zombie reaching the wall, an unknown key, or 2.5s of quiet.

---

## The store

In **survival** a wave clear does not start a breather — it opens the store.
`phase` becomes `shop`, `sim.time` stops, and nothing spawns, moves or decays
until you leave. `step` does nothing while it is open, so you can read the
whole card and think. **Missions and drills keep the 4-second breather.**

```
STORE  NIGHT 7 CLEARED  SUPPLIES 240  NEXT NIGHT 8
  keys: j/k select (counts, gg G H M L), l or <CR> buy, n next night, <Esc> cancel placement
> [dd]         dd charge       60  owned 1/2     one lane, gone. ammunition now, not a refill
  [D]          D charge        40  owned 2/3     crosshair to the wall. the cheap sweep
  ...
  [next]       NEXT NIGHT 8
MANIFEST  locked (buy manifest)
```

Every purchase is a **keystroke**, not an API call, so a recorded run replays a
shopping trip exactly:

| you type | what happens |
|---|---|
| `j` `k` `3j` `gg` `G` `H` `M` `L` | move the selection; it clamps and never wraps |
| `l` or `<CR>` | buy the selected row. A trap opens placement mode instead |
| `n`, or `<CR>` on `[next]` | start the next night. The store does not reopen for it |
| `<Esc>` | cancel a placement. In the list it does nothing headless; in the browser it opens the pause card, where `w` suspends the run |

An operator or a search typed at the store does nothing and sets
`sim.flashUntil`. A purchase you cannot afford, or one at its cap, does the
same and emits no event. The item line ends in `--` when it is refused.
A success emits `{ t: 'buy', item, cost }`.

`owned x/cap` is counted in whatever unit the cap is in: charges for `dd`/`D`,
the banked repeat for Repeater, wired lanes for Barbed wire, this visit's
unlock for Manifest, and purchases-this-run for everything else.

### What is for sale

| id | price | cap | what it does |
|---|---|---|---|
| `dd` | 60 | `chargeCap.dd` | one `dd` charge |
| `D` | 40 | `chargeCap.D` | one `D` charge |
| `bandolier` | 150 | 3 | +1 to **both** caps. It hands you no round |
| `whetstone` | 50 | 1 | waste allowance 4 -> 5, for one night |
| `repeater` | 40 | 3 banked | the next `.` spends no charge |
| `planks` | 80 | — | +25 barricade HP, never above `maxHp` |
| `sandbags` | 120 | 5 | +10 `maxHp` **and** +10 `hp` |
| `flare` | 100 | 1 | the next night spawns at 70% speed |
| `wire` | 30/lane | 16 | barbed wire at the wall: holds the first arrival one second, then it is gone |
| `tripwire` | 50 | — | one cell, one kill |
| `fence` | 40/lane | — | one column across the lanes you span |
| `minefield` | 30 per 5 cols | — | one lane across the columns you span |
| `spotter` | 60 | 1 | `text()` prints the oracle's answer for `NEAREST`, for 3 kills |
| `manifest` | 20 | 1 per visit | reveals the next night's size, speed and mix |
| `secondwind` | 400 | 1 | the wall comes back at 30 HP once, emitting `revive` |

Nothing sold here permanently changes speed, waste allowance, lane count or
aiming. Prices are tunable and will move.

### Placing a trap

`l` on `tripwire`, `fence`, `minefield` or `wire` enters **placement mode** and
charges nothing yet. The field is empty at wave end, so the lanes print a
**survey ruler** instead — the same `0.........1.........2....` the field ruler
uses — and the real motions resolve against it: `f3` lands on column 30, `w`
hops mark to mark, `$` is the wall side, `{n}G` picks a lane.

```
PLACING fence  crosshair lane 6 col 20  anchor lane 3 col 20  cost 160  <CR> plants  <Esc> cancels
```

- **Tripwire** and **wire**: the first `<CR>` plants it. Wire's column is fixed at the wall.
- **Fence**: the first `<CR>` anchors, then a **vertical** motion, then `<CR>`
  plants one column over `min..max` lanes at the *anchor's* column. `3G`,
  `2j`, `<CR>` is a three-lane fence. Cost is 40 a lane; one charge a lane.
- **Minefield**: the same, with a **horizontal** motion, on the anchor's row.
  Cost is 30 per five columns, rounded up, and that is also the charge count.
- A span you cannot afford is refused, and the anchor is kept.

Boot-camp mission 8, **Set a trap**, is this exact mode with the store taken
away and the wallet filled — the cheapest place to practice the anchor.

Traps fire inside the movement loop, after every single-column step, so a
runner cannot skip one. A hit spends a charge; the trap is removed at zero. An
**armored** zombie takes one chip and lives — armor still needs a text object.
A zombie that reaches the barricade on the same step is resolved by the
barricade, so a trap in column 51 is wasted money.

A trap kill pays **base score only**: `10 x text.length`, no combo multiplier,
no combo, no medal, no supplies, and a crawler taken by a mine is not an
overkill. It arrives as `kill` with `via: 'trap:<kind>:<id>'` alongside
`{ t: 'trap_fire', trapId, row, col }`.

Traps persist across nights until their charges are spent. `text()` lists them
in every phase:

```
TRAPS  id kind       lanes  cols     charges
          1 tripwire       5  30            1
          2 fence       3..5  20            3
WIRE  lanes 4 7
```

## Medals and supplies

`SUPPLIES` in `text()` — `state.supplies` in `json()` — is the run wallet. It
is **not** score: score is the record, supplies are what the survival store
spends. It starts at 0 every run and never goes down here.

- **every kill** pays `text.length` supplies.
- **every medal** pays its own `bonus` on top.

A medal arrives as a `{ t: 'medal', name, bonus }` event. Two kinds:

**Multi-kill** — one medal per *command* that kills two or more, named by the
victim count: 2 `DOUBLE KILL`, 3 `TRIPLE KILL`, 4 `OVERKILL`, 5 `KILLTACULAR`,
6 `KILLTROCITY`, 7 `KILLIMANJARO`, 8 `KILLTASTROPHE`, 9 `KILLPOCALYPSE`,
10+ `KILLIONAIRE`. `J` crushes and `dd`/`D` splash count. Two kills from two
separate commands raise the combo and earn nothing — **the ladder is per
command, the combo is per 2.5 seconds.** Bonuses run 10, 25, 50, 80, 120, 160,
200, 240, 300.

**Style** — how the kill was made, and several can fire at once:

| medal | earned by | bonus |
|---|---|---|
| `PERFECT` | spending no more keystrokes than `optimalKill` needed | 15 |
| `SNIPE` | an `f`/`F`/`t`/`T` in the sequence, and a **runner** among the victims | 10 |
| `BREACH` | a text object, and an **armored** among the victims | 15 |
| `CALLED SHOT` | opening the sequence with `/ ? * #` and killing what it landed on | 20 |

A command whose plan contains an **overkill** earns no `SNIPE`, `BREACH` or
`CALLED SHOT`: wrong tool, no style points.

`FIRST BLOOD` exists too, but only in the browser — it fires on the first
*lifetime* use of a token, which the headless harness has no save to read. It
pays 0 supplies.

### `kill_judged`

`{ t: 'kill_judged', zombieId, spent, optimal }` is the sim showing its work,
emitted on the **first kill after each anchor**. The anchor is set on the first
command after the run starts or after a kill; `spent` is the keystrokes since
then and `optimal` is `optimalKill`'s cheapest answer, or `null` when nothing
in the motion set gets there cleanly. `spent <= optimal.length` is what earns
`PERFECT`. Later victims of the same command are not judged — they were good
by definition — and a zombie that spawned after the anchor is not judged at
all.

**For an agent this is a free grader.** Read `optimal` back and you have the
keystring you should have typed. The oracle knows `*`, `#`, `/text<CR>` and
`n`, counted operators (`d3e`, `d2j`, `3x`) and `}j` / `{k`; a search or a
counted answer only ever appears where it is strictly shorter than the plain
one. In the ledger a count is its own token, `{n}`, and `*` `#` `n` are
theirs.

---

## The motion set

All of it works from wave 1. The waves only change what the horde *demands*.

**Along the lane (the axis they travel)**
| keys | means |
|---|---|
| `h` `l` | one column west / east — `l` keeps going across empty ground to column 51 |
| `0` | column 0, the western edge |
| `^` `_` | the first zombie in this lane (`_` is linewise: `d_` == `dd`) |
| `$` | the last character in this lane — the zombie **nearest the wall** |
| `f{char}` | east onto the next `{char}` in this lane (inclusive) |
| `t{char}` | east to just before the next `{char}` (exclusive) |
| `F{char}` `T{char}` | the same, westward |
| `;` `,` | repeat the last `f`/`t` forward / backward |
| `w` `W` | start of the next word / WORD (`W` ignores punctuation, so it clears armor brackets in one step) |
| `b` `B` | start of the previous word / WORD |
| `e` `E` | end of the current/next word / WORD (inclusive) |

**Across the lanes**
| keys | means |
|---|---|
| `j` `k` | one lane down / up, keeping your column exactly. `5j` drops five |
| `gg` | lane 0. `7gg` → lane 6 |
| `G` | lane 15. `7G` → lane 6, on its first zombie |
| `H` `M` `L` | top lane / middle lane / bottom lane, each on its first zombie |
| `{` `}` | up / down to the next **empty** lane |

**Finding things**
| keys | means |
|---|---|
| `/text<CR>` | jump to the next match anywhere on the field, wrapping |
| `?text<CR>` | the same, searching backward |
| `n` `N` | repeat the last search / repeat it the other way |
| `*` `#` | jump to the next / previous zombie with the **same word** as the one under the crosshair. They travel in families — this is how you clear a family |
| `%` | jump to the matching bracket. Lands you inside armor |

**Operators**
| keys | means |
|---|---|
| `d{motion}` | delete over the motion |
| `c{motion}` | same span (`cw` behaves like `ce`, as in real Vim) |
| `x` `X` | delete the character under / before the crosshair |
| `D` | delete east to the wall — **costs a D charge** |
| `dd` | delete the whole lane — **costs a dd charge** |
| `dj` `dk` | this lane and the next one down / up, linewise |
| `J` | haul the lane **below** onto this one. Anything that lands on top of what is already there is **crushed** and counts as a kill. Free — it costs no charge |
| `.` | repeat the last change, count and all. `3.` repeats it with a new count |

**Text objects** (after `d` or `c`): `iw` `aw` `i(` `a(` `i[` `a[` `i{` `a{`
`i"` `a"` `i'` `a'`. Closing brackets work too: `di)` == `di(`.

**Counts** multiply: `3w` = 3, `d3w` = 3, `3dw` = 3, `2d3w` = **6**.

`<Esc>` clears a half-typed command. Anything unrecognised (arrow keys, `v`,
`p`, `u`, `y`, `o`, `i`, `m`) is an unknown key: it emits nothing, shows nothing,
and breaks your combo. Fat fingers are not worth a red field.
In the browser a named key arrives as one `<Name>` token (`<ArrowDown>`, `<Tab>`),
never as its letters, and a bare modifier is not a keystroke (DECISIONS #90).

---

## Missions

`t [n]` at the CLI (or the `missions` row on the menu) starts mission *n* of
41. Missions 1..8 are **boot camp**, the old warm-up: take aim, fire, jump by
words, change lanes with `{n}j`/`{n}k`, `x` on a crawler, counts with `d3w`,
`0` and `$` on a lane where they actually move, and **Set a trap** — the
store's placement mode with no store in front of it. Missions 9..41 are the
33 lessons of [the wave curriculum](#the-wave-curriculum), one scene each, in
syllabus order. Nothing locks: any mission can be started at any time.

A mission is a scripted scene with no spawn clock and an invulnerable wall.
Charges refill on every attempt and **`r` restarts it**, so no mission can be
lost. A zombie that walks past you restarts the scene once the field is empty
(DECISIONS #89): idling does not pass anything. Two beats:

- **TRY.** The scene. The goal is `reach` (put the crosshair on a zombie),
  `clear` (kill them all) or `plant` (set a trap over enough lanes). Every
  key you feed counts, half-typed commands and the `<Esc>` that clears them
  included.
- **DONE.** The goal was met. Nothing moves and nothing advances on a timer.
  `n` starts the next mission (after the last one, the main menu — never
  survival), `r` retries this one, `<Esc>` returns to the list with this
  mission under the cursor. Every other key does nothing.

`text()` replaces the `LESSON` line with two `MISSION` lines while one runs:

```
MISSION boot-fire TRY keys=2 par=3  2/41 "Fire" (Boot camp)
  d w : dw deletes the word you are standing on.  (goal: kill them all; r restarts)
```

and on DONE:

```
MISSION boot-fire DONE keys=3 par=3  2/41 "Fire" (Boot camp)
  stars 3/3  keys: n next mission, r try again, <Esc> back to the list
```

**Par is the oracle's answer** for the scene, computed once at load
(`parFor` in `src/sim/optimal.ts`): the greedy sum of `optimalKill` over the
scene, cheapest kill first, applied for real. It is judged with an *empty
magazine* unless the lesson's keycaps name `dd` or `D`, so a lesson about `w`
is not won by `D`; you still have the full magazine in TRY, and spending it is
a legitimate way to beat par. The search lessons carry a hand-set par because
the oracle does not model `/`, `n` or `*`. Stars: **3** at or under par,
**2** within half again (rounded up), **1** for finishing. The `mission_done`
event carries `id`, `keys`, `par` and `stars`; the browser writes stars up and
best keys down into the save under `missions[id]`, never the reverse.

(`{n}G` is still a fine motion for *you* — you read absolute lane numbers
straight off `text()`. It is a poor lesson for a human, whose gutter is
relative and whose zombies land in random lanes, which is why boot camp
teaches the counted lane change instead.)

**Set a trap is a placement mission**, and it is the one you cannot finish by
killing things. It opens with `phase` already `shop` and `sim.shop.mode`
already `place`, armed with a wire fence and a full wallet, so the keys are
the store's: `<CR>` anchors, a counted vertical motion reaches, `<CR>` plants.
A fence narrower than three lanes leaves the stub on the field and hands
placement straight back — it is a retry, not a failure. `<Esc>` clears a
half-set anchor rather than opening a store that is not there, and `r`
restarts the mission and removes what you planted. The whole mission, at par:

```
t 8          # or the `missions` row, eighth entry
<CR>         # anchor
2j           # two lanes down
<CR>         # plants a three-lane fence: 4 keys, par 4, three stars
n            # on to Basic Movement
```

## Drills

The `drills` row on the menu (or `jj<CR>` from the top) lists ten families,
and `drill <id>` at the CLI starts one directly, the way `t [n]` starts a
mission (`drill find`, `drill placement`, ...). The list:
one row each in curriculum order: `counts`, `placement`, `line ends`, `find`,
`vertical`, `paragraph`, `search`, `brackets`, `quotes`, `word objects`.
Enter on a row starts a **sixty-second sprint**: one scene at a time, a
frozen horde, a wall that takes no damage, and **no charges at all** - `dd`
and `D` are refused, and so is any `dw` that would sweep more than four cells
of empty ground (the game's ordinary waste rule; cut the word with `cw`, `de`
or `diw`). Every scene has a **designated target**; killing it clears the
scene and the next is dealt in the same tick. Killing anything else is a kill
and nothing more. `r` with no half-typed command throws the scene away for
the next one, uncredited.

Every scene is generated from the family's template and **verified by the
oracle**: it is kept only when one of the cheapest kills of its target, from
its starting cursor, uses the family's motion. So a find scene is one where
`f` is as cheap as anything, and typing the find earns `PERFECT`
(`spent <= optimal.length`, the same rule as everywhere). `text()` replaces
the `LESSON` line with two `DRILL` lines and marks the target in the table:

```
DRILL find  41s left  kills 6  perfect 4  scenes 5  target #12 "rot" lane 13 col 30  (r: new scene)
  f t ; : name the letter, land on the word
...
ZOMBIES  lane col kind     cols_to_wall  text
          13  30 walker             19  rot  <-- target
```

`placement` is the one family that is not a kill. It opens in the store's
placement mode (`phase` is `shop`, `sim.shop.mode` is `place`, a full wallet)
with an **order** on the `DRILL` line - `ORDER fence  lanes 3..5  col 30` -
and the clock still running. `<CR>` anchors, a counted motion spans, `<CR>`
plants; the order is a hit only on the exact span, and the next order is
dealt either way. `PERFECT` here is beating the fewest keystrokes that fill
the order from where the crosshair started.

When the clock reaches zero, `phase` is `stats` and the line is
`DRILL OVER  find  kills 22  perfect 14  scenes 20  keys: r run it again, <Esc> back to drills`.
`drill_done` carries `family`, `kills`, `perfect` and `scenes`; the browser
keeps the best (most kills, then most PERFECTs) under `save.drills[family]`
and pays ten salvage for a new one. Headless there is no save.

**The coach** ranks families from the lifetime ledger - `missed / (1 + used)`
per token, three misses minimum, summed per family - and tags its top three
`overdue` on the drills screen, lists them with a keycap on the record screen
(`1` `2` `3` start that drill), and says one line about the first on the
death screen. The headless harness has no save, so its coach is always quiet.

## The wave curriculum

Waves follow vim-hero's syllabus, one lesson per wave, each section closed by a
review. The horde is scheduled so the zombie whose optimal answer *is* this
lesson arrives on this lesson. `LESSON` in the status block names the current
one; `waveDef()` in `src/sim/waves.ts` is the full table.

| waves | section | what shows up |
|---|---|---|
| 1–3 | Basic Vim — movement, words, `x` | walkers, then crawlers |
| 4–8 | Basic Operators — `dw` `cw` `dd` `D` `dj` | bloaters arrive at "Delete Lines" |
| 9–13 | Essential Motions — `W E B`, `0 _ $`, `f t ;` | runners arrive with `f` |
| 14–17 | Advanced Vertical — `{n}j`, `gg G`, `{ }` | all sixteen lanes go live |
| 18–21 | Search — `/ ?`, `n N`, `* #` | density climbs |
| 22–33 | Text Objects — brackets, quotes, words | **armored** finally arrive |
| 34+ | The Long Night | no new lessons, only less time |

Wave *N* spawns `6 + 2N` zombies. Speed starts at 1.1 columns/second (47
seconds to cross the field — you have time to think) and climbs from there
without plateauing. Between waves, **survival opens [the store](#the-store)**
and the clock stops; every other mode gets a 4-second breather, which
`BREATHER` counts down and during which nothing spawns.

---

## Strategy notes for a fresh agent

1. **Target `NEAREST` first.** `cols_to_wall` is your clock. A zombie that
   lands costs `text.length` barricade HP out of 100.
2. **Plan the move and the cut as one command.** `4j`, then `fs`, then `dw` is
   three chances to be wrong; `4jfsdw` is one.
3. **Land on the first character.** From the middle of a word, use `daw`/`diw`.
4. **Armored needs a text object.** Read the wrapper out of the `ZOMBIES` table
   and pick `di(` / `da"` / `di[` to match. Wrong guess = a chipped bracket and
   a wasted turn.
5. **Crawlers: `x`. Never anything else.** An overkill costs the whole combo.
6. **Hoard charges.** They reset per wave, so spend them late on a crowded lane
   rather than early on one walker. `dd` on a lane with a bloater and two
   neighbours is five kills for two keystrokes.
7. **`J` is free crowd control.** Standing on lane 6 and pressing `J` merges
   lane 7 into lane 6; anything that lands on top of what is already there is
   crushed. It costs no charge, so on two crowded lanes at similar columns it
   is the cheapest multi-kill in the game.
8. **`*` clears families.** Several `shamble`s on the field? Kill one, `*` onto
   the next, `.` to repeat the change.
9. **Use `step` deliberately.** Nothing moves while you think. Step in 200–400ms
   slices while the field is busy and in seconds when it is empty. This makes
   you strictly faster than a human — for a fair number, step roughly 55ms per
   keystroke you type, which is what the smoke bot does.
10. **Watch `PENDING:`.** Non-empty means the engine is mid-command and your
    next key completes it. `<Esc>` if you changed your mind.
11. **Buy ammunition every night.** Charges no longer refill in survival, so a
    night you leave the store without topping up `D` is a night you fight with
    whatever is left. `scripts/agent-smoke.ts` does exactly this and nothing
    else, and still reaches wave 6 on seed 1.

---

## When something goes wrong

The game keeps a rolling log of the last few hundred events. It is on always,
at `info` level, and costs nothing:

| level | what lands there |
|---|---|
| `error` | the run ending, with score, kills and what was in the magazine |
| `warn` | a breach with the wall under 35%, and **every command that did nothing** |
| `info` | each night starting and clearing, each purchase, each revive |
| `debug` | every command, kill, trap and medal. Off unless you ask for it |

In the browser, `?debug=1` raises it to `debug` and mirrors it to the console.
Without the flag the ring is still filling, so after a run ends unexpectedly:

```js
__motd.logs()          // the whole ring, one line per entry
__motd.logs(40)        // just the last 40
__motd.logLevel('debug')   // turn the play-by-play on without a reload
```

A line reading `command did nothing: no dd charges - buy one in the store` is
the single most useful thing in there. It means you typed an operator the sim
refused to run, and **in survival that is not rare** — charges do not refill
between nights. The field flashes red and prints the reason when it happens,
but the log is what tells you it happened six times in the ten seconds before
the wall came down.

---

## Driving the real browser build

Same API on `window.__motd`, in dev builds and in production behind `?agent=1`:

```js
__motd.pause(true);       // stop the RAF loop so you control time
__motd.step(500);         // advance 500ms
__motd.keys('d2w');       // feed keystrokes
__motd.text();            // the same text surface as the CLI
__motd.json();            // the full GameState
__motd.menu;              // the live menu model: .screen, .cursor, .rows
__motd.logs(40);          // the last 40 log lines - see above
__motd.logLevel('debug'); // raise the level without reloading
```

`keys()` reaches the menu the same way it does headless, so
`__motd.keys('5G<CR>')` opens the service record in the browser. Its screen id is still `ledger` - that is the stable key `{ t: 'screen', screen: 'ledger' }` and the `MENU ledger` header use, while `record` is what the player reads (DECISIONS #76).
