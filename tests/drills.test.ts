import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { FIELD_COLS, ROWS } from '../src/core/field';
import type { Trap } from '../src/core/state';
import {
  DRILL_ATTEMPTS, FAMILIES, cheapestPlacement, familyById, familyMissionTitle, familyOf,
  familySection, generateScene, orderHit, orderText, sceneAnswers, verifyScene,
} from '../src/sim/drills';
import type { PlacementOrder } from '../src/sim/drills';
import { COACH_MIN_MISSED, COACH_QUIET, coach, coachLine, needOf } from '../src/sim/coach';
import type { CoachInput } from '../src/sim/coach';
import { splitKeys, tokensUsed } from '../src/sim/optimal';
import { missionIndex } from '../src/sim/missions';

const ok = (s: string, where: string): void => {
  for (const ch of s) {
    expect(ch.charCodeAt(0), `${where}: ${JSON.stringify(ch)} in ${JSON.stringify(s)}`).toBeLessThan(127);
    expect(ch.charCodeAt(0), `${where}: ${JSON.stringify(ch)}`).toBeGreaterThanOrEqual(32);
  }
};

// ---------------------------------------------------------------- the table

describe('the drill family table', () => {
  it('every token belongs to at most one family', () => {
    const seen = new Map<string, string>();
    for (const f of FAMILIES) {
      for (const t of f.tokens) {
        expect(seen.get(t), `${t} is in ${seen.get(t)} and ${f.id}`).toBeUndefined();
        seen.set(t, f.id);
      }
    }
  });
  it('; is find and l is nobody', () => {
    expect(familyOf(';')?.id).toBe('find');
    expect(familyOf('f')?.id).toBe('find');
    expect(familyOf('i(')?.id).toBe('brackets');
    expect(familyOf('l')).toBeUndefined();
    expect(familyOf('w')).toBeUndefined();
    expect(familyById('nope')).toBeUndefined();
  });
  it('names a real mission and its section for every family', () => {
    for (const f of FAMILIES) {
      expect(missionIndex(f.mission), f.id).toBeGreaterThanOrEqual(0);
      expect(familySection(f)).not.toBe('');
      expect(familyMissionTitle(f)).not.toBe('');
    }
  });
  it('ships at least three fixtures per family, and every fixture verifies', () => {
    for (const f of FAMILIES) {
      expect(f.fixtures.length, f.id).toBeGreaterThanOrEqual(3);
      for (const [i, fx] of f.fixtures.entries()) {
        expect(verifyScene(f, fx), `${f.id} fixture ${i}: ${sceneAnswers(fx).map((o) => o.keys).join(' ')}`).toBe(true);
        if (fx.order) continue;
        expect(fx.spawn[fx.target], `${f.id} fixture ${i} target`).toBeDefined();
        for (const [, row, col, text] of fx.spawn) {
          expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(ROWS);
          expect(col + text.length).toBeLessThanOrEqual(FIELD_COLS);
        }
      }
    }
  });
  it('every string is printable ASCII', () => {
    for (const f of FAMILIES) {
      ok(f.id, 'id'); ok(f.name, 'name'); ok(f.blurb, 'blurb');
      for (const k of f.keys) ok(k, 'keycap');
      for (const fx of f.fixtures) for (const [, , , text] of fx.spawn) ok(text, 'zombie');
    }
    ok(COACH_QUIET, 'coach quiet');
    ok(orderText({ item: 'fence', row0: 2, row1: 4, col0: 30, col1: 30 }), 'order');
  });
});

// ---------------------------------------------------------------- generation

describe('oracle-verified generation', () => {
  it('accepts at least 30 percent of attempts for every family, 200 scenes each', () => {
    for (const f of FAMILIES) {
      const rng = new Rng(7);
      let tried = 0;
      let accepted = 0;
      while (accepted < 200 && tried < 2000) {
        const s = f.generate(rng);
        tried++;
        if (s && verifyScene(f, s)) accepted++;
      }
      expect(accepted, f.id).toBe(200);
      expect(accepted / tried, `${f.id}: ${accepted}/${tried}`).toBeGreaterThanOrEqual(0.3);
    }
  }, 60_000);

  it('an accepted find scene has a find among the cheapest kills', () => {
    const f = familyById('find')!;
    const rng = new Rng(3);
    for (let i = 0; i < 20; i++) {
      const s = generateScene(f, rng);
      const finds = sceneAnswers(s).some((o) => tokensUsed(o.keys).some((t) => 'fFtT'.includes(t)));
      expect(finds, sceneAnswers(s).map((o) => o.keys).join(' ')).toBe(true);
    }
  });

  it('a generated scene stays on the field with a real target', () => {
    for (const f of FAMILIES) {
      const rng = new Rng(11);
      for (let i = 0; i < 30; i++) {
        const s = generateScene(f, rng);
        expect(s.cursor[0]).toBeGreaterThanOrEqual(0); expect(s.cursor[0]).toBeLessThan(ROWS);
        expect(s.cursor[1]).toBeGreaterThanOrEqual(0); expect(s.cursor[1]).toBeLessThan(FIELD_COLS);
        if (s.order) { expect(s.target).toBe(-1); continue; }
        expect(s.spawn[s.target]).toBeDefined();
        for (const [, row, col, text] of s.spawn) {
          expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(ROWS);
          expect(col).toBeGreaterThanOrEqual(0);
          expect(col + text.length, `${f.id}: ${text} at ${col}`).toBeLessThanOrEqual(FIELD_COLS);
        }
      }
    }
  });

  it('is deterministic under a seed', () => {
    for (const f of FAMILIES) {
      const a = new Rng(99); const b = new Rng(99);
      for (let i = 0; i < 5; i++) {
        expect(JSON.stringify(generateScene(f, a))).toBe(JSON.stringify(generateScene(f, b)));
      }
    }
  });

  it('falls back to a fixture when every attempt is rejected', () => {
    const f = familyById('search')!;
    const never = { ...f, generate: () => null };
    const rng = new Rng(5);
    const s = generateScene(never, rng, DRILL_ATTEMPTS);
    expect(f.fixtures).toContainEqual(s);
    // zero attempts is the same road
    expect(f.fixtures).toContainEqual(generateScene(never, rng, 0));
  });
});

// ---------------------------------------------------------------- placement

describe('the placement family', () => {
  const fence: PlacementOrder = { item: 'fence', row0: 8, row1: 10, col0: 30, col1: 30 };

  it('cheapestPlacement matches hand-computed orders', () => {
    // From lane 3 col 30: 6j to lane 9, anchor, 2j, plant. Six keystrokes:
    // a count is a key of its own, as it is under the player's fingers.
    const a = cheapestPlacement(fence, { row: 2, col: 30 });
    expect(a.keys).toBe('6j<CR>2j<CR>');
    expect(a.cost).toBe(6);
    // A tripwire is a reach and one Enter.
    const trip = cheapestPlacement({ item: 'tripwire', row0: 12, row1: 12, col0: 40, col1: 40 }, { row: 12, col: 40 });
    expect(trip.keys).toBe('<CR>');
    expect(trip.cost).toBe(1);
    // Column by the ruler: `f3` or `6w` lands on col 30 in two keys.
    const b = cheapestPlacement(fence, { row: 8, col: 0 });
    expect(splitKeys(b.keys).length).toBe(b.cost);
    expect(b.keys).toMatch(/^(f3|6w|6e)<CR>2j<CR>$/);
    // A column that is no mark takes a hop: to the mark, then along.
    const off = cheapestPlacement({ item: 'tripwire', row0: 14, row1: 14, col0: 38, col1: 38 }, { row: 2, col: 0 });
    expect(off.cost).toBeLessThan(Infinity);
    expect(off.cost).toBeLessThanOrEqual(7);
    // Either end may be anchored first; the shorter wins.
    const c = cheapestPlacement(fence, { row: 12, col: 30 });
    expect(c.keys).toBe('2k<CR>2k<CR>');
  });

  it('scores a hit only on the exact span', () => {
    const t = (o: Partial<Trap>): Trap => ({ id: 1, kind: 'fence', row0: 8, row1: 10, col0: 30, col1: 30, charges: 3, ...o });
    expect(orderHit(fence, t({}))).toBe(true);
    expect(orderHit(fence, t({ row1: 9 }))).toBe(false);
    expect(orderHit(fence, t({ row1: 11 }))).toBe(false);
    expect(orderHit(fence, t({ col0: 31, col1: 31 }))).toBe(false);
    expect(orderHit(fence, t({ kind: 'minefield' }))).toBe(false);
  });

  it('every generated order is inside the grid, far from the crosshair, and reachable', () => {
    const f = familyById('placement')!;
    const rng = new Rng(21);
    let n = 0;
    while (n < 200) {
      const s = f.generate(rng);
      if (!s) continue;
      n++;
      const o = s.order!;
      expect(o.row0).toBeGreaterThanOrEqual(0); expect(o.row1).toBeLessThan(ROWS);
      expect(o.row0).toBeLessThanOrEqual(o.row1);
      expect(o.col0).toBeGreaterThanOrEqual(0); expect(o.col1).toBeLessThan(FIELD_COLS);
      expect(o.col0).toBeLessThanOrEqual(o.col1);
      if (o.item === 'fence') { expect(o.col0).toBe(o.col1); expect(o.row1 - o.row0).toBeGreaterThanOrEqual(1); }
      if (o.item === 'minefield') { expect(o.row0).toBe(o.row1); expect(o.col1 - o.col0).toBeGreaterThanOrEqual(4); }
      expect(Math.abs(s.cursor[0] - o.row0)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(s.cursor[1] - o.col0)).toBeGreaterThanOrEqual(8);
      const best = cheapestPlacement(o, { row: s.cursor[0], col: s.cursor[1] });
      expect(best.cost, orderText(o)).toBeLessThan(Infinity);
      expect(best.cost).toBeLessThanOrEqual(12);
    }
  });

  it('prints the order the way the strip does', () => {
    expect(orderText(fence)).toBe('fence  lanes 9..11  col 30');
    expect(orderText({ item: 'minefield', row0: 3, row1: 3, col0: 10, col1: 24 })).toBe('minefield  lane 4  cols 10..24');
    expect(orderText({ item: 'tripwire', row0: 12, row1: 12, col0: 40, col1: 40 })).toBe('tripwire  lane 13  col 40');
  });
});

// ---------------------------------------------------------------- the coach

describe('the coach', () => {
  const lt = (missed: Record<string, number>, used: Record<string, number> = {}): CoachInput => ({
    missed,
    motions: Object.fromEntries(Object.entries(used).map(([k, u]) => [k, { used: u }])),
  });

  it('never used outranks occasionally skipped', () => {
    // f: missed 12, never pressed. $: missed 12, pressed 300 times.
    const r = coach(lt({ f: 12, $: 12 }, { $: 300 }));
    expect(r.map((e) => e.family)).toEqual(['find', 'line-ends']);
    expect(r[0].token).toBe('f');
    expect(r[0].need).toBe(12);
    expect(r[1].need).toBeCloseTo(needOf(12, 300));
  });
  it('ignores tokens under the threshold', () => {
    const r = coach(lt({ 'i"': 2, 'a"': 2, "i'": COACH_MIN_MISSED - 1, f: 3 }));
    expect(r.map((e) => e.family)).toEqual(['find']);
  });
  it('returns nothing for an empty ledger, and every surface says so', () => {
    expect(coach(lt({}))).toEqual([]);
    expect(coachLine([])).toBe(COACH_QUIET);
  });
  it('breaks ties by curriculum order and stops at three', () => {
    const r = coach(lt({ 'i"': 5, f: 5, '}': 5, '*': 5, iw: 5 }));
    expect(r).toHaveLength(3);
    expect(r.map((e) => e.family)).toEqual(['find', 'paragraph', 'search']);
  });
  it('tokens outside every family are ignored', () => {
    expect(coach(lt({ w: 400, l: 900, d: 50 }))).toEqual([]);
  });
  it('placement is ranked from the counted motions, after counts', () => {
    const r = coach(lt({ '{n}': 9, f: 1 }));
    expect(r.map((e) => e.family)).toEqual(['counts', 'placement']);
    expect(r[1].need).toBe(r[0].need);
  });
  it('the death line names the top family and its keys', () => {
    const line = coachLine(coach(lt({ f: 12 })));
    expect(line).toContain('find');
    expect(line).toContain('f t ;');
    ok(line, 'coach line');
  });
});

// ---------------------------------------------------------------- the sprint

import { Game } from '../src/harness/api';
import { DRILL_MS } from '../src/sim/drills';
import type { GameEvent } from '../src/core/types';

function drill(id: string, seed = 1): Game {
  const g = new Game(seed, { autoStart: false });
  g.sim.startDrill(id);
  g.bus.drain();
  return g;
}

const kills = (evs: GameEvent[]) => evs.filter((e) => e.t === 'kill');

describe('drill mode rules', () => {
  it('starts in drill mode on a frozen field with an empty magazine and the clock full', () => {
    const g = drill('find');
    const st = g.json();
    expect(st.sim.mode).toBe('drill');
    expect(st.phase).toBe('playing');
    expect(st.sim.drill).toBe('find');
    expect(st.sim.drillLeft).toBe(DRILL_MS);
    expect(st.charges).toEqual({ dd: 0, D: 0 });
    for (const z of st.buffer.zombies) expect(z.speed).toBe(0);
    expect(st.buffer.zombies.some((z) => z.id === st.sim.drillTarget)).toBe(true);
    expect(g.text()).toContain('DRILL find');
  });

  it('the wall cannot fall: a full minute with no input ends by the clock', () => {
    const g = drill('vertical');
    const hp = g.json().barricade.hp;
    const evs = g.step(DRILL_MS + 500);
    const st = g.json();
    expect(st.barricade.hp).toBe(hp);
    expect(st.phase).toBe('stats');
    expect(st.sim.drillLeft).toBe(0);
    const done = evs.find((e) => e.t === 'drill_done');
    expect(done).toEqual({ t: 'drill_done', family: 'vertical', kills: 0, perfect: 0, scenes: 0 });
    expect(evs.some((e) => e.t === 'death')).toBe(false);
    expect(g.text()).toContain('DRILL OVER  vertical');
  });

  it('killing the target clears the scene and deals the next in the same tick', () => {
    const g = drill('word-objects');
    const st = g.json();
    const before = st.buffer.zombies.map((z) => z.id);
    const target = st.buffer.zombies.find((z) => z.id === st.sim.drillTarget)!;
    const evs = g.keys('diw');
    expect(kills(evs).some((e) => e.t === 'kill' && e.zombieId === target.id)).toBe(true);
    const after = g.json();
    expect(after.sim.drillScenes).toBe(1);
    expect(after.sim.kills).toBe(1);
    // a new scene, with a new target, dealt without a tick
    expect(after.sim.drillTarget).not.toBe(target.id);
    expect(after.buffer.zombies.some((z) => z.id === after.sim.drillTarget)).toBe(true);
    expect(after.buffer.zombies.every((z) => !before.includes(z.id))).toBe(true);
    // the oracle's own answer is PERFECT
    expect(after.sim.drillPerfect).toBe(1);
  });

  it('killing a non-target counts a kill but not a scene', () => {
    // A find scene has several words on one lane; the cursor stands on one of
    // them that is not the target.
    const g = drill('find');
    const st = g.json();
    const on = st.buffer.zombies.find((z) => z.row === st.cursor.row && z.col === st.cursor.col)!;
    expect(on).toBeDefined();
    expect(on.id).not.toBe(st.sim.drillTarget);
    // `cw`, not `dw`: the next word is far enough that `dw` would sweep the
    // gap and want a D charge, which a drill does not have.
    const evs = g.keys('cw');
    expect(kills(evs)).toHaveLength(1);
    expect(g.json().sim.kills).toBe(1);
    expect(g.json().sim.drillScenes).toBe(0);
    expect(g.json().sim.drillTarget).toBe(st.sim.drillTarget);
  });

  it('r with nothing pending replaces the scene without credit; mid-command it is a key', () => {
    const g = drill('search');
    const st = g.json();
    const ids = st.buffer.zombies.map((z) => z.id);
    g.keys('r');
    const next = g.json();
    expect(next.sim.drillScenes).toBe(0);
    expect(next.buffer.zombies.every((z) => !ids.includes(z.id))).toBe(true);
    // `dr` is a half-typed `d` plus an unknown motion: no new scene
    const ids2 = next.buffer.zombies.map((z) => z.id);
    g.keys('d');
    expect(g.pending()).toBe('d');
    g.keys('r');
    expect(g.json().buffer.zombies.map((z) => z.id)).toEqual(ids2);
  });

  it('every scene begins with the drill magazine, whatever was spent', () => {
    const g = drill('counts');
    g.json().charges.dd = 1;
    g.keys('r');
    expect(g.json().charges).toEqual({ dd: 0, D: 0 });
    // and a charge answer is refused rather than run
    const evs = g.keys('dd');
    expect(evs.some((e) => e.t === 'combo_break' && e.refused)).toBe(true);
    expect(g.json().sim.drillScenes).toBe(0);
  });

  it('the clock runs down while playing and the family keeps dealing', () => {
    const g = drill('brackets');
    g.step(1000);
    expect(g.json().sim.drillLeft).toBeCloseTo(DRILL_MS - 1000, -1);
    let scenes = 0;
    for (let i = 0; i < 5; i++) {
      const st = g.json();
      const target = st.buffer.zombies.find((z) => z.id === st.sim.drillTarget)!;
      const best = sceneAnswers({
        spawn: st.buffer.zombies.map((z) => [z.kind, z.row, z.col, z.text, 0]),
        cursor: [st.cursor.row, st.cursor.col],
        target: st.buffer.zombies.indexOf(target),
      })[0];
      expect(best, 'the live scene has an oracle answer').toBeDefined();
      g.keys(best.keys);
      scenes++;
      expect(g.json().sim.drillScenes).toBe(scenes);
      expect(g.json().sim.drillPerfect).toBe(scenes);
    }
  });

  it('is deterministic under a seed, scenes, kills and score alike', () => {
    const play = (): string => {
      const g = drill('find', 77);
      const out: unknown[] = [];
      for (let i = 0; i < 12; i++) {
        const st = g.json();
        const target = st.buffer.zombies.find((z) => z.id === st.sim.drillTarget);
        if (!target) break;
        const best = sceneAnswers({
          spawn: st.buffer.zombies.map((z) => [z.kind, z.row, z.col, z.text, 0]),
          cursor: [st.cursor.row, st.cursor.col],
          target: st.buffer.zombies.indexOf(target),
        })[0];
        out.push(g.keys(i % 4 === 3 ? 'r' : best.keys));
        out.push(g.step(700));
      }
      out.push(g.json());
      return JSON.stringify(out);
    };
    expect(play()).toBe(play());
    const a = drill('find', 1); const b = drill('find', 2);
    expect(JSON.stringify(a.json().buffer)).not.toBe(JSON.stringify(b.json().buffer));
  });

  it('the end card takes r to run again and Esc back to the drills list', () => {
    const g = drill('quotes');
    g.step(DRILL_MS + 100);
    expect(g.json().phase).toBe('stats');
    g.keys('x');                                   // nothing else does anything
    expect(g.json().phase).toBe('stats');
    g.keys('r');
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.drill).toBe('quotes');
    expect(g.json().sim.drillLeft).toBe(DRILL_MS);
    g.step(DRILL_MS + 100);
    g.keys('<Esc>');
    expect(g.json().phase).toBe('menu');
    expect(g.menu.screen).toBe('drills');
    expect(g.menu.row?.id).toBe('quotes');
    expect(g.json().sim.drill).toBe('');
  });

  it('starts from the menu row through keys() like a player', () => {
    const g = new Game(3, { autoStart: false });
    g.keys('jj<CR>');                              // drills
    expect(g.menu.screen).toBe('drills');
    expect(g.text()).toContain('MENU drills');
    g.keys('3G<CR>');                              // the third family
    expect(g.json().sim.mode).toBe('drill');
    expect(g.json().sim.drill).toBe(FAMILIES[2].id);
  });

  it('text() shows the clock, the score and marks the target', () => {
    const g = drill('line-ends');
    const st = g.json();
    st.sim.drillLeft = 41_300;
    st.sim.kills = 6;
    st.sim.drillPerfect = 4;
    st.sim.drillScenes = 5;
    const t = g.text();
    expect(t).toMatch(/^DRILL line-ends  41s left  kills 6  perfect 4  scenes 5  target #\d+ /m);
    const target = st.buffer.zombies.find((z) => z.id === st.sim.drillTarget)!;
    const marked = t.split('\n').filter((l) => l.endsWith('<-- target'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain(target.text);
    expect(t).toContain('0 ^ $ :');
  });
});

describe('the placement drill', () => {
  function order(g: Game) { return g.json().sim.drillOrder!; }

  it('opens in the store placement mode with the order armed and the clock running', () => {
    const g = drill('placement');
    const st = g.json();
    expect(st.phase).toBe('shop');
    expect(st.sim.shop.mode).toBe('place');
    expect(st.sim.shop.item).toBe(order(g).item);
    expect(st.sim.drillOrder).not.toBeNull();
    expect(g.text()).toContain(`ORDER ${orderText(order(g))}`);
    g.step(2000);
    expect(g.json().sim.drillLeft).toBeCloseTo(DRILL_MS - 2000, -1);
    expect(g.json().phase).toBe('shop');
  });

  it('an exact span is a hit, PERFECT at the cheapest keys, and the next order is dealt', () => {
    const g = drill('placement', 5);
    const o = order(g);
    const st = g.json();
    const best = cheapestPlacement(o, st.cursor);
    g.keys(best.keys);
    const after = g.json();
    expect(after.sim.kills).toBe(1);
    expect(after.sim.drillScenes).toBe(1);
    expect(after.sim.drillPerfect).toBe(1);
    expect(after.sim.drillOrder).not.toEqual(o);
    expect(after.sim.traps).toEqual([]);
    expect(after.phase).toBe('shop');
  });

  it('a wrong span is a miss and still deals the next order', () => {
    const g = drill('placement', 5);
    const o = order(g);
    // Land on the right anchor, then span one lane or column short.
    const st = g.json();
    const reach = cheapestPlacement({ ...o, row1: o.row0, col1: o.col0, item: 'tripwire' }, st.cursor).keys;
    if (o.item === 'tripwire') {
      g.keys(`${reach.replace('<CR>', '')}l<CR>`);
    } else {
      g.keys(reach);                                 // anchors
      const span = o.item === 'fence' ? o.row1 - o.row0 - 1 : o.col1 - o.col0 - 1;
      g.keys(`${span > 1 ? span : ''}${o.item === 'fence' ? 'j' : 'l'}<CR>`);
    }
    const after = g.json();
    expect(after.sim.kills).toBe(0);
    expect(after.sim.drillScenes).toBe(0);
    expect(after.sim.drillPerfect).toBe(0);
    expect(after.sim.drillOrder).not.toEqual(o);
    expect(after.phase).toBe('shop');
  });

  it('r deals the next order and Esc only clears the anchor', () => {
    const g = drill('placement', 9);
    const o = order(g);
    g.keys('<CR>');
    expect(g.json().sim.shop.anchor).not.toBeNull();
    g.keys('<Esc>');
    expect(g.json().sim.shop.anchor).toBeNull();
    expect(g.json().phase).toBe('shop');
    g.keys('r');
    expect(g.json().sim.drillOrder).not.toEqual(o);
    expect(g.json().sim.drillScenes).toBe(0);
  });

  it('ends by the clock like every other family', () => {
    const g = drill('placement');
    const evs = g.step(DRILL_MS + 100);
    expect(g.json().phase).toBe('stats');
    expect(evs.some((e) => e.t === 'drill_done')).toBe(true);
    expect(g.text()).toContain('DRILL OVER  placement');
  });
});

// ---------------------------------------------------------------- persistence

import { SaveStore, beatsDrill, recordDrill } from '../src/save/save';
import { defaultSave } from '../src/save/schema';

describe('drill bests in the save', () => {
  it('a new best replaces the record and reports true', () => {
    const store = new SaveStore(defaultSave());
    store.get().drills.find = { best: 19, perfect: 4 };
    expect(recordDrill(store, 'find', 22, 3)).toBe(true);
    expect(store.get().drills.find).toEqual({ best: 22, perfect: 3 });
    // equal kills, more PERFECTs, is a best too
    expect(recordDrill(store, 'find', 22, 9)).toBe(true);
    expect(store.get().drills.find).toEqual({ best: 22, perfect: 9 });
    // the first run of a family is a best if it scored anything
    expect(recordDrill(store, 'search', 1, 0)).toBe(true);
    expect(recordDrill(store, 'quotes', 0, 0)).toBe(false);
    expect(store.get().drills.quotes).toBeUndefined();
  });
  it('not a best leaves the save untouched and reports false', () => {
    const store = new SaveStore(defaultSave());
    store.get().drills.find = { best: 19, perfect: 4 };
    const before = JSON.stringify(store.get().drills);
    expect(recordDrill(store, 'find', 15, 15)).toBe(false);
    expect(recordDrill(store, 'find', 19, 4)).toBe(false);
    expect(recordDrill(store, 'find', 19, 2)).toBe(false);
    expect(JSON.stringify(store.get().drills)).toBe(before);
    expect(beatsDrill(19, 5, { best: 19, perfect: 4 })).toBe(true);
    expect(beatsDrill(NaN, 0, undefined)).toBe(false);
  });
});
