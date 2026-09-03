import { describe, expect, it, beforeEach } from 'vitest';
import { Game } from '../src/harness/api';
import { RING_MAX, format, log } from '../src/core/log';
import { watch } from '../src/core/watch';
import type { LogEntry } from '../src/core/log';

/** A clock the test drives, so nothing here depends on wall time. */
let now = 0;

beforeEach(() => {
  now = 0;
  log.reset();
  log.useClock(() => now);
});

describe('the logger', () => {
  it('keeps info and above by default, and drops debug', () => {
    log.info('t', 'kept');
    log.warn('t', 'kept');
    log.error('t', 'kept');
    log.debug('t', 'dropped');
    expect(log.recent().map((e) => e.msg)).toEqual(['kept', 'kept', 'kept']);
  });

  it('keeps debug once the level is raised', () => {
    log.setLevel('debug');
    log.debug('t', 'now kept');
    expect(log.recent()).toHaveLength(1);
    expect(log.enabled('debug')).toBe(true);
  });

  it('a quieter level drops everything under it', () => {
    log.setLevel('error');
    log.warn('t', 'no');
    log.info('t', 'no');
    log.error('t', 'yes');
    expect(log.recent().map((e) => e.msg)).toEqual(['yes']);
  });

  it('the ring is capped and keeps the newest', () => {
    for (let i = 0; i < RING_MAX + 50; i++) log.info('t', `line ${i}`);
    const all = log.recent();
    expect(all).toHaveLength(RING_MAX);
    expect(all[all.length - 1].msg).toBe(`line ${RING_MAX + 49}`);
    expect(all[0].msg).toBe('line 50');
  });

  it('stamps entries against the clock it was given', () => {
    log.info('t', 'first');
    now = 250;
    log.info('t', 'later');
    expect(log.recent().map((e) => e.t)).toEqual([0, 250]);
  });

  it('without a sink it prints nothing, and with one it prints every kept line', () => {
    const seen: LogEntry[] = [];
    log.info('t', 'before the sink');
    log.setSink((e) => seen.push(e));
    log.info('t', 'after');
    log.debug('t', 'still dropped');
    expect(seen.map((e) => e.msg)).toEqual(['after']);
    expect(log.recent()).toHaveLength(2);
  });

  it('a throwing sink cannot take the game down with it', () => {
    log.setSink(() => { throw new Error('sink is on fire'); });
    expect(() => log.info('t', 'survives')).not.toThrow();
    expect(log.recent()).toHaveLength(1);
  });

  it('formats one line per entry, with the payload last', () => {
    log.info('run', 'night 3 begins', { size: 12 });
    const line = format(log.recent()[0]);
    expect(line).toContain('info');
    expect(line).toContain('run');
    expect(line).toContain('night 3 begins');
    expect(line).toContain('{"size":12}');
  });

  it('survives a payload that cannot be stringified', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    log.info('t', 'cyclic', cyclic);
    expect(() => format(log.recent()[0])).not.toThrow();
    expect(format(log.recent()[0])).toContain('uninspectable');
  });
});

describe('watching a run', () => {
  /** A game with the logger attached, at the given level. */
  function watched(level: 'info' | 'debug' = 'info'): Game {
    const g = new Game(1);
    log.setLevel(level);
    watch(g.bus, () => g.json());
    return g;
  }

  const msgs = (): string[] => log.recent().map((e) => e.msg);

  it('says why the run ended, and what the player had to work with', () => {
    const g = watched();
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 900, kind: 'bloater', row: 5, col: 40, text: 'putrescent', hp: 1, speed: 100,
    });
    st.barricade.hp = 5;
    st.charges.dd = 0;
    st.charges.D = 0;
    g.step(200);

    const death = log.recent().find((e) => e.msg.startsWith('run over'));
    expect(death, log.dump()).toBeDefined();
    expect(death!.level).toBe('error');
    // The charges are the whole point: a wall that fell with an empty
    // magazine is a different bug from one that fell with a full one.
    expect(death!.data!.charges).toBe('dd0/D0');
  });

  it('warns on every hit once the wall is nearly gone', () => {
    const g = watched();
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 901, kind: 'walker', row: 5, col: 44, text: 'moan', hp: 1, speed: 100,
    });
    st.barricade.hp = 20;
    g.step(200);
    const hit = log.recent().find((e) => e.msg.startsWith('wall hit'));
    expect(hit, log.dump()).toBeDefined();
    expect(hit!.level).toBe('warn');
  });

  it('a command that did nothing is a warning, not a whisper', () => {
    const g = watched();
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 902, kind: 'walker', row: 5, col: 10, text: 'gore', hp: 1, speed: 0,
    });
    g.sim.tick(0);
    st.cursor.row = 5; st.cursor.col = 10;
    st.charges.dd = 0;
    g.keys('dd');
    const dry = log.recent().find((e) => e.msg.includes('did nothing'));
    expect(dry, log.dump()).toBeDefined();
    expect(dry!.level).toBe('warn');
  });

  it('keeps the play-by-play out of the log until debug is on', () => {
    const g = watched('info');
    g.keys('7G');
    expect(msgs().some((m) => m === '7G')).toBe(false);
    log.setLevel('debug');
    g.keys('3j');
    expect(msgs().some((m) => m === '3j')).toBe(true);
  });

  it('records a purchase and what it left in the wallet', () => {
    const g = watched();
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    g.json().supplies = 500;
    g.json().barricade.hp = 10;
    g.keys('gg');
    g.keys('5j');                        // planks
    g.keys('l');
    const buy = log.recent().find((e) => e.msg === 'bought planks');
    expect(buy, log.dump()).toBeDefined();
    expect(buy!.data!.left).toBe(420);
  });

  it('unsubscribes cleanly', () => {
    const g = new Game(1);
    const off = watch(g.bus, () => g.json());
    off();
    const before = log.recent().length;
    g.keys('7G');
    g.step(2000);
    expect(log.recent()).toHaveLength(before);
  });

  it('never writes to GameState', () => {
    // The whole contract: a log line cannot change what the sim does, or
    // `verify:browser` would be comparing two different games.
    const a = new Game(7);
    const b = new Game(7);
    watch(b.bus, () => b.json());
    log.setLevel('debug');
    for (const keys of ['7G', 'dw', '3j', 'd2w']) { a.keys(keys); b.keys(keys); }
    a.step(3000); b.step(3000);
    expect(JSON.stringify(b.json())).toBe(JSON.stringify(a.json()));
  });
});
