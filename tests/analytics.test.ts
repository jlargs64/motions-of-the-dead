import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Bus } from '../src/core/bus';
import { attachAnalytics } from '../src/analytics';
import { track } from '../src/analytics/umami';

type Sent = { name: string; data?: Record<string, unknown> };

/** The stub the real tag would install. Captures instead of sending. */
function stub(): Sent[] {
  const sent: Sent[] = [];
  (globalThis as any).umami = { track: (name: string, data?: Record<string, unknown>) => { sent.push({ name, data }); } };
  return sent;
}

/** The allowlist, restated here so a change to `src/analytics` has to change a test. */
const ALLOWED: Record<string, string[]> = {
  run_start: [],
  run_end: ['wave', 'score'],
  mission_done: ['id', 'stars'],
  drill_done: ['family', 'perfect', 'scenes'],
};

let detach: () => void;
let bus: Bus;

beforeEach(() => { bus = new Bus(); detach = attachAnalytics(bus); });
afterEach(() => { detach(); delete (globalThis as any).umami; });

describe('the allowlist', () => {
  it('sends run_start then run_end for a full run', () => {
    const sent = stub();
    bus.emit({ t: 'wave_start', n: 1, unlocks: [] });
    bus.emit({ t: 'wave_clear', n: 1, ms: 9000 });
    bus.emit({ t: 'wave_start', n: 2, unlocks: [] });
    bus.emit({ t: 'death', wave: 5, score: 4200 });
    expect(sent.map((s) => s.name)).toEqual(['run_start', 'run_end']);
    expect(sent[1].data).toEqual({ wave: 5, score: 4200 });
  });

  it('ignores wave_start after the first', () => {
    const sent = stub();
    bus.emit({ t: 'wave_start', n: 3, unlocks: [] });
    expect(sent).toEqual([]);
  });

  it('sends a mission and a drill without their keystroke counts', () => {
    const sent = stub();
    bus.emit({ t: 'mission_done', id: 'bc-3', keys: 14, par: 11, stars: 2 });
    bus.emit({ t: 'drill_done', family: 'counts', kills: 18, perfect: 12, scenes: 20 });
    expect(sent[0]).toEqual({ name: 'mission_done', data: { id: 'bc-3', stars: 2 } });
    expect(sent[1]).toEqual({ name: 'drill_done', data: { family: 'counts', perfect: 12, scenes: 20 } });
  });

  it('stays silent through the loud events', () => {
    const sent = stub();
    for (let i = 0; i < 50; i++) {
      bus.emit({ t: 'kill', zombieId: i, kind: 'walker' as any, via: 'dw', overkill: false });
      bus.emit({ t: 'shot', row: 0 as any, colStart: 0 as any, colEnd: 8 as any, hits: 1 });
      bus.emit({ t: 'command', cmd: { raw: 'dw' } as any, ms: 12 });
      bus.emit({ t: 'combo', n: i });
      bus.emit({ t: 'kill_judged', zombieId: i, spent: 3, optimal: 'dw' });
      bus.emit({ t: 'barricade_hit', dmg: 4, hpLeft: 60 });
    }
    bus.emit({ t: 'combo_break', reason: 'missed' });
    bus.emit({ t: 'medal', name: 'CLEAN', bonus: 50 });
    bus.emit({ t: 'buy', item: 'mine', cost: 20 });
    bus.emit({ t: 'revive' });
    expect(sent).toEqual([]);
  });

  it('keeps every payload to numbers and short enums', () => {
    const sent = stub();
    bus.emit({ t: 'wave_start', n: 1, unlocks: [] });
    bus.emit({ t: 'death', wave: 5, score: 4200 });
    bus.emit({ t: 'mission_done', id: 'bc-3', keys: 14, par: 11, stars: 2 });
    bus.emit({ t: 'drill_done', family: 'counts', kills: 18, perfect: 12, scenes: 20 });
    for (const s of sent) {
      expect(ALLOWED[s.name]).toBeDefined();
      for (const [k, v] of Object.entries(s.data ?? {})) {
        expect(ALLOWED[s.name]).toContain(k);
        expect(typeof v === 'number' || typeof v === 'string').toBe(true);
        if (typeof v === 'string') expect(v.length).toBeLessThanOrEqual(32);
      }
    }
  });
});

describe('analytics never fails the game', () => {
  it('is a no-op with no umami at all', () => {
    expect(() => {
      bus.emit({ t: 'wave_start', n: 1, unlocks: [] });
      bus.emit({ t: 'death', wave: 2, score: 10 });
    }).not.toThrow();
  });

  it('is a no-op when umami is not a function', () => {
    (globalThis as any).umami = { track: 'nope' };
    expect(() => bus.emit({ t: 'death', wave: 2, score: 10 })).not.toThrow();
  });

  it('swallows a throwing tag', () => {
    (globalThis as any).umami = { track: () => { throw new Error('blocked'); } };
    expect(() => bus.emit({ t: 'death', wave: 2, score: 10 })).not.toThrow();
  });

  it('drops an event fired before the deferred script lands, keeping no queue', () => {
    bus.emit({ t: 'wave_start', n: 1, unlocks: [] });   // no umami yet
    const sent = stub();                                 // tag arrives
    bus.emit({ t: 'death', wave: 2, score: 10 });
    expect(sent.map((s) => s.name)).toEqual(['run_end']); // no replayed run_start
  });

  it('exports a track() that is safe to call directly', () => {
    expect(() => track('run_start')).not.toThrow();
  });
});

describe('the network stays where it is declared', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|mts)$/.test(name)) out.push(full);
    }
    return out;
  }

  it('makes no network call outside src/analytics', () => {
    const offenders: string[] = [];
    for (const file of [...walk('src'), ...walk('scripts')]) {
      if (file.startsWith(join('src', 'analytics'))) continue;
      const text = readFileSync(file, 'utf8');
      if (/\bfetch\(|sendBeacon|XMLHttpRequest/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps window out of every analytics file but umami.ts', () => {
    for (const file of walk(join('src', 'analytics'))) {
      if (file.endsWith('umami.ts')) continue;
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bwindow\b/);
    }
  });

  it('ships the tag with the four attributes that make it safe', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/data-website-id="52e96d3b-5dfa-472a-bf54-422c61c7de68"/);
    expect(html).toMatch(/data-domains="justinlargo\.com"/);
    expect(html).toMatch(/data-do-not-track="true"/);
    expect(html).toMatch(/data-auto-track="false"/);
    expect(html.match(/<script/g)?.length).toBe(2);   // the tag, and the module entry
  });
});
