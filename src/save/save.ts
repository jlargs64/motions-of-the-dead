// The one place player progress is read from and written to. Everything else —
// the Ledger, settings, and later medals, missions, drills and the armory —
// goes through `SaveStore`, so there is exactly one write path to swap out when
// a cloud store arrives.
//
// Nothing here throws. localStorage can be absent (Node harness), disabled
// (private window) or full (quota), and the game has to stay playable.
import {
  MAX_RUNS, SAVE_VERSION, coerceSave, coerceSettings, defaultSave,
} from './schema';
import type {
  DrillRecord, Lifetime, MissionRecord, MotionStat, RunRecord, Save, SuspendedRun,
} from './schema';

export const SAVE_KEY = 'motd.save';
export const LEGACY_LEDGER_KEY = 'motd.ledger';
export const LEGACY_SETTINGS_KEY = 'motd.settings';

export type MergeMode = 'merge' | 'replace';

// ---------------------------------------------------------------- storage

function readRaw(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}

/** True if the write landed. A false here is not an error the player can fix. */
function writeRaw(key: string, value: string): boolean {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}

export function persist(save: Save): boolean {
  try { return writeRaw(SAVE_KEY, JSON.stringify(save)); } catch { return false; }
}

// ---------------------------------------------------------------- migration

/**
 * Build a v1 blob out of `motd.ledger` and `motd.settings`. Returns null when
 * neither legacy key is present, which is the fresh-install case.
 *
 * The legacy keys are read, never written and never deleted: a rollback to the
 * previous build has to keep working (design D4).
 */
export function migrateLegacy(now = Date.now()): Save | null {
  const rawLedger = readRaw(LEGACY_LEDGER_KEY);
  const rawSettings = readRaw(LEGACY_SETTINGS_KEY);
  if (rawLedger === null && rawSettings === null) return null;

  const save = defaultSave(now);
  if (rawLedger !== null) {
    try {
      const d = JSON.parse(rawLedger) as unknown;
      const lifetime = coerceSave({ lifetime: d }).lifetime;
      save.lifetime = lifetime;
    } catch { /* unreadable legacy ledger: start the lifetime section empty */ }
  }
  if (rawSettings !== null) {
    try { save.settings = coerceSettings(JSON.parse(rawSettings)); } catch { /* defaults */ }
  }
  return save;
}

/**
 * Read the save. Migrates from the legacy keys on first run and writes the
 * result; on every later call the presence of `motd.save` is the marker that
 * migration already happened, so the legacy keys are not touched.
 */
export function load(now = Date.now()): Save {
  const raw = readRaw(SAVE_KEY);
  if (raw !== null) {
    try { return coerceSave(JSON.parse(raw), now); } catch { /* fall through and rebuild */ }
  }
  const save = migrateLegacy(now) ?? defaultSave(now);
  persist(save);
  return save;
}

// ---------------------------------------------------------------- the store

/**
 * The write path. `set()` mutates in memory and schedules one persist on the
 * next macrotask, because medals and drills will write several times a second
 * and localStorage writes are synchronous at 60 Hz (design D8).
 */
export class SaveStore {
  private save: Save;
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(initial?: Save) {
    this.save = initial ?? load();
  }

  get(): Save { return this.save; }

  /** Apply a mutation, stamp `updatedAt`, schedule a persist. */
  set(mutate: (s: Save) => void): void {
    mutate(this.save);
    this.save.updatedAt = Date.now();
    this.schedule();
  }

  /** Swap the whole blob, as import does. `updatedAt` is stamped the same way. */
  replace(save: Save): void {
    this.save = save;
    this.save.updatedAt = Date.now();
    this.schedule();
  }

  private schedule(): void {
    this.pending = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 0);
  }

  /** Write now if anything is pending. Synchronous, so a visibility handler can call it. */
  flush(): boolean {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending) return false;
    this.pending = false;
    persist(this.save);
    return true;
  }

  get dirty(): boolean { return this.pending; }
}

// ---------------------------------------------------------------- medals

/**
 * Add lifetime salvage. Medals pay it and nothing resets it - not a new run,
 * not a death - so this is the only write path (DECISIONS #72). Anything that
 * is not a positive finite number is ignored rather than corrupting the total.
 */
export function creditSalvage(store: SaveStore, n: number): void {
  if (!Number.isFinite(n)) return;
  const add = Math.floor(n);
  if (add <= 0) return;
  store.set((s) => { s.salvage += add; });
}

/** Count one earned medal into `lifetime.medals`, keyed by its name. */
export function countMedal(store: SaveStore, name: string): void {
  if (name === '') return;
  store.set((s) => {
    const m = s.lifetime.medals;
    m[name] = (m[name] ?? 0) + 1;
  });
}

// ---------------------------------------------------------------- missions

/**
 * Record a mission reaching DONE (DECISIONS #91). Improvements only: stars
 * never go down and `bestKeys` never goes up, so a worse repeat leaves the
 * record alone. A `bestKeys` of 0 is "no record yet".
 */
export function recordMission(store: SaveStore, id: string, keys: number, stars: number): void {
  if (id === '' || !Number.isFinite(keys) || !Number.isFinite(stars)) return;
  const k = Math.max(0, Math.floor(keys));
  const st = Math.max(0, Math.floor(stars));
  store.set((s) => {
    const rec = s.missions[id] ?? (s.missions[id] = { stars: 0, bestKeys: 0 });
    if (st > rec.stars) rec.stars = st;
    if (k > 0 && (rec.bestKeys === 0 || k < rec.bestKeys)) rec.bestKeys = k;
  });
}

// ---------------------------------------------------------------- suspend

/**
 * Put a survival run on hold (DECISIONS #96). There is one slot: a second
 * suspend replaces the first. `state` is the sim's `json()` and is copied, so
 * the live run can go on being mutated without touching what was saved; the
 * caller flushes, because this is the write the player is about to close the
 * tab on.
 */
export function suspendRun(
  store: SaveStore, state: { wave: number; score: number }, progress: Record<string, number>,
  now = Date.now(),
): SuspendedRun {
  const run: SuspendedRun = {
    at: now,
    night: Math.max(1, Math.floor(state.wave)),
    score: Math.max(0, Math.floor(state.score)),
    state: JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
    progress: { ...progress },
  };
  store.set((s) => { s.suspended = run; });
  return run;
}

/** The slot is emptied the moment a run is picked back up: no replaying a night. */
export function clearSuspended(store: SaveStore): void {
  if (store.get().suspended === null) return;
  store.set((s) => { s.suspended = null; });
}

// ---------------------------------------------------------------- drills

/** More kills wins; the same kills with more PERFECTs wins (drills-and-coach D5). */
export function beatsDrill(kills: number, perfect: number, rec: DrillRecord | undefined): boolean {
  if (!rec) return kills > 0 || perfect > 0;
  return kills > rec.best || (kills === rec.best && perfect > rec.perfect);
}

/**
 * Record a finished drill. Returns true when it was a new personal best and
 * the record was replaced; the caller pays the salvage exactly then. A result
 * that does not beat the stored best leaves the save untouched.
 */
export function recordDrill(store: SaveStore, family: string, kills: number, perfect: number): boolean {
  if (family === '' || !Number.isFinite(kills) || !Number.isFinite(perfect)) return false;
  const k = Math.max(0, Math.floor(kills));
  const p = Math.max(0, Math.floor(perfect));
  if (!beatsDrill(k, p, store.get().drills[family])) return false;
  store.set((s) => { s.drills[family] = { best: k, perfect: p }; });
  return true;
}

// ---------------------------------------------------------------- merge

function sumCounters(
  a: Record<string, number>, b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

function sumMotions(
  a: Record<string, MotionStat>, b: Record<string, MotionStat>,
): Record<string, MotionStat> {
  const out: Record<string, MotionStat> = {};
  for (const [k, m] of Object.entries(a)) out[k] = { used: m.used, kills: m.kills };
  for (const [k, m] of Object.entries(b)) {
    const cur = out[k] ?? (out[k] = { used: 0, kills: 0 });
    cur.used += m.used;
    cur.kills += m.kills;
  }
  return out;
}

/** Concatenate, dedupe on `at`, oldest first, newest MAX_RUNS kept. */
function mergeRuns(a: RunRecord[], b: RunRecord[]): RunRecord[] {
  const byAt = new Map<number, RunRecord>();
  for (const r of a) byAt.set(r.at, r);
  for (const r of b) if (!byAt.has(r.at)) byAt.set(r.at, r);
  const out = [...byAt.values()].sort((x, y) => x.at - y.at);
  return out.slice(-MAX_RUNS);
}

/** Fewer keystrokes is better, but 0 means "no record", not "perfect". */
function bestKeys(a: number, b: number): number {
  if (a <= 0) return Math.max(0, b);
  if (b <= 0) return a;
  return Math.min(a, b);
}

function mergeMissions(
  a: Record<string, MissionRecord>, b: Record<string, MissionRecord>,
): Record<string, MissionRecord> {
  const out: Record<string, MissionRecord> = {};
  for (const [k, m] of Object.entries(a)) out[k] = { stars: m.stars, bestKeys: m.bestKeys };
  for (const [k, m] of Object.entries(b)) {
    const cur = out[k];
    out[k] = cur
      ? { stars: Math.max(cur.stars, m.stars), bestKeys: bestKeys(cur.bestKeys, m.bestKeys) }
      : { stars: m.stars, bestKeys: m.bestKeys };
  }
  return out;
}

function mergeDrills(
  a: Record<string, DrillRecord>, b: Record<string, DrillRecord>,
): Record<string, DrillRecord> {
  const out: Record<string, DrillRecord> = {};
  for (const [k, d] of Object.entries(a)) out[k] = { best: d.best, perfect: d.perfect };
  for (const [k, d] of Object.entries(b)) {
    const cur = out[k];
    out[k] = !cur || beatsDrill(d.best, d.perfect, cur) ? { best: d.best, perfect: d.perfect } : cur;
  }
  return out;
}

function mergeLifetime(a: Lifetime, b: Lifetime): Lifetime {
  return {
    motions: sumMotions(a.motions, b.motions),
    missed: sumCounters(a.missed, b.missed),
    runs: mergeRuns(a.runs, b.runs),
    highScore: Math.max(a.highScore, b.highScore),
    kills: a.kills + b.kills,
    medals: sumCounters(a.medals, b.medals),
  };
}

/** Top-level keys neither this build nor the merge rules know about. */
function extraKeys(s: Save): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const known = new Set([
    'version', 'id', 'createdAt', 'updatedAt', 'lifetime', 'salvage',
    'unlocks', 'missions', 'drills', 'settings', 'entitlements', 'suspended',
  ]);
  for (const [k, v] of Object.entries(s)) if (!known.has(k)) out[k] = v;
  return out;
}

/**
 * Combine two saves. `merge` is additive and cannot lose progress: counters
 * sum, bests win, sets union, and the local settings and `id` stay put.
 * `replace` takes the incoming blob wholesale, keeping only the local `id`.
 */
export function merge(local: Save, incoming: Save, mode: MergeMode, now = Date.now()): Save {
  if (mode === 'replace') {
    return { ...incoming, id: local.id, updatedAt: now };
  }
  const unlocks = [...local.unlocks];
  for (const u of incoming.unlocks) if (!unlocks.includes(u)) unlocks.push(u);
  return {
    // A newer incoming build's unknown keys are worth keeping, but a local key
    // of the same name is the one this build has been writing.
    ...extraKeys(incoming),
    ...extraKeys(local),
    version: Math.max(local.version, SAVE_VERSION),
    id: local.id,
    createdAt: Math.min(local.createdAt, incoming.createdAt),
    updatedAt: now,
    lifetime: mergeLifetime(local.lifetime, incoming.lifetime),
    salvage: local.salvage + incoming.salvage,
    unlocks,
    missions: mergeMissions(local.missions, incoming.missions),
    drills: mergeDrills(local.drills, incoming.drills),
    settings: { ...local.settings, equipped: { ...local.settings.equipped } },
    entitlements: { ...incoming.entitlements, ...local.entitlements },
    // A run on hold here is the one you were playing; a run on hold in the
    // import is worth carrying over only when this browser has none.
    suspended: local.suspended ?? incoming.suspended,
  };
}

// ---------------------------------------------------------------- transfer

/** Vim's own error numbers, so the save screen reads like the death screen. */
export const E482_CLIPBOARD = "E482: Can't create file (clipboard blocked)";
export const E484_OPEN = "E484: Can't open file";
export const E485_READ = "E485: Can't read file";
export const NEWER_WARNING = 'newer save format, some fields may be ignored';
export const OWN_BACKUP = 'this is your own backup';

/** JSON with every object's keys sorted, recursively. The checksum's input. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`);
  }
  return `{${parts.join(',')}}`;
}

/** 32-bit FNV-1a, as 8 lowercase hex digits. Detects corruption, not cheating. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    // Codepoints above U+00FF still contribute their high byte.
    const hi = s.charCodeAt(i) >>> 8;
    if (hi !== 0) { h ^= hi; h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The save plus `exportedAt` and a `checksum` over everything else. */
export function exportSave(save: Save, now = Date.now()): string {
  const body = { ...save, exportedAt: now };
  delete (body as Record<string, unknown>).checksum;
  const checksum = fnv1a(canonicalJson(body));
  return JSON.stringify({ ...body, checksum }, null, 2);
}

/** `motd-save-2026-09-03-1412.json` — date and time, so two exports a day never collide. */
export function exportFilename(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `motd-save-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
    + `-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

export interface ImportSummary {
  highScore: number;
  kills: number;
  unlocks: number;
  updatedAt: number;
}

export type ImportResult =
  | { ok: false; error: string; reason: string }
  | {
    ok: true;
    save: Save;
    summary: ImportSummary;
    /** The incoming `id` matches the local save's: importing it would double counters. */
    ownBackup: boolean;
    /** Present when the file came from a build with a higher `version`. */
    warning: string | null;
  };

function fail(reason: string, error = E485_READ): ImportResult {
  return { ok: false, error, reason };
}

/**
 * Validate a pasted or read-from-file export. Structure first, then the
 * checksum, then per-field coercion — so a hand-edited file degrades field by
 * field instead of failing whole. Nothing here touches the local save.
 */
export function importSave(text: string, local?: Save, now = Date.now()): ImportResult {
  if (typeof text !== 'string' || text.trim() === '') return fail('empty');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('not JSON'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('not a save object');
  }
  const d = parsed as Record<string, unknown>;
  if (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1) {
    return fail('no version field');
  }
  if (typeof d.checksum !== 'string') return fail('no checksum');
  const body = { ...d };
  delete body.checksum;
  if (fnv1a(canonicalJson(body)) !== d.checksum) return fail('checksum mismatch');
  if (!('lifetime' in d) && !('settings' in d)) return fail('not a save object');

  delete body.exportedAt;
  const save = coerceSave(body, now);
  save.version = d.version;
  return {
    ok: true,
    save,
    summary: {
      highScore: save.lifetime.highScore,
      kills: save.lifetime.kills,
      unlocks: save.unlocks.length,
      updatedAt: save.updatedAt,
    },
    ownBackup: local !== undefined && local.id === save.id,
    warning: d.version > SAVE_VERSION ? NEWER_WARNING : null,
  };
}
