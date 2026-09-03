// ============================================================================
// Phase C — Renderer. The static scene, baked once per resize.
//
// Back layer (one drawImage per frame):
//   night sky gradient -> ragged conifer treeline -> ground fog band ->
//   grass with mottled noise and tufts -> trodden ruts -> dried blood in the
//   grass -> the paving, the house facade, the floodlight post -> the light.
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
export const PAVING_COL = 54.6;
/** the house facade starts here and runs to the east edge of the screen */
export const HOUSE_COL = 57.0;
/** the floodlight post stands here, between the survivor and the house */
export const POST_COL = 56.7;

// --- the one light source --------------------------------------------------
// A floodlight on a post at the top of the wall, east side. It is the only
// light in the scene: the cone falls west across the field and the spawn edge
// is left in the dark. Both the bake and the per-figure shade table read the
// same falloff so the figures agree with the ground they stand on.
/** lamp head position, in field cells */
export const LIGHT_COL = 55.0;
export const LIGHT_ROW = -1.5;
/** inverse-square knee, in columns */
const LIGHT_K = 22;

/** 0..1 brightness at a column. Monotone from the west edge to the lamp. */
export function lightFalloff(col: number): number {
  const d = LIGHT_COL - col;
  if (d <= 0) return 1;
  const q = d / LIGHT_K;
  return 1 / (1 + q * q);
}

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
  private grain: HTMLCanvasElement | null = null;

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

    // --- trodden ruts ------------------------------------------------------
    // No lane stripes: 16 lanes must read as ground, not as a spreadsheet.
    // Four ruts worn east-west by the horde, at rows that deliberately do not
    // line up with lane edges, each a chain of soft dark smears.
    const RUT_ROWS = [2.6, 6.35, 10.1, 13.7];
    cx.fillStyle = '#1b231f';
    for (let q = 0; q < RUT_ROWS.length; q++) {
      let x = -g.cw * 2;
      let drift = 0;
      while (x < xOf(g.cols - 8)) {
        const len = g.cw * (2.5 + rng.next() * 4);
        drift += (rng.next() - 0.5) * g.ch * 0.16;
        if (drift > g.ch * 0.35) drift = g.ch * 0.35;
        if (drift < -g.ch * 0.35) drift = -g.ch * 0.35;
        const y = yOf(RUT_ROWS[q]) + drift;
        cx.globalAlpha = 0.10 + rng.next() * 0.12;
        cx.beginPath();
        cx.ellipse(x + len * 0.5, y, len * 0.6, g.ch * (0.10 + rng.next() * 0.10), 0, 0, Math.PI * 2);
        cx.fill();
        x += len * 0.8;
      }
    }
    cx.globalAlpha = 1;
    // and the wider path worn down the middle, where most of the horde walks
    cx.globalAlpha = 0.08;
    cx.fillStyle = '#4b4436';
    for (let p = 0; p < 70; p++) {
      const r = 3 + rng.next() * (g.rows - 6);
      const x = rng.next() * xOf(g.cols - 8);
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

    // --- east set: a strip of paving, the house, the floodlight post -------
    this.bakeEast(cx, g, rng, xOf, yOf, yHor);

    // --- ground contact shadow under the wall ------------------------------
    // The lamp is east of the heap, so the heap throws its shadow west.
    const wall = xOf(50.2);
    const wshade = cx.createLinearGradient(wall - g.cw * 4.5, 0, wall, 0);
    wshade.addColorStop(0, 'rgba(0,0,0,0)');
    wshade.addColorStop(1, 'rgba(0,0,0,0.42)');
    cx.fillStyle = wshade;
    cx.fillRect(wall - g.cw * 4.5, yHor, g.cw * 4.5, g.h - yHor);

    this.bakeLight(cx, g, xOf, yOf, yHor);
  }

  /**
   * The floodlight. Three passes, all baked:
   *  1. a westward darkening wash driven by `lightFalloff`, so the spawn edge
   *     goes near-black and the ground brightens toward the wall;
   *  2. a warm wedge from the lamp head fanning west over the ground;
   *  3. a soft glow around the lamp head itself, spilling onto the sky.
   * Sky and treeline get half the wash: night is dark everywhere, the lamp
   * only makes the ground legible.
   */
  private bakeLight(
    cx: CanvasRenderingContext2D, g: SceneGeo,
    xOf: (c: number) => number, yOf: (r: number) => number, yHor: number,
  ): void {
    const lx = xOf(LIGHT_COL);
    const ly = yOf(LIGHT_ROW);

    // 1. the wash. Alpha at each column = (1 - falloff) * strength.
    const wash = (strength: number, y0: number, y1: number) => {
      const grad = cx.createLinearGradient(xOf(-2), 0, xOf(LIGHT_COL), 0);
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const col = -2 + (LIGHT_COL + 2) * (i / steps);
        const a = (1 - lightFalloff(col)) * strength;
        grad.addColorStop(i / steps, `rgba(4,6,10,${a.toFixed(3)})`);
      }
      // a linear gradient extends its first stop to the west margin, so one
      // rect covers everything west of the lamp
      cx.fillStyle = grad;
      cx.fillRect(0, y0, xOf(LIGHT_COL), y1 - y0);
    };
    wash(0.86, yHor - 1, g.h);   // ground
    wash(0.45, 0, yHor);          // sky + treeline

    // 2. the wedge: lamp head -> far west, top of field to below the field
    const farX = xOf(-4);
    const wedge = cx.createLinearGradient(lx, 0, xOf(10), 0);
    wedge.addColorStop(0, 'rgba(205,178,119,0.22)');
    wedge.addColorStop(0.35, 'rgba(205,178,119,0.10)');
    wedge.addColorStop(1, 'rgba(205,178,119,0)');
    cx.fillStyle = wedge;
    cx.beginPath();
    cx.moveTo(lx, ly);
    cx.lineTo(farX, yOf(-0.5));
    cx.lineTo(farX, yOf(g.rows + BAND_BOTTOM + 1));
    cx.lineTo(lx, yOf(g.rows + BAND_BOTTOM + 1));
    cx.closePath();
    cx.fill();

    // 3. the lamp head glow
    const r = g.ch * 5.5;
    const glow = cx.createRadialGradient(lx, ly, 0, lx, ly, r);
    glow.addColorStop(0, 'rgba(242,230,190,0.55)');
    glow.addColorStop(0.18, 'rgba(242,230,190,0.22)');
    glow.addColorStop(1, 'rgba(242,230,190,0)');
    cx.fillStyle = glow;
    cx.fillRect(lx - r, ly - r, r * 2, r * 2);
    // the head itself: a small bright rectangle on the west face of the post
    cx.fillStyle = PALETTE.light;
    cx.fillRect(lx - g.cw * 0.55, ly - g.ch * 0.16, g.cw * 0.7, g.ch * 0.32);
  }

  /**
   * East of the heap. The camera looks north, the horde comes from the west,
   * so the house the survivor is defending is a facade filling the east edge
   * top to bottom. In front of it: a strip of cracked paving, the pallet he
   * stands on, and the post that carries the floodlight.
   */
  private bakeEast(
    cx: CanvasRenderingContext2D, g: SceneGeo, rng: Rng,
    xOf: (c: number) => number, yOf: (r: number) => number, yHor: number,
  ): void {
    // paving strip, cols 54.6 .. HOUSE_COL
    const px0 = xOf(PAVING_COL);
    const hx = xOf(HOUSE_COL);
    cx.fillStyle = PALETTE.paving;
    cx.fillRect(px0, yHor + g.ch * 0.2, hx - px0, g.h - yHor);
    cx.globalAlpha = 0.35;
    cx.fillStyle = '#2b2e33';
    for (let s = 0; s < 90; s++) {
      const x = px0 + rng.next() * (hx - px0);
      const y = yHor + rng.next() * (g.h - yHor);
      cx.fillRect(x, y, g.cw * 0.16, g.ch * 0.06);
    }
    cx.globalAlpha = 1;
    cx.strokeStyle = 'rgba(0,0,0,0.30)';
    cx.lineWidth = Math.max(1, g.ch * 0.04);
    cx.beginPath();
    for (let r = -1; r <= g.rows + BAND_BOTTOM; r += 3) { cx.moveTo(px0, yOf(r)); cx.lineTo(hx, yOf(r)); }
    cx.stroke();

    // the house: clapboard facade, top to bottom
    cx.fillStyle = PALETTE.houseWall;
    cx.fillRect(hx, 0, g.w - hx + 2, g.h);
    cx.fillStyle = PALETTE.houseWallDark;
    const board = g.ch * 0.5;
    for (let y = -board * 0.5; y < g.h; y += board) cx.fillRect(hx, y, g.w - hx + 2, Math.max(1, g.ch * 0.05));
    // corner trim, catching a little lamp light
    cx.fillStyle = '#2a2e37';
    cx.fillRect(hx, 0, Math.max(1, g.cw * 0.35), g.h);
    // one lit window, rows -2..0.5, boarded on the lower half
    const wx = xOf(HOUSE_COL + 1.1);
    const wy = yOf(-2.0);
    const ww = g.cw * 1.9;
    const wh = g.ch * 2.5;
    const glow = cx.createRadialGradient(wx + ww * 0.5, wy + wh * 0.5, 0, wx + ww * 0.5, wy + wh * 0.5, g.ch * 4);
    glow.addColorStop(0, 'rgba(217,178,92,0.30)');
    glow.addColorStop(1, 'rgba(217,178,92,0)');
    cx.fillStyle = glow;
    cx.fillRect(wx - g.ch * 4, wy - g.ch * 4, ww + g.ch * 8, wh + g.ch * 8);
    cx.fillStyle = PALETTE.window;
    cx.fillRect(wx, wy, ww, wh);
    cx.fillStyle = '#0f1014';
    cx.fillRect(wx + ww * 0.47, wy, Math.max(1, ww * 0.06), wh);          // mullion
    cx.fillRect(wx, wy + wh * 0.45, ww, Math.max(1, wh * 0.05));
    cx.fillStyle = PALETTE.timberShadow;                                    // boards nailed over the bottom
    cx.fillRect(wx - ww * 0.1, wy + wh * 0.58, ww * 1.2, wh * 0.16);
    cx.fillRect(wx - ww * 0.05, wy + wh * 0.80, ww * 1.15, wh * 0.14);
    cx.strokeStyle = '#0f1014';
    cx.lineWidth = Math.max(1, g.ch * 0.06);
    cx.strokeRect(wx, wy, ww, wh);

    // the pallet the survivor stands on: two courses of slats
    const palX = xOf(54.7);
    const palW = g.cw * 2.1;
    const palY = yOf(12.2);
    cx.fillStyle = PALETTE.timberShadow;
    cx.fillRect(palX, palY - g.ch * 0.30, palW, g.ch * 0.30);
    cx.fillStyle = PALETTE.timber;
    cx.fillRect(palX, palY - g.ch * 0.30, palW, Math.max(1, g.ch * 0.08));
    cx.fillRect(palX + palW * 0.08, palY - g.ch * 0.14, palW * 0.84, Math.max(1, g.ch * 0.06));
    cx.fillStyle = 'rgba(0,0,0,0.35)';
    cx.fillRect(palX - g.cw * 0.2, palY - g.ch * 0.04, palW + g.cw * 0.4, g.ch * 0.10);

    // the floodlight post: from the paving up past the field, arm reaching west
    const postX = xOf(POST_COL);
    const postW = Math.max(2, g.cw * 0.28);
    const postTop = yOf(LIGHT_ROW) - g.ch * 0.6;
    cx.fillStyle = '#20232a';
    cx.fillRect(postX - postW * 0.5, postTop, postW, yOf(g.rows - 1.2) - postTop);
    cx.fillStyle = '#3a3f49';
    cx.fillRect(postX - postW * 0.5, postTop, Math.max(1, postW * 0.35), yOf(g.rows - 1.2) - postTop);
    // arm to the lamp head
    cx.fillStyle = '#20232a';
    cx.fillRect(xOf(LIGHT_COL) - g.cw * 0.2, yOf(LIGHT_ROW) - g.ch * 0.45, postX - xOf(LIGHT_COL) + g.cw * 0.2, Math.max(1, g.ch * 0.12));
    // the hood over the lamp head
    cx.fillRect(xOf(LIGHT_COL) - g.cw * 0.9, yOf(LIGHT_ROW) - g.ch * 0.40, g.cw * 1.2, Math.max(1, g.ch * 0.16));
    // ground foot
    cx.fillStyle = 'rgba(0,0,0,0.40)';
    cx.fillRect(postX - g.cw * 0.5, yOf(g.rows - 1.3), g.cw, g.ch * 0.16);
  }

  // --- front -------------------------------------------------------------

  /** 128x128 tile of deterministic per-pixel noise, built once. */
  private grainTile(): HTMLCanvasElement | null {
    if (this.grain) return this.grain;
    const n = 128;
    const [cv, cx] = newCanvas();
    cv.width = n; cv.height = n;
    const img = cx.createImageData(n, n);
    const d = img.data;
    for (let i = 0; i < n * n; i++) {
      const h = hashCell(i & 127, i >> 7, 0x6e);
      const v = (h & 1) ? 235 : 8;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v;
      d[i * 4 + 3] = 10 + (((h >>> 8) & 255) / 255) * 5;   // 0.04..0.06
    }
    if (typeof (cx as { putImageData?: unknown }).putImageData !== 'function') return null;
    cx.putImageData(img, 0, 0);
    this.grain = cv;
    return cv;
  }

  private bakeFront(cx: CanvasRenderingContext2D, g: SceneGeo): void {
    // film grain: a static noise tile, scaled with the cell size so it stays
    // fine-grained on a big display, tiled over the whole frame under the
    // vignette. Alpha 0.04..0.06 — texture, not noise.
    const grain = this.grainTile();
    if (grain) {
      const pat = cx.createPattern(grain, 'repeat');
      if (pat) {
        const k = Math.max(1, Math.round(g.ch / 16));
        cx.save();
        cx.scale(k, k);
        cx.fillStyle = pat;
        cx.fillRect(0, 0, g.w / k + 1, g.h / k + 1);
        cx.restore();
      }
    }

    const r0 = Math.min(g.w, g.h) * 0.30;
    const r1 = Math.max(g.w, g.h) * 0.78;
    const vg = cx.createRadialGradient(g.w * 0.5, g.h * 0.52, r0, g.w * 0.5, g.h * 0.52, r1);
    vg.addColorStop(0, 'rgba(6,9,14,0)');
    vg.addColorStop(0.62, 'rgba(6,9,14,0.32)');
    vg.addColorStop(1, 'rgba(6,9,14,0.74)');
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
