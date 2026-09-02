// Phase E - the death line. Dry, and reactive to what actually happened.
import type { GameState } from '../core/state';
import type { RunSummary } from './ledger';
import { LESSON_COUNT, waveDef } from '../sim/waves';

export interface DeathCtx {
  state: GameState;
  summary: RunSummary;
  unknownKeys: number;
}

interface Line { when: (c: DeathCtx) => boolean; text: (c: DeathCtx) => string }

const REACTIVE: Line[] = [
  {
    when: (c) => c.unknownKeys >= 5,
    text: (c) => `You reached for the arrow keys ${c.unknownKeys} times. They know.`,
  },
  {
    when: (c) => c.state.charges.dd > 0 && c.state.wave > 2,
    text: (c) => `Died with ${c.state.charges.dd} dd ${c.state.charges.dd === 1 ? 'charge' : 'charges'}. Hoarder.`,
  },
  {
    when: (c) => c.state.sim.overkills >= 4,
    text: (c) => `${c.state.sim.overkills} overkills. A crawler is one character. One.`,
  },
  {
    when: (c) => c.summary.wastedKeystrokes >= 60,
    text: (c) => `${c.summary.wastedKeystrokes} keystrokes you did not need. That is the whole difference.`,
  },
  {
    when: (c) => c.summary.neverUsed.some(([t]) => t === 'f' || t === 't'),
    text: () => 'You never once pressed f. They were standing right there.',
  },
  {
    when: (c) => c.summary.neverUsed.some(([t]) => t.length === 2 && (t[0] === 'i' || t[0] === 'a')),
    text: () => 'The armored ones walked straight through you. Brackets are not decoration.',
  },
  {
    when: (c) => c.summary.kpk >= 6,
    text: (c) => `${c.summary.kpk} keystrokes a kill. They were faster than your fingers.`,
  },
  {
    when: (c) => c.state.sim.longestCombo <= 2 && c.state.wave >= 3,
    text: () => 'You never strung two together.',
  },
  {
    when: (c) => c.state.sim.longestCombo >= 25,
    text: (c) => `Longest chain: ${c.state.sim.longestCombo}. It ended, like everything.`,
  },
  {
    when: (c) => c.state.wave === 1,
    text: () => 'Night one. The tutorial ate you.',
  },
  {
    when: (c) => c.state.wave >= LESSON_COUNT,
    text: (c) => `Night ${c.state.wave}. There was nothing left to teach you.`,
  },
  {
    when: (c) => c.state.wave >= 22,
    text: () => 'You made it to the armored ones. They made it to the wall.',
  },
  {
    when: (c) => c.summary.topUsed.length > 0 && 'hjkl'.includes(c.summary.topUsed[0][0]),
    text: (c) => `Your most used motion was ${c.summary.topUsed[0][0]}. hjkl is a crutch. You leaned.`,
  },
  {
    when: (c) => c.summary.prevKpk !== null && c.summary.kpk < c.summary.prevKpk,
    text: (c) => `${c.summary.prevKpk} keystrokes a kill last time, ${c.summary.kpk} this time. Improving. Still dead.`,
  },
];

const GENERIC = [
  'The barricade held longer than you did.',
  'No survivors. Including the ones you meant to kill.',
  'They came out of the west all night. You went out in one.',
  'Insert mode is death. You knew that going in.',
  'Somewhere in there was a two-keystroke answer.',
  'The buffer is unmodified. So is the horde.',
];

export function deathLine(c: DeathCtx): string {
  for (const l of REACTIVE) {
    try { if (l.when(c)) return l.text(c); } catch { /* keep looking */ }
  }
  const lesson = waveDef(c.state.wave);
  if (lesson.review) return `You died on a review. ${GENERIC[0]}`;
  return GENERIC[Math.abs(c.state.score + c.state.wave) % GENERIC.length];
}
