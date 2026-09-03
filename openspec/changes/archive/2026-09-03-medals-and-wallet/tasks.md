## 1. Contracts

- [x] 1.1 Add `medal` and `kill_judged` variants to `GameEvent` in `src/core/types.ts`; add `supplies` to `GameState` and `judge` (anchor snapshot with `keys` and `searchTarget`) to `SimState` in `src/core/state.ts`, defaulted in `createState`
- [x] 1.2 Record the additive changes and the sim-side judging decision in DECISIONS.md

## 2. Sim judging

- [x] 2.0 Create `src/sim/judgement.ts` with `beginAnchor` and `judgeKill` (anchor snapshot, keystroke accounting, `optimalKill` comparison, PERFECT when spent <= optimal), moved from `src/ui/ledger.ts`; existing ledger tests pass unchanged
- [x] 2.1 Create `src/sim/medals.ts` with the medal name ladder, payout constants, `judgeMultiKill(plan)` and `judgeStyle(cmd, plan, zombiesBefore, anchor)` as pure functions; skip kills whose `via` starts with `trap:`
- [x] 2.2 In `Sim.apply()`, set the anchor on the first command after a kill or run start, count keystrokes, and record `searchTarget` when the anchoring command is a search
- [x] 2.3 On the first kill of a sequence, run `optimalKill` from the anchor, emit `kill_judged`, emit `PERFECT` when spent equals optimal length, then clear the anchor
- [x] 2.4 After the victims loop, emit multi-kill and style medals and add per-kill and per-medal payouts to `supplies`; skip style medals when the plan has overkill
- [x] 2.5 Reset `supplies` in `Sim.start()` and at the warm-up to wave 1 rollover

## 3. Ledger and salvage

- [x] 3.1 Rewrite `src/ui/ledger.ts` to derive wasted, missed and never-used tables from `kill_judged` events and drop its own anchor and `optimalKill` calls
- [x] 3.2 Add FIRST BLOOD detection in the ledger from lifetime motion usage, emitting a `medal` event through the bus at most once per command
- [x] 3.3 Credit salvage on every `medal` event via the `player-save` API, or a ledger-key fallback if `player-save` is not landed, and record which in DECISIONS.md

## 4. Presentation

- [x] 4.1 Add a callout stack to `src/render/renderer.ts` fed by `medal` events: max three, newest on top, 1100 ms each, tier-scaled text, drawn in the sky band clear of the combo counter and remaining strip
- [x] 4.2 Add the `SUP` supplies readout to the top-left status block
- [x] 4.3 Add medal stings to `src/audio/audio.ts`: tiered multi-kill sting and a two-note style figure, honoring mute and the voice cap
- [x] 4.4 Add `SUPPLIES` to `text()` in `src/harness/format.ts` and document the new events and field in AGENT.md

## 5. Tests and verification

- [x] 5.1 Add `tests/sim.test.ts` fixtures for every multi-kill tier, each style medal, overkill suppression, PERFECT vs wasteful approach, and supplies payouts read from the constants table
- [x] 5.2 Add an ASCII assertion over all medal names and a test that nothing outside `src/sim` writes `supplies`
- [x] 5.3 Extend `tests/ui-layout.test.ts` with the callout band at max tier and max stack, and `scripts/render-smoke.mts` with medal callouts active
- [x] 5.4 Measure `npm run smoke` wall time before and after moving the oracle into the sim; apply the narrowing mitigation from design.md if it regresses more than 2x
- [x] 5.5 Regenerate baseline `runs/*.jsonl`, then run `npm run verify` and confirm replay and browser-vs-headless checks pass with `supplies` in state
