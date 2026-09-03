import { describe, expect, it } from 'vitest';
import { Screens } from '../src/ui/screens';
import { Ledger } from '../src/ui/ledger';
import { LEDGER_TABLE_LINES, MAIN_ROWS, Menu, MISSION_ROWS, OPTION_ROWS } from '../src/ui/menu';
import { FAMILIES } from '../src/sim/drills';
import type { DrillRecord } from '../src/save/schema';
import { ABOUT_PAGES } from '../src/ui/about';
import { MissionDemo } from '../src/ui/missiondemo';
import { DEMO_KEY_MS, MISSIONS, missionForLesson } from '../src/sim/missions';
import type { MissionRecord } from '../src/save/schema';
import { createState } from '../src/core/state';
import { LESSON_COUNT } from '../src/sim/waves';
import { Bus } from '../src/core/bus';
import { SaveScreen } from '../src/ui/savescreen';
import {
  E482_CLIPBOARD, E484_OPEN, E485_READ, SaveStore, exportFilename, exportSave, importSave,
} from '../src/save/save';
import { defaultSave } from '../src/save/schema';
import type { GameState } from '../src/core/state';
import type { Renderer } from '../src/render/renderer';
import {
  CALLOUT_BAND, CALLOUT_MAX, CALLOUT_MS, HUD_BOUNDS, calloutLayout,
} from '../src/render/renderer';
import type { Callout, CalloutBox } from '../src/render/renderer';
import { MULTI_KILL_NAMES, allMedalNames } from '../src/sim/medals';
import { ITEMS, SHOP_ROWS } from '../src/sim/store';

const COLS = 60;
const TOP = -6;      // first row the renderer gives the UI layer
const BOT = 19;      // last row

interface Box { what: string; col: number; row: number; w: number }

/**
 * A Renderer that draws nothing and measures everything, using the real
 * placement arithmetic from src/render/renderer.ts.
 */
interface Panel { col: number; row: number; w: number; h: number }

class Ruler {
  boxes: Box[] = [];
  panels: Panel[] = [];

  panel(col: number, row: number, w: number, h: number): void {
    this.panels.push({ col, row, w, h });
  }
  text(s: string, col: number, row: number, _color?: string, scale = 1): void {
    if (!s) return;
    this.boxes.push({ what: JSON.stringify(s), col, row, w: s.length * scale });
  }
  centerText(s: string, row: number, color?: string, scale = 1): void {
    if (!s) return;
    this.text(s, (COLS - s.length * scale) / 2, row, color, scale);
  }
  keycap(label: string, col: number, row: number, w?: number): void {
    this.boxes.push({ what: `key ${label}`, col, row, w: w ?? Math.max(2, label.length + 1.4) });
  }
  rule(col: number, row: number, w: number): void {
    this.boxes.push({ what: 'rule', col, row, w });
  }
  overlay(): void { /* full screen, never constrained */ }
  pageTurn(): void { /* a canvas sweep, not a placed string */ }
  fillCells(): void { /* decorative */ }
  showcmd(): void { /* renderer-owned */ }
}

/** Does this string sit inside this card, with a half-cell of margin? */
function inside(b: Box, p: Panel): boolean {
  return b.col >= p.col + 0.5
    && b.col + b.w <= p.col + p.w - 0.5
    && b.row >= p.row + 0.5
    && b.row <= p.row + p.h - 1.5;
}

function check(name: string, draw: (r: Renderer) => void): void {
  const ruler = new Ruler();
  draw(ruler as unknown as Renderer);
  expect(ruler.panels.length, `${name}: every card must open with a panel()`)
    .toBeGreaterThan(0);

  for (const b of ruler.boxes) {
    const end = b.col + b.w;
    // The glyph atlas bakes 32..126 and nothing else (DECISIONS R11).
    expect(b.what, `${name}: ${b.what} is not printable ASCII`).toMatch(/^[\x20-\x7e]*$/);
    expect(b.col, `${name}: ${b.what} starts left of the grid`).toBeGreaterThanOrEqual(0);
    expect(end, `${name}: ${b.what} runs past column ${COLS} (ends ${end.toFixed(1)})`)
      .toBeLessThanOrEqual(COLS);
    expect(b.row, `${name}: ${b.what} above the drawable band`).toBeGreaterThanOrEqual(TOP);
    expect(b.row, `${name}: ${b.what} below the drawable band`).toBeLessThanOrEqual(BOT);

    // and inside one of the cards this draw put down. A screen may use more
    // than one panel - the placement strip is a header and a footer - so a
    // string has to fit *a* card, not the last one drawn.
    const home = ruler.panels.find((p) => inside(b, p));
    expect(home, `${name}: ${b.what} at (${b.col.toFixed(1)},${b.row}) ends `
      + `${end.toFixed(1)} and fits none of the ${ruler.panels.length} panel(s): `
      + ruler.panels.map((p) => `[${p.col}..${p.col + p.w} rows ${p.row}..${p.row + p.h}]`).join(' '))
      .toBeDefined();
  }

  // nothing may collide with anything else on the same row
  const byRow = new Map<number, Box[]>();
  for (const b of ruler.boxes) {
    const list = byRow.get(b.row) ?? [];
    list.push(b);
    byRow.set(b.row, list);
  }
  for (const [row, list] of byRow) {
    list.sort((a, b) => a.col - b.col);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      expect(prev.col + prev.w, `${name}: row ${row}: ${prev.what} overlaps ${list[i].what}`)
        .toBeLessThanOrEqual(list[i].col + 1e-9);
    }
  }
}

function screens(): { s: Screens; st: GameState; store: SaveStore } {
  const st = createState(1);
  const store = new SaveStore(defaultSave());
  const led = new Ledger(st, new Bus(), store);
  return { s: new Screens(led), st, store };
}

describe('card layout fits the panel it is printed on', () => {
  // The store card is sixteen selectable rows on one panel, so it is the
  // tightest card in the game: it gets asserted at every cursor position, and
  // with the longest strings the item table and the wallet can produce.
  it('the store card, on every row', () => {
    for (let cur = 0; cur < SHOP_ROWS; cur++) {
      const { s, st } = screens();
      st.phase = 'shop';
      st.wave = 7;
      st.supplies = 9_999_999;
      st.sim.shop.cursor = cur;
      check(`store row ${cur}`, (r) => s.drawStore(r, st));
    }
  });

  it('the store card with the manifest line unlocked and every cap reached', () => {
    const { s, st } = screens();
    st.phase = 'shop';
    st.wave = 99;                 // the longest night number and manifest line
    st.supplies = 9_999_999;
    st.sim.manifest = true;
    st.sim.chargeCap = { dd: 999, D: 999 };
    st.charges = { dd: 999, D: 999 };
    for (const it of ITEMS) st.sim.purchases[it.id] = 999;
    st.sim.wireLanes = 0xffff;
    st.sim.freeRepeat = 999;
    check('store maxed', (r) => s.drawStore(r, st));
  });

  it('the store card with an empty wallet, so every row carries a tag', () => {
    const { s, st } = screens();
    st.phase = 'shop';
    st.wave = 7;
    st.supplies = 0;                 // every row is either full or `--`
    check('store broke', (r) => s.drawStore(r, st));
  });

  it('the placement strip with its teaching region, at every length', () => {
    // The region grows the panel a row per line, so the strip has to be
    // checked at every size it can be - including one line past the cap.
    const lines = [
      'WARM-UP  Set a trap', 'a'.repeat(Screens.PLACE_LINE),
      'r  start the step over', 'a fourth line', 'a fifth, past the cap',
    ];
    for (let n = 0; n <= lines.length; n++) {
      const { s, st } = screens();
      st.phase = 'shop';
      st.supplies = 9_999_999;
      st.sim.shop.mode = 'place';
      st.sim.shop.item = 'fence';
      st.sim.shop.place = { row: 15, col: 51 };
      st.sim.shop.anchor = { row: 0, col: 0 };
      check(`placing + ${n} teach lines`, (r) => s.drawPlacement(r, st, lines.slice(0, n)));
    }
  });

  it('the placement strip, in both modes and with the longest span cost', () => {
    for (const item of ['tripwire', 'wire', 'fence', 'minefield'] as const) {
      for (const anchored of [false, true]) {
        const { s, st } = screens();
        st.phase = 'shop';
        st.supplies = 9_999_999;
        st.sim.shop.mode = 'place';
        st.sim.shop.item = item;
        st.sim.shop.place = { row: 15, col: 51 };
        st.sim.shop.anchor = anchored ? { row: 0, col: 0 } : null;
        check(`placing ${item}${anchored ? ' anchored' : ''}`,
          (r) => s.drawPlacement(r, st));
      }
    }
  });

  it('main menu, on every row and with every footer line', () => {
    const { s } = screens();
    const led = (s as unknown as { ledger: Ledger }).ledger;
    led.data.highScore = 9_999_999_999;

    for (let i = 0; i < MAIN_ROWS.length; i++) {
      const m = new Menu();
      for (let k = 0; k < i; k++) m.feed('j');
      check(`menu row ${MAIN_ROWS[i].id}`, (r) => s.drawMenu(r, m, 0));
      check(`menu row ${MAIN_ROWS[i].id} (blink off)`, (r) => s.drawMenu(r, m, 600));
      // and with that row's `soon` note, which is the longest line it can post.
      // A row that opens a sub-screen is drawn by that screen's own card, not
      // by `drawMenu` - main.ts dispatches on `menu.screen` - so only the rows
      // that stay on `main` are checked here.
      m.feed('<CR>');
      if (m.screen === 'main') {
        check(`menu row ${MAIN_ROWS[i].id} selected`, (r) => s.drawMenu(r, m, 0));
      }
      m.reset();
    }

    // A live search, a long one, and the longest E486 the rows can produce.
    const m = new Menu();
    for (const q of ['', 'l', 'led', 'a'.repeat(60)]) {
      m.reset();
      m.feed('/');
      for (const ch of q) m.feed(ch);
      check(`menu searching [${q.length}]`, (r) => s.drawMenu(r, m, 0));
      m.feed('<CR>');
      check(`menu searched [${q.length}]`, (r) => s.drawMenu(r, m, 0));
    }

    // A pending count in the corner, at its widest.
    m.reset();
    for (const ch of '999') m.feed(ch);
    check('menu with a pending count', (r) => s.drawMenu(r, m, 0));

    // and with no high score at all, which is the longer of the two lines
    led.data.highScore = 0;
    m.reset();
    check('menu, no high score', (r) => s.drawMenu(r, m, 0));
  });

  it('about, on every page', () => {
    const { s } = screens();
    const m = new Menu();
    m.feed('G'); m.feed('l');                // main -> about
    expect(m.screen).toBe('about');
    for (let i = 0; i < ABOUT_PAGES.length; i++) {
      check(`about page ${ABOUT_PAGES[i].id}`, (r) => s.drawAbout(r, m));
      m.feed('j');
    }
    // and with the longest footer line it can carry
    m.feed('/'); for (const ch of 'a'.repeat(60)) m.feed(ch);
    check('about, searching', (r) => s.drawAbout(r, m));
    m.feed('<CR>');
    check('about, E486', (r) => s.drawAbout(r, m));
  });

  it('mission select, every mission at every frame of its demo', () => {
    const { s } = screens();
    const open = (i: number): Menu => {
      const m = new Menu();
      m.feed('j'); m.feed('<CR>');            // main -> missions
      for (let k = 0; k < i; k++) m.feed('j');
      return m;
    };

    // Every mission starred and played, with the widest best there is, so the
    // pane's par/best line is measured at its longest.
    const full: Record<string, MissionRecord> = {};
    for (const m of MISSIONS) full[m.id] = { stars: 3, bestKeys: 999_999 };

    for (let i = 0; i < MISSION_ROWS.length; i++) {
      const m = open(i);
      const demo = new MissionDemo();
      demo.sync(i);
      // Every keystroke of the demo redraws the pane, so every intermediate
      // field the demo can produce has to fit it. Walking down from the top
      // also scrolls the window through every position it can take.
      const frames = MISSIONS[i].demo.keys.length + 4;
      for (let f = 0; f <= frames; f++) {
        check(`missions ${MISSIONS[i].title} frame ${f}`, (r) => s.drawMissions(r, m, demo));
        demo.advance(DEMO_KEY_MS);
      }
      check(`missions ${MISSIONS[i].title} (all starred)`, (r) => s.drawMissions(r, m, demo, full));
    }

    // Jumping straight to the bottom and back scrolls by whole windows.
    const far = open(0);
    const d0 = new MissionDemo();
    d0.sync(0);
    far.feed('G');
    d0.sync(far.cursor);
    check('missions after G', (r) => s.drawMissions(r, far, d0));
    far.feed('g'); far.feed('g');
    d0.sync(0);
    check('missions after gg', (r) => s.drawMissions(r, far, d0));
    for (const k of ['}', '}', '}', '{']) {
      far.feed(k);
      d0.sync(far.cursor);
      check(`missions after ${k}`, (r) => s.drawMissions(r, far, d0));
    }

    // and with the footer carrying a search, an error and a pending count
    const m = open(0);
    const demo = new MissionDemo();
    demo.sync(0);
    m.feed('/');
    for (const ch of 'z'.repeat(60)) m.feed(ch);
    check('missions searching', (r) => s.drawMissions(r, m, demo));
    m.feed('<CR>');
    check('missions E486', (r) => s.drawMissions(r, m, demo));
    for (const ch of '999') m.feed(ch);
    check('missions pending count', (r) => s.drawMissions(r, m, demo));
  });

  it('options screen, every value and every row under the cursor', () => {
    const { s } = screens();
    for (const gore of ['off', 'low', 'full'] as const) {
      for (const lineNumbers of ['off', 'absolute', 'relative'] as const) {
        for (const muted of [true, false]) {
          for (let i = 0; i < OPTION_ROWS.length; i++) {
            const m = new Menu();
            m.feed('6'); m.feed('G'); m.feed('l');
            for (let k = 0; k < i; k++) m.feed('j');
            check(`options ${gore}/${lineNumbers} muted=${muted} row=${OPTION_ROWS[i].id}`,
              (r) => s.drawOptions(r, m, muted, { gore, lineNumbers, equipped: {} }));
          }
        }
      }
    }
    // and with the footer carrying a search and an error
    const m = new Menu();
    m.feed('6'); m.feed('G'); m.feed('l');
    m.feed('/');
    for (const ch of 'z'.repeat(60)) m.feed(ch);
    check('options searching', (r) => s.drawOptions(r, m, false,
      { gore: 'full', lineNumbers: 'relative', equipped: {} }));
    m.feed('<CR>');
    check('options E486', (r) => s.drawOptions(r, m, false,
      { gore: 'full', lineNumbers: 'relative', equipped: {} }));
  });

  it('drills screen, every row, with every best at its widest and every tag on', () => {
    const { s } = screens();
    const led = (s as unknown as { ledger: Ledger }).ledger;
    const open = (): Menu => { const m = new Menu(); m.feed('j'); m.feed('j'); m.feed('<CR>'); return m; };
    expect(open().screen).toBe('drills');
    for (let i = 0; i < FAMILIES.length; i++) {
      const m = open();
      for (let k = 0; k < i; k++) m.feed('j');
      check(`drills row ${FAMILIES[i].id} (no bests)`, (r) => s.drawDrills(r, m));
    }
    const full: Record<string, DrillRecord> = {};
    for (const f of FAMILIES) full[f.id] = { best: 999, perfect: 999 };
    // Every family the coach can name, so `overdue` lands on three rows.
    for (const tok of ['f', 'i(', '*']) led.data.missed[tok] = 99_999;
    expect(led.coach()).toHaveLength(3);
    for (let i = 0; i < FAMILIES.length; i++) {
      const m = open();
      for (let k = 0; k < i; k++) m.feed('j');
      check(`drills row ${FAMILIES[i].id} (maxed)`, (r) => s.drawDrills(r, m, full));
    }
    const m = open();
    m.feed('/'); for (const ch of 'q'.repeat(60)) m.feed(ch);
    check('drills searching', (r) => s.drawDrills(r, m, full));
    m.feed('<CR>');
    check('drills E486', (r) => s.drawDrills(r, m, full));
  });

  it('drill strip and end card, every family at the widest values', () => {
    const { s, st } = screens();
    const led = (s as unknown as { ledger: Ledger }).ledger;
    st.phase = 'playing';
    st.sim.mode = 'drill';
    st.sim.kills = 999;
    st.sim.drillPerfect = 999;
    st.sim.drillScenes = 999;
    st.buffer.zombies.push({ id: 7, kind: 'bloater', row: 15, col: 41, text: 'exsanguine', hp: 1, speed: 0 });
    for (const f of FAMILIES) {
      st.sim.drill = f.id;
      for (const left of [59_999, 9_999, 0]) {
        st.sim.drillLeft = left;
        st.sim.drillTarget = 7;
        check(`drill strip ${f.id} ${left}ms`, (r) => s.drawDrillStrip(r, st));
        st.sim.drillTarget = 0;
        check(`drill strip ${f.id} ${left}ms (no target)`, (r) => s.drawDrillStrip(r, st));
      }
      st.phase = 'stats';
      check(`drill end ${f.id} (first run)`, (r) => s.drawDrillEnd(r, st, null, true));
      check(`drill end ${f.id} (beaten)`, (r) => s.drawDrillEnd(r, st, { best: 999, perfect: 999 }, true));
      check(`drill end ${f.id} (not a best)`, (r) => s.drawDrillEnd(r, st, { best: 999, perfect: 999 }, false));
      st.phase = 'playing';
    }
    // and with a coach line on the end card
    for (const tok of ['f', 'i(', '*']) led.data.missed[tok] = 99_999;
    st.phase = 'stats';
    st.sim.drill = 'word-objects';
    check('drill end + coach', (r) => s.drawDrillEnd(r, st, { best: 1, perfect: 0 }, true));
  });

  it('ledger screen, empty and with the longest lifetime it can hold', () => {
    const { s } = screens();
    const led = (s as unknown as { ledger: Ledger }).ledger;
    const m = new Menu();
    m.feed('5'); m.feed('G'); m.feed('l');
    expect(m.screen).toBe('ledger');

    check('ledger (fresh profile)', (r) => s.drawLedgerScreen(r, m));

    led.data.highScore = 9_999_999_999;
    led.data.kills = 9_999_999_999;
    led.data.runs = Array.from({ length: 40 }, (_, i) => ({
      at: i, wave: 33, score: 9_999_999, kills: 99_999, keystrokes: 400_000, kpk: 999.99,
    }));
    // The widest tokens the ledger can name, at the widest counts, and more
    // rows than the table shows so every scroll position is drawn.
    for (const tok of ['di(', 'ca"', 'd3w', 'dd', 'D', 'f', 'gg', '{n}', 'iw', '*', '$', '}', 'M', 'x']) {
      led.data.motions[tok] = { used: 99_999, kills: 99_999 };
      led.data.missed[tok] = 99_999;
    }
    for (const name of ['PERFECT', 'SNIPE', 'KILLIONAIRE']) led.data.medals[name] = 99_999;
    m.ledgerRows = () => led.table().length;
    expect(led.table().length).toBeGreaterThan(LEDGER_TABLE_LINES);
    expect(led.coach()).toHaveLength(3);
    check('ledger (full)', (r) => s.drawLedgerScreen(r, m));
    for (let i = 0; i < led.table().length; i++) {
      m.feed('j');
      check(`ledger (full) scrolled ${i + 1}`, (r) => s.drawLedgerScreen(r, m));
    }
    // clamps: one more `j` moves nothing, and `k` all the way back
    const bottom = m.ledgerTop;
    m.feed('j');
    expect(m.ledgerTop).toBe(bottom);
    expect(bottom).toBe(led.table().length - LEDGER_TABLE_LINES);
    for (let i = 0; i < 40; i++) m.feed('k');
    expect(m.ledgerTop).toBe(0);
    check('ledger (full) scrolled back', (r) => s.drawLedgerScreen(r, m));

    // one run only, so the "last 1 run" singular is measured too
    led.data.runs = [{ at: 1, wave: 3, score: 10, kills: 1, keystrokes: 9, kpk: 9 }];
    check('ledger (one run)', (r) => s.drawLedgerScreen(r, m));

    m.feed('/');
    for (const ch of 'q'.repeat(60)) m.feed(ch);
    m.feed('<CR>');
    check('ledger + E486', (r) => s.drawLedgerScreen(r, m));
  });

  it('wave card, for every lesson and beyond, with and without the pointer', () => {
    const { s, st } = screens();
    const starred: Record<string, MissionRecord> = {};
    for (const m of MISSIONS) starred[m.id] = { stars: 1, bestKeys: 9 };
    for (let w = 1; w <= LESSON_COUNT + 2; w++) {
      st.wave = w;
      st.sim.breather = 3000;
      check(`wave card ${w} (unstarred)`, (r) => s.drawWaveCard(r, st));
      check(`wave card ${w} (starred)`, (r) => s.drawWaveCard(r, st, starred));
    }
    // The pointer is on the card exactly when the lesson's mission has no stars.
    const shows = (records?: Record<string, MissionRecord>): boolean => {
      const ruler = new Ruler();
      s.drawWaveCard(ruler as unknown as Renderer, st, records);
      return ruler.boxes.some((b) => b.what === JSON.stringify(Screens.WAVE_POINTER));
    };
    st.wave = 11;
    expect(missionForLesson(11)?.id).toBe('ess-find');
    expect(shows()).toBe(true);
    expect(shows({ 'ess-find': { stars: 1, bestKeys: 9 } })).toBe(false);
    expect(shows({ 'ess-find': { stars: 0, bestKeys: 0 } })).toBe(true);
    st.wave = LESSON_COUNT + 1;
    expect(shows()).toBe(false);
  });

  it('mission strip, every mission in every beat', () => {
    const { s, st } = screens();
    st.phase = 'playing';
    for (let i = 0; i < MISSIONS.length; i++) {
      st.sim.mission = i;
      st.sim.missionBeat = 'try';
      st.sim.missionHold = 0;
      st.sim.missionKeys = 0;
      check(`mission ${i + 1} TRY`, (r) => s.drawMissionStrip(r, st));
      st.sim.missionKeys = 999_999;
      check(`mission ${i + 1} TRY (many keys)`, (r) => s.drawMissionStrip(r, st));
      st.sim.missionHold = 500;
      check(`mission ${i + 1} TRY (good)`, (r) => s.drawMissionStrip(r, st));
      st.sim.missionHold = 0;
      st.sim.missionBeat = 'done';
      for (const keys of [1, 999_999]) {
        st.sim.missionKeys = keys;
        check(`mission ${i + 1} DONE keys=${keys}`, (r) => s.drawMissionStrip(r, st));
      }
    }
  });

  it('pause, every gore level and both sound states', () => {
    const { s } = screens();
    for (const gore of ['off', 'low', 'full'] as const) {
      for (const lineNumbers of ['off', 'absolute', 'relative'] as const) {
        for (const muted of [true, false]) {
          for (const canSuspend of [false, true]) {
            check(`pause ${gore}/${lineNumbers} muted=${muted} suspend=${canSuspend}`,
              (r) => s.drawPause(r, muted, { gore, lineNumbers, equipped: {} }, canSuspend));
          }
        }
      }
    }
  });

  it('death, with a full ledger and the longest strings it can hold', () => {
    const { s, st } = screens();
    st.wave = 23;
    st.score = 9_999_999;
    st.sim.longestCombo = 999;
    st.sim.kills = 99_999;
    st.sim.keystrokes = 400_000;
    st.sim.overkills = 12;
    s.unknownKeys = 40;
    const led = (s as unknown as { ledger: Ledger }).ledger;
    led.data.runs = Array.from({ length: 12 }, (_, i) => ({
      at: i, wave: 3, score: 1, kills: 10, keystrokes: 40, kpk: 44.44,
    }));
    check('death', (r) => s.drawDeath(r, st));
    // with the coach naming the widest family
    led.data.missed.iw = 99_999;
    check('death + coach', (r) => s.drawDeath(r, st));
    s.error = 'E37: No write since last change (add ! to override)';
    check('death + E37', (r) => s.drawDeath(r, st));
    s.error = '';
    s.cmdline = ':q!';
    check('death + cmdline', (r) => s.drawDeath(r, st));
  });

  it('save screen, with the longest values and every status line', () => {
    const save = defaultSave(Date.UTC(2026, 11, 31, 23, 59));
    save.lifetime.highScore = 9_999_999_999;
    save.lifetime.kills = 9_999_999_999;
    save.salvage = 9_999_999_999;
    save.version = 999_999;
    save.lifetime.runs = Array.from({ length: 40 }, (_, i) => ({
      at: i, wave: 33, score: 9_999_999, kills: 99_999, keystrokes: 400_000, kpk: 999.99,
    }));
    save.unlocks = Array.from({ length: 999 }, (_, i) => `cosmetic-${i}`);
    const scr = new SaveScreen();

    // Every line the screen can put in its status row, from the real sources.
    const lines = [
      '',
      'copied',
      'paste, then Enter',
      `saved ${exportFilename(new Date(Date.UTC(2026, 11, 31, 23, 59)))}`,
      `merged - high score ${save.lifetime.highScore}`,
      `replaced - high score ${save.lifetime.highScore}`,
      E482_CLIPBOARD,
      `${E484_OPEN} - no download element`,
      `${E484_OPEN} - download blocked`,
      `${E484_OPEN} - no file picker`,
      `${E485_READ} - not JSON`,
      `${E485_READ} - not a save object`,
      `${E485_READ} - no version field`,
      `${E485_READ} - no checksum`,
      `${E485_READ} - checksum mismatch`,
      `${E485_READ} - clipboard blocked`,
    ];
    for (const line of lines) {
      scr.reset();
      if (line) scr.status = line;
      check(`save actions [${line}]`, (r) => scr.draw(r, save));
    }

    // The confirmation card: own backup, a newer format, and both highlights.
    const own = importSave(exportSave(save), save);
    const newer = defaultSave(1);
    newer.version = 9;
    newer.lifetime.highScore = 9_999_999_999;
    newer.lifetime.kills = 9_999_999_999;
    newer.unlocks = save.unlocks.slice();
    const future = importSave(exportSave(newer), save);
    for (const [name, result] of [['own backup', own], ['newer', future]] as const) {
      for (const mode of ['merge', 'replace'] as const) {
        scr.reset();
        scr.offer(result);
        scr.mode = mode;
        check(`save confirm ${name}/${mode}`, (r) => scr.draw(r, save));
        scr.status = 'paste, then Enter';
        check(`save confirm ${name}/${mode} + status`, (r) => scr.draw(r, save));
        scr.status = '';
        scr.error = `${E485_READ} - checksum mismatch`;
        check(`save confirm ${name}/${mode} + error`, (r) => scr.draw(r, save));
      }
    }
  });
});

describe('the medal callout band', () => {
  // The callouts are drawn by the Renderer, not through a Screens card, so
  // there is no panel to measure them against. `calloutLayout` is the real
  // placement arithmetic and this asserts the band it is allowed to use.
  const widest = MULTI_KILL_NAMES.reduce((a, b) => (b.length > a.length ? b : a));

  /** Every frame of a stack's life, sampled finely enough to catch the rise. */
  function frames(stack: Callout[], at: number): CalloutBox[][] {
    const out: CalloutBox[][] = [];
    for (let t = at; t < at + CALLOUT_MS; t += 25) out.push(calloutLayout(stack, t));
    return out;
  }

  function assertInBand(boxes: CalloutBox[], where: string): void {
    expect(boxes.length, `${where}: more than ${CALLOUT_MAX} visible`)
      .toBeLessThanOrEqual(CALLOUT_MAX);
    for (const b of boxes) {
      for (const ch of b.text) {
        expect(ch.charCodeAt(0), `${where}: ${JSON.stringify(ch)}`).toBeGreaterThanOrEqual(32);
        expect(ch.charCodeAt(0), `${where}: ${JSON.stringify(ch)}`).toBeLessThan(127);
      }
      const end = b.col + b.text.length * b.scale;
      expect(b.col, `${where}: ${b.text} left of its window`)
        .toBeGreaterThanOrEqual(CALLOUT_BAND.col0 - 1e-9);
      expect(end, `${where}: ${b.text} runs into the combo counter (ends ${end.toFixed(1)})`)
        .toBeLessThanOrEqual(HUD_BOUNDS.comboCol + 1e-9);
      expect(b.row, `${where}: ${b.text} above the zombies-remaining strip`)
        .toBeGreaterThanOrEqual(HUD_BOUNDS.stripBottom - 1e-9);
      expect(b.row, `${where}: ${b.text} above the sky band`)
        .toBeGreaterThanOrEqual(HUD_BOUNDS.skyTop - 1e-9);
      expect(b.row + b.scale, `${where}: ${b.text} drops out of the sky band`)
        .toBeLessThanOrEqual(0 + 1e-9);
      expect(b.alpha, `${where}: ${b.text} alpha`).toBeGreaterThan(0);
      expect(b.alpha, `${where}: ${b.text} alpha`).toBeLessThanOrEqual(1);
    }
    // and no two of them share vertical space
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i - 1].row + boxes[i - 1].scale,
        `${where}: ${boxes[i - 1].text} overlaps ${boxes[i].text}`)
        .toBeLessThanOrEqual(boxes[i].row + 1e-9);
    }
  }

  it('the window clears the status block and the combo counter', () => {
    expect(CALLOUT_BAND.col0).toBeGreaterThanOrEqual(HUD_BOUNDS.hudReach);
    expect(CALLOUT_BAND.col1).toBeLessThanOrEqual(HUD_BOUNDS.comboCol);
  });

  it('one callout at the top of the ladder, every frame of its life', () => {
    const stack: Callout[] = [{ name: widest, at: 0 }];
    for (const boxes of frames(stack, 0)) assertInBand(boxes, `single ${widest}`);
  });

  it('a full stack at max tier, all arriving at once', () => {
    const stack: Callout[] = [
      { name: widest, at: 0 }, { name: widest, at: 0 }, { name: widest, at: 0 },
    ];
    for (const boxes of frames(stack, 0)) {
      expect(boxes).toHaveLength(3);
      assertInBand(boxes, `stack of ${widest}`);
    }
  });

  it('a full stack arriving 100ms apart, mid-rise', () => {
    const stack: Callout[] = [
      { name: widest, at: 200 }, { name: 'CALLED SHOT', at: 100 }, { name: 'PERFECT', at: 0 },
    ];
    for (let t = 200; t <= 200 + CALLOUT_MS; t += 17) {
      assertInBand(calloutLayout(stack, t), `mixed stack at t=${t}`);
    }
  });

  it('every name in the table fits the window at its own scale', () => {
    for (const name of allMedalNames()) {
      const stack: Callout[] = [{ name, at: 0 }];
      for (const boxes of frames(stack, 0)) assertInBand(boxes, name);
    }
  });

  it('a fourth medal is not drawn while three are up', () => {
    const stack: Callout[] = [
      { name: 'PERFECT', at: 30 }, { name: 'SNIPE', at: 20 },
      { name: 'BREACH', at: 10 }, { name: 'DOUBLE KILL', at: 0 },
    ];
    const boxes = calloutLayout(stack, 200);
    expect(boxes.map((b) => b.text)).toEqual(['PERFECT', 'SNIPE', 'BREACH']);
  });

  it('an expired callout is dropped', () => {
    const stack: Callout[] = [{ name: 'PERFECT', at: 0 }];
    expect(calloutLayout(stack, CALLOUT_MS)).toHaveLength(0);
    expect(calloutLayout(stack, CALLOUT_MS - 1)).toHaveLength(1);
  });
});
