## 1. Shared kill judgement

- [x] 1.1 Extend `src/sim/judgement.ts` (created by medals-and-wallet) so it exposes anchor snapshot, keystroke accounting and `judgeKill` returning spent, optimal, wasted, optimalTokens, perfect
- [x] 1.2 Rewire `src/ui/ledger.ts` to call `judgement.ts`; keep every existing ledger test passing unchanged
- [x] 1.3 Add tests for PERFECT, one-extra-keystroke and spawned-after-anchor cases

## 2. Oracle search candidates

- [x] 2.1 Add `*`, `#`, `/<text><CR>` and chained `n` candidates to `optimalKill` in `src/sim/optimal.ts`
- [x] 2.2 Add fixtures for the far-sibling scene and assert existing non-search fixtures are unchanged

## 3. Drill families and coach

- [x] 3.1 Create `src/sim/drills.ts` with the family table (tokens, curriculum section, spawn template, fixtures)
- [x] 3.1a Add the `placement` family: order generation (item, span, origin), a far-placed starting crosshair, and `cheapestPlacement(order, cursor)` for its PERFECT rule (design D9)
- [x] 3.2 Create `src/sim/coach.ts` with the need score, threshold, family ranking and tie-break
- [x] 3.3 Add coach tests: never-used outranks skipped, threshold, empty ledger, tie-break

## 4. Scene generation and drill mode

- [x] 4.1 Implement scene generation from family templates using the sim RNG, with oracle verification, 24-attempt cap and fixture fallback
- [x] 4.1a Route the `placement` family through the real `Sim.shopCommand` placement path (as boot-camp mission 8 does), scoring an order as hit only on an exact span match and dealing the next order either way
- [x] 4.2 Add additive drill fields to `SimState` and record the reason in `DECISIONS.md`
- [x] 4.3 Implement `drill` mode in `src/sim/sim.ts`: clock, zero speed, no wall damage, per-scene charges, target-death and `r` scene replacement, scoring via `judgement.ts`
- [x] 4.4 Add acceptance-rate test (200 scenes per family, 30 percent floor) and determinism test under a fixed seed
- [x] 4.4a Placement family tests: `cheapestPlacement` against hand-computed orders, an exact-span hit, a wrong-span miss, and that every generated order is reachable inside the grid
- [x] 4.5 Extend `src/harness/format.ts` and `AGENT.md` so `text()` shows the DRILL line and marks the target; add a harness test

## 5. Persistence and payout

- [x] 5.1 Write drill bests to `save.drills[family]` on drill end when the result beats the stored best
- [x] 5.2 Pay salvage once per new best through the wallet API from `medals-and-wallet`
- [x] 5.3 Tests for new-best and not-a-best cases

## 6. Screens

- [x] 6.1 Drills screen in `src/ui/screens.ts`: family list with best, coach tag, mission name; `j` `k` `l` Enter Esc handling
- [x] 6.2 Drill end card with kills, perfect, scenes, previous best, `r` and Esc
- [x] 6.3 Ledger screen: table, trend, medals, high score, coach entries with `1` `2` `3` jump, `j` `k` scroll
- [x] 6.4 Death screen coach line; wire menu entries from `main-menu`
- [x] 6.5 Layout assertions in `tests/ui-layout.test.ts` at maximum values and ASCII assertion over every new string

## 7. Verification

- [x] 7.1 Record a drill run through the CLI and confirm `npm run replay` and `npm run verify:browser` pass on it
- [x] 7.2 Run `npm run verify` and update `README.md` with the drills and ledger screen
