// Phase B — traps: the survey grid you place them on, what a span costs, and
// which one a zombie just walked onto.
//
// Pure functions over `Trap` and the geometry. Imports nothing from `ui`,
// `render` or `audio`. `Trap` and `TrapKind` are declared in `core/state.ts`
// (DECISIONS #77) and re-exported here so a caller needs one import.
import { FIELD_COLS, ROWS } from '../core/field';
import type { Buffer, Zombie } from '../core/types';
import type { Trap, TrapKind } from '../core/state';
import { MINE_BLOCK, itemById } from './store';

export type { Trap, TrapKind };

/**
 * The field is empty when a wave clears, so `w`, `f` and `$` would have
 * nothing to land on. Placement therefore runs the real engine over a
 * synthetic buffer: sixteen identical lanes of the same column ruler, a digit
 * every tenth column. `f3` finds column 30, `w` hops mark to mark, `$` is the
 * wall side and `0` the spawn side (DECISIONS #79).
 */
export const SURVEY_RULER = (() => {
  let r = '';
  for (let c = 0; c < FIELD_COLS; c++) r += c % 10 === 0 ? String(c / 10) : '.';
  return r;
})();

const SURVEY: Buffer = {
  rows: new Array<string>(ROWS).fill(SURVEY_RULER),
  zombies: [],
};

/** The buffer placement motions resolve against. Constant; never mutated. */
export function surveyBuffer(): Buffer { return SURVEY; }

/** Lanes a fence over `row0..row1` covers, which is also its charge count. */
export function fenceLanes(row0: number, row1: number): number {
  return Math.abs(row1 - row0) + 1;
}

/** Charges a minefield over `col0..col1` gets: one per five columns, rounded up. */
export function mineBlocks(col0: number, col1: number): number {
  return Math.ceil((Math.abs(col1 - col0) + 1) / MINE_BLOCK);
}

/**
 * What planting the current span would cost, quoted live in the placement
 * strip as the crosshair moves. A tripwire and a lane of wire are flat.
 */
export function spanCost(kind: string, a: { row: number; col: number } | null,
                         place: { row: number; col: number }): number {
  const price = itemById(kind)?.price ?? 0;
  if (kind === 'fence') return price * (a ? fenceLanes(a.row, place.row) : 1);
  if (kind === 'minefield') return price * (a ? mineBlocks(a.col, place.col) : 1);
  return price;
}

/** Whether a trap's rows and columns intersect a zombie where it now stands. */
export function trapCatches(t: Trap, z: Zombie): boolean {
  if (z.row < t.row0 || z.row > t.row1) return false;
  return t.col1 >= z.col && t.col0 <= z.col + z.text.length - 1;
}

/**
 * The first trap this zombie is standing on, or null. Checked after every
 * single-column step, so a runner covering two columns in one tick cannot
 * skip a wire (DECISIONS #80).
 */
export function fireTraps(traps: readonly Trap[], z: Zombie): number {
  for (let i = 0; i < traps.length; i++) if (trapCatches(traps[i], z)) return i;
  return -1;
}

/** `1 tripwire 5 30..30 1`, the row `text()` prints and the card echoes. */
export function trapLanes(t: Trap): string {
  return t.row0 === t.row1 ? String(t.row0 + 1) : `${t.row0 + 1}..${t.row1 + 1}`;
}

export function trapCols(t: Trap): string {
  return t.col0 === t.col1 ? String(t.col0) : `${t.col0}..${t.col1}`;
}
