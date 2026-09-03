import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  E482_CLIPBOARD, E485_READ, LEGACY_LEDGER_KEY, LEGACY_SETTINGS_KEY, NEWER_WARNING,
  OWN_BACKUP, SAVE_KEY, SaveStore, canonicalJson, clearSuspended, exportFilename, exportSave, fnv1a,
  importSave, load, merge, migrateLegacy, persist, recordMission, suspendRun,
} from '../src/save/save';
import { MAX_RUNS, SAVE_VERSION, coerceSave, coerceSuspended, defaultSave } from '../src/save/schema';
import { Game } from '../src/harness/api';
import type { RunRecord, Save } from '../src/save/schema';

/** A localStorage that behaves, and counts what it is asked to do. */
class MemStore {
  m = new Map<string, string>();
  reads: string[] = [];
  writes: string[] = [];
  getItem(k: string): string | null { this.reads.push(k); return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.writes.push(k); this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(): null { return null; }
  get length(): number { return this.m.size; }
}

let mem: MemStore;
const realStorage = (globalThis as any).localStorage;

beforeEach(() => { mem = new MemStore(); (globalThis as any).localStorage = mem; });
afterEach(() => { (globalThis as any).localStorage = realStorage; });

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 1); });

function run(at: number, over: Partial<RunRecord> = {}): RunRecord {
  return { at, wave: 3, score: 100, kills: 4, keystrokes: 20, kpk: 5, ...over };
}

// ---------------------------------------------------------------- load

describe('load', () => {
  it('fresh install: version 1, empty collections, and it writes itself out', () => {
    const s = load();
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.lifetime).toEqual({ motions: {}, missed: {}, runs: [], highScore: 0, kills: 0, medals: {} });
    expect(s.salvage).toBe(0);
    expect(s.unlocks).toEqual([]);
    expect(s.missions).toEqual({});
    expect(s.drills).toEqual({});
    expect(s.entitlements).toEqual({});
    expect(s.settings).toEqual({ gore: 'full', lineNumbers: 'relative', equipped: {} });
    expect(s.id).toMatch(/^[0-9a-f]{16}$/);
    expect(mem.m.has(SAVE_KEY)).toBe(true);
    expect(JSON.parse(mem.m.get(SAVE_KEY)!).version).toBe(SAVE_VERSION);
  });

  it('reserved sections are present on a fresh save so later features need no migration', () => {
    const s = defaultSave();
    for (const k of ['salvage', 'unlocks', 'missions', 'drills', 'entitlements'] as const) {
      expect(s[k], k).toBeDefined();
    }
    expect(s.lifetime.medals).toEqual({});
  });

  it('preserves a top-level key this build does not know, on read and on write', () => {
    mem.m.set(SAVE_KEY, JSON.stringify({
      ...defaultSave(), sponsorships: { rank: 4 }, version: 1,
    }));
    const s = load();
    expect((s as Record<string, unknown>).sponsorships).toEqual({ rank: 4 });
    persist(s);
    expect(JSON.parse(mem.m.get(SAVE_KEY)!).sponsorships).toEqual({ rank: 4 });
  });

  it('rebuilds from defaults when the stored blob is not JSON', () => {
    mem.m.set(SAVE_KEY, '{{{ not json');
    expect(load().version).toBe(SAVE_VERSION);
  });

  it('degrades field by field when the stored blob is partly corrupt', () => {
    mem.m.set(SAVE_KEY, JSON.stringify({
      version: 1, id: 'abc', createdAt: 5, updatedAt: 6,
      lifetime: { motions: 'nope', missed: { w: 'three' }, runs: { bad: 1 }, highScore: -4 },
      salvage: NaN, unlocks: ['a', 'a', 7], missions: { m1: 'x' }, settings: { gore: 'buckets' },
    }));
    const s = load();
    expect(s.lifetime.motions).toEqual({});
    expect(s.lifetime.missed).toEqual({ w: 0 });
    expect(s.lifetime.runs).toEqual([]);
    expect(s.lifetime.highScore).toBe(0);
    expect(s.salvage).toBe(0);
    expect(s.unlocks).toEqual(['a']);
    expect(s.missions).toEqual({});
    expect(s.settings.gore).toBe('full');
    expect(s.id).toBe('abc');
  });
});

// ---------------------------------------------------------------- migration

describe('migration from the legacy keys', () => {
  it('carries an existing player across and leaves the old keys alone', () => {
    const ledger = JSON.stringify({
      motions: { w: { used: 12, kills: 3 } }, missed: { f: 2 },
      runs: [run(1700000000000)], highScore: 4200,
    });
    const settings = JSON.stringify({ gore: 'low', lineNumbers: 'off' });
    mem.m.set(LEGACY_LEDGER_KEY, ledger);
    mem.m.set(LEGACY_SETTINGS_KEY, settings);

    const s = load();
    expect(s.lifetime.highScore).toBe(4200);
    expect(s.lifetime.motions).toEqual({ w: { used: 12, kills: 3 } });
    expect(s.lifetime.missed).toEqual({ f: 2 });
    expect(s.lifetime.runs).toHaveLength(1);
    expect(s.settings.gore).toBe('low');
    expect(s.settings.lineNumbers).toBe('off');
    // The rollback window depends on these being untouched.
    expect(mem.m.get(LEGACY_LEDGER_KEY)).toBe(ledger);
    expect(mem.m.get(LEGACY_SETTINGS_KEY)).toBe(settings);
  });

  it('is idempotent: the second load never reads the legacy keys and changes nothing', () => {
    mem.m.set(LEGACY_LEDGER_KEY, JSON.stringify({ highScore: 900 }));
    const first = load();
    const written = mem.m.get(SAVE_KEY)!;
    mem.reads = [];
    mem.writes = [];

    const second = load();
    expect(mem.reads).toEqual([SAVE_KEY]);
    expect(mem.writes).toEqual([]);
    expect(mem.m.get(SAVE_KEY)).toBe(written);
    expect(second.id).toBe(first.id);
    expect(second.lifetime.highScore).toBe(900);
  });

  it('returns null when there is nothing to migrate', () => {
    expect(migrateLegacy()).toBeNull();
  });

  it('survives an unreadable legacy ledger', () => {
    mem.m.set(LEGACY_LEDGER_KEY, 'not json at all');
    const s = load();
    expect(s.lifetime.highScore).toBe(0);
  });
});

// ---------------------------------------------------------------- failures

describe('storage failures never throw', () => {
  it('runs entirely in memory with no localStorage global', () => {
    delete (globalThis as any).localStorage;
    const store = new SaveStore(load());
    expect(store.get().version).toBe(SAVE_VERSION);
    expect(() => store.set((s) => { s.salvage = 5; })).not.toThrow();
    expect(store.get().salvage).toBe(5);
    expect(store.flush()).toBe(true);
    expect(store.get().salvage).toBe(5);
  });

  it('keeps the in-memory value when setItem throws', () => {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem() { throw new Error('QuotaExceededError'); },
    };
    const store = new SaveStore(load());
    expect(() => store.set((s) => { s.lifetime.highScore = 77; })).not.toThrow();
    expect(() => store.flush()).not.toThrow();
    expect(store.get().lifetime.highScore).toBe(77);
  });

  it('survives a getItem that throws', () => {
    (globalThis as any).localStorage = {
      getItem() { throw new Error('private window'); },
      setItem() { throw new Error('private window'); },
    };
    expect(load().version).toBe(SAVE_VERSION);
  });
});

// ---------------------------------------------------------------- the store

describe('SaveStore', () => {
  it('coalesces a burst of writes into one setItem, after the frame', async () => {
    const store = new SaveStore(load());
    mem.writes = [];
    for (let i = 0; i < 50; i++) store.set((s) => { s.salvage = i; });
    expect(mem.writes).toEqual([]);
    await tick();
    expect(mem.writes).toEqual([SAVE_KEY]);
    expect(JSON.parse(mem.m.get(SAVE_KEY)!).salvage).toBe(49);
  });

  it('stamps updatedAt on every set', () => {
    const store = new SaveStore(coerceSave({ ...defaultSave(), updatedAt: 1 }));
    store.set((s) => { s.salvage = 1; });
    expect(store.get().updatedAt).toBeGreaterThan(1);
    store.flush();      // leave no timer behind for the next test to see
  });

  it('flush writes synchronously and cancels the pending timer', async () => {
    const store = new SaveStore(load());
    mem.writes = [];
    store.set((s) => { s.lifetime.kills = 9; });
    expect(store.dirty).toBe(true);
    expect(store.flush()).toBe(true);
    expect(mem.writes).toEqual([SAVE_KEY]);
    expect(store.dirty).toBe(false);
    await tick();
    expect(mem.writes).toEqual([SAVE_KEY]);       // the timer did not fire twice
  });

  it('flush is a no-op when nothing is pending', () => {
    const store = new SaveStore(load());
    expect(store.flush()).toBe(false);
  });

  it('replace swaps the blob and schedules a write', async () => {
    const store = new SaveStore(load());
    const next = defaultSave();
    next.lifetime.highScore = 1234;
    store.replace(next);
    expect(store.get().lifetime.highScore).toBe(1234);
    await tick();
    expect(JSON.parse(mem.m.get(SAVE_KEY)!).lifetime.highScore).toBe(1234);
  });
});

// ---------------------------------------------------------------- merge

describe('merge', () => {
  function pair(): { local: Save; incoming: Save } {
    const local = defaultSave(1000);
    const incoming = defaultSave(500);
    return { local, incoming };
  }

  it('two devices: counters sum, bests take the max, sets union', () => {
    const { local, incoming } = pair();
    local.lifetime.kills = 100;
    local.lifetime.highScore = 900;
    local.unlocks = ['a'];
    incoming.lifetime.kills = 40;
    incoming.lifetime.highScore = 1200;
    incoming.unlocks = ['b'];

    const m = merge(local, incoming, 'merge');
    expect(m.lifetime.kills).toBe(140);
    expect(m.lifetime.highScore).toBe(1200);
    expect(m.unlocks).toEqual(['a', 'b']);
  });

  it('sums per-motion used and kills, missed, medals and salvage', () => {
    const { local, incoming } = pair();
    local.lifetime.motions = { w: { used: 5, kills: 2 }, dw: { used: 1, kills: 1 } };
    incoming.lifetime.motions = { w: { used: 3, kills: 1 }, f: { used: 9, kills: 4 } };
    local.lifetime.missed = { f: 2 };
    incoming.lifetime.missed = { f: 3, t: 1 };
    local.lifetime.medals = { clean: 2 };
    incoming.lifetime.medals = { clean: 1, fast: 4 };
    local.salvage = 30;
    incoming.salvage = 12;

    const m = merge(local, incoming, 'merge');
    expect(m.lifetime.motions).toEqual({
      w: { used: 8, kills: 3 }, dw: { used: 1, kills: 1 }, f: { used: 9, kills: 4 },
    });
    expect(m.lifetime.missed).toEqual({ f: 5, t: 1 });
    expect(m.lifetime.medals).toEqual({ clean: 3, fast: 4 });
    expect(m.salvage).toBe(42);
  });

  it('does not mutate either input', () => {
    const { local, incoming } = pair();
    local.lifetime.motions = { w: { used: 5, kills: 2 } };
    incoming.lifetime.motions = { w: { used: 3, kills: 1 } };
    local.unlocks = ['a'];
    merge(local, incoming, 'merge');
    expect(local.lifetime.motions.w).toEqual({ used: 5, kills: 2 });
    expect(incoming.lifetime.motions.w).toEqual({ used: 3, kills: 1 });
    expect(local.unlocks).toEqual(['a']);
  });

  it('mission stars take the max and bestKeys the min', () => {
    const { local, incoming } = pair();
    local.missions = { m3: { stars: 1, bestKeys: 9 }, m4: { stars: 3, bestKeys: 4 } };
    incoming.missions = { m3: { stars: 2, bestKeys: 7 }, m5: { stars: 1, bestKeys: 20 } };
    const m = merge(local, incoming, 'merge');
    expect(m.missions.m3).toEqual({ stars: 2, bestKeys: 7 });
    expect(m.missions.m4).toEqual({ stars: 3, bestKeys: 4 });
    expect(m.missions.m5).toEqual({ stars: 1, bestKeys: 20 });
  });

  it('a bestKeys of 0 means no record, not a perfect run', () => {
    const { local, incoming } = pair();
    local.missions = { m1: { stars: 0, bestKeys: 0 } };
    incoming.missions = { m1: { stars: 2, bestKeys: 11 } };
    expect(merge(local, incoming, 'merge').missions.m1).toEqual({ stars: 2, bestKeys: 11 });
    expect(merge(incoming, local, 'merge').missions.m1).toEqual({ stars: 2, bestKeys: 11 });
  });

  it('drill bests take the max', () => {
    const { local, incoming } = pair();
    local.drills = { word: { best: 40 } };
    incoming.drills = { word: { best: 55 }, find: { best: 12 } };
    expect(merge(local, incoming, 'merge').drills).toEqual({
      word: { best: 55 }, find: { best: 12 },
    });
  });

  it('unlocks union without duplicates, local order first', () => {
    const { local, incoming } = pair();
    local.unlocks = ['b', 'a'];
    incoming.unlocks = ['a', 'c'];
    expect(merge(local, incoming, 'merge').unlocks).toEqual(['b', 'a', 'c']);
  });

  it('runs concatenate, dedupe on at, sort ascending, and keep the last 40', () => {
    const { local, incoming } = pair();
    local.lifetime.runs = [run(1700000000000, { score: 1 }), run(3)];
    incoming.lifetime.runs = [run(1700000000000, { score: 999 }), run(2)];
    const m = merge(local, incoming, 'merge');
    expect(m.lifetime.runs.map((r) => r.at)).toEqual([2, 3, 1700000000000]);
    // The local record wins the tie; nothing is counted twice.
    expect(m.lifetime.runs[2].score).toBe(1);

    const many = pair();
    many.local.lifetime.runs = Array.from({ length: 30 }, (_, i) => run(i + 1));
    many.incoming.lifetime.runs = Array.from({ length: 30 }, (_, i) => run(i + 101));
    const big = merge(many.local, many.incoming, 'merge');
    expect(big.lifetime.runs).toHaveLength(MAX_RUNS);
    expect(big.lifetime.runs[0].at).toBe(21);
    expect(big.lifetime.runs[MAX_RUNS - 1].at).toBe(130);
  });

  it('keeps the local settings, id, and the earlier createdAt', () => {
    const { local, incoming } = pair();
    local.settings = { gore: 'off', lineNumbers: 'absolute', equipped: { hat: 'mine' } };
    incoming.settings = { gore: 'full', lineNumbers: 'relative', equipped: { hat: 'theirs' } };
    const before = Date.now();
    const m = merge(local, incoming, 'merge');
    expect(m.settings).toEqual(local.settings);
    expect(m.id).toBe(local.id);
    expect(m.createdAt).toBe(500);
    expect(m.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('keeps unknown keys from both sides, local winning a clash', () => {
    const { local, incoming } = pair();
    (local as Record<string, unknown>).mine = 1;
    (incoming as Record<string, unknown>).theirs = 2;
    (incoming as Record<string, unknown>).mine = 99;
    const m = merge(local, incoming, 'merge') as Record<string, unknown>;
    expect(m.mine).toBe(1);
    expect(m.theirs).toBe(2);
  });

  it('replace takes the incoming save wholesale but keeps the local id', () => {
    const { local, incoming } = pair();
    local.lifetime.highScore = 5000;
    local.settings.gore = 'off';
    incoming.lifetime.highScore = 10;
    incoming.settings.gore = 'full';
    const before = Date.now();
    const m = merge(local, incoming, 'replace');
    expect(m.lifetime.highScore).toBe(10);
    expect(m.settings.gore).toBe('full');
    expect(m.id).toBe(local.id);
    expect(m.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------- transfer

describe('export and import', () => {
  it('canonical JSON sorts keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } }))
      .toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });

  it('fnv1a is 8 hex digits and changes with one character', () => {
    expect(fnv1a('')).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv1a('motions')).not.toBe(fnv1a('motionz'));
    expect(fnv1a('motions')).toBe(fnv1a('motions'));
  });

  it('the filename carries date and time so two exports a day never collide', () => {
    expect(exportFilename(new Date(2026, 8, 3, 14, 12))).toBe('motd-save-2026-09-03-1412.json');
    expect(exportFilename(new Date(2026, 8, 3, 9, 5))).toBe('motd-save-2026-09-03-0905.json');
  });

  it('round trip: import deep-equals the original apart from exportedAt and checksum', () => {
    const save = defaultSave(1234);
    save.lifetime.highScore = 4200;
    save.lifetime.kills = 88;
    save.lifetime.motions = { dw: { used: 3, kills: 3 } };
    save.lifetime.runs = [run(1700000000000, { kpk: 3.75 })];
    save.unlocks = ['helmet'];
    save.missions = { m1: { stars: 3, bestKeys: 6 } };
    save.drills = { word: { best: 42 } };
    save.salvage = 17;
    save.settings = { gore: 'low', lineNumbers: 'off', equipped: { hat: 'cap' } };
    (save as Record<string, unknown>).fromTheFuture = { x: 1 };

    const text = exportSave(save, 999);
    const parsed = JSON.parse(text);
    expect(parsed.exportedAt).toBe(999);
    expect(parsed.checksum).toMatch(/^[0-9a-f]{8}$/);

    const result = importSave(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save).toEqual(save);
    expect(result.warning).toBeNull();
    expect(result.summary).toEqual({
      highScore: 4200, kills: 88, unlocks: 1, updatedAt: save.updatedAt,
    });
  });

  it('a corrupted byte outside the checksum field is caught', () => {
    const text = exportSave(defaultSave(1));
    const i = text.indexOf('"highScore": 0');
    const corrupt = `${text.slice(0, i)}"highScore": 9${text.slice(i + '"highScore": 0'.length)}`;
    expect(corrupt).not.toBe(text);
    const result = importSave(corrupt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(E485_READ);
    expect(result.reason).toBe('checksum mismatch');
  });

  it('reports the specific reason for every way a file can be wrong', () => {
    const reasons: Array<[string, string]> = [
      ['', 'empty'],
      ['   ', 'empty'],
      ['{{{', 'not JSON'],
      ['[1,2]', 'not a save object'],
      ['"a string"', 'not a save object'],
      ['{"lifetime":{}}', 'no version field'],
      ['{"version":1.5,"lifetime":{}}', 'no version field'],
      ['{"version":0,"lifetime":{}}', 'no version field'],
      ['{"version":1,"lifetime":{}}', 'no checksum'],
    ];
    for (const [text, reason] of reasons) {
      const r = importSave(text);
      expect(r.ok, text).toBe(false);
      if (r.ok) continue;
      expect(r.error).toBe(E485_READ);
      expect(r.reason, text).toBe(reason);
    }
  });

  it('rejects a checksummed object that is not a save at all', () => {
    const body = { version: 1, hello: 'world' };
    const text = JSON.stringify({ ...body, checksum: fnv1a(canonicalJson(body)) });
    const r = importSave(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not a save object');
  });

  it('a newer version warns but still merges its known fields', () => {
    const future = defaultSave(1);
    future.version = 2;
    future.lifetime.highScore = 7777;
    (future as Record<string, unknown>).newSection = { thing: true };

    const r = importSave(exportSave(future));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warning).toBe(NEWER_WARNING);
    expect(r.save.version).toBe(2);
    expect((r.save as Record<string, unknown>).newSection).toEqual({ thing: true });

    const local = defaultSave(1);
    local.lifetime.highScore = 10;
    const m = merge(local, r.save, 'merge');
    expect(m.lifetime.highScore).toBe(7777);
    expect((m as Record<string, unknown>).newSection).toEqual({ thing: true });
  });

  it('detects the player importing their own backup', () => {
    const mine = defaultSave(1);
    const text = exportSave(mine);
    const own = importSave(text, mine);
    expect(own.ok).toBe(true);
    if (own.ok) expect(own.ownBackup).toBe(true);

    const theirs = importSave(text, defaultSave(2));
    expect(theirs.ok).toBe(true);
    if (theirs.ok) expect(theirs.ownBackup).toBe(false);

    // Without a local save to compare against, nothing is claimed.
    const anon = importSave(text);
    expect(anon.ok).toBe(true);
    if (anon.ok) expect(anon.ownBackup).toBe(false);
  });

  it('the error strings are printable ASCII, per DECISIONS R11', () => {
    for (const s of [E482_CLIPBOARD, E485_READ, NEWER_WARNING, OWN_BACKUP]) {
      expect(s).toMatch(/^[\x20-\x7e]+$/);
    }
  });
});

// ---------------------------------------------------------------- isolation

describe('sim isolation', () => {
  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...tsFiles(full));
      else if (name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('src/sim, src/vim and src/core never import from src/save', () => {
    for (const dir of ['src/sim', 'src/vim', 'src/core']) {
      for (const file of tsFiles(dir)) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*save\//);
      }
    }
  });

  it('src/save never imports from src/sim, src/render or src/audio', () => {
    for (const file of tsFiles('src/save')) {
      expect(readFileSync(file, 'utf8'), file)
        .not.toMatch(/from ['"][^'"]*(sim|render|audio)\//);
    }
  });
});

// ---------------------------------------------------------------- missions

describe('recordMission', () => {
  it('writes the first clear as it happened', () => {
    const store = new SaveStore(defaultSave());
    recordMission(store, 'basic-words', 9, 2);
    expect(store.get().missions['basic-words']).toEqual({ stars: 2, bestKeys: 9 });
    expect(store.dirty).toBe(true);
  });
  it('a worse repeat does not regress either field', () => {
    const store = new SaveStore(defaultSave());
    recordMission(store, 'basic-words', 9, 2);
    recordMission(store, 'basic-words', 14, 1);
    expect(store.get().missions['basic-words']).toEqual({ stars: 2, bestKeys: 9 });
  });
  it('a better repeat improves both', () => {
    const store = new SaveStore(defaultSave());
    recordMission(store, 'basic-words', 9, 2);
    recordMission(store, 'basic-words', 6, 3);
    expect(store.get().missions['basic-words']).toEqual({ stars: 3, bestKeys: 6 });
  });
  it('fields improve independently', () => {
    const store = new SaveStore(defaultSave());
    recordMission(store, 'm', 9, 2);
    recordMission(store, 'm', 7, 2);           // fewer keys, same stars
    expect(store.get().missions.m).toEqual({ stars: 2, bestKeys: 7 });
    recordMission(store, 'm', 20, 3);          // more stars, more keys
    expect(store.get().missions.m).toEqual({ stars: 3, bestKeys: 7 });
  });
  it('ignores garbage', () => {
    const store = new SaveStore(defaultSave());
    recordMission(store, '', 9, 2);
    recordMission(store, 'm', Number.NaN, 2);
    recordMission(store, 'm', 9, Number.POSITIVE_INFINITY);
    expect(store.get().missions).toEqual({});
    expect(store.dirty).toBe(false);
  });
  it('round-trips through persist and load', async () => {
    const store = new SaveStore(load());
    recordMission(store, 'ess-find', 5, 3);
    store.flush();
    expect(load().missions['ess-find']).toEqual({ stars: 3, bestKeys: 5 });
  });
});

describe('suspended run', () => {
  function snap() {
    const g = new Game(11);
    g.step(4000);
    return g.sim.snapshot();
  }

  it('is null on a fresh save and after coercing garbage', () => {
    expect(defaultSave().suspended).toBeNull();
    expect(coerceSave({ suspended: 'yes' }).suspended).toBeNull();
    expect(coerceSuspended({ state: { phase: 'dead', sim: { mode: 'survival' } } })).toBeNull();
    expect(coerceSuspended({ state: { phase: 'playing', sim: { mode: 'mission' }, buffer: { zombies: [] } } })).toBeNull();
  });

  it('round-trips through the store and out to storage', () => {
    const store = new SaveStore(defaultSave());
    const s = snap();
    suspendRun(store, s.state, s.progress, 1234);
    store.flush();
    const back = load();
    expect(back.suspended).not.toBeNull();
    expect(back.suspended!.night).toBe(1);
    expect(back.suspended!.at).toBe(1234);
    expect(back.suspended!.state).toEqual(JSON.parse(JSON.stringify(s.state)));
    expect(back.suspended!.progress).toEqual(s.progress);
  });

  it('one slot: a second suspend replaces the first', () => {
    const store = new SaveStore(defaultSave());
    const s = snap();
    suspendRun(store, s.state, s.progress, 1);
    s.state.wave = 4; s.state.score = 900;
    suspendRun(store, s.state, s.progress, 2);
    expect(store.get().suspended).toMatchObject({ at: 2, night: 4, score: 900 });
  });

  it('is a copy of the state, not a reference to it', () => {
    const store = new SaveStore(defaultSave());
    const s = snap();
    suspendRun(store, s.state, s.progress);
    s.state.score = 123456;
    expect(store.get().suspended!.score).not.toBe(123456);
    expect((store.get().suspended!.state as { score: number }).score).not.toBe(123456);
  });

  it('clears', () => {
    const store = new SaveStore(defaultSave());
    const s = snap();
    suspendRun(store, s.state, s.progress);
    clearSuspended(store);
    expect(store.get().suspended).toBeNull();
  });

  it('merge keeps the local run and takes the incoming one only when there is none', () => {
    const s = snap();
    const a = defaultSave(); const b = defaultSave();
    const sa = new SaveStore(a); const sb = new SaveStore(b);
    suspendRun(sa, s.state, s.progress, 1);
    expect(merge(a, b, 'merge').suspended!.at).toBe(1);
    expect(merge(b, a, 'merge').suspended!.at).toBe(1);
    suspendRun(sb, s.state, s.progress, 2);
    expect(merge(a, b, 'merge').suspended!.at).toBe(1);
    expect(merge(b, a, 'merge').suspended!.at).toBe(2);
  });

  it('survives export and import', () => {
    const store = new SaveStore(defaultSave());
    const s = snap();
    suspendRun(store, s.state, s.progress, 5);
    const r = importSave(exportSave(store.get()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.save.suspended).toMatchObject({ at: 5, night: 1 });
  });
});
