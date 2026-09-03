## 1. Shared kill judgement

- [x] 1.1 Extend `src/sim/judgement.ts` (created by medals-and-wallet) so it exposes anchor snapshot, keystroke accounting and `judgeKill` returning spent, optimal, wasted, optimalTokens, perfect
- [x] 1.2 Rewire `src/ui/ledger.ts` to call `judgement.ts`; keep every existing ledger test passing unchanged
- [x] 1.3 Add tests for PERFECT, one-extra-keystroke and spawned-after-anchor cases

## 2. Oracle search candidates

- [x] 2.1 Add `*`, `#`, `/<text><CR>` and chained `n` candidates to `optimalKill` in `src/sim/optimal.ts`
- [x] 2.2 Add fixtures for the far-sibling scene and assert existing non-search fixtures are unchanged

## 3. Drill families and coach

- [ ] 3.1 Create `src/sim/drills.ts` with the family table (tokens, curriculum section, spawn template, fixtures)
- [ ] 3.1a Add the `placement` family: order generation (item, span, origin), a far-placed starting crosshair, and `cheapestPlacement(order, cursor)` for its PERFECT rule (design D9)
- [ ] 3.2 Create `src/sim/coach.ts` with the need score, threshold, family ranking and tie-break
- [ ] 3.3 Add coach tests: never-used outranks skipped, threshold, empty ledger, tie-break

## 4. Scene generation and drill mode

- [ ] 4.1 Implement scene generation from family templates using the sim RNG, with oracle verification, 24-attempt cap and fixture fallback
- [ ] 4.1a Route the `placement` family through the real `Sim.shopCommand` placement path (as boot-camp mission 8 does), scoring an order as hit only on an exact span match and dealing the next order either way
- [ ] 4.2 Add additive drill fields to `SimState` and record the reason in `DECISIONS.md`
- [ ] 4.3 Implement `drill` mode in `src/sim/sim.ts`: clock, zero speed, no wall damage, per-scene charges, target-death and `r` scene replacement, scoring via `judgement.ts`
- [ ] 4.4 Add acceptance-rate test (200 scenes per family, 30 percent floor) and determinism test under a fixed seed
- [ ] 4.4a Placement family tests: `cheapestPlacement` against hand-computed orders, an exact-span hit, a wrong-span miss, and that every generated order is reachable inside the grid
- [ ] 4.5 Extend `src/harness/format.ts` and `AGENT.md` so `text()` shows the DRILL line and marks the target; add a harness test

## 5. Persistence and payout

- [ ] 5.1 Write drill bests to `save.drills[family]` on drill end when the result beats the stored best
- [ ] 5.2 Pay salvage once per new best through the wallet API from `medals-and-wallet`
- [ ] 5.3 Tests for new-best and not-a-best cases

## 6. Screens

- [ ] 6.1 Drills screen in `src/ui/screens.ts`: family list with best, coach tag, mission name; `j` `k` `l` Enter Esc handling
- [ ] 6.2 Drill end card with kills, perfect, scenes, previous best, `r` and Esc
- [ ] 6.3 Ledger screen: table, trend, medals, high score, coach entries with `1` `2` `3` jump, `j` `k` scroll
- [ ] 6.4 Death screen coach line; wire menu entries from `main-menu`
- [ ] 6.5 Layout assertions in `tests/ui-layout.test.ts` at maximum values and ASCII assertion over every new string

## 7. Verification

- [ ] 7.1 Record a drill run through the CLI and confirm `npm run replay` and `npm run verify:browser` pass on it
- [ ] 7.2 Run `npm run verify` and update `README.md` with the drills and ledger screen
