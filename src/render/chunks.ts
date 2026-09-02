// ============================================================================
// Phase C — Renderer. Pre-baked gib-chunk atlas + muzzle-flash sprite.
//
// Gibs are small irregular quads that tumble. Rotating and path-filling a few
// hundred of them per frame would be far too expensive, so every shape is baked
// once per resize at every rotation and tone, and the draw loop issues a single
// drawImage per particle — exactly like the glyph atlas.
// ============================================================================

export const CHUNK_SHAPES = 6;
export const CHUNK_ROTS = 8;

/** Cap the baked chunk texture (~4M device px). */
const MAX_CHUNK_PX = 4_000_000;

function h32(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export class ChunkAtlas {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private tile = 0;
  private tones = 0;
  private key = '';

  constructor() {
    this.cv = document.createElement('canvas');
    const cx = this.cv.getContext('2d');
    if (!cx) throw new Error('render: 2d context unavailable for chunk atlas');
    this.cx = cx;
  }

  build(cellH: number, dpr: number, tones: readonly string[]): void {
    const want = Math.max(4, Math.round(cellH * 0.9 * dpr));
    const cols = CHUNK_SHAPES * CHUNK_ROTS;
    const budget = Math.sqrt(MAX_CHUNK_PX / Math.max(1, cols * tones.length));
    const tile = Math.max(4, Math.min(want, Math.floor(budget)));
    const key = tile + '|' + tones.length;
    if (key === this.key) return;
    this.key = key;
    this.tile = tile;
    this.tones = tones.length;

    this.cv.width = cols * tile;
    this.cv.height = tones.length * tile;

    const cx = this.cx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, this.cv.width, this.cv.height);
    cx.lineJoin = 'round';

    const half = tile / 2;
    const verts = 5;
    const rx = new Float64Array(verts);
    const ry = new Float64Array(verts);

    for (let t = 0; t < tones.length; t++) {
      for (let s = 0; s < CHUNK_SHAPES; s++) {
        // deterministic lumpy polygon in unit space
        for (let v = 0; v < verts; v++) {
          const hh = h32(s * 31 + v, 0x9e37);
          const rad = 0.30 + ((hh & 255) / 255) * 0.20;
          const ang = (v / verts) * Math.PI * 2 + (((hh >>> 8) & 255) / 255 - 0.5) * 0.5;
          rx[v] = Math.cos(ang) * rad;
          ry[v] = Math.sin(ang) * rad;
        }
        for (let r = 0; r < CHUNK_ROTS; r++) {
          const a = (r / CHUNK_ROTS) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const ox = (s * CHUNK_ROTS + r) * tile + half;
          const oy = t * tile + half;
          cx.beginPath();
          for (let v = 0; v < verts; v++) {
            const px = ox + (rx[v] * ca - ry[v] * sa) * tile;
            const py = oy + (rx[v] * sa + ry[v] * ca) * tile;
            if (v === 0) cx.moveTo(px, py); else cx.lineTo(px, py);
          }
          cx.closePath();
          cx.fillStyle = tones[t];
          cx.fill();
          cx.strokeStyle = 'rgba(0,0,0,0.45)';
          cx.lineWidth = Math.max(1, tile * 0.06);
          cx.stroke();
        }
      }
    }
  }

  /** px/py is the CENTRE. size is the drawn edge length in CSS px. */
  blit(
    ctx: CanvasRenderingContext2D,
    shape: number, rot: number, tone: number,
    px: number, py: number, size: number,
  ): void {
    if (this.tile === 0 || size <= 0) return;
    let s = shape % CHUNK_SHAPES; if (s < 0) s += CHUNK_SHAPES;
    let r = rot % CHUNK_ROTS; if (r < 0) r += CHUNK_ROTS;
    let t = tone; if (t < 0) t = 0; else if (t >= this.tones) t = this.tones - 1;
    const half = size * 0.5;
    ctx.drawImage(
      this.cv,
      (s * CHUNK_ROTS + r) * this.tile, t * this.tile, this.tile, this.tile,
      px - half, py - half, size, size,
    );
  }
}

/** Soft radial muzzle flash, baked once per resize. */
export class FlashSprite {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private size = 0;

  constructor() {
    this.cv = document.createElement('canvas');
    const cx = this.cv.getContext('2d');
    if (!cx) throw new Error('render: 2d context unavailable for flash sprite');
    this.cx = cx;
  }

  build(px: number, core: string, edge: string): void {
    const s = Math.max(8, Math.min(512, Math.round(px)));
    if (s === this.size) return;
    this.size = s;
    this.cv.width = s;
    this.cv.height = s;
    const cx = this.cx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, s, s);
    const g = cx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, core);
    g.addColorStop(0.32, edge);
    g.addColorStop(1, 'rgba(255,144,32,0)');
    cx.fillStyle = g;
    cx.fillRect(0, 0, s, s);
    // four-point star spikes so it reads as a flash, not a blob
    cx.globalCompositeOperation = 'lighter';
    cx.fillStyle = core;
    cx.globalAlpha = 0.55;
    cx.fillRect(0, s / 2 - s * 0.02, s, s * 0.04);
    cx.fillRect(s / 2 - s * 0.02, s * 0.16, s * 0.04, s * 0.68);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = 'source-over';
  }

  /** px/py is the CENTRE. */
  blit(ctx: CanvasRenderingContext2D, px: number, py: number, size: number): void {
    if (this.size === 0 || size <= 0) return;
    const half = size * 0.5;
    ctx.drawImage(this.cv, px - half, py - half, size, size);
  }
}
