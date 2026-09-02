// ============================================================================
// Phase C — Renderer. The static scene, baked once per resize.
//
// Back layer (one drawImage per frame):
//   night sky gradient -> ragged conifer treeline -> ground fog band ->
//   grass with mottled noise and tufts -> lane banding -> dried blood in the
//   grass -> the survivor's paving and the junk stacked on it.
// Front layer (one drawImage per frame, over everything the sim draws):
//   corner vignette + soft cinematic letterbox.
//
// Nothing here runs per frame. Baking may allocate freely; blitting may not.
// ============================================================================
import { Rng } from '../core/rng';
import { PALETTE } from './palette';

export interface SceneGeo {
  w: number; h: number;          // CSS pixels
  cw: number; ch: number;        // cell size, CSS pixels
  ox: number; oy: number;        // field cell (0,0) top-left, CSS pixels
  cols: number; rows: number;    // 60 x 16
}

// --- band layout, in field-relative rows -------------------------------------
/** rows above the field that belong to the sky/treeline/fog band */
export const BAND_TOP = 6;
/** rows below the field that belong to the near foreground + HUD band */
export const BAND_BOTTOM = 4;
export const TOTAL_ROWS_ = BAND_TOP + 16 + BAND_BOTTOM;

/** the ground plane starts here (also the base of the treeline) */
export const HORIZON_ROW = -2.0;
export const TREE_TOP_ROW = -4.7;
export const FOG_TOP_ROW = -2.7;
export const FOG_BOT_ROW = -0.85;
/** left edge of the survivor's paving, in columns */
export const PAVING_COL = 54.2;

/** Cap the baked layers at ~4.2M device pixels each. */
const MAX_BAKE_PX = 4_200_000;

function bakeScale(w: number, h: number, dpr: number): number {
  const px = Math.max(1, w * h);
  const s = Math.sqrt(MAX_BAKE_PX / px);
  return Math.max(0.5, Math.min(dpr, s));
}

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  const cx = cv.getContext('2d');
  if (!cx) throw new Error('render: 2d context unavailable for the scene bake');
  return [cv, cx];
}

export class Scene {
  private backCv: HTMLCanvasElement;
  private backCx: CanvasRenderingContext2D;
  private frontCv: HTMLCanvasElement;
  private frontCx: CanvasRenderingContext2D;
  private key = '';

  constructor() {
    const [bc, bx] = newCanvas();
    this.backCv = bc; this.backCx = bx;
    const [fc, fx] = newCanvas();
    this.frontCv = fc; this.frontCx = fx;
  }

  bake(g: SceneGeo, dpr: number, seed: number, goreOff: boolean): void {
    const k = g.w + '|' + g.h + '|' + g.cw + '|' + g.ch + '|' + g.ox + '|' + g.oy +
      '|' + (goreOff ? 1 : 0) + '|' + seed;
    if (k === this.key) return;
    this.key = k;

    const s = bakeScale(g.w, g.h, dpr);
    const pw = Math.max(2, Math.round(g.w * s));
    const ph = Math.max(2, Math.round(g.h * s));

    this.backCv.width = pw; this.backCv.height = ph;
    this.frontCv.width = pw; this.frontCv.height = ph;

    this.backCx.setTransform(s, 0, 0, s, 0, 0);
    this.frontCx.setTransform(s, 0, 0, s, 0, 0);
    this.backCx.clearRect(0, 0, g.w, g.h);
    this.frontCx.clearRect(0, 0, g.w, g.h);

    this.bakeBack(this.backCx, g, seed, goreOff);
    this.bakeFront(this.frontCx, g);
  }

  blitBack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.backCv.width < 2) return;
    ctx.drawImage(this.backCv, x, y, w, h);
  }

  blitFront(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    if (this.frontCv.width < 2) return;
    ctx.drawImage(this.frontCv, x, y, w, h);
  }

  // --- back --------------------------------------------------------------
  private bakeBack(cx: CanvasRenderingContext2D, g: SceneGeo, seed: number, goreOff: boolean): void {
    const rng = new Rng(seed >>> 0 || 0xb10d);
    const yOf = (row: number) => g.oy + row * g.ch;
    const xOf = (col: number) => g.ox + col * g.cw;

    const yHor = yOf(HORIZON_ROW);
    const yTree = yOf(TREE_TOP_ROW);

    // --- sky ---------------------------------------------------------------
    const sky = cx.createLinearGradient(0, 0, 0, Math.max(yHor, 2));
    sky.addColorStop(0, PALETTE.skyTop);
    sky.addColorStop(1, PALETTE.skyHorizon);
    cx.fillStyle = sky;
    cx.fillRect(0, 0, g.w, Math.max(yHor, 0) + 1);

    // faint horizon bloom
    if (yHor > 0) {
      const bloom = cx.createLinearGradient(0, Math.max(0, yHor - g.ch * 3), 0, yHor);
      bloom.addColorStop(0, 'rgba(122,138,158,0)');
      bloom.addColorStop(1, 'rgba(122,138,158,0.30)');
      cx.fillStyle = bloom;
      cx.fillRect(0, Math.max(0, yHor - g.ch * 3), g.w, Math.min(g.ch * 3, yHor));
    }

    // --- treeline ----------------------------------------------------------
    const treeBase = yHor + g.ch * 0.25;
    const maxH = Math.max(4, treeBase - yTree);
    cx.fillStyle = PALETTE.tree;
    cx.beginPath();
    cx.moveTo(-2, treeBase + 2);
    const step = Math.max(3, g.cw * 0.55);
    let tx = -2;
    let i = 0;
    while (tx < g.w + step) {
      const hh = 0.35 + rng.next() * 0.65;
      const th = maxH * hh;
      const half = step * (0.9 + rng.next() * 1.5);
      // a conifer: ragged left slope up to a point, ragged right slope down
      const tip = tx + half;
      const tiers = 3;
      for (let t = tiers; t >= 1; t--) {
        const f = t / tiers;
        cx.lineTo(tx + half * (1 - f * 0.92), treeBase - th * (1 - f) - th * 0.06 * rng.next());
        cx.lineTo(tx + half * (1 - f * 0.62), treeBase - th * (1 - f * 0.78));
      }
      cx.lineTo(tip, treeBase - th);
      for (let t = 1; t <= tiers; t++) {
        const f = t / tiers;
        cx.lineTo(tip + half * (f * 0.62), treeBase - th * (1 - f * 0.78));
        cx.lineTo(tip + half * (f * 0.92), treeBase - th * (1 - f) - th * 0.06 * rng.next());
      }
      tx = tip + half;
      i++;
      if (i > 2000) break;
    }
    cx.lineTo(g.w + 4, treeBase + 2);
    cx.closePath();
    cx.fill();

    // --- ground ------------------------------------------------------------
    const yBot = g.h;
    const grass = cx.createLinearGradient(0, yHor, 0, yBot);
    grass.addColorStop(0, PALETTE.fieldFar);
    grass.addColorStop(0.62, PALETTE.fieldNear);
    grass.addColorStop(1, PALETTE.fieldDeep);
    cx.fillStyle = grass;
    cx.fillRect(0, yHor - 1, g.w, yBot - yHor + 2);

    // mottled noise: soft irregular blotches, low alpha, never per frame
    const blots = 520;
    for (let b = 0; b < blots; b++) {
      const y = yHor + rng.next() * rng.next() * (yBot - yHor) * 1.05;
      if (y > yBot) continue;
      const x = rng.next() * g.w;
      const depth = (y - yHor) / Math.max(1, yBot - yHor);
      const rx = g.cw * (0.8 + rng.next() * 3.4) * (0.5 + depth);
      const ry = rx * (0.20 + rng.next() * 0.22);
      cx.globalAlpha = 0.030 + rng.next() * 0.055;
      cx.fillStyle = rng.next() < 0.5 ? '#4d5f56' : '#1e2723';
      cx.beginPath();
      cx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;

    // grass tufts — tiny darker ticks, denser near the camera
    cx.strokeStyle = '#212c27';
    cx.lineWidth = Math.max(1, g.ch * 0.035);
    cx.beginPath();
    for (let t = 0; t < 900; t++) {
      const f = rng.next();
      const y = yHor + f * f * (yBot - yHor);
      const x = rng.next() * g.w;
      const len = g.ch * (0.06 + 0.16 * f);
      cx.moveTo(x, y);
      cx.lineTo(x + (rng.next() - 0.5) * len, y - len);
    }
    cx.globalAlpha = 0.5;
    cx.stroke();
    cx.globalAlpha = 1;

    // --- lane banding ------------------------------------------------------
    // subtle, so 16 lanes read as ground, not as a spreadsheet
    for (let r = 0; r < g.rows; r++) {
      const y = yOf(r);
      cx.fillStyle = (r & 1) === 0 ? 'rgba(214,228,218,0.022)' : 'rgba(0,0,0,0.038)';
      cx.fillRect(0, y, g.w, g.ch);
    }
    cx.fillStyle = 'rgba(0,0,0,0.10)';
    const lw = Math.max(1, g.ch * 0.03);
    for (let r = 0; r <= g.rows; r++) cx.fillRect(0, yOf(r) - lw * 0.5, g.w, lw);

    // a trodden path worn down the middle lanes, where the horde walks
    cx.globalAlpha = 0.10;
    cx.fillStyle = '#4b4436';
    for (let p = 0; p < 90; p++) {
      const r = 2 + rng.next() * (g.rows - 4);
      const x = rng.next() * xOf(g.cols);
      const rx = g.cw * (1.5 + rng.next() * 5);
      cx.beginPath();
      cx.ellipse(x, yOf(r), rx, g.ch * (0.16 + rng.next() * 0.2), 0, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;

    // --- dried blood in the grass -----------------------------------------
    if (!goreOff) {
      for (let b = 0; b < 26; b++) {
        // heavily weighted toward the foot of the barricade
        const f = rng.next();
        const col = 52 - f * f * 46;
        const row = rng.next() * g.rows;
        const x = xOf(col);
        const y = yOf(row) + g.ch * 0.6;
        const rx = g.cw * (1.2 + rng.next() * 4.2);
        const ry = g.ch * (0.18 + rng.next() * 0.42);
        cx.globalAlpha = 0.10 + rng.next() * 0.20;
        cx.fillStyle = PALETTE.bloodDry;
        cx.beginPath();
        cx.ellipse(x, y, rx, ry, (rng.next() - 0.5) * 0.5, 0, Math.PI * 2);
        cx.fill();
        for (let s = 0; s < 6; s++) {
          const sx = x + (rng.next() - 0.5) * rx * 3.2;
          const sy = y + (rng.next() - 0.5) * ry * 3.0;
          cx.beginPath();
          cx.ellipse(sx, sy, g.cw * 0.12 * (0.5 + rng.next()), g.ch * 0.05 * (0.5 + rng.next()),
            0, 0, Math.PI * 2);
          cx.fill();
        }
      }
      cx.globalAlpha = 1;
    }

    // --- fog band ----------------------------------------------------------
    const fy0 = yOf(FOG_TOP_ROW);
    const fy1 = yOf(FOG_BOT_ROW);
    if (fy1 > fy0) {
      const fog = cx.createLinearGradient(0, fy0, 0, fy1);
      fog.addColorStop(0, 'rgba(91,100,112,0.00)');
      fog.addColorStop(0.42, 'rgba(91,100,112,0.35)');
      fog.addColorStop(1, 'rgba(91,100,112,0.00)');
      cx.fillStyle = fog;
      cx.fillRect(0, fy0, g.w, fy1 - fy0);
      // torn upper edge so it is not a ruled line
      cx.globalAlpha = 0.16;
      cx.fillStyle = PALETTE.fog;
      for (let f = 0; f < 60; f++) {
        const x = rng.next() * g.w;
        cx.beginPath();
        cx.ellipse(x, fy0 + (fy1 - fy0) * (0.2 + rng.next() * 0.6),
          g.cw * (2 + rng.next() * 6), (fy1 - fy0) * (0.14 + rng.next() * 0.3),
          0, 0, Math.PI * 2);
        cx.fill();
      }
      cx.globalAlpha = 1;
    }

    // --- the survivor's paving + the junk on it ----------------------------
    const px0 = xOf(PAVING_COL);
    cx.fillStyle = PALETTE.paving;
    cx.fillRect(px0, yHor + g.ch * 0.2, g.w - px0, g.h - yHor);
    cx.globalAlpha = 0.35;
    cx.fillStyle = '#2b2e33';
    for (let s = 0; s < 220; s++) {
      const x = px0 + rng.next() * (g.w - px0);
      const y = yHor + rng.next() * (g.h - yHor);
      cx.fillRect(x, y, g.cw * 0.16, g.ch * 0.06);
    }
    cx.globalAlpha = 1;
    // slab seams
    cx.strokeStyle = 'rgba(0,0,0,0.30)';
    cx.lineWidth = Math.max(1, g.ch * 0.04);
    cx.beginPath();
    for (let r = -1; r <= g.rows + BAND_BOTTOM; r += 3) {
      cx.moveTo(px0, yOf(r)); cx.lineTo(g.w, yOf(r));
    }
    cx.stroke();

    this.bakeJunk(cx, g, rng, xOf, yOf);

    // --- ground contact shadow under the wall ------------------------------
    const wall = xOf(51.6);
    const wshade = cx.createLinearGradient(wall - g.cw * 3, 0, wall, 0);
    wshade.addColorStop(0, 'rgba(0,0,0,0)');
    wshade.addColorStop(1, 'rgba(0,0,0,0.35)');
    cx.fillStyle = wshade;
    cx.fillRect(wall - g.cw * 3, yHor, g.cw * 3, g.h - yHor);
  }

  private bakeJunk(
    cx: CanvasRenderingContext2D, g: SceneGeo, rng: Rng,
    xOf: (c: number) => number, yOf: (r: number) => number,
  ): void {
    // oil drums and crates behind the survivor. Kept clear of the HUD block
    // (cols 49..60, rows 15.6..19) and of the survivor himself (rows 6..13).
    const drum = (col: number, row: number, hCells: number) => {
      const x = xOf(col);
      const y = yOf(row);
      const w = g.cw * 1.5;
      const h = g.ch * hCells;
      cx.fillStyle = '#3b3327';
      cx.fillRect(x, y - h, w, h);
      cx.fillStyle = '#4d4433';
      cx.fillRect(x, y - h, w * 0.32, h);
      cx.fillStyle = '#241f18';
      cx.fillRect(x + w * 0.78, y - h, w * 0.22, h);
      cx.fillStyle = 'rgba(0,0,0,0.35)';
      cx.fillRect(x, y - h * 0.72, w, g.ch * 0.07);
      cx.fillRect(x, y - h * 0.30, w, g.ch * 0.07);
      cx.fillStyle = 'rgba(0,0,0,0.30)';
      cx.fillRect(x - g.cw * 0.15, y - g.ch * 0.08, w + g.cw * 0.3, g.ch * 0.14);
    };
    const crate = (col: number, row: number, wCells: number, hCells: number) => {
      const x = xOf(col);
      const y = yOf(row);
      const w = g.cw * wCells;
      const h = g.ch * hCells;
      cx.fillStyle = '#4a4034';
      cx.fillRect(x, y - h, w, h);
      cx.strokeStyle = '#2a241d';
      cx.lineWidth = Math.max(1, g.ch * 0.05);
      cx.strokeRect(x, y - h, w, h);
      cx.beginPath();
      cx.moveTo(x, y - h); cx.lineTo(x + w, y);
      cx.moveTo(x + w, y - h); cx.lineTo(x, y);
      cx.stroke();
    };

    drum(57.4, 3.4, 2.1);
    drum(58.6, 5.2, 2.4);
    crate(56.9, 14.6, 2.0, 1.5);
    crate(58.4, 15.0, 1.5, 1.2);
    crate(57.2, 13.0, 1.4, 1.1);
    // scattered debris
    cx.fillStyle = '#332c22';
    for (let s = 0; s < 14; s++) {
      const x = xOf(54.6 + rng.next() * 5);
      const y = yOf(-1 + rng.next() * (g.rows + 3));
      cx.fillRect(x, y, g.cw * (0.3 + rng.next() * 0.8), g.ch * 0.09);
    }
  }

  // --- front -------------------------------------------------------------
  private bakeFront(cx: CanvasRenderingContext2D, g: SceneGeo): void {
    const r0 = Math.min(g.w, g.h) * 0.34;
    const r1 = Math.max(g.w, g.h) * 0.78;
    const vg = cx.createRadialGradient(g.w * 0.5, g.h * 0.52, r0, g.w * 0.5, g.h * 0.52, r1);
    vg.addColorStop(0, 'rgba(6,9,14,0)');
    vg.addColorStop(0.65, 'rgba(6,9,14,0.22)');
    vg.addColorStop(1, 'rgba(6,9,14,0.72)');
    cx.fillStyle = vg;
    cx.fillRect(0, 0, g.w, g.h);

    // soft cinematic letterbox: gradient, never a hard bar
    const bh = Math.max(g.ch * 0.9, g.h * 0.045);
    const top = cx.createLinearGradient(0, 0, 0, bh);
    top.addColorStop(0, 'rgba(4,6,10,0.85)');
    top.addColorStop(1, 'rgba(4,6,10,0)');
    cx.fillStyle = top;
    cx.fillRect(0, 0, g.w, bh);
    const bot = cx.createLinearGradient(0, g.h - bh, 0, g.h);
    bot.addColorStop(0, 'rgba(4,6,10,0)');
    bot.addColorStop(1, 'rgba(4,6,10,0.85)');
    cx.fillStyle = bot;
    cx.fillRect(0, g.h - bh, g.w, bh);
  }
}

// ============================================================================
// The gore layer. Persistent ground splatter for the whole run.
//
// Truth is `grid`, a small Float32Array of intensities in cell space, so the
// splatter survives a resize. The painted canvas is derived from it and one
// drawImage puts the whole thing on screen.
// ============================================================================

/** rows above / below the field that gore can land in */
export const GORE_TOP = -1;
export const GORE_EXTRA = 3;

export class GoreLayer {
  readonly grid: Float32Array;
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private cols: number;
  private rowsSpan: number;
  private cw = 0;
  private ch = 0;
  private gx = 0;
  private gy = 0;
  private gw = 0;
  private gh = 0;
  private scale = 1;
  private ready = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rowsSpan = rows + GORE_EXTRA;
    this.grid = new Float32Array(cols * this.rowsSpan);
    const [cv, cx] = newCanvas();
    this.cv = cv; this.cx = cx;
  }

  /** Re-size the painted layer and repaint it from `grid`. */
  rebuild(g: SceneGeo, dpr: number): void {
    this.cw = g.cw; this.ch = g.ch;
    this.gx = g.ox;
    this.gy = g.oy + GORE_TOP * g.ch;
    this.gw = g.cols * g.cw;
    this.gh = this.rowsSpan * g.ch;
    const s = bakeScale(this.gw, this.gh, dpr);
    this.scale = s;
    this.cv.width = Math.max(2, Math.round(this.gw * s));
    this.cv.height = Math.max(2, Math.round(this.gh * s));
    this.cx.setTransform(s, 0, 0, s, 0, 0);
    this.cx.clearRect(0, 0, this.gw, this.gh);
    this.ready = true;
    const grid = this.grid;
    for (let r = 0; r < this.rowsSpan; r++) {
      for (let c = 0; c < this.cols; c++) {
        const v = grid[r * this.cols + c];
        if (v > 0) this.paint(c, r + GORE_TOP, v, false);
      }
    }
  }

  /** Deposit gore at a field cell. `amount` is roughly a particle size. */
  add(col: number, row: number, amount: number): void {
    if (col < 0 || col >= this.cols) return;
    const r = row - GORE_TOP;
    if (r < 0 || r >= this.rowsSpan) return;
    const i = r * this.cols + col;
    const prev = this.grid[i];
    if (prev >= 6) return;
    const v = prev + (amount > 0 ? amount : 0.2);
    this.grid[i] = v > 6 ? 6 : v;
    if (this.ready) this.paint(col, row, this.grid[i] - prev, true);
  }

  private paint(col: number, row: number, v: number, incremental: boolean): void {
    const cx = this.cx;
    const x = (col + 0.5) * this.cw;
    const y = (row - GORE_TOP + 0.75) * this.ch;
    const n = incremental ? 1 : Math.min(4, 1 + Math.floor(v));
    for (let k = 0; k < n; k++) {
      const h = hashCell(col, row, k * 7 + (incremental ? (v * 97) | 0 : 0));
      const jx = ((h & 255) / 255 - 0.5) * this.cw * 1.4;
      const jy = (((h >>> 8) & 255) / 255 - 0.5) * this.ch * 0.7;
      const rx = this.cw * (0.35 + ((h >>> 16) & 255) / 255 * 0.75) * (0.7 + v * 0.18);
      const ry = rx * 0.42;
      cx.globalAlpha = Math.min(0.42, 0.09 + v * 0.06);
      cx.fillStyle = v > 3 ? PALETTE.blood : PALETTE.bloodDry;
      cx.beginPath();
      cx.ellipse(x + jx, y + jy, rx, ry, 0, 0, Math.PI * 2);
      cx.fill();
      // a couple of specks so the edge is not a clean oval
      for (let s = 0; s < 3; s++) {
        const hs = hashCell(col, row, k * 31 + s * 5 + 3);
        const sx = x + jx + ((hs & 255) / 255 - 0.5) * rx * 3.4;
        const sy = y + jy + (((hs >>> 8) & 255) / 255 - 0.5) * ry * 3.2;
        cx.fillRect(sx, sy, this.cw * 0.12, this.ch * 0.05);
      }
    }
    cx.globalAlpha = 1;
  }

  blit(ctx: CanvasRenderingContext2D): void {
    if (!this.ready || this.cv.width < 2) return;
    ctx.drawImage(this.cv, this.gx, this.gy, this.gw, this.gh);
  }

  clear(): void {
    this.grid.fill(0);
    if (this.ready) {
      this.cx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      this.cx.clearRect(0, 0, this.gw, this.gh);
    }
  }
}

function hashCell(a: number, b: number, c: number): number {
  let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263) + Math.imul(c + 1, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
