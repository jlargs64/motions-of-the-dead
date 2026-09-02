// Phase B - the warm-up. No clock, no barricade damage, no score pressure:
// just the five things you need before wave 1 stops being polite.
import type { ZombieKind } from '../core/types';

/** kind, lane, column, text, columns-per-second. */
export type TutorialSpawn = [ZombieKind, number, number, string, number];

export interface TutorialStep {
  title: string;
  keys: string[];
  hint: string;
  /** Every step stands up its own horde, so no step depends on the last. */
  spawn: TutorialSpawn[];
  /** reach = get the crosshair onto a zombie. clear = kill them all. */
  goal: 'reach' | 'clear';
  /** Show 1-based absolute lane numbers in the gutter, whatever the player's
   *  setting: `{n}G` only makes sense when the n is printed next to the lane. */
  absoluteGutter?: true;
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Take aim',
    keys: ['h', 'j', 'k', 'l'],
    hint: 'Move the crosshair onto the word.',
    spawn: [['walker', 8, 24, 'shamble', 0]],
    goal: 'reach',
  },
  {
    title: 'Fire',
    keys: ['d', 'w'],
    hint: 'dw deletes the word you are standing on.',
    spawn: [['walker', 8, 24, 'shamble', 0]],
    goal: 'clear',
  },
  {
    title: 'Stop walking',
    keys: ['w', 'b'],
    hint: 'w jumps a whole word east. b goes back.',
    spawn: [['walker', 8, 4, 'creep', 0], ['walker', 8, 16, 'moan', 0], ['walker', 8, 30, 'husk', 0]],
    goal: 'clear',
  },
  {
    title: 'Pick your lane',
    keys: ['7', 'G'],
    hint: '7G jumps to lane 7, onto its first zombie.',
    spawn: [['walker', 2, 12, 'gore', 0], ['walker', 6, 20, 'bile', 0], ['walker', 12, 8, 'rot', 0]],
    goal: 'clear',
    absoluteGutter: true,
  },
  {
    title: 'One character',
    keys: ['x'],
    hint: 'A crawler is one letter. x kills it. x also whittles.',
    spawn: [['crawler', 5, 14, 'z', 0], ['crawler', 10, 26, 'c', 0], ['walker', 7, 34, 'flesh', 0]],
    goal: 'clear',
  },
  {
    title: 'Count them',
    keys: ['d', '3', 'w'],
    hint: 'Three words, one command: d3w.',
    spawn: [['walker', 9, 10, 'drag', 0], ['walker', 9, 16, 'limp', 0], ['walker', 9, 22, 'pale', 0]],
    goal: 'clear',
  },
  {
    title: 'Now they move',
    keys: ['$'],
    hint: 'They walk now. $ finds the closest one.',
    spawn: [['walker', 4, 22, 'wither', 0.9], ['walker', 11, 18, 'marrow', 0.9], ['runner', 8, 10, 'dash', 1.6]],
    goal: 'clear',
  },
];

export const TUTORIAL_HOLD_MS = 900;
