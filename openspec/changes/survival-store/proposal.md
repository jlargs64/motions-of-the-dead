## Why

Survival has a 4-second breather between nights and nothing to spend the points you earn. Players want something to aim for beyond a high score, and the CoD Zombies rhythm of "clear the round, buy supplies, hold the next round" gives the run a second decision loop that rewards efficient Vim without changing what Vim is. Traps make that loop teach multi-line edits, the motions the ledger says players avoid most.

## What Changes

- The between-wave breather in survival mode becomes a **store**: on `wave_clear` the sim enters phase `shop`, time stops, and the player browses with `j`/`k`, buys with `l` or `<CR>`, and starts the next night with `n` or `<CR>` on the NEXT NIGHT row.
- Purchases are **sim inputs**. `Sim.buy(itemId)`, `Sim.shopCommand(cmd)` and `Sim.shopResume()` mutate `GameState` and emit an additive `GameEvent { t: 'buy'; item; cost }`, so `runs/*.jsonl` replays and `verify:browser` stay byte-identical.
- **Charges stop refilling every wave in survival.** `dd`/`D` start at 2/3 and are thereafter bought as ammo; the cap is raised by Bandolier. Missions, drills and the warm-up keep the per-step refill.
- Items, all consumable within the run: `dd` charge, `D` charge, Bandolier, Whetstone, Repeater, Planks, Sandbags, Flare, Barbed wire, Spotter, Manifest, Second Wind, and three **traps**: Tripwire, Wire fence, Minefield.
- **Trap placement is a Vim exercise.** Buying a trap opens a placement mode on a synthetic survey grid where the crosshair moves with the real engine (`j`/`k`/`{n}G`/`gg`/`G`/`H`/`M`/`L` for lanes, `h`/`l`/`w`/`b`/`0`/`$`/`f{char}` for columns). Wire fence and Minefield span an anchor and a second cursor, so `3j` or `5w` is the only way to plant a big one.
- Traps live in `SimState.traps`, fire inside `tick()` as zombies step onto them, count as kills with `via: 'trap:<kind>:<id>'`, pay base score only, and never award medals or supplies.
- The harness exposes the store in `text()` (a STORE block with the item list, prices, owned counts, supplies balance and a TRAPS table) and the CLI accepts the same keys, so an agent can shop.
- The survival store is not gated on mission progress. Persistent power (speed, waste allowance, auto-lock, lanes) is deliberately not sold.

## Capabilities

### New Capabilities
- `survival-store`: the shop phase, its navigation and purchase input, resume to the next night, and its harness text surface.
- `store-items`: the effect, price and stacking rule of every non-trap item, and the survival ammo economy for charges.
- `field-traps`: trap placement mode over the survey grid, single- and multi-lane planting, trap firing order, kill accounting and lock interaction.

### Modified Capabilities
- `field-surface`: the field SHALL render planted traps as ASCII glyphs on their lanes, and the survey grid during placement.
- `hud-chrome`: the top-left status block SHALL show the supplies balance during the shop and the trap count during play.

## Impact

- `src/core/state.ts`: additive `SimState` fields (`shop`, `traps`, `nextTrapId`, `chargeCap`, `purchases`, and one flag or counter per item), all initialised in `createState` so `json()` stays a complete snapshot. Recorded in DECISIONS.md.
- `src/core/types.ts`: additive `GameEvent` variants `buy`, `trap_fire`, `revive`. Recorded in DECISIONS.md.
- `src/sim/sim.ts`: `wave_clear` enters `shop` instead of setting `breather` when `sim.mode === 'survival'`; `startWave` stops refilling charges in survival; trap checks inside `moveZombies`; item hooks in `apply`, `hitBarricade`, `die`.
- New `src/sim/store.ts` (item table, prices, `buy` semantics) and `src/sim/traps.ts` (survey grid, placement, firing). Both import nothing from `ui`, `render` or `audio`.
- `src/sim/rules.ts`: `chargeKindFor` takes the waste allowance as a parameter so Whetstone can raise it for one wave.
- `src/harness/api.ts` and `src/harness/format.ts`: key routing for phase `shop`, STORE and TRAPS blocks. `main.ts` routes shop keys through `game.keys()` instead of its own switch.
- `src/ui/screens.ts`: store card and placement strip, both covered by `tests/ui-layout.test.ts`.
- `src/render`: trap glyphs, survey grid, supplies readout.
- `scripts/agent-smoke.ts`: the bot must buy ammo in the shop or it will run dry; `AGENT.md` documents the STORE block.
- Depends on `main-menu` (phase `shop`, `SimState.mode`) and `medals-and-wallet` (`GameState.supplies`).
