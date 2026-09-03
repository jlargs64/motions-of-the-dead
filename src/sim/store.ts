// Phase B — the survival store's item table, and every number in it.
//
// One table, one place to tune. Imports nothing from `ui`, `render` or `audio`:
// the store card and the harness text surface read this file, never the other
// way round. `ItemId` is declared in `core/state.ts` (DECISIONS #77) because
// `SimState.purchases` is keyed by it; it is re-exported here so a caller only
// ever needs one import.
import { ITEM_IDS } from '../core/state';
import type { GameState, ItemId } from '../core/state';
import { ROWS } from '../core/field';
import { baseSpeed, composition, waveSize } from './waves';

export type { ItemId };
export { ITEM_IDS };

/** An `instant` item resolves on purchase. A `trap` opens placement mode. */
export interface Item {
  id: ItemId;
  name: string;
  /** One line, printable ASCII, short enough for the store card. */
  blurb: string;
  price: number;
  /** Owned ceiling. 0 means uncapped. */
  maxOwned: number;
  kind: 'instant' | 'trap';
}

/** Barricade HP one Planks purchase restores, never above `maxHp`. */
export const PLANKS_HP = 25;
/** What one Sandbags purchase adds to both `maxHp` and `hp`. */
export const SANDBAGS_HP = 10;
/** Kills of oracle hint one Spotter buys. */
export const SPOTTER_KILLS = 3;
/** Barricade HP a Second Wind revives you on. */
export const REVIVE_HP = 30;
/** Extra waste cells Whetstone allows, for the night it was bought for. */
export const WHETSTONE_CELLS = 1;
/** What Flare multiplies the next night's spawn speeds by. */
export const FLARE_SPEED = 0.7;
/** Columns one minefield charge covers. */
export const MINE_BLOCK = 5;

/**
 * Prices are tunable constants and are expected to move once real
 * supplies-per-wave numbers exist; `npm run smoke` prints that figure. One
 * clean night should buy roughly one charge.
 *
 * Nothing here permanently changes speed, waste allowance, lane count or
 * aiming — persistent power is the armory's job, not the store's.
 */
export const ITEMS: readonly Item[] = [
  { id: 'dd', name: 'dd charge', blurb: 'one lane, gone. ammunition now, not a refill', price: 60, maxOwned: 0, kind: 'instant' },
  { id: 'D', name: 'D charge', blurb: 'crosshair to the wall. the cheap sweep', price: 40, maxOwned: 0, kind: 'instant' },
  { id: 'bandolier', name: 'bandolier', blurb: 'one more of each charge you can carry', price: 150, maxOwned: 3, kind: 'instant' },
  { id: 'whetstone', name: 'whetstone', blurb: 'one more wasted cell before a D, tonight only', price: 50, maxOwned: 1, kind: 'instant' },
  { id: 'repeater', name: 'repeater', blurb: 'the next . spends no charge', price: 40, maxOwned: 3, kind: 'instant' },
  { id: 'planks', name: 'planks', blurb: `patch ${PLANKS_HP} barricade HP`, price: 80, maxOwned: 0, kind: 'instant' },
  { id: 'sandbags', name: 'sandbags', blurb: `${SANDBAGS_HP} more wall, and ${SANDBAGS_HP} more to lose`, price: 120, maxOwned: 5, kind: 'instant' },
  { id: 'flare', name: 'flare', blurb: 'they come slower tomorrow night', price: 100, maxOwned: 1, kind: 'instant' },
  { id: 'wire', name: 'barbed wire', blurb: 'one lane at the wall. holds the first one a second', price: 30, maxOwned: ROWS, kind: 'trap' },
  { id: 'tripwire', name: 'tripwire', blurb: 'one cell. the first thing across it dies', price: 50, maxOwned: 0, kind: 'trap' },
  { id: 'fence', name: 'wire fence', blurb: 'one column across the lanes you span. 40 a lane', price: 40, maxOwned: 0, kind: 'trap' },
  { id: 'minefield', name: 'minefield', blurb: `one lane across the columns you span. 30 per ${MINE_BLOCK}`, price: 30, maxOwned: 0, kind: 'trap' },
  { id: 'spotter', name: 'spotter', blurb: `the cheapest command, for ${SPOTTER_KILLS} kills`, price: 60, maxOwned: 1, kind: 'instant' },
  { id: 'manifest', name: 'manifest', blurb: 'what tomorrow night is made of', price: 20, maxOwned: 1, kind: 'instant' },
  { id: 'secondwind', name: 'second wind', blurb: `the wall comes back at ${REVIVE_HP}. once`, price: 400, maxOwned: 1, kind: 'instant' },
];

const BY_ID = new Map<string, Item>(ITEMS.map((i) => [i.id, i]));

/** The item with this id, or undefined. */
export function itemById(id: string): Item | undefined { return BY_ID.get(id); }

/** Rows in the store list: one per item, then NEXT NIGHT. */
export const SHOP_ROWS = ITEMS.length + 1;
/** The list row that starts the next night. */
export const NEXT_ROW = ITEMS.length;

/** Lanes currently wired, from the bitmask. */
export function wiredLanes(mask: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < ROWS; r++) if ((mask & (1 << r)) !== 0) out.push(r);
  return out;
}

/**
 * How many of this item you have, in the unit its cap is counted in:
 * charges for `dd`/`D`, the banked repeat for Repeater, wired lanes for
 * Barbed wire, this store visit's unlock for Manifest, and `purchases`
 * for everything else (DECISIONS #81).
 */
export function ownedOf(s: GameState, id: ItemId): number {
  const sm = s.sim;
  switch (id) {
    case 'dd': return s.charges.dd;
    case 'D': return s.charges.D;
    case 'repeater': return sm.freeRepeat;
    case 'wire': return wiredLanes(sm.wireLanes).length;
    case 'manifest': return sm.manifest ? 1 : 0;
    default: return sm.purchases[id];
  }
}

/** The ceiling `ownedOf` is measured against, or 0 for uncapped. */
export function capOf(s: GameState, id: ItemId): number {
  if (id === 'dd') return s.sim.chargeCap.dd;
  if (id === 'D') return s.sim.chargeCap.D;
  return itemById(id)?.maxOwned ?? 0;
}

/** `owned 1/2`, or `owned 3` where there is no cap. */
export function ownedText(s: GameState, id: ItemId): string {
  const cap = capOf(s, id);
  const n = ownedOf(s, id);
  return cap > 0 ? `owned ${n}/${cap}` : `owned ${n}`;
}

/**
 * Whether `l` on this row does anything at all: the wallet covers the base
 * price and the owned count is below the cap. A trap's *span* is priced again
 * at plant time, which is the check that can still refuse.
 */
export function canBuy(s: GameState, id: ItemId): boolean {
  const item = itemById(id);
  if (!item) return false;
  if (s.supplies < item.price) return false;
  const cap = capOf(s, id);
  return cap === 0 || ownedOf(s, id) < cap;
}

/**
 * Widest a blurb, a manifest line or the mix may be before the store card's
 * `fit` starts cutting words in half. Asserted over the real tables in
 * `tests/sim.test.ts`, so a longer blurb fails the suite rather than the eye.
 */
export const CARD_LINE = 52;

/**
 * The next night for the store card, as two lines: the numbers, then the mix.
 * The percent sign lives in the header rather than on every entry, because a
 * five-kind night is 52 cells with it and 51 without (DECISIONS #83).
 */
export function manifestCard(wave: number): [string, string] {
  const n = wave + 1;
  return [
    `MANIFEST  night ${n}   ${waveSize(n)} bodies   ${baseSpeed(n).toFixed(2)} c/s   mix %`,
    composition(n).map(([kind, w]) => `${kind} ${Math.round(w * 100)}`).join(' '),
  ];
}

/**
 * The next night, from the pure wave functions only — no RNG is drawn, so
 * buying Manifest cannot change what actually spawns.
 */
export function manifestLine(wave: number): string {
  const n = wave + 1;
  const mix = composition(n)
    .map(([kind, w]) => `${kind} ${Math.round(w * 100)}%`)
    .join(' ');
  return `night ${n}: ${waveSize(n)} bodies, speed ${baseSpeed(n).toFixed(2)} c/s, ${mix}`;
}
