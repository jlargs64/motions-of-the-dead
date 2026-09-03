// Phase E - every non-playfield screen, drawn with the renderer's glyph API.
// No DOM. Same aesthetic as the field: a survivor's notebook, in the dark.
import { PAGE_TURN_MS, PALETTE } from '../render/renderer';
import type { Renderer } from '../render/renderer';
import type { GameState } from '../core/state';
import { LESSON_COUNT, waveDef } from '../sim/waves';
import { DEMO_COLS, MISSIONS, dimmed, missionForLesson, starsFor } from '../sim/missions';
import type { DrillRecord, MissionRecord } from '../save/schema';
import { missionPar } from '../sim/optimal';
import { FAMILIES, familyById, familyMissionTitle, familyOf } from '../sim/drills';
import { COACH_QUIET, coachLine, entryFamily } from '../sim/coach';
import {
  CARD_LINE, ITEMS, canBuy, capOf, manifestCard, ownedOf, ownedText,
} from '../sim/store';
import { spanCost } from '../sim/traps';
import { deathLine } from './deaths';
import type { Ledger } from './ledger';
import { LEDGER_TABLE_LINES } from './menu';
import type { Menu } from './menu';
import { ABOUT_PAGES, ABOUT_LINES, ABOUT_WIDTH, wrapPage } from './about';
import type { MissionDemo } from './missiondemo';
import { goreBlurb, goreLabel, lineNumbersBlurb, lineNumbersLabel } from './settings';
import type { Settings } from './settings';

export type DeathAction = 'restart' | 'menu' | null;
export type PauseAction = 'resume' | 'menu' | 'sound' | 'gore' | 'numbers' | 'suspend' | null;

const E37 = 'E37: No write since last change (add ! to override)';

/** The store card's caption for its NEXT NIGHT row. Held to `CARD_LINE`. */
export const NEXT_NIGHT_BLURB = 'start it. the store does not reopen for this night';

// Cards are drawn on `panel()`, which is weathered paper. The field palette is
// built for a near-black scene and vanishes on it, so cards get their own ink.
export const INK = PALETTE.ink;              // pencil
export const INK_DIM = '#6b6355';            // faded pencil
export const INK_RED = '#7a1512';            // dark red, still readable on paper
export const INK_HOT = '#9c1f14';            // the one shouty colour

/** Hard-truncate to a cell budget. Layout is asserted in tests/ui-layout.test.ts. */
export function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}.`;
}

/** Greedy word wrap to `n` lines of `width` cells; the last line is truncated. */
function wrap(s: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur === '') { cur = w; continue; }
    if (cur.length + 1 + w.length <= width) { cur += ` ${w}`; continue; }
    out.push(cur);
    cur = w;
    if (out.length === lines - 1) break;
  }
  if (out.length < lines) out.push(cur);
  return out.slice(0, lines).map((l) => fit(l, width));
}

/**
 * A row of keycaps where each one is lit or unlit. Used by the mission demo:
 * a cap goes hot the moment the demo presses it and stays hot until the loop
 * starts over, so the strip reads as a running record of the command.
 */
function litCaps(r: Renderer, keys: readonly string[], col: number, row: number,
                 lit: (k: string) => boolean, max = Infinity): void {
  // Six review-lesson caps at the roomy size overrun the pane, so a long row
  // drops to the tight size: a two-cell box round a one-letter label.
  const roomy = keys.reduce((n, k) => n + Math.max(3, k.length + 2) + 1, -1);
  const pad = roomy <= max ? 2 : 1;
  let c = col;
  for (const k of keys) {
    const w = Math.max(pad + 1, k.length + pad);
    r.keycap(k, c, row, w, lit(k) ? INK_HOT : INK_DIM);
    c += w + 1;
  }
}

/** Three glyphs for a star count: `***`, `**.`, `*..` or `...`. */
export function starGlyphs(stars: number): string {
  const n = Math.max(0, Math.min(3, Math.floor(stars)));
  return '*'.repeat(n) + '.'.repeat(3 - n);
}

/** Stars and best on record for a mission, or none. */
export type MissionRecords = Readonly<Record<string, MissionRecord>>;

/** Lay a row of keycaps out from `col` and return the column after the last. */
export function caps(r: Renderer, keys: readonly string[], col: number, row: number): number {
  let c = col;
  for (const k of keys) {
    const w = Math.max(3, k.length + 2);
    r.keycap(k, c, row, w);
    c += w + 1;
  }
  return c;
}

export class Screens {
  cmdline = '';
  error = '';
  /** Unknown keys this run, for the death line. */
  unknownKeys = 0;

  constructor(private ledger: Ledger) {}

  resetRun(): void {
    this.cmdline = '';
    this.error = '';
    this.unknownKeys = 0;
    this.storeNight = -1;
  }

  // ---------------------------------------------------------------- menu
  // The renderer gives the UI layer rows -6..19 (see src/render/NOTES.md);
  // the 16 field rows alone are too cramped for an eight-row menu.
  //
  // Every menu screen is drawn on the same panel so backing in and out of a
  // sub-screen does not make the card jump. Selectable rows sit on even cell
  // rows with a blank row between them, and `drawMenu`/`drawOptions` record
  // where they put each one in `rowCells` so a click can be mapped back to a
  // row index without duplicating the arithmetic (DECISIONS #59).

  /** panel cols 4..56 (usable 4.5..55.5), rows -5..19 (usable -4.5..17.5). */
  // The card grew one row at the top when `about` became the eighth row: the
  // rows keep their blank line between each other and before the footer, and
  // the header moved up instead of the rows moving down (DECISIONS #91).
  private static readonly P_COL = 4;
  private static readonly P_ROW = -5;
  private static readonly P_W = 52;
  private static readonly P_H = 24;

  private static readonly MARK = 8;     // the `>` cursor marker
  private static readonly CAP = 10;     // a keycap, where a screen has them
  private static readonly LABEL = 15;   // the row's name
  private static readonly VALUE = 27;   // the row's current value
  private static readonly HINT = 27;    // the dim line right of the label
  private static readonly SOON = 50;    // the `soon` tag
  private static readonly FOOT = 17;    // the status / hint line

  /** Cell row of each selectable row, in row order. Rewritten on every draw. */
  private rowCells: number[] = [];

  /**
   * The row index drawn on cell row `cellRow`, or -1. A click on a gap, the
   * header or the footer is not a row and must do nothing.
   */
  menuHit(cellRow: number): number {
    return this.rowCells.indexOf(cellRow);
  }

  private menuPanel(r: Renderer): void {
    r.panel(Screens.P_COL, Screens.P_ROW, Screens.P_W, Screens.P_H);
  }

  /** The `>` in front of the cursor row, in the menu's marker column. */
  private mark(r: Renderer, row: number, on: boolean): void {
    this.markAt(r, Screens.MARK, row, on);
  }

  /** The same `>`, where the card puts its marker somewhere else. */
  private markAt(r: Renderer, col: number, row: number, on: boolean): void {
    if (on) r.text('>', col, row, INK_HOT);
  }

  /**
   * Row 17 on every screen: a live `/search`, then a message, then the hint.
   * One line, one owner, so nothing can ever land on top of it.
   */
  private menuFoot(r: Renderer, menu: Menu, hint: string): void {
    const row = Screens.FOOT;
    if (menu.searching) { r.text(fit(`/${menu.query}`, 44), Screens.MARK, row, INK); return; }
    if (menu.message) { r.text(fit(menu.message, 44), Screens.MARK, row, INK_HOT); return; }
    const pending = menu.pending;
    r.centerText(fit(hint, 46), row, INK_DIM);
    if (pending) r.text(pending, 52, row, INK);
  }

  drawMenu(r: Renderer, menu: Menu, tMs: number): void {
    this.menuPanel(r);
    r.centerText('MOTIONS OF THE DEAD', -4, INK, 2.2);
    r.centerText('the horde is a text buffer', -2, INK_DIM);

    const hs = this.ledger.highScore;
    // 8..34 for the score, 37..55 for the pitch, with a gap between them. With
    // no score yet the slot points a new player at the about page instead.
    r.text(fit(hs > 0 ? `HIGH SCORE  ${hs}` : 'FIRST NIGHT?  G  about', 26),
      Screens.MARK, -1, INK);
    const blink = Math.floor(tMs / 500) % 2 === 0;
    r.text('i  INSERT YOURSELF', 37, -1, blink ? INK_HOT : INK_RED);
    r.rule(Screens.MARK, 0, 44);

    const rows = menu.rows;
    const cur = menu.cursor;
    this.rowCells = [];
    // Rows 1..15 on the odd cells, so row 16 stays blank and the footer on 17
    // never looks like a ninth row.
    for (let i = 0; i < rows.length; i++) {
      const row = 1 + i * 2;
      this.rowCells.push(row);
      const it = rows[i];
      const on = i === cur;
      this.mark(r, row, on);
      // A placeholder is dim even under the cursor: it is not a way forward.
      r.text(fit(it.label, 10), Screens.LABEL, row, it.soon ? INK_DIM : on ? INK_HOT : INK, 1.1);
      r.text(fit(it.hint, 22), Screens.HINT, row, INK_DIM);
      if (it.soon) r.text('soon', Screens.SOON, row, INK_RED);
    }

    this.menuFoot(r, menu, menu.suspended
      ? 'Enter  pick it up    i  new run    /  search'
      : 'j k  move    Enter  select    /  search');
  }

  // ---------------------------------------------------------------- missions
  // Two panes on one card, on a wider panel than the other menu screens: the
  // store's (cols 2..58), because a `>`, a three-glyph star column and the
  // longest title (22 cells) need 28 cells, and the 19-column demo pane with
  // its lane numbers needs 22 more (DECISIONS #93). Left: section headings
  // and one row per mission, sixteen lines at a time with `^` / `v` markers
  // when the list is clipped. Right: the selected mission's keycaps lighting
  // up as the real engine plays the real motion on a pane-sized field, its
  // hint, its par and its best (DECISIONS #62).

  private static readonly M_COL = 2;
  private static readonly M_ROW = -5;
  private static readonly M_W = 56;
  private static readonly M_H = 24;

  private static readonly M_MARK = 4;      // the `>` cursor marker
  private static readonly M_STARS = 6;     // `***` / `...`, and the headings
  private static readonly M_TITLE = 10;    // the title
  static readonly M_TITLE_MAX = 22;        // the longest title in the syllabus
  private static readonly M_DIV = 33;      // the vertical rule between panes
  private static readonly M_PANE = 35;     // the right pane's left edge
  private static readonly M_FIELD = 38;    // where the demo's lane text starts
  private static readonly M_PANE_MAX = 22; // 57.5 - M_PANE, rounded down
  /** Lines (headings and rows) the list shows at once. */
  static readonly M_LINES = 16;
  private static readonly M_UP = -2;       // the `^` marker
  private static readonly M_TOP = -1;      // the first list line
  private static readonly M_DOWN = 15;     // the `v` marker; 16 blank, 17 footer

  /** The first list line drawn. Kept across frames so the list scrolls
   *  minimally, as a Vim window does, rather than recentring on every move. */
  private missionTop = 0;

  /** The list as lines: a heading before each section, then its rows. */
  private static missionLines(): Array<{ head?: string; index?: number }> {
    const out: Array<{ head?: string; index?: number }> = [];
    for (let i = 0; i < MISSIONS.length; i++) {
      const m = MISSIONS[i];
      if (i === 0 || m.section !== MISSIONS[i - 1].section) out.push({ head: m.section });
      out.push({ index: i });
    }
    return out;
  }

  /** Where the window starts so line `sel` is visible, moving as little as
   *  possible; when the line above the selection is its heading, show that. */
  static scrollTo(top: number, sel: number, total: number, headAbove: boolean): number {
    const lines = Screens.M_LINES;
    let t = top;
    if (sel < t) t = sel;
    if (sel > t + lines - 1) t = sel - (lines - 1);
    if (headAbove && sel - 1 < t) t = sel - 1;
    return Math.max(0, Math.min(t, Math.max(0, total - lines)));
  }

  drawMissions(r: Renderer, menu: Menu, demo: MissionDemo, records: MissionRecords = {}): void {
    r.panel(Screens.M_COL, Screens.M_ROW, Screens.M_W, Screens.M_H);
    r.centerText('MISSIONS', -4, INK, 2.0);

    // A hairline between the panes. Decorative, so the layout test ignores it
    // - and it stops short of row 17, which the footer spans end to end.
    r.fillCells(Screens.M_DIV, -2, 0.07, 18, INK_DIM);

    // ---- left: the list -----------------------------------------------
    const cur = menu.cursor;
    const lines = Screens.missionLines();
    const sel = lines.findIndex((l) => l.index === cur);
    this.missionTop = Screens.scrollTo(this.missionTop, sel, lines.length,
      sel > 0 && lines[sel - 1].head !== undefined);
    const top = this.missionTop;
    const end = Math.min(lines.length, top + Screens.M_LINES);

    if (top > 0) r.text(fit(`^ ${top} more`, 12), Screens.M_MARK, Screens.M_UP, INK_DIM);
    if (end < lines.length) {
      r.text(fit(`v ${lines.length - end} more`, 12), Screens.M_MARK, Screens.M_DOWN, INK_DIM);
    }

    this.rowCells = new Array<number>(MISSIONS.length).fill(-99);
    for (let li = top; li < end; li++) {
      const row = Screens.M_TOP + (li - top);
      const line = lines[li];
      if (line.head !== undefined) {
        r.text(fit(line.head.toUpperCase(), 26), Screens.M_STARS, row, INK_DIM);
        continue;
      }
      const i = line.index!;
      const m = MISSIONS[i];
      const on = i === cur;
      this.rowCells[i] = row;
      this.markAt(r, Screens.M_MARK, row, on);
      const rec = records[m.id];
      const stars = rec?.stars ?? 0;
      r.text(starGlyphs(stars), Screens.M_STARS, row, stars > 0 ? INK_HOT : INK_DIM);
      // Dim is ink, not a lock: everything past the next unstarred lesson
      // reads as "not yet", and Enter still starts it.
      const ink = on ? INK_HOT : dimmed(m, records) ? INK_DIM : INK;
      r.text(fit(m.title, Screens.M_TITLE_MAX), Screens.M_TITLE, row, ink);
    }

    // ---- right: the demo ----------------------------------------------
    const m = MISSIONS[cur];
    if (m) {
      litCaps(r, m.keys, Screens.M_PANE, -2, (k) => demo.lit(k), Screens.M_PANE_MAX);
      this.drawDemoField(r, demo, 0);
      r.rule(Screens.M_PANE, 6, Screens.M_PANE_MAX);
      const hint = wrap(m.hint, Screens.M_PANE_MAX, 3);
      for (let i = 0; i < hint.length; i++) r.text(hint[i], Screens.M_PANE, 7 + i, INK);
      r.text(fit(`${demo.total} keystrokes`, Screens.M_PANE_MAX), Screens.M_PANE, 11, INK_DIM);
      r.text(fit(demo.resting ? 'that is the whole motion'
        : `watching  ${demo.position}/${demo.total}`, Screens.M_PANE_MAX),
        Screens.M_PANE, 12, demo.resting ? INK_RED : INK_DIM);
      const rec = records[m.id];
      const par = missionPar(m.id);
      r.text(fit(`par ${par}`, 8), Screens.M_PANE, 14, INK);
      r.text(fit(rec && rec.bestKeys > 0 ? `best ${rec.bestKeys}` : 'not yet played', 13),
        Screens.M_PANE + 9, 14, rec && rec.bestKeys > 0 ? INK : INK_DIM);
    }

    this.menuFoot(r, menu, 'j k  move    { }  section    Enter  start it    h  back');
  }

  /**
   * The demo's own field, drawn like `text()` does it: one line per occupied
   * lane with its 1-based lane number, and a caret under the crosshair. Only
   * the first DEMO_COLS columns exist in the pane, which is why every demo
   * scene is authored inside them. Six rows from `top`.
   */
  private drawDemoField(r: Renderer, demo: MissionDemo, top: number): void {
    const st = demo.state;
    const lanes = new Set<number>();
    for (const z of st.buffer.zombies) lanes.add(z.row);
    lanes.add(st.cursor.row);
    const shown = [...lanes].sort((a, b) => a - b).slice(0, 4);

    let row = top;
    for (const lane of shown) {
      if (row > top + 4) break;
      r.text(String(lane + 1).padStart(2, ' '), Screens.M_PANE, row, INK_DIM);
      const line = (st.buffer.rows[lane] ?? '').slice(0, DEMO_COLS).replace(/\s+$/, '');
      if (line !== '') r.text(line, Screens.M_FIELD, row, INK);
      row++;
      if (lane === st.cursor.row && row <= top + 5) {
        const col = Math.max(0, Math.min(st.cursor.col, DEMO_COLS - 1));
        r.text('^', Screens.M_FIELD + col, row, INK_HOT);
        row++;
      }
    }
  }

  // ---------------------------------------------------------------- drills
  // One row per family on the menu panel, the selected family's blurb, keys,
  // best and teaching mission below the list. `overdue` is the coach's tag
  // (drills-and-coach D7); every column is a constant so the layout test can
  // hold the card at its widest values.

  private static readonly D_NAME = 10;     // the family's name
  private static readonly D_KEYS = 24;     // its keycaps, as text
  private static readonly D_BEST = 38;     // `best 999`
  private static readonly D_TAG = 48;      // `overdue`
  private static readonly D_TOP = 0;       // the first family row
  private static readonly D_DETAIL = 12;   // blurb; then caps, best, mission

  /** Bests on record for each family, or none. */
  drawDrills(r: Renderer, menu: Menu, records: Readonly<Record<string, DrillRecord>> = {}): void {
    this.menuPanel(r);
    r.centerText('DRILLS', -4, INK, 2.0);
    r.centerText('sixty seconds. one motion. a score.', -2, INK_DIM);

    const overdue = this.ledger.coach().map((e) => e.family);
    const cur = menu.cursor;
    this.rowCells = [];
    for (let i = 0; i < FAMILIES.length; i++) {
      const f = FAMILIES[i];
      const row = Screens.D_TOP + i;
      const on = i === cur;
      this.rowCells.push(row);
      this.mark(r, row, on);
      r.text(fit(f.name, 12), Screens.D_NAME, row, on ? INK_HOT : INK);
      r.text(fit(f.keys.join(' '), 12), Screens.D_KEYS, row, INK_DIM);
      const rec = records[f.id];
      r.text(fit(rec ? `best ${rec.best}` : '-', 9), Screens.D_BEST, row, rec ? INK : INK_DIM);
      if (overdue.includes(f.id)) r.text('overdue', Screens.D_TAG, row, INK_HOT);
    }

    const f = FAMILIES[cur];
    if (f) {
      r.rule(Screens.MARK, Screens.D_DETAIL - 1, 44);
      r.text(fit(f.blurb, 46), Screens.MARK, Screens.D_DETAIL, INK);
      caps(r, f.keys, Screens.MARK, Screens.D_DETAIL + 1);
      const rec = records[f.id];
      r.text(fit(rec ? `best ${rec.best} kills, ${rec.perfect} perfect` : 'not yet run', 46),
        Screens.MARK, Screens.D_DETAIL + 2, rec ? INK : INK_DIM);
      r.text(fit(`taught in missions: ${familyMissionTitle(f)}`, 46), Screens.MARK, Screens.D_DETAIL + 3, INK_DIM);
    }

    this.menuFoot(r, menu, 'j k  move    Enter  start it    h  back');
  }

  /** Widest a drill strip line may be: column 6 to the panel's right margin. */
  static readonly DRILL_LINE = 49;

  /**
   * A strip along the top while a drill runs, like the mission strip: the
   * family and the clock, kills and PERFECTs, the keycaps, `r`, and the
   * designated target (drills-and-coach D5). A placement order is drawn by
   * `drawPlacement` with its teaching lines instead.
   */
  drawDrillStrip(r: Renderer, state: GameState): void {
    const sm = state.sim;
    const f = familyById(sm.drill);
    if (!f) return;
    // panel cols 4..56, usable 4.5..55.5; rows -6..-1, usable -5.5..-2.5
    r.panel(4, -6, 52, 5);
    r.text(fit(`DRILL  ${f.name}`, 20), 6, -5, INK);
    const secs = Math.floor(Math.max(0, sm.drillLeft) / 1000);
    r.text(fit(`${secs}s`, 4), 27, -5, secs < 10 ? INK_HOT : INK, 1.15);
    r.text(fit(`kills ${sm.kills}  perfect ${sm.drillPerfect}`, 23), 32, -5, INK_DIM);
    caps(r, f.keys, 6, -4);
    r.keycap('r', 40, -4, 3);
    r.text('new scene', 44, -4, INK_DIM);
    const z = state.buffer.zombies.find((x) => x.id === sm.drillTarget);
    r.text(fit(z ? `target  "${z.text}"  lane ${z.row + 1}  col ${z.col}` : f.blurb, Screens.DRILL_LINE), 6, -3, INK);
  }

  /** The end card's keys. Asserted against the card's line budget. */
  static readonly DRILL_END_KEYS = 'r  run it again          Esc  back to drills';

  /**
   * The clock ran out. Kills, PERFECTs and scenes, the best on record before
   * this run, NEW BEST when it was beaten, and the two keys that leave.
   */
  drawDrillEnd(r: Renderer, state: GameState, prev: DrillRecord | null = null, newBest = false): void {
    const sm = state.sim;
    const f = familyById(sm.drill);
    r.overlay(PALETTE.bg, 0.86);
    // panel cols 3..57, usable 3.5..56.5; rows -4..19, usable -3.5..17.5
    r.panel(3, -4, 54, 23);
    r.centerText('TIME', -3, INK_HOT, 1.8);
    r.centerText(fit(`${f?.name ?? sm.drill} drill`, 36), 0, INK, 1.4);
    r.centerText(fit(
      `KILLS ${sm.kills}   PERFECT ${sm.drillPerfect}   SCENES ${sm.drillScenes}`, 52), 3, INK);
    r.centerText(fit(prev
      ? `previous best  ${prev.best} kills, ${prev.perfect} perfect`
      : 'first run of this drill', 52), 5, INK_DIM);
    if (newBest) r.centerText('NEW BEST', 7, INK_HOT, 1.4);
    if (f) {
      caps(r, f.keys, 6, 10);
      r.text(fit(f.blurb, 48), 6, 12, INK_DIM);
    }
    r.centerText(fit(coachLine(this.ledger.coach()), 52), 14, INK_RED);
    r.centerText(Screens.DRILL_END_KEYS, 17, INK_DIM);
  }

  // ---------------------------------------------------------------- options

  drawOptions(r: Renderer, menu: Menu, muted: boolean, settings: Settings): void {
    this.menuPanel(r);
    r.centerText('OPTIONS', -3, INK, 2.0);
    r.centerText('the same three switches the pause card has', -1, INK_DIM);
    r.rule(Screens.MARK, 1, 44);

    const values: Array<[string, string, string]> = [
      ['s', muted ? 'OFF' : 'ON', 'the click, and the wet parts'],
      ['g', goreLabel(settings.gore), goreBlurb(settings.gore)],
      ['n', lineNumbersLabel(settings.lineNumbers), lineNumbersBlurb(settings.lineNumbers)],
    ];
    const rows = menu.rows;
    const cur = menu.cursor;
    this.rowCells = [];
    for (let i = 0; i < rows.length; i++) {
      const row = 4 + i * 4;
      this.rowCells.push(row);
      const [key, value, blurb] = values[i] ?? ['?', '-', ''];
      const on = i === cur;
      this.mark(r, row, on);
      r.keycap(key, Screens.CAP, row, 3);
      r.text(fit(rows[i].label, 10), Screens.LABEL, row, on ? INK_HOT : INK);
      r.text(fit(value, 10), Screens.VALUE, row, value === 'OFF' ? INK_RED : INK);
      r.text(fit(blurb, 38), Screens.LABEL, row + 1, INK_DIM);
    }

    this.menuFoot(r, menu, 'Enter  change      h  back');
  }

  // ---------------------------------------------------------------- about
  // Four tabs across the top, one page of copy underneath. `j`/`k` turn the
  // page through the menu's own cursor, so the model needs nothing new; the
  // tabs share one cell row, so nothing on this card is clickable.

  private static readonly A_TAB = -2;    // the tab strip
  private static readonly A_BODY = 1;    // first line of copy

  drawAbout(r: Renderer, menu: Menu): void {
    this.menuPanel(r);
    r.centerText('ABOUT', -4, INK, 2.0);
    this.rowCells = [];

    const rows = menu.rows;
    const cur = menu.cursor;
    let col = Screens.MARK;
    for (let i = 0; i < rows.length; i++) {
      const on = i === cur;
      r.text(rows[i].label, col, Screens.A_TAB, on ? INK_HOT : INK_DIM);
      // The active tab is the one with a line under it.
      if (on) r.rule(col, Screens.A_TAB + 1, rows[i].label.length);
      col += rows[i].label.length + 3;
    }

    const page = ABOUT_PAGES[cur];
    if (page) {
      const lines = wrapPage(page.body, ABOUT_WIDTH).slice(0, ABOUT_LINES);
      for (let i = 0; i < lines.length; i++) {
        r.text(fit(lines[i], ABOUT_WIDTH), Screens.MARK, Screens.A_BODY + i, INK);
      }
    }

    this.menuFoot(r, menu, 'j k  turn the page    h  back');
  }

  // -------------------------------------------------- the service record

  // The card is data from the save (drills-and-coach D8): the headline
  // numbers, the keystrokes-per-kill trend, a per-motion table that scrolls
  // with `j`/`k` through `menu.ledgerTop`, and the coach's three with a
  // keycap each. Column constants, so the layout test can hold the card at
  // the widest values the save can carry.

  private static readonly L_VAL = 20;      // first value column
  private static readonly L_LABEL2 = 36;   // second label column
  private static readonly L_VAL2 = 44;     // second value column
  private static readonly L_USED = 20;     // table columns
  private static readonly L_KILLS = 28;
  private static readonly L_MISSED = 36;
  private static readonly L_DRILL = 44;
  private static readonly L_TABLE = 5;     // first table row; LEDGER_TABLE_LINES of them
  private static readonly L_COACH = 12;    // the coach label; three entries below

  drawLedgerScreen(r: Renderer, menu: Menu): void {
    this.menuPanel(r);
    r.centerText('SERVICE RECORD', -4, INK, 2.0);
    r.centerText('the Vim you actually know', -2, INK_DIM);
    this.rowCells = [];        // nothing here is selectable, so nothing is clickable

    const led = this.ledger;
    const table = led.table();
    if (led.runCount === 0 && table.length === 0) {
      r.centerText('NO RUNS YET', 6, INK_HOT, 1.6);
      r.centerText('it fills in the first time you do not survive', 9, INK_DIM);
      r.centerText(fit(COACH_QUIET, 46), 12, INK_DIM);
      this.menuFoot(r, menu, 'h or Esc  back to the menu');
      return;
    }

    r.text('high score', Screens.MARK, -1, INK_DIM);
    r.text(fit(String(led.highScore), 15), Screens.L_VAL, -1, INK);
    r.text('runs', Screens.L_LABEL2, -1, INK_DIM);
    r.text(fit(String(led.runCount), 11), Screens.L_VAL2, -1, INK);
    r.text('kills', Screens.MARK, 0, INK_DIM);
    r.text(fit(String(led.lifetimeKills), 15), Screens.L_VAL, 0, INK);
    r.text('medals', Screens.L_LABEL2, 0, INK_DIM);
    r.text(fit(String(led.medalTotal), 11), Screens.L_VAL2, 0, INK);

    const trend = led.kpkTrend(8);
    r.text(fit(`keystrokes / kill, last ${trend.length} run${trend.length === 1 ? '' : 's'}, oldest first`, 46),
      Screens.MARK, 1, INK_DIM);
    r.text(fit(trend.length ? trend.map((v) => v.toFixed(1)).join(' ') : '-', 46), Screens.MARK, 2, INK);
    r.rule(Screens.MARK, 3, 44);

    r.text('motion', Screens.MARK, 4, INK_DIM);
    r.text('used', Screens.L_USED, 4, INK_DIM);
    r.text('kills', Screens.L_KILLS, 4, INK_DIM);
    r.text('missed', Screens.L_MISSED, 4, INK_DIM);
    r.text('drill', Screens.L_DRILL, 4, INK_DIM);
    const top = Math.max(0, Math.min(menu.ledgerTop, Math.max(0, table.length - LEDGER_TABLE_LINES)));
    for (let i = 0; i < LEDGER_TABLE_LINES; i++) {
      const e = table[top + i];
      if (!e) break;
      const row = Screens.L_TABLE + i;
      r.text(fit(e.tok, 4), Screens.MARK, row, e.missed > 0 ? INK_HOT : INK);
      r.text(fit(String(e.used), 7), Screens.L_USED, row, INK);
      r.text(fit(String(e.kills), 7), Screens.L_KILLS, row, INK);
      r.text(fit(String(e.missed), 7), Screens.L_MISSED, row, e.missed > 0 ? INK_HOT : INK_DIM);
      const fam = familyOf(e.tok);
      if (fam) r.text(fit(fam.name, 11), Screens.L_DRILL, row, INK_DIM);
    }
    if (table.length === 0) r.text('no motions recorded yet', Screens.MARK, Screens.L_TABLE, INK_DIM);
    // The window's edges: more above, more below.
    if (top > 0) r.text('^', 5, Screens.L_TABLE, INK_DIM);
    if (top + LEDGER_TABLE_LINES < table.length) r.text('v', 5, Screens.L_TABLE + LEDGER_TABLE_LINES - 1, INK_DIM);

    const entries = led.coach();
    r.text('coach', Screens.MARK, Screens.L_COACH, INK_DIM);
    r.text(fit(entries.length ? 'the motions you keep not pressing' : COACH_QUIET, 38),
      17, Screens.L_COACH, INK_DIM);
    for (let i = 0; i < entries.length && i < 3; i++) {
      const e = entries[i];
      const f = entryFamily(e);
      const row = Screens.L_COACH + 1 + i;
      r.keycap(String(i + 1), Screens.MARK, row, 3);
      r.text(fit(f.name, 12), 12, row, INK_HOT);
      r.text(fit(e.token, 4), 26, row, INK);
      const used = led.data.motions[e.token]?.used ?? 0;
      const missed = led.data.missed[e.token] ?? 0;
      r.text(fit(`${missed} missed, ${used} used`, 24), 31, row, INK_DIM);
    }

    this.menuFoot(r, menu, '1 2 3  drill it    j k  scroll    h  back');
  }

  // ---------------------------------------------------------------- save

  /**
   * The save card is drawn by `SaveScreen`, which `player-save` owns and which
   * places no menu rows (DECISIONS #60). Clearing the map by hand keeps a
   * click from selecting a row that is no longer on screen.
   */
  clearMenuRows(): void { this.rowCells = []; }

  // ---------------------------------------------------------------- wave card

  /** The one line survival says about missions, when this lesson has none. */
  static readonly WAVE_POINTER = 'mission unstarred - missions on the menu';

  drawWaveCard(r: Renderer, state: GameState, records: MissionRecords = {}): void {
    r.overlay(PALETTE.bg, 0.78);
    const n = state.wave;
    const d = waveDef(n);
    // panel cols 6..54, usable 6.5..53.5; rows -3..17, usable -2.5..15.5
    r.panel(6, -3, 48, 20);
    r.text(fit(d.section.toUpperCase(), 30), 9, -2, INK_DIM);
    r.text(n <= LESSON_COUNT ? `${n}/${LESSON_COUNT}` : '--', 48, -2, INK_DIM);
    r.centerText(`NIGHT ${n}`, 0, INK_RED, 2.2);
    r.centerText(fit(d.title, 33), 3, INK, 1.4);
    r.rule(9, 5, 42);
    caps(r, d.keys, 9, 7);
    const desc = wrap(d.desc, 42, 2);
    for (let i = 0; i < desc.length; i++) r.text(desc[i], 9, 9 + i, INK);
    const brief = wrap(d.brief, 42, 2);
    for (let i = 0; i < brief.length; i++) r.text(brief[i], 9, 12 + i, INK_DIM);
    // A lesson you have not starred in missions gets one dim line pointing
    // there. Survival is otherwise untouched (DECISIONS #93).
    const m = missionForLesson(n);
    if (m && (records[m.id]?.stars ?? 0) <= 0) r.centerText(Screens.WAVE_POINTER, 14, INK_DIM);
    r.centerText(Math.max(0, state.sim.breather / 1000).toFixed(1), 15, INK_DIM);
  }

  // ---------------------------------------------------------------- store
  // The between-nights screen in survival, in place of the wave card. It is
  // the tightest card in the game: sixteen selectable rows on one panel.
  //
  // The blurbs do not live on the rows. Fifteen of them at 20 cells each was
  // fifteen sentences cut off mid-word, so only the *selected* item's blurb is
  // printed, on its own full-width line at the foot of the card. That buys the
  // rows enough width for a name, a price and an owned count that all read at
  // a glance, and it is why `S_BLURB_ROW` exists.
  //
  // Every string is placed against a column constant so
  // `tests/ui-layout.test.ts` can assert the whole card at every cursor
  // position with the longest strings the tables can produce.

  /** panel cols 2..58 (usable 2.5..57.5), rows -5..19 (usable -4.5..17.5). */
  private static readonly S_COL = 2;
  private static readonly S_ROW = -5;
  private static readonly S_W = 56;
  private static readonly S_H = 24;

  private static readonly S_MARK = 4;      // the `>` cursor marker
  private static readonly S_NAME = 6;      // the item's name
  private static readonly S_PRICE = 23;    // its price
  private static readonly S_OWNED = 31;    // `owned 1/2`
  private static readonly S_TAG = 48;      // `full`, or `--`: why a row is dead
  private static readonly S_TOP = -2;      // the first item row
  private static readonly S_BLURB_ROW = 14;
  private static readonly S_MANIFEST = 15; // and 16
  private static readonly S_FOOT = 17;     // the keys line

  /** Which store visit the page turn is animating, and when it started. */
  private storeNight = -1;
  private storeAt = 0;

  drawStore(r: Renderer, state: GameState, tMs = 0): void {
    const sm = state.sim;
    const cur = sm.shop.cursor;
    // A new night is a new page. `drawStore` only runs while the store is
    // open, so the wave number is enough to know a visit has begun.
    if (state.wave !== this.storeNight) {
      this.storeNight = state.wave;
      this.storeAt = tMs;
    }

    r.overlay(PALETTE.bg, 0.88);
    r.panel(Screens.S_COL, Screens.S_ROW, Screens.S_W, Screens.S_H);

    // ---- the header ---------------------------------------------------
    // `STORE` is the word that says where you are; the night it cleared and
    // the wallet are the two numbers you decide against. No rule under it -
    // the heading is two cells tall and a rule on the next row draws straight
    // through its baseline.
    r.text('STORE', Screens.S_MARK, -4, INK, 2.0);
    r.text(fit(`NIGHT ${state.wave} CLEARED`, 17), 16, -4, INK_DIM, 1.2);
    r.text(fit(`SUPPLIES ${state.supplies}`, 16), 38, -4, INK_HOT, 1.2);

    // ---- the list -----------------------------------------------------
    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const row = Screens.S_TOP + i;
      const on = i === cur;
      const afford = canBuy(state, it.id);
      // Two different reasons a row is dead, and they want different words:
      // `full` is a magazine you cannot add to, `--` is money you do not have.
      const cap = capOf(state, it.id);
      const full = cap > 0 && ownedOf(state, it.id) >= cap;
      const rich = state.supplies >= it.price;
      this.markAt(r, Screens.S_MARK, row, on);
      // The cursor row is always hot, even on something you cannot buy: where
      // you are standing must never be ambiguous.
      r.text(fit(it.name, 14), Screens.S_NAME, row,
        on ? INK_HOT : afford ? INK : INK_DIM, 1.1);
      // Red on the price means the price is the problem, and nothing else.
      r.text(fit(String(it.price), 5), Screens.S_PRICE, row,
        rich ? INK : INK_RED, 1.1);
      r.text(fit(ownedText(state, it.id), 14), Screens.S_OWNED, row, INK_DIM, 1.1);
      if (full) r.text('full', Screens.S_TAG, row, INK_DIM);
      else if (!rich) r.text('--', Screens.S_TAG, row, INK_RED);
    }

    const nextRow = Screens.S_TOP + ITEMS.length;
    const onNext = cur >= ITEMS.length;
    this.markAt(r, Screens.S_MARK, nextRow, onNext);
    // Same scale as the item rows it sits under: at 1.15 its descenders reach
    // into the next row and the hairline below it draws through them.
    r.text(fit(`NEXT NIGHT ${state.wave + 1}`, 18), Screens.S_NAME, nextRow,
      onNext ? INK_HOT : INK, 1.1);

    // ---- what the selected row actually does --------------------------
    // No hairline between this and the list: fifteen items plus a header, a
    // caption, two manifest lines and the keys use every row the panel has,
    // so a separator would have to draw through the row above or below it.
    // The caption carries its own weight instead - it is the only full-width
    // line in dark ink, under two dim ones.
    const blurb = onNext
      ? NEXT_NIGHT_BLURB
      : ITEMS[cur]?.blurb ?? '';
    r.text(fit(blurb, CARD_LINE), 5, Screens.S_BLURB_ROW, INK);

    // ---- tomorrow night, if you paid to know --------------------------
    if (sm.manifest) {
      const [head, mix] = manifestCard(state.wave);
      r.text(fit(head, CARD_LINE), 5, Screens.S_MANIFEST, INK);
      r.text(fit(mix, CARD_LINE), 5, Screens.S_MANIFEST + 1, INK_DIM);
    } else {
      r.text('MANIFEST  locked', 5, Screens.S_MANIFEST, INK_DIM);
    }

    r.centerText('j k  move    l or Enter  buy    n  next night',
      Screens.S_FOOT, INK_DIM);

    // The page turns over the top of the finished card, so the card is
    // revealed by the sweep rather than fading in underneath it.
    const p = (tMs - this.storeAt) / PAGE_TURN_MS;
    r.pageTurn(p);
  }

  /**
   * Placement mode: a strip along the top, so the survey grid the renderer
   * draws on the field stays fully visible underneath. The cost is quoted live
   * as the crosshair moves, which is the whole point of anchoring first.
   *
   * `teach` grows the strip by a row per line. Two callers use it: the first
   * placement of a run, which has to say that the lanes below are a ruler and
   * not the horde, and the warm-up's placement mission, which puts its title
   * and hint there. They share the region because they would otherwise be two
   * panels on the same three rows (DECISIONS #85).
   */
  drawPlacement(r: Renderer, state: GameState, teach: readonly string[] = []): void {
    const shop = state.sim.shop;
    // panel cols 2..58, usable 2.5..57.5; rows -6..-2 before `teach`, and one
    // row per line after it. Five lines would reach the first lane, so the
    // region is capped at four.
    r.panel(2, -6, 56, 5);
    const a = shop.anchor;
    const cost = spanCost(shop.item, a, shop.place);
    r.text(fit(`PLACING ${shop.item}`, 22), 4, -5, INK, 1.2);
    r.text(fit(`SUPPLIES ${state.supplies}`, 16), 28, -5, INK_DIM);
    // Both INK_HOT and INK_RED are reds, so quoting an affordable span in
    // INK_HOT read as a warning. Red means you cannot pay for it, full stop.
    r.text(fit(`cost ${cost}`, 12), 45, -5, cost <= state.supplies ? INK : INK_RED);
    r.text(fit(`lane ${shop.place.row + 1}  col ${shop.place.col}`, 20), 4, -4, INK);
    r.text(fit(a ? `anchor lane ${a.row + 1} col ${a.col}` : 'anchor not set', 26),
      26, -4, a ? INK : INK_DIM);
    r.text(fit(a || shop.item === 'tripwire' || shop.item === 'wire'
      ? Screens.PLACE_KEYS_PLANT : Screens.PLACE_KEYS_ANCHOR,
      Screens.PLACE_LINE), 4, -3, INK_DIM);
    // The teaching goes in the foreground band at the bottom, not under the
    // strip. Growing the strip downward covered the first two or three lanes,
    // which are lanes you might want to place on while you are still reading
    // why (DECISIONS #85).
    const extra = Math.min(teach.length, Screens.PLACE_TEACH_MAX);
    if (extra === 0) return;
    r.panel(2, Screens.PLACE_TEACH_ROW - 1, 56, 2 + extra);
    for (let i = 0; i < extra; i++) {
      r.text(fit(teach[i], Screens.PLACE_LINE), 4, Screens.PLACE_TEACH_ROW + i,
        i === 0 ? INK : INK_DIM);
    }
  }

  /**
   * The two key lines on the strip. They are the only place the game states
   * the anchor-then-motion rule at the moment it matters, so their length is
   * asserted rather than left to `fit` (DECISIONS #85).
   */
  static readonly PLACE_KEYS_PLANT = 'Enter  plant it     Esc  cancel';
  static readonly PLACE_KEYS_ANCHOR = 'Enter  anchor, then move, Enter again    Esc  cancel';

  /** Rows the teaching region may use before it runs out of drawable band. */
  private static readonly PLACE_TEACH_MAX = 3;
  /** First row of the teaching panel, in the near foreground band. */
  private static readonly PLACE_TEACH_ROW = 17;
  /** Widest a teaching line may be: column 4 to the panel's right margin. */
  static readonly PLACE_LINE = 53;

  /**
   * What the strip says when the player has never planted anything this run.
   * The survey grid is the one thing about placement that is not guessable:
   * the lanes stop being the horde and start being a ruler.
   */
  static readonly PLACE_FIRST: readonly string[] = [
    'these lanes are a ruler now, not the horde',
    'every motion works here:  f3 = col 30,  5G = lane 5',
  ];

  // ---------------------------------------------------------------- missions

  /** The DONE strip's keys. Asserted against the strip's line budget. */
  static readonly MISSION_DONE_KEYS = 'n  next    r  try again    Esc  list';
  /** Widest a strip line may be: column 6 to the panel's right margin. */
  static readonly MISSION_LINE = 49;

  /**
   * A strip along the top while a mission runs. The field stays fully visible
   * underneath. TRY: the beat and the mission's number, its title, the keys
   * spent against par (or GOOD while the hold runs), its keycaps, `r`, and
   * the hint. DONE: the same header with the stars, and the three keys that
   * leave it (DECISIONS #93).
   */
  drawMissionStrip(r: Renderer, state: GameState): void {
    const sm = state.sim;
    const m = MISSIONS[sm.mission];
    if (!m) return;
    const done = sm.missionBeat === 'done';
    const par = missionPar(m.id);
    // panel cols 4..56, usable 4.5..55.5; rows -6..-1, usable -5.5..-2.5
    r.panel(4, -6, 52, 5);
    r.text(fit(`${done ? 'DONE' : 'TRY'}  ${sm.mission + 1}/${MISSIONS.length}`, 10), 6, -5, INK_DIM);
    r.text(fit(m.title, Screens.M_TITLE_MAX), 17, -5, INK);
    if (!done && sm.missionHold > 0) r.text('GOOD', 41, -5, INK_HOT, 1.15);
    else r.text(fit(`keys ${sm.missionKeys}  par ${par}`, 14), 41, -5, done ? INK : INK_DIM);
    if (done) {
      const stars = starsFor(sm.missionKeys, par);
      r.text(starGlyphs(stars), 6, -4, INK_HOT, 1.4);
      r.text(`${stars} star${stars === 1 ? '' : 's'}`, 12, -4, INK);
      r.text(Screens.MISSION_DONE_KEYS, 6, -3, INK_DIM);
      return;
    }
    caps(r, m.keys, 6, -4);
    r.keycap('r', 40, -4, 3);
    r.text('start over', 44, -4, INK_DIM);
    r.text(fit(m.hint, Screens.MISSION_LINE), 6, -3, INK);
  }

  // ---------------------------------------------------------------- pause

  /**
   * `canSuspend` adds the `w` row: a survival run can be written down and
   * picked up from the menu later (DECISIONS #96). Missions cannot - they are
   * a minute long and `r` restarts them - so the row is not drawn for one.
   */
  drawPause(r: Renderer, muted: boolean, settings: Settings, canSuspend = false): void {
    r.overlay(PALETTE.bg, 0.72);
    // panel cols 14..46, usable 14.5..45.5; rows -1..17, usable -0.5..15.5
    r.panel(14, -1, 32, 18);
    r.centerText('PAUSED', 1, INK, 1.9);
    r.rule(17, 3, 26);

    r.keycap('s', 17, 5, 3);
    r.text('sound', 22, 5, INK_DIM);
    r.text(muted ? 'OFF' : 'ON', 34, 5, muted ? INK_RED : INK);

    r.keycap('g', 17, 7, 3);
    r.text('gore', 22, 7, INK_DIM);
    r.text(goreLabel(settings.gore), 34, 7, INK);
    r.text(fit(goreBlurb(settings.gore), 23), 22, 8, INK_DIM);

    r.keycap('n', 17, 10, 3);
    r.text('numbers', 22, 10, INK_DIM);
    r.text(lineNumbersLabel(settings.lineNumbers), 34, 10, INK);
    r.text(fit(lineNumbersBlurb(settings.lineNumbers), 23), 22, 11, INK_DIM);

    if (canSuspend) {
      r.keycap('w', 17, 13, 3);
      r.text('save & quit', 22, 13, INK_DIM);
      r.text(fit('resume it from the menu', 23), 22, 14, INK_DIM);
    }

    r.centerText('Esc  back to it      Q  give up', 15, INK_DIM);
  }

  /** Returns what main.ts should do. `suspend` is only honoured where the
   *  card offered it; elsewhere `w` is nothing, like any other stray key. */
  feedPauseKey(key: string): PauseAction {
    if (key === '<Esc>' || key === 'p') return 'resume';
    if (key === 's' || key === 'S') return 'sound';
    if (key === 'g' || key === 'G') return 'gore';
    if (key === 'n' || key === 'N') return 'numbers';
    if (key === 'w' || key === 'W') return 'suspend';
    if (key === 'Q') return 'menu';
    return null;
  }

  // ---------------------------------------------------------------- death

  drawDeath(r: Renderer, state: GameState): void {
    const s = this.ledger.summary();
    const d = waveDef(state.wave);
    r.overlay(PALETTE.bg, 0.86);
    // panel cols 3..57, usable 3.5..56.5; rows -4..19, usable -3.5..17.5
    r.panel(3, -4, 54, 23);
    r.centerText('YOU DID NOT SURVIVE THE NIGHT', -3, INK_HOT, 1.8);
    r.centerText(fit(
      `NIGHT ${state.wave}   SCORE ${state.score}   COMBO x${state.sim.longestCombo}   KILLS ${state.sim.kills}`,
      52), 0, INK);
    r.centerText(fit(`got as far as: ${d.section} / ${d.title}`, 52), 1, INK_DIM);
    r.centerText(fit(deathLine({ state, summary: s, unknownKeys: this.unknownKeys }), 52), 3, INK_RED);

    r.text('MOTIONS', 6, 5, INK_DIM);
    r.rule(6, 6, 48);

    r.text('most used', 6, 8, INK_DIM);
    r.text(fit(s.topUsed.length ? s.topUsed.map(([k, n]) => `${k} ${n}`).join('    ') : '-', 32),
      24, 8, INK);

    r.text('never used -', 6, 10, INK_DIM);
    r.text('would have won it', 6, 11, INK_DIM);
    r.text(fit(s.neverUsed.length ? s.neverUsed.map(([k, n]) => `${k} (${n}x)`).join('    ') : '-', 32),
      24, 10, INK_HOT);

    r.text('keystrokes / kill', 6, 13, INK_DIM);
    const prev = s.prevKpk === null ? '' : `    last run ${s.prevKpk}`;
    r.text(fit(`${s.kpk}${prev}`, 32), 24, 13, INK);
    if (s.trend.length > 1) {
      r.text('trend', 6, 14, INK_DIM);
      r.text(fit(s.trend.slice(-5).join('  '), 32), 24, 14, INK_DIM);
    }
    // The coach's one line: the family you most need, and where the drill is
    // (drills-and-coach D7). Neutral until the ledger has something to say.
    r.text(fit(coachLine(this.ledger.coach()), 50), 6, 15, INK_HOT);
    if (s.wastedKeystrokes > 0) {
      r.text('wasted', 6, 16, INK_DIM);
      r.text(fit(`${s.wastedKeystrokes} keystrokes`, 32), 24, 16, INK_RED);
    }

    if (this.error) r.text(fit(this.error, 50), 6, 17, INK_HOT);
    else if (this.cmdline) r.text(fit(this.cmdline, 50), 6, 17, INK);
    else r.centerText('i  insert yourself again          :q  quit', 17, INK_DIM);
  }

  // ---------------------------------------------------------------- input

  feedDeathKey(key: string): DeathAction {
    if (this.cmdline === '') {
      if (key === 'i') return 'restart';
      if (key === ':') { this.cmdline = ':'; this.error = ''; }
      return null;
    }
    if (key === '<Esc>') { this.cmdline = ''; return null; }
    if (key === '<BS>') { this.cmdline = this.cmdline.slice(0, -1); return null; }
    if (key === '<CR>') {
      const cmd = this.cmdline;
      this.cmdline = '';
      if (cmd === ':q') { this.error = E37; return null; }
      if (cmd === ':q!' || cmd === ':wq' || cmd === ':x') return 'menu';
      this.error = `E492: Not an editor command: ${cmd.slice(1)}`;
      return null;
    }
    if (key.length === 1) this.cmdline += key;
    return null;
  }
}
