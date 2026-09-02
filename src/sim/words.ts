// Phase B — the horde's vocabulary. Grim, short, monospace-friendly.
import type { ZombieKind } from '../core/types';
import type { Rng } from '../core/rng';

export const WALKERS = [
  'shamble', 'lurch', 'creep', 'drag', 'moan', 'husk', 'grave', 'flesh',
  'decay', 'groan', 'wither', 'gnaw', 'maul', 'bile', 'gore', 'pale',
  'limp', 'dread', 'corpse', 'marrow', 'sinew', 'fester', 'ghoul',
  'carrion', 'viscera', 'rot', 'grime', 'blight', 'shroud', 'mould',
] as const;

export const RUNNERS = [
  'dash', 'bolt', 'rush', 'leap', 'flee', 'hunt', 'snap', 'claw', 'rip',
  'tear', 'dart', 'race', 'jerk', 'spit', 'bite', 'howl', 'lunge', 'skit',
] as const;

export const BLOATERS = [
  'distended', 'putrescent', 'corpulent', 'festering', 'engorged',
  'gangrenous', 'pestilent', 'sepulchral', 'cadaverous', 'malodorous',
  'necrotic', 'entrails', 'revenant', 'suppurate', 'exsanguine',
] as const;

export const CRAWLERS = ['z', 'x', 'o', 'c', 'r', 'e', 'w', 'm', 'n', 'v', 's', 'g'] as const;

const WRAPS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"],
];

/** Armored words stay short so `(putrescent)` never eats half the field. */
const ARMORABLE = WALKERS.filter((w) => w.length <= 6);

export function wordFor(kind: ZombieKind, rng: Rng): string {
  switch (kind) {
    case 'walker': return rng.pick(WALKERS);
    case 'runner': return rng.pick(RUNNERS);
    case 'bloater': return rng.pick(BLOATERS);
    case 'crawler': return rng.pick(CRAWLERS);
    case 'armored': {
      const [a, b] = rng.pick(WRAPS);
      return a + rng.pick(ARMORABLE) + b;
    }
  }
}
