// Phase B - drills: one family per idea in the curriculum, a scene generator
// for each that the oracle has to sign off on, and the placement family's own
// PERFECT rule. Pure: everything here is a function of a family and an RNG.
// Imports nothing from `ui`, `render` or `audio` (drills-and-coach D2, D3, D9).
import { FIELD_COLS, ROWS, deriveRows } from '../core/field';
import type { Rng } from '../core/rng';
import type { PlacementOrder, Trap, TrapKind } from '../core/state';

export type { PlacementOrder };
import type { Buffer, Cursor, Zombie, ZombieKind } from '../core/types';
import { MISSIONS, missionIndex } from './missions';
import type { MissionSpawn } from './missions';
import { COUNT_TOKEN, dryRun, moveKeys, optimalKills, splitKeys, tokensUsed } from './optimal';
import type { Optimal } from './optimal';
import { surveyBuffer } from './traps';
import { RUNNERS, WALKERS } from './words';

export type FamilyId =
  | 'counts' | 'placement' | 'line-ends' | 'find' | 'vertical' | 'paragraph'
  | 'search' | 'brackets' | 'quotes' | 'word-objects';

/** The sprint. */
export const DRILL_MS = 60_000;
/** Generation attempts per scene before the fixtures are used (D3). */
export const DRILL_ATTEMPTS = 24;
/**
 * The magazine a drill scene starts with: empty. With a charge in hand the
 * oracle's answer to any lane of two words is the sweep - `dd` earns its
 * penalty back at two victims - and no horizontal motion could ever verify.
 * A drill isolates aim; the charges are survival's problem (D5, revised).
 */
export const DRILL_CHARGES = { dd: 0, D: 0 } as const;
/** Lifetime salvage one new personal best pays (D5, open question closed). */
export const DRILL_BEST_SALVAGE = 10;

export interface DrillScene {
  spawn: MissionSpawn[];
  /** [lane, column] the crosshair starts on. */
  cursor: [number, number];
  /** Index into `spawn` of the designated target; -1 for a placement order. */
  target: number;
  order?: PlacementOrder;
}

export interface DrillFamily {
  id: FamilyId;
  /** What the drills screen calls it. Printable ASCII, at most 12 cells. */
  name: string;
  /** Keycaps, in display order. */
  keys: readonly string[];
  /**
   * The ledger tokens this family owns: what the coach sums `missed` over.
   * Disjoint across families (asserted in tests/drills.test.ts).
   */
  tokens: readonly string[];
  /** The mission that teaches it; the section heading is read from it. */
  mission: string;
  /** One line under the name on the drills screen. */
  blurb: string;
  /** Hand-written scenes the generator falls back to. At least three (D3). */
  fixtures: readonly DrillScene[];
  /** A candidate scene, or null when the template could not place one. */
  generate(rng: Rng): DrillScene | null;
  /**
   * Whether one of the oracle's cheapest kills exercises the family. The
   * default is token overlap; a family whose lesson is a *count* needs more.
   */
  verify?(best: Optimal, scene: DrillScene): boolean;
  /** Ranked by the coach as this other family: placement borrows `counts`. */
  rankAs?: FamilyId;
}

// ---------------------------------------------------------------- words

const SHORT: readonly string[] = [...WALKERS, ...RUNNERS].filter((w) => w.length <= 5);
const MID: readonly string[] = WALKERS.filter((w) => w.length >= 4 && w.length <= 6);
const WRAPS: ReadonlyArray<readonly [string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
const QUOTES: ReadonlyArray<readonly [string, string]> = [['"', '"'], ["'", "'"]];

/** `n` distinct words from `pool`. */
function pickWords(rng: Rng, n: number, pool: readonly string[]): string[] {
  const out: string[] = [];
  let guard = 0;
  while (out.length < n && guard++ < 64) {
    const w = rng.pick(pool);
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const W = (row: number, col: number, text: string, kind: ZombieKind = 'walker'): MissionSpawn =>
  [kind, row, col, text, 0];

/**
 * Words along one lane from `start`, separated by `gaps[i]` cells. Null when
 * the lane would run past the field (the whole word has to stand on it).
 */
function lane(row: number, start: number, words: readonly string[], gaps: readonly number[],
              kinds?: readonly ZombieKind[]): { spawn: MissionSpawn[]; cols: number[] } | null {
  const spawn: MissionSpawn[] = [];
  const cols: number[] = [];
  let col = start;
  for (let i = 0; i < words.length; i++) {
    if (col + words[i].length > FIELD_COLS - 1) return null;
    spawn.push(W(row, col, words[i], kinds?.[i] ?? 'walker'));
    cols.push(col);
    col += words[i].length + (gaps[i] ?? 1);
  }
  return { spawn, cols };
}

/** A lane other than the ones listed. */
function otherRow(rng: Rng, taken: readonly number[]): number {
  for (let i = 0; i < 16; i++) {
    const r = rng.int(ROWS);
    if (!taken.includes(r)) return r;
  }
  return -1;
}

/** One decoy word on its own lane, clear of `taken` lanes. */
function decoys(rng: Rng, n: number, taken: number[], avoid: readonly string[] = []): MissionSpawn[] {
  const out: MissionSpawn[] = [];
  for (let i = 0; i < n; i++) {
    const r = otherRow(rng, taken);
    if (r < 0) break;
    taken.push(r);
    let w = rng.pick(MID);
    if (avoid.includes(w)) w = rng.pick(MID.filter((x) => !avoid.includes(x)));
    out.push(W(r, 2 + rng.int(36), w));
  }
  return out;
}

// ---------------------------------------------------------------- buffers

/** A static scene as the oracle reads it; ids are spawn order plus one. */
export function sceneBuffer(scene: DrillScene): Buffer {
  const zombies: Zombie[] = scene.spawn.map(([kind, row, col, text], i) => ({
    id: i + 1, kind, row, col, text, hp: kind === 'armored' ? 2 : 1, speed: 0,
  }));
  const rows = new Array<string>(ROWS).fill('');
  deriveRows(zombies, WALL, rows);
  return { rows, zombies };
}

const WALL = { hp: 100, maxHp: 100 };

/** The oracle's tied-cheapest kills for the scene's target, from its cursor. */
export function sceneAnswers(scene: DrillScene): Optimal[] {
  const buf = sceneBuffer(scene);
  const target = buf.zombies[scene.target];
  if (!target) return [];
  return optimalKills(buf, { row: scene.cursor[0], col: scene.cursor[1] }, target, DRILL_CHARGES);
}

function usesAny(best: Optimal, tokens: readonly string[]): boolean {
  const used = tokensUsed(best.keys);
  return tokens.some((t) => used.includes(t));
}

/**
 * The scene teaches the family: at least one of the oracle's cheapest kills
 * exercises it (D3). Ties are decided lexicographically and a digit sorts
 * before a letter, so `2wcw` outranks `fgcw` at four keys each; asking the
 * *single* answer to name the family would reject every find scene there is.
 * A placement order has no kill and verifies by construction (D9).
 */
export function verifyScene(family: DrillFamily, scene: DrillScene): boolean {
  if (scene.order) return true;
  const answers = sceneAnswers(scene);
  if (answers.length === 0) return false;
  const check = family.verify ?? ((best: Optimal) => usesAny(best, family.tokens));
  return answers.some((best) => check(best, scene));
}

/**
 * Generate, then verify: up to `attempts` draws from the family template,
 * each checked against the oracle; on exhaustion one of the family's fixtures,
 * chosen by the same RNG so the fall-back is as deterministic as a hit (D3, D6).
 */
export function generateScene(family: DrillFamily, rng: Rng, attempts = DRILL_ATTEMPTS): DrillScene {
  for (let i = 0; i < attempts; i++) {
    const scene = family.generate(rng);
    if (scene && verifyScene(family, scene)) return scene;
  }
  return rng.pick(family.fixtures);
}

// ---------------------------------------------------------------- verifiers

/** A counted `j`/`k`, or an absolute lane jump. A bare `j` is not the lesson. */
function verticalVerify(best: Optimal): boolean {
  const used = tokensUsed(best.keys);
  if (['G', 'gg', 'H', 'M', 'L'].some((t) => used.includes(t))) return true;
  return used.includes(COUNT_TOKEN) && (used.includes('j') || used.includes('k'));
}

/** The kill itself carried the count: `d3e`, `d2j`, `3x`. `2wcw` did not. */
function countedOpVerify(best: Optimal, scene: DrillScene): boolean {
  const r = dryRun(sceneBuffer(scene), { row: scene.cursor[0], col: scene.cursor[1] }, best.keys);
  return r !== null && r.cmd.operator !== undefined && r.cmd.count > 1;
}

// ---------------------------------------------------------------- templates

function genFind(rng: Rng): DrillScene | null {
  const row = rng.int(ROWS);
  const n = 3 + rng.int(3);
  const words = pickWords(rng, n, SHORT);
  if (words.length < n) return null;
  const gaps = words.map(() => 3 + rng.int(4));
  const built = lane(row, 1 + rng.int(4), words, gaps,
    words.map((w) => (RUNNERS as readonly string[]).includes(w) ? 'runner' : 'walker'));
  if (!built) return null;
  const back = rng.next() < 0.4;
  const from = back ? n - 1 : 0;
  // The target is two or more words on, and its first letter appears in no
  // other word on the lane, so `f` lands on it first time.
  const options: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(i - from) < 2) continue;
    if (back && i === 0) continue;               // `0` reaches that one in a key
    const ch = words[i][0];
    if (words.every((w, j) => j === i || !w.includes(ch))) options.push(i);
  }
  if (options.length === 0) return null;
  return { spawn: built.spawn, cursor: [row, built.cols[from]], target: rng.pick(options) };
}

function genLineEnds(rng: Rng): DrillScene | null {
  const row = rng.int(ROWS);
  const n = 3 + rng.int(2);
  const words = pickWords(rng, n, SHORT);
  if (words.length < n) return null;
  const gaps = words.map(() => 3 + rng.int(4));
  const built = lane(row, rng.next() < 0.5 ? 0 : 1 + rng.int(3), words, gaps);
  if (!built) return null;
  const east = rng.next() < 0.5;
  const target = east ? n - 1 : 0;
  const from = east ? rng.int(n - 2) : 2 + rng.int(n - 2);
  return { spawn: built.spawn, cursor: [row, built.cols[from]], target };
}

function genVertical(rng: Rng): DrillScene | null {
  const r0 = rng.int(ROWS);
  const r1 = rng.int(ROWS);
  if (Math.abs(r1 - r0) < 2) return null;
  const word = rng.pick(SHORT);
  const c = 4 + rng.int(40);
  if (c + word.length > FIELD_COLS - 1) return null;
  const taken = [r0, r1];
  const spawn = [W(r1, c, word), ...decoys(rng, 2 + rng.int(2), taken)];
  return { spawn, cursor: [r0, c], target: 0 };
}

function genParagraph(rng: Rng): DrillScene | null {
  const k = 2 + rng.int(3);                 // lanes in the cursor's block
  const down = rng.next() < 0.5;
  const spawn: MissionSpawn[] = [];
  let cursor: [number, number];
  let t: number;
  if (down) {
    const a = rng.int(ROWS - k - 2);        // block a..a+k-1, blank, target
    t = a + k + 1;
    // Block words start at column 4 or later, so a linewise `d2j` over the
    // gap wastes more than the allowance and needs the charge a drill lacks.
    for (let r = a; r < a + k; r++) spawn.push(W(r, 4 + rng.int(5), rng.pick(SHORT)));
    cursor = [a, spawn[0][2]];
  } else {
    const b = k + 1 + rng.int(ROWS - k - 1); // block b-k+1..b, blank at b-k, target above it
    t = b - k - 1;
    for (let r = b - k + 1; r <= b; r++) spawn.push(W(r, 4 + rng.int(5), rng.pick(SHORT)));
    cursor = [b - k + 1, spawn[0][2]];
  }
  // A lane an absolute jump reaches in one key is not a paragraph lesson,
  // and a word the block already holds is a search lesson.
  if (t <= 0 || t >= ROWS - 1 || t === Math.floor((ROWS - 1) / 2)) return null;
  const used = spawn.map((z) => z[3]);
  const word = SHORT.find((w, i) => !used.includes(w) && i >= rng.int(SHORT.length)) ?? SHORT[0];
  if (used.includes(word)) return null;
  spawn.push(W(t, 0, word));
  return { spawn, cursor, target: spawn.length - 1 };
}

function genSearch(rng: Rng): DrillScene | null {
  const word = rng.pick(SHORT);
  const r0 = rng.int(ROWS);
  const r1 = rng.int(ROWS);
  if (Math.abs(r1 - r0) < 2) return null;
  if (r1 === 0 || r1 === ROWS - 1 || r1 === Math.floor((ROWS - 1) / 2)) return null;
  const c0 = 2 + rng.int(38);
  const c1 = 2 + rng.int(38);
  if (Math.abs(c1 - c0) < 2) return null;
  const taken = [r0, r1];
  const spawn: MissionSpawn[] = [W(r0, c0, word), W(r1, c1, word)];
  if (rng.next() < 0.3) {
    const r2 = otherRow(rng, taken);
    if (r2 >= 0) { taken.push(r2); spawn.push(W(r2, 2 + rng.int(38), word)); }
  }
  spawn.push(...decoys(rng, 2 + rng.int(2), taken, [word]));
  return { spawn, cursor: [r0, c0], target: 1 };
}

function genArmored(rng: Rng, wraps: ReadonlyArray<readonly [string, string]>): DrillScene | null {
  const [a, b] = rng.pick(wraps);
  const word = rng.pick(SHORT);
  const text = a + word + b;
  const r = rng.int(ROWS);
  const c = 2 + rng.int(40);
  if (c + text.length > FIELD_COLS - 1) return null;
  const taken = [r];
  const spawn: MissionSpawn[] = [W(r, c, text, 'armored')];
  // A second shell of another kind, so the drill is about reading the shell.
  const [a2, b2] = rng.pick(wraps);
  const r2 = otherRow(rng, taken);
  if (r2 >= 0) { taken.push(r2); spawn.push(W(r2, 2 + rng.int(36), a2 + rng.pick(SHORT) + b2, 'armored')); }
  spawn.push(...decoys(rng, 1 + rng.int(2), taken));
  const inside = rng.next() < 0.6;
  const cursor: [number, number] = inside
    ? [r, c + 1 + rng.int(word.length)]
    : [(() => { const o = otherRow(rng, taken); return o < 0 ? r : o; })(), c + 1];
  if (!inside && cursor[0] === r) return null;
  return { spawn, cursor, target: 0 };
}

function genWordObjects(rng: Rng): DrillScene | null {
  const row = rng.int(ROWS);
  const n = 2 + rng.int(2);
  const words = pickWords(rng, n, MID);
  if (words.length < n) return null;
  const gaps = words.map(() => 3 + rng.int(4));
  const built = lane(row, 1 + rng.int(4), words, gaps);
  if (!built) return null;
  const target = rng.int(n);
  const inside = built.cols[target] + 1 + rng.int(words[target].length - 1);
  return { spawn: built.spawn, cursor: [row, inside], target };
}

function genCounts(rng: Rng): DrillScene | null {
  const variant = rng.int(3);
  if (variant === 0) {
    // Adjacent words, one space apart, then a far one so no sweep is free.
    const row = rng.int(ROWS);
    const n = 3;                              // `d3e`: the count the oracle knows
    const words = pickWords(rng, n + 1, SHORT);
    if (words.length < n + 1) return null;
    const gaps = words.map((_, i) => (i === n - 1 ? 4 + rng.int(3) : 1));
    const built = lane(row, 1 + rng.int(4), words, gaps);
    if (!built) return null;
    return { spawn: built.spawn, cursor: [row, built.cols[0]], target: n - 1 };
  }
  if (variant === 1) {
    // Stacked lanes from column 0: one counted linewise cut takes them all.
    const n = 2 + rng.int(2);
    const r = rng.int(ROWS - n);
    // The target lane must not be one `M`, `G` or `H` reaches in a key.
    if (r + n === Math.floor((ROWS - 1) / 2) || r + n === ROWS - 1) return null;
    const words = pickWords(rng, n + 1, SHORT);
    if (words.length < n + 1) return null;
    const spawn: MissionSpawn[] = [];
    for (let i = 0; i <= n; i++) spawn.push(W(r + i, 0, words[i]));
    return { spawn, cursor: [r, 0], target: n };
  }
  // Crawlers shoulder to shoulder: `3x` is three kills for two keys. Four of
  // them, the third the target, so neither `$` nor `e` reaches it in one.
  const row = rng.int(ROWS);
  const c = 2 + rng.int(40);
  const letters = pickWords(rng, 4, ['z', 'x', 'o', 'c', 'r', 'e', 'w', 'm', 'n', 'v', 's', 'g']);
  if (letters.length < 4) return null;
  const spawn: MissionSpawn[] = letters.map((ch, i) => W(row, c + i, ch, 'crawler'));
  return { spawn, cursor: [row, c], target: 2 };
}

// ---------------------------------------------------------------- placement

/** How far the crosshair starts from the order: a counted motion territory. */
const FAR_ROWS = 3;
const FAR_COLS = 8;

function genPlacement(rng: Rng): DrillScene | null {
  const item = rng.pick<TrapKind>(['fence', 'minefield', 'tripwire']);
  let order: PlacementOrder;
  if (item === 'fence') {
    const lanes = 2 + rng.int(4);
    const row0 = rng.int(ROWS - lanes + 1);
    const col = 4 + rng.int(44);
    order = { item, row0, row1: row0 + lanes - 1, col0: col, col1: col };
  } else if (item === 'minefield') {
    const cols = 5 + rng.int(16);
    const col0 = 2 + rng.int(FIELD_COLS - 2 - cols);
    const row = rng.int(ROWS);
    order = { item, row0: row, row1: row, col0, col1: col0 + cols - 1 };
  } else {
    const row = rng.int(ROWS);
    const col = 4 + rng.int(44);
    order = { item, row0: row, row1: row, col0: col, col1: col };
  }
  for (let i = 0; i < 8; i++) {
    const row = rng.int(ROWS);
    const col = rng.int(FIELD_COLS);
    if (Math.abs(row - order.row0) >= FAR_ROWS && Math.abs(col - order.col0) >= FAR_COLS) {
      return { spawn: [], cursor: [row, col], target: -1, order };
    }
  }
  return null;
}

/** `fence  lanes 3..5  col 30`, the order as the strip and `text()` print it. */
export function orderText(o: PlacementOrder): string {
  const lanes = o.row0 === o.row1 ? `lane ${o.row0 + 1}` : `lanes ${o.row0 + 1}..${o.row1 + 1}`;
  const cols = o.col0 === o.col1 ? `col ${o.col0}` : `cols ${o.col0}..${o.col1}`;
  return `${o.item}  ${lanes}  ${cols}`;
}

/** An exact match: the same trap over exactly the ordered span. */
export function orderHit(o: PlacementOrder, t: Trap): boolean {
  return t.kind === o.item && t.row0 === o.row0 && t.row1 === o.row1 && t.col0 === o.col0 && t.col1 === o.col1;
}

/**
 * The cheapest keystrokes that fill the order from `cursor`: reach one end,
 * `<CR>` to anchor, reach the other end, `<CR>` to plant - either end first,
 * whichever is shorter. Computed over the real survey grid with the oracle's
 * own motion set, so a `5j` beats five `j`s here exactly as it does in play.
 * `cost` counts tokens, `<CR>` as one. PERFECT is `spent <= cost` (D9).
 */
export function cheapestPlacement(o: PlacementOrder, cursor: Cursor): { keys: string; cost: number } {
  const buf = surveyBuffer();
  const a: Cursor = { row: o.row0, col: o.col0 };
  const b: Cursor = o.item === 'fence' ? { row: o.row1, col: o.col0 } : { row: o.row0, col: o.col1 };
  const plans: Array<[Cursor, Cursor | null]> = o.item === 'tripwire' ? [[a, null]] : [[a, b], [b, a]];
  let best: { keys: string; cost: number } | null = null;
  for (const [first, second] of plans) {
    const k1 = moveKeys(buf, cursor, first);
    if (k1 === null) continue;
    let keys = `${k1}<CR>`;
    if (second) {
      const k2 = moveKeys(buf, first, second);
      if (k2 === null) continue;
      keys += `${k2}<CR>`;
    }
    const cost = splitKeys(keys).length;
    if (!best || cost < best.cost || (cost === best.cost && keys < best.keys)) best = { keys, cost };
  }
  return best ?? { keys: '', cost: Infinity };
}

// ---------------------------------------------------------------- fixtures

const F = (spawn: MissionSpawn[], cursor: [number, number], target: number): DrillScene =>
  ({ spawn, cursor, target });
const ORDER = (cursor: [number, number], order: PlacementOrder): DrillScene =>
  ({ spawn: [], cursor, target: -1, order });

// ---------------------------------------------------------------- the table

/**
 * Curriculum order (D2, D7): boot camp's two, then the syllabus sections. The
 * coach breaks ties by this order, and the drills screen lists it this way.
 */
export const FAMILIES: readonly DrillFamily[] = [
  {
    id: 'counts', name: 'counts', keys: ['d3w', '3x', 'd2j'],
    tokens: [COUNT_TOKEN],
    mission: 'boot-count',
    blurb: 'one counted command, several of them gone',
    fixtures: [
      F([W(8, 2, 'gore'), W(8, 7, 'rot'), W(8, 11, 'husk'), W(8, 21, 'moan')], [8, 2], 2),
      F([W(4, 0, 'drag'), W(5, 0, 'limp'), W(6, 0, 'pale'), W(7, 0, 'bile')], [4, 0], 2),
      F([W(10, 20, 'z', 'crawler'), W(10, 21, 'c', 'crawler'), W(10, 22, 'o', 'crawler'), W(10, 23, 'r', 'crawler')], [10, 20], 2),
    ],
    generate: genCounts,
    verify: countedOpVerify,
  },
  {
    id: 'placement', name: 'placement', keys: ['<CR>', '2j', '<CR>'],
    tokens: [],
    mission: 'boot-trap',
    blurb: 'anchor, count the lanes, plant. the span is the score',
    fixtures: [
      ORDER([2, 4], { item: 'fence', row0: 8, row1: 10, col0: 30, col1: 30 }),
      ORDER([14, 40], { item: 'minefield', row0: 3, row1: 3, col0: 10, col1: 24 }),
      ORDER([0, 0], { item: 'tripwire', row0: 12, row1: 12, col0: 40, col1: 40 }),
    ],
    generate: genPlacement,
    rankAs: 'counts',
  },
  {
    id: 'line-ends', name: 'line ends', keys: ['0', '^', '$'],
    tokens: ['0', '^', '_', '$'],
    mission: 'ess-ends',
    blurb: 'the far end of the lane is one key away',
    fixtures: [
      F([W(6, 2, 'gore'), W(6, 10, 'rot'), W(6, 18, 'husk'), W(6, 26, 'moan')], [6, 10], 3),
      F([W(3, 0, 'pale'), W(3, 8, 'bile'), W(3, 16, 'drag')], [3, 16], 0),
      F([W(12, 3, 'limp'), W(12, 12, 'gnaw'), W(12, 22, 'maul'), W(12, 32, 'rot')], [12, 3], 3),
    ],
    generate: genLineEnds,
  },
  {
    id: 'find', name: 'find', keys: ['f', 't', ';'],
    tokens: ['f', 'F', 't', 'T', ';', ','],
    mission: 'ess-find',
    blurb: 'name the letter, land on the word',
    fixtures: [
      F([W(5, 2, 'gore'), W(5, 10, 'husk'), W(5, 18, 'moan'), W(5, 26, 'pale')], [5, 2], 2),
      F([W(9, 1, 'bile'), W(9, 8, 'drag'), W(9, 15, 'limp'), W(9, 24, 'gnaw')], [9, 24], 1),
      F([W(13, 3, 'maul'), W(13, 11, 'rot'), W(13, 20, 'zed', 'runner'), W(13, 30, 'husk')], [13, 3], 2),
    ],
    generate: genFind,
  },
  {
    id: 'vertical', name: 'vertical', keys: ['5j', '7G', 'M'],
    tokens: ['j', 'k', 'G', 'gg', 'H', 'M', 'L'],
    mission: 'vert-rel',
    blurb: 'count the lanes and move once',
    fixtures: [
      F([W(12, 14, 'gore'), W(3, 30, 'husk'), W(8, 6, 'moan')], [4, 14], 0),
      F([W(2, 20, 'pale'), W(9, 8, 'bile'), W(14, 36, 'drag')], [11, 20], 0),
      F([W(7, 24, 'limp'), W(1, 4, 'gnaw'), W(13, 40, 'maul')], [0, 24], 0),
    ],
    generate: genVertical,
    verify: verticalVerify,
  },
  {
    id: 'paragraph', name: 'paragraph', keys: ['}', '{'],
    tokens: ['{', '}'],
    mission: 'vert-para',
    blurb: 'the empty lane is a landmark. jump to it',
    fixtures: [
      F([W(2, 4, 'gore'), W(3, 6, 'husk'), W(4, 3, 'moan'), W(6, 0, 'pale')], [2, 4], 3),
      F([W(11, 5, 'bile'), W(12, 2, 'drag'), W(13, 7, 'limp'), W(14, 4, 'gnaw'), W(9, 0, 'maul')], [11, 5], 4),
      F([W(4, 4, 'rot'), W(5, 6, 'zed'), W(6, 5, 'bile'), W(8, 0, 'husk')], [4, 4], 3),
    ],
    generate: genParagraph,
  },
  {
    id: 'search', name: 'search', keys: ['*', '#', '/'],
    tokens: ['/', '*', '#', 'n'],
    mission: 'search-star',
    blurb: 'they travel in families. name one, hit the other',
    fixtures: [
      F([W(2, 4, 'rot'), W(13, 30, 'rot'), W(6, 10, 'gore')], [2, 4], 1),
      F([W(10, 20, 'husk'), W(3, 6, 'husk'), W(7, 30, 'moan'), W(12, 2, 'pale')], [10, 20], 1),
      F([W(5, 8, 'bile'), W(8, 20, 'bile'), W(14, 40, 'bile'), W(1, 30, 'drag')], [5, 8], 2),
    ],
    generate: genSearch,
  },
  {
    id: 'brackets', name: 'brackets', keys: ['di(', 'da[', 'ci{'],
    tokens: ['i(', 'a(', 'i[', 'a[', 'i{', 'a{', '%'],
    mission: 'br-di',
    blurb: 'plate on the chest. cut the inside out',
    fixtures: [
      F([W(6, 12, '(gore)', 'armored'), W(2, 30, '[rot]', 'armored'), W(10, 20, 'husk')], [6, 14], 0),
      F([W(3, 8, '{moan}', 'armored'), W(9, 24, '(pale)', 'armored')], [11, 9], 0),
      F([W(12, 30, '[bile]', 'armored'), W(5, 4, 'drag')], [12, 33], 0),
    ],
    generate: (rng) => genArmored(rng, WRAPS),
  },
  {
    id: 'quotes', name: 'quotes', keys: ['di"', "da'"],
    tokens: ['i"', 'a"', "i'", "a'"],
    mission: 'qu-di',
    blurb: 'same idea, thinner shell',
    fixtures: [
      F([W(6, 12, '"gore"', 'armored'), W(2, 30, "'rot'", 'armored'), W(10, 20, 'husk')], [6, 14], 0),
      F([W(3, 8, "'moan'", 'armored'), W(9, 24, '"pale"', 'armored')], [11, 9], 0),
      F([W(12, 30, '"bile"', 'armored'), W(5, 4, 'drag')], [12, 33], 0),
    ],
    generate: (rng) => genArmored(rng, QUOTES),
  },
  {
    id: 'word-objects', name: 'word objects', keys: ['diw', 'daw', 'ciw'],
    tokens: ['iw', 'aw'],
    mission: 'wd-di',
    blurb: 'stop aiming at the first letter',
    fixtures: [
      F([W(7, 4, 'shamble'), W(7, 16, 'wither')], [7, 7], 0),
      F([W(3, 2, 'marrow'), W(3, 12, 'corpse'), W(3, 24, 'sinew')], [3, 14], 1),
      F([W(11, 20, 'fester'), W(11, 30, 'ghoul')], [11, 33], 1),
    ],
    generate: genWordObjects,
  },
];

const BY_ID = new Map<string, DrillFamily>(FAMILIES.map((f) => [f.id, f]));
const BY_TOKEN = new Map<string, DrillFamily>();
for (const f of FAMILIES) for (const t of f.tokens) BY_TOKEN.set(t, f);

/** The family with this id, or undefined for a stale save key. */
export function familyById(id: string): DrillFamily | undefined { return BY_ID.get(id); }

/** The one family a ledger token belongs to, or undefined (`l`, `w`, `d`...). */
export function familyOf(token: string): DrillFamily | undefined { return BY_TOKEN.get(token); }

/** The curriculum section the family's mission sits under. */
export function familySection(f: DrillFamily): string {
  return MISSIONS[missionIndex(f.mission)]?.section ?? '';
}

/** The title of the mission that teaches the family. */
export function familyMissionTitle(f: DrillFamily): string {
  return MISSIONS[missionIndex(f.mission)]?.title ?? '';
}
