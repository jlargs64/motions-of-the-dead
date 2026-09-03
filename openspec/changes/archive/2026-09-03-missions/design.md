## Revision (2026-09-03): against what `main-menu` shipped

The two-pane select screen and its demo pane landed under `main-menu`
(DECISIONS #62, #63), so this design is applied with these substitutions:

- **No WATCH beat.** The demo loops on the select screen's right pane
  (`MissionDemo`, its own `Sim`, no clock). A mission has two beats:
  `missionBeat: 'try' | 'done'`. D3's ghost crosshair and in-sim demo ticking
  are dropped; lit keycaps live in the pane.
- **`DemoScript` stays.** Each `Mission` carries the compact `demo`
  (`keys`, `spawn`, `cursor`, `goal?`) authored for the 19-column pane, as
  today's `TutorialStep` does. `Sim.startScene()` stays for the pane.
- **Boot camp is eight missions**, not seven: `Set a trap` (goal `plant`,
  DECISIONS #85) shipped after the proposal. `goal` is `reach | clear | plant`.
- **SimState fields:** `mission`, `missionBeat`, `missionHold`, `missionKeys`,
  `missionEscaped` replace `tutorial`, `tutorialHold`, `tutorialEscaped`.
  `LOG_VERSION` becomes 4.
- **Par:** greedy oracle for `clear`, motion-only for `reach`, the shortest
  planting sequence for `plant`, and an optional explicit `par` override for
  lessons whose motion the oracle does not model (search). Always
  `<= demo length`, asserted.
- **The list is the shipped two-pane card, widened** to the store's panel
  (cols 2..58) so the longest title (22 cells) fits beside a `>` and a
  three-glyph star column. Lines are section headings plus mission rows; 16
  visible, `^`/`v` markers, scroll offset kept in `Screens`. Keycaps, best and
  par are in the right pane, not on the row.
- **`t`** stays gone from `Game.keys()` (DECISIONS #61). The CLI `t [n]`
  command and the `missions` row are the entry points. The first open after a
  run lands on the first unstarred mission through a `Menu.pickMission` hook
  main.ts points at the save.
- **Esc on DONE** returns to the list with the selection on the mission just
  played (`Menu.open('missions', i)`).
- **Salvage for stars** is not paid here: `medals-and-wallet` defines no rate
  for mission stars. The sim emits `mission_done`; the save records it.

## Context

Teaching today lives in two places. The 7-step warm-up (`src/sim/tutorial.ts`, driven by `Sim.startTutorial` / `setupTutorialStep` / `tickTutorial`) is self-paced but tiny and rolls into wave 1 when it ends. The 33-lesson `CURRICULUM` in `src/sim/waves.ts` is the real syllabus but it is only ever shown as a 4-second wave card inside survival. Neither can be replayed or chosen.

The sim is headless and deterministic. `Game.keys()` in `src/harness/api.ts` is the one input path for browser, CLI and smoke bot alike, and `npm run verify` proves the browser and headless builds produce identical `GameState`. The oracle `optimalKill(buffer, cursor, target, charges)` already finds and engine-verifies the cheapest kill for a zombie from a cursor.

Constraints: zero runtime deps, no DOM in `src/ui`, ASCII only on the canvas (R11), cards asserted by `tests/ui-layout.test.ts` (R14), `src/sim` imports nothing from render/audio/ui. This change depends on `main-menu` (which adds `GameState.phase` values `'menu' | 'shop'` and `SimState.mode: 'survival' | 'mission' | 'drill'`, plus the j/k/Enter/Esc menu conventions) and `player-save` (which owns the `motd.save` blob and its `missions` slot).

## Goals / Non-Goals

**Goals:**
- Every lesson in the syllabus is a place you can go, at your own pace, as many times as you like.
- A player sees the motion work before being asked to perform it.
- Par is derived from the engine so it can never be wrong about what the game accepts.
- Demos cannot rot: a demo that no longer clears its scene fails the test suite.
- Survival is untouched as a game; it only gains a pointer.

**Non-Goals:**
- Procedural drills and the coach (separate `drills-and-coach` change).
- The salvage economy itself (owned by `medals-and-wallet`; this change only reports stars).
- Save format and import/export (owned by `player-save`).
- Redesigning the horde curriculum or wave ramp in survival.
- Voice, video or any asset-based tutorial content.

## Decisions

### D1. One mission table, missions are data

`src/sim/tutorial.ts` becomes `src/sim/missions.ts` exporting `MISSIONS: Mission[]` and `SECTIONS` derived from it.

```
interface Mission {
  id: string;            // 'boot-aim', 'basic-words', 'ess-find' ... stable, persisted
  section: string;       // matches CURRICULUM section, or 'Boot camp'
  title: string;         // matches CURRICULUM title where it exists
  keys: string[];        // keycaps shown on the strip
  hint: string;          // one ASCII line
  spawn: TutorialSpawn[];// same tuple as today: [kind,row,col,text,speed]
  goal: 'reach' | 'clear';
  demo: string;          // keystroke string, Vim notation for specials
  start: Cursor;         // where the crosshair begins for TRY and WATCH
  lesson?: number;       // 1-based CURRICULUM index, for the wave-card pointer
}
```

The 7 existing TUTORIAL steps are copied in verbatim under section `Boot camp`. Each of the 33 CURRICULUM lessons gets one mission whose `section`/`title`/`keys` are read from `waveDef(n)` so the two tables cannot drift on wording; only `spawn`, `demo`, `start` and `hint` are authored here.

*Why not generate missions from CURRICULUM at runtime?* Scenes and demos need a human author. Reading `section`/`title`/`keys` from `waveDef` gets the shared text for free without inventing a second source of truth.

*Alternative rejected:* keep TUTORIAL as a separate list alongside missions. Two teaching systems is what this change removes.

### D2. SimState fields, additive, replacing `tutorial` / `tutorialHold`

```
mission: number;          // index into MISSIONS, -1 when not in one
missionBeat: 0 | 1 | 2;   // WATCH, TRY, DONE
missionHold: number;      // ms; the GOOD flash before DONE
missionKeys: number;      // keystrokes fed during TRY, reset on retry
demoPos: number;          // index into the demo's split keys
demoClock: number;        // ms until the next demo key
```

`SimState.mode === 'mission'` whenever `mission >= 0`. `tutorial` and `tutorialHold` are removed. This is an additive-only edit to the frozen `SimState` in the same sense R2 and R12 were, and is written up in DECISIONS as the R12 successor. `json()` stays a complete snapshot, so replays of mission play are deterministic including the demo.

### D3. WATCH runs the real sim through `keys()`

The demo is not an animation. On each `tick`, while `missionBeat === 0`, `demoClock` counts down; when it hits zero the sim emits the next key of `splitKeys(demo)` through the same feed the harness uses (`Sim` exposes `demoStep(): string | null` and the `Game` facade routes it through `this.engine.feed`, so the engine state machine is exercised too). The gap is `DEMO_KEY_MS = 420`. When the demo string is exhausted and the scene is clear, the scene is reset after `DEMO_LOOP_MS = 1400` and the demo restarts. Enter at any point ends WATCH, resets the scene, and enters TRY.

The renderer draws the crosshair with the ghost style during WATCH and the strip lights keycap `k` when `demoPos` has passed the corresponding key. Keycaps to indices: the strip shows `keys`, and lighting is by prefix match of the demo against `keys` joined; where the demo contains more keys than the strip (for example `w` `w` `dw`), the strip lights in order and stays lit.

*Why this over a scripted overlay?* Correct by construction. If the engine's semantics change, the demo changes with it, and the demo test catches a demo that stopped working.

*Alternative rejected:* recorded event logs. They rot silently and cannot be lit against the keycap strip without a parser.

### D4. TRY is the warm-up mechanic, kept

Same rules as R12 and R17: scene from `spawn`, invulnerable wall (barricade damage skipped while `mission >= 0`, as `tutorial >= 0` is today at `sim.ts:341`), charges refilled at every retry, `r` restarts the beat, and the `reach`/`clear` goal check from `tickTutorial` moves unchanged into `tickMission`. Movement is whatever the spawn tuple's speed says, so "Now they move" keeps moving.

`missionKeys` counts every key fed during TRY, including half-typed commands that are cleared with Esc. Esc with nothing pending still pauses per R7.

### D5. Par comes from the oracle, greedy sequential

For a `clear` scene, par is computed once per mission at module load:

```
cursor = mission.start; charges = full; keys = 0
while zombies remain:
  best = argmin over zombies z of optimalKill(buffer, cursor, z, charges)  by cost, then keys.length
  keys += best.keys.length
  apply best via dryRun -> new cursor, remove victims (planKills), spend charge if any
par = keys
```

For a `reach` scene par is the cheapest `optimalKill`-style navigation to any zombie, which the oracle's row and column candidate search already produces when asked for a motion-only plan; `parFor` exposes that with an `operator: false` flag.

This is greedy over kill order, so it is an upper bound on the true optimum for multi-zombie scenes. That is acceptable: a player who beats par gets three stars anyway (D6). Par is memoised per mission id and exposed as `missionPar(id)`. A test asserts every mission's `demo` length is `>= par` and that par is finite.

*Alternative rejected:* exhaustive kill-order search. Scenes have at most 3 to 5 zombies today, so it would be feasible, but the greedy bound is good enough and keeps load time trivial as the table grows.

### D6. Stars by ratio to par

```
keys <= par           -> 3 stars
keys <= par * 1.5     -> 2 stars
otherwise (cleared)   -> 1 star
```

Ratios round up to whole keys. Stars and `bestKeys` are persisted by `player-save` under `missions[id]`. Only improvements are written. Reaching DONE emits a new additive event `{ t: 'mission_done'; id; keys; par; stars }` so `medals-and-wallet` can pay salvage and the ledger can record it without either importing mission internals.

### D7. Mission list is a card, not a sim phase

The list is drawn by `Screens.drawMissions()` under `GameState.phase === 'menu'` from `main-menu`, with a `menuScreen: 'missions'` selection owned there. It follows main-menu conventions: `j`/`k` move, `gg`/`G` jump, `{`/`}` skip a section, Enter or `l` selects, Esc or `h` goes back, `/text<CR>` jumps to the first matching title. Sections are always all visible; a lesson whose CURRICULUM index is beyond the highest starred lesson plus one renders in `INK_DIM`, but is selectable. Per row: keycaps, title, stars as `***`, `**.`, `*..` or `...`, and best keys when set. The list scrolls: 16 visible rows, a `^`/`v` marker when clipped.

### D8. DONE waits

On goal met during TRY, `missionHold = MISSION_HOLD_MS` (900, as today) shows `GOOD`, then `missionBeat = 2`. DONE draws keystrokes vs par, the stars, and the three keys: `n` next mission (a section boundary is not special; the last mission's `n` returns to the main menu), `r` retry the same mission's TRY, Esc back to the list. Nothing advances on a timer.

### D9. Survival pointer

`drawWaveCard` adds one line in `INK_DIM` at row 14 when `waveDef(n)` maps to a mission with zero stars: `mission unstarred - t from the title`. Layout is asserted for the longest title with and without the line.

### D10. Harness

`Game.keys()` routes `t` outside a run to `sim.startMission(0)` (Boot camp, first mission) so a CLI player still gets a warm-up; `r` during a mission retries the beat; Enter during WATCH enters TRY; `n` during DONE advances. `text()` prints `MISSION <id> <beat> keys=<n> par=<p>` in the header when in a mission. `AGENT.md` documents this.

## Risks / Trade-offs

- [Greedy par can be beaten by a smarter order] -> Stars cap at 3 for `<= par`, so a better-than-par run is rewarded, never punished. A test asserts par is never below the demo's length so demos always reach 3 stars.
- [Demo keys drift from the keycap strip] -> Lighting is prefix-based against the demo, not the strip, and a test asserts every `keys` entry appears somewhere in `demo`.
- [Removing `tutorial` fields breaks replay logs in `runs/`] -> Those logs are regenerated by `npm run smoke`; `scripts/replay.ts` never read tutorial fields. Documented in tasks.
- [WATCH timer in sim time couples demo pacing to `step()`] -> That is the point: it makes demos replayable and testable. Wall-clock pacing would not be.
- [Mission table authoring is 40 scenes] -> Boot camp is a copy; the 33 lesson scenes reuse spawn shapes from the sections. Authoring is a task, not a design risk.
- [Stars persist through `player-save`, which may land after this change starts] -> The sim only emits `mission_done`; the write lives in the save module. If `player-save` is not present, stars simply do not persist and the list shows `...`.

## Migration Plan

1. Land `main-menu` and `player-save` first.
2. Rename tutorial to missions, port the 7 steps, port the sim methods behind the new fields, update tests. At this point `t` still works and nothing else is new.
3. Add WATCH and DONE, then the list card, then the 33 lesson scenes with demos and the demo test.
4. Add the survival pointer and the `mission_done` event last.
5. Rollback is a revert; no persisted format is introduced by this change beyond the `missions` slot `player-save` already reserves.

## Open Questions

- Resolved: the last mission's `n` never rolls into survival. It returns to the main menu. "Roll into a run without asking" is exactly the pacing complaint.
- Demo pacing constant: 420 ms per key is a guess at readable. To be tuned by eye during apply.
