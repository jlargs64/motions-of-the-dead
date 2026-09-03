import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/harness/api';
import { barricadeGlyphs } from '../src/core/field';
import { BARRICADE_MAX, CHARGES_DD as CHARGES_DD_MAX, createState } from '../src/core/state';
import { CURRICULUM, LESSON_COUNT, composition, waveDef } from '../src/sim/waves';
import { MISSIONS, MISSION_HOLD_MS, missionIndex, starsFor } from '../src/sim/missions';
import { missionPar, optimalKill, parFor, splitKeys } from '../src/sim/optimal';
import {
  BREACH, CALLED_SHOT, FIRST_BLOOD, MULTI_KILL_BONUS, MULTI_KILL_MIN,
  MULTI_KILL_NAMES, PERFECT, SNIPE, STYLE_BONUS, allMedalNames, medalTier,
  salvageFor,
} from '../src/sim/medals';
import { BLOATERS, CRAWLERS, RUNNERS, WALKERS } from '../src/sim/words';
import {
  CARD_LINE, FLARE_SPEED, ITEMS, ITEM_IDS, NEXT_ROW, SHOP_ROWS, itemById,
  manifestCard, manifestLine,
} from '../src/sim/store';
import { SURVEY_RULER } from '../src/sim/traps';
import { baseSpeed, waveSize } from '../src/sim/waves';
import { goreBlurb, goreLabel } from '../src/ui/settings';
import { NEXT_NIGHT_BLURB, Screens } from '../src/ui/screens';
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

/**
 * One turn of a mission, whatever kind it is. DONE takes `n` for the next
 * one. The placement mission cannot be finished by killing things, so
 * anything walking every mission has to know how to plant - which is the
 * lesson, not an inconvenience. `<CR>` anchors, `2j` reaches two lanes down,
 * `<CR>` plants the three. A reach mission takes `$`.
 */
function missionTurn(g: Game): void {
  const st = g.json();
  if (st.sim.missionBeat === 'done') { g.keys('n'); return; }
  if (st.phase === 'shop' && st.sim.shop.mode === 'place') {
    g.keys('<CR>');
    g.keys('2j');
    g.keys('<CR>');
    return;
  }
  const zs = st.buffer.zombies;
  if (st.sim.missionHold > 0 || zs.length === 0) { g.step(100); return; }
  if (MISSIONS[st.sim.mission].goal === 'reach') { g.keys(`${zs[0].row + 1}G`); g.step(150); return; }
  const o = optimalKill(st.buffer, st.cursor, zs[zs.length - 1], st.charges);
  if (!o) { g.step(100); return; }
  g.keys(o.keys);
  g.step(150);
}

const kills = (evs: GameEvent[]) => evs.filter((e) => e.t === 'kill');
const has = (evs: GameEvent[], t: GameEvent['t']) => evs.some((e) => e.t === t);
/** Medal names, in the order the bus saw them. */
const medals = (evs: GameEvent[]): string[] =>
  evs.filter((e): e is Extract<GameEvent, { t: 'medal' }> => e.t === 'medal').map((e) => e.name);
const judged = (evs: GameEvent[]): Array<Extract<GameEvent, { t: 'kill_judged' }>> =>
  evs.filter((e): e is Extract<GameEvent, { t: 'kill_judged' }> => e.t === 'kill_judged');

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

  it('a word shot down to one letter is a crawler now', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 16);
    for (let i = 0; i < 6; i++) g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.text).toBe('s');
    expect(z.kind).toBe('crawler');
    // and it plays like one: anything but x is overkill
    const evs = g.keys('dw');
    expect(kills(evs)).toHaveLength(1);
    expect(kills(evs)[0]).toMatchObject({ kind: 'crawler', overkill: true });
    expect(has(evs, 'combo_break')).toBe(true);
  });

  it('a runner that loses its legs crawls at half speed', () => {
    const g = scene([['runner', 5, 10, 'rot']]);
    g.json().buffer.zombies[0].speed = 4;
    place(g, 5, 12);
    g.keys('x');
    expect(g.json().buffer.zombies[0].kind).toBe('runner');
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.kind).toBe('crawler');
    expect(z.speed).toBe(2);
  });

  it('the first x into a word shoots its legs out: half speed, marked hobbled', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    g.json().buffer.zombies[0].speed = 4;
    place(g, 5, 10);
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.hobbled).toBe(true);
    expect(z.speed).toBe(2);
    expect(z.kind).toBe('walker');
  });

  it('a hobbled zombie is not slowed a second time', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    g.json().buffer.zombies[0].speed = 4;
    place(g, 5, 10);
    g.keys('x');
    g.keys('x');
    g.keys('3x');
    expect(g.json().buffer.zombies[0].speed).toBe(2);
  });

  it('X shoots legs too; a wider partial cut does not', () => {
    const g = scene([['walker', 5, 10, 'shamble'], ['walker', 6, 10, 'shamble']]);
    for (const z of g.json().buffer.zombies) z.speed = 4;
    place(g, 5, 12);
    g.keys('X');
    expect(g.json().buffer.zombies[0]).toMatchObject({ hobbled: true, speed: 2 });
    place(g, 6, 12);
    g.keys('dw');                      // erodes the tail: not a leg shot
    const z = g.json().buffer.zombies[1];
    expect(z.text).toBe('sh');
    expect(z.hobbled).toBeUndefined();
    expect(z.speed).toBe(4);
  });

  it('a hobbled runner shot down to a crawler is not halved twice', () => {
    const g = scene([['runner', 5, 10, 'rot']]);
    g.json().buffer.zombies[0].speed = 4;
    place(g, 5, 12);
    g.keys('x');
    expect(g.json().buffer.zombies[0].speed).toBe(2);
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.kind).toBe('crawler');
    expect(z.speed).toBe(2);
  });

  it('x on a crawler kills it; there are no legs to hobble', () => {
    const g = scene([['crawler', 5, 10, 'z']]);
    place(g, 5, 10);
    expect(kills(g.keys('x'))).toHaveLength(1);
  });

  it('a hobbled zombie prints [hobbled] in the ZOMBIES table', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 10);
    g.keys('x');
    expect(g.text()).toMatch(/walker .* hamble  \[hobbled\]/);
  });

  it('stripping armor down to one letter does not slow it to a crawl', () => {
    // chips only strip brackets; the kind flip is for erosion of the word itself
    const g = scene([['armored', 5, 10, '(a)']]);
    place(g, 5, 10);
    g.keys('x');
    g.keys('x');
    const z = g.json().buffer.zombies[0];
    expect(z.text).toBe('a');
    expect(z.kind).toBe('walker');
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

  // Survival stopped refilling with the store (DECISIONS #78); every other
  // mode still does, which is what keeps a warm-up step winnable.
  it('charges do not refill between survival nights', () => {
    const g = scene([['walker', 1, 0, 'aa']]);
    place(g, 1, 0);
    g.keys('dd');
    expect(g.json().charges.dd).toBe(1);
    g.step(5000);                    // wave clear -> the store
    expect(g.json().phase).toBe('shop');
    g.keys('n');                     // next night, having bought nothing
    expect(g.json().wave).toBe(2);
    expect(g.json().charges.dd).toBe(1);
  });

  it('charges refill between waves outside survival', () => {
    const g = scene([['walker', 1, 0, 'aa']]);
    g.sim.state.sim.mode = 'mission';
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

describe('the mission table', () => {
  it('has one mission per lesson, reading its text from waveDef', () => {
    const lessons = MISSIONS.filter((m) => m.lesson !== undefined);
    expect(lessons).toHaveLength(LESSON_COUNT);
    for (let n = 1; n <= LESSON_COUNT; n++) {
      const m = lessons[n - 1];
      const d = waveDef(n);
      expect(m.lesson).toBe(n);
      expect(m.section).toBe(d.section);
      expect(m.title).toBe(d.title);
      expect(m.keys).toEqual(d.keys);
    }
  });
  it('opens with the eight boot-camp missions, the warm-up in order', () => {
    const boot = MISSIONS.filter((m) => m.section === 'Boot camp');
    expect(boot).toHaveLength(8);
    expect(MISSIONS.slice(0, 8)).toEqual(boot);
    expect(boot.map((m) => m.title)).toEqual([
      'Take aim', 'Fire', 'Stop walking', 'Change lanes', 'One character',
      'Count them', 'Both ends', 'Set a trap',
    ]);
    expect(boot.map((m) => m.goal)).toEqual([
      'reach', 'clear', 'clear', 'clear', 'clear', 'clear', 'clear', 'plant',
    ]);
    expect(boot[0].keys).toEqual(['h', 'j', 'k', 'l']);
    expect(boot[7].plant).toEqual({ item: 'fence', lanes: 3 });
  });
  it('ids are unique and every mission stands up its own horde', () => {
    const ids = new Set(MISSIONS.map((m) => m.id));
    expect(ids.size).toBe(MISSIONS.length);
    for (const m of MISSIONS) {
      expect(m.spawn.length, m.id).toBeGreaterThan(0);
      expect(missionIndex(m.id)).toBe(MISSIONS.indexOf(m));
    }
    expect(missionIndex('nope')).toBe(-1);
  });
});

describe('par comes from the oracle', () => {
  it('one shamble at lane 8 col 24 from the western edge is par 3', () => {
    const par = parFor({
      id: 'x', section: 'x', title: 'x', keys: ['d', 'w'], hint: '',
      spawn: [['walker', 8, 24, 'shamble', 0]], start: [8, 0], goal: 'clear',
      demo: { keys: 'wdw', spawn: [], cursor: [8, 0] },
    });
    expect(par).toBe(3);                    // wdw; fsdw is 4, 24ldw is 5
  });
  it('is a finite positive integer for every mission, and memoised', () => {
    for (const m of MISSIONS) {
      const par = missionPar(m.id);
      expect(Number.isInteger(par), `${m.id}: par ${par}`).toBe(true);
      expect(par, m.id).toBeGreaterThan(0);
      expect(missionPar(m.id)).toBe(par);
    }
    expect(missionPar('nope')).toBe(-1);
  });
  it('a lesson that is not about the magazine is judged without one', () => {
    // With two dd and three D the cheapest clear of a lane is `D`, and three
    // stars on "Stop walking" would mean never pressing w.
    expect(missionPar('boot-words')).toBeGreaterThan(1);
    expect(missionPar('ops-dd')).toBeLessThanOrEqual(4);
  });
  it('stars fall by ratio to par', () => {
    expect(starsFor(6, 6)).toBe(3);
    expect(starsFor(5, 6)).toBe(3);
    expect(starsFor(9, 6)).toBe(2);
    expect(starsFor(10, 6)).toBe(1);
    expect(starsFor(4, 3)).toBe(2);         // ceil(4.5) = 5
    expect(starsFor(5, 3)).toBe(2);
    expect(starsFor(6, 3)).toBe(1);
  });
});

describe('missions', () => {
  /** Boot camp's Fire: one shamble at (8,24), cursor at (8,0), par 3. */
  const fire = (): Game => {
    const g = new Game(1, { autoStart: false });
    g.sim.startMission(missionIndex('boot-fire'));
    return g;
  };

  it('start lands in TRY on the start cursor with zero keys', () => {
    const g = new Game(1, { autoStart: false });
    g.keys('j<CR><CR>');    // menu -> missions -> the first boot-camp mission
    const st = g.json();
    expect(st.phase).toBe('playing');
    expect(st.sim.mode).toBe('mission');
    expect(st.sim.mission).toBe(0);
    expect(st.sim.missionBeat).toBe('try');
    expect(st.sim.missionKeys).toBe(0);
    expect(st.cursor).toEqual({ row: 8, col: 0 });
    expect(st.buffer.zombies.map((z) => z.text)).toEqual(['shamble']);
    expect(st.wave).toBe(0);
  });

  it('walks every mission with n and ends on the menu, not in survival', () => {
    const g = new Game(1, { autoStart: false });
    g.keys('j<CR><CR>');
    let guard = 0;
    const seen = new Set<number>();
    while (g.json().sim.mission >= 0 && guard++ < 20_000) {
      seen.add(g.json().sim.mission);
      missionTurn(g);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(MISSIONS.map((_, i) => i));
    expect(g.json().phase).toBe('menu');
    expect(g.json().wave).toBe(0);
    expect(g.json().barricade.hp).toBe(100);
  }, 60_000);

  it('the wall cannot be breached, and an escape restarts the beat', () => {
    const g = fire();
    g.keys('l');
    for (const z of g.json().buffer.zombies) { z.speed = 200; }
    g.step(2000);
    expect(g.json().barricade.hp).toBe(100);
    expect(g.isOver()).toBe(false);
    // The scene came back rather than counting as cleared.
    expect(g.json().buffer.zombies).toHaveLength(1);
    expect(g.json().sim.missionBeat).toBe('try');
    expect(g.json().sim.missionKeys).toBe(0);
  });

  it('a player who already knows dw is not stranded, and nothing auto-advances', () => {
    const g = fire();
    g.keys('wdw');
    expect(g.json().sim.missionHold).toBe(0);      // the hold starts on the next tick
    g.step(100);
    expect(g.json().sim.missionHold).toBeGreaterThan(0);
    expect(g.json().sim.missionHold).toBeLessThanOrEqual(MISSION_HOLD_MS);
    g.step(1200);
    expect(g.json().sim.missionBeat).toBe('done');
    expect(g.json().sim.mission).toBe(missionIndex('boot-fire'));
    g.step(60_000);
    expect(g.json().sim.missionBeat).toBe('done');
    expect(g.json().sim.mission).toBe(missionIndex('boot-fire'));
  });

  it('counts every key fed during TRY, half-typed commands included', () => {
    const g = fire();
    g.keys('3jd');
    expect(g.json().sim.missionKeys).toBe(3);
    g.keys('<Esc>');
    expect(g.json().sim.missionKeys).toBe(4);
    g.keys('w');
    expect(g.json().sim.missionKeys).toBe(5);
    expect(g.json().sim.keystrokes).toBe(5);
  });

  it('r refills the magazine, respawns the scene and zeroes the count', () => {
    const g = fire();
    g.keys('dd');
    expect(g.json().charges.dd).toBe(CHARGES_DD_MAX - 1);
    expect(g.json().buffer.zombies).toHaveLength(0);
    g.keys('l');
    g.keys('r');
    expect(g.json().charges.dd).toBe(CHARGES_DD_MAX);
    expect(g.json().sim.missionKeys).toBe(0);
    expect(g.json().buffer.zombies).toHaveLength(1);
    expect(g.json().cursor).toEqual({ row: 8, col: 0 });
    expect(g.json().sim.missionBeat).toBe('try');
  });

  it('reach: the crosshair on a zombie meets the goal', () => {
    const g = new Game(1, { autoStart: false });
    g.sim.startMission(missionIndex('boot-aim'));
    g.keys('$');
    g.step(100);
    expect(g.json().sim.missionHold).toBeGreaterThan(0);
    g.step(1000);
    expect(g.json().sim.missionBeat).toBe('done');
    expect(g.json().buffer.zombies).toHaveLength(1);   // still there, frozen
  });

  it('DONE emits mission_done with the keys, the par and the stars', () => {
    const g = fire();
    g.keys('wdw');
    const evs = g.step(1200);
    const done = evs.filter((e): e is Extract<GameEvent, { t: 'mission_done' }> => e.t === 'mission_done');
    expect(done).toHaveLength(1);
    expect(done[0]).toEqual({ t: 'mission_done', id: 'boot-fire', keys: 3, par: 3, stars: 3 });
  });

  it('stars by ratio: 3 at par, 2 within half again, 1 for the rest', () => {
    const attempt = (keys: string): number => {
      const g = fire();
      g.keys(keys);
      const evs = g.step(1200);
      const e = evs.find((x) => x.t === 'mission_done') as Extract<GameEvent, { t: 'mission_done' }>;
      expect(e).toBeDefined();
      expect(e.keys).toBe(splitKeys(keys).length);
      return e.stars;
    };
    expect(attempt('wdw')).toBe(3);                    // 3 <= 3
    expect(attempt('lwdw')).toBe(2);                   // 4 <= ceil(4.5)
    expect(attempt('llwdw')).toBe(2);                  // 5 <= 5
    expect(attempt('lllwdw')).toBe(1);                 // 6
  });

  it('on DONE, n starts the next mission in TRY and other keys do nothing', () => {
    const g = fire();
    g.keys('wdw');
    g.step(1200);
    g.keys('jkdw$0');
    expect(g.json().sim.missionBeat).toBe('done');
    expect(g.json().sim.missionKeys).toBe(3);
    g.keys('n');
    expect(g.json().sim.mission).toBe(missionIndex('boot-fire') + 1);
    expect(g.json().sim.missionBeat).toBe('try');
    expect(g.json().sim.missionKeys).toBe(0);
  });

  it('on DONE, r retries the same mission at TRY', () => {
    const g = fire();
    g.keys('wdw');
    g.step(1200);
    g.keys('r');
    expect(g.json().sim.mission).toBe(missionIndex('boot-fire'));
    expect(g.json().sim.missionBeat).toBe('try');
    expect(g.json().sim.missionKeys).toBe(0);
    expect(g.json().buffer.zombies).toHaveLength(1);
  });

  it('on DONE, Esc returns to the mission list with this mission selected', () => {
    const g = fire();
    g.keys('wdw');
    g.step(1200);
    g.keys('<Esc>');
    expect(g.json().phase).toBe('menu');
    expect(g.json().sim.mission).toBe(-1);
    expect(g.menu.screen).toBe('missions');
    expect(g.menu.cursor).toBe(missionIndex('boot-fire'));
    expect(g.text()).toMatch(/^> Fire/m);
  });

  it('the last mission n returns to the main menu', () => {
    const g = new Game(1, { autoStart: false });
    g.sim.startMission(MISSIONS.length - 1);
    const st = g.json();
    // Clear it by hand: what matters here is the way out.
    st.buffer.zombies.length = 0;
    g.json().sim.kills++;
    g.step(1200);
    expect(g.json().sim.missionBeat).toBe('done');
    g.keys('n');
    expect(g.json().phase).toBe('menu');
    expect(g.menu.screen).toBe('main');
    expect(g.json().sim.mission).toBe(-1);
  });

  it('text() carries the MISSION header line in both beats', () => {
    const g = fire();
    g.keys('ll');
    expect(g.text()).toContain(`MISSION boot-fire TRY keys=2 par=${missionPar('boot-fire')}`);
    expect(g.text()).not.toMatch(/^LESSON /m);
    g.keys('r');
    g.keys('wdw');
    g.step(1200);
    expect(g.text()).toContain('MISSION boot-fire DONE keys=3 par=3');
    expect(g.text()).toContain('stars 3/3');
  });

  it('startMission clamps an out-of-range index', () => {
    const g = new Game(1, { autoStart: false });
    g.sim.startMission(999);
    expect(g.json().sim.mission).toBe(MISSIONS.length - 1);
    g.sim.startMission(-4);
    expect(g.json().sim.mission).toBe(0);
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
  it('the store item table', () => {
    for (const it of ITEMS) {
      ok(it.id, 'item id'); ok(it.name, 'item name'); ok(it.blurb, 'item blurb');
    }
    ok(SURVEY_RULER, 'survey ruler');
  });
  it('the curriculum', () => {
    for (const d of CURRICULUM) {
      ok(d.section, 'section'); ok(d.title, 'title'); ok(d.desc, 'desc'); ok(d.brief, 'brief');
      for (const k of d.keys) ok(k, 'keycap');
    }
  });
  it('the missions', () => {
    for (const m of MISSIONS) {
      ok(m.id, 'id'); ok(m.section, 'section'); ok(m.title, 'title'); ok(m.hint, 'hint');
      for (const k of m.keys) ok(k, 'keycap');
      for (const [, , , text] of m.spawn) ok(text, 'zombie');
      for (const [, , , text] of m.demo.spawn) ok(text, 'demo zombie');
    }
    ok(Screens.MISSION_DONE_KEYS, 'done keys');
    ok(Screens.WAVE_POINTER, 'wave pointer');
  });
  it('every word the horde is built from', () => {
    for (const w of [...WALKERS, ...RUNNERS, ...BLOATERS, ...CRAWLERS]) ok(w, 'word');
  });
  it('the gore labels', () => {
    for (const g of ['off', 'low', 'full'] as const) { ok(goreLabel(g), 'label'); ok(goreBlurb(g), 'blurb'); }
  });
});

describe('mission strings fit the cards that print them', () => {
  // `drawMissionStrip` prints the hint through fit(hint, 49) and
  // `drawMissions` wraps it to three 22-cell lines. Both truncate silently, so
  // the budget is asserted here instead of being discovered in a screenshot.
  it('every hint fits the mission strip without truncating', () => {
    for (const step of MISSIONS) {
      expect(step.hint.length, `${step.title}: "${step.hint}"`).toBeLessThanOrEqual(Screens.MISSION_LINE);
    }
    expect(Screens.MISSION_DONE_KEYS.length).toBeLessThanOrEqual(Screens.MISSION_LINE);
  });
  it('every hint wraps into the select screen pane', () => {
    for (const step of MISSIONS) {
      const words = step.hint.split(' ');
      let lines = 1;
      let cur = '';
      for (const w of words) {
        expect(w.length, `${step.title}: "${w}" cannot fit a 22-cell line`)
          .toBeLessThanOrEqual(22);
        if (cur === '') { cur = w; continue; }
        if (cur.length + 1 + w.length <= 22) { cur += ` ${w}`; continue; }
        lines++;
        cur = w;
      }
      expect(lines, `${step.title}: needs ${lines} lines`).toBeLessThanOrEqual(3);
    }
  });
  it('every title fits the mission list and the strip', () => {
    for (const step of MISSIONS) {
      expect(step.title.length, step.title).toBeLessThanOrEqual(Screens.M_TITLE_MAX);
    }
  });
});

describe('multi-kill medals', () => {
  /** n walkers sharing lane 5, two cells apart, so one `dd` covers them all. */
  function lane(n: number): Spec[] {
    const out: Spec[] = [];
    for (let i = 0; i < n; i++) {
      out.push(['walker', 5, i * 3, String.fromCharCode(97 + i).repeat(2)]);
    }
    return out;
  }

  it('names every rung by victim count, from the table', () => {
    for (let n = MULTI_KILL_MIN; n <= MULTI_KILL_MIN + MULTI_KILL_NAMES.length - 1; n++) {
      const g = scene(lane(n));
      place(g, 5, 0);
      const evs = g.keys('dd');
      expect(kills(evs), `dd on ${n}`).toHaveLength(n);
      expect(medals(evs), `dd on ${n}`).toContain(MULTI_KILL_NAMES[n - MULTI_KILL_MIN]);
    }
  });

  it('anything past the last rung is still the last rung', () => {
    const g = scene(lane(14));
    place(g, 5, 0);
    expect(medals(g.keys('dd'))).toContain(MULTI_KILL_NAMES[MULTI_KILL_NAMES.length - 1]);
  });

  it('emits exactly one, after the kills', () => {
    const g = scene(lane(3));
    place(g, 5, 0);
    const evs = g.keys('dd');
    expect(medals(evs).filter((n) => medalTier(n) > 0)).toEqual(['TRIPLE KILL']);
    const lastKill = evs.map((e) => e.t).lastIndexOf('kill');
    const medal = evs.findIndex((e) => e.t === 'medal' && medalTier(e.name) > 0);
    expect(medal).toBeGreaterThan(lastKill);
  });

  it('d3w across three walkers is a TRIPLE KILL', () => {
    const g = scene([['walker', 5, 10, 'aaa'], ['walker', 5, 14, 'bbb'], ['walker', 5, 18, 'ccc']]);
    place(g, 5, 10);
    expect(medals(g.keys('d3w'))).toContain('TRIPLE KILL');
  });

  it('two separate dw kills raise the combo and earn nothing', () => {
    const g = scene([['walker', 5, 10, 'shamble'], ['walker', 5, 20, 'fester']]);
    place(g, 5, 10);
    const a = g.keys('dw');
    place(g, 5, 20);
    const b = g.keys('dw');
    expect(g.json().combo).toBe(2);
    expect([...medals(a), ...medals(b)].filter((n) => medalTier(n) > 0)).toEqual([]);
  });

  it('a J crush climbs the same ladder', () => {
    const g = scene([
      ['walker', 5, 10, 'aaa'], ['walker', 6, 10, 'bbb'], ['walker', 6, 14, 'ccc'],
      ['walker', 5, 14, 'ddd'],
    ]);
    place(g, 5, 10);
    const evs = g.keys('J');
    expect(kills(evs)).toHaveLength(2);
    expect(medals(evs)).toContain('DOUBLE KILL');
  });
});

describe('style medals', () => {
  it('PERFECT when the sequence matches the oracle', () => {
    const g = scene([['walker', 5, 15, 'shamble']]);
    place(g, 5, 10);
    const evs = g.keys('wdw');
    const j = judged(evs);
    expect(j).toHaveLength(1);
    expect(j[0].spent).toBe(3);
    expect(j[0].optimal).not.toBeNull();
    expect(j[0].optimal!.length).toBe(3);
    expect(medals(evs)).toContain(PERFECT);
  });

  it('no PERFECT for a wasteful approach, but kill_judged still reports it', () => {
    const g = scene([['walker', 5, 15, 'shamble']]);
    place(g, 5, 10);
    const evs = g.keys('llllldw');
    const j = judged(evs);
    expect(j).toHaveLength(1);
    expect(j[0].spent).toBe(7);
    expect(j[0].optimal!.length).toBeLessThan(7);
    expect(medals(evs)).not.toContain(PERFECT);
  });

  it('SNIPE for a find onto a runner', () => {
    const g = scene([['runner', 5, 20, 'dash']]);
    place(g, 5, 10);
    expect(medals(g.keys('fddw'))).toContain(SNIPE);
  });

  it('no SNIPE without a runner among the victims', () => {
    const g = scene([['walker', 5, 20, 'shamble']]);
    place(g, 5, 10);
    expect(medals(g.keys('fsdw'))).not.toContain(SNIPE);
  });

  it('BREACH for a text object through armor', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 10);
    expect(medals(g.keys('da('))).toContain(BREACH);
  });

  it('no BREACH without a text object', () => {
    const g = scene([['armored', 5, 10, '(lurch)'], ['walker', 5, 20, 'shamble']]);
    place(g, 5, 20);
    expect(medals(g.keys('dw'))).not.toContain(BREACH);
  });

  it('CALLED SHOT when the sequence opens with a search', () => {
    const g = scene([['walker', 5, 10, 'pale'], ['walker', 7, 20, 'husk']]);
    place(g, 5, 10);
    expect(medals(g.keys('/husk<CR>dw'))).toContain(CALLED_SHOT);
  });

  it('no CALLED SHOT when the kill is not what the search landed on', () => {
    const g = scene([['walker', 5, 10, 'pale'], ['walker', 7, 20, 'husk']]);
    place(g, 5, 10);
    const evs = g.keys('/husk<CR>ggdw');       // sniped one, killed the other
    expect(medals(evs)).not.toContain(CALLED_SHOT);
  });

  it('an overkill earns no style medal', () => {
    const g = scene([['crawler', 5, 20, 'z']]);
    place(g, 5, 10);
    const evs = g.keys('fzdw');
    expect(kills(evs)[0].overkill).toBe(true);
    expect(medals(evs)).not.toContain(SNIPE);
  });

  it('only the first kill of a sequence is judged', () => {
    const g = scene([['walker', 5, 10, 'aa'], ['walker', 5, 13, 'bb'], ['walker', 5, 16, 'cc']]);
    place(g, 5, 0);
    expect(judged(g.keys('dd'))).toHaveLength(1);
  });

  it('a zombie that spawned after the anchor is not judged', () => {
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 10);
    g.keys('l');                                // anchors on the field as it is
    const st = g.json();
    st.buffer.zombies.push({
      id: 99, kind: 'walker', row: 5, col: 30, text: 'newcomer', hp: 1, speed: 0,
    });
    g.sim.tick(0);
    st.cursor.row = 5; st.cursor.col = 30;
    const evs = g.keys('dw');
    expect(kills(evs)).toHaveLength(1);
    expect(judged(evs)).toHaveLength(0);
    expect(medals(evs)).not.toContain(PERFECT);
    expect(st.sim.judge).toBeNull();
  });
});

describe('the run wallet', () => {
  it('createState starts it at 0 and start() zeroes it again', () => {
    expect(createState(7).supplies).toBe(0);
    const g = scene([['walker', 5, 10, 'shamble']]);
    place(g, 5, 10);
    g.keys('dw');
    expect(g.json().supplies).toBeGreaterThan(0);
    g.sim.start();
    expect(g.json().supplies).toBe(0);
  });

  it('a plain kill pays text.length and scores separately', () => {
    // Walked to, the long way round, so no PERFECT muddies the payout.
    const g = scene([['walker', 5, 10, 'lurch']]);
    place(g, 5, 0);
    const before = g.json().score;
    g.keys('llllllllll' + 'dw');
    const st = g.json();
    expect(st.score - before).toBe(55);          // 10 x 5 x (1 + 1/10)
    expect(st.supplies).toBe(5);
  });

  it('a medal pays its bonus on top, straight from the table', () => {
    const g = scene([['walker', 5, 0, 'aa'], ['walker', 5, 3, 'bb'], ['walker', 5, 6, 'cc']]);
    place(g, 5, 0);
    g.keys('dd');
    // three 2-letter kills, plus the TRIPLE KILL rung
    expect(g.json().supplies).toBe(6 + MULTI_KILL_BONUS[3 - MULTI_KILL_MIN]);
  });

  it('every style medal pays its own bonus', () => {
    const g = scene([['armored', 5, 10, '(lurch)']]);
    place(g, 5, 10);
    const evs = g.keys('da(');
    expect(medals(evs)).toEqual([PERFECT, BREACH]);
    expect(g.json().supplies).toBe(7 + STYLE_BONUS[PERFECT] + STYLE_BONUS[BREACH]);
  });

  it('a mission cannot bank a wallet', () => {
    const g = new Game(3, { autoStart: false });
    g.sim.startMission(MISSIONS.findIndex((m) => m.goal === 'plant'));
    // The placement mission hands out supplies to spend on the fence.
    expect(g.json().supplies).toBeGreaterThan(0);
    let guard = 0;
    while (g.json().sim.missionBeat !== 'done' && guard++ < 400) missionTurn(g);
    g.keys('<Esc>');                     // DONE -> the list
    g.keys('h');                         // -> the main menu
    g.keys('i');
    expect(g.json().wave).toBe(1);
    expect(g.json().sim.mode).toBe('survival');
    // Starting a run wipes them like everything else the mission touched.
    expect(g.json().supplies).toBe(0);
  });

  it('text() prints SUPPLIES', () => {
    const g = scene([['walker', 5, 10, 'lurch']]);
    place(g, 5, 0);
    g.keys('llllllllll' + 'dw');
    expect(g.text()).toContain('SUPPLIES 5');
  });
});

describe('the medal table', () => {
  it('names and bonuses line up', () => {
    expect(MULTI_KILL_BONUS).toHaveLength(MULTI_KILL_NAMES.length);
  });

  it('every name is printable ASCII', () => {
    for (const name of allMedalNames()) {
      for (const ch of name) {
        expect(ch.charCodeAt(0), `${name}: ${JSON.stringify(ch)}`).toBeLessThan(127);
        expect(ch.charCodeAt(0), `${name}: ${JSON.stringify(ch)}`).toBeGreaterThanOrEqual(32);
      }
    }
  });

  it('salvage is the rung number for a multi-kill, 1 for style, 5 for FIRST BLOOD', () => {
    for (let i = 0; i < MULTI_KILL_NAMES.length; i++) {
      expect(salvageFor(MULTI_KILL_NAMES[i])).toBe(i + MULTI_KILL_MIN);
    }
    for (const n of [PERFECT, SNIPE, BREACH, CALLED_SHOT]) expect(salvageFor(n)).toBe(1);
    expect(salvageFor(FIRST_BLOOD)).toBe(5);
  });

  it('the sim never emits FIRST BLOOD', () => {
    const g = new Game(5);
    const seen: string[] = [];
    for (let i = 0; i < 400 && !g.isOver(); i++) {
      const st = g.json();
      const zs = st.buffer.zombies;
      if (zs.length) {
        const o = optimalKill(st.buffer, st.cursor, zs[0], st.charges);
        if (o) seen.push(...medals(g.keys(o.keys)));
      }
      seen.push(...medals(g.step(60)));
    }
    expect(seen).not.toContain(FIRST_BLOOD);
  });
});

describe('supplies is written only by src/sim', () => {
  // `verify:browser` asserts the browser and headless final states are
  // byte-identical. A UI-layer write to the wallet would break that by
  // construction, so it is a build error rather than a rendering surprise.
  const WRITE = /\bsupplies\s*(?:=[^=]|\+=|-=|\*=|\/=|\+\+|--)/;

  it('no assignment to supplies outside src/sim', () => {
    const root = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.ts')) continue;
        const rel = relative(root, p);
        if (rel.startsWith('sim')) continue;
        // `state.ts` declares the field; declaring is not writing.
        if (rel === join('core', 'state.ts')) continue;
        for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) {
          if (WRITE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      }
    };
    walk(root);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------- the store

/** A cleared survival night: the store is open, with `supplies` in the bank. */
function shopping(supplies = 500, seed = 1): Game {
  const g = new Game(seed);
  const st = g.json();
  st.sim.spawnQueue.length = 0;
  st.buffer.zombies.length = 0;
  st.sim.resolvedThisWave = 1;      // something happened, so the wave can clear
  st.sim.killsThisWave = 1;         // and you were the one who made it happen
  g.step(20);
  g.json().supplies = supplies;
  return g;
}

/** Move the store cursor onto an item by id, the way a player would. */
function row(g: Game, id: string): void {
  const n = ITEMS.findIndex((i) => i.id === id);
  g.keys('gg');
  if (n > 0) g.keys(`${n}j`);
}

const buys = (evs: GameEvent[]): Array<Extract<GameEvent, { t: 'buy' }>> =>
  evs.filter((e): e is Extract<GameEvent, { t: 'buy' }> => e.t === 'buy');

describe('the store opens between survival nights', () => {
  it('a survival wave clear opens the store and stops the clock', () => {
    const g = shopping();
    expect(g.json().phase).toBe('shop');
    expect(g.json().sim.breather).toBe(0);
    const wave = g.json().wave;
    const time = g.json().sim.time;
    g.step(60_000);
    expect(g.json().wave).toBe(wave);
    expect(g.json().sim.time).toBe(time);
    expect(g.json().phase).toBe('shop');
  });

  it('a wave clear outside survival keeps the breather', () => {
    const g = new Game(1);
    g.json().sim.mode = 'mission';
    g.json().sim.spawnQueue.length = 0;
    g.json().buffer.zombies.length = 0;
    g.json().sim.resolvedThisWave = 1;
    g.json().sim.killsThisWave = 1;
    g.step(20);
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.breather).toBeGreaterThan(0);
  });

  it('a breach on the tick that empties the field is still a death', () => {
    const g = scene([['walker', 5, BARRICADE_COL - 5, 'moan']]);
    g.json().barricade.hp = 3;
    g.json().buffer.zombies[0].speed = 100;
    g.step(100);
    expect(g.json().phase).toBe('dead');
  });
});

// ------------------------------------------------------- a night nobody fought

describe('a night the wall fought alone ends the run', () => {
  /** Wave 1, untouched, until the sim stops taking ticks. */
  function idle(seed = 1234): Game {
    const g = new Game(seed);
    for (let i = 0; i < 400 && g.json().phase === 'playing'; i++) g.step(250);
    return g;
  }

  it('letting the whole night through is a death, not a wave clear', () => {
    const g = idle();
    const st = g.json();
    expect(st.phase).toBe('dead');
    expect(st.wave).toBe(1);
    expect(st.sim.killsThisWave).toBe(0);
    // The wall is what makes this a bug worth fixing: it is still standing.
    expect(st.barricade.hp).toBeGreaterThan(0);
  });

  it('emits a death rather than a wave_clear', () => {
    const g = new Game(1234);
    const seen: string[] = [];
    for (let i = 0; i < 400 && g.json().phase === 'playing'; i++) {
      for (const e of g.step(250)) if (e.t === 'death' || e.t === 'wave_clear') seen.push(e.t);
    }
    expect(seen).toEqual(['death']);
  });

  it('one kill anywhere in the night is enough to have played it', () => {
    const g = new Game(1234);
    let fired = false;
    // A walker crosses 52 columns at 1.1/s, so the night needs ~65s of sim.
    for (let i = 0; i < 1200 && g.json().phase === 'playing'; i++) {
      g.step(100);
      const st = g.json();
      if (!fired && st.buffer.zombies.length > 0) {
        const z = st.buffer.zombies[0];
        st.cursor = { row: z.row, col: z.col };
        g.keys('dw');
        fired = st.sim.killsThisWave > 0;
      }
    }
    expect(fired).toBe(true);
    // A cleared survival night opens the store; the wall pays for the rest.
    expect(g.json().phase).toBe('shop');
    expect(g.json().barricade.hp).toBeLessThan(BARRICADE_MAX);
    g.keys('n');
    expect(g.json().wave).toBe(2);
  });

  it('a trap kill counts as playing the night', () => {
    const g = new Game(1234);
    const st = g.json();
    st.sim.killsThisWave = 0;
    st.sim.resolvedThisWave = 3;
    st.sim.spawnedThisWave = st.sim.waveSize;
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    // Exactly what `trapKill` leaves behind: a kill on the board, not a breach.
    st.sim.killsThisWave = 1;
    g.step(20);
    expect(g.json().phase).not.toBe('dead');
  });

  it('a partial wave the wall absorbed is a breach, so Second Wind still answers it', () => {
    const g = new Game(1);
    const st = g.json();
    st.sim.secondWind = true;
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 920, kind: 'bloater', row: 5, col: BARRICADE_COL - 11,
      text: 'putrescent', hp: 1, speed: 100,
    });
    st.barricade.hp = 5;
    const evs = g.step(100);
    expect(has(evs, 'revive')).toBe(true);
    expect(g.json().phase).not.toBe('dead');
    expect(g.json().barricade.hp).toBe(30);
  });
});

describe('store list navigation', () => {
  it('counted j moves the selection', () => {
    const g = shopping();
    g.keys('3j');
    expect(g.json().sim.shop.cursor).toBe(3);
  });

  it('G lands on the NEXT NIGHT row and gg on the first', () => {
    const g = shopping();
    g.keys('G');
    expect(g.json().sim.shop.cursor).toBe(NEXT_ROW);
    expect(NEXT_ROW).toBe(SHOP_ROWS - 1);
    g.keys('gg');
    expect(g.json().sim.shop.cursor).toBe(0);
  });

  it('H M L are the window motions they are everywhere else', () => {
    const g = shopping();
    g.keys('L');
    expect(g.json().sim.shop.cursor).toBe(SHOP_ROWS - 1);
    g.keys('M');
    expect(g.json().sim.shop.cursor).toBe((SHOP_ROWS - 1) >> 1);
    g.keys('H');
    expect(g.json().sim.shop.cursor).toBe(0);
  });

  it('the selection clamps at both ends and never wraps', () => {
    const g = shopping();
    g.keys('9k');
    expect(g.json().sim.shop.cursor).toBe(0);
    g.keys('99j');
    expect(g.json().sim.shop.cursor).toBe(SHOP_ROWS - 1);
  });

  it('an operator is ignored, flashes, and buys nothing', () => {
    const g = shopping();
    g.keys('3j');
    g.json().sim.flashUntil = 0;
    const evs = g.keys('dd');
    expect(g.json().sim.shop.cursor).toBe(3);
    expect(g.json().sim.flashUntil).toBeGreaterThan(0);
    expect(buys(evs)).toEqual([]);
  });
});

describe('buying is a sim input', () => {
  it('an affordable purchase debits, applies and announces itself', () => {
    const g = shopping(100);
    g.json().barricade.hp = 50;
    row(g, 'planks');
    const evs = g.keys('l');
    expect(g.json().supplies).toBe(20);
    expect(g.json().barricade.hp).toBe(75);
    expect(g.json().sim.purchases.planks).toBe(1);
    expect(buys(evs)).toEqual([{ t: 'buy', item: 'planks', cost: 80 }]);
  });

  it('a purchase you cannot afford changes nothing and emits nothing', () => {
    const g = shopping(30);
    g.json().barricade.hp = 50;
    row(g, 'planks');
    const evs = g.keys('l');
    expect(g.json().supplies).toBe(30);
    expect(g.json().barricade.hp).toBe(50);
    expect(evs).toEqual([]);
  });

  it('a purchase at its cap is refused', () => {
    const g = shopping(500);
    g.json().sim.purchases.flare = 1;
    row(g, 'flare');
    const evs = g.keys('l');
    expect(buys(evs)).toEqual([]);
    expect(g.json().supplies).toBe(500);
  });

  it('<CR> buys the selected row too', () => {
    const g = shopping(100);
    g.json().barricade.hp = 10;
    row(g, 'planks');
    expect(buys(g.keys('<CR>'))).toHaveLength(1);
  });
});

describe('leaving the store', () => {
  it('n starts the next night', () => {
    const g = shopping();
    const evs = g.keys('n');
    expect(g.json().phase).toBe('playing');
    expect(g.json().wave).toBe(2);
    expect(evs.some((e) => e.t === 'wave_start' && e.n === 2)).toBe(true);
  });

  it('<CR> on the NEXT NIGHT row does the same', () => {
    const g = shopping();
    g.keys('G');
    g.keys('<CR>');
    expect(g.json().phase).toBe('playing');
    expect(g.json().wave).toBe(2);
  });

  it('<Esc> in the list does nothing', () => {
    const g = shopping();
    g.keys('<Esc>');
    expect(g.json().phase).toBe('shop');
  });

  it('the store does not reopen for the night it was left', () => {
    const g = shopping();
    g.keys('n');
    g.step(100);
    expect(g.json().phase).toBe('playing');
  });
});

describe('the survival ammo economy', () => {
  it('a run starts at 2/3, and the caps start there too', () => {
    const g = new Game(1);
    expect(g.json().charges).toEqual({ dd: 2, D: 3 });
    expect(g.json().sim.chargeCap).toEqual({ dd: 2, D: 3 });
  });

  it('a charge purchase adds one and stops at the cap', () => {
    const g = shopping(500);
    g.json().charges.dd = 0;
    row(g, 'dd');
    expect(buys(g.keys('l'))).toHaveLength(1);
    expect(g.json().charges.dd).toBe(1);
    g.keys('l');
    expect(g.json().charges.dd).toBe(2);
    const evs = g.keys('l');                 // at the cap now
    expect(buys(evs)).toEqual([]);
    expect(g.json().charges.dd).toBe(2);
  });

  it('a D purchase at the cap emits nothing and spends nothing', () => {
    const g = shopping(500);
    row(g, 'D');
    expect(g.json().charges.D).toBe(3);
    expect(buys(g.keys('l'))).toEqual([]);
    expect(g.json().supplies).toBe(500);
  });
});

describe('every item does what the table says', () => {
  it('bandolier raises both caps, three times, and hands you no round', () => {
    const g = shopping(1000);
    row(g, 'bandolier');
    g.keys('l');
    expect(g.json().sim.chargeCap).toEqual({ dd: 3, D: 4 });
    expect(g.json().charges).toEqual({ dd: 2, D: 3 });
    g.keys('l'); g.keys('l');
    expect(g.json().sim.chargeCap).toEqual({ dd: 5, D: 6 });
    expect(buys(g.keys('l'))).toEqual([]);   // capped at three
  });

  it('whetstone buys one night of a wider allowance, and only one', () => {
    // 5 wasted cells is one over the standing allowance of 4.
    const cut = (g: Game): GameEvent[] => {
      const st = g.json();
      st.sim.spawnQueue.length = 0;
      st.buffer.zombies.length = 0;
      st.buffer.zombies.push({
        id: 900, kind: 'walker', row: 3, col: 5, text: 'gore', hp: 1, speed: 0,
      });
      g.sim.tick(0);
      st.cursor.row = 3; st.cursor.col = 0;
      // Covers columns 0..8 and kills the four cells of `gore`, so exactly 5
      // cells of empty ground are wasted - one over the standing allowance.
      return g.keys('d9l');
    };
    const g = shopping(500);
    row(g, 'whetstone');
    g.keys('l');
    expect(g.json().sim.wasteBonus).toBe(1);
    g.keys('n');                             // night 2, with the stone
    expect(has(cut(g), 'charge_used')).toBe(false);

    // Clear night 2 and start night 3 without buying: the stone is spent.
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    expect(g.json().phase).toBe('shop');
    g.keys('n');
    expect(g.json().sim.wasteBonus).toBe(0);
    expect(has(cut(g), 'charge_used')).toBe(true);
  });

  it('repeater pays for a . instead of the magazine', () => {
    const g = shopping(500);
    row(g, 'repeater');
    g.keys('l');
    expect(g.json().sim.freeRepeat).toBe(1);
    g.keys('n');
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({ id: 901, kind: 'walker', row: 4, col: 10, text: 'rot', hp: 1, speed: 0 });
    st.buffer.zombies.push({ id: 902, kind: 'walker', row: 6, col: 10, text: 'rot', hp: 1, speed: 0 });
    g.sim.tick(0);
    st.cursor.row = 4; st.cursor.col = 10;
    g.keys('D');
    expect(g.json().charges.D).toBe(2);
    st.cursor.row = 6; st.cursor.col = 10;
    const evs = g.keys('.');
    expect(kills(evs)).toHaveLength(1);
    expect(g.json().charges.D).toBe(2);      // the repeat was free
    expect(g.json().sim.freeRepeat).toBe(0);
  });

  it('planks clamp at maxHp and sandbags raise it', () => {
    const g = shopping(1000);
    g.json().barricade.hp = 90;
    row(g, 'planks');
    g.keys('l');
    expect(g.json().barricade).toEqual({ hp: 100, maxHp: 100 });
    g.json().barricade.hp = 40;
    row(g, 'sandbags');
    g.keys('l');
    expect(g.json().barricade).toEqual({ hp: 50, maxHp: 110 });
  });

  it('sandbags stop after five', () => {
    const g = shopping(10_000);
    row(g, 'sandbags');
    for (let i = 0; i < 5; i++) g.keys('l');
    expect(g.json().barricade.maxHp).toBe(150);
    expect(buys(g.keys('l'))).toEqual([]);
  });

  it('flare slows the next night only, and runners keep their 2x', () => {
    const g = shopping(500);
    g.json().wave = 5;
    row(g, 'flare');
    g.keys('l');
    expect(g.json().sim.flare).toBe(true);
    g.keys('n');
    const base = baseSpeed(6);
    for (const spec of g.json().sim.spawnQueue) {
      const want = (spec.kind === 'runner' ? base * 2 : base) * FLARE_SPEED;
      expect(spec.speed).toBeCloseTo(want, 6);
    }
    expect(g.json().sim.flare).toBe(false);
  });

  it('spotter shows the oracle for three kills and then stops', () => {
    const g = shopping(500);
    row(g, 'spotter');
    g.keys('l');
    expect(g.json().sim.spotter).toBe(3);
    g.keys('n');
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    for (let i = 0; i < 3; i++) {
      st.buffer.zombies.push({
        id: 910 + i, kind: 'walker', row: 2 + i * 2, col: 10, text: 'rot', hp: 1, speed: 0,
      });
    }
    g.sim.tick(0);
    expect(g.text()).toContain('SPOTTER');
    for (let i = 0; i < 3; i++) {
      st.cursor.row = 2 + i * 2; st.cursor.col = 10;
      g.keys('dw');
    }
    expect(g.json().sim.spotter).toBe(0);
    expect(g.text()).not.toContain('SPOTTER');
  });

  it('manifest previews the next night without touching the RNG', () => {
    const g = shopping(500);
    g.json().wave = 7;
    const rng = g.json().sim.rngState;
    row(g, 'manifest');
    g.keys('l');
    expect(g.json().sim.rngState).toBe(rng);
    expect(g.text()).toContain(`night 8: ${waveSize(8)} bodies`);
    expect(manifestLine(7)).toContain(`speed ${baseSpeed(8).toFixed(2)} c/s`);
  });

  it('manifest is re-bought each visit, not once a run', () => {
    const g = shopping(500);
    row(g, 'manifest');
    g.keys('l');
    expect(g.json().sim.manifest).toBe(true);
    g.keys('n');
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    expect(g.json().sim.manifest).toBe(false);
    row(g, 'manifest');
    expect(buys(g.keys('l'))).toHaveLength(1);
  });

  it('second wind revives once, and the next breach is the last', () => {
    const g = shopping(500);
    row(g, 'secondwind');
    g.keys('l');
    g.keys('n');
    const breach = (): GameEvent[] => {
      // Emptying the field clears the night, which opens the store; the run
      // has to be back on the field before the wall can be hit again.
      if (g.json().phase === 'shop') g.keys('n');
      const st = g.json();
      st.sim.spawnQueue.length = 0;
      st.buffer.zombies.length = 0;
      st.buffer.zombies.push({
        id: 920, kind: 'bloater', row: 5, col: BARRICADE_COL - 11,
        text: 'putrescent', hp: 1, speed: 100,
      });
      st.barricade.hp = 5;
      return g.step(100);
    };
    const evs = breach();
    expect(has(evs, 'revive')).toBe(true);
    expect(g.json().phase).not.toBe('dead');
    expect(g.json().barricade.hp).toBe(30);
    expect(g.json().combo).toBe(0);
    expect(has(breach(), 'death')).toBe(true);
    expect(g.json().phase).toBe('dead');
  });

  it('barbed wire holds the first arrival a second, then it is gone', () => {
    const g = shopping(500);
    row(g, 'wire');
    g.keys('l');
    expect(g.json().sim.shop.mode).toBe('place');
    g.keys('4G');
    expect(g.json().sim.shop.place.col).toBe(FIELD_COLS - 1);
    g.keys('<CR>');
    expect(g.json().sim.wireLanes & (1 << 3)).not.toBe(0);
    g.keys('n');

    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 930, kind: 'walker', row: 3, col: BARRICADE_COL - 5, text: 'moan', hp: 1, speed: 4,
    });
    g.sim.tick(0);
    const t0 = g.json().sim.time;
    let hitAt = -1;
    for (let i = 0; i < 200 && hitAt < 0; i++) {
      if (has(g.step(50), 'barricade_hit')) hitAt = g.json().sim.time;
    }
    expect(hitAt - t0).toBeGreaterThanOrEqual(1000);
    expect(g.json().sim.wireLanes & (1 << 3)).toBe(0);
  });
});

describe('trap placement is a Vim exercise', () => {
  /** Open the store and enter placement mode for one trap item. */
  function placing(id: string, supplies = 500): Game {
    const g = shopping(supplies);
    row(g, id);
    g.keys('l');
    return g;
  }

  it('the survey grid is the 52-column ruler, on every lane', () => {
    expect(SURVEY_RULER).toHaveLength(FIELD_COLS);
    expect(SURVEY_RULER.startsWith('0.........1')).toBe(true);
    const g = placing('tripwire');
    const lanes = g.text().split('\n').filter((l) => l.startsWith('lane '));
    expect(lanes).toHaveLength(16);
    for (const l of lanes) expect(l).toContain(SURVEY_RULER);
  });

  it('f3 finds column 30 on the ruler', () => {
    const g = placing('tripwire');
    g.keys('gg');
    g.keys('0');
    g.keys('f3');
    expect(g.json().sim.shop.place.col).toBe(30);
  });

  it('7G puts the crosshair on lane 7', () => {
    const g = placing('tripwire');
    g.keys('7G');
    expect(g.json().sim.shop.place.row).toBe(6);
  });

  it('an operator in placement mode is ignored with a flash', () => {
    const g = placing('tripwire');
    g.keys('5G');
    const before = { ...g.json().sim.shop.place };
    g.json().sim.flashUntil = 0;
    const evs = g.keys('dd');
    expect(g.json().sim.shop.place).toEqual(before);
    expect(g.json().sim.flashUntil).toBeGreaterThan(0);
    expect(buys(evs)).toEqual([]);
  });

  it('a tripwire plants on the first <CR>', () => {
    const g = placing('tripwire', 100);
    g.keys('5G');
    g.keys('f3');
    const evs = g.keys('<CR>');
    expect(g.json().supplies).toBe(50);
    expect(g.json().sim.traps).toEqual([{
      id: 1, kind: 'tripwire', row0: 4, row1: 4, col0: 30, col1: 30, charges: 1,
    }]);
    expect(g.json().sim.shop.mode).toBe('list');
    expect(buys(evs)).toEqual([{ t: 'buy', item: 'tripwire', cost: 50 }]);
  });

  it('<Esc> cancels a placement without charging for it', () => {
    const g = placing('tripwire', 100);
    g.keys('5G');
    g.keys('<Esc>');
    expect(g.json().sim.traps).toEqual([]);
    expect(g.json().supplies).toBe(100);
    expect(g.json().sim.shop.mode).toBe('list');
  });

  it('a three-lane fence costs 120 and carries three charges', () => {
    const g = placing('fence', 200);
    g.keys('3G');
    g.keys('f2');
    g.keys('<CR>');
    expect(g.json().sim.shop.anchor).toEqual({ row: 2, col: 20 });
    g.keys('2j');
    g.keys('<CR>');
    expect(g.json().sim.traps).toEqual([{
      id: 1, kind: 'fence', row0: 2, row1: 4, col0: 20, col1: 20, charges: 3,
    }]);
    expect(g.json().supplies).toBe(80);
  });

  it('a horizontal move between the two presses does not drag the fence', () => {
    const g = placing('fence', 500);
    g.keys('3G');
    g.keys('f2');
    g.keys('<CR>');
    g.keys('2j');
    g.keys('$');                        // aims elsewhere; the column is set
    g.keys('<CR>');
    const t = g.json().sim.traps[0];
    expect(t.col0).toBe(20);
    expect(t.col1).toBe(20);
  });

  it('a fence the wallet cannot cover is refused, and keeps the anchor', () => {
    const g = placing('fence', 100);
    g.keys('3G');
    g.keys('f2');
    g.keys('<CR>');
    g.keys('9j');
    const evs = g.keys('<CR>');
    expect(g.json().sim.traps).toEqual([]);
    expect(g.json().supplies).toBe(100);
    expect(g.json().sim.shop.anchor).toEqual({ row: 2, col: 20 });
    expect(buys(evs)).toEqual([]);
  });

  it('a minefield spans columns by 2w and costs 30 per five', () => {
    const g = placing('minefield', 100);
    g.keys('8G');
    g.keys('f2');
    g.keys('<CR>');
    g.keys('2w');
    expect(g.json().sim.shop.place.col).toBe(30);
    g.keys('<CR>');
    expect(g.json().sim.traps).toEqual([{
      id: 1, kind: 'minefield', row0: 7, row1: 7, col0: 20, col1: 30, charges: 3,
    }]);
    expect(g.json().supplies).toBe(10);
  });

  it('a vertical move between the two presses does not drag the minefield', () => {
    const g = placing('minefield', 500);
    g.keys('8G');
    g.keys('f2');
    g.keys('<CR>');
    g.keys('2w');
    g.keys('3j');
    g.keys('<CR>');
    const t = g.json().sim.traps[0];
    expect(t.row0).toBe(7);
    expect(t.row1).toBe(7);
  });
});

describe('traps fire, and pay base score only', () => {
  /** One zombie on an otherwise empty field, moving at `speed`. */
  function runner(kind: ZombieKind, r: number, col: number, text: string, speed: number): Game {
    const g = new Game(1);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.buffer.zombies.push({
      id: 1, kind, row: r, col, text, hp: kind === 'armored' ? 2 : 1, speed,
    });
    g.sim.tick(0);
    return g;
  }

  it('a runner crossing two columns in one tick cannot skip a wire', () => {
    const g = runner('runner', 3, 18, 'spit', 100);
    g.json().sim.traps.push({
      id: 7, kind: 'tripwire', row0: 3, row1: 3, col0: 22, col1: 22, charges: 1,
    });
    const evs = g.step(100);
    expect(evs.some((e) => e.t === 'trap_fire' && e.trapId === 7)).toBe(true);
    expect(evs.some((e) => e.t === 'kill' && e.via === 'trap:tripwire:7')).toBe(true);
    expect(g.json().buffer.zombies).toHaveLength(0);
    expect(g.json().sim.traps).toEqual([]);
  });

  it('a trap kill scores 10 a letter with no combo, and pays no wallet', () => {
    const g = runner('walker', 3, 18, 'gore', 100);
    const st = g.json();
    st.sim.traps.push({
      id: 2, kind: 'tripwire', row0: 3, row1: 3, col0: 22, col1: 22, charges: 1,
    });
    st.combo = 4;
    st.sim.lastKillAt = st.sim.time;         // keep the combo window open
    const score = st.score;
    const supplies = st.supplies;
    const evs = g.step(20);
    expect(g.json().score - score).toBe(40);
    expect(g.json().combo).toBe(4);
    expect(g.json().supplies).toBe(supplies);
    expect(g.json().sim.kills).toBe(1);
    expect(medals(evs)).toEqual([]);
    const k = evs.find((e) => e.t === 'kill');
    expect(k).toMatchObject({ via: 'trap:tripwire:2', overkill: false });
  });

  it('a crawler taken by a trap is not an overkill', () => {
    const g = runner('crawler', 3, 18, 'z', 100);
    g.json().sim.traps.push({
      id: 3, kind: 'minefield', row0: 3, row1: 3, col0: 20, col1: 24, charges: 1,
    });
    g.step(100);
    expect(g.json().sim.overkills).toBe(0);
    expect(g.json().sim.kills).toBe(1);
  });

  it('an armored zombie takes one chip and lives', () => {
    const g = runner('armored', 2, 18, '(rot)', 100);
    g.json().sim.traps.push({
      id: 4, kind: 'tripwire', row0: 2, row1: 2, col0: 22, col1: 22, charges: 1,
    });
    g.step(20);
    expect(g.json().buffer.zombies).toHaveLength(1);
    expect(g.json().buffer.zombies[0].hp).toBe(1);
    expect(g.json().sim.traps).toEqual([]);
  });

  it('a fence spends one charge per zombie and dies at zero', () => {
    const g = new Game(1);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    for (let i = 0; i < 2; i++) {
      st.buffer.zombies.push({
        id: 1 + i, kind: 'walker', row: 4 + i, col: 18, text: 'rot', hp: 1, speed: 100,
      });
    }
    st.sim.traps.push({
      id: 5, kind: 'fence', row0: 4, row1: 6, col0: 22, col1: 22, charges: 3,
    });
    g.sim.tick(0);
    g.step(100);
    expect(g.json().sim.traps[0].charges).toBe(1);
    expect(g.json().buffer.zombies).toHaveLength(0);
  });

  it('the barricade resolves a zombie that arrives on the same step', () => {
    // A trap fires only after a *step*, and the step that reaches the wall is
    // the one the barricade takes instead - so a trap under a word already at
    // the wall never goes off. That is what makes the wall's foot dead ground.
    const g = runner('walker', 5, BARRICADE_COL - 4, 'moan', 100);
    g.json().sim.traps.push({
      id: 6, kind: 'tripwire', row0: 5, row1: 5,
      col0: BARRICADE_COL - 1, col1: BARRICADE_COL - 1, charges: 1,
    });
    const evs = g.step(100);
    expect(has(evs, 'barricade_hit')).toBe(true);
    expect(has(evs, 'trap_fire')).toBe(false);
    expect(g.json().sim.traps).toHaveLength(1);
  });

  it('a trap killing the locked zombie drops the lock and keeps the column', () => {
    const g = runner('walker', 5, 18, 'gore', 4);
    const st = g.json();
    st.cursor.row = 5; st.cursor.col = 0;
    g.keys('fg');                             // land the crosshair on it
    expect(st.sim.lockId).toBe(1);
    st.sim.traps.push({
      id: 8, kind: 'fence', row0: 5, row1: 5, col0: 24, col1: 24, charges: 1,
    });
    // The lock rides the word east, so "unchanged" means unchanged from the
    // frame before the trap fired, not from where the crosshair started.
    let last = st.cursor.col;
    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) {
      last = g.json().cursor.col;
      fired = has(g.step(50), 'trap_fire');
    }
    expect(fired).toBe(true);
    expect(g.json().sim.lockId).toBe(0);
    expect(g.json().cursor.col).toBe(last);
  });

  it('a trap survives a night nothing crossed it, and dies with the run', () => {
    const g = shopping(500);
    row(g, 'tripwire');
    g.keys('l');
    g.keys('5G');
    g.keys('f3');
    g.keys('<CR>');
    expect(g.json().sim.traps).toHaveLength(1);
    g.keys('n');
    expect(g.json().sim.traps).toHaveLength(1);
    g.sim.toMenu();
    expect(g.json().sim.traps).toEqual([]);
    g.sim.start();
    expect(g.json().sim.traps).toEqual([]);
    expect(g.json().sim.nextTrapId).toBe(1);
  });
});

describe('the store item table', () => {
  it('holds exactly the fifteen ids, in one order, each priced', () => {
    expect(ITEMS.map((i) => i.id)).toEqual([...ITEM_IDS]);
    expect(ITEMS).toHaveLength(15);
    for (const it of ITEMS) {
      expect(it.price, it.id).toBeGreaterThan(0);
      expect(it.name.length, it.id).toBeGreaterThan(0);
      expect(it.blurb.length, it.id).toBeGreaterThan(0);
      expect(['instant', 'trap']).toContain(it.kind);
    }
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
  });

  it('the four placed items are the trap kinds, and nothing else is', () => {
    expect(ITEMS.filter((i) => i.kind === 'trap').map((i) => i.id))
      .toEqual(['wire', 'tripwire', 'fence', 'minefield']);
  });

  it('sells nothing that permanently changes speed, allowance, lanes or aim', () => {
    // A guard on the table, not on the code: the store is consumables only,
    // and persistent power belongs to the armory.
    const banned = /permanent|forever|every night|lane count|faster|aim assist/i;
    for (const it of ITEMS) expect(it.blurb, it.id).not.toMatch(banned);
    expect(itemById('nope')).toBeUndefined();
  });
});

describe('every string the store card prints fits without truncation', () => {
  // The card prints the selected item's blurb on one full-width line. A blurb
  // that overruns it comes out cut mid-word, which is how the first cut of
  // this screen shipped: fifteen sentences ending in a full stop and nothing
  // else. Assert the tables against the budget instead of the eye.
  it('every blurb fits the blurb line, the NEXT NIGHT caption included', () => {
    for (const it of ITEMS) {
      expect(it.blurb.length, `${it.id}: ${JSON.stringify(it.blurb)}`)
        .toBeLessThanOrEqual(CARD_LINE);
    }
    expect(NEXT_NIGHT_BLURB.length, NEXT_NIGHT_BLURB).toBeLessThanOrEqual(CARD_LINE);
  });

  it('every item name and owned string fits its column', () => {
    for (const it of ITEMS) {
      expect(it.name.length, it.id).toBeLessThanOrEqual(14);
      expect(String(it.price).length, it.id).toBeLessThanOrEqual(5);
    }
  });

  it('every teaching line fits the placement strip', () => {
    // The strip truncates silently, and it is the only place the survey grid
    // is ever explained, so a line that overruns loses the explanation.
    for (const l of [...Screens.PLACE_FIRST,
      Screens.PLACE_KEYS_PLANT, Screens.PLACE_KEYS_ANCHOR]) {
      expect(l.length, JSON.stringify(l)).toBeLessThanOrEqual(Screens.PLACE_LINE);
    }
    // A plant mission puts its own title and hint in the same region.
    for (const step of MISSIONS) {
      expect(`MISSION  ${step.title}`.length, step.title)
        .toBeLessThanOrEqual(Screens.PLACE_LINE);
      expect(step.hint.length, step.hint).toBeLessThanOrEqual(Screens.PLACE_LINE);
    }
  });

  it('the manifest fits at every night, five-kind ones included', () => {
    for (const n of [0, 1, 2, 5, 8, 13, 21, 22, 60, 400]) {
      const [head, mix] = manifestCard(n);
      expect(head.length, `night ${n + 1} head: ${head}`).toBeLessThanOrEqual(CARD_LINE);
      expect(mix.length, `night ${n + 1} mix: ${mix}`).toBeLessThanOrEqual(CARD_LINE);
    }
    // The widest mix there is, spelled out, so a new zombie kind fails here.
    expect(manifestCard(60)[1].split(' ')).toHaveLength(10);
  });
});

describe('boot camp teaches placement', () => {
  /** Start the placement mission by name, whatever index it sits at. */
  function planting(): Game {
    const g = new Game(1, { autoStart: false });
    const i = MISSIONS.findIndex((t) => t.goal === 'plant');
    expect(i, 'no placement mission in MISSIONS').toBeGreaterThanOrEqual(0);
    g.sim.startMission(i);
    return g;
  }

  it('opens straight into placement mode, armed with the mission item', () => {
    const g = planting();
    const st = g.json();
    expect(st.phase).toBe('shop');
    expect(st.sim.shop.mode).toBe('place');
    expect(st.sim.shop.item).toBe('fence');
    expect(st.sim.shop.anchor).toBeNull();
    // Enough in the wallet that the lesson is never about the money.
    expect(st.supplies).toBeGreaterThan(0);
  });

  it('the survey grid and the mission both show up in text()', () => {
    const t = planting().text();
    expect(t).toMatch(/^MISSION boot-trap TRY keys=0 par=4/m);
    expect(t).toMatch(/^PLACING fence/m);
    expect(t).toContain(SURVEY_RULER);
    expect(t).not.toContain('STORE');
  });

  it('a three-lane fence finishes the mission at par', () => {
    const g = planting();
    const i = g.json().sim.mission;
    g.keys('<CR>');
    expect(g.json().sim.shop.anchor).not.toBeNull();
    g.keys('2j');
    g.keys('<CR>');
    const trap = g.json().sim.traps[0];
    expect(trap.kind).toBe('fence');
    expect(trap.row1 - trap.row0 + 1).toBe(3);
    // Back on the field, with the hold running that leads to DONE.
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.missionHold).toBeGreaterThan(0);
    expect(g.json().sim.missionKeys).toBe(4);          // <CR> 2 j <CR>
    const evs = g.step(1200);
    expect(g.json().sim.mission).toBe(i);
    expect(g.json().sim.missionBeat).toBe('done');
    expect(evs.find((e) => e.t === 'mission_done')).toMatchObject({ id: 'boot-trap', keys: 4, par: 4, stars: 3 });
  });

  it('a one-lane fence is a retry, not a pass', () => {
    const g = planting();
    g.keys('<CR>');
    g.keys('<CR>');                    // anchor and plant on the same lane
    expect(g.json().sim.traps[0].row0).toBe(g.json().sim.traps[0].row1);
    // Still placing, still on the mission, and the anchor is cleared for
    // another go rather than left half-set.
    expect(g.json().phase).toBe('shop');
    expect(g.json().sim.shop.mode).toBe('place');
    expect(g.json().sim.shop.anchor).toBeNull();
    expect(g.json().sim.missionHold).toBe(0);
  });

  it('<Esc> clears the anchor instead of opening a store that is not there', () => {
    const g = planting();
    g.keys('<CR>');
    expect(g.json().sim.shop.anchor).not.toBeNull();
    g.keys('<Esc>');
    expect(g.json().sim.shop.anchor).toBeNull();
    expect(g.json().sim.shop.mode).toBe('place');
    expect(g.json().phase).toBe('shop');
  });

  it('r starts the step over, clearing what was planted', () => {
    const g = planting();
    g.keys('<CR>');
    g.keys('<CR>');                    // a one-lane stub
    expect(g.json().sim.traps).toHaveLength(1);
    g.keys('r');
    expect(g.json().sim.traps).toEqual([]);
    expect(g.json().sim.shop.mode).toBe('place');
    expect(g.json().sim.shop.anchor).toBeNull();
  });

  it('the mission leaves no traps or wallet behind when the run starts', () => {
    const g = planting();
    g.keys('<CR>');
    g.keys('2j');
    g.keys('<CR>');
    g.sim.start();
    expect(g.json().sim.traps).toEqual([]);
    expect(g.json().supplies).toBe(0);
    expect(g.json().phase).toBe('playing');
  });
});

describe('a refused command says so', () => {
  // The bug this exists for: in survival charges do not refill, so a player
  // reaching for `dd` on a crowded lane got silence - no shot, no kill, no
  // movement, nothing drawn - and kept reaching until the wall came down.
  const refusals = (evs: GameEvent[]): string[] =>
    evs.filter((e): e is Extract<GameEvent, { t: 'combo_break' }> =>
      e.t === 'combo_break' && e.refused === true).map((e) => e.reason);

  it('an empty magazine refuses out loud and flashes', () => {
    const g = scene([['walker', 1, 0, 'aa']]);
    place(g, 1, 0);
    g.json().charges.dd = 0;
    g.json().sim.flashUntil = 0;
    const evs = g.keys('dd');
    expect(refusals(evs)).toHaveLength(1);
    expect(refusals(evs)[0]).toContain('no dd charges');
    expect(g.json().sim.flashUntil).toBeGreaterThan(0);
  });

  it('names the store, because that is now the only way to get one', () => {
    const g = scene([['walker', 1, 0, 'aa']]);
    place(g, 1, 0);
    g.json().charges.D = 0;
    expect(refusals(g.keys('D'))[0]).toContain('store');
  });

  it('a motion that lands nowhere is refused, not silently dropped', () => {
    const g = scene([['walker', 5, 10, 'gore']]);
    place(g, 5, 0);
    g.json().sim.flashUntil = 0;
    const evs = g.keys('dfq');            // no `q` anywhere on the lane
    expect(refusals(evs)).toHaveLength(1);
    expect(refusals(evs)[0]).toContain('found nothing');
    expect(g.json().sim.flashUntil).toBeGreaterThan(0);
  });

  it('an ordinary combo break is not a refusal', () => {
    // Two of them, so killing one does not clear the night and send the run
    // to the store, where the clock stops and nothing can time out.
    const g = scene([['walker', 5, 10, 'gore'], ['walker', 9, 10, 'bile']]);
    place(g, 5, 10);
    g.keys('dw');                          // a kill, so the combo is running
    const evs = g.step(4000);              // and then it times out
    expect(evs.some((e) => e.t === 'combo_break')).toBe(true);
    expect(refusals(evs)).toEqual([]);
  });

  it('a command that fires into the dark still shows its tracer', () => {
    // This one is visible already - `emitShots` draws the shot - so it stays
    // an ordinary break rather than a refusal.
    const g = scene([['walker', 5, 40, 'gore']]);
    place(g, 5, 0);
    const evs = g.keys('dw');
    expect(evs.some((e) => e.t === 'shot')).toBe(true);
    expect(refusals(evs)).toEqual([]);
  });
});

describe('suspend and resume', () => {
  it('a restored run steps exactly as the run it was cut from', () => {
    const a = new Game(7);
    a.step(6000);
    a.keys('3jdw');
    a.step(900);
    const snap = a.sim.snapshot();
    const wire = JSON.parse(JSON.stringify(snap)) as typeof snap;   // through localStorage

    const b = new Game(99, { autoStart: false });
    b.restore(wire.state, wire.progress);
    expect(b.json()).toEqual(a.json());

    for (let i = 0; i < 12; i++) {
      a.step(500); b.step(500);
      a.keys('$'); b.keys('$');
    }
    expect(b.json()).toEqual(a.json());
    expect(b.text()).toBe(a.text());
  });

  it('the snapshot is a copy: the live run moving on does not change it', () => {
    const g = new Game(3);
    g.step(3000);
    const snap = g.sim.snapshot();
    const before = JSON.stringify(snap.state);
    g.step(5000);
    g.keys('Gdw');
    expect(JSON.stringify(snap.state)).toBe(before);
  });

  it('restore keeps the state object the renderer and ledger hold', () => {
    const g = new Game(3);
    const ref = g.json();
    g.step(2000);
    const snap = g.sim.snapshot();
    g.sim.toMenu();
    g.restore(snap.state, snap.progress);
    expect(g.json()).toBe(ref);
    expect(ref.phase).toBe('playing');
  });

  it('restore refuses garbage instead of corrupting the run', () => {
    const g = new Game(3);
    expect(() => g.restore({} as never)).toThrow();
    expect(g.json().phase).toBe('playing');
  });

  it('a run suspended at the store resumes at the store', () => {
    const g = new Game(5);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.spawnedThisWave = 3; st.sim.killsThisWave = 3; st.sim.waveSize = 3;
    g.step(100);
    expect(st.phase).toBe('shop');
    const snap = g.sim.snapshot();
    const b = new Game(1, { autoStart: false });
    b.restore(snap.state, snap.progress);
    expect(b.json().phase).toBe('shop');
    b.keys('n');
    expect(b.json().phase).toBe('playing');
    expect(b.json().wave).toBe(2);
  });
});
