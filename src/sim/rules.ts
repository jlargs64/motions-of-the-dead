// Phase B — kill resolution, shared by the sim and the optimality heuristic so
// the two can never disagree about what a command would do.
import type { Command, Zombie } from '../core/types';
import { coversRange, overlapsRange, spanCells } from '../vim/resolve';
import type { Span } from '../vim/resolve';

export type Outcome =
  | 'none'      // the command did not touch this zombie
  | 'chip'      // armored: one bracket glyph gone
  | 'erode'     // partly covered: those characters are gone, the rest closes up
  | 'kill'      // clean kill
  | 'overkill'; // it died, but you used the wrong tool

/**
 * Cells a command may destroy beyond the zombies it actually kills before it
 * counts as a sweep. Without this, `d$` from column 0 is a free two-keystroke
 * row wipe and every horizontal motion in the game is decorative. Move first,
 * then cut — that is the whole lesson.
 */
export const WASTE_ALLOWANCE = 4;

/** A zombie the command carved into rather than killed. */
export interface Erosion { index: number; col: number; text: string }

export interface Plan {
  /** Indices into `zombies`, ascending. */
  victims: number[];
  chips: number[];
  erosions: Erosion[];
  killedCells: number;
  /** Characters shaved off survivors. Counts as useful work, not waste. */
  erodedCells: number;
  overkill: boolean;
  touched: number;
}

export function isSplashOp(cmd: Command): boolean {
  return cmd.operator === 'dd' || cmd.operator === 'D';
}

/** Bitmask of rows where a bloater got caught by a dd/D and burst. */
export function splashRowMask(cmd: Command, spans: readonly Span[], zombies: readonly Zombie[]): number {
  if (!isSplashOp(cmd)) return 0;
  let mask = 0;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    if (z.kind !== 'bloater') continue;
    if (overlapsRange(spans, z.row, z.col, z.text.length)) mask |= 1 << z.row;
  }
  return mask;
}

export function outcomeFor(cmd: Command, spans: readonly Span[], z: Zombie, splashMask: number): Outcome {
  const len = z.text.length;
  if (!overlapsRange(spans, z.row, z.col, len)) return 'none';

  if (z.kind === 'armored') {
    // Only a text object cuts through armor. Anything else strips a bracket.
    return cmd.textObject ? 'kill' : 'chip';
  }

  const burst = isSplashOp(cmd) && (splashMask & (1 << z.row)) !== 0;
  // A partial hit is not a miss: the letters you covered are gone and the rest
  // of the word closes up. `x` whittles a walker down one character at a time.
  if (!burst && !coversRange(spans, z.row, z.col, len)) return 'erode';

  // A crawler is one character. `x` is the tool. Everything else is a mess.
  if (z.kind === 'crawler' && cmd.operator !== 'x') return 'overkill';
  return 'kill';
}

export function planKills(cmd: Command, spans: readonly Span[], zombies: readonly Zombie[]): Plan {
  const mask = splashRowMask(cmd, spans, zombies);
  const victims: number[] = [];
  const chips: number[] = [];
  const erosions: Erosion[] = [];
  let killedCells = 0;
  let erodedCells = 0;
  let overkill = false;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    const o = outcomeFor(cmd, spans, z, mask);
    if (o === 'none') continue;
    if (o === 'chip') { chips.push(i); continue; }
    if (o === 'erode') {
      let text = '';
      let col = -1;
      for (let k = 0; k < z.text.length; k++) {
        if (overlapsRange(spans, z.row, z.col + k, 1)) continue;
        if (col < 0) col = z.col + k;
        text += z.text[k];
      }
      if (text.length === 0) { victims.push(i); killedCells += z.text.length; continue; }
      erodedCells += z.text.length - text.length;
      erosions.push({ index: i, col, text });
      continue;
    }
    victims.push(i);
    killedCells += z.text.length;
    if (o === 'overkill') overkill = true;
  }
  return {
    victims, chips, erosions, killedCells, erodedCells, overkill,
    touched: victims.length + chips.length + erosions.length,
  };
}

/**
 * Which charge, if any, this command spends. null = free.
 * `dd` and `D` are the named mass tools and always cost. Anything else costs
 * only when it wastes more than WASTE_ALLOWANCE cells on empty ground.
 */
export function chargeKindFor(cmd: Command, spans: readonly Span[], plan: Plan): 'dd' | 'D' | null {
  if (cmd.operator === 'dd') return 'dd';
  if (cmd.operator === 'D') return 'D';
  if (!cmd.operator) return null;
  return spanCells(spans) - plan.killedCells - plan.erodedCells > WASTE_ALLOWANCE ? 'D' : null;
}
