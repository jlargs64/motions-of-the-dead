// Phase B - wave composition, speed ramp, and the unlock curriculum.
//
// The curriculum follows vim-hero's syllabus order: sections of lessons, each
// section closed by a review wave that mixes everything it taught. One wave is
// one lesson. The horde composition is scheduled so that the zombie type whose
// optimal answer *is* this lesson shows up on this lesson.
import type { MotionKind, ZombieKind } from '../core/types';

export interface WaveDef {
  /** vim-hero section heading, e.g. "Essential Motions". */
  section: string;
  /** Lesson title, e.g. "Find Character". */
  title: string;
  /** Keycaps, rendered like vim-hero's chips. */
  keys: string[];
  /** One line of Vim-accurate description. */
  desc: string;
  /** What the horde now demands. Goes out on the `wave_start` event. */
  motions: MotionKind[];
  /** Flavour line under the wave number. */
  brief: string;
  review?: true;
}

const C: WaveDef[] = [
  // ---- Basic Vim ----------------------------------------------------------
  {
    section: 'Basic Vim', title: 'Basic Movement', keys: ['h', 'j', 'k', 'l'],
    desc: 'left, down a lane, up a lane, right - one cell at a time',
    motions: ['h', 'j', 'k', 'l'],
    brief: 'They come from the west. You have all night. You do not have all night.',
  },
  {
    section: 'Basic Vim', title: 'Moving by Words', keys: ['w', 'e', 'b'],
    desc: 'w to the next word, e to the end of this one, b back',
    motions: ['w', 'e', 'b'],
    brief: 'Stop walking. Start jumping.',
  },
  {
    section: 'Basic Vim', title: 'Making Small Edits', keys: ['x', 'X'],
    desc: 'x deletes one character. On a long word it whittles: one letter per press',
    motions: [],
    brief: 'Crawlers. One character each. One bullet each. Anything longer, use dw.',
  },
  // ---- Basic Operators ------------------------------------------------------
  {
    section: 'Basic Operators', title: 'Delete Words', keys: ['d', 'w'],
    desc: 'dw deletes from the crosshair to the start of the next word',
    motions: [],
    brief: 'This is your rifle.',
  },
  {
    section: 'Basic Operators', title: 'Change Words', keys: ['c', 'w'],
    desc: 'cw takes the word you are standing in - it stops at the word end, not the next word',
    motions: [],
    brief: 'Same reach, different edge.',
  },
  {
    section: 'Basic Operators', title: 'Delete Lines', keys: ['d', 'd', 'D'],
    desc: 'dd clears the whole lane, D clears from the crosshair to the wall - both cost a charge',
    motions: [],
    brief: 'Bloaters. Too much of them to carve one word at a time.',
  },
  {
    section: 'Basic Operators', title: 'Delete Multiple Lines', keys: ['d', 'j', 'k'],
    desc: 'dj takes this lane and the one below; d3j takes four',
    motions: ['j', 'k'],
    brief: 'Two lanes, one command.',
  },
  {
    section: 'Basic Operators', title: 'Operators Review', keys: ['d', 'c', 'x', 'D'], review: true,
    desc: 'everything the operators section taught, all at once',
    motions: [],
    brief: 'No new tricks. Prove the old ones.',
  },
  // ---- Essential Motions -----------------------------------------------------
  {
    section: 'Essential Motions', title: 'Moving by WORDs', keys: ['W', 'E', 'B'],
    desc: 'the capitals ignore punctuation - a WORD is any run of non-blank',
    motions: ['W', 'E', 'B'],
    brief: 'Bigger steps.',
  },
  {
    section: 'Essential Motions', title: 'Moving to Line Ends', keys: ['0', '_', '$'],
    desc: '0 to the far west, _ to the first zombie in the lane, $ to the one nearest the wall',
    motions: ['0', '_', '$'],
    brief: '$ is the one about to reach you.',
  },
  {
    section: 'Essential Motions', title: 'Find Character', keys: ['f', 'F', ';'],
    desc: 'f{char} lands the crosshair on the next {char} in the lane; F searches back; ; repeats',
    motions: ['f', 'F', ';', ','],
    brief: 'Runners. Twice the speed, half the letters.',
  },
  {
    section: 'Essential Motions', title: 'Till Character', keys: ['t', 'T', ';'],
    desc: 't{char} stops just before it - the difference matters when you follow it with an operator',
    motions: ['t', 'T'],
    brief: 'One cell short, on purpose.',
  },
  {
    section: 'Essential Motions', title: 'Motions Review', keys: ['W', '$', 'f', 't'], review: true,
    desc: 'every horizontal motion, under pressure',
    motions: [],
    brief: 'They are not slowing down for this.',
  },
  // ---- Advanced Vertical Movement ----------------------------------------------
  {
    section: 'Advanced Vertical Movement', title: 'Relative Line Jumps', keys: ['{n}', 'j', 'k'],
    desc: '5j drops five lanes; the count goes in front',
    motions: ['j', 'k'],
    brief: 'Count the lanes. Move once.',
  },
  {
    section: 'Advanced Vertical Movement', title: 'Absolute Line Jumps', keys: ['g', 'g', 'G'],
    desc: 'gg to the top lane, G to the bottom, 7G straight to lane 7 and its first zombie',
    motions: ['gg', 'G'],
    brief: 'Name the lane. Be there.',
  },
  {
    section: 'Advanced Vertical Movement', title: 'Paragraph Jumps', keys: ['{', '}'],
    desc: '} down to the next empty lane, { back up - free ground is a landmark',
    motions: ['{', '}', 'H', 'M', 'L'],
    brief: 'Cross the field in one key.',
  },
  {
    section: 'Advanced Vertical Movement', title: 'Vertical Review', keys: ['G', '}', 'H', 'L'], review: true,
    desc: 'sixteen lanes, and you should never touch j twice',
    motions: [],
    brief: 'All sixteen lanes are live.',
  },
  // ---- Search ---------------------------------------------------------------------
  {
    section: 'Search', title: 'Search', keys: ['/', '?'],
    desc: '/text<CR> jumps to the next match anywhere on the field, ?text<CR> searches backward',
    motions: [],
    brief: 'Name what you want dead.',
  },
  {
    section: 'Search', title: 'Repeat Search', keys: ['n', 'N'],
    desc: 'n repeats the last search, N repeats it the other way',
    motions: [],
    brief: 'Say it once. Hit it twice.',
  },
  {
    section: 'Search', title: 'Quick Word Search', keys: ['*', '#'],
    desc: '* jumps to the next zombie with the same word as the one under the crosshair; # goes back',
    motions: [],
    brief: 'They travel in families.',
  },
  {
    section: 'Search', title: 'Search Review', keys: ['/', 'n', '*'], review: true,
    desc: 'find it, repeat it, finish it',
    motions: [],
    brief: 'Somewhere out there is the one you want.',
  },
  // ---- Text Objects: brackets --------------------------------------------------------
  {
    section: 'Text Objects - Brackets', title: 'Delete Inside Brackets', keys: ['d', 'i', '{'],
    desc: 'di{ cuts what is between the braces, wherever in them you stand',
    motions: ['%'],
    brief: 'Armored. Plate on the chest. Cut the inside out.',
  },
  {
    section: 'Text Objects - Brackets', title: 'Delete Around Brackets', keys: ['d', 'a', '{'],
    desc: 'da{ takes the braces too',
    motions: ['%'],
    brief: 'Take the armor with it.',
  },
  {
    section: 'Text Objects - Brackets', title: 'Change Around Brackets', keys: ['c', 'a', '{'],
    desc: 'c works on every text object d does - ca( ci[ ca] all reach the same pairs',
    motions: ['%'],
    brief: 'Every bracket is a door.',
  },
  {
    section: 'Text Objects - Brackets', title: 'Brackets Review', keys: ['d', 'i', '(', 'c', 'a', '['], review: true,
    desc: '( ) [ ] { } - the closing one works as well as the opening one',
    motions: ['%'],
    brief: 'Mixed plate.',
  },
  // ---- Text Objects: quotes ------------------------------------------------------------
  {
    section: 'Text Objects - Quotes', title: 'Delete Inside Quotes', keys: ['d', 'i', '"'],
    desc: 'di" cuts between the quotes on this lane',
    motions: [],
    brief: 'Quoted. Same idea, thinner shell.',
  },
  {
    section: 'Text Objects - Quotes', title: 'Delete Around Quotes', keys: ['d', 'a', '"'],
    desc: 'da" takes the quote marks with it',
    motions: [],
    brief: 'Leave nothing.',
  },
  {
    section: 'Text Objects - Quotes', title: 'Change Around Quotes', keys: ['c', 'a', "'"],
    desc: "single quotes work exactly the same - ci' da' ca'",
    motions: [],
    brief: 'Both kinds of quote, both kinds of dead.',
  },
  {
    section: 'Text Objects - Quotes', title: 'Quotes Review', keys: ['d', 'i', '"', 'c', 'a', "'"], review: true,
    desc: 'quotes and brackets on the same field',
    motions: [],
    brief: 'Read the shell before you fire.',
  },
  // ---- Text Objects: words --------------------------------------------------------------
  {
    section: 'Text Objects - Words', title: 'Delete Inside Word', keys: ['d', 'i', 'w'],
    desc: 'diw kills the word you are standing in from anywhere inside it - no need to reach its start',
    motions: [],
    brief: 'Stop aiming at the first letter.',
  },
  {
    section: 'Text Objects - Words', title: 'Delete Around Word', keys: ['d', 'a', 'w'],
    desc: 'daw takes the trailing space too - and it cuts armor, because it is a text object',
    motions: [],
    brief: 'The one key that works on everything.',
  },
  {
    section: 'Text Objects - Words', title: 'Change Inside Word', keys: ['c', 'i', 'w'],
    desc: 'ciw - same span, and one keystroke you will use forever',
    motions: [],
    brief: 'Muscle memory or nothing.',
  },
  {
    section: 'Text Objects - Words', title: 'Words Review', keys: ['d', 'i', 'w', 'd', 'a', 'w'], review: true,
    desc: 'the whole syllabus, and no more lessons after this',
    motions: [],
    brief: 'That is everything anyone taught you. Now hold.',
  },
];

export const CURRICULUM = C;
export const LESSON_COUNT = C.length;

export function waveDef(wave: number): WaveDef {
  const d = C[wave - 1];
  if (d) return d;
  return {
    section: 'The Long Night', title: `Night ${wave}`, keys: ['.'],
    desc: 'no new lessons. Only less time.',
    motions: [],
    brief: 'More of them. Fewer of you.',
    review: true,
  };
}

/**
 * Columns per second across 52 columns of open ground.
 * Wave 1 is 1.1 (47 seconds to cross - you have time to think). The ramp then
 * keeps climbing rather than plateauing, so the ceiling comes from speed and
 * not from spawning more bodies than the lanes can physically hold.
 */
export function baseSpeed(wave: number): number {
  return Math.min(8, 1.1 + (wave - 1) * (2.6 / 18));
}

export function waveSize(wave: number): number { return 6 + 2 * wave; }
/** The window grows slower than the wave, so pressure keeps rising. */
export function spawnWindowMs(wave: number): number { return 18_000 + 200 * wave; }

export const BREATHER_MS = 4_000;
export const COMBO_WINDOW_MS = 2_500;

/** Weight table, ramped to arrive with the lesson that answers it. */
export function composition(wave: number): Array<[ZombieKind, number]> {
  if (wave <= 2) return [['walker', 1]];
  if (wave <= 5) return [['walker', 0.78], ['crawler', 0.22]];
  if (wave <= 8) return [['walker', 0.62], ['crawler', 0.18], ['bloater', 0.20]];
  if (wave <= 13) return [['walker', 0.46], ['crawler', 0.14], ['bloater', 0.16], ['runner', 0.24]];
  if (wave <= 21) return [['walker', 0.40], ['crawler', 0.15], ['bloater', 0.17], ['runner', 0.28]];
  return [['walker', 0.30], ['crawler', 0.12], ['bloater', 0.14], ['runner', 0.22], ['armored', 0.22]];
}
