import { describe, expect, it } from 'vitest';
import { Screens } from '../src/ui/screens';
import { Ledger } from '../src/ui/ledger';
import { createState } from '../src/core/state';
import { LESSON_COUNT } from '../src/sim/waves';
import { TUTORIAL } from '../src/sim/tutorial';
import { Bus } from '../src/core/bus';
import type { GameState } from '../src/core/state';
import type { Renderer } from '../src/render/renderer';

const COLS = 60;
const TOP = -6;      // first row the renderer gives the UI layer
const BOT = 19;      // last row

interface Box { what: string; col: number; row: number; w: number }

/**
 * A Renderer that draws nothing and measures everything, using the real
 * placement arithmetic from src/render/renderer.ts.
 */
class Ruler {
  boxes: Box[] = [];
  panels: Box[] = [];
  private panelBox: Box | null = null;

  panel(col: number, row: number, w: number, h: number): void {
    this.panelBox = { what: 'panel', col, row, w };
    this.panels.push({ what: `panel h=${h}`, col, row, w });
    this.panelH = h;
  }
  private panelH = 0;
  panelBounds(): { col: number; row: number; w: number; h: number } | null {
    return this.panelBox ? { ...this.panelBox, h: this.panelH } : null;
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
  fillCells(): void { /* decorative */ }
  showcmd(): void { /* renderer-owned */ }
  flashError(): void { /* no-op */ }
}

function check(name: string, draw: (r: Renderer) => void): void {
  const ruler = new Ruler();
  draw(ruler as unknown as Renderer);
  const p = ruler.panelBounds();
  expect(p, `${name}: every card must open with a panel()`).not.toBeNull();

  for (const b of ruler.boxes) {
    const end = b.col + b.w;
    expect(b.col, `${name}: ${b.what} starts left of the grid`).toBeGreaterThanOrEqual(0);
    expect(end, `${name}: ${b.what} runs past column ${COLS} (ends ${end.toFixed(1)})`)
      .toBeLessThanOrEqual(COLS);
    expect(b.row, `${name}: ${b.what} above the drawable band`).toBeGreaterThanOrEqual(TOP);
    expect(b.row, `${name}: ${b.what} below the drawable band`).toBeLessThanOrEqual(BOT);

    // and inside the card it is printed on, with a half-cell of margin
    expect(b.col, `${name}: ${b.what} spills off the left of its panel`)
      .toBeGreaterThanOrEqual(p!.col + 0.5);
    expect(end, `${name}: ${b.what} spills off the right of its panel` +
      ` (ends ${end.toFixed(1)}, panel ends ${p!.col + p!.w})`)
      .toBeLessThanOrEqual(p!.col + p!.w - 0.5);
    expect(b.row, `${name}: ${b.what} above its panel`).toBeGreaterThanOrEqual(p!.row + 0.5);
    expect(b.row, `${name}: ${b.what} below its panel`).toBeLessThanOrEqual(p!.row + p!.h - 1.5);
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

function screens(): { s: Screens; st: GameState } {
  const st = createState(1);
  const led = new Ledger(st, new Bus());
  return { s: new Screens(led), st };
}

describe('card layout fits the panel it is printed on', () => {
  it('title', () => {
    const { s } = screens();
    check('title', (r) => s.drawTitle(r, 0));
    check('title (blink off)', (r) => s.drawTitle(r, 600));
  });

  it('wave card, for every lesson and beyond', () => {
    const { s, st } = screens();
    for (let w = 1; w <= LESSON_COUNT + 2; w++) {
      st.wave = w;
      st.sim.breather = 3000;
      check(`wave card ${w}`, (r) => s.drawWaveCard(r, st));
    }
  });

  it('warm-up strip, every step', () => {
    const { s, st } = screens();
    for (let i = 0; i < TUTORIAL.length; i++) {
      st.sim.tutorial = i;
      st.sim.tutorialHold = 0;
      check(`warm-up ${i + 1}`, (r) => s.drawTutorial(r, st));
      st.sim.tutorialHold = 500;
      check(`warm-up ${i + 1} (cleared)`, (r) => s.drawTutorial(r, st));
    }
  });

  it('pause, every gore level and both sound states', () => {
    const { s } = screens();
    for (const gore of ['off', 'low', 'full'] as const) {
      for (const lineNumbers of ['off', 'absolute', 'relative'] as const) {
        for (const muted of [true, false]) {
          check(`pause ${gore}/${lineNumbers} muted=${muted}`,
            (r) => s.drawPause(r, muted, { gore, lineNumbers }));
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
    s.error = 'E37: No write since last change (add ! to override)';
    check('death + E37', (r) => s.drawDeath(r, st));
    s.error = '';
    s.cmdline = ':q!';
    check('death + cmdline', (r) => s.drawDeath(r, st));
  });
});
