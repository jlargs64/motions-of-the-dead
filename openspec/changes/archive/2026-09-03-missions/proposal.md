> **Partly landed already (2026-09-03).** The `main-menu` change shipped a
> two-pane mission **select screen** over the seven boot-camp missions, which
> supersedes part of this proposal:
>
> - The select screen exists: `Screens.drawMissions`, left pane = list + what
>   it teaches, right pane = keycaps + a looping demo. Built instead of the
>   single-column list in `mission-campaign`.
> - **The demo moved out of the mission and into the select screen.** There is
>   no WATCH beat: the demo loops in the right pane while you browse, on its
>   own throwaway `Sim` (see DECISIONS #62), and Enter starts the mission
>   full-screen. `mission-demo`'s "demo loops until Enter" and "ghost crosshair
>   and lit keycaps" requirements are satisfied there, not inside a beat.
> - Each `TutorialStep` carries a compact `demo: DemoScript`
>   (`src/sim/tutorial.ts`), authored separately from the mission scene
>   (DECISIONS #63). `Sim.startTutorial(step)` and `Sim.startScene()` exist.
> - `tests/ui.test.ts` already drives every demo through the engine and asserts
>   it clears its goal and presses every keycap.
>
> **Still to do here:** the 33 lesson missions, the par oracle, TRY/DONE
> star scoring, `save.missions` persistence, section grouping and the scrolling
> 16-row window (the current list is a fixed 7 rows), and the survival wave-card
> pointer. Rewrite `mission-campaign` and `mission-demo` against what shipped
> before applying this.

## Why

The 33-lesson curriculum only exists inside survival, where a lesson is a 4-second wave card followed by a horde that teaches by killing you. A new motion is shown and gone before it is understood, and no section can be practised on its own. The seven-step warm-up (`t` on the title) is the only self-paced teaching in the game and it covers five motions once, then rolls straight into wave 1.

Players who want to *learn* need a place they can go back to, that waits for them, and that shows the motion working before asking them to do it. That is what vim-hero does and what this game's syllabus already promises.

## What Changes

- **Missions replace the warm-up.** `t` on the title and the `missions` entry on the main menu open a mission list. The 7-step `TUTORIAL` becomes the first section, "Boot camp". Each of the 33 `CURRICULUM` lessons in `src/sim/waves.ts` becomes one mission, grouped under its existing section heading (Basic Vim, Basic Operators, Essential Motions, Advanced Vertical Movement, Search, Text Objects).
- **Nothing locks.** Every section and lesson is visible and selectable from the start. Unreached lessons render dimmed. Stars are the pull.
- **Three beats per mission: WATCH, TRY, DONE.**
  - WATCH: the real sim runs a scripted keystroke string on a timer through the same `keys()` path the harness uses. A ghost crosshair moves, the keycaps on the top strip light in order, the kill lands, and it loops until Enter.
  - TRY: the current warm-up mechanic. Scripted spawns in the `TutorialSpawn` format, zombies frozen or slow, invulnerable wall, `r` restarts the beat, charges refill, oracle par shown.
  - DONE: keystrokes versus par, 1 to 3 stars, and it waits. `n` next mission, `r` retry, Esc back to the list.
- **Par is computed, not tuned.** The oracle in `src/sim/optimal.ts` (`optimalKill`) computes par over each mission's scripted scene at load time.
- **Demos are tested.** A test drives every mission's demo string through the headless sim and asserts it clears the TRY goal. A demo that stops working fails `npm test`.
- **Survival points at missions.** The wave card for a lesson whose mission has no stars gains one line: `mission unstarred - t from the title`.
- **Persistence.** Stars and best keystroke count per mission live in the `player-save` blob under `missions`. Stars pay salvage per `medals-and-wallet`.
- **SimState bookkeeping.** `tutorial` / `tutorialHold` are replaced by additive mission fields (mission index, beat, hold, demo cursor). `SimState.mode` is `'mission'` while in a mission. Recorded in `DECISIONS.md` as the successor to R12.
- **BREAKING (internal):** `Sim.startTutorial` / `retryTutorialStep` and `SimState.tutorial` / `tutorialHold` are removed in favour of the mission API. The harness `t` key opens the Boot camp first mission directly so agent play is unchanged in spirit.

## Capabilities

### New Capabilities
- `mission-campaign`: the mission list, section grouping, selection, no-lock rule, star persistence, and the survival wave-card pointer.
- `mission-beats`: the WATCH / TRY / DONE flow inside one mission: demo playback, the TRY rules, par computation, star thresholds, and the keys that move between beats.
- `mission-demo`: the scripted demo format, how it is driven through the sim, the ghost crosshair and lit keycaps, and the test that every demo clears its goal.

### Modified Capabilities
- `hud-chrome`: no requirement changes. The mission strip is a new card, specified under `mission-beats`.

## Impact

- `src/sim/tutorial.ts` becomes `src/sim/missions.ts` (mission table: id, section, title, keys, hint, spawn, demo, goal, slowdown).
- `src/sim/sim.ts`: mission start / retry / advance / beat ticking replaces the tutorial methods; `SimState` fields change (additive, recorded in DECISIONS).
- `src/sim/optimal.ts`: a `parFor(scene)` helper built on `optimalKill` and `dryRun`.
- `src/ui/screens.ts`: mission list card, mission strip (WATCH / TRY / DONE variants), wave-card pointer line. All ASCII, all asserted in `tests/ui-layout.test.ts`.
- `src/harness/api.ts`: `t` opens missions; `r` in a mission retries the beat; a `demoTick` path for WATCH.
- `src/main.ts`: routing for the mission list and the beat keys; the WATCH timer.
- `tests/sim.test.ts`, `tests/ui-layout.test.ts`, `scripts/render-smoke.mts`: tutorial references updated to missions; new demo-clears-goal test; new layout assertions.
- `AGENT.md`, `README.md`, `DECISIONS.md`: warm-up text replaced.
- Depends on `main-menu` (phases, `mode`, menu entry, j/k/Enter conventions) and `player-save` (the `missions` slot in the save blob).
