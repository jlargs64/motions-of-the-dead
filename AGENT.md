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
| `t`           | run the warm-up tutorial (7 guided steps, then it rolls into wave 1) |
| `r`           | during the warm-up only: restart the current step |
| `quit`        | exit 0 |

Specials use Vim notation: `<Esc>`, `<CR>`, `<BS>`. A search is `/fester<CR>`.

Every command and its events are appended to `runs/<seed>-<timestamp>.jsonl`.
`npm run replay` feeds that back and proves the run was deterministic.

---

## Reading `text()`

```
WAVE 4 "Delete Words"  SCORE 1240  COMBO x7  BARRICADE 82/100  dd:2 D:3  PENDING: d2
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
- `x` covers one cell — a crawler, or nothing.

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

**2 `dd`** and **3 `D`** per wave, reset on a wave clear. A charge is spent by:

- `dd` — always
- `D` — always
- **any other operator that destroys more than 4 cells of empty ground beyond
  what it kills.** `d$` from column 0 at a word on column 40 wastes 40 columns:
  that is a sweep, and it costs a `D`.

At zero charges the command does nothing and breaks your combo.
**Moving is always free.** Good: `7Gdw`. Bad: `7Gd$`.

## Combo

+1 per kill within 2.5s of the last. Score is
`round(10 × text.length × (1 + combo/10))`. It breaks on an overkill, a command
that hit nothing, a zombie reaching the wall, an unknown key, or 2.5s of quiet.

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
`p`, `u`, `y`, `o`, `i`, `m`) is an unknown key: it emits nothing, flashes the field
red, and breaks your combo.

---

## The warm-up

`t` at the CLI (or on the title screen) runs a seven-step tutorial: take aim,
fire, jump by words, pick your lane with `{n}G`, `x` on a crawler, counts with
`d3w`, and finally a lane where they actually move. Nothing spawns on a clock,
the wall cannot be breached, and score and kills are wiped when it rolls into
wave 1. The `TUTORIAL` line in `text()` replaces `LESSON` while it is running
and states the goal outright, so an agent can follow it step by step. Charges
refill on every step and **`r` restarts the step**, so no step can be lost.

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
without plateauing. Between waves there is a 4-second breather; `BREATHER`
counts it down and nothing spawns during it.

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

---

## Driving the real browser build

Same API on `window.__motd`, in dev builds and in production behind `?agent=1`:

```js
__motd.pause(true);       // stop the RAF loop so you control time
__motd.step(500);         // advance 500ms
__motd.keys('d2w');       // feed keystrokes
__motd.text();            // the same text surface as the CLI
__motd.json();            // the full GameState
```
