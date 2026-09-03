// Phase B — the medal ladder and every number it pays.
//
// Pure functions over a `Command`, the `Plan` from rules.ts and the zombie list
// as it stood *before* the victims were spliced out. Imports nothing from
// `ui`, `render` or `audio`: the renderer and the audio layer read the tables
// here, never the other way round.
//
// Names are data, not literals in a switch, so `armory` can sell a callout
// pack later without touching the judging. Payouts are exported constants so
// the tests assert the table rather than a magic number.
import type { Command, Zombie } from '../core/types';
import type { JudgeAnchor } from '../core/state';
import type { Plan } from './rules';

/** A callout with a `supplies` payout attached. Matches the `medal` event. */
export interface Medal { name: string; bonus: number }

// ---------------------------------------------------------------- multi-kill

/** By victim count, starting at 2. Ten or more is the last rung. */
export const MULTI_KILL_NAMES = [
  'DOUBLE KILL',
  'TRIPLE KILL',
  'OVERKILL',
  'KILLTACULAR',
  'KILLTROCITY',
  'KILLIMANJARO',
  'KILLTASTROPHE',
  'KILLPOCALYPSE',
  'KILLIONAIRE',
] as const;

/** Supplies per multi-kill rung, aligned with MULTI_KILL_NAMES. Sub-linear
 *  past KILLTACULAR so a jammed lane cannot mint a wallet. */
export const MULTI_KILL_BONUS = [10, 25, 50, 80, 120, 160, 200, 240, 300] as const;

/** The lowest victim count that earns a multi-kill medal. */
export const MULTI_KILL_MIN = 2;
/** Victim counts at or above this all read as the last rung. */
export const MULTI_KILL_CAP = MULTI_KILL_MIN + MULTI_KILL_NAMES.length - 1;   // 10

// ---------------------------------------------------------------- style

export const PERFECT = 'PERFECT';
export const SNIPE = 'SNIPE';
export const BREACH = 'BREACH';
export const CALLED_SHOT = 'CALLED SHOT';
/** Emitted by the Ledger, never by the sim (DECISIONS #71). */
export const FIRST_BLOOD = 'FIRST BLOOD';

export const STYLE_BONUS: Record<string, number> = {
  [PERFECT]: 15,
  [SNIPE]: 10,
  [BREACH]: 15,
  [CALLED_SHOT]: 20,
  [FIRST_BLOOD]: 0,
};

/** Motions that count as a snipe. `;`/`,` arrive already expanded (#1). */
const FIND_MOTIONS = new Set(['f', 'F', 't', 'T']);

// ---------------------------------------------------------------- salvage

/** Lifetime salvage a style medal pays. Multi-kills pay their rung number. */
export const STYLE_SALVAGE = 1;
/** Lifetime salvage FIRST BLOOD pays. */
export const FIRST_BLOOD_SALVAGE = 5;

/** Victim count a name stands for, or 0 when it is not a multi-kill medal. */
export function medalTier(name: string): number {
  const i = (MULTI_KILL_NAMES as readonly string[]).indexOf(name);
  return i < 0 ? 0 : i + MULTI_KILL_MIN;
}

/** Lifetime salvage this medal credits. */
export function salvageFor(name: string): number {
  const tier = medalTier(name);
  if (tier > 0) return tier;
  return name === FIRST_BLOOD ? FIRST_BLOOD_SALVAGE : STYLE_SALVAGE;
}

// ---------------------------------------------------------------- trap kills

/** `survival-store` kills with `trap:<name>`. Those earn nothing here (#70). */
export const TRAP_VIA_PREFIX = 'trap:';

export function isTrapKill(via: string): boolean {
  return via.startsWith(TRAP_VIA_PREFIX);
}

// ---------------------------------------------------------------- judging

/**
 * The medal for however many zombies one command took down, or null for one
 * or none. `J` crushes and `dd`/`D` splash count: the plan is the authority on
 * what the command killed, including crawlers it overkilled on the way.
 */
export function judgeMultiKill(plan: Plan): Medal | null {
  const n = plan.victims.length;
  if (n < MULTI_KILL_MIN) return null;
  const i = Math.min(n, MULTI_KILL_CAP) - MULTI_KILL_MIN;
  return { name: MULTI_KILL_NAMES[i], bonus: MULTI_KILL_BONUS[i] };
}

/**
 * How the kill was made. Several can fire at once and each pays.
 *
 * A plan containing an overkill earns none of these: you got the callout wrong
 * tool, and the combo is already gone. PERFECT is judged elsewhere, against the
 * oracle, and is deliberately not suppressed by an overkill (DECISIONS #69).
 *
 * `zombiesBefore` is the field as it stood when the plan was made, so the
 * victims' kinds are still readable through `plan.victims`.
 */
export function judgeStyle(
  cmd: Command,
  plan: Plan,
  zombiesBefore: readonly Zombie[],
  anchor: JudgeAnchor | null,
): Medal[] {
  const out: Medal[] = [];
  if (plan.overkill || plan.victims.length === 0) return out;

  let runner = false;
  let armored = false;
  let searched = false;
  for (const i of plan.victims) {
    const z = zombiesBefore[i];
    if (!z) continue;
    if (z.kind === 'runner') runner = true;
    if (z.kind === 'armored') armored = true;
    if (anchor && anchor.searchTarget !== 0 && z.id === anchor.searchTarget) searched = true;
  }

  // A snipe is the whole gesture: aiming with `fd` and pulling the trigger
  // with `dw` is one snipe, so the anchor carries the find, not just the
  // killing command (DECISIONS #74).
  const kind = cmd.motion?.kind;
  const aimed = (kind !== undefined && FIND_MOTIONS.has(kind)) || (anchor?.find ?? false);
  if (runner && aimed) {
    out.push({ name: SNIPE, bonus: STYLE_BONUS[SNIPE] });
  }
  if (armored && cmd.textObject !== undefined) {
    out.push({ name: BREACH, bonus: STYLE_BONUS[BREACH] });
  }
  if (searched) {
    out.push({ name: CALLED_SHOT, bonus: STYLE_BONUS[CALLED_SHOT] });
  }
  return out;
}

/** Every name the medal table can produce. The ASCII test reads this. */
export function allMedalNames(): string[] {
  return [...MULTI_KILL_NAMES, PERFECT, SNIPE, BREACH, CALLED_SHOT, FIRST_BLOOD];
}
