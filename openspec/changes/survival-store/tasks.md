## 1. State and contracts

- [x] 1.1 Add additive `SimState` fields (`shop`, `traps`, `nextTrapId`, `chargeCap`, `purchases`, `wasteBonus`, `flare`, `wireLanes`, `spotter`, `manifest`, `secondWind`, `freeRepeat`) with defaults in `createState()`
- [x] 1.2 Add additive `GameEvent` variants `buy`, `trap_fire`, `revive` to `src/core/types.ts`
- [x] 1.3 Record the additive contract changes and the survival ammo rule in `DECISIONS.md`

## 2. Item table and store logic

- [x] 2.1 Create `src/sim/store.ts` with `ITEMS`, `ItemId`, price and cap lookup, and `canBuy(state, id)`
- [x] 2.2 Implement `Sim.buy(id)` for every instant item, debiting `supplies`, updating `purchases`, emitting `buy`
- [x] 2.3 Implement `Sim.openShop()` on survival `wave_clear`, `Sim.shopCommand(cmd)` list navigation, and `Sim.shopResume()`
- [x] 2.4 Stop refilling charges in survival `startWave`; apply Bandolier caps to charge purchases
- [x] 2.5 Wire item hooks: Whetstone allowance parameter in `chargeKindFor`, Repeater in `apply`, Flare in `startWave`, Barbed wire and Second Wind in `hitBarricade`/`die`, Spotter decrement in `kill`
- [x] 2.6 Implement Manifest preview from `waveSize`, `baseSpeed`, `composition`

## 3. Traps

- [x] 3.1 Create `src/sim/traps.ts` with `surveyBuffer()`, `Trap` type, span cost helpers, and `fireTraps`
- [x] 3.2 Implement placement mode in `Sim.shopCommand`: resolve against the survey buffer, anchor, plant, cancel, refuse unaffordable spans
- [x] 3.3 Call `fireTraps` inside `moveZombies` after each column step; implement `trapKill` with base score, no combo, `via: 'trap:<kind>:<id>'`
- [x] 3.4 Clear traps on `start()` and `toTitle()`; persist across `startWave`

## 4. Harness

- [x] 4.1 Route shop keys in `Game.keys()`: intercept `<CR>`, `<Esc>`, list-mode `l` and `n`, feed the rest to the engine
- [x] 4.2 Add the `STORE` block, `PLACING` line, `SPOTTER` line, and `TRAPS` table to `renderText`
- [x] 4.3 Update `AGENT.md` with the store keys, the STORE and TRAPS formats, and the ammo rule
- [x] 4.4 Teach `scripts/agent-smoke.ts` to shop (buy charges while affordable, then `n`) and keep the seed-1 wave-6 assertion
- [x] 4.5 Make `scripts/replay.ts` skip logs recorded before this change with a printed reason; record a new baseline log

## 5. UI and rendering

- [x] 5.1 `Screens.drawStore` card and `drawPlacement` strip in `src/ui/screens.ts`; `main.ts` draws them by phase and routes shop keys through `game.keys()`
- [x] 5.2 Trap glyphs, survey grid, anchor and span highlight in the renderer
- [x] 5.3 `SUPPLIES` and `TRAPS` readout in the HUD status block
- [x] 5.4 Store purchase, trap plant, trap fire and revive sounds in `src/audio/audio.ts`

## 6. Tests and verification

- [x] 6.1 `tests/sim.test.ts`: shop entry on survival wave clear, time frozen, mission breather unchanged, every item effect, ammo no-refill, cap enforcement
- [x] 6.2 `tests/sim.test.ts`: placement motions on the survey grid, tripwire, fence via `2j`, minefield via `2w`, unaffordable span, cancel, trap fire per step, armored chip, lock drop, persistence
- [x] 6.3 `tests/harness.test.ts`: `STORE` block, `TRAPS` table, key routing, replay through a shop
- [x] 6.4 `tests/ui-layout.test.ts`: store card at every cursor row with longest strings, placement strip
- [x] 6.5 ASCII assertion over `ITEMS` names and blurbs
- [x] 6.6 Run `npm run verify` green: tests, build, smoke, render smoke, replay, browser replay
