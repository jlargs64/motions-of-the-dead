// FROZEN CONTRACT — Phase 0.
// GameState is read-only to every workstream except Phase B (sim), which owns
// the single `tick(dt)` entry point.
import type { Barricade, Buffer, Col, Cursor, MotionKind, Row, Zombie, ZombieKind } from './types';
import { makeBuffer } from './field';

/**
 * What rules the current run plays by. Additive (DECISIONS #56): the menu picks
 * a mode, the sim owns what it means. `survival` is the endless night; `mission`
 * is a scripted objective with a par (boot camp and the syllabus); `drill` is a
 * timed repetition of one motion.
 */
export type GameMode = 'survival' | 'mission' | 'drill';

export interface SpawnSpec {
  at: number;          // ms from wave start
  kind: ZombieKind;
  text: string;
  speed: number;
}

/**
 * The field as it stood at the first command after run start or after a kill:
 * what the *next* kill is judged against. Additive (DECISIONS #67) and inside
 * `SimState` rather than a private field on `Sim`, so `json()` stays a
 * complete snapshot and a replay cannot diverge on it.
 */
export interface JudgeAnchor {
  zombies: Zombie[];
  cursor: Cursor;
  charges: { dd: number; D: number };
  /** Keystrokes spent since the anchor was set, summed over complete commands. */
  keys: number;
  /** Zombie the anchoring `/ ? * #` landed on, or 0. Feeds CALLED SHOT. */
  searchTarget: number;
  /** An `f`/`F`/`t`/`T` was used somewhere in this sequence. Feeds SNIPE. */
  find: boolean;
}

/**
 * Every store item, by id. The *table* (names, blurbs, prices, caps) lives in
 * `src/sim/store.ts`; the id union lives here for the same reason `GameMode`
 * does - `SimState.purchases` is keyed by it, and `core` may not import `sim`
 * (DECISIONS #77).
 */
export type ItemId =
  | 'dd' | 'D' | 'bandolier' | 'whetstone' | 'repeater' | 'planks' | 'sandbags'
  | 'flare' | 'wire' | 'tripwire' | 'fence' | 'minefield' | 'spotter'
  | 'manifest' | 'secondwind';

/** Store order. `src/sim/store.ts` asserts `ITEMS` matches this, id for id. */
export const ITEM_IDS: readonly ItemId[] = [
  'dd', 'D', 'bandolier', 'whetstone', 'repeater', 'planks', 'sandbags',
  'flare', 'wire', 'tripwire', 'fence', 'minefield', 'spotter',
  'manifest', 'secondwind',
] as const;

/** Barbed wire is a lane bit, not a trap; the other three occupy ground. */
export type TrapKind = 'tripwire' | 'fence' | 'minefield';

/**
 * A planted trap. Rows and columns are inclusive spans: a tripwire is one
 * cell, a fence one column over `row0..row1`, a minefield one row over
 * `col0..col1`. `charges` is how many zombies it can still take.
 */
export interface Trap {
  id: number;
  kind: TrapKind;
  row0: Row; row1: Row;
  col0: Col; col1: Col;
  charges: number;
}

/**
 * The store's own cursor. `mode` is which context the keys mean something in:
 * `list` moves the selection, `place` moves the placement crosshair over the
 * survey grid. Both live in `SimState` because the list cursor decides what
 * `l` buys, which decides sim state (DECISIONS #77).
 */
export interface ShopState {
  cursor: number;
  mode: 'list' | 'place';
  item: ItemId | '';
  anchor: Cursor | null;
  place: Cursor;
}

/** Phase-B-owned runtime bookkeeping. Included in GameState so json() is a
 *  complete, replayable snapshot (see DECISIONS.md #6). */
export interface SimState {
  /** Which rule set this run is playing. Set only by start()/startMission(). */
  mode: GameMode;
  time: number;            // ms since run start
  waveTime: number;        // ms since current wave started spawning
  breather: number;        // ms left of the between-wave card, 0 while fighting
  spawnQueue: SpawnSpec[]; // not-yet-spawned zombies for this wave
  spawnedThisWave: number;
  resolvedThisWave: number; // killed or through
  killsThisWave: number;    // resolved by the player, not by the wall
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
  // ---- missions (DECISIONS #91). These replaced the warm-up's `tutorial`,
  // `tutorialHold` and `tutorialEscaped`; the shape is the same idea with a
  // beat and a keystroke count added, so `json()` stays a complete snapshot.
  /** Index into MISSIONS, or -1 when not in one. */
  mission: number;
  /** Which beat: `try` is the scene, `done` waits for a key. */
  missionBeat: 'try' | 'done';
  /** ms of the GOOD flash between the goal being met and DONE. */
  missionHold: number;
  /** Keystrokes fed during TRY, reset on retry. Judged against par at DONE. */
  missionKeys: number;
  /** A zombie walked past you, so the beat restarts once the field empties. */
  missionEscaped: boolean;
  /** What the next kill is judged against, or null between anchor and kill. */
  judge: JudgeAnchor | null;

  // ---- the survival store (DECISIONS #77). All additive, all defaulted in
  // `createState`, so `json()` stays a complete snapshot and a replay cannot
  // diverge on any of it.
  /** The store's cursor and placement crosshair. */
  shop: ShopState;
  /** Planted traps. They persist across nights until their charges are spent. */
  traps: Trap[];
  nextTrapId: number;
  /** Ceiling on each charge in survival, raised by Bandolier. */
  chargeCap: { dd: number; D: number };
  /** Owned counts this run, for the card, `text()` and the per-item caps. */
  purchases: Record<ItemId, number>;
  /** Whetstone: extra waste cells allowed, for the night it was bought for. */
  wasteBonus: number;
  /** Flare: the next wave spawns at 70% speed. */
  flare: boolean;
  /** Barbed wire, as a bitmask of lanes. One hold each, then it is gone. */
  wireLanes: number;
  /** Spotter: kills of oracle hint remaining. */
  spotter: number;
  /** Manifest: the next night's preview, unlocked for this store visit. */
  manifest: boolean;
  /** Second Wind: one revive banked. */
  secondWind: boolean;
  /** Repeater: `.` commands that spend no charge. */
  freeRepeat: number;
}

export interface GameState {
  buffer: Buffer;
  cursor: Cursor;
  barricade: Barricade;
  wave: number;
  score: number;
  /**
   * The run wallet the survival store spends. Earned per kill and per medal,
   * zeroed at run start, and written only by `src/sim` (DECISIONS #67). It is
   * not score: `score` is the record, `supplies` is the money.
   */
  supplies: number;
  combo: number;
  charges: { dd: number; D: number };
  // `menu` and `shop` are additive (DECISIONS #56). `title` is kept as a
  // synonym of `menu` so old fixtures and hand-set states still render.
  phase: 'title' | 'menu' | 'playing' | 'dead' | 'stats' | 'shop';
  rngSeed: number;
  sim: SimState;
}

export const BARRICADE_MAX = 100;

/** What a run starts with, and what `chargeCap` starts at in survival. */
export const CHARGES_DD = 2;
export const CHARGES_D = 3;

/** A store cursor at rest: the top of the list, nothing being placed. */
export function freshShop(): ShopState {
  return { cursor: 0, mode: 'list', item: '', anchor: null, place: { row: 0, col: 0 } };
}

/** Every id at zero, so `json()` is a complete snapshot from frame one. */
export function freshPurchases(): Record<ItemId, number> {
  const out = {} as Record<ItemId, number>;
  for (const id of ITEM_IDS) out[id] = 0;
  return out;
}

export function createState(seed: number): GameState {
  return {
    buffer: makeBuffer(),
    cursor: { row: 0, col: 0 },
    barricade: { hp: BARRICADE_MAX, maxHp: BARRICADE_MAX },
    wave: 0,
    score: 0,
    supplies: 0,
    combo: 0,
    charges: { dd: CHARGES_DD, D: CHARGES_D },
    phase: 'menu',
    rngSeed: seed >>> 0,
    sim: {
      mode: 'survival',
      time: 0, waveTime: 0, breather: 0, spawnQueue: [], spawnedThisWave: 0,
      resolvedThisWave: 0, killsThisWave: 0, waveSize: 0, nextZombieId: 1, lastKillAt: -1e9,
      longestCombo: 0, kills: 0, overkills: 0, commands: 0, keystrokes: 0,
      waveStartedAt: 0, unlocks: [], rngState: 0, flashUntil: 0, lockId: 0, lockOffset: 0,
      mission: -1, missionBeat: 'try', missionHold: 0, missionKeys: 0, missionEscaped: false,
      judge: null,
      shop: freshShop(),
      traps: [], nextTrapId: 1,
      chargeCap: { dd: CHARGES_DD, D: CHARGES_D },
      purchases: freshPurchases(),
      wasteBonus: 0, flare: false, wireLanes: 0, spotter: 0,
      manifest: false, secondWind: false, freeRepeat: 0,
    },
  };
}
