// The versioned save blob: its shape, its defaults, and the coercion that
// turns anything at all — a partial object, a hand-edited file, a blob from a
// newer build — into a usable save without ever throwing.
//
// This module imports nothing. `src/save` must not reach into `src/sim`,
// `src/render` or `src/audio` (DECISIONS: sim isolation), so the two string
// unions the renderer also declares are restated here rather than imported.

export const SAVE_VERSION = 1;

/** Newest N runs kept in `lifetime.runs`. */
export const MAX_RUNS = 40;

export type SaveGore = 'off' | 'low' | 'full';
export type SaveLineNumbers = 'off' | 'absolute' | 'relative';

const GORE: SaveGore[] = ['off', 'low', 'full'];
const NUMS: SaveLineNumbers[] = ['off', 'absolute', 'relative'];

export interface MotionStat { used: number; kills: number }

export interface RunRecord {
  at: number; wave: number; score: number; kills: number; keystrokes: number; kpk: number;
}

export interface Lifetime {
  /** Per-token usage, keyed by the token as the Ledger writes it. */
  motions: Record<string, MotionStat>;
  /** Per-token "would have been optimal, never pressed it" counts. */
  missed: Record<string, number>;
  /** Newest last, at most MAX_RUNS. */
  runs: RunRecord[];
  highScore: number;
  /** Lifetime kills, summed at the end of each run. */
  kills: number;
  /** Filled by medals-and-wallet. */
  medals: Record<string, number>;
}

export interface MissionRecord {
  stars: number;
  /** Fewer is better; 0 means no record yet. */
  bestKeys: number;
}

export interface DrillRecord { best: number }

export interface SaveSettings {
  gore: SaveGore;
  lineNumbers: SaveLineNumbers;
  /** Filled by armory: slot -> cosmetic id. */
  equipped: Record<string, string>;
}

/**
 * A survival run put down mid-night to be picked up later (DECISIONS #96).
 * `state` is the sim's own `json()` snapshot, kept opaque here because
 * `src/save` may not import the sim; `progress` is the per-zombie fraction of
 * a column each had walked, which `json()` does not carry. `night` and
 * `score` are copied out so the menu can say what it is offering without
 * reaching into the snapshot.
 */
export interface SuspendedRun {
  at: number;
  night: number;
  score: number;
  state: Record<string, unknown>;
  progress: Record<string, number>;
}

export interface Save {
  version: number;
  /** Random 64-bit-ish hex, assigned once at creation. Identifies this save. */
  id: string;
  createdAt: number;
  updatedAt: number;
  lifetime: Lifetime;
  /** Filled by medals-and-wallet. */
  salvage: number;
  /** Filled by armory. */
  unlocks: string[];
  /** Filled by missions, keyed by mission id. */
  missions: Record<string, MissionRecord>;
  /** Filled by drills-and-coach, keyed by drill family. */
  drills: Record<string, DrillRecord>;
  settings: SaveSettings;
  /** Reserved for a later one-time purchase. Empty in version 1. */
  entitlements: Record<string, unknown>;
  /** The one run on hold, or null. Resuming it clears it. */
  suspended: SuspendedRun | null;
  /** Keys a newer build wrote that this one does not know. Preserved verbatim. */
  [extra: string]: unknown;
}

/** The top-level keys this build understands. Everything else is passed through. */
export const KNOWN_KEYS = [
  'version', 'id', 'createdAt', 'updatedAt', 'lifetime', 'salvage',
  'unlocks', 'missions', 'drills', 'settings', 'entitlements', 'suspended',
] as const;

// ---------------------------------------------------------------- coercion

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite number, floored to an integer, clamped at zero. Anything else -> 0. */
function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

/** A finite number kept as-is (kpk is fractional). Anything else -> 0. */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }

/** Random hex wide enough that two players never collide. */
export function newId(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return s;
}

export function coerceMotions(v: unknown): Record<string, MotionStat> {
  const out: Record<string, MotionStat> = {};
  if (!isObj(v)) return out;
  for (const [k, m] of Object.entries(v)) {
    if (!isObj(m)) continue;
    out[k] = { used: count(m.used), kills: count(m.kills) };
  }
  return out;
}

export function coerceCounters(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, n] of Object.entries(v)) out[k] = count(n);
  return out;
}

export function coerceRuns(v: unknown): RunRecord[] {
  if (!Array.isArray(v)) return [];
  const out: RunRecord[] = [];
  for (const r of v) {
    if (!isObj(r)) continue;
    out.push({
      at: count(r.at),
      wave: count(r.wave),
      score: count(r.score),
      kills: count(r.kills),
      keystrokes: count(r.keystrokes),
      kpk: num(r.kpk),
    });
  }
  return out.slice(-MAX_RUNS);
}

export function coerceLifetime(v: unknown): Lifetime {
  const d = isObj(v) ? v : {};
  return {
    motions: coerceMotions(d.motions),
    missed: coerceCounters(d.missed),
    runs: coerceRuns(d.runs),
    highScore: count(d.highScore),
    kills: count(d.kills),
    medals: coerceCounters(d.medals),
  };
}

export function coerceUnlocks(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const u of v) if (typeof u === 'string' && u !== '') seen.add(u);
  return [...seen];
}

export function coerceMissions(v: unknown): Record<string, MissionRecord> {
  const out: Record<string, MissionRecord> = {};
  if (!isObj(v)) return out;
  for (const [k, m] of Object.entries(v)) {
    if (!isObj(m)) continue;
    out[k] = { stars: count(m.stars), bestKeys: count(m.bestKeys) };
  }
  return out;
}

export function coerceDrills(v: unknown): Record<string, DrillRecord> {
  const out: Record<string, DrillRecord> = {};
  if (!isObj(v)) return out;
  for (const [k, d] of Object.entries(v)) {
    if (!isObj(d)) continue;
    out[k] = { best: count(d.best) };
  }
  return out;
}

export function coerceEquipped(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, id] of Object.entries(v)) if (typeof id === 'string' && id !== '') out[k] = id;
  return out;
}

export function coerceSettings(v: unknown): SaveSettings {
  const d = isObj(v) ? v : {};
  return {
    gore: GORE.includes(d.gore as SaveGore) ? d.gore as SaveGore : 'full',
    lineNumbers: NUMS.includes(d.lineNumbers as SaveLineNumbers)
      ? d.lineNumbers as SaveLineNumbers : 'relative',
    equipped: coerceEquipped(d.equipped),
  };
}

/**
 * A suspended run, or null for anything that is not one. The snapshot has to
 * look like a survival run in progress - `phase` playing or at the store,
 * `sim.mode` survival, a night of at least 1 - or the menu would offer a
 * resume that lands nowhere. Anything deeper is the sim's to reject.
 */
export function coerceSuspended(v: unknown): SuspendedRun | null {
  if (!isObj(v) || !isObj(v.state)) return null;
  const st = v.state;
  if (st.phase !== 'playing' && st.phase !== 'shop') return null;
  if (!isObj(st.sim) || st.sim.mode !== 'survival') return null;
  if (!isObj(st.buffer) || !Array.isArray(st.buffer.zombies)) return null;
  const night = count(v.night) || count(st.wave);
  if (night < 1) return null;
  const progress: Record<string, number> = {};
  if (isObj(v.progress)) {
    for (const [k, n] of Object.entries(v.progress)) if (typeof n === 'number' && Number.isFinite(n)) progress[k] = n;
  }
  return { at: count(v.at), night, score: count(v.score) || count(st.score), state: st, progress };
}

export function defaultSettings(): SaveSettings {
  return { gore: 'full', lineNumbers: 'relative', equipped: {} };
}

export function defaultSave(now = Date.now()): Save {
  return {
    version: SAVE_VERSION,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    lifetime: { motions: {}, missed: {}, runs: [], highScore: 0, kills: 0, medals: {} },
    salvage: 0,
    unlocks: [],
    missions: {},
    drills: {},
    settings: defaultSettings(),
    entitlements: {},
    suspended: null,
  };
}

/**
 * Anything -> a valid Save. Every field degrades to its default on its own, so
 * a partially corrupt blob loses only the corrupt field. Unknown top-level keys
 * are copied through untouched so a newer export round-trips through this build.
 */
export function coerceSave(v: unknown, now = Date.now()): Save {
  const d = isObj(v) ? v : {};
  const known = new Set<string>(KNOWN_KEYS);
  const version = typeof d.version === 'number' && Number.isFinite(d.version)
    ? Math.max(1, Math.floor(d.version)) : SAVE_VERSION;
  const createdAt = count(d.createdAt) || now;
  const out: Save = {
    version,
    id: str(d.id) || newId(),
    createdAt,
    updatedAt: count(d.updatedAt) || createdAt,
    lifetime: coerceLifetime(d.lifetime),
    salvage: count(d.salvage),
    unlocks: coerceUnlocks(d.unlocks),
    missions: coerceMissions(d.missions),
    drills: coerceDrills(d.drills),
    settings: coerceSettings(d.settings),
    entitlements: isObj(d.entitlements) ? { ...d.entitlements } : {},
    suspended: coerceSuspended(d.suspended),
  };
  for (const [k, val] of Object.entries(d)) if (!known.has(k)) out[k] = val;
  return out;
}
