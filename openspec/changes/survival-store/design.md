## Context

`Sim.tick()` today handles wave end by setting `sm.breather = BREATHER_MS` and counting it down before `startWave(n + 1)`. Charges refill to 2/3 at every `startWave`. The field is empty when a wave clears, so any placement UI has no words to move over. The harness proves browser and headless builds identical by replaying `runs/*.jsonl` through `Game.keys()` and `Game.step()`, so every player action in the shop has to be a keystroke that reaches the sim through that path. `main-menu` gives us `GameState.phase: 'shop'` and `SimState.mode`; `medals-and-wallet` gives us `GameState.supplies`.

## Goals / Non-Goals

**Goals:**
- A deterministic, replayable store between survival nights, driven entirely by keys.
- An ammo economy for `dd`/`D` in survival that makes efficient play the way to stay armed.
- Traps whose placement is real Vim practice and whose multi-lane forms require counted vertical or horizontal motions.
- Full harness parity: an agent can read the store and shop from the terminal.
- Zero new dependencies, ASCII-only rendered strings, sim layer stays import-clean.

**Non-Goals:**
- Persistent upgrades, cosmetics, or anything bought with lifetime salvage (that is `armory`).
- Medal or supplies rules (that is `medals-and-wallet`); this change only consumes `supplies`.
- Gating inventory on missions or unlocks.
- Store in missions or drills. Those modes keep the breather.

## Decisions

**D1. The store is a phase, and the sim stops.** On `wave_clear` in survival, `phase = 'shop'` and `tick()` returns early as it already does for every non-`playing` phase. Alternative: keep `phase = 'playing'` and pause via a long breather. Rejected because the breather countdown is the one thing a store must not have, and because `text()` and the renderer already branch on `phase`.

**D2. Shop input is a Vim command stream, routed by the harness.** `Game.keys()` checks `phase === 'shop'` and intercepts four keys before the engine sees them: `<CR>`, `<Esc>`, and in list mode `l` (buy) and `n` (next night). Everything else is fed to the shared `VimEngine`; a resulting pure motion `Command` goes to `Sim.shopCommand(cmd)`, which moves either the list cursor (list mode) or the placement crosshair (placement mode). Operators and searches are ignored with the unknown-key flash. `main.ts` stops routing keys itself during the shop and calls `game.keys()`, so browser and CLI share one path. Alternative: a separate shop key map in `main.ts` mirrored in `api.ts`. Rejected as the divergence `verify:browser` exists to catch.

**D3. All shop and trap state is in `SimState`.** Additive fields, every one initialised in `createState()`:
```
shop:      { cursor: number; mode: 'list' | 'place'; item: ItemId | ''; anchor: Cursor | null; place: Cursor }
traps:     Trap[]          // { id; kind: 'tripwire'|'fence'|'minefield'; row0; row1; col0; col1; charges }
nextTrapId: number
chargeCap: { dd: number; D: number }
purchases: Record<ItemId, number>   // owned counts this run, for the card and text()
wasteBonus: number   // Whetstone, cells, next wave only
flare: boolean       // next wave at 70% speed
wireLanes: number    // Barbed wire bitmask by row
spotter: number      // kills of oracle hint remaining
manifest: boolean    // next-wave preview unlocked this shop
secondWind: boolean  // one revive banked
freeRepeat: number   // Repeater uses banked
```
`json()` therefore remains a complete snapshot and the replay determinism check covers the store. Alternative: keep shop UI state in `Screens`. Rejected because the list cursor decides what `l` buys, which decides sim state.

**D4. Survival charges become ammo.** `startWave` refills `charges` only when `mode !== 'survival'`. A run starts with `dd: 2, D: 3` and `chargeCap: { dd: 2, D: 3 }`. Buying a charge increments up to the cap; Bandolier raises both caps by 1, at most 3 times. This is the most consequential rule change in the proposal and is recorded in DECISIONS.md. Difficulty impact: the smoke bot must buy ammo in every shop or it runs dry by wave 6; `scripts/agent-smoke.ts` gains a shop routine (buy `D` while supplies allow, then next night) and the seed-1 wave-6 assertion stays.

**D5. Placement runs the real engine over a survey grid.** The field is empty at wave end, so `w`, `f` and `$` would have nothing to land on. `traps.ts` exports `surveyBuffer(): Buffer` whose 16 rows are the same 52-column ruler text, `0....5....10...15...20...25...30...35...40...45...50.`, so every horizontal motion in the syllabus has a target: `f3` finds the next `3`, `w` hops between marks, `$` is the wall side, `0` the spawn side. `Sim.shopCommand` calls `resolve(cmd, surveyBuffer(), shop.place)` and clamps like `apply` does. Alternative: use the live buffer. Rejected: it is empty. Alternative: bespoke h/j/k/l handling. Rejected: the point is that the same motions work everywhere.

**D6. Multi-lane traps are anchor-then-motion.** In placement mode the first `<CR>` on a Tripwire plants it. For Wire fence and Minefield the first `<CR>` sets `shop.anchor`; the player then moves and the second `<CR>` plants the span between anchor and cursor: fence spans rows `min..max` at the anchor column, minefield spans columns `min..max` on the anchor row. Cost is per lane (fence) or per 5 columns rounded up (minefield) and is quoted live in the strip as the cursor moves; a span the wallet cannot afford refuses on `<CR>` with a `no supplies` flash and keeps the anchor. `<Esc>` in placement cancels back to the list and refunds nothing because nothing was charged until planting. Supplies are debited at plant time, not at `l`.

**D7. Traps fire inside the movement loop.** In `moveZombies`, after `z.col = target`, `fireTraps(z, i)` checks every trap whose rows include `z.row` and whose column range intersects `[z.col, z.col + len)`. A hit decrements the trap's `charges`, removes the trap at 0, and kills the zombie with `via: 'trap:<kind>:<id>'`. Checking per step rather than once per tick means a fast runner cannot skip over a wire, and a zombie that would have hit the wall on this step has already been resolved by `hitBarricade`, so a trap at the wall's foot is honestly useless and the strip says so. The kill uses a separate `trapKill(index, via)` that adds `10 * len` to `score`, increments `kills` and `resolvedThisWave`, emits `kill` with `overkill: false`, emits `trap_fire`, and does not touch `combo`, `lastKillAt` or `longestCombo`. The `kill` event carries the `trap:` prefix so `medals-and-wallet` can exclude it from medals and supplies. Traps never hurt armored zombies more than one chip; a fence under an armored word chips it and spends a charge, which keeps "armor needs a text object" true.

**D8. Trap kills and the target lock.** `applyLock` already drops the lock when its zombie is gone, so a trap killing the locked zombie needs no special handling. Removal happens inside the descending index loop in `moveZombies`, which is the same pattern `hitBarricade` already uses safely.

**D9. Item hooks are single-line checks at existing seams.**
- Whetstone: `chargeKindFor(cmd, spans, plan, allowance)` gains a parameter; `apply` passes `WASTE_ALLOWANCE + sm.wasteBonus`; `startWave` zeroes `wasteBonus` after the wave it was bought for begins, so it lasts exactly one night.
- Repeater: in `apply`, if `cmd.repeat` and `charge` would be spent and `freeRepeat > 0`, decrement `freeRepeat` and skip the charge.
- Planks: `barricade.hp = min(maxHp, hp + 25)`. Sandbags: `maxHp += 10; hp += 10`.
- Flare: `startWave` multiplies every queued speed by 0.7 and clears the flag.
- Barbed wire: in `moveZombies`, when a zombie would call `hitBarricade` and `wireLanes` has its row, clear the bit and set its `accum` to `-z.speed` so it stands still for one second before trying again.
- Spotter: `spotter = 3` on purchase; decremented in `kill`; the renderer and `text()` show `optimalKill` for the zombie nearest the wall while it is positive, recomputed only when the cursor or zombie list changed.
- Manifest: pure functions already exist, so the preview is `waveSize(n+1)`, `baseSpeed(n+1)` and `composition(n+1)`. Unlocked per shop visit.
- Second Wind: `die()` checks the flag, sets `hp = 30`, clears it, emits `revive`, breaks the combo, and does not end the run.

**D10. Prices live in one tunable table.** `src/sim/store.ts` exports `ITEMS: readonly Item[]` with `{ id, name, blurb, price, maxOwned, kind: 'instant' | 'trap' }`. Starting values, all marked tunable and expected to move once `medals-and-wallet` lands:

| id | price | cap |
|---|---|---|
| dd | 60 | chargeCap.dd |
| D | 40 | chargeCap.D |
| bandolier | 150 | 3 |
| whetstone | 50 | 1 |
| repeater | 40 | 3 |
| planks | 80 | none |
| sandbags | 120 | 5 |
| flare | 100 | 1 |
| wire | 30 per lane | 16 |
| tripwire | 50 | none |
| fence | 40 per lane | none |
| minefield | 30 per 5 cols | none |
| spotter | 60 | 1 |
| manifest | 20 | 1 |
| secondwind | 400 | 1 |

Barbed wire is placed like a Tripwire but always at the wall column, so it also uses placement mode with the column fixed.

**D11. The store card is asserted, not eyeballed.** `Screens.drawStore` draws a panel at rows -5..17: header with `NIGHT n CLEARED`, `SUPPLIES`, then one row per item (`> name .... price  owned`), a Manifest line when unlocked, and `NEXT NIGHT` as the last selectable row. 16 rows of items plus chrome fits the 23 usable rows; `tests/ui-layout.test.ts` gains the store card at every cursor position and with the longest price and owned strings, and the placement strip with the longest live-cost string. Placement draws the survey grid where the words would be, at the dim ink, with the anchor marked `+` and the pending span highlighted.

**D12. Harness text.** During `shop`, `text()` replaces the LESSON line with a `STORE` block:
```
STORE  NIGHT 7 CLEARED  SUPPLIES 240  NEXT NIGHT 8
  keys: j/k select, l or <CR> buy, n next night, <Esc> cancel placement
> [dd]        dd charge        60  owned 1/2
  [D]         D charge         40  owned 2/3
  ...
  [next]      NEXT NIGHT
MANIFEST  night 8: 22 bodies, speed 2.1 c/s, walker 62% crawler 18% bloater 20%   (or: locked, buy manifest)
```
In placement mode the field rows print the survey grid and a `PLACING tripwire  cost 50  anchor lane 4 col 30  <CR> plants  <Esc> cancels` line. In every phase a `TRAPS` table lists `id kind lanes cols charges`. `AGENT.md` documents both.

## Risks / Trade-offs

- [Charges no longer refill in survival makes the game harder before the store makes it easier] -> the run starts with the same 2/3, the first shop arrives after wave 1, and prices are tuned so one clean wave buys one charge. Smoke bot asserts wave 6 on seed 1 still holds.
- [Trap kills could farm score] -> base score only, no combo, no medals, no supplies. Traps are a wall you paid for, not a gun.
- [Placement mode is a second key context that could drift from the play context] -> it uses the same `VimEngine` and `resolve`; the only extra keys are `<CR>` and `<Esc>`, both already tokens.
- [`SimState` grows by a dozen fields and every fixture that builds state by hand breaks] -> all new fields have defaults in `createState()`; tests use `createState` and mutate.
- [Spotter recomputes `optimalKill` per frame] -> cached on `(cursor, zombie count, nearest id)`; recompute at most once per tick.
- [Survey grid digits could be read as zombies by an agent] -> the `PLACING` line names the mode, the ZOMBIES table stays `(none on the field)`, and the grid only appears in placement mode.
- [Renderer needs the field to draw the survey grid and traps] -> both derive from `GameState` only; no new sim-to-render coupling.

## Migration Plan

Additive state and events only. Old `runs/*.jsonl` logs recorded before this change replay under `mode: 'survival'` and will diverge at the first `wave_clear` because the breather no longer exists; `scripts/replay.ts` reads `init.version` and skips logs older than this change with a printed reason. New logs are the regression baseline. Rollback is reverting the change; no stored data format is affected because run wallets die with the run.

## Open Questions

- Should prices scale with the night number? Deferred until `medals-and-wallet` lands and real supplies-per-wave numbers exist.
- Should Manifest be free? Kept as a 20-supply item for now; the price is a tuning knob, not a rule.
- Whether a fence under an armored word should chip or be ignored is decided as chip; revisit if it makes armor trivial at high nights.
