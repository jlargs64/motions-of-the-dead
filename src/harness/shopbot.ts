// Phase F — the shopping trip the rule-based bot makes between nights.
//
// It lives beside the harness rather than inside `scripts/` because both the
// smoke bot and `tests/harness.test.ts` need it: with charges no longer
// refilling in survival (DECISIONS #78), any bot that does not buy ammunition
// runs dry around wave 6, and a test that asserts wave 6 has to shop for the
// same reason a player does.
//
// It drives the store with the keys a player uses - no direct `Sim.buy` - so
// it is also a live proof that the store is reachable from `Game.keys()` alone.
import type { Game } from './api';
import { ITEMS, itemById } from '../sim/store';

/** The list row an item id sits on. */
function rowOf(id: string): number {
  return ITEMS.findIndex((i) => i.id === id);
}

/** `gg` then n `j`s: the cheapest way to name a row out of the engine. */
function select(g: Game, id: string): void {
  g.keys('gg');
  const n = rowOf(id);
  if (n > 0) g.keys(`${n}j`);
}

/**
 * Top up one charge while the wallet allows. Ten is a ceiling on the loop, not
 * on the purchase: the cap check inside the store is what actually stops it.
 */
function topUp(g: Game, id: 'D' | 'dd'): void {
  const price = itemById(id)!.price;
  select(g, id);
  for (let i = 0; i < 10; i++) {
    const st = g.json();
    if (st.supplies < price) return;
    if (st.charges[id] >= st.sim.chargeCap[id]) return;
    g.keys('l');
  }
}

/**
 * Buy ammunition, then leave. `D` first: it is the cheaper charge and the one
 * the oracle reaches for most. Nothing else is bought, so the bot stays a
 * measure of the *fighting*, and the seed-1 wave-6 assertion still means what
 * it always meant.
 */
export function shopRoutine(g: Game): void {
  topUp(g, 'D');
  topUp(g, 'dd');
  g.keys('n');
}
