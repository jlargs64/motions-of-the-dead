## Why

The game already knows, after every kill, whether you played it optimally (`optimalKill` in the Motion Ledger) and how many zombies one command took down, but it only speaks at the death screen. Turning those two facts into Halo-style medals and a spendable run wallet makes "play better Vim" and "earn things" the same loop, and it is the currency the upcoming survival store and armory spend.

## What Changes

- Add a **medal** system judged inside the sim: multi-kill medals for kills landed by one command (DOUBLE through KILLIONAIRE) and style medals for how the kill was made (PERFECT, SNIPE, BREACH, CALLED SHOT).
- Add a **run wallet** `supplies` to `GameState`: earned per kill and per medal, reset at run start, never affects `score`. Score formula is unchanged and is never spent.
- Move the kill-judging anchor logic (snapshot at first command after a kill, keystrokes spent, oracle comparison) out of `src/ui/ledger.ts` and into the sim so wallet payouts are deterministic and replayable. The ledger becomes a listener on new events instead of re-running the oracle.
- Add a **lifetime salvage** currency, earned from medals (and later mission stars), accrued through the `player-save` blob. FIRST BLOOD, the first lifetime use of a motion, is judged in the browser layer from the save and pays salvage only, so the sim never depends on external state.
- Render **callouts** in the HUD: large, brief, stacked medal text with an escalating synth sting. Show `supplies` in the HUD and in the harness `text()`.
- Additive contract changes, recorded in DECISIONS.md: `GameEvent` gains `{ t: 'medal' }` and `{ t: 'kill_judged' }`; `GameState` gains `supplies`; `SimState` gains the judging anchor.

## Capabilities

### New Capabilities
- `medals`: what earns a medal, when it is judged, and what it pays.
- `run-wallet`: the `supplies` number, how it accrues, how it resets, and how it is exposed to the harness.
- `salvage-earning`: how medals and FIRST BLOOD credit lifetime salvage, in coordination with `player-save`.

### Modified Capabilities
- `hud-chrome`: adds the medal callout stack and the supplies readout to the HUD.

## Impact

- `src/core/types.ts`, `src/core/state.ts`: additive fields only, per the frozen-contract rule.
- `src/sim/sim.ts`: kill path emits medals and pays supplies; new `src/sim/judgement.ts` holds the anchor/oracle comparison moved from `src/ui/ledger.ts` (shared later with `drills-and-coach`); new `src/sim/medals.ts` holds the medal ladder and payouts.
- `src/ui/ledger.ts`: consumes `kill_judged` and `medal` events; owns FIRST BLOOD and salvage credit.
- `src/render/renderer.ts`, `src/audio/audio.ts`: callout stack, supplies readout, medal stings.
- `src/harness/format.ts`: `SUPPLIES` line and medal events in `text()`.
- Tests: medal fixtures in `tests/sim.test.ts`, layout assertions in `tests/ui-layout.test.ts`, render smoke; `npm run verify` chain must stay green, including byte-identical browser vs headless state now that `supplies` is in `GameState`.
- Depends on `player-save` for persisting salvage. Feeds `survival-store` (spends supplies) and `armory` (spends salvage).
