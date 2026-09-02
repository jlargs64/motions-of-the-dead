import { describe, expect, it } from 'vitest';
import { Game } from '../src/harness/api';
import { barricadeGlyphs } from '../src/core/field';
import { CURRICULUM, LESSON_COUNT, composition, waveDef } from '../src/sim/waves';
import { TUTORIAL } from '../src/sim/tutorial';
import { optimalKill } from '../src/sim/optimal';
import { BLOATERS, CRAWLERS, RUNNERS, WALKERS } from '../src/sim/words';
import { goreBlurb, goreLabel } from '../src/ui/settings';
import type { GameEvent, Zombie, ZombieKind } from '../src/core/types';
import { BARRICADE_COL, FIELD_COLS } from '../src/core/field';

type Spec = [ZombieKind, number, number, string];

/** A frozen scene: no spawns, no movement, just the zombies you name. */
function scene(specs: Spec[], seed = 1): Game {
  const g = new Game(seed);
  const st = g.json();
  st.sim.spawnQueue.length = 0;
  st.buffer.zombies.length = 0;
  let id = 1;
  for (const [kind, row, col, text] of specs) {
    const z: Zombie = { id: id++, kind, row, col, text, hp: kind === 'armored' ? 2 : 1, speed: 0 };
    st.buffer.zombies.push(z);
  }
  place(g, 0, 0);
  return g;
}

function place(g: Game, row: number, col: number): void {
  const st = g.json();
  g.sim.tick(0);
  st.cursor.row = row;
  st.cursor.col = col;
}

const kills = (evs: GameEvent[]) => evs.filter((e) => e.t === 'kill');
const has = (evs: GameEvent[], t: GameEvent['t']) => evs.some((e) => e.t === t);

describe('kill resolution', () => {
  it('a covering operator kills a walker', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 10);
    const k = kills(g.keys('dw'));
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ kind: 'walker', overkill: false });
  });

  it('a partial hit whittles the word instead of missing', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 10);
    const evs = g.keys('x');
    expect(kills(evs)).toHaveLength(0);
    expect(has(evs, 'combo_break')).toBe(false);
    const z = g.json().buffer.zombies[0];
    expect(z.text).toBe('hamble');
    expect(z.col).toBe(11);          // survivors keep their columns
  });

  it('x eats a word one character at a time, from wherever you aim', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 16);                  // the leading edge, nearest the wall
    for (let i = 0; i < 6; i++) g.keys('x');
    expect(g.json().buffer.zombies[0].text).toBe('s');
    expect(kills(g.keys('x'))).toHaveLength(1);
  });

  it('erosion closes the gap when you carve out the middle', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 12);
    g.keys('3x');
    const z = g.json().buffer.zombies[0];
    expect(z.text).toBe('shle');
    expect(z.col).toBe(10);
  });

  it('whittling costs no charge, however wide the sweep', () => {
    const g = scene([['bloater', 5, 40, 'putrescent']]);
    place(g, 5, 44);
    g.keys('d$');
    expect(g.json().charges.D).toBe(3);
    expect(g.json().buffer.zombies[0].text).toBe('putr');
  });

  it('an operator that touches nothing at all still misses', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 30);
    const evs = g.keys('x');
    expect(kills(evs)).toHaveLength(0);
    expect(has(evs, 'combo_break')).toBe(true);
  });

  it('armor still chips rather than eroding', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 12);
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.text).toBe('(lurch)');
    expect(z.hp).toBe(1);
  });

  it('armored survives a plain operator and loses a bracket', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 10);
    const evs = g.keys('dw');
    expect(kills(evs)).toHaveLength(0);
    expect(g.json().buffer.zombies[0].hp).toBe(1);
  });

  it('two plain hits strip armor down to a walker', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 10);
    g.keys('x');
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.kind).toBe('walker');
    expect(z.text).toBe('lurch');
  });

  it('a text object kills armored outright', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 12);
    const k = kills(g.keys('di('));
    expect(k).toHaveLength(1);
    expect(k[0]).toMatchObject({ kind: 'armored', overkill: false });
  });

  it('diw also counts as a text object against armor', () => {
    const g = scene([['armored', 5, 10, '"creep"']]);
    place(g, 5, 12);
    expect(kills(g.keys('diw'))).toHaveLength(1);
  });

  it('x kills a crawler cleanly', () => {
    const g = scene([['crawler', 5, 10, 'z']]);
    place(g, 5, 10);
    const k = kills(g.keys('x'));
    expect(k[0].overkill).toBe(false);
  });

  it('anything but x overkills a crawler and breaks the combo', () => {
    const g = scene([['crawler', 5, 10, 'z']]);
    place(g, 5, 10);
    const evs = g.keys('dw');
    expect(kills(evs)[0].overkill).toBe(true);
    expect(has(evs, 'combo_break')).toBe(true);
    expect(g.json().combo).toBe(0);
  });

  it('dd bursts a bloater and everything sharing its row', () => {
    const g = scene([['bloater', 5, 4, 'putrescent'], ['walker', 5, 20, 'gore'], ['walker', 6, 4, 'moan']]);
    place(g, 5, 4);
    const k = kills(g.keys('dd'));
    expect(k).toHaveLength(2);
    expect(g.json().buffer.zombies.map((z) => z.text)).toEqual(['moan']);
  });

  it('dw carves a single word out of a bloater row without splash', () => {
    const g = scene([['bloater', 5, 4, 'putrescent'], ['walker', 5, 20, 'gore']]);
    place(g, 5, 4);
    const k = kills(g.keys('dw'));
    expect(k).toHaveLength(1);
    expect(k[0].kind).toBe('bloater');
  });
});

describe('charges', () => {
  it('dd is limited to two per wave', () => {
    const g = scene([['walker', 1, 0, 'aa'], ['walker', 2, 0, 'bb'], ['walker', 3, 0, 'cc']]);
    place(g, 1, 0); expect(has(g.keys('dd'), 'charge_used')).toBe(true);
    place(g, 2, 0); expect(has(g.keys('dd'), 'charge_used')).toBe(true);
    place(g, 3, 0);
    const evs = g.keys('dd');
    expect(has(evs, 'charge_used')).toBe(false);
    expect(kills(evs)).toHaveLength(0);
    expect(has(evs, 'combo_break')).toBe(true);
    expect(g.json().buffer.zombies).toHaveLength(1);
  });

  it('a wide sweep costs a D charge even when spelled d$', () => {
    const g = scene([['walker', 5, 40, 'gore']]);
    place(g, 5, 0);
    const evs = g.keys('d$');
    expect(has(evs, 'charge_used')).toBe(true);
    expect(kills(evs)).toHaveLength(1);
  });

  it('a tight cut is free', () => {
    const g = scene([['walker', 5, 40, 'gore']]);
    place(g, 5, 40);
    const evs = g.keys('dw');
    expect(has(evs, 'charge_used')).toBe(false);
    expect(g.json().charges.D).toBe(3);
  });

  it('charges reset on the next wave', () => {
    const g = scene([['walker', 1, 0, 'aa']]);
    place(g, 1, 0);
    g.keys('dd');
    expect(g.json().charges.dd).toBe(1);
    g.step(5000);                    // wave clear + breather + next wave
    expect(g.json().charges.dd).toBe(2);
    expect(g.json().wave).toBe(2);
  });
});

describe('combo and score', () => {
  it('counts up while kills stay inside the window', () => {
    const g = scene([['walker', 5, 0, 'aa'], ['walker', 5, 4, 'bb'], ['walker', 5, 8, 'cc']]);
    place(g, 5, 0); g.keys('dw');
    place(g, 5, 4); g.keys('dw');
    expect(g.json().combo).toBe(2);
    place(g, 5, 8); g.keys('dw');
    expect(g.json().combo).toBe(3);
    expect(g.json().sim.longestCombo).toBe(3);
  });

  it('times out after 2.5s', () => {
    const g = scene([['walker', 5, 0, 'aa'], ['walker', 5, 4, 'bb']]);
    place(g, 5, 0); g.keys('dw');
    expect(g.json().combo).toBe(1);
    g.step(2600);
    expect(g.json().combo).toBe(0);
  });

  it('scores 10 x length x (1 + combo/10)', () => {
    const g = scene([['walker', 5, 0, 'shamble']]);
    place(g, 5, 0);
    g.keys('dw');
    expect(g.json().score).toBe(Math.round(10 * 7 * 1.1));
  });

  it('an unknown key breaks the combo', () => {
    const g = scene([['walker', 5, 0, 'aa']]);
    place(g, 5, 0); g.keys('dw');
    expect(g.json().combo).toBe(1);
    g.keys('q');
    expect(g.json().combo).toBe(0);
  });

  it('plain movement does not break the combo', () => {
    const g = scene([['walker', 5, 0, 'aa'], ['walker', 6, 0, 'bb']]);
    place(g, 5, 0); g.keys('dw');
    g.keys('jjkkw0$');
    expect(g.json().combo).toBe(1);
  });
});

describe('J crushes', () => {
  it('merges the lane below and crushes anything that lands on top', () => {
    const g = scene([['walker', 5, 0, 'aaa'], ['walker', 6, 1, 'bbb'], ['walker', 6, 20, 'ccc']]);
    place(g, 5, 0);
    const k = kills(g.keys('J'));
    expect(k).toHaveLength(1);
    const left = g.json().buffer.zombies;
    expect(left.map((z) => `${z.text}@${z.row}`).sort()).toEqual(['aaa@5', 'ccc@5']);
  });

  it('costs no charge', () => {
    const g = scene([['walker', 5, 0, 'aaa'], ['walker', 6, 1, 'bbb']]);
    place(g, 5, 0);
    g.keys('J');
    expect(g.json().charges).toEqual({ dd: 2, D: 3 });
  });

  it('does nothing off the bottom lane', () => {
    const g = scene([['walker', 15, 0, 'aaa']]);
    place(g, 15, 0);
    expect(has(g.keys('J'), 'combo_break')).toBe(true);
  });
});

describe('* clears families', () => {
  it('jumps to the next zombie with the same word, then . finishes it', () => {
    const g = scene([['walker', 2, 4, 'shamble'], ['walker', 9, 30, 'shamble'], ['walker', 5, 8, 'gore']]);
    place(g, 2, 4);
    expect(kills(g.keys('dw'))).toHaveLength(1);
    // the corpse is gone, so * from here finds the other shamble
    place(g, 2, 0);
    g.json().buffer.zombies.unshift({ id: 90, kind: 'walker', row: 2, col: 0, text: 'shamble', hp: 1, speed: 0 });
    g.sim.tick(0);
    g.keys('*');
    expect(g.json().cursor).toEqual({ row: 9, col: 30 });
    expect(kills(g.keys('.'))).toHaveLength(1);
  });
});

describe('the lanes run west to east', () => {
  it('a zombie walks toward the wall, one column at a time', () => {
    const g = scene([['walker', 5, 0, 'moan']]);
    g.json().buffer.zombies[0].speed = 2;   // 2 columns a second
    g.step(1100);
    expect(g.json().buffer.zombies[0].col).toBe(2);
    expect(g.json().buffer.zombies[0].row).toBe(5);   // lanes never change on their own
  });

  it('zombies queue up behind each other instead of overlapping', () => {
    const g = scene([['walker', 5, 10, 'aaaa'], ['walker', 5, 16, 'bbbb']]);
    for (const z of g.json().buffer.zombies) z.speed = 4;
    g.step(3000);
    const [a, b] = g.json().buffer.zombies;
    expect(b.col).toBeGreaterThan(a.col + a.text.length);   // still a clear gap
  });

  it('spawns enter at column 0', () => {
    const g = new Game(4);
    g.step(30_000);
    expect(g.json().sim.spawnedThisWave).toBeGreaterThan(0);
    expect(g.json().buffer.zombies.every((z) => z.col >= 0 && z.col < FIELD_COLS)).toBe(true);
  });
});

describe('barricade', () => {
  it('takes text.length damage when a zombie reaches the wall', () => {
    const g = scene([['bloater', 5, BARRICADE_COL - 11, 'putrescent']]);
    g.json().buffer.zombies[0].speed = 100;
    const evs = g.step(100);
    const hit = evs.find((e) => e.t === 'barricade_hit');
    expect(hit).toMatchObject({ dmg: 10, hpLeft: 90 });
  });

  it('death fires at 0 hp', () => {
    const g = scene([['walker', 5, BARRICADE_COL - 5, 'moan']]);
    g.json().barricade.hp = 3;
    g.json().buffer.zombies[0].speed = 100;
    const evs = g.step(100);
    expect(has(evs, 'death')).toBe(true);
    expect(g.isOver()).toBe(true);
  });

  it('the wall is one glyph per lane and degrades', () => {
    const g = scene([]);
    const full = barricadeGlyphs({ hp: 100, maxHp: 100 });
    expect(full).toHaveLength(16);
    expect(full).toBe('#'.repeat(16));
    expect(barricadeGlyphs({ hp: 0, maxHp: 100 })).toBe(' '.repeat(16));
    void g;
  });
});

describe('shots', () => {
  it('an operator emits one shot per affected lane', () => {
    const g = scene([['walker', 5, 10, 'gore']]);
    place(g, 5, 10);
    const shots = g.keys('dw').filter((e) => e.t === 'shot');
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ row: 5, colStart: 10, colEnd: 14, hits: 1 });
  });

  it('a miss still fires a shot, with no hits', () => {
    const g = scene([['walker', 5, 10, 'gore']]);
    place(g, 5, 30);
    const shots = g.keys('x').filter((e) => e.t === 'shot');
    expect(shots).toHaveLength(0);   // nothing to delete at all: the gun never fired
    const shots2 = g.keys('0dw').filter((e) => e.t === 'shot');
    expect(shots2.length).toBeGreaterThan(0);
    expect(shots2[0].hits).toBe(0);
  });

  it('dj fires into two lanes', () => {
    const g = scene([['walker', 5, 10, 'gore'], ['walker', 6, 10, 'moan']]);
    place(g, 5, 10);
    const shots = g.keys('dj').filter((e) => e.t === 'shot');
    expect(shots.map((s) => s.row)).toEqual([5, 6]);
  });
});

describe('waves', () => {
  it('wave 1 is walkers only and announces its motions', () => {
    const g = new Game(7);
    g.step(19_000);
    const kinds = new Set(g.json().buffer.zombies.map((z) => z.kind));
    expect([...kinds].every((k) => k === 'walker')).toBe(true);
  });

  it('wave size is 6 + 2N', () => {
    expect(new Game(3).json().sim.waveSize).toBe(8);
  });

  it('the curriculum follows vim-hero, section by section', () => {
    expect(waveDef(1).section).toBe('Basic Vim');
    expect(waveDef(1).title).toBe('Basic Movement');
    expect(waveDef(4).title).toBe('Delete Words');
    expect(waveDef(11).title).toBe('Find Character');
    expect(waveDef(18).section).toBe('Search');
    expect(waveDef(22).section).toBe('Text Objects - Brackets');
    expect(waveDef(30).title).toBe('Delete Inside Word');
    expect(waveDef(LESSON_COUNT).review).toBe(true);
    expect(waveDef(LESSON_COUNT + 1).section).toBe('The Long Night');
  });

  it('armored only show up once text objects are taught', () => {
    for (let w = 1; w <= 21; w++) {
      expect(composition(w).some(([k]) => k === 'armored'), `wave ${w}`).toBe(false);
    }
    expect(composition(22).some(([k]) => k === 'armored')).toBe(true);
  });
});

describe('determinism', () => {
  it('two games on the same seed stay identical through a long run', () => {
    const a = new Game(42);
    const b = new Game(42);
    for (let i = 0; i < 60; i++) {
      a.step(250); b.step(250);
      a.keys('wdw'); b.keys('wdw');
    }
    expect(JSON.stringify(a.json())).toBe(JSON.stringify(b.json()));
  });

  it('different seeds diverge', () => {
    const a = new Game(1); const b = new Game(2);
    a.step(8000); b.step(8000);
    expect(JSON.stringify(a.json())).not.toBe(JSON.stringify(b.json()));
  });
});

describe('the cursor is a gun sight, not a text caret (virtualedit=all)', () => {
  it('l walks right across a completely blank row', () => {
    const g = scene([]);
    place(g, 5, 0);
    g.keys('lllll');
    expect(g.json().cursor.col).toBe(5);
    g.keys('10l');
    expect(g.json().cursor.col).toBe(15);
  });

  it('l stops at the eastern edge of the field', () => {
    const g = scene([]);
    place(g, 5, 0);
    g.keys('99l');
    expect(g.json().cursor.col).toBe(FIELD_COLS - 1);
  });

  it('h comes back from empty space', () => {
    const g = scene([]);
    place(g, 5, 40);
    g.keys('7h');
    expect(g.json().cursor.col).toBe(33);
  });

  it('the cursor holds its column when the word under it walks away', () => {
    const g = scene([['walker', 5, 24, 'shamble']]);
    place(g, 5, 24);
    g.json().buffer.zombies[0].speed = 1;
    g.step(2200);
    expect(g.json().buffer.zombies[0].col).toBe(26);   // it moved on east
    expect(g.json().cursor).toEqual({ row: 5, col: 24 });   // you did not
  });

  it('the cursor holds its column when the word under it dies', () => {
    const g = scene([['walker', 5, 24, 'shamble'], ['walker', 5, 40, 'gore']]);
    place(g, 5, 40);
    g.keys('dw');
    g.step(300);
    expect(g.json().cursor.col).toBe(40);
  });

  it('j and k carry the column across blank rows', () => {
    const g = scene([['walker', 9, 30, 'gore']]);
    place(g, 2, 30);
    g.keys('7j');
    expect(g.json().cursor).toEqual({ row: 9, col: 30 });
    g.keys('7k');
    expect(g.json().cursor).toEqual({ row: 2, col: 30 });
  });

  it('you can walk onto a word from empty space and kill it', () => {
    const g = scene([['walker', 5, 8, 'gore']]);
    place(g, 5, 0);
    g.keys('8l');
    expect(g.json().cursor.col).toBe(8);
    const evs = g.keys('dw');
    expect(evs.filter((e) => e.t === 'kill')).toHaveLength(1);
  });

  it('an operator fired into empty space still whiffs harmlessly', () => {
    const g = scene([['walker', 5, 8, 'gore']]);
    place(g, 5, 40);
    const evs = g.keys('dw');
    expect(evs.filter((e) => e.t === 'kill')).toHaveLength(0);
    expect(g.json().charges.D).toBe(3);
  });
});

describe('target lock', () => {
  it('the crosshair rides the word it is on', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 12);
    g.keys('l');                              // re-acquire at offset 3
    expect(g.json().sim.lockId).toBe(1);
    g.json().buffer.zombies[0].speed = 2;
    g.step(2100);
    expect(g.json().buffer.zombies[0].col).toBe(14);
    expect(g.json().cursor.col).toBe(17);     // still 3 into the word
  });

  it('drops when you step off the word', () => {
    const g = scene([['walker', 5, 10, 'gore']]);
    place(g, 5, 10);
    g.keys('l');
    expect(g.json().sim.lockId).toBe(1);
    g.keys('20l');
    expect(g.json().sim.lockId).toBe(0);
  });

  it('drops when the word dies, leaving the crosshair put', () => {
    const g = scene([['walker', 5, 10, 'gore']]);
    place(g, 5, 10);
    g.keys('dw');
    g.step(300);
    expect(g.json().sim.lockId).toBe(0);
    expect(g.json().cursor.col).toBe(10);
  });

  it('never drags the crosshair off the field', () => {
    const g = scene([['walker', 5, 44, 'putrescent']]);
    place(g, 5, 53);
    g.keys('h');
    g.json().buffer.zombies[0].speed = 20;
    g.step(1000);
    const c = g.json().cursor;
    expect(c.col).toBeGreaterThanOrEqual(0);
    expect(c.col).toBeLessThan(FIELD_COLS);
  });
});

describe('the warm-up', () => {
  it('runs every step and then rolls into wave 1 with a clean slate', () => {
    const g = new Game(1, { autoStart: false });
    g.keys('t');
    expect(g.json().sim.tutorial).toBe(0);
    expect(g.json().wave).toBe(0);
    let guard = 0;
    const seen = new Set<number>();
    while (g.json().sim.tutorial >= 0 && guard++ < 6000) {
      const st = g.json();
      seen.add(st.sim.tutorial);
      const zs = st.buffer.zombies;
      if (st.sim.tutorialHold > 0 || !zs.length) { g.step(100); continue; }
      const t = zs[zs.length - 1];
      const o = optimalKill(st.buffer, st.cursor, t, st.charges);
      if (!o) { g.step(100); continue; }
      g.keys(o.keys); g.step(150);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(g.json().wave).toBe(1);
    expect(g.json().score).toBe(0);
    expect(g.json().sim.kills).toBe(0);
    expect(g.json().barricade.hp).toBe(100);
  }, 20_000);

  it('the wall cannot be breached during the warm-up', () => {
    const g = new Game(1, { autoStart: false });
    g.keys('t');
    for (const z of g.json().buffer.zombies) { z.speed = 200; }
    g.step(2000);
    expect(g.json().barricade.hp).toBe(100);
    expect(g.isOver()).toBe(false);
  });

  it('a player who already knows dw is not stranded on step 1', () => {
    const g = new Game(1, { autoStart: false });
    g.keys('t');
    const z = g.json().buffer.zombies[0];
    g.json().cursor.row = z.row; g.json().cursor.col = z.col;
    g.keys('dw');
    g.step(1200);
    expect(g.json().sim.tutorial).toBe(1);
  });

  it('every step stands up its own horde', () => {
    for (const s of TUTORIAL) expect(s.spawn.length).toBeGreaterThan(0);
  });
});

describe('everything drawn on the canvas is printable ASCII', () => {
  // The glyph atlas only bakes char codes 32..127. An em dash silently
  // renders as a blank, which is exactly how it shipped once.
  const ok = (s: string, where: string) => {
    for (const ch of s) {
      expect(ch.charCodeAt(0), `${where}: ${JSON.stringify(ch)} in ${JSON.stringify(s)}`)
        .toBeLessThan(127);
      expect(ch.charCodeAt(0)).toBeGreaterThanOrEqual(32);
    }
  };
  it('the curriculum', () => {
    for (const d of CURRICULUM) {
      ok(d.section, 'section'); ok(d.title, 'title'); ok(d.desc, 'desc'); ok(d.brief, 'brief');
      for (const k of d.keys) ok(k, 'keycap');
    }
  });
  it('the warm-up', () => {
    for (const s of TUTORIAL) {
      ok(s.title, 'title'); ok(s.hint, 'hint');
      for (const k of s.keys) ok(k, 'keycap');
      for (const [, , , text] of s.spawn) ok(text, 'zombie');
    }
  });
  it('every word the horde is built from', () => {
    for (const w of [...WALKERS, ...RUNNERS, ...BLOATERS, ...CRAWLERS]) ok(w, 'word');
  });
  it('the gore labels', () => {
    for (const g of ['off', 'low', 'full'] as const) { ok(goreLabel(g), 'label'); ok(goreBlurb(g), 'blurb'); }
  });
});
