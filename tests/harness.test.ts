import { describe, expect, it } from 'vitest';
import { Game } from '../src/harness/api';
import { dispatch, newRepl } from '../src/harness/repl';
import { optimalKill } from '../src/sim/optimal';
import type { Zombie } from '../src/core/types';

describe('text() surface', () => {
  const g = new Game(1);
  g.step(8000);
  const t = g.text();

  it('leads with the status line, naming the lesson', () => {
    expect(t.split('\n')[0]).toMatch(
      /^WAVE \d+ "[^"]+"  SCORE \d+  COMBO x\d+  BARRICADE \d+\/\d+  dd:\d+ D:\d+  PENDING: /,
    );
  });
  it('names the current vim-hero lesson', () => {
    expect(t).toMatch(/^LESSON {2}.+ \/ .+ — .+ : .+$/m);
  });
  it('prints a column ruler', () => {
    expect(t).toMatch(/^ {8}0\.{9}1\.{9}2\.{9}3\.{9}4\.{9}5\.$/m);
  });
  it('explains every zombie kind', () => {
    for (const k of ['walker', 'runner', 'armored', 'bloater', 'crawler']) expect(t).toContain(`${k}=`);
  });
  it('shows all 16 lanes, each ending in its slice of wall', () => {
    const lanes = t.split('\n').filter((l) => /^lane [ 0-9]\d /.test(l));
    expect(lanes).toHaveLength(16);
    for (const l of lanes) expect(l).toMatch(/^lane [ 0-9]\d .{52}[#=\-. ]$/);
  });
  it('marks the cursor lane with a caret', () => {
    const lines = t.split('\n');
    const cur = g.json().cursor;
    const i = lines.findIndex((l) => l.startsWith(`lane ${String(cur.row).padStart(2, ' ')} `));
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toBe(' '.repeat(8 + cur.col) + '^');
  });
  it('names every zombie with its kind and its distance to the wall', () => {
    for (const z of g.json().buffer.zombies) {
      expect(t).toMatch(new RegExp(`\\s${z.kind.padEnd(8, ' ')}\\s+\\d+  ${z.text}$`, 'm'));
    }
  });
  it('reports the cursor and what is under it', () => {
    expect(t).toMatch(/\nCURSOR lane \d+ col \d+  \(on: /);
  });
  it('shows the pending command buffer', () => {
    const h = new Game(1);
    h.keys('d2');
    expect(h.text().split('\n')[0]).toMatch(/PENDING: d2$/);
  });
  it('is stable for the same seed and inputs', () => {
    const a = new Game(9); const b = new Game(9);
    a.step(9000); b.step(9000);
    expect(a.text()).toBe(b.text());
  });
});

describe('Game facade', () => {
  it('step() is deterministic regardless of chunk size', () => {
    const a = new Game(5); const b = new Game(5);
    a.step(6000);
    for (let i = 0; i < 12; i++) b.step(500);
    expect(JSON.stringify(a.json())).toBe(JSON.stringify(b.json()));
  });
  it('keys() returns the events it caused', () => {
    const g = new Game(1);
    const evs = g.keys('w');
    expect(evs.some((e) => e.t === 'command')).toBe(true);
  });
  it('i restarts after death', () => {
    const g = new Game(1);
    g.json().barricade.hp = 1;
    g.json().buffer.zombies.push({ id: 999, kind: 'walker', row: 7, col: 46, text: 'moan', hp: 1, speed: 50 });
    g.step(200);
    expect(g.isOver()).toBe(true);
    g.keys('i');
    expect(g.isOver()).toBe(false);
    expect(g.json().wave).toBe(1);
  });
});

describe('repl grammar replays deterministically', () => {
  it('the same input script produces the same final state', () => {
    const script = ['step 3000', 'w', 'dw', 'step 1200', '3j', 'x', 'step 900', 'f e', 'ci(', 'step 2000'];
    const run = () => {
      const r = newRepl(11);
      const evs: unknown[] = [];
      for (const line of script) evs.push(dispatch(r, line).events);
      return { state: JSON.stringify(r.game.json()), evs: JSON.stringify(evs) };
    };
    const a = run(); const b = run();
    expect(a.state).toBe(b.state);
    expect(a.evs).toBe(b.evs);
  });
});

describe('the game is winnable by reading text() alone', () => {
  it('the rule-based bot reaches wave 6 on seed 1', () => {
    const g = new Game(1);
    let guard = 0;
    while (!g.isOver() && g.json().wave < 6 && guard++ < 100_000) {
      const st = g.json();
      if (st.sim.breather > 0) { g.step(200); continue; }
      const zs = st.buffer.zombies;
      if (zs.length === 0) { g.step(100); continue; }
      let target: Zombie = zs[0];
      for (const z of zs) if (z.row > target.row || (z.row === target.row && z.col < target.col)) target = z;
      const opt = optimalKill(st.buffer, st.cursor, target, st.charges);
      if (!opt) { g.step(100); continue; }
      g.keys(opt.keys);
      g.step(opt.keys.length * 55);
    }
    expect(g.isOver()).toBe(false);
    expect(g.json().wave).toBeGreaterThanOrEqual(6);
  }, 30_000);

  it('every command the heuristic recommends actually lands the kill', () => {
    const g = new Game(13);
    let checked = 0;
    for (let i = 0; i < 300 && checked < 25; i++) {
      g.step(300);
      const st = g.json();
      if (st.sim.breather > 0 || st.buffer.zombies.length === 0) continue;
      const target = st.buffer.zombies[st.buffer.zombies.length - 1];
      const opt = optimalKill(st.buffer, st.cursor, target, st.charges);
      if (!opt) continue;
      const evs = g.keys(opt.keys);
      const kill = evs.find((e) => e.t === 'kill' && e.zombieId === target.id);
      expect(kill, `${opt.keys} failed to kill ${target.kind} "${target.text}"`).toBeDefined();
      expect(evs.some((e) => e.t === 'kill' && e.overkill)).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  }, 30_000);
});
