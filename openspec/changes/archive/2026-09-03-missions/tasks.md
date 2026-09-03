## 1. Mission table

- [x] 1.1 Create `src/sim/missions.ts` with the `Mission` interface, `MISSIONS`, `SECTIONS`, `DEMO_COLS`, `DEMO_KEY_MS`, `DEMO_LOOP_MS`, `MISSION_HOLD_MS`, `MISSION_SUPPLIES`, `starsFor`; port the eight `TUTORIAL` steps as section `Boot camp` with ids and start cursors
- [x] 1.2 Author the 33 lesson missions: read `section`/`title`/`keys` from `waveDef(n)`, write `spawn`, `start`, `hint`, `goal`, `demo` per lesson
- [x] 1.3 Delete `src/sim/tutorial.ts`; update every import (`sim.ts`, `screens.ts`, `menu.ts`, `missiondemo.ts`, `format.ts`, `repl.ts`, `main.ts`, tests, `render-smoke.mts`, `shot.mts`)
- [x] 1.4 Test: exactly `LESSON_COUNT` lesson missions matching `waveDef`, eight Boot camp missions matching the old steps, unique ASCII ids/titles/hints, hints fit the strip and the pane, titles fit the list

## 2. Par from the oracle

- [x] 2.1 Add `parFor(mission)` in `src/sim/optimal.ts`: greedy sequential `optimalKill` for `clear`, motion-only path for `reach`, planting keys for `plant`, explicit override honoured; memoise as `missionPar(id)`
- [x] 2.2 Test: `shamble` at (8,24) from (8,0) has par 3; every mission par is finite and `<= splitKeys(demo.keys).length`

## 3. Sim: beats

- [x] 3.1 Replace `SimState.tutorial`/`tutorialHold`/`tutorialEscaped` with `mission`, `missionBeat`, `missionHold`, `missionKeys`, `missionEscaped`; update `createState`, `resetRun`, `toMenu`; bump `LOG_VERSION` to 4
- [x] 3.2 Replace `startTutorial`/`retryTutorialStep`/`setupTutorialStep`/`tickTutorial` with `startMission(i)`, `retryMission()`, `nextMission()`, `noteMissionKey()`, `tickMission(dt)`; keep the invulnerable wall, the escape rule and the reach/clear/plant goal check
- [x] 3.3 Implement DONE: hold then `missionBeat = 'done'`, stars from `missionKeys` vs par, emit additive `mission_done`; nothing moves in DONE
- [x] 3.4 Harness: `Game.keys()` routes `r` to retry in TRY and DONE, `n` in DONE to `nextMission`, Esc in DONE back to the list; counts TRY keys (field and placement); `MISSION <id> <beat> keys= par=` line in `renderText`; CLI `t [n]` starts `startMission(n-1)`
- [x] 3.5 Tests in `tests/sim.test.ts`: start lands in TRY, wall invulnerable, retry refills and zeroes `missionKeys`, key counting, star thresholds, `n` after the last mission returns to the menu, DONE waits, Esc returns to the list on the same mission, `text()` header line

## 4. Screens

- [x] 4.1 `Screens.drawMissions()`: section headings, star glyphs + title rows, dim rule, 16-line scroll window with `^`/`v` markers, right pane gains par and best
- [x] 4.2 Menu: `MISSION_ROWS` from `MISSIONS` with `section`; `{`/`}` section skip; `pickMission` hook and `open(screen, cursor)`; section lines in `lines()`
- [x] 4.3 Replace `drawTutorial` with `drawMissionStrip` covering TRY (with and without GOOD) and DONE
- [x] 4.4 Wave card pointer line when the lesson's mission has zero stars
- [x] 4.5 `tests/ui-layout.test.ts`: the list at every selection, every strip variant for every mission, wave card with and without the pointer line
- [x] 4.6 `scripts/render-smoke.mts`: walk every mission through TRY and DONE with `n`; `scripts/shot.mts` uses `startMission`

## 5. Wiring and persistence

- [x] 5.1 `main.ts`: menu `missions` opens the list on the first unstarred mission; route beat keys through `game.keys`; strip, gutter and placement teaching read `MISSIONS`
- [x] 5.2 Save integration: `recordMission` in `src/save/save.ts`, improvements only; `main.ts` writes it on `mission_done`; list and wave card read `save.missions`; tests in `tests/save.test.ts`
- [x] 5.3 Regenerate `runs/*.jsonl` via `npm run smoke`; run `npm run verify`

## 6. Docs

- [x] 6.1 `DECISIONS.md`: add the R12 successor entry (missions replace the warm-up, SimState fields, greedy par, no WATCH beat, nothing locks, wider card)
- [x] 6.2 `AGENT.md` and `README.md`: replace warm-up text with missions, document `t [n]`, `r`, `n`, Esc and the `MISSION` header line
