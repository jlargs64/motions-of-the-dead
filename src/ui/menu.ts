// Phase G - the main menu's model. Rows, a cursor, a screen stack, a count
// buffer and a search buffer, and one `feed(key)` that turns a keystroke into
// an action for the caller to carry out.
//
// This module is pure: no renderer, no DOM, no save store, no sim. Drawing
// lives in `Screens.drawMenu` and friends; deciding what a row *does* lives in
// `main.ts`. That split is what lets `tests/ui.test.ts` pin every motion in
// Node and what lets the headless harness drive the same menu the browser does
// (DECISIONS #57).
import type { GameMode } from '../core/state';
import { MISSIONS } from '../sim/missions';
import { FAMILIES } from '../sim/drills';
import { ABOUT_PAGES, ABOUT_ROWS, wrapPage } from './about';

export type MenuScreenId = 'main' | 'missions' | 'drills' | 'options' | 'ledger' | 'save' | 'about';

export interface MenuRow {
  /** Stable id. `main-menu` owns the order; later changes replace the action. */
  id: string;
  /** What the row is called. Searched by `/`, case-insensitively. */
  label: string;
  /** The dim line to the right of the label. */
  hint: string;
  /** Drawn dim with a `soon` tag; selecting it only posts a note. */
  soon?: true;
  /** The heading this row sits under, where a screen has them. `{` and `}`
   *  jump between the first rows of consecutive sections. */
  section?: string;
}

export type MenuAction =
  | null
  /** Enter a run. */
  | { t: 'start'; mode: GameMode }
  /** Start one mission, full-screen on the real field. */
  | { t: 'mission'; index: number }
  /** The screen stack changed; redraw. */
  | { t: 'screen'; screen: MenuScreenId }
  /** A `soon` row, or anything else with only a line to say. */
  | { t: 'note'; text: string }
  /** An options toggle, handled by the same code the pause card uses. */
  | { t: 'option'; what: 'sound' | 'gore' | 'numbers' }
  /** A key the save screen owns; forward it to `SaveScreen.feedKey`. */
  | { t: 'save-key'; key: string }
  /** Pick the suspended survival run back up (DECISIONS #96). */
  | { t: 'resume' }
  /** Start one drill family (drills-and-coach). */
  | { t: 'drill'; family: string };

/** What the menu says about a run on hold: enough for one row's hint. */
export interface SuspendedNote { night: number; score: number }

/**
 * The eight rows, in the order the spec fixes them. Ids are the stable key the
 * screen stack and the harness use; `label` is what the player reads, and the
 * two diverge on `ledger`/`record` (DECISIONS #76). `survival`, `ledger`,
 * `options`, `save` and `about` are real today; `missions` launches the warm-up
 * until the `missions` change replaces it; `drills` and `armory` are
 * placeholders (DECISIONS #61). `about` is last so `G` is the way to it, which
 * is what the first-night header tells a new player to press (DECISIONS #91).
 */
// Hints are held to 20 cells so none of them truncates on the card; the draw
// still passes them through `fit()` as a guard.
export const MAIN_ROWS: readonly MenuRow[] = [
  { id: 'survival', label: 'survival', hint: 'the endless night' },
  { id: 'missions', label: 'missions', hint: 'one motion at a time' },
  { id: 'drills', label: 'drills', hint: 'one motion, repeated' },
  { id: 'armory', label: 'armory', hint: 'what you wear to it', soon: true },
  { id: 'ledger', label: 'record', hint: 'your service record' },
  { id: 'options', label: 'options', hint: 'sound, gore, numbers' },
  { id: 'save', label: 'save', hint: 'carry it elsewhere' },
  { id: 'about', label: 'about', hint: 'the idea, and the keys' },
];

/**
 * One row per mission. Derived from `MISSIONS` so the list and the missions
 * themselves can never disagree about the order or the titles; the hint is
 * the mission's keycaps, which is what `text()` wants on one line, and the
 * section is what `{` / `}` and the headings read (DECISIONS #91).
 */
export const MISSION_ROWS: readonly MenuRow[] = MISSIONS.map((m) => ({
  id: m.id,
  label: m.title,
  hint: m.keys.join(' '),
  section: m.section,
}));

/**
 * One row per drill family, in curriculum order (drills-and-coach D2). The
 * hint is the family's keycaps, which is what `text()` wants on one line.
 */
export const DRILL_ROWS: readonly MenuRow[] = FAMILIES.map((f) => ({
  id: f.id,
  label: f.name,
  hint: f.keys.join(' '),
}));

/** Per-motion rows the ledger screen's table shows at once; `j`/`k` scroll it. */
export const LEDGER_TABLE_LINES = 6;

/** The options rows are the pause card's toggles, in the pause card's order. */
export const OPTION_ROWS: readonly MenuRow[] = [
  { id: 'sound', label: 'sound', hint: 'the click, and the wet parts' },
  { id: 'gore', label: 'gore', hint: 'how much of them lands on the wall' },
  { id: 'numbers', label: 'numbers', hint: 'the gutter beside the lanes' },
];

const NOTHING_YET = 'not in this build yet - it gets its own screen soon';

/**
 * The main rows with a run on hold: `survival` becomes `resume`, in the same
 * slot, so the card keeps its eight rows and its footer (DECISIONS #96). A
 * fresh run is still `i`, which the header has been advertising all along.
 */
export function resumeRows(note: SuspendedNote): readonly MenuRow[] {
  const rows = MAIN_ROWS.slice();
  rows[0] = { id: 'resume', label: 'resume', hint: `night ${note.night}  score ${note.score}` };
  return rows;
}

export function rowsFor(screen: MenuScreenId): readonly MenuRow[] {
  if (screen === 'main') return MAIN_ROWS;
  if (screen === 'missions') return MISSION_ROWS;
  if (screen === 'drills') return DRILL_ROWS;
  if (screen === 'options') return OPTION_ROWS;
  if (screen === 'about') return ABOUT_ROWS;   // one row per page; j/k turn them
  return [];        // `ledger` and `save` draw themselves; they have no rows
}

/**
 * Keys a screen claims before the motion matcher sees them. `g` on the options
 * screen cycles gore, which is why `gg` does not work there (DECISIONS #58).
 */
const DIRECT: Partial<Record<MenuScreenId, Record<string, MenuAction>>> = {
  options: {
    s: { t: 'option', what: 'sound' },
    g: { t: 'option', what: 'gore' },
    n: { t: 'option', what: 'numbers' },
  },
};

export class Menu {
  /** Innermost screen last. `main` is always the floor. */
  private stack: MenuScreenId[] = ['main'];
  /** Per-screen cursor, so backing out of `options` lands on `options`. */
  private cursors: Record<string, number> = {};
  /** A count typed before a motion, as digits. */
  private count = '';
  /** True after a bare `g`, waiting for the second one. */
  private pendingG = false;
  /** True between `/` and `<CR>`. */
  searching = false;
  /** What has been typed since `/`. */
  query = '';
  /** The last completed search, for `n` and `N`. */
  private lastQuery = '';
  /** One line under the rows: an E486, or a `soon` note. */
  message = '';
  /**
   * Where the mission list opens the first time after a reset. `main.ts`
   * points this at the save (the first unstarred mission); headless it is the
   * top. A hook rather than a parameter keeps this module free of the store.
   */
  pickMission: () => number = () => 0;
  /**
   * The coach's n-th family (1-based), for the ledger screen's `1` `2` `3`.
   * `main.ts` points this at the save; headless there is no ledger, so null.
   */
  coachPick: (n: number) => string | null = () => null;
  /** How many rows the ledger screen's table has, so the scroll can clamp. */
  ledgerRows: () => number = () => 0;
  /** First table row the ledger screen shows. */
  ledgerTop = 0;
  /** The run on hold, if any. `main.ts` keeps this in step with the save. */
  private note: SuspendedNote | null = null;
  private mainRows: readonly MenuRow[] = MAIN_ROWS;

  get suspended(): SuspendedNote | null { return this.note; }
  set suspended(v: SuspendedNote | null) {
    this.note = v;
    this.mainRows = v ? resumeRows(v) : MAIN_ROWS;
  }

  get screen(): MenuScreenId { return this.stack[this.stack.length - 1]; }
  get rows(): readonly MenuRow[] {
    return this.screen === 'main' ? this.mainRows : rowsFor(this.screen);
  }
  get cursor(): number { return this.clamp(this.cursors[this.screen] ?? 0); }
  get row(): MenuRow | undefined { return this.rows[this.cursor]; }
  /** True on the main menu, where `Esc` does nothing and `i` starts a run. */
  get atRoot(): boolean { return this.stack.length === 1; }
  /** The count typed so far, for the drawing to echo. */
  get pending(): string { return (this.pendingG ? 'g' : '') + this.count; }

  /** Back to a closed main menu. Called when a run starts. */
  reset(): void {
    this.stack = ['main'];
    this.cursors = {};
    this.count = '';
    this.pendingG = false;
    this.searching = false;
    this.query = '';
    this.message = '';
    this.ledgerTop = 0;
  }

  private clamp(i: number): number {
    const n = this.rows.length;
    if (n === 0) return 0;
    return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
  }

  private setCursor(i: number): void { this.cursors[this.screen] = this.clamp(i); }

  private push(screen: MenuScreenId): MenuAction {
    this.stack.push(screen);
    this.message = '';
    return { t: 'screen', screen };
  }

  /**
   * Open a sub-screen from the outside, cursor included: how a mission's
   * `<Esc>` lands back on the list with that mission selected.
   */
  open(screen: MenuScreenId, cursor?: number): MenuAction {
    const a = this.push(screen);
    if (cursor !== undefined) this.setCursor(cursor);
    return a;
  }

  /** `h` / `Esc` out of a sub-screen. Nothing to do on the main menu. */
  back(): MenuAction {
    if (this.atRoot) return null;
    this.stack.pop();
    this.message = '';
    return { t: 'screen', screen: this.screen };
  }

  // ---------------------------------------------------------------- selection

  /** Activate the row under the cursor. */
  select(): MenuAction {
    const row = this.row;
    if (!row) return null;
    if (row.soon) {
      this.message = `${row.label}: ${NOTHING_YET}`;
      return { t: 'note', text: this.message };
    }
    this.message = '';
    // A mission row starts that mission; the screen owns the index, so the
    // row ids stay display-only. A drill row starts that family.
    if (this.screen === 'missions') return { t: 'mission', index: this.cursor };
    if (this.screen === 'drills') return { t: 'drill', family: row.id };
    switch (row.id) {
      case 'sound': return { t: 'option', what: 'sound' };
      case 'gore': return { t: 'option', what: 'gore' };
      case 'numbers': return { t: 'option', what: 'numbers' };
      case 'survival': return { t: 'start', mode: 'survival' };
      case 'resume': return { t: 'resume' };
      case 'missions': {
        const fresh = this.cursors.missions === undefined;
        const a = this.push('missions');
        if (fresh) this.setCursor(this.pickMission());
        return a;
      }
      case 'drills': return this.push('drills');
      case 'ledger': this.ledgerTop = 0; return this.push('ledger');
      case 'options': return this.push('options');
      case 'save': return this.push('save');
      case 'about': return this.push('about');
      // An about page is read, not activated: Enter on one does nothing.
      default: return null;
    }
  }

  /** A mouse click that landed on row `i`. Moves the cursor, then selects. */
  click(i: number): MenuAction {
    if (i < 0 || i >= this.rows.length) return null;
    this.setCursor(i);
    return this.select();
  }

  // ---------------------------------------------------------------- search

  /** Case-insensitive substring, forward from `from`, wrapping. -1 = no match. */
  private find(q: string, from: number, back = false): number {
    const rows = this.rows;
    const n = rows.length;
    if (n === 0 || q === '') return -1;
    const needle = q.toLowerCase();
    // s runs to n so the row the cursor is already on is tried last: `/save`
    // twice in a row sits still rather than reporting E486.
    for (let s = 1; s <= n; s++) {
      const i = ((from + (back ? -s : s)) % n + n) % n;
      if (rows[i].label.toLowerCase().includes(needle)) return i;
    }
    return -1;
  }

  private jump(q: string, back: boolean): MenuAction {
    const hit = this.find(q, this.cursor, back);
    if (hit < 0) { this.message = `E486: Pattern not found: ${q}`; return null; }
    this.setCursor(hit);
    this.message = '';
    return null;
  }

  private feedSearch(key: string): MenuAction {
    if (key === '<Esc>') { this.searching = false; this.query = ''; return null; }
    if (key === '<BS>') { this.query = this.query.slice(0, -1); return null; }
    if (key === '<CR>') {
      const q = this.query;
      this.searching = false;
      this.query = '';
      if (q === '') return null;
      this.lastQuery = q;
      return this.jump(q, false);
    }
    if (key.length === 1) this.query += key;
    return null;
  }

  // ---------------------------------------------------------------- input

  /** One keystroke in, one thing for the caller to do out. */
  feed(key: string): MenuAction {
    if (this.searching) return this.feedSearch(key);

    // The save screen owns its own keys; only `h` is taken off it, so there is
    // always a Vim way back out (its own `Esc` returns 'back' to main.ts).
    if (this.screen === 'save') {
      if (key === 'h') return this.back();
      return { t: 'save-key', key };
    }

    const direct = DIRECT[this.screen]?.[key];
    if (direct) { this.count = ''; this.pendingG = false; this.message = ''; return direct; }

    // The ledger screen has a table, not rows: `j`/`k` scroll it, clamped,
    // and `1` `2` `3` start the coach's drill of that rank (drills-and-coach).
    if (this.screen === 'ledger') {
      if (key === '1' || key === '2' || key === '3') {
        const fam = this.coachPick(Number(key));
        this.message = fam ? '' : 'the coach has nothing there yet';
        return fam ? { t: 'drill', family: fam } : null;
      }
      if (key === 'j' || key === 'k') {
        const max = Math.max(0, this.ledgerRows() - LEDGER_TABLE_LINES);
        this.ledgerTop = Math.max(0, Math.min(max, this.ledgerTop + (key === 'j' ? 1 : -1)));
        this.count = '';
        return null;
      }
    }

    // A second `g` completes `gg`; anything else abandons the first one.
    if (this.pendingG) {
      this.pendingG = false;
      if (key === 'g') { this.count = ''; this.message = ''; this.setCursor(0); return null; }
    }

    if (key >= '1' && key <= '9') { this.count += key; return null; }
    if (key === '0' && this.count !== '') { this.count += key; return null; }

    const n = this.count === '' ? 1 : Math.min(999, Number(this.count));
    const hadCount = this.count !== '';
    this.count = '';
    const last = Math.max(0, this.rows.length - 1);

    switch (key) {
      case 'j': this.message = ''; this.setCursor(this.cursor + n); return null;
      case 'k': this.message = ''; this.setCursor(this.cursor - n); return null;
      case 'g': this.pendingG = true; return null;
      // `{n}G` is Vim's absolute line jump; bare `G` is the last row.
      case 'G': this.message = ''; this.setCursor(hadCount ? n - 1 : last); return null;
      case 'H': this.message = ''; this.setCursor(0); return null;
      case 'M': this.message = ''; this.setCursor(Math.floor(last / 2)); return null;
      case 'L': this.message = ''; this.setCursor(last); return null;
      // Sections are paragraphs: `}` to the first row of the next one, `{` to
      // the first row of this one (or the previous, when already on it).
      case '}': this.message = ''; this.setCursor(this.sectionStart(this.cursor, n, true)); return null;
      case '{': this.message = ''; this.setCursor(this.sectionStart(this.cursor, n, false)); return null;
      case '/': this.searching = true; this.query = ''; this.message = ''; return null;
      case 'n': return this.lastQuery ? this.jump(this.lastQuery, false) : null;
      case 'N': return this.lastQuery ? this.jump(this.lastQuery, true) : null;
      case '<CR>':
      case 'l': return this.select();
      case 'h': return this.back();
      case '<Esc>': return this.back();
      // `i` is the game's signature: it starts survival from anywhere on the
      // main menu, whatever the cursor is on.
      case 'i': return this.atRoot ? { t: 'start', mode: 'survival' } : null;
      default: return null;
    }
  }

  /** Row indexes where a new section begins. Empty on a flat screen. */
  private sectionStarts(): number[] {
    const rows = this.rows;
    const out: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].section !== undefined && (i === 0 || rows[i].section !== rows[i - 1].section)) out.push(i);
    }
    return out;
  }

  /** `count` section starts forward or back from `from`; clamps at the ends. */
  private sectionStart(from: number, count: number, fwd: boolean): number {
    const starts = this.sectionStarts();
    const last = Math.max(0, this.rows.length - 1);
    if (starts.length === 0) return fwd ? last : 0;
    let i = from;
    for (let c = 0; c < count; c++) {
      const next = fwd ? starts.find((s) => s > i) : [...starts].reverse().find((s) => s < i);
      if (next === undefined) return fwd ? last : 0;
      i = next;
    }
    return i;
  }

  /** The harness's view: one line per row, `>` on the cursor, a heading
   *  before each section. */
  lines(): string[] {
    const rows = this.rows;
    const out: string[] = [`MENU ${this.screen}`];
    for (let i = 0; i < rows.length; i++) {
      const sec = rows[i].section;
      if (sec !== undefined && (i === 0 || sec !== rows[i - 1].section)) out.push(`-- ${sec} --`);
      out.push(`${i === this.cursor ? '>' : ' '} ${rows[i].label}` +
        `${rows[i].soon ? '  (soon)' : ''}  - ${rows[i].hint}`);
    }
    if (rows.length === 0) out.push('  (this screen has no rows; h or Esc goes back)');
    // The about card's copy, so an agent can read the page it is on.
    if (this.screen === 'about') {
      const page = ABOUT_PAGES[this.cursor];
      if (page) { out.push(''); for (const l of wrapPage(page.body)) out.push(l === '' ? '' : `  ${l}`); }
    }
    if (this.searching) out.push(`/${this.query}`);
    else if (this.message) out.push(this.message);
    return out;
  }
}
