// FROZEN CONTRACT — Phase 0.
// GameState is read-only to every workstream except Phase B (sim), which owns
// the single `tick(dt)` entry point.
import type { Barricade, Buffer, Cursor, MotionKind, ZombieKind } from './types';
import { makeBuffer } from './field';

export interface SpawnSpec {
  at: number;          // ms from wave start
  kind: ZombieKind;
  text: string;
  speed: number;
}

/** Phase-B-owned runtime bookkeeping. Included in GameState so json() is a
 *  complete, replayable snapshot (see DECISIONS.md #6). */
export interface SimState {
  time: number;            // ms since run start
  waveTime: number;        // ms since current wave started spawning
  breather: number;        // ms left of the between-wave card, 0 while fighting
  spawnQueue: SpawnSpec[]; // not-yet-spawned zombies for this wave
  spawnedThisWave: number;
  resolvedThisWave: number; // killed or through
  waveSize: number;
  nextZombieId: number;
  lastKillAt: number;      // ms
  longestCombo: number;
  kills: number;
  overkills: number;
  commands: number;        // complete commands emitted
  keystrokes: number;      // raw keys fed
  waveStartedAt: number;   // ms, for wave_clear timing
  unlocks: MotionKind[];   // motions the current wave demands
  rngState: number;
  flashUntil: number;      // ms; set on an unknown key
  /** Target lock: the zombie the crosshair is riding, and where on it. */
  lockId: number;
  lockOffset: number;
  /** Warm-up: index into TUTORIAL, or -1 when not in it. */
  tutorial: number;
  tutorialHold: number;
}

export interface GameState {
  buffer: Buffer;
  cursor: Cursor;
  barricade: Barricade;
  wave: number;
  score: number;
  combo: number;
  charges: { dd: number; D: number };
  phase: 'title' | 'playing' | 'dead' | 'stats';
  rngSeed: number;
  sim: SimState;
}

export const BARRICADE_MAX = 100;

export function createState(seed: number): GameState {
  return {
    buffer: makeBuffer(),
    cursor: { row: 0, col: 0 },
    barricade: { hp: BARRICADE_MAX, maxHp: BARRICADE_MAX },
    wave: 0,
    score: 0,
    combo: 0,
    charges: { dd: 2, D: 3 },
    phase: 'title',
    rngSeed: seed >>> 0,
    sim: {
      time: 0, waveTime: 0, breather: 0, spawnQueue: [], spawnedThisWave: 0,
      resolvedThisWave: 0, waveSize: 0, nextZombieId: 1, lastKillAt: -1e9,
      longestCombo: 0, kills: 0, overkills: 0, commands: 0, keystrokes: 0,
      waveStartedAt: 0, unlocks: [], rngState: 0, flashUntil: 0, lockId: 0, lockOffset: 0, tutorial: -1, tutorialHold: 0,
    },
  };
}
