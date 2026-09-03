import { beforeEach, describe, expect, it } from 'vitest';
import { cycleGore, cycleLineNumbers, goreBlurb, goreLabel, lineNumbersBlurb, lineNumbersLabel, loadSettings, saveSettings } from '../src/ui/settings';
import { SaveStore, load } from '../src/save/save';
import { deathLine } from '../src/ui/deaths';
import { createState } from '../src/core/state';
import type { GameState } from '../src/core/state';
import { Game } from '../src/harness/api';
import { keyToken } from '../src/ui/keys';
import { MAIN_ROWS, Menu, OPTION_ROWS } from '../src/ui/menu';
import { ABOUT_LINES, ABOUT_PAGES, ABOUT_ROWS, ABOUT_WIDTH, wrapPage } from '../src/ui/about';
import { MissionDemo } from '../src/ui/missiondemo';
import { DEMO_COLS, DEMO_KEY_MS, DEMO_LOOP_MS, MISSIONS, SECTIONS } from '../src/sim/missions';
import type { MenuAction } from '../src/ui/menu';
import type { RunSummary } from '../src/ui/ledger';
import { Ledger } from '../src/ui/ledger';
import { Bus } from '../src/core/bus';
import { defaultSave } from '../src/save/schema';
import { FIRST_BLOOD, FIRST_BLOOD_SALVAGE, PERFECT } from '../src/sim/medals';

// A localStorage that behaves, so the settings round-trip is actually tested.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

describe('settings', () => {
  let store: SaveStore;
  beforeEach(() => {
    (globalThis as any).localStorage = new MemStore();
    store = new SaveStore(load());
  });

  it('defaults to full gore and relative line numbers', () => {
    expect(loadSettings(store).gore).toBe('full');
    expect(loadSettings(store).lineNumbers).toBe('relative');
    expect(loadSettings(store).equipped).toEqual({});
  });
  it('cycles numbers relative -> absolute -> off', () => {
    expect(cycleLineNumbers('relative')).toBe('absolute');
    expect(cycleLineNumbers('absolute')).toBe('off');
    expect(cycleLineNumbers('off')).toBe('relative');
  });
  it('round-trips through the save store and out to storage', () => {
    saveSettings(store, { gore: 'off', lineNumbers: 'absolute', equipped: { hat: 'cap' } });
    store.flush();
    const fresh = new SaveStore(load());
    expect(loadSettings(fresh).gore).toBe('off');
    expect(loadSettings(fresh).lineNumbers).toBe('absolute');
    expect(loadSettings(fresh).equipped).toEqual({ hat: 'cap' });
  });
  it('cycles full -> low -> off -> full', () => {
    expect(cycleGore('full')).toBe('low');
    expect(cycleGore('low')).toBe('off');
    expect(cycleGore('off')).toBe('full');
  });
  it('ignores garbage in storage', () => {
    (globalThis as any).localStorage.setItem('motd.save', '{"version":1,"settings":{"gore":"buckets"}}');
    expect(loadSettings(new SaveStore(load())).gore).toBe('full');
  });
  it('survives storage that throws', () => {
    (globalThis as any).localStorage = {
      getItem() { throw new Error('private window'); },
      setItem() { throw new Error('private window'); },
    };
    const s = new SaveStore(load());
    expect(() => saveSettings(s, { gore: 'low', lineNumbers: 'off', equipped: {} })).not.toThrow();
    expect(loadSettings(s).gore).toBe('low');
    s.flush();
    expect(loadSettings(new SaveStore(load())).gore).toBe('full');
  });
  it('number labels are short enough to fit the options card', () => {
    for (const n of ['off', 'absolute', 'relative'] as const) {
      expect(lineNumbersLabel(n).length).toBeLessThanOrEqual(8);
      expect(lineNumbersBlurb(n).length).toBeLessThanOrEqual(23);
    }
  });
  it('labels are short enough to fit the options card', () => {
    for (const g of ['off', 'low', 'full'] as const) {
      expect(goreLabel(g).length).toBeGreaterThanOrEqual(3);
      expect(goreLabel(g).length).toBeLessThanOrEqual(4);
      expect(goreBlurb(g).length).toBeLessThanOrEqual(30);
    }
  });
});

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return { topUsed: [], neverUsed: [], kpk: 3, prevKpk: null, trend: [], wastedKeystrokes: 0, ...over };
}

/**
 * A run with kills in it. The zero-kill line (DECISIONS #89) is checked first
 * and would otherwise answer every case below, because a fresh `createState`
 * has `sim.kills` at 0 and these runs are all meant to have been played.
 */
function played(wave: number): GameState {
  const st = createState(1);
  st.wave = wave;
  st.sim.kills = 40;
  return st;
}

describe('death lines react to the run', () => {
  it('calls out a run with no kills in it', () => {
    const st = createState(1); st.wave = 1;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 })).toContain('killed nothing');
  });
  it('calls out arrow-key reaching', () => {
    const st = played(5);
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 9 })).toContain('arrow keys');
  });
  it('calls out hoarded charges', () => {
    const st = played(6); st.charges.dd = 2;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 })).toContain('Hoarder');
  });
  it('calls out overkills', () => {
    const st = played(9); st.charges.dd = 0; st.sim.overkills = 7;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 })).toContain('overkills');
  });
  it('calls out never pressing f', () => {
    const st = played(9); st.charges.dd = 0;
    const line = deathLine({ state: st, summary: summary({ neverUsed: [['f', 4]] }), unknownKeys: 0 });
    expect(line).toContain('never once pressed f');
  });
  it('always returns something', () => {
    const st = played(12); st.charges.dd = 0; st.sim.longestCombo = 10;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 }).length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------- the menu

function feed(m: Menu, keys: string[]): MenuAction {
  let last: MenuAction = null;
  for (const k of keys) last = m.feed(k);
  return last;
}

/** The row the cursor is on, by label, so a reordering breaks loudly. */
function at(m: Menu): string { return m.row?.label ?? '<none>'; }

describe('menu rows', () => {
  it('presents the eight rows in the order the spec fixes', () => {
    expect(MAIN_ROWS.map((r) => r.id)).toEqual(
      ['survival', 'missions', 'drills', 'armory', 'ledger', 'options', 'save', 'about']);
  });
  it('starts on survival, on the main screen', () => {
    const m = new Menu();
    expect(m.screen).toBe('main');
    expect(at(m)).toBe('survival');
    expect(m.atRoot).toBe(true);
  });
  it('marks only armory soon', () => {
    expect(MAIN_ROWS.filter((r) => r.soon).map((r) => r.id)).toEqual(['armory']);
  });
  it('every rendered string is printable ASCII', () => {
    for (const r of [...MAIN_ROWS, ...OPTION_ROWS, ...ABOUT_ROWS]) {
      for (const s of [r.label, r.hint]) {
        expect(s, s).toMatch(/^[\x20-\x7e]*$/);
      }
    }
    for (const p of ABOUT_PAGES) {
      for (const para of p.body) expect(para, p.id).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});

describe('a run on hold', () => {
  it('turns the survival row into resume and back, keeping eight rows', () => {
    const m = new Menu();
    m.suspended = { night: 7, score: 1240 };
    expect(m.rows).toHaveLength(8);
    expect(m.rows.map((r) => r.id)).toEqual(
      ['resume', 'missions', 'drills', 'armory', 'ledger', 'options', 'save', 'about']);
    expect(m.row?.hint).toBe('night 7  score 1240');
    expect(m.row?.hint.length).toBeLessThanOrEqual(22);
    expect(m.select()).toEqual({ t: 'resume' });
    expect(m.feed('i')).toEqual({ t: 'start', mode: 'survival' });
    expect(m.lines()[1]).toBe('> resume  - night 7  score 1240');
    m.suspended = null;
    expect(m.rows.map((r) => r.id)[0]).toBe('survival');
    expect(m.select()).toEqual({ t: 'start', mode: 'survival' });
  });
  it('MAIN_ROWS itself is untouched', () => {
    const m = new Menu();
    m.suspended = { night: 2, score: 0 };
    expect(MAIN_ROWS[0].id).toBe('survival');
  });
});

describe('about pages', () => {
  it('has one row per page, in page order', () => {
    expect(ABOUT_ROWS.map((r) => r.id)).toEqual(ABOUT_PAGES.map((p) => p.id));
  });
  it('every page wraps onto the card with nothing truncated', () => {
    for (const p of ABOUT_PAGES) {
      const lines = wrapPage(p.body, ABOUT_WIDTH);
      expect(lines.length, `${p.id}: too many lines`).toBeLessThanOrEqual(ABOUT_LINES);
      for (const l of lines) expect(l.length, `${p.id}: "${l}"`).toBeLessThanOrEqual(ABOUT_WIDTH);
      // Wrapping loses no words: joining the lines back gives the paragraphs.
      expect(lines.filter((l) => l !== '').join(' ')).toBe(p.body.join(' '));
    }
  });
  it('the tab strip fits the card in one row', () => {
    // Each tab is its label plus a three-cell gap, starting at column 8 and
    // ending inside the panel's usable 55.5.
    const width = ABOUT_ROWS.reduce((n, r) => n + r.label.length + 3, -3);
    expect(8 + width).toBeLessThanOrEqual(55);
  });
});

describe('menu motions', () => {
  it('j and k move one row', () => {
    const m = new Menu();
    m.feed('j'); expect(at(m)).toBe('missions');
    m.feed('j'); expect(at(m)).toBe('drills');
    m.feed('k'); expect(at(m)).toBe('missions');
  });
  it('takes a count before j', () => {
    const m = new Menu();
    feed(m, ['3', 'j']);
    expect(at(m)).toBe('armory');
  });
  it('takes a count before k', () => {
    const m = new Menu();
    feed(m, ['G', '2', 'k']);
    expect(at(m)).toBe('options');
  });
  it('a multi-digit count works', () => {
    const m = new Menu();
    feed(m, ['1', '0', 'j']);
    expect(at(m)).toBe('about');          // clamped, not wrapped
  });
  it('a bare 0 is not a count and not a motion', () => {
    const m = new Menu();
    expect(m.feed('0')).toBeNull();
    expect(m.pending).toBe('');
    expect(at(m)).toBe('survival');
  });
  it('clamps at the last row without wrapping', () => {
    const m = new Menu();
    feed(m, ['G', 'j', 'j']);
    expect(at(m)).toBe('about');
  });
  it('clamps at the first row without wrapping', () => {
    const m = new Menu();
    feed(m, ['k', 'k']);
    expect(at(m)).toBe('survival');
  });
  it('G, gg and M land on last, first and middle', () => {
    const m = new Menu();
    m.feed('G'); expect(at(m)).toBe('about');
    feed(m, ['g', 'g']); expect(at(m)).toBe('survival');
    m.feed('M'); expect(at(m)).toBe('armory');
  });
  it('H and L are first and last', () => {
    const m = new Menu();
    m.feed('L'); expect(at(m)).toBe('about');
    m.feed('H'); expect(at(m)).toBe('survival');
  });
  it('{n}G is an absolute jump', () => {
    const m = new Menu();
    feed(m, ['5', 'G']); expect(at(m)).toBe('record');
    feed(m, ['9', '9', 'G']); expect(at(m)).toBe('about');
  });
  it('a lone g abandons cleanly - gj is a j, gG is a G', () => {
    const m = new Menu();
    feed(m, ['g', 'j']);
    expect(at(m)).toBe('missions');       // as in Vim, gj is down one row
    feed(m, ['g', 'G']);
    expect(at(m)).toBe('about');
    feed(m, ['g', 'g']);                  // and the pending g did not linger
    expect(at(m)).toBe('survival');
  });
  it('a count survives being typed and shows as pending', () => {
    const m = new Menu();
    feed(m, ['1', '2']);
    expect(m.pending).toBe('12');
    m.feed('k');
    expect(m.pending).toBe('');
  });
  it('ignores keys Vim would not accept here', () => {
    const m = new Menu();
    for (const k of ['d', 'w', 'x', 'q', '$', '<BS>']) expect(m.feed(k)).toBeNull();
    expect(at(m)).toBe('survival');
  });
});

describe('menu search', () => {
  it('/rec<CR> jumps to the service record', () => {
    const m = new Menu();
    feed(m, ['/', 'r', 'e', 'c', '<CR>']);
    expect(at(m)).toBe('record');
    expect(m.message).toBe('');
  });
  it('is case-insensitive', () => {
    const m = new Menu();
    feed(m, ['/', 'A', 'R', 'M', '<CR>']);
    expect(at(m)).toBe('armory');
  });
  it('searches forward from the cursor and wraps', () => {
    const m = new Menu();
    feed(m, ['G']);                        // on about
    feed(m, ['/', 's', '<CR>']);           // next label containing s, wrapping
    expect(at(m)).toBe('survival');
  });
  it('reports E486 and does not move on no match', () => {
    const m = new Menu();
    feed(m, ['j']);
    feed(m, ['/', 'x', 'y', 'z', '<CR>']);
    expect(at(m)).toBe('missions');
    expect(m.message).toBe('E486: Pattern not found: xyz');
  });
  it('Esc cancels a half-typed search', () => {
    const m = new Menu();
    feed(m, ['/', 'l', 'e']);
    expect(m.searching).toBe(true);
    expect(m.query).toBe('le');
    m.feed('<Esc>');
    expect(m.searching).toBe(false);
    expect(m.query).toBe('');
    expect(at(m)).toBe('survival');
  });
  it('BS rubs out a character of the query', () => {
    const m = new Menu();
    feed(m, ['/', 'r', 'e', 'x', '<BS>', 'c', '<CR>']);
    expect(at(m)).toBe('record');
  });
  it('an empty search does nothing', () => {
    const m = new Menu();
    feed(m, ['/', '<CR>']);
    expect(at(m)).toBe('survival');
    expect(m.message).toBe('');
  });
  it('n repeats forward and N backward', () => {
    const m = new Menu();
    feed(m, ['/', 's', '<CR>']);           // survival -> missions (contains s)
    expect(at(m)).toBe('missions');
    m.feed('n'); expect(at(m)).toBe('drills');
    m.feed('n'); expect(at(m)).toBe('options');
    m.feed('N'); expect(at(m)).toBe('drills');
  });
  it('n before any search does nothing', () => {
    const m = new Menu();
    expect(m.feed('n')).toBeNull();
    expect(at(m)).toBe('survival');
  });
  it('a motion clears a stale E486', () => {
    const m = new Menu();
    feed(m, ['/', 'z', 'z', '<CR>']);
    expect(m.message).not.toBe('');
    m.feed('j');
    expect(m.message).toBe('');
  });
});

describe('menu select and back', () => {
  it('survival starts a survival run', () => {
    const m = new Menu();
    expect(m.feed('<CR>')).toEqual({ t: 'start', mode: 'survival' });
  });
  it('l selects too', () => {
    const m = new Menu();
    expect(m.feed('l')).toEqual({ t: 'start', mode: 'survival' });
  });
  it('missions opens the mission list', () => {
    const m = new Menu();
    feed(m, ['j']);
    expect(m.feed('<CR>')).toEqual({ t: 'screen', screen: 'missions' });
    expect(m.screen).toBe('missions');
    expect(m.rows).toHaveLength(MISSIONS.length);
    expect(at(m)).toBe('Take aim');
  });
  it('a mission row starts that mission by index', () => {
    const m = new Menu();
    feed(m, ['j', '<CR>']);
    expect(m.feed('<CR>')).toEqual({ t: 'mission', index: 0 });
    feed(m, ['G']);
    expect(m.feed('<CR>')).toEqual({ t: 'mission', index: MISSIONS.length - 1 });
    feed(m, ['3', 'G']);
    expect(m.feed('l')).toEqual({ t: 'mission', index: 2 });
  });
  it('} and { skip between sections; nothing locks', () => {
    const m = new Menu();
    feed(m, ['j', '<CR>']);
    expect(m.row?.section).toBe('Boot camp');
    m.feed('}');
    expect(m.row?.section).toBe(SECTIONS[1]);
    expect(at(m)).toBe('Basic Movement');
    feed(m, ['2', '}']);
    expect(m.row?.section).toBe(SECTIONS[3]);
    m.feed('j');
    m.feed('{');                                      // back to this section's first row
    expect(m.cursor).toBe(MISSIONS.findIndex((x) => x.section === SECTIONS[3]));
    m.feed('{');                                      // and now the previous one
    expect(m.cursor).toBe(MISSIONS.findIndex((x) => x.section === SECTIONS[2]));
    feed(m, ['9', '9', '}']);
    expect(m.cursor).toBe(MISSIONS.length - 1);
    feed(m, ['9', '9', '{']);
    expect(m.cursor).toBe(0);
    // Selecting a far lesson starts it: dim is ink, not a lock.
    feed(m, ['2', '0', 'G']);
    expect(m.feed('<CR>')).toEqual({ t: 'mission', index: 19 });
  });
  it('} on a flat screen goes to the last row and { to the first', () => {
    const m = new Menu();
    m.feed('}');
    expect(at(m)).toBe('about');
    m.feed('{');
    expect(at(m)).toBe('survival');
  });
  it('the list opens where pickMission says, the first time only', () => {
    const m = new Menu();
    m.pickMission = () => 5;
    feed(m, ['j', '<CR>']);
    expect(m.cursor).toBe(5);
    feed(m, ['j', 'h']);                              // move, back out
    feed(m, ['<CR>']);                                // reopen: the cursor is kept
    expect(m.cursor).toBe(6);
    m.reset();
    feed(m, ['j', '<CR>']);
    expect(m.cursor).toBe(5);
  });
  it('open() lands on a screen with the cursor set', () => {
    const m = new Menu();
    expect(m.open('missions', 19)).toEqual({ t: 'screen', screen: 'missions' });
    expect(m.screen).toBe('missions');
    expect(m.cursor).toBe(19);
    expect(m.lines()).toContain('-- Boot camp --');
    expect(m.lines().some((l) => l.startsWith('> Till Character'))).toBe(true);
  });
  it('the mission list backs out to the menu with the cursor kept', () => {
    const m = new Menu();
    feed(m, ['j', '<CR>', 'j', 'j']);
    expect(at(m)).toBe('Stop walking');
    m.feed('h');
    expect(m.screen).toBe('main');
    expect(at(m)).toBe('missions');
    m.feed('<CR>');
    expect(at(m)).toBe('Stop walking');   // and the list remembers where it was
  });
  it('search works on mission titles', () => {
    const m = new Menu();
    feed(m, ['j', '<CR>']);
    feed(m, ['/', 'l', 'a', 'n', 'e', '<CR>']);
    expect(at(m)).toBe('Change lanes');
  });
  it('i starts survival from any row on the main menu', () => {
    const m = new Menu();
    feed(m, ['3', 'j']);
    expect(at(m)).toBe('armory');
    expect(m.feed('i')).toEqual({ t: 'start', mode: 'survival' });
  });
  it('i does nothing on a sub-screen', () => {
    const m = new Menu();
    feed(m, ['6', 'G', 'l']);
    expect(m.screen).toBe('options');
    expect(m.feed('i')).toBeNull();
  });
  it('a soon row posts a note and changes no screen', () => {
    const m = new Menu();
    feed(m, ['3', 'j']);
    const a = m.feed('<CR>');
    expect(a?.t).toBe('note');
    expect(m.message).toContain('armory');
    expect(m.screen).toBe('main');
  });
  it('opens options with l and comes back with Esc, cursor intact', () => {
    const m = new Menu();
    feed(m, ['6', 'G']);
    expect(at(m)).toBe('options');
    expect(m.feed('l')).toEqual({ t: 'screen', screen: 'options' });
    expect(m.screen).toBe('options');
    expect(m.feed('<Esc>')).toEqual({ t: 'screen', screen: 'main' });
    expect(m.screen).toBe('main');
    expect(at(m)).toBe('options');
  });
  it('h backs out of a sub-screen too', () => {
    const m = new Menu();
    feed(m, ['6', 'G', 'l']);
    expect(m.screen).toBe('options');
    m.feed('h');
    expect(m.screen).toBe('main');
  });
  it('Esc on the main menu does nothing', () => {
    const m = new Menu();
    expect(m.feed('<Esc>')).toBeNull();
    expect(m.screen).toBe('main');
  });
  it('ledger and save open their own screens', () => {
    const m = new Menu();
    feed(m, ['5', 'G']);                     // ledger
    expect(at(m)).toBe('record');
    expect(m.feed('<CR>')).toEqual({ t: 'screen', screen: 'ledger' });
    m.feed('h');
    feed(m, ['7', 'G']);                     // save
    expect(m.feed('<CR>')).toEqual({ t: 'screen', screen: 'save' });
  });
  it('about opens on its first page and j/k turn the pages', () => {
    const m = new Menu();
    feed(m, ['G']);
    expect(at(m)).toBe('about');
    expect(m.feed('<CR>')).toEqual({ t: 'screen', screen: 'about' });
    expect(m.screen).toBe('about');
    expect(m.rows).toBe(ABOUT_ROWS);
    expect(at(m)).toBe(ABOUT_PAGES[0].label);
    feed(m, ['j', 'j']);
    expect(at(m)).toBe(ABOUT_PAGES[2].label);
    feed(m, ['G', 'j']);                     // clamps on the last page
    expect(at(m)).toBe(ABOUT_PAGES[ABOUT_PAGES.length - 1].label);
    // A page is read, not activated: Enter and l stay put.
    expect(m.feed('<CR>')).toBeNull();
    expect(m.feed('l')).toBeNull();
    expect(m.screen).toBe('about');
    expect(m.feed('h')).toEqual({ t: 'screen', screen: 'main' });
    expect(at(m)).toBe('about');             // the main cursor is kept
  });
  it('text() on the about screen prints the page being read', () => {
    const m = new Menu();
    feed(m, ['G', 'l', 'j']);
    const lines = m.lines();
    expect(lines[0]).toBe('MENU about');
    expect(lines.find((l) => l.startsWith('>'))).toContain(ABOUT_PAGES[1].label);
    for (const l of wrapPage(ABOUT_PAGES[1].body).filter(Boolean)) expect(lines).toContain(`  ${l}`);
  });
  it('the ledger screen has no rows and ignores motions', () => {
    const m = new Menu();
    feed(m, ['5', 'G', 'l']);
    expect(m.screen).toBe('ledger');
    expect(m.feed('j')).toBeNull();
    expect(m.feed('<CR>')).toBeNull();
    expect(m.screen).toBe('ledger');
  });
  it('the save screen forwards its own keys and keeps h for going back', () => {
    const m = new Menu();
    feed(m, ['7', 'G', 'l']);
    expect(m.screen).toBe('save');
    expect(m.feed('e')).toEqual({ t: 'save-key', key: 'e' });
    expect(m.feed('<Esc>')).toEqual({ t: 'save-key', key: '<Esc>' });
    expect(m.feed('h')).toEqual({ t: 'screen', screen: 'main' });
  });
  it('the options screen toggles with the pause card keys', () => {
    const m = new Menu();
    feed(m, ['6', 'G', 'l']);
    expect(m.feed('s')).toEqual({ t: 'option', what: 'sound' });
    expect(m.feed('g')).toEqual({ t: 'option', what: 'gore' });
    expect(m.feed('n')).toEqual({ t: 'option', what: 'numbers' });
  });
  it('the options screen also toggles the row under the cursor', () => {
    const m = new Menu();
    feed(m, ['6', 'G', 'l']);
    expect(m.rows.map((r) => r.id)).toEqual(['sound', 'gore', 'numbers']);
    m.feed('j');
    expect(m.feed('<CR>')).toEqual({ t: 'option', what: 'gore' });
    m.feed('G');
    expect(m.feed('l')).toEqual({ t: 'option', what: 'numbers' });
  });
  it('reset closes every sub-screen', () => {
    const m = new Menu();
    feed(m, ['6', 'G', 'l']);
    m.reset();
    expect(m.screen).toBe('main');
    expect(at(m)).toBe('survival');
  });
});

describe('menu mouse', () => {
  it('a click moves the cursor and activates the row', () => {
    const m = new Menu();
    expect(m.click(4)).toEqual({ t: 'screen', screen: 'ledger' });
    expect(m.screen).toBe('ledger');
  });
  it('a click outside every row does nothing', () => {
    const m = new Menu();
    expect(m.click(-1)).toBeNull();
    expect(m.click(99)).toBeNull();
    expect(at(m)).toBe('survival');
    expect(m.screen).toBe('main');
  });
});

describe('menu text surface', () => {
  it('marks the cursor row with > and names the screen', () => {
    const m = new Menu();
    feed(m, ['j', 'j']);
    const lines = m.lines();
    expect(lines[0]).toBe('MENU main');
    expect(lines.find((l) => l.startsWith('>'))).toContain('drills');
    expect(lines.filter((l) => l.startsWith('>'))).toHaveLength(1);
  });
  it('echoes a live search and then a message', () => {
    const m = new Menu();
    feed(m, ['/', 'l', 'e']);
    expect(m.lines().at(-1)).toBe('/le');
    feed(m, ['<CR>']);
    feed(m, ['/', 'z', '<CR>']);
    expect(m.lines().at(-1)).toContain('E486');
  });
});

// ---------------------------------------------------------- the mission demo

describe('mission demo plays the real motion', () => {
  it('every demo clears its mission goal in one pass', () => {
    for (let i = 0; i < MISSIONS.length; i++) {
      const d = new MissionDemo();
      d.sync(i);
      d.runToEnd();
      expect(d.cleared(), `${MISSIONS[i].title}: demo "${MISSIONS[i].demo.keys}" did not `
        + `${MISSIONS[i].goal === 'clear' ? 'clear the scene' : 'reach a zombie'}`).toBe(true);
    }
  });
  it('every keycap on the strip is pressed by the demo', () => {
    for (let i = 0; i < MISSIONS.length; i++) {
      const d = new MissionDemo();
      d.sync(i);
      d.runToEnd();
      for (const cap of MISSIONS[i].keys) {
        expect(d.lit(cap), `${MISSIONS[i].title}: keycap ${cap} never lights`).toBe(true);
      }
    }
  });
  it('every demo scene fits the pane', () => {
    for (const step of MISSIONS) {
      for (const [, row, col, text] of step.demo.spawn) {
        expect(col + text.length, `${step.title}: "${text}" runs past the pane`)
          .toBeLessThanOrEqual(DEMO_COLS);
        expect(row).toBeGreaterThanOrEqual(0);
      }
      expect(step.demo.cursor[1]).toBeLessThan(DEMO_COLS);
    }
  });
  it('a demo scene never needs more than four lanes', () => {
    for (const step of MISSIONS) {
      const lanes = new Set(step.demo.spawn.map(([, row]) => row));
      lanes.add(step.demo.cursor[0]);
      expect(lanes.size, `${step.title}: ${lanes.size} lanes`).toBeLessThanOrEqual(4);
    }
  });
  it('feeds one key per DEMO_KEY_MS and no faster', () => {
    const d = new MissionDemo();
    d.sync(1);                                  // 'dw'
    expect(d.position).toBe(0);
    d.advance(DEMO_KEY_MS - 1);
    expect(d.position).toBe(0);
    d.advance(1);
    expect(d.position).toBe(1);
    expect(d.state.buffer.zombies).toHaveLength(1);   // 'd' alone kills nothing
    d.advance(DEMO_KEY_MS);
    expect(d.position).toBe(2);
    expect(d.state.buffer.zombies).toHaveLength(0);   // the engine did it
  });
  it('lights each keycap as it is pressed, not before', () => {
    const d = new MissionDemo();
    d.sync(1);
    expect(d.lit('d')).toBe(false);
    expect(d.lit('w')).toBe(false);
    d.advance(DEMO_KEY_MS);
    expect(d.lit('d')).toBe(true);
    expect(d.lit('w')).toBe(false);
    d.advance(DEMO_KEY_MS);
    expect(d.lit('w')).toBe(true);
  });
  it('rests on the finished scene, then loops back to the top', () => {
    const d = new MissionDemo();
    d.sync(1);
    d.advance(DEMO_KEY_MS * 2);
    expect(d.resting).toBe(true);
    expect(d.passes).toBe(0);
    d.advance(DEMO_LOOP_MS - 1);
    expect(d.passes).toBe(0);
    d.advance(2);
    expect(d.passes).toBe(1);
    expect(d.position).toBe(0);
    expect(d.resting).toBe(false);
    expect(d.state.buffer.zombies).toHaveLength(1);   // the scene came back
    expect(d.lit('d')).toBe(false);                   // and the caps went dark
  });
  it('sync is a no-op on the mission it already holds', () => {
    const d = new MissionDemo();
    d.sync(2);
    d.advance(DEMO_KEY_MS * 3);
    const pos = d.position;
    d.sync(2);
    expect(d.position).toBe(pos);
    d.sync(3);
    expect(d.position).toBe(0);
    expect(d.step).toBe(3);
  });
  it('is deterministic: two demos stepped alike are identical', () => {
    for (let i = 0; i < MISSIONS.length; i++) {
      const a = new MissionDemo();
      const b = new MissionDemo();
      a.sync(i); b.sync(i);
      for (let k = 0; k < 6; k++) { a.advance(DEMO_KEY_MS); b.advance(DEMO_KEY_MS); }
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  });
  it('holds its own field: the live game is never touched', () => {
    const g = new Game(1, { autoStart: false });
    const before = JSON.stringify(g.json());
    const d = new MissionDemo();
    for (let i = 0; i < MISSIONS.length; i++) { d.sync(i); d.runToEnd(); }
    expect(JSON.stringify(g.json())).toBe(before);
  });
  it('survives a huge frame without running away', () => {
    const d = new MissionDemo();
    d.sync(3);                                  // the 10-key demo
    d.advance(60_000);
    expect(d.position).toBeLessThanOrEqual(d.total);
    expect(() => d.advance(60_000)).not.toThrow();
  });
});

describe('mission demo timing constants hold together', () => {
  it('the frame ceiling clears both demo intervals', () => {
    // If it did not, one frame could never feed a key or complete a loop.
    expect(DEMO_KEY_MS).toBeLessThan(2000);
    expect(DEMO_LOOP_MS).toBeLessThan(2000);
  });
});

describe('the Motion Ledger reads the sim judgement', () => {
  function led(): { ledger: Ledger; bus: Bus; store: SaveStore; st: ReturnType<typeof createState> } {
    (globalThis as any).localStorage = new MemStore();
    const st = createState(1);
    const bus = new Bus();
    const store = new SaveStore(defaultSave());
    const ledger = new Ledger(st, bus, store);
    ledger.beginRun();
    return { ledger, bus, store, st };
  }

  const cmd = (raw: string) => ({ count: 1, raw });

  it('turns kill_judged into wasted keystrokes and a missed table', () => {
    const { ledger, bus, store } = led();
    // The player got there by whittling with `x`; `wdw` would have done it.
    bus.emit({ t: 'command', cmd: cmd('7x') as any, ms: 0 });
    bus.emit({ t: 'command', cmd: cmd('xx') as any, ms: 0 });
    bus.emit({ t: 'kill_judged', zombieId: 1, spent: 9, optimal: 'wdw' });
    expect(ledger.summary().wastedKeystrokes).toBe(6);
    // `w` and `d` would have been optimal and were never pressed this run.
    // (`wdw` exercises `w` twice, and the table counts every occurrence.)
    expect(store.get().lifetime.missed.w).toBeGreaterThanOrEqual(1);
    expect(store.get().lifetime.missed.d).toBeGreaterThanOrEqual(1);
    expect(ledger.summary().neverUsed.map(([t]) => t)).toContain('w');
  });

  it('credits nothing when the player matched the oracle', () => {
    const { ledger, bus } = led();
    bus.emit({ t: 'kill_judged', zombieId: 1, spent: 3, optimal: 'wdw' });
    bus.emit({ t: 'kill_judged', zombieId: 2, spent: 4, optimal: null });
    expect(ledger.summary().wastedKeystrokes).toBe(0);
  });

  it('never calls the oracle itself', () => {
    // A kill with no kill_judged behind it teaches the ledger nothing: the
    // sim is the only thing allowed to run optimalKill now.
    const { ledger, bus } = led();
    bus.emit({ t: 'kill', zombieId: 1, kind: 'walker', via: 'dw', overkill: false });
    expect(ledger.summary().wastedKeystrokes).toBe(0);
    expect(ledger.summary().neverUsed).toEqual([]);
  });
});

describe('FIRST BLOOD and lifetime salvage', () => {
  function rig(): { bus: Bus; store: SaveStore; seen: string[] } {
    (globalThis as any).localStorage = new MemStore();
    const st = createState(1);
    const bus = new Bus();
    const store = new SaveStore(defaultSave());
    const ledger = new Ledger(st, bus, store);
    ledger.beginRun();
    const seen: string[] = [];
    bus.on('medal', (e) => seen.push(e.name));
    return { bus, store, seen };
  }
  const cmd = (raw: string) => ({ count: 1, raw });

  it('fires once on the first lifetime use of a token, and never again', () => {
    const { bus, seen } = rig();
    bus.emit({ t: 'command', cmd: cmd('fd') as any, ms: 0 });
    expect(seen).toEqual([FIRST_BLOOD]);
    bus.emit({ t: 'command', cmd: cmd('fd') as any, ms: 0 });
    expect(seen).toEqual([FIRST_BLOOD]);
  });

  it('at most one per command, however many new tokens it presses', () => {
    const { bus, seen } = rig();
    bus.emit({ t: 'command', cmd: cmd('d3w') as any, ms: 0 });
    expect(seen.filter((n) => n === FIRST_BLOOD)).toHaveLength(1);
  });

  it('pays salvage and never supplies', () => {
    const { bus, store } = rig();
    bus.emit({ t: 'command', cmd: cmd('fd') as any, ms: 0 });
    expect(store.get().salvage).toBe(FIRST_BLOOD_SALVAGE);
    expect(store.get().lifetime.medals[FIRST_BLOOD]).toBe(1);
  });

  it('a multi-kill medal credits its rung number, a style medal credits 1', () => {
    const { bus, store } = rig();
    bus.emit({ t: 'medal', name: 'KILLTACULAR', bonus: 80 });
    expect(store.get().salvage).toBe(5);
    bus.emit({ t: 'medal', name: PERFECT, bonus: 15 });
    expect(store.get().salvage).toBe(6);
    expect(store.get().lifetime.medals.KILLTACULAR).toBe(1);
  });

  it('a death does not reset salvage', () => {
    const { bus, store } = rig();
    bus.emit({ t: 'medal', name: 'DOUBLE KILL', bonus: 10 });
    const before = store.get().salvage;
    bus.emit({ t: 'death', wave: 3, score: 100 });
    bus.emit({ t: 'wave_start', n: 1, unlocks: [] });
    expect(store.get().salvage).toBe(before);
  });
});

describe('keyToken: KeyboardEvent.key -> one Game.keys() token', () => {
  it('printable characters pass through untouched', () => {
    for (const k of ['j', 'G', '/', ' ', '<', '>', '3']) expect(keyToken(k)).toBe(k);
  });

  it('the three Vim specials take their Vim names', () => {
    expect(keyToken('Escape')).toBe('<Esc>');
    expect(keyToken('Enter')).toBe('<CR>');
    expect(keyToken('Backspace')).toBe('<BS>');
  });

  it('every other named key is wrapped as a single token', () => {
    // `ArrowDown` fed raw is nine keystrokes ending in `n`, which is NEXT
    // NIGHT in the store (DECISIONS #90).
    expect(keyToken('ArrowDown')).toBe('<ArrowDown>');
    expect(keyToken('Tab')).toBe('<Tab>');
    expect(keyToken('Home')).toBe('<Home>');
    expect(keyToken('F5')).toBe('<F5>');
  });

  it('a bare modifier is not a keystroke', () => {
    // Shift fires before every capital letter; it must not break the combo.
    for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified']) {
      expect(keyToken(k)).toBeNull();
    }
  });
});
