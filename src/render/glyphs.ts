// Phase C — Renderer. Pre-rendered monospace glyph atlas.
//
// Every glyph the field needs is ASCII 32..127, so the whole character set is
// baked once per resize into one offscreen canvas: 96 columns of glyphs by
// N rows of palette colours. The draw loop then does drawImage() blits instead
// of fillText(), which is roughly an order of magnitude cheaper and — more
// importantly — allocates nothing and never touches ctx.font.

export const FONT_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';

export const FIRST_CODE = 32;
export const GLYPH_COUNT = 96; // 32..127

const fontCache = new Map<number, string>();
/** `${px}px ${FONT_STACK}` without building a string every call. */
export function fontString(px: number): string {
  const k = Math.round(px * 4) / 4;
  let s = fontCache.get(k);
  if (s === undefined) { s = k + 'px ' + FONT_STACK; fontCache.set(k, s); }
  return s;
}

export class GlyphAtlas {
  private cv: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  /** glyph cell size in atlas (device) pixels */
  private gw = 0;
  private gh = 0;
  /** glyph cell size in CSS pixels (the blit destination size) */
  private cw = 0;
  private ch = 0;
  private key = '';
  private colors = 0;

  constructor() {
    this.cv = document.createElement('canvas');
    const cx = this.cv.getContext('2d');
    if (!cx) throw new Error('render: 2d context unavailable for glyph atlas');
    this.cx = cx;
  }

  /** Rebuild only when geometry actually changed. */
  build(cw: number, ch: number, dpr: number, fontPx: number, colors: readonly string[]): void {
    const key = cw + '|' + ch + '|' + dpr + '|' + fontPx + '|' + colors.length;
    if (key === this.key) return;
    this.key = key;

    this.cw = cw;
    this.ch = ch;
    this.gw = Math.max(1, Math.ceil(cw * dpr));
    this.gh = Math.max(1, Math.ceil(ch * dpr));
    this.colors = colors.length;

    this.cv.width = this.gw * GLYPH_COUNT;
    this.cv.height = this.gh * colors.length;

    const cx = this.cx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, this.cv.width, this.cv.height);
    cx.font = fontString(fontPx * dpr);
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';

    const halfW = this.gw / 2;
    const halfH = this.gh / 2;
    for (let ci = 0; ci < colors.length; ci++) {
      cx.fillStyle = colors[ci];
      const y = ci * this.gh + halfH;
      for (let g = 0; g < GLYPH_COUNT; g++) {
        const code = FIRST_CODE + g;
        if (code === 32) continue; // space: nothing to bake
        cx.fillText(String.fromCharCode(code), g * this.gw + halfW, y);
      }
    }
    this.decay(cx);
  }

  /**
   * Wear on the letters — the ref sheet's "Monospace Letters (Decaying)". A
   * couple of rust specks and one scratch per glyph, painted `source-atop` so
   * they only ever land on glyph pixels and never dirty the cell around them.
   * Deterministic per (glyph, colour) so the atlas is the same every build.
   * Skipped when the glyph is too small for a speck to be anything but noise.
   */
  private decay(cx: CanvasRenderingContext2D): void {
    if (this.gh < 14) return;
    const gw = this.gw, gh = this.gh;
    const sw = Math.max(1, Math.round(gw * 0.14));
    const sh = Math.max(1, Math.round(gh * 0.05));
    cx.globalCompositeOperation = 'source-atop';
    for (let ci = 1; ci < this.colors; ci++) {
      for (let g = 0; g < GLYPH_COUNT; g++) {
        if (g === 0) continue;
        let h = (g * 0x9e3779b1 ^ ci * 0x85ebca6b) >>> 0;
        for (let k = 0; k < 3; k++) {
          h = (h ^ (h >>> 15)) * 0x2c1b3c6d >>> 0;
          h = (h ^ (h >>> 12)) * 0x297a2d39 >>> 0;
          const x = g * gw + gw * 0.10 + (h & 255) / 255 * gw * 0.80;
          const y = ci * gh + gh * 0.18 + ((h >>> 8) & 255) / 255 * gh * 0.64;
          cx.fillStyle = k < 2 ? 'rgba(90,58,36,0.78)' : 'rgba(13,17,23,0.55)';
          cx.fillRect(x, y, sw, sh);
        }
        if ((h >>> 20 & 7) < 3) {
          cx.fillStyle = 'rgba(13,17,23,0.40)';
          cx.fillRect(g * gw, ci * gh + gh * (0.30 + ((h >>> 24) & 63) / 63 * 0.40), gw, Math.max(1, Math.round(gh * 0.025)));
        }
      }
    }
    cx.globalCompositeOperation = 'source-over';
  }

  /** Blit one glyph. px/py are the cell's top-left in CSS pixels. */
  blit(ctx: CanvasRenderingContext2D, code: number, colorIdx: number, px: number, py: number): void {
    if (code === 32) return;
    const g = code - FIRST_CODE;
    if (g < 0 || g >= GLYPH_COUNT || colorIdx < 0 || colorIdx >= this.colors) return;
    ctx.drawImage(
      this.cv,
      g * this.gw, colorIdx * this.gh, this.gw, this.gh,
      px, py, this.cw, this.ch,
    );
  }
}
