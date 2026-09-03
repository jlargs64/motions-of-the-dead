// Phase B — "what did that kill actually cost you?"
//
// This is the anchor/oracle comparison the Motion Ledger used to run in the
// browser (DECISIONS #68). It lives here so the sim can pay a wallet out of it
// and every headless path agrees with the page about the answer. Pure: it takes
// a snapshot and a zombie id and returns numbers.
import { deriveRows } from '../core/field';
import type { GameState, JudgeAnchor } from '../core/state';
import type { Buffer, Command, Zombie } from '../core/types';
import { optimalKill, tokensUsed } from './optimal';

export type { JudgeAnchor } from '../core/state';

/** A fresh copy, so the anchor cannot be moved by the field walking on. */
export function copyZombie(z: Zombie): Zombie {
  return { id: z.id, kind: z.kind, row: z.row, col: z.col, text: z.text, hp: z.hp, speed: z.speed };
}

/**
 * Snapshot the field for the next kill to be judged against. Called on the
 * first command after run start or after a kill, *before* that command
 * resolves — what you are judged on is where you started from.
 */
export function beginAnchor(state: GameState): JudgeAnchor {
  return {
    zombies: state.buffer.zombies.map(copyZombie),
    cursor: { row: state.cursor.row, col: state.cursor.col },
    charges: { dd: state.charges.dd, D: state.charges.D },
    keys: 0,
    searchTarget: 0,
    find: false,
  };
}

/**
 * Keystroke accounting: one complete command since the anchor. `raw` is what
 * the engine consumed to build it, and it is counted in characters, the same
 * unit `Optimal.cost` is measured in, so PERFECT compares like with like. A
 * find anywhere in the sequence marks the anchor for SNIPE (DECISIONS #74).
 */
export function noteCommand(anchor: JudgeAnchor, cmd: Command): void {
  anchor.keys += cmd.raw.length;
  const aim = cmd.motion?.kind;
  if (aim === 'f' || aim === 'F' || aim === 't' || aim === 'T') anchor.find = true;
}

/** Keystrokes thrown away: what was spent past the oracle's answer, never negative. */
export function wastedOf(spent: number, optimal: string | null): number {
  if (optimal === null || optimal.length >= spent) return 0;
  return spent - optimal.length;
}

/** Rows are derived from zombies, so the anchor need not carry them. */
export function anchorBuffer(anchor: JudgeAnchor): Buffer {
  const rows = deriveRows(anchor.zombies, ANY_WALL);
  return { rows, zombies: anchor.zombies };
}

// deriveRows ignores its barricade argument; this satisfies the signature
// without asking the anchor to remember a wall it does not judge on.
const ANY_WALL = { hp: 0, maxHp: 0 };

export interface Judgement {
  /** Keystrokes the player actually spent since the anchor. */
  spent: number;
  /** The oracle's cheapest kill, or null when nothing in the motion set gets there. */
  optimal: string | null;
  /** Keystrokes thrown away. 0 when the player matched or beat the oracle. */
  wasted: number;
  /** The tokens the oracle's answer exercises. Empty when there is no answer. */
  optimalTokens: string[];
  /** Spent no more than the oracle needed. Never true without an oracle. */
  perfect: boolean;
}

/**
 * Judge one kill against its anchor. Null when the killed zombie was not on
 * the field at the anchor — it spawned after, so there was no cheaper way to
 * have killed it and nothing to report.
 */
export function judgeKill(anchor: JudgeAnchor, zombieId: number): Judgement | null {
  const target = anchor.zombies.find((z) => z.id === zombieId);
  if (!target) return null;
  const spent = anchor.keys;
  const best = optimalKill(anchorBuffer(anchor), anchor.cursor, target, anchor.charges);
  if (!best) return { spent, optimal: null, wasted: 0, optimalTokens: [], perfect: false };
  const cost = best.keys.length;
  return {
    spent,
    optimal: best.keys,
    wasted: wastedOf(spent, best.keys),
    optimalTokens: tokensUsed(best.keys),
    perfect: spent <= cost,
  };
}
