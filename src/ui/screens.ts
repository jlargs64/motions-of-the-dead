// Phase E - every non-playfield screen, drawn with the renderer's glyph API.
// No DOM. Same aesthetic as the field: a survivor's notebook, in the dark.
import { PALETTE } from '../render/renderer';
import type { Renderer } from '../render/renderer';
import type { GameState } from '../core/state';
import { LESSON_COUNT, waveDef } from '../sim/waves';
import { TUTORIAL } from '../sim/tutorial';
import { deathLine } from './deaths';
import type { Ledger } from './ledger';
import { goreBlurb, goreLabel, lineNumbersBlurb, lineNumbersLabel } from './settings';
import type { Settings } from './settings';

export type DeathAction = 'restart' | 'title' | null;
export type PauseAction = 'resume' | 'title' | 'sound' | 'gore' | 'numbers' | null;

const E37 = 'E37: No write since last change (add ! to override)';

// Cards are drawn on `panel()`, which is weathered paper. The field palette is
// built for a near-black scene and vanishes on it, so cards get their own ink.
const INK = PALETTE.ink;              // pencil
const INK_DIM = '#6b6355';            // faded pencil
const INK_RED = '#7a1512';            // dark red, still readable on paper
const INK_HOT = '#9c1f14';            // the one shouty colour

/** Hard-truncate to a cell budget. Layout is asserted in tests/ui-layout.test.ts. */
function fit(s: string, max: number): string {
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

/** Lay a row of keycaps out from `col` and return the column after the last. */
function caps(r: Renderer, keys: readonly string[], col: number, row: number): number {
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

  resetRun(): void { this.cmdline = ''; this.error = ''; this.unknownKeys = 0; }

  // ---------------------------------------------------------------- title
  // The renderer gives the UI layer rows -6..19 (see src/render/NOTES.md);
  // the 16 field rows alone are too cramped for the ledger.

  drawTitle(r: Renderer, tMs: number): void {
    // panel cols 4..56, usable 4.5..55.5; rows -4..19, usable -3.5..17.5
    r.panel(4, -4, 52, 23);
    r.centerText('MOTIONS OF THE DEAD', -2, INK, 2.4);
    r.centerText('the horde is a text buffer', 1, INK_DIM);

    const blink = Math.floor(tMs / 500) % 2 === 0;
    r.centerText('PRESS  i  TO INSERT YOURSELF INTO THE HORDE', 3, blink ? INK_HOT : INK_RED);
    r.centerText('or  t  for the warm-up first', 4, INK_DIM);

    const d = waveDef(1);
    r.text(fit(`NIGHT 1 - ${d.section} / ${d.title}`, 44), 8, 6, INK_DIM);
    r.rule(8, 7, 44);

    const rows: Array<[string[], string]> = [
      [['h', 'j', 'k', 'l'], 'move one cell at a time'],
      [['w', 'e', 'b'], 'jump a whole word'],
      [['d', 'w'], 'kill the word you are on'],
    ];
    for (let i = 0; i < rows.length; i++) {
      const [keys, desc] = rows[i];
      caps(r, keys, 8, 9 + i * 2);
      r.text(fit(desc, 29), 26, 9 + i * 2, INK);
    }

    const hs = this.ledger.highScore;
    r.centerText(hs > 0 ? `HIGH SCORE  ${hs}` : 'NO HIGH SCORE. NO SURVIVORS.', 15, INK);
    r.centerText('Esc  pause & options      everything else is Vim', 17, INK_DIM);
  }

  // ---------------------------------------------------------------- wave card

  drawWaveCard(r: Renderer, state: GameState): void {
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
    r.centerText(Math.max(0, state.sim.breather / 1000).toFixed(1), 15, INK_DIM);
  }

  // ---------------------------------------------------------------- tutorial

  /** A strip along the top. The field stays fully visible underneath. */
  drawTutorial(r: Renderer, state: GameState): void {
    const i = state.sim.tutorial;
    const step = TUTORIAL[i];
    if (!step) return;
    // panel cols 4..56, usable 4.5..55.5; rows -6..-1, usable -5.5..-2.5
    r.panel(4, -6, 52, 5);
    r.text(`WARM-UP  ${i + 1}/${TUTORIAL.length}`, 6, -5, INK_DIM);
    r.text(fit(step.title, 18), 19, -5, INK, 1.15);
    if (state.sim.tutorialHold > 0) r.text('GOOD', 45, -5, INK_HOT, 1.15);
    caps(r, step.keys, 6, -4);
    r.keycap('r', 40, -4, 3);
    r.text('start over', 44, -4, INK_DIM);
    r.text(fit(step.hint, 49), 6, -3, INK);
  }

  // ---------------------------------------------------------------- pause

  drawPause(r: Renderer, muted: boolean, settings: Settings): void {
    r.overlay(PALETTE.bg, 0.72);
    // panel cols 14..46, usable 14.5..45.5; rows 0..15, usable 0.5..13.5
    r.panel(14, 0, 32, 15);
    r.centerText('PAUSED', 2, INK, 1.9);
    r.rule(17, 4, 26);

    r.keycap('s', 17, 6, 3);
    r.text('sound', 22, 6, INK_DIM);
    r.text(muted ? 'OFF' : 'ON', 34, 6, muted ? INK_RED : INK);

    r.keycap('g', 17, 8, 3);
    r.text('gore', 22, 8, INK_DIM);
    r.text(goreLabel(settings.gore), 34, 8, INK);
    r.text(fit(goreBlurb(settings.gore), 23), 22, 9, INK_DIM);

    r.keycap('n', 17, 11, 3);
    r.text('numbers', 22, 11, INK_DIM);
    r.text(lineNumbersLabel(settings.lineNumbers), 34, 11, INK);
    r.text(fit(lineNumbersBlurb(settings.lineNumbers), 23), 22, 12, INK_DIM);

    r.centerText('Esc  back to it      Q  give up', 13, INK_DIM);
  }

  /** Returns what main.ts should do. */
  feedPauseKey(key: string): PauseAction {
    if (key === '<Esc>' || key === 'p') return 'resume';
    if (key === 's' || key === 'S') return 'sound';
    if (key === 'g' || key === 'G') return 'gore';
    if (key === 'n' || key === 'N') return 'numbers';
    if (key === 'Q') return 'title';
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

    r.text('MOTION LEDGER', 6, 5, INK_DIM);
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
      if (cmd === ':q!' || cmd === ':wq' || cmd === ':x') return 'title';
      this.error = `E492: Not an editor command: ${cmd.slice(1)}`;
      return null;
    }
    if (key.length === 1) this.cmdline += key;
    return null;
  }
}
