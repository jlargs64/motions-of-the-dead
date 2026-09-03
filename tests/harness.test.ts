import { describe, expect, it } from 'vitest';
import { Game } from '../src/harness/api';
import { dispatch, newRepl } from '../src/harness/repl';
import { optimalKill } from '../src/sim/optimal';
import { shopRoutine } from '../src/harness/shopbot';
import { MISSIONS } from '../src/sim/missions';
import type { Zombie } from '../src/core/types';

describe('text() surface', () => {
  const g = new Game(1);
  g.step(8000);
  const t = g.text();

  it('leads with the status line, naming the lesson', () => {
    expect(t.split('\n')[0]).toMatch(
      /^WAVE \d+ "[^"]+"  SCORE \d+  SUPPLIES \d+  COMBO x\d+  BARRICADE \d+\/\d+  dd:\d+ D:\d+  PENDING: /,
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
    const i = lines.findIndex((l) => l.startsWith(`lane ${String(cur.row + 1).padStart(2, ' ')} `));
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
  it('numbers lanes 1-based so {n}G agrees with the printout', () => {
    const h = new Game(1);
    h.keys('7G');
    expect(h.json().cursor.row).toBe(6);
    expect(h.text()).toMatch(/\nCURSOR lane 7 col /);
    expect(h.text()).toMatch(/^lane  1 /m);
    expect(h.text()).not.toMatch(/^lane  0 /m);
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
      // Survival buys its ammunition now (DECISIONS #78), so the bot shops
      // between nights exactly as a player does - through `keys()`.
      if (st.phase === 'shop') { shopRoutine(g); continue; }
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
      if (st.phase === 'shop') { shopRoutine(g); continue; }
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

describe('text() on the menu', () => {
  const menuGame = () => new Game(1, { autoStart: false });

  it('prints the rows with > on the cursor instead of the field', () => {
    const g = menuGame();
    const t = g.text();
    expect(t).toContain('PHASE menu');
    expect(t).toContain('MODE survival');
    expect(t).toContain('> survival');
    expect(t).not.toContain('lane  1');
  });
  it('keys() drives the cursor with the same vocabulary the browser uses', () => {
    const g = menuGame();
    g.keys('jj');
    const marked = g.text().split('\n').filter((l) => l.startsWith('>'));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('drills');
  });
  it('search, counts and absolute jumps all work through keys()', () => {
    const g = menuGame();
    g.keys('/rec<CR>');
    expect(g.text()).toMatch(/^> record/m);
    g.keys('gg');
    expect(g.text()).toMatch(/^> survival/m);
    g.keys('3j');
    expect(g.text()).toMatch(/^> armory/m);
    g.keys('G');
    expect(g.text()).toMatch(/^> about/m);
    g.keys('<CR>');
    expect(g.text()).toContain('MENU about');
    expect(g.text()).toContain('The field is a text buffer read side-on');
    g.keys('h');
  });
  it('reports E486 for a pattern that is not there', () => {
    const g = menuGame();
    g.keys('/xyz<CR>');
    expect(g.text()).toContain('E486: Pattern not found: xyz');
    expect(g.text()).toMatch(/^> survival/m);
  });
  it('i starts a survival run and the field comes back', () => {
    const g = menuGame();
    g.keys('i');
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.mode).toBe('survival');
    expect(g.text()).toContain('lane  1');
  });
  it('the missions row opens the mission list, it does not start a run', () => {
    const g = menuGame();
    g.keys('j<CR>');
    expect(g.json().phase).toBe('menu');
    const t = g.text();
    expect(t).toContain('MENU missions');
    expect(t).toMatch(/^> Take aim/m);
  });
  it('a mission row starts that mission in mission mode', () => {
    const g = menuGame();
    g.keys('j<CR><CR>');
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.mode).toBe('mission');
    expect(g.json().sim.mission).toBe(0);
    expect(g.json().sim.missionBeat).toBe('try');
    expect(g.text()).toMatch(/^MISSION boot-aim TRY keys=0 par=\d+/m);
  });
  it('picking a later mission starts that one, not the first', () => {
    const g = menuGame();
    g.keys('j<CR>');          // the mission list
    g.keys('G<CR>');          // the last mission in the syllabus
    expect(g.json().sim.mission).toBe(MISSIONS.length - 1);
    expect(g.json().sim.mode).toBe('mission');
  });
  it('the mission list prints its sections and scrolls nothing headless', () => {
    const g = menuGame();
    g.keys('j<CR>');
    const t = g.text();
    expect(t).toContain('-- Boot camp --');
    expect(t).toContain('-- Basic Vim --');
    expect(t.split('\n').filter((l) => /^[> ] /.test(l))).toHaveLength(MISSIONS.length);
    g.keys('}}');
    expect(g.text()).toMatch(/^> Delete Words/m);
  });
  it('search reaches a mission by title', () => {
    const g = menuGame();
    g.keys('j<CR>');
    g.keys('/count<CR>');
    expect(g.text()).toMatch(/^> Count them/m);
    g.keys('<CR>');
    expect(g.json().sim.mission).toBe(5);
  });
  it('Esc on DONE lands back on the list with that mission under the cursor', () => {
    const g = menuGame();
    g.keys('j<CR>');
    g.keys('/fire<CR><CR>');
    g.keys('wdw');
    g.step(1200);
    expect(g.text()).toContain('MISSION boot-fire DONE keys=3 par=3');
    g.keys('<Esc>');
    expect(g.json().phase).toBe('menu');
    expect(g.text()).toContain('MENU missions');
    expect(g.text()).toMatch(/^> Fire/m);
  });
  it('t no longer starts anything', () => {
    const g = menuGame();
    g.keys('t');
    expect(g.json().phase).toBe('menu');
  });
  it('a soon row says so and changes no phase', () => {
    const g = menuGame();
    g.keys('jjj<CR>');
    expect(g.json().phase).toBe('menu');
    expect(g.text()).toContain('soon');
  });
  it('opening a sub-screen and backing out is reported', () => {
    const g = menuGame();
    g.keys('5G<CR>');
    expect(g.text()).toContain('MENU ledger');
    g.keys('h');
    expect(g.text()).toContain('MENU main');
  });
  it('toMenu() comes back to the menu from a run', () => {
    const g = menuGame();
    g.keys('i');
    g.step(2000);
    g.sim.toMenu();
    expect(g.json().phase).toBe('menu');
    expect(g.text()).toContain('> survival');
  });
  it('toTitle() is the same thing', () => {
    const g = menuGame();
    g.keys('i');
    g.sim.toTitle();
    expect(g.json().phase).toBe('menu');
  });
});

describe('text() at the store', () => {
  /** A cleared survival night, with the store open and money in the bank. */
  function shopping(supplies = 240): Game {
    const g = new Game(1);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    g.json().supplies = supplies;
    return g;
  }

  it('prints a STORE block with one marked row and a NEXT NIGHT row', () => {
    const g = shopping(240);
    g.keys('j');
    const t = g.text();
    expect(t).toContain('STORE');
    expect(t).toContain('SUPPLIES 240');
    expect(t.split('\n').filter((l) => l.startsWith('> '))).toHaveLength(1);
    expect(t).toContain('[next]');
    expect(t).toMatch(/^> \[D\]/m);
  });

  it('replaces the LESSON line and says the manifest is locked', () => {
    const t = shopping().text();
    expect(t).not.toMatch(/^LESSON /m);
    expect(t).toContain('MANIFEST  locked');
  });

  it('prints the placement strip and the survey grid while placing', () => {
    const g = shopping(500);
    g.keys('gg');
    g.keys('9j');                 // [tripwire]
    g.keys('l');
    g.keys('5G');
    g.keys('f3');
    const t = g.text();
    expect(t).toMatch(/^PLACING tripwire {2}crosshair lane 5 col 30 {2}anchor none {2}cost 50/m);
    expect(t).toContain('0.........1.........2.........3');
  });

  it('quotes the live span cost once a fence is anchored', () => {
    const g = shopping(500);
    g.keys('gg');
    g.keys('10j');                // [fence]
    g.keys('l');
    g.keys('3G');
    g.keys('<CR>');
    g.keys('2j');
    expect(g.text()).toMatch(/anchor lane 3 col 0 {2}cost 120/);
  });

  it('prints a TRAPS table in every phase, and (none) when there are none', () => {
    const g = shopping(500);
    expect(g.text()).toMatch(/^TRAPS {2}id kind {7}lanes {2}cols {5}charges$/m);
    expect(g.text()).toContain('(none)');
    g.keys('gg');
    g.keys('9j');
    g.keys('l');
    g.keys('5G');
    g.keys('f3');
    g.keys('<CR>');
    g.keys('n');                  // back to play
    const t = g.text();
    expect(t).toMatch(/^ +1 tripwire {3}5 {6}30 {7} {6}1$/m);
  });

  it('lists wired lanes on their own line', () => {
    const g = shopping(500);
    expect(g.text()).toContain('WIRE  lanes (none)');
    g.keys('gg');
    g.keys('8j');                 // [wire]
    g.keys('l');
    g.keys('4G');
    g.keys('<CR>');
    expect(g.text()).toContain('WIRE  lanes 4');
  });
});

describe('shop keys go through the one key path', () => {
  function shopping(): Game {
    const g = new Game(1);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    g.json().supplies = 500;
    return g;
  }

  it('l buys and n leaves, without reaching the Vim engine', () => {
    const g = shopping();
    g.keys('gg');
    g.keys('5j');                 // [planks]
    g.json().barricade.hp = 50;
    const evs = g.keys('l');
    expect(evs.some((e) => e.t === 'buy' && e.item === 'planks')).toBe(true);
    expect(g.pending()).toBe('');
    g.keys('n');
    expect(g.json().phase).toBe('playing');
  });

  it('n is next-night in the list and a search repeat on the field', () => {
    const g = shopping();
    g.keys('n');
    expect(g.json().wave).toBe(2);
    // On the field the same key is Vim's `n`, which with no prior search is
    // an unknown key - proof the interception is scoped to the store. It is
    // silent, so the combo break is the only thing left to see.
    const evs = g.keys('n');
    expect(evs.some((e) => e.t === 'combo_break' && e.reason === 'unknown key')).toBe(true);
  });

  it('an unknown key on the field flashes nothing at all', () => {
    const g = shopping();
    g.keys('n');                          // to the field
    g.json().sim.flashUntil = 0;
    const evs = g.keys('v');              // no visual mode; a common fat-finger
    expect(g.json().sim.flashUntil).toBe(0);
    expect(evs.some((e) => e.t === 'combo_break' && e.reason === 'unknown key')).toBe(true);
  });

  it('in placement mode l is a motion again, not a purchase', () => {
    const g = shopping();
    g.keys('gg');
    g.keys('9j');
    g.keys('l');                  // buys into placement
    expect(g.json().sim.shop.mode).toBe('place');
    const col = g.json().sim.shop.place.col;
    g.keys('l');                  // now it moves east
    expect(g.json().sim.shop.place.col).toBe(col + 1);
    expect(g.json().sim.traps).toEqual([]);
  });

  it('shop keys are not counted as fighting keystrokes', () => {
    const g = shopping();
    const before = g.json().sim.keystrokes;
    g.keys('3j');
    g.keys('l');
    expect(g.json().sim.keystrokes).toBe(before);
  });

  it('a shopping trip replays byte for byte through the repl grammar', () => {
    const lines = [
      'step 20', 'gg', '5j', 'l', 'jj', 'l', 'n', 'step 400', '7G', 'dw', 'step 300',
    ];
    const play = () => {
      const r = newRepl(1);
      // Clear the night the same way both runs will, then shop and fight.
      const st = r.game.json();
      st.sim.spawnQueue.length = 0;
      st.buffer.zombies.length = 0;
      st.sim.resolvedThisWave = 1;
      st.sim.killsThisWave = 1;
      st.supplies = 500;
      const evs = lines.map((l) => JSON.stringify(dispatch(r, l).events));
      return { evs: evs.join('|'), state: JSON.stringify(r.game.json()) };
    };
    const a = play();
    const b = play();
    expect(a.evs).toBe(b.evs);
    expect(a.state).toBe(b.state);
    expect(a.evs).toContain('"t":"buy"');
  });

  it('the shop bot leaves the store on the field, every time', () => {
    const g = shopping();
    shopRoutine(g);
    expect(g.json().phase).toBe('playing');
    expect(g.json().sim.shop.mode).toBe('list');
  });
});

describe('named keys are one token each', () => {
  function shopping(): Game {
    const g = new Game(1);
    const st = g.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    st.sim.killsThisWave = 1;
    g.step(20);
    g.json().supplies = 500;
    return g;
  }

  it('an arrow key in the store is one unknown key, not a run of letters', () => {
    // Reported as: pressing the down arrow in the store closed it and started
    // the next night. Raw `ArrowDown` split into A r r o w D o w n, and `n`
    // is NEXT NIGHT (DECISIONS #90). The browser now sends `<ArrowDown>`.
    const g = shopping();
    expect(g.json().phase).toBe('shop');
    const evs = g.keys('<ArrowDown>');
    expect(g.json().phase).toBe('shop');
    expect(g.json().wave).toBe(1);
    expect(g.json().sim.shop.cursor).toBe(0);
    expect(g.pending()).toBe('');
    expect(evs.some((e) => e.t === 'combo_break' && e.reason === 'unknown key')).toBe(true);
  });

  it('the raw browser name is what used to leave the store', () => {
    // The regression this guards against, spelled out: fed unwrapped, the
    // name's own letters are commands.
    const g = shopping();
    g.keys('ArrowDown');
    expect(g.json().phase).toBe('playing');
    expect(g.json().wave).toBe(2);
  });
});
