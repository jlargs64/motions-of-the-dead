// Phase B - the missions. Boot camp (the old warm-up) plus one mission per
// lesson of the survival curriculum. Every mission is a scripted scene with no
// spawn clock, an invulnerable wall and a par the oracle computes, so a lesson
// can be practised on its own and as often as you like (DECISIONS #91).
import type { ZombieKind } from '../core/types';
import type { ItemId } from '../core/state';
import { LESSON_COUNT, waveDef } from './waves';

/** kind, lane, column, text, columns-per-second. */
export type MissionSpawn = [ZombieKind, number, number, string, number];
/** @deprecated The warm-up's name for `MissionSpawn`. */
export type TutorialSpawn = MissionSpawn;

/**
 * The mission select screen's demo: a pane-sized scene and the keystrokes that
 * solve it. Fed one key at a time through the real Vim engine, so what the
 * player watches is the game playing itself, not an animation.
 */
export interface DemoScript {
  /** Keys in the engine's notation (`<Esc>`, `<CR>` for specials). */
  keys: string;
  /** Every column here MUST be under DEMO_COLS: the pane is narrow. */
  spawn: MissionSpawn[];
  /** [lane, column] the ghost crosshair starts on. */
  cursor: [number, number];
  /**
   * What the *pane* proves, when that is not the mission's own goal. The pane
   * has no store and never enters placement, so a `plant` mission's demo shows
   * the counted motion the plant is made of and says `clear` here - the pane
   * teaches the keystroke, not the scene.
   */
  goal?: 'reach' | 'clear';
}

export type MissionGoal = 'reach' | 'clear' | 'plant';

export interface Mission {
  /** Stable, persisted: the key under `save.missions`. */
  id: string;
  /** `Boot camp`, or the CURRICULUM section this lesson belongs to. */
  section: string;
  title: string;
  /** Keycaps shown on the strip and lit by the demo. */
  keys: string[];
  /** One ASCII line. Fits the strip (49 cells) and wraps into the pane. */
  hint: string;
  /** Every mission stands up its own horde, so no mission depends on the last. */
  spawn: MissionSpawn[];
  /** [lane, column] the crosshair starts on for TRY. */
  start: [number, number];
  /**
   * reach = get the crosshair onto a zombie. clear = kill them all.
   * plant = put a trap of `plant.item` down, spanning `plant.lanes` lanes.
   */
  goal: MissionGoal;
  /** For a `plant` mission: what to arm placement mode with, and how big the
   *  span has to be before the mission counts as done. */
  plant?: { item: ItemId; lanes: number };
  /**
   * Force a gutter mode for the length of this mission, whatever the player
   * has set - a counted lane change is unreadable unless the count is printed
   * next to the lane it belongs to. Ignored when the player has the gutter
   * off entirely; that is their call to make.
   */
  gutter?: 'absolute' | 'relative';
  /** What the select screen's right pane plays on a loop. Deliberately
   *  simpler than the mission: it teaches the keystroke, not the scene. */
  demo: DemoScript;
  /** 1-based CURRICULUM index, for the wave-card pointer. Boot camp has none. */
  lesson?: number;
  /**
   * An explicit par, where the oracle cannot judge the lesson: the search
   * lessons teach `/`, `n` and `*`, which `optimalKill` does not model, so
   * the oracle's par would reward not using them. Everything else is computed.
   */
  par?: number;
}

/** Columns the demo pane can show. Every demo scene fits inside this. */
export const DEMO_COLS = 19;
/** Sim time between two demo keystrokes. Slow enough to read a command form. */
export const DEMO_KEY_MS = 280;
/** How long the finished scene is held before the demo starts over. */
export const DEMO_LOOP_MS = 1200;
/** The GOOD flash between the goal being met and the DONE strip. */
export const MISSION_HOLD_MS = 900;

/**
 * What a `plant` mission puts in the wallet. Missions have no economy - the
 * lesson is the motion, not the money - so it is simply enough for any span.
 */
export const MISSION_SUPPLIES = 9999;

/**
 * Stars for a cleared mission: at or under par is three, within half again is
 * two, anything else that finished is one. Ratios round up to whole keys.
 */
export function starsFor(keys: number, par: number): 1 | 2 | 3 {
  if (keys <= par) return 3;
  if (keys <= Math.ceil(par * 1.5)) return 2;
  return 1;
}

// ------------------------------------------------------------------ boot camp
// The warm-up, verbatim (DECISIONS R12, #65, #85). Every scene starts the
// crosshair on lane 8 at the western edge.

const BOOT = 'Boot camp';
const WEST: [number, number] = [8, 0];

const BOOT_CAMP: Mission[] = [
  {
    id: 'boot-aim', section: BOOT,
    title: 'Take aim',
    keys: ['h', 'j', 'k', 'l'],
    hint: 'Move the crosshair onto the word.',
    spawn: [['walker', 8, 24, 'shamble', 0]],
    start: WEST,
    goal: 'reach',
    // Walks the crosshair around all four directions before landing on it.
    demo: { keys: 'lkhhhjj', spawn: [['walker', 8, 4, 'shamble', 0]], cursor: [7, 6] },
  },
  {
    id: 'boot-fire', section: BOOT,
    title: 'Fire',
    keys: ['d', 'w'],
    hint: 'dw deletes the word you are standing on.',
    spawn: [['walker', 8, 24, 'shamble', 0]],
    start: WEST,
    goal: 'clear',
    demo: { keys: 'dw', spawn: [['walker', 8, 4, 'shamble', 0]], cursor: [8, 4] },
  },
  {
    id: 'boot-words', section: BOOT,
    title: 'Stop walking',
    keys: ['w', 'b'],
    hint: 'w jumps a whole word east. b goes back.',
    spawn: [['walker', 8, 4, 'creep', 0], ['walker', 8, 16, 'moan', 0], ['walker', 8, 30, 'husk', 0]],
    start: WEST,
    goal: 'clear',
    // Hop east with w, cut, hop again, then b back to the one behind you.
    demo: {
      keys: 'wdwwdwbdw',
      spawn: [['walker', 8, 0, 'creep', 0], ['walker', 8, 6, 'moan', 0], ['walker', 8, 11, 'husk', 0]],
      cursor: [8, 0],
    },
  },
  {
    // `{n}G` used to be the lesson here and it was the wrong one: a zombie's
    // absolute lane number is random noise, and the gutter the player actually
    // runs is relative - which prints the count for j and k, and nothing you
    // could feed to G. Counted lane changes are the motion this game wants
    // (DECISIONS #65).
    id: 'boot-lanes', section: BOOT,
    title: 'Change lanes',
    keys: ['3', 'j', 'k'],
    hint: '3k up three lanes, 3j down. Read the gutter.',
    spawn: [['walker', 4, 14, 'gore', 0], ['walker', 7, 14, 'bile', 0], ['walker', 10, 14, 'rot', 0]],
    start: WEST,
    goal: 'clear',
    gutter: 'relative',
    // Every zombie sits in the same column, because j and k carry the column
    // with them: land on the lane and you have landed on the word.
    demo: {
      keys: 'dw3kdw6jdw',
      spawn: [['walker', 4, 6, 'gore', 0], ['walker', 7, 6, 'bile', 0], ['walker', 10, 6, 'rot', 0]],
      cursor: [7, 6],
    },
  },
  {
    id: 'boot-x', section: BOOT,
    title: 'One character',
    keys: ['x'],
    hint: 'A crawler is one letter. x kills it; x whittles.',
    spawn: [['crawler', 5, 14, 'z', 0], ['crawler', 10, 26, 'c', 0], ['walker', 7, 34, 'flesh', 0]],
    start: WEST,
    goal: 'clear',
    demo: {
      keys: 'x11Gx',
      spawn: [['crawler', 5, 4, 'z', 0], ['crawler', 10, 8, 'c', 0]],
      cursor: [5, 4],
    },
  },
  {
    id: 'boot-count', section: BOOT,
    title: 'Count them',
    keys: ['d', '3', 'w'],
    hint: 'Three words, one command: d3w.',
    spawn: [['walker', 9, 10, 'drag', 0], ['walker', 9, 16, 'limp', 0], ['walker', 9, 22, 'pale', 0]],
    start: WEST,
    goal: 'clear',
    // Three words, three keys. The whole point of the lesson, stated once.
    demo: {
      keys: 'd3w',
      spawn: [['walker', 8, 0, 'drag', 0], ['walker', 8, 6, 'limp', 0], ['walker', 8, 12, 'pale', 0]],
      cursor: [8, 0],
    },
  },
  {
    // The two ends of a lane, which is what the rotated field made the two
    // most useful horizontal motions in the game (DECISIONS R1): $ is whatever
    // is closest to the wall, 0 is whatever just walked on.
    id: 'boot-ends', section: BOOT,
    title: 'Both ends',
    keys: ['0', '$'],
    hint: 'They move now. $ is nearest, 0 the far end.',
    spawn: [
      ['walker', 4, 22, 'wither', 0.9], ['walker', 11, 18, 'marrow', 0.9],
      ['walker', 8, 2, 'sludge', 0.9], ['runner', 8, 14, 'dash', 1.6],
    ],
    start: WEST,
    goal: 'clear',
    // $ lands on the LAST character of the nearest one, so b walks back to its
    // start before the cut. The demo pane holds no clock, so nothing moves here.
    demo: {
      keys: '$bdw0dw',
      spawn: [['walker', 8, 0, 'creep', 0], ['runner', 8, 12, 'dash', 0]],
      cursor: [8, 6],
    },
  },
  {
    // The store's placement mode is the one context where a counted vertical
    // motion is the *only* way to do the thing - a three-lane fence cannot be
    // clicked out one lane at a time - so boot camp teaches it here rather
    // than leaving the strip's one line to do it (DECISIONS #85).
    id: 'boot-trap', section: BOOT,
    title: 'Set a trap',
    keys: ['3', 'G', '2', 'j'],
    hint: 'Enter anchors. Then 2j, then Enter again.',
    spawn: [['walker', 3, 6, 'creep', 0], ['walker', 5, 10, 'gnaw', 0]],
    start: WEST,
    goal: 'plant',
    plant: { item: 'fence', lanes: 3 },
    gutter: 'relative',
    // The pane has no store, so it shows the motion the plant is made of:
    // land on a lane with 3G, drop two more with 2j, cutting as it goes.
    demo: {
      keys: '3Gdw2jdw',
      spawn: [['walker', 2, 2, 'creep', 0], ['walker', 4, 2, 'gnaw', 0]],
      cursor: [0, 2],
      goal: 'clear',
    },
  },
];

// ------------------------------------------------------------------ lessons
// One per CURRICULUM entry. `section`, `title` and `keys` are read from
// `waveDef(n)` so the two tables cannot drift on wording; only the scene, the
// hint and the demo are authored here. Zombies stand still unless the lesson
// is about them moving, so par is the par of the scene as it spawns.

/** What is authored per lesson; the shared text comes from `waveDef`. */
interface LessonScene {
  id: string;
  hint: string;
  spawn: MissionSpawn[];
  start?: [number, number];
  goal?: MissionGoal;
  gutter?: 'absolute' | 'relative';
  demo: DemoScript;
  par?: number;
}

const W = (row: number, col: number, text: string, speed = 0): MissionSpawn =>
  ['walker', row, col, text, speed];
const A = (row: number, col: number, text: string): MissionSpawn => ['armored', row, col, text, 0];
const C = (row: number, col: number, text: string): MissionSpawn => ['crawler', row, col, text, 0];
const R = (row: number, col: number, text: string, speed = 0): MissionSpawn =>
  ['runner', row, col, text, speed];
const B = (row: number, col: number, text: string): MissionSpawn => ['bloater', row, col, text, 0];

const LESSONS: LessonScene[] = [
  // ---- Basic Vim ----------------------------------------------------------
  {
    id: 'basic-move',
    hint: 'k up, j down, l east: walk the crosshair onto it.',
    spawn: [W(6, 20, 'shamble')],
    start: [8, 16],
    goal: 'reach',
    demo: { keys: 'hjkkklll', spawn: [W(6, 8, 'rot')], cursor: [8, 6] },
  },
  {
    id: 'basic-words',
    hint: 'w jumps to the next word, b back, e to its end.',
    spawn: [W(8, 6, 'creep'), W(8, 14, 'moan'), W(8, 24, 'husk')],
    demo: {
      keys: 'wdwebdwbdw',
      spawn: [W(8, 0, 'creep'), W(8, 6, 'moan'), W(8, 11, 'husk')],
      cursor: [8, 0],
    },
  },
  {
    id: 'basic-x',
    hint: 'x kills a crawler. X takes the letter before you.',
    spawn: [C(6, 12, 'z'), C(9, 20, 'k'), C(12, 30, 'q')],
    // x on the crawler; then X eats the front of a word and x finishes it.
    demo: { keys: 'xfoXx', spawn: [C(8, 2, 'z'), W(8, 6, 'go')], cursor: [8, 2] },
  },
  // ---- Basic Operators ------------------------------------------------------
  {
    id: 'ops-dw',
    hint: 'Stand on the first letter. dw takes the word.',
    spawn: [W(8, 20, 'rot'), W(5, 30, 'gore'), W(11, 12, 'bile')],
    demo: { keys: 'dwwdw', spawn: [W(8, 0, 'rot'), W(8, 5, 'gore')], cursor: [8, 0] },
  },
  {
    id: 'ops-cw',
    hint: 'From the first letter, cw takes the whole word.',
    spawn: [W(7, 18, 'wither'), W(9, 26, 'marrow')],
    demo: { keys: 'cwwcw', spawn: [W(8, 0, 'wither'), W(8, 8, 'marrow')], cursor: [8, 0] },
  },
  {
    id: 'ops-dd',
    hint: 'dd: the lane. D: all east of you. A charge each.',
    spawn: [B(8, 10, 'putrescent'), W(8, 26, 'rot'), W(8, 34, 'gore'), W(5, 20, 'creep'), W(5, 30, 'husk')],
    demo: {
      keys: 'ddjD',
      spawn: [W(8, 0, 'putrid'), W(8, 8, 'rot'), W(9, 4, 'gore'), W(9, 10, 'bile')],
      cursor: [8, 0],
    },
  },
  {
    id: 'ops-dj',
    hint: 'dj takes this lane and the one below; dk, above.',
    spawn: [W(7, 14, 'creep'), W(8, 14, 'moan'), W(11, 20, 'rot'), W(12, 20, 'gore')],
    demo: {
      keys: 'djkdk',
      spawn: [W(8, 2, 'rot'), W(9, 2, 'gore'), W(6, 4, 'bile'), W(7, 4, 'pus')],
      cursor: [8, 0],
    },
  },
  {
    id: 'ops-review',
    hint: 'dw, cw, x on the crawler, D for the bloater.',
    spawn: [W(8, 12, 'rot'), W(6, 20, 'gore'), C(10, 30, 'z'), B(12, 8, 'putrescent')],
    demo: {
      keys: 'dwwcwjFzxjD',
      spawn: [W(8, 0, 'rot'), W(8, 6, 'gore'), C(9, 3, 'z'), W(10, 5, 'bile'), W(10, 11, 'pus')],
      cursor: [8, 0],
    },
  },
  // ---- Essential Motions -----------------------------------------------------
  {
    id: 'ess-WORD',
    hint: 'A WORD is any run of non-blanks. dW takes it all.',
    spawn: [W(8, 10, 'rot-gut'), W(8, 24, 'half-dead'), W(8, 40, 'un-dead')],
    demo: { keys: 'dWWEBdW', spawn: [W(8, 0, 'rot-gut'), W(8, 9, 'half-dead')], cursor: [8, 0] },
  },
  {
    id: 'ess-ends',
    hint: '$ is nearest the wall; 0 and _ go back west.',
    spawn: [W(8, 4, 'sludge'), W(8, 20, 'moan'), W(8, 40, 'wither')],
    start: [8, 14],
    demo: { keys: '$bdw0_dw', spawn: [W(8, 2, 'rot'), W(8, 12, 'gore')], cursor: [8, 7] },
  },
  {
    id: 'ess-find',
    hint: 'f jumps to a letter, ; repeats it, F looks back.',
    spawn: [R(8, 10, 'dash'), R(8, 22, 'drip'), R(8, 36, 'bolt')],
    demo: { keys: 'fd;dwFddw', spawn: [R(8, 3, 'dash'), R(8, 9, 'drip')], cursor: [8, 0] },
  },
  {
    id: 'ess-till',
    hint: 't stops one short. dtg cuts up to the next g.',
    spawn: [W(8, 8, 'gut'), W(8, 18, 'gore'), W(8, 30, 'gob')],
    // dtg takes the first word; ; repeats the till past the adjacent g and
    // takes the second; T backs onto the last one from the wall end.
    demo: { keys: 'dtgtgd;$T dw', spawn: [W(8, 0, 'gut'), W(8, 4, 'gore'), W(8, 9, 'gob')], cursor: [8, 0] },
  },
  {
    id: 'ess-review',
    hint: 'Every horizontal motion, then the operator.',
    spawn: [W(8, 6, 'rot-gut'), R(8, 20, 'dash'), W(8, 34, 'wither'), W(5, 12, 'creep')],
    demo: {
      keys: 'dWfgdtd$bdw',
      spawn: [W(8, 0, 'rot-gut'), W(8, 9, 'gob'), R(8, 14, 'dash')],
      cursor: [8, 0],
    },
  },
  // ---- Advanced Vertical Movement ----------------------------------------------
  {
    id: 'vert-rel',
    hint: 'They share a column. 5k up, then 10j down.',
    spawn: [W(3, 18, 'gore'), W(8, 18, 'bile'), W(13, 18, 'rot')],
    gutter: 'relative',
    demo: { keys: 'dw2kdw3jdw', spawn: [W(6, 4, 'gore'), W(8, 4, 'bile'), W(9, 4, 'rot')], cursor: [8, 4] },
  },
  {
    id: 'vert-abs',
    hint: 'gg is the top lane, G the bottom, 7G is lane 7.',
    spawn: [W(0, 10, 'rot'), W(15, 20, 'gore'), W(6, 30, 'bile')],
    gutter: 'absolute',
    demo: { keys: 'ggdwGdw7Gdw', spawn: [W(0, 6, 'rot'), W(15, 6, 'gore'), W(6, 6, 'bile')], cursor: [8, 0] },
  },
  {
    id: 'vert-para',
    hint: '} skips to the next empty lane, { back up.',
    spawn: [W(3, 12, 'rot'), W(4, 12, 'gore'), W(11, 20, 'bile'), W(12, 20, 'pus')],
    // From the blank lane above: } lands on the blank lane below the pair,
    // k_ onto the lower one; { climbs back over it, j_ onto the upper one.
    demo: { keys: '}k_dw{j_dw', spawn: [W(6, 2, 'rot'), W(7, 2, 'gore')], cursor: [5, 0] },
  },
  {
    id: 'vert-review',
    hint: 'H top, L bottom, G by number, } over the gaps.',
    spawn: [W(0, 8, 'rot'), W(15, 8, 'gore'), W(5, 20, 'bile'), W(6, 20, 'pus')],
    gutter: 'absolute',
    demo: {
      keys: 'H_dw}k_dwL_dw11G_dw',
      spawn: [W(0, 4, 'rot'), W(15, 4, 'gore'), W(6, 8, 'bile'), W(10, 3, 'pus')],
      cursor: [6, 0],
    },
  },
  // ---- Search ---------------------------------------------------------------------
  {
    id: 'search-slash',
    hint: '/gore<CR> finds it anywhere. ?rot<CR> looks back.',
    spawn: [W(3, 30, 'gore'), W(12, 10, 'rot'), W(7, 40, 'bile')],
    par: 21,
    demo: { keys: '/gore<CR>dw?rot<CR>dw', spawn: [W(6, 8, 'gore'), W(10, 3, 'rot')], cursor: [8, 0] },
  },
  {
    id: 'search-n',
    hint: '/z<CR> once. n is the next z, N the one before.',
    spawn: [C(4, 20, 'z'), C(9, 30, 'z'), C(13, 12, 'z')],
    par: 8,
    demo: { keys: '/z<CR>xnxNx', spawn: [C(8, 8, 'z'), C(9, 3, 'z'), C(7, 1, 'z')], cursor: [8, 5] },
  },
  {
    id: 'search-star',
    hint: '* jumps to the next same word, # to the previous.',
    spawn: [W(8, 10, 'rot'), W(4, 30, 'rot'), W(12, 22, 'rot'), W(6, 40, 'gore')],
    start: [8, 10],
    par: 14,
    demo: { keys: '**#dw0dwjfrdw', spawn: [W(8, 0, 'rot'), W(8, 6, 'rot'), W(9, 2, 'rot')], cursor: [8, 0] },
  },
  {
    id: 'search-review',
    hint: 'Name it with /, repeat with n, or * from on top.',
    spawn: [W(3, 20, 'gore'), W(10, 30, 'gore'), W(13, 8, 'rot'), W(6, 36, 'rot')],
    par: 21,
    // * from on top of a rot takes the other one; / names the gores and n
    // repeats it; the rot you started on is named last.
    demo: {
      keys: '*dw/gore<CR>dwndw/rot<CR>dw',
      spawn: [W(6, 4, 'gore'), W(9, 8, 'gore'), W(10, 1, 'rot'), W(7, 10, 'rot')],
      cursor: [7, 10],
    },
  },
  // ---- Text Objects: brackets --------------------------------------------------------
  {
    id: 'br-di',
    hint: 'di{ guts the braces from anywhere inside them.',
    spawn: [A(8, 14, '{rot}'), A(5, 26, '{gore}')],
    demo: { keys: 'di{', spawn: [A(8, 2, '{rot}')], cursor: [8, 4] },
  },
  {
    id: 'br-da',
    hint: 'da{ takes the braces too.',
    spawn: [A(8, 14, '{rot}'), A(11, 20, '{bile}')],
    demo: { keys: 'da{', spawn: [A(8, 2, '{rot}')], cursor: [8, 2] },
  },
  {
    id: 'br-ca',
    hint: 'c cuts every object d does: ca( ci[ ca{ all work.',
    spawn: [A(8, 14, '(rot)'), A(5, 26, '[gore]'), A(11, 20, '{bile}')],
    demo: { keys: 'ca{fgca(', spawn: [A(8, 2, '{rot}'), A(8, 9, '(gore)')], cursor: [8, 3] },
  },
  {
    id: 'br-review',
    hint: 'Read the shell, pick the bracket. Closers work.',
    spawn: [A(8, 10, '(rot)'), A(4, 24, '[gore]'), A(12, 30, '{bile}'), A(6, 40, '(pus)')],
    demo: { keys: 'di(fgca[', spawn: [A(8, 1, '(rot)'), A(8, 8, '[gore]')], cursor: [8, 2] },
  },
  // ---- Text Objects: quotes ------------------------------------------------------------
  {
    id: 'qu-di',
    hint: 'di" empties the quotes from anywhere inside them.',
    spawn: [A(8, 14, '"rot"'), A(5, 26, '"gore"')],
    demo: { keys: 'di"', spawn: [A(8, 2, '"rot"')], cursor: [8, 3] },
  },
  {
    id: 'qu-da',
    hint: 'da" takes the quote marks with it.',
    spawn: [A(8, 14, '"rot"'), A(11, 20, '"bile"')],
    demo: { keys: 'da"', spawn: [A(8, 2, '"rot"')], cursor: [8, 2] },
  },
  {
    id: 'qu-ca',
    hint: "Single quotes work the same: ci' da' ca'.",
    spawn: [A(8, 14, "'rot'"), A(11, 20, "'bile'")],
    demo: { keys: "ca'", spawn: [A(8, 2, "'rot'")], cursor: [8, 3] },
  },
  {
    id: 'qu-review',
    hint: 'Quotes and brackets mixed. Read the shell first.',
    spawn: [A(8, 10, '"rot"'), A(4, 24, "'gore'"), A(12, 30, '(bile)')],
    demo: { keys: "di\"f'ca'", spawn: [A(8, 1, '"rot"'), A(8, 8, "'gore'")], cursor: [8, 2] },
  },
  // ---- Text Objects: words --------------------------------------------------------------
  {
    id: 'wd-di',
    hint: 'diw kills the word from anywhere inside it.',
    spawn: [W(8, 14, 'shamble'), W(5, 26, 'wither')],
    start: [8, 17],
    demo: { keys: 'diw', spawn: [W(8, 2, 'shamble')], cursor: [8, 5] },
  },
  {
    id: 'wd-da',
    hint: 'daw takes the space too, and it cuts armor.',
    spawn: [A(8, 14, '(rot)'), W(5, 26, 'wither')],
    demo: { keys: 'dawfgdaw', spawn: [W(8, 2, 'rot'), A(8, 7, '(gore)')], cursor: [8, 3] },
  },
  {
    id: 'wd-ci',
    hint: 'ciw: same span as diw, one habit for life.',
    spawn: [W(8, 14, 'shamble'), W(11, 26, 'marrow')],
    start: [8, 17],
    demo: { keys: 'ciw', spawn: [W(8, 2, 'shamble')], cursor: [8, 6] },
  },
  {
    id: 'wd-review',
    hint: 'All of it. diw and daw from wherever you stand.',
    spawn: [W(8, 10, 'shamble'), A(5, 24, '[gore]'), W(12, 30, 'wither'), B(3, 6, 'putrescent')],
    demo: { keys: 'diwfgdaw', spawn: [W(8, 2, 'rot'), A(8, 7, '(gore)')], cursor: [8, 3] },
  },
];

if (LESSONS.length !== LESSON_COUNT) {
  throw new Error(`missions: ${LESSONS.length} lesson scenes for ${LESSON_COUNT} lessons`);
}

const LESSON_MISSIONS: Mission[] = LESSONS.map((l, i) => {
  const def = waveDef(i + 1);
  return {
    id: l.id,
    section: def.section,
    title: def.title,
    keys: def.keys,
    hint: l.hint,
    spawn: l.spawn,
    start: l.start ?? WEST,
    goal: l.goal ?? 'clear',
    gutter: l.gutter,
    demo: l.demo,
    lesson: i + 1,
    par: l.par,
  };
});

/** Boot camp first, then the syllabus in curriculum order. */
export const MISSIONS: readonly Mission[] = [...BOOT_CAMP, ...LESSON_MISSIONS];

/** Section headings, in table order, each once. */
export const SECTIONS: readonly string[] = MISSIONS.reduce<string[]>((acc, m) => {
  if (acc[acc.length - 1] !== m.section) acc.push(m.section);
  return acc;
}, []);

const BY_ID = new Map<string, number>(MISSIONS.map((m, i) => [m.id, i]));

/** Index of the mission with this id, or -1. */
export function missionIndex(id: string): number { return BY_ID.get(id) ?? -1; }

/** The mission that teaches lesson `n` (1-based), if there is one. */
export function missionForLesson(n: number): Mission | undefined {
  return LESSON_MISSIONS[n - 1];
}

/** Index of the first mission in table order without stars, else 0. */
export function firstUnstarred(records: Readonly<Record<string, { stars: number }>>): number {
  for (let i = 0; i < MISSIONS.length; i++) {
    if ((records[MISSIONS[i].id]?.stars ?? 0) <= 0) return i;
  }
  return 0;
}

/**
 * The lesson missions the list dims: everything past the highest starred
 * lesson plus one. Boot camp never dims. Nothing is locked by this; it is
 * only ink (DECISIONS #91).
 */
export function dimmed(m: Mission, records: Readonly<Record<string, { stars: number }>>): boolean {
  if (m.lesson === undefined) return false;
  let top = 0;
  for (const l of LESSON_MISSIONS) {
    if ((records[l.id]?.stars ?? 0) > 0 && l.lesson! > top) top = l.lesson!;
  }
  return m.lesson > top + 1;
}
