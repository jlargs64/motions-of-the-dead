// FROZEN CONTRACT — Phase 0. Field geometry + buffer derivation.
//
// The field is a side-on battlefield read as a text buffer. Each ROW is a lane.
// Zombies spawn at column 0 and walk RIGHT toward the barricade, which stands
// at column FIELD_COLS. The survivor stands behind it. So every horizontal Vim
// motion — w b e f t ; $ 0 ^ — runs along the axis the threat travels, and
// j / k switch lanes.
import type { Barricade, Buffer, Zombie } from './types';

/** Lanes. */
export const ROWS = 16;
/** Walkable columns: 0 .. FIELD_COLS-1. The cursor lives here too. */
export const FIELD_COLS = 52;
/** Full grid width, including the wall and the survivor's ground on the right. */
export const COLS = 60;
/** The barricade stands in this column. A zombie touching it attacks. */
export const BARRICADE_COL = FIELD_COLS;

/** Barricade glyph ramp, healthiest first. */
const RAMP = ['#', '=', '-', '.', ' '] as const;
const RAMP_WIDTH = 0.35; // fraction of the wall spent transitioning

/**
 * The wall is a vertical column of ROWS glyphs. It degrades from the bottom up,
 * so the breach opens where the survivor can see it coming.
 */
export function barricadeGlyphs(b: Barricade): string {
  const f = b.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, b.hp / b.maxHp));
  let out = '';
  for (let i = 0; i < ROWS; i++) {
    const depth = (ROWS - 1 - i) / ROWS;              // 0 at the bottom
    const level = (f * (1 + RAMP_WIDTH) - depth) / RAMP_WIDTH;
    let idx = 4 - Math.round(Math.max(0, Math.min(1, level)) * 4);
    if (idx < 0) idx = 0; if (idx > 4) idx = 4;
    out += RAMP[idx];
  }
  return out;
}

/**
 * Rows are derived from zombie positions every tick; zombies are truth.
 * Trailing whitespace is trimmed so `$` lands on the zombie nearest the wall.
 */
export function deriveRows(zombies: readonly Zombie[], _barricade: Barricade, out?: string[]): string[] {
  const rows = out ?? new Array<string>(ROWS);
  const cells = SCRATCH;
  for (let r = 0; r < ROWS; r++) {
    const row = cells[r];
    for (let c = 0; c < FIELD_COLS; c++) row[c] = ' ';
  }
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (z.row < 0 || z.row >= ROWS) continue;
    const row = cells[z.row];
    for (let k = 0; k < z.text.length; k++) {
      const c = z.col + k;
      if (c >= 0 && c < FIELD_COLS) row[c] = z.text[k];
    }
  }
  for (let r = 0; r < ROWS; r++) {
    let end = FIELD_COLS;
    const row = cells[r];
    while (end > 0 && row[end - 1] === ' ') end--;
    rows[r] = end === 0 ? '' : row.slice(0, end).join('');
  }
  rows.length = ROWS;
  return rows;
}

const SCRATCH: string[][] = Array.from({ length: ROWS }, () => new Array<string>(FIELD_COLS).fill(' '));

export function makeBuffer(): Buffer {
  return { rows: new Array<string>(ROWS).fill(''), zombies: [] };
}

/** Zombie occupying the given cell, or null. */
export function zombieAt(zombies: readonly Zombie[], row: number, col: number): Zombie | null {
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (z.row === row && col >= z.col && col < z.col + z.text.length) return z;
  }
  return null;
}
