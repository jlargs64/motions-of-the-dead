// ============================================================================
// Phase C — Renderer + FX. The only entry point other phases import.
//
// Art direction: *The Last Stand* (Con Artist Games, 2007). A wide nocturnal
// exterior. Slate sky, black conifer treeline, dishwater fog on the horizon,
// cold blue-green grass trodden with dried blood. A filthy timber barricade
// stands vertically at column 52; the survivor holds the paving behind it and
// aims left, downrange, at wherever your cursor is. The horde shambles in from
// column 0 — each zombie is a small figure with its word floating above its
// head like a nametag. You kill by editing the words.
//
// The renderer is strictly downstream: it reads GameState and subscribes to the
// bus. It never imports the sim and never mutates state.
//
// Performance contract: the draw loop allocates nothing. The static scene is
// baked once per resize and blitted as one drawImage. Glyphs come from a
// pre-baked atlas, gibs from a pre-baked chunk atlas, particles live in a fixed
// struct-of-arrays pool, HUD strings are rebuilt only when their values change,
// and every rgba() string is pre-baked in palette.ts.
// ============================================================================
import type { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import type { Zombie } from '../core/types';
import { BARRICADE_COL, COLS, FIELD_COLS, ROWS, barricadeGlyphs } from '../core/field';
import { Rng } from '../core/rng';
import { ATLAS_COLORS, C, CHUNK_TONES, PALETTE, RGBA, T } from './palette';
import { GlyphAtlas, fontString } from './glyphs';
import { ChunkAtlas, CHUNK_ROTS, CHUNK_SHAPES, FlashSprite } from './chunks';
import { K_CHUNK, K_GLYPH, P_BLEEDS, P_GHOST, P_STICK, Particles } from './particles';
import {
  BAND_BOTTOM, BAND_TOP, GoreLayer, Scene,
} from './scene';
import type { SceneGeo } from './scene';
import {
  drawSurvivor, drawZombie, figureHeightCells, figureKind, F_RUNNER,
} from './figures';
import {
  Fx, hash3, LANE_FLASH_MS, LANE_FLASH_WHITE_MS, MUZZLE_MS, OVERKILL_MS,
  SHOT_MS, SWEEP_MS, TRACER_MS,
} from './fx';

export { PALETTE } from './palette';

export type GoreLevel = 'off' | 'low' | 'full';

export interface Metrics {
  cw: number; ch: number; ox: number; oy: number;
  cols: number; rows: number; scale: number;
}

// --- layout ------------------------------------------------------------------
const TOTAL_ROWS = ROWS + BAND_TOP + BAND_BOTTOM;   // 26
const GUTTER_SCRIM = 'rgba(13, 17, 23, 0.62)';
/** width : height of one cell. Wider than a terminal — this is a scene. */
const CELL_ASPECT = 0.58;
const MAX_DPR = 2;
/** Cap on the baked glyph atlas (~32MB of texture). */
const MAX_ATLAS_PX = 8_000_000;
/** deterministic seed for the scene bake; identical every run */
const SCENE_SEED = 0xb10d5ce7;

/** the barricade occupies these columns, in cell units */
const WALL_X0 = 51.85;
const WALL_X1 = 54.15;
/** the survivor */
const SURV_COL = 56.0;
const SURV_FEET_ROW = 11.7;

/** a figure's head top sits this far below its word row, in cells */
const FIG_HEAD_GAP = 1.05;

// --- feel --------------------------------------------------------------------
/** words start jittering this many columns from the wall */
const FLICKER_DIST = 8;
const FLICKER_THR = new Uint8Array([4, 7, 11, 16, 22, 30, 40, 52]); // /128
const NOISE = '%#@$&*?!';
const NOISE_CODES = new Uint16Array(NOISE.length);
for (let i = 0; i < NOISE.length; i++) NOISE_CODES[i] = NOISE.charCodeAt(i);

const GRAVITY = 46;        // cells / s^2
const SHAKE_UNIT = 0.07;   // cell-heights per unit of Fx.shake
const CRAWLER_ALPHA = 0.78;
const COMBO_SCALE_CAP = 2.4;
const GAIT_MS = 140;

/** barricade condition per lane: 4 = intact, 0 = breach */
const WALL_LEVEL_OF = new Uint8Array(128);
WALL_LEVEL_OF[35] = 4;  // '#'
WALL_LEVEL_OF[61] = 3;  // '='
WALL_LEVEL_OF[45] = 2;  // '-'
WALL_LEVEL_OF[46] = 1;  // '.'
WALL_LEVEL_OF[32] = 0;  // ' '
const PLANK_FRAC = new Float32Array([0, 0.34, 0.60, 0.84, 1.0]);

// bracket / quote char codes, compared numerically so nothing is allocated
function isOpenCode(c: number): boolean {
  return c === 40 || c === 91 || c === 123 || c === 34 || c === 39;
}
function isCloseCode(c: number): boolean {
  return c === 41 || c === 93 || c === 125 || c === 34 || c === 39;
}

/** 1-char string table so the fillText fallback never allocates. */
const CHARS: string[] = new Array(128);
for (let i = 0; i < 128; i++) CHARS[i] = String.fromCharCode(i);

interface ZPos {
  row: number; col: number; len: number; kindIdx: number;
  text: string; seen: number;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;

  /** Set by main.ts each frame before drawGame(); Vim's showcmd string. */
  pendingCmd = '';
  /** 'off' removes every drop of blood and every chunk. Default 'full'. */
  gore: GoreLevel = 'full';
  /** Vim's `nu` / `rnu`. The gutter is 1-based, so `7G` lands on the lane marked 7. */
  lineNumbers: 'off' | 'absolute' | 'relative' = 'relative';
  /** the UI layer draws the pause card; the renderer just dims behind it */
  paused = false;
  /** renders the speaker-off indicator in the HUD */
  muted = false;

  private canvas: HTMLCanvasElement;
  private atlas = new GlyphAtlas();
  private chunks = new ChunkAtlas();
  private flash = new FlashSprite();
  private particles = new Particles();
  private fx = new Fx();
  private rng = new Rng(0x5eed1e);
  private scene = new Scene();
  private goreLayer = new GoreLayer(COLS, ROWS);

  private m: Metrics = { cw: 8, ch: 16, ox: 0, oy: 0, cols: COLS, rows: ROWS, scale: 1 };
  private geo: SceneGeo = { w: 1, h: 1, cw: 8, ch: 16, ox: 0, oy: 0, cols: COLS, rows: ROWS };
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private fontPx = 12;
  private sceneDirty = true;
  private bakedGoreOff = false;
  private vignetteGrad: CanvasGradient | null = null;
  private vignetteSafe: CanvasGradient | null = null;

  private now = 0;
  private frame = 0;

  /** last-known positions of every live zombie, so kill events (which carry no
   *  position) can spawn gore in the right place. Pooled; never rebuilt. */
  private zpos = new Map<number, ZPos>();
  private zfree: ZPos[] = [];
  private pruneFn: (v: ZPos, k: number) => void;

  /** persistent caked blood on the wall, per lane; survives the whole run */
  private wallGore = new Float32Array(ROWS);
  private landFn: (col: number, row: number, amount: number) => void;

  private lastCursorRow = 0;
  private frontLane = ROWS - 1;
  private gunX = 0;
  private gunY = 0;
  private aimOut = new Float64Array(2);

  // cached strings — rebuilt only when an underlying value changes
  private hpStr = '0';
  private chargeStr = '';
  private waveStr = '';
  private comboStr = '';
  private hHp = -1; private hDd = -1; private hD = -1;
  private hWave = -1; private hCombo = -1;
  private wallGlyphs = '';
  private wallHp = -1;
  private lastPanelPaper = false;

  constructor(canvas: HTMLCanvasElement, bus: Bus) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('render: could not acquire a 2d context');
    this.ctx = ctx;

    this.pruneFn = (v, k) => {
      if (v.seen !== this.frame) { this.zfree.push(v); this.zpos.delete(k); }
    };
    this.landFn = (col, row, amount) => {
      if (this.gore === 'off') return;
      const amt = this.gore === 'low' ? amount * 0.35 : amount;
      this.goreLayer.add(col, row, amt);
      if (col >= 49 && row >= 0 && row < ROWS) {
        const v = this.wallGore[row] + amt * 0.5;
        this.wallGore[row] = v > 1 ? 1 : v;
      }
    };

    bus.on('kill', (e) => {
      const zp = this.zpos.get(e.zombieId);
      const len = zp ? zp.len : 4;
      this.fx.addShake(1.0 + Math.min(len, 12) * 0.45);
      if (e.overkill) { this.fx.flashWhite(0.40); this.fx.stampOverkill(); }
      const splash = e.kind === 'bloater' &&
        (e.via.indexOf('dd') >= 0 || e.via.indexOf('D') >= 0);
      if (splash) {
        this.fx.detonateLane(zp ? zp.row : this.lastCursorRow);
        this.fx.addShake(8);
      }
      if (zp) this.burst(zp, splash, this.hCombo);
    });

    bus.on('combo', () => { this.fx.popCombo(); });
    bus.on('combo_break', () => { this.shatterCombo(); });

    bus.on('shot', (e) => {
      this.fx.addShot(e.row, e.colStart, e.colEnd, e.hits);
      this.fx.addShake(0.5 + Math.min(e.hits, 6) * 0.3);
    });

    bus.on('barricade_hit', (e) => {
      this.fx.pulseVignette(1);
      if (this.gore !== 'off') this.fx.flashRed(0.14);
      this.fx.addShake(1.5 + Math.min(e.dmg, 20) * 0.25);
      const lane = this.frontLane;
      if (this.gore !== 'off') {
        this.goreLayer.add(51, lane, 0.5);
        this.goreLayer.add(50, lane, 0.3);
        const v = this.wallGore[lane] + 0.18;
        this.wallGore[lane] = v > 1 ? 1 : v;
      }
    });

    bus.on('charge_used', () => {
      this.fx.detonateLane(this.lastCursorRow);
      this.fx.addShake(8);
      this.fx.flashWhite(0.28);
    });

    bus.on('wave_start', () => { this.fx.sweep(); });

    bus.on('death', () => {
      if (this.gore === 'off') this.fx.flashWhite(0.7);
      else this.fx.flashRed(0.8);
      this.fx.addShake(12);
    });

    this.resize();
  }

  // -- geometry --------------------------------------------------------------

  resize(): void {
    const cv = this.canvas;
    const vw = Math.max(1, cv.clientWidth || window.innerWidth || 1);
    const vh = Math.max(1, cv.clientHeight || window.innerHeight || 1);
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

    let ch = Math.floor(vh / TOTAL_ROWS);
    let cw = Math.floor(ch * CELL_ASPECT);
    if (cw * COLS > vw) {
      cw = Math.floor(vw / COLS);
      ch = Math.floor(cw / CELL_ASPECT);
    }
    if (cw < 3) cw = 3;
    if (ch < 6) ch = 6;

    const m = this.m;
    m.cw = cw;
    m.ch = ch;
    m.cols = COLS;
    m.rows = ROWS;
    m.scale = ch / 16;
    m.ox = Math.floor((vw - cw * COLS) / 2);
    m.oy = Math.floor((vh - ch * TOTAL_ROWS) / 2) + BAND_TOP * ch;

    this.cssW = vw;
    this.cssH = vh;
    const pw = Math.round(vw * this.dpr);
    const ph = Math.round(vh * this.dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;

    // font size that fits the cell both ways (0.62 is the widest advance ratio
    // across the fallback stack)
    this.fontPx = Math.max(5, Math.min(Math.round(ch * 0.80), Math.round(cw / 0.62)));
    const basePx = 96 * cw * ATLAS_COLORS.length * ch;
    const atlasDpr = Math.min(this.dpr, Math.sqrt(MAX_ATLAS_PX / basePx));
    this.atlas.build(cw, ch, atlasDpr, this.fontPx, ATLAS_COLORS);
    this.chunks.build(ch, this.dpr, CHUNK_TONES);
    this.flash.build(ch * 5 * this.dpr, PALETTE.flashCore, PALETTE.flashEdge);

    const g = this.geo;
    g.w = vw; g.h = vh; g.cw = cw; g.ch = ch; g.ox = m.ox; g.oy = m.oy;
    g.cols = COLS; g.rows = ROWS;
    this.sceneDirty = true;
    this.goreLayer.rebuild(g, this.dpr);

    const vg = this.ctx.createRadialGradient(
      vw / 2, vh / 2, Math.min(vw, vh) * 0.30,
      vw / 2, vh / 2, Math.max(vw, vh) * 0.62,
    );
    vg.addColorStop(0, 'rgba(138,15,15,0)');
    vg.addColorStop(1, 'rgba(138,15,15,0.85)');
    this.vignetteGrad = vg;

    const sg = this.ctx.createRadialGradient(
      vw / 2, vh / 2, Math.min(vw, vh) * 0.30,
      vw / 2, vh / 2, Math.max(vw, vh) * 0.62,
    );
    sg.addColorStop(0, 'rgba(43,52,70,0)');
    sg.addColorStop(1, 'rgba(43,52,70,0.85)');
    this.vignetteSafe = sg;
  }

  metrics(): Metrics { return this.m; }

  // -- frame -----------------------------------------------------------------

  beginFrame(dtMs: number): void {
    const dt = dtMs > 100 ? 100 : dtMs; // clamp tab-switch spikes
    this.now += dt;
    this.frame++;

    const goreOff = this.gore === 'off';
    if (goreOff !== this.bakedGoreOff) { this.bakedGoreOff = goreOff; this.sceneDirty = true; }
    if (this.sceneDirty) {
      this.sceneDirty = false;
      this.scene.bake(this.geo, this.dpr, SCENE_SEED, goreOff);
    }

    this.fx.update(dt);
    this.particles.update(dt / 1000, GRAVITY, COLS - 1, ROWS + 1, this.landFn);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.save();

    const s = this.fx.shake;
    if (s > 0) {
      const h = hash3(this.frame, 0x51, 0x9d);
      const amp = s * this.m.ch * SHAKE_UNIT;
      const dx = (((h & 1023) / 511.5) - 1) * amp;
      const dy = ((((h >>> 10) & 1023) / 511.5) - 1) * amp;
      ctx.translate(Math.round(dx), Math.round(dy));
    }

    this.scene.blitBack(ctx, 0, 0, this.cssW, this.cssH);
  }

  endFrame(): void {
    this.ctx.globalAlpha = 1;
    this.ctx.restore();
  }

  // -- the field -------------------------------------------------------------

  drawGame(state: GameState): void {
    this.lastCursorRow = state.cursor.row;
    const zs = state.buffer.zombies;
    this.indexZombies(zs);

    if (this.gore !== 'off') this.goreLayer.blit(this.ctx);
    this.drawBarricade(state);
    this.drawFigures(zs, state.sim.time);
    this.drawWords(zs);
    this.drawSurvivorAndGun(state);
    this.drawShots();
    this.drawParticles();
    this.drawCursor(state);
    this.drawFieldFx(state);

    // the vignette + letterbox never shake: they belong to the camera
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scene.blitFront(ctx, 0, 0, this.cssW, this.cssH);
    ctx.restore();

    if (this.paused) {
      this.overlayRaw(RGBA.pauseWash);
      this.overlayRaw(RGBA.pauseInk);
    }

    this.drawGutter(state);
    this.drawHud(state);
    this.showcmd(this.pendingCmd);
    this.drawOverkill();
  }

  private indexZombies(zs: readonly Zombie[]): void {
    const map = this.zpos;
    let front = -1;
    let frontLane = this.frontLane;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      let p = map.get(z.id);
      if (p === undefined) {
        p = this.zfree.pop() ?? { row: 0, col: 0, len: 0, kindIdx: 0, text: '', seen: 0 };
        map.set(z.id, p);
      }
      p.row = z.row; p.col = z.col; p.text = z.text; p.len = z.text.length;
      p.kindIdx = figureKind(z.kind, z.text.length);
      p.seen = this.frame;
      const nose = z.col + z.text.length;
      if (nose > front && z.row >= 0 && z.row < ROWS) { front = nose; frontLane = z.row; }
    }
    this.frontLane = frontLane;
    // stale entries are recycled lazily; a kill resolves against the frame that
    // last saw the zombie, so pruning must lag by at least one frame
    if ((this.frame & 63) === 0) map.forEach(this.pruneFn);
  }

  // -- the horde -------------------------------------------------------------

  /** Figures first, lane by lane, so nearer lanes overlap farther ones. */
  private drawFigures(zs: readonly Zombie[], simTime: number): void {
    const ctx = this.ctx;
    const m = this.m;
    const bloody = this.gore !== 'off';
    const tick = (simTime / GAIT_MS) | 0;
    for (let r = 0; r < ROWS; r++) {
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.row !== r) continue;
        const n = z.text.length;
        if (z.col + n <= 0 || z.col >= FIELD_COLS) continue;
        const k = figureKind(z.kind, n);
        const cxp = m.ox + (z.col + n * 0.5) * m.cw;
        const feetY = m.oy + (r + FIG_HEAD_GAP + figureHeightCells(k)) * m.ch;
        const dist = BARRICADE_COL - (z.col + n);
        const twitch = dist >= FLICKER_DIST ? 0 : (FLICKER_DIST - dist) / FLICKER_DIST;
        const rate = k === F_RUNNER ? 2 : 1;          // runners shamble faster
        const step = (tick * rate + z.id * 3) & 3;
        const h = hash3(z.id, this.frame >> 1, 0x2b);
        const jitter = ((h & 255) / 127.5) - 1;
        drawZombie(ctx, cxp, feetY, m.ch, k, step, twitch, jitter, bloody);
      }
    }
  }

  /** Words last, on their scrim, so they are always the crispest thing here.
   *  Two passes — every scrim, then every glyph — so a neighbouring word's
   *  scrim can never be painted over this word's letters. */
  private drawWords(zs: readonly Zombie[]): void {
    const ctx = this.ctx;
    const m = this.m;
    const group = (this.frame / 3) | 0;

    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.row < 0 || z.row >= ROWS) continue;
      const n = z.text.length;
      const c0 = z.col < 0 ? 0 : z.col;
      const c1 = Math.min(FIELD_COLS, z.col + n);
      if (c1 <= c0) continue;
      const heavy = z.kind === 'bloater' || n >= 8;
      const y = m.oy + z.row * m.ch;
      const x0 = m.ox + c0 * m.cw;
      const w = (c1 - c0) * m.cw;
      this.pill(x0 - m.cw * 0.55, y - m.ch * 0.06, w + m.cw * 1.1, m.ch * 1.02,
        m.ch * 0.28, RGBA.scrimSoft);
      this.pill(x0 - m.cw * 0.26, y + m.ch * 0.05, w + m.cw * 0.52, m.ch * 0.82,
        m.ch * 0.22, heavy ? RGBA.scrimBloater : RGBA.scrim);
    }

    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.row < 0 || z.row >= ROWS) continue;
      const t = z.text;
      const n = t.length;
      if (z.col + n <= 0 || z.col >= FIELD_COLS) continue;

      const heavy = z.kind === 'bloater' || n >= 8;
      const y = m.oy + z.row * m.ch;
      const base = heavy ? C.SICK_DARK : C.BONE;
      const dim = z.kind === 'crawler' || n <= 1;
      if (dim) ctx.globalAlpha = CRAWLER_ALPHA;

      const dist = BARRICADE_COL - (z.col + n);
      const thr = dist >= FLICKER_DIST ? 0
        : FLICKER_THR[Math.min(FLICKER_THR.length - 1, FLICKER_DIST - 1 - Math.max(0, dist))];

      for (let k = 0; k < n; k++) {
        const col = z.col + k;
        if (col < 0 || col >= FIELD_COLS) continue;
        let code = t.charCodeAt(k);
        let slot: number = base;
        if (z.kind === 'armored' &&
            ((k === 0 && isOpenCode(code)) || (k === n - 1 && isCloseCode(code)))) {
          slot = C.GREEN;
        }
        if (thr > 0) {
          const h = hash3(z.id, k, group);
          if ((h & 127) < thr) code = NOISE_CODES[(h >>> 7) & 7];
        }
        this.atlas.blit(ctx, code, slot, m.ox + col * m.cw, y);
      }
      if (dim) ctx.globalAlpha = 1;
    }
  }

  /** Chamfered pill from three NON-overlapping fillRects. They must not
   *  overlap: the fill is translucent, and overlapping rects would double the
   *  alpha and print a visible plus-shape under every word. No path, no alloc. */
  private pill(x: number, y: number, w: number, h: number, r: number, style: string): void {
    if (w <= 0 || h <= 0) return;
    const ctx = this.ctx;
    let rr = r;
    if (rr > w * 0.5) rr = w * 0.5;
    if (rr > h * 0.5) rr = h * 0.5;
    ctx.fillStyle = style;
    ctx.fillRect(x, y + rr, w, h - rr * 2);
    ctx.fillRect(x + rr, y, w - rr * 2, rr);
    ctx.fillRect(x + rr, y + h - rr, w - rr * 2, rr);
  }

  // -- the barricade ---------------------------------------------------------

  private drawBarricade(state: GameState): void {
    const m = this.m;
    const ctx = this.ctx;
    const b = state.barricade;
    // barricadeGlyphs() builds a 16-char string, so it is cached on the
    // quantised HP ratio: it only reruns when the wall could actually change.
    const step = b.maxHp > 0 ? Math.round((b.hp / b.maxHp) * 256) : 0;
    if (step !== this.wallHp) { this.wallHp = step; this.wallGlyphs = barricadeGlyphs(b); }
    const g = this.wallGlyphs;

    const x0 = m.ox + WALL_X0 * m.cw;
    const x1 = m.ox + WALL_X1 * m.cw;
    const w = x1 - x0;
    const top = m.oy;

    // the dark behind the wall — every gap opens onto this
    ctx.fillStyle = PALETTE.void_;
    ctx.fillRect(x0, top, w, ROWS * m.ch);

    const shH = Math.max(1, m.ch * 0.14);
    for (let r = 0; r < ROWS; r++) {
      const code = r < g.length ? g.charCodeAt(r) : 32;
      const lvl = code < 128 ? WALL_LEVEL_OF[code] : 4;
      const y = top + r * m.ch;
      if (lvl === 0) {
        // breach: a hole. Splintered plank ends at either side, nothing between.
        ctx.fillStyle = PALETTE.timberShadow;
        ctx.fillRect(x0, y, w * 0.12, m.ch * 0.34);
        ctx.fillRect(x1 - w * 0.10, y + m.ch * 0.5, w * 0.10, m.ch * 0.3);
        ctx.fillStyle = RGBA.breachGlow;
        ctx.fillRect(x0, y, w, m.ch);
        continue;
      }
      const pw = w * PLANK_FRAC[lvl];
      // body + shadow + highlight
      ctx.fillStyle = PALETTE.timber;
      ctx.fillRect(x0, y, pw, m.ch - shH);
      ctx.fillStyle = PALETTE.timberShadow;
      ctx.fillRect(x0, y + m.ch - shH, pw, shH);
      ctx.fillStyle = PALETTE.timberHi;
      ctx.fillRect(x0, y, pw, Math.max(1, m.ch * 0.07));
      // grain
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      const hgr = hash3(r, 7, 3);
      ctx.fillRect(x0 + pw * (0.18 + (hgr & 63) / 512), y + m.ch * 0.42,
        pw * 0.55, Math.max(1, m.ch * 0.04));
      if (lvl < 4) {
        // splintered ragged right edge
        ctx.fillStyle = PALETTE.timber;
        for (let s = 0; s < 3; s++) {
          const hs = hash3(r, s, 11);
          const sy = y + (s + 0.15) * (m.ch / 3.4);
          ctx.fillRect(x0 + pw, sy, w * 0.06 * ((hs & 15) / 15 + 0.3), m.ch * 0.16);
        }
      }
    }

    this.drawPosts(x0, w, top);
    this.drawSandbags(x0, top);
    this.drawWire(x0, x1, top, g);

    // caked blood at the foot of the wall, accumulated across the run
    if (this.gore !== 'off') {
      ctx.fillStyle = PALETTE.bloodDry;
      for (let r = 0; r < ROWS; r++) {
        const v = this.wallGore[r];
        if (v <= 0.01) continue;
        ctx.globalAlpha = Math.min(0.62, v * 0.62);
        ctx.beginPath();
        ctx.ellipse(x0 + w * 0.34, top + (r + 0.72) * m.ch,
          w * 0.55 + m.cw * 0.35, m.ch * (0.20 + v * 0.16), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawPosts(x0: number, w: number, top: number): void {
    const ctx = this.ctx;
    const m = this.m;
    const h = ROWS * m.ch;
    const pw = Math.max(1, m.cw * 0.30);
    for (let p = 0; p < 3; p++) {
      const base = x0 + w * (0.14 + p * 0.34);
      const lean = (p === 1 ? -1 : 1) * m.cw * 0.35;
      for (let r = 0; r < ROWS; r++) {
        const f = r / ROWS;
        const x = base + lean * (1 - f);
        const y = top + r * m.ch;
        ctx.fillStyle = p === 1 ? PALETTE.timberShadow : PALETTE.timber;
        ctx.fillRect(x, y, pw, m.ch);
        ctx.fillStyle = 'rgba(107,93,74,0.35)';
        ctx.fillRect(x, y, Math.max(1, pw * 0.3), m.ch);
      }
      // a nailed cross-brace near the top and bottom
      ctx.fillStyle = PALETTE.timberHi;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(base - m.cw * 0.1, top + h * 0.18, pw * 2.4, Math.max(1, m.ch * 0.08));
      ctx.fillRect(base - m.cw * 0.1, top + h * 0.74, pw * 2.4, Math.max(1, m.ch * 0.08));
      ctx.globalAlpha = 1;
    }
  }

  private drawSandbags(x0: number, top: number): void {
    const ctx = this.ctx;
    const m = this.m;
    ctx.fillStyle = PALETTE.sandbag;
    for (let r = ROWS - 3; r < ROWS; r++) {
      for (let s = 0; s < 2; s++) {
        const h = hash3(r, s, 29);
        const x = x0 - m.cw * (0.75 - s * 0.42) + ((h & 15) / 15 - 0.5) * m.cw * 0.1;
        const y = top + r * m.ch + m.ch * (0.08 + s * 0.42);
        ctx.beginPath();
        ctx.ellipse(x, y + m.ch * 0.22, m.cw * 0.55, m.ch * 0.21, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, m.ch * 0.035);
    ctx.beginPath();
    for (let r = ROWS - 3; r < ROWS; r++) {
      ctx.moveTo(x0 - m.cw * 1.3, top + r * m.ch + m.ch * 0.5);
      ctx.lineTo(x0, top + r * m.ch + m.ch * 0.5);
    }
    ctx.stroke();
  }

  private drawWire(x0: number, x1: number, top: number, glyphs: string): void {
    const ctx = this.ctx;
    const m = this.m;
    ctx.strokeStyle = PALETTE.wire;
    ctx.lineWidth = Math.max(1, m.ch * 0.045);
    ctx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      const x = (r & 1) === 0 ? x0 + (x1 - x0) * 0.18 : x1 - (x1 - x0) * 0.14;
      const y = top + r * m.ch;
      if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // barbs at each vertex, skipped where the wall is gone
    ctx.strokeStyle = RGBA.wireGlint;
    ctx.lineWidth = Math.max(1, m.ch * 0.03);
    ctx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      const code = r < glyphs.length ? glyphs.charCodeAt(r) : 32;
      if (r < ROWS && code < 128 && WALL_LEVEL_OF[code] === 0) continue;
      const x = (r & 1) === 0 ? x0 + (x1 - x0) * 0.18 : x1 - (x1 - x0) * 0.14;
      const y = top + r * m.ch;
      const b = m.ch * 0.13;
      ctx.moveTo(x - b, y - b); ctx.lineTo(x + b, y + b);
      ctx.moveTo(x + b, y - b); ctx.lineTo(x - b, y + b);
    }
    ctx.stroke();
  }

  // -- the survivor ----------------------------------------------------------

  private drawSurvivorAndGun(state: GameState): void {
    const m = this.m;
    const ctx = this.ctx;
    const cxp = m.ox + SURV_COL * m.cw;
    const feetY = m.oy + SURV_FEET_ROW * m.ch;
    const cr = state.cursor.row;
    const cc = state.cursor.col;
    const aimX = m.ox + (cc + 0.5) * m.cw;
    const aimY = m.oy + (cr + 0.5) * m.ch;
    const breathe = Math.sin(this.now / 900);
    drawSurvivor(ctx, cxp, feetY, m.ch, aimX, aimY, breathe, this.aimOut);
    this.gunX = this.aimOut[0];
    this.gunY = this.aimOut[1];

    if (this.fx.muzzle > 0) {
      const a = this.fx.muzzle / MUZZLE_MS;
      ctx.globalAlpha = a;
      this.flash.blit(ctx, this.gunX, this.gunY, m.ch * (2.6 + a * 2.2));
      ctx.globalAlpha = 1;
    }
  }

  private drawShots(): void {
    const fx = this.fx;
    if (fx.shotCount === 0) return;
    const ctx = this.ctx;
    const m = this.m;

    // tracers
    ctx.lineCap = 'round';
    for (let i = 0; i < fx.shotCount; i++) {
      const age = fx.shotAge[i];
      if (age >= TRACER_MS) continue;
      const t = age / TRACER_MS;
      const row = fx.shotRow[i];
      const c1 = fx.shotC1[i];
      const tx = m.ox + (c1 + 0.5) * m.cw;
      const ty = m.oy + (row + 0.5) * m.ch;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = RGBA.tracerSoft;
      ctx.lineWidth = Math.max(1, m.ch * 0.22);
      ctx.beginPath();
      ctx.moveTo(this.gunX, this.gunY);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = RGBA.tracer;
      ctx.lineWidth = Math.max(1, m.ch * 0.07);
      ctx.beginPath();
      ctx.moveTo(this.gunX, this.gunY);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // the covered span: exactly what the command reached
    for (let i = 0; i < fx.shotCount; i++) {
      const age = fx.shotAge[i];
      const t = age / SHOT_MS;
      const row = fx.shotRow[i];
      if (row < 0 || row >= ROWS) continue;
      let c0 = fx.shotC0[i]; let c1 = fx.shotC1[i];
      if (c1 < c0) { const s = c0; c0 = c1; c1 = s; }
      if (c0 < 0) c0 = 0;
      if (c1 > FIELD_COLS - 1) c1 = FIELD_COLS - 1;
      const x = m.ox + c0 * m.cw;
      const w = (c1 - c0 + 1) * m.cw;
      const y = m.oy + row * m.ch;
      const a = 1 - t;
      ctx.globalAlpha = a * 0.20;
      ctx.fillStyle = PALETTE.flashCore;
      ctx.fillRect(x, y, w, m.ch);
      ctx.globalAlpha = a;
      ctx.fillStyle = fx.shotHits[i] > 0 ? PALETTE.flashCore : PALETTE.amber;
      ctx.fillRect(x, y + m.ch * 0.94, w, Math.max(1, m.ch * 0.10));
      ctx.globalAlpha = 1;
    }
  }

  // -- cursor ----------------------------------------------------------------

  private drawCursor(state: GameState): void {
    const m = this.m;
    const ctx = this.ctx;
    const row = state.cursor.row;
    const col = state.cursor.col;
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return;

    // the lane you are on, so j/k reads instantly
    ctx.fillStyle = RGBA.laneCursor;
    ctx.fillRect(m.ox, m.oy + row * m.ch, FIELD_COLS * m.cw, m.ch);

    const p = 0.5 + 0.5 * Math.sin(this.now / 170);
    const x = m.ox + col * m.cw;
    const y = m.oy + row * m.ch;
    const th = Math.max(1, m.ch * 0.075);
    const lx = m.cw * 0.34;
    const ly = m.ch * 0.30;
    const pad = m.cw * 0.10;
    const x0 = x - pad;
    const x1 = x + m.cw + pad;
    const y0 = y + m.ch * 0.02;
    const y1 = y + m.ch * 0.98;

    ctx.globalAlpha = 0.72 + 0.28 * p;
    ctx.fillStyle = PALETTE.amber;
    // four corner brackets
    ctx.fillRect(x0, y0, lx, th);
    ctx.fillRect(x0, y0, th, ly);
    ctx.fillRect(x1 - lx, y0, lx, th);
    ctx.fillRect(x1 - th, y0, th, ly);
    ctx.fillRect(x0, y1 - th, lx, th);
    ctx.fillRect(x0, y1 - ly, th, ly);
    ctx.fillRect(x1 - lx, y1 - th, lx, th);
    ctx.fillRect(x1 - th, y1 - ly, th, ly);
    // centre pip
    const cxp = x + m.cw * 0.5;
    const cyp = y + m.ch * 0.5;
    ctx.fillRect(cxp - m.cw * 0.06, cyp - th * 0.5, m.cw * 0.12, th);
    ctx.fillRect(cxp - th * 0.5, cyp - m.ch * 0.05, th, m.ch * 0.10);
    ctx.globalAlpha = 1;
  }

  // -- particles -------------------------------------------------------------

  private drawParticles(): void {
    const p = this.particles;
    const m = this.m;
    const ctx = this.ctx;
    const n = p.count;
    for (let i = 0; i < n; i++) {
      let a = p.life[i] / p.maxLife[i];
      a = a > 0.45 ? 1 : a / 0.45;
      ctx.globalAlpha = a;
      const px = m.ox + p.x[i] * m.cw;
      const py = m.oy + p.y[i] * m.ch;
      if (p.kind[i] === K_CHUNK) {
        const rot = ((p.rot[i] * CHUNK_ROTS) | 0) % CHUNK_ROTS;
        this.chunks.blit(ctx, p.glyph[i], rot, p.color[i],
          px + m.cw * 0.5, py + m.ch * 0.5, p.size[i] * m.ch);
      } else {
        this.atlas.blit(ctx, p.glyph[i], p.color[i], px, py);
      }
    }
    ctx.globalAlpha = 1;
  }

  // -- screen fx -------------------------------------------------------------

  private drawFieldFx(state: GameState): void {
    const ctx = this.ctx;
    const m = this.m;
    const fx = this.fx;
    const fw = FIELD_COLS * m.cw;
    const fh = ROWS * m.ch;

    if (fx.laneFlashRow >= 0) {
      const t = fx.laneFlashMs;
      const y = m.oy + fx.laneFlashRow * m.ch;
      if (t < LANE_FLASH_WHITE_MS) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = PALETTE.flashCore;
      } else {
        ctx.globalAlpha = 0.55 *
          (1 - (t - LANE_FLASH_WHITE_MS) / (LANE_FLASH_MS - LANE_FLASH_WHITE_MS));
        ctx.fillStyle = this.gore === 'off' ? PALETTE.flashEdge : PALETTE.bloodBright;
      }
      ctx.fillRect(m.ox, y - m.ch * 0.12, (COLS - 6) * m.cw, m.ch * 1.24);
      ctx.globalAlpha = 1;
    }

    if (fx.sweepMs >= 0) {
      const prog = fx.sweepMs / SWEEP_MS;
      const x = m.ox + (prog * (FIELD_COLS + 6) - 6) * m.cw;
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = PALETTE.fog;
      ctx.fillRect(x, m.oy, 6 * m.cw, fh);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = PALETTE.amber;
      ctx.fillRect(x + 6 * m.cw - Math.max(1, m.cw * 0.14), m.oy,
        Math.max(1, m.cw * 0.14), fh);
      ctx.globalAlpha = 1;
    }

    if (fx.error > 0 || state.sim.flashUntil > state.sim.time) {
      ctx.fillStyle = this.gore === 'off' ? RGBA.errorWashSafe : RGBA.errorWash;
      ctx.fillRect(m.ox, m.oy, fw, fh);
    }

    const vgrad = this.gore === 'off' ? this.vignetteSafe : this.vignetteGrad;
    if (fx.vignette > 0 && vgrad) {
      ctx.globalAlpha = fx.vignette * 0.55;
      ctx.fillStyle = vgrad;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      ctx.globalAlpha = 1;
    }

    if (fx.red > 0) this.overlay(PALETTE.blood, fx.red * 0.5);
    if (fx.white > 0) this.overlay(PALETTE.flashCore, fx.white * 0.45);
  }

  private drawOverkill(): void {
    const fx = this.fx;
    if (fx.overkill <= 0) return;
    const a = fx.overkill / OVERKILL_MS;
    const sc = 2.2 + (1 - a) * 0.7;
    this.ctx.globalAlpha = a;
    this.centerText('OVERKILL', 6,
      a > 0.6 ? PALETTE.white : (this.gore === 'off' ? PALETTE.amber : PALETTE.bloodBright), sc);
    this.ctx.globalAlpha = 1;
  }

  // -- HUD -------------------------------------------------------------------

  /**
   * The line-number gutter, exactly as Vim draws it: with `rnu` the current
   * lane shows its absolute number and every other lane shows the distance to
   * it, so the count you need for `j` / `k` is printed next to the target.
   * Numbers are 1-based to agree with `{n}G`.
   */
  private drawGutter(state: GameState): void {
    if (this.lineNumbers === 'off') return;
    const m = this.m;
    const cur = state.cursor.row;
    // Prefer the margin left of the field; fall back inside it on narrow screens.
    const outside = m.ox >= m.cw * 3.4;
    for (let r = 0; r < ROWS; r++) {
      const here = r === cur;
      const label = (this.lineNumbers === 'absolute' || here)
        ? String(r + 1)
        : String(Math.abs(r - cur));
      const col = outside ? -0.9 - label.length : 0.2;
      if (!outside) this.fillCells(0, r, label.length + 0.6, 1, GUTTER_SCRIM);
      this.text(label, col, r, here ? PALETTE.amber : PALETTE.dim);
    }
  }

  private drawHud(state: GameState): void {
    const m = this.m;
    const ctx = this.ctx;
    const b = state.barricade;

    const hpInt = Math.max(0, Math.ceil(b.hp));
    if (hpInt !== this.hHp) { this.hHp = hpInt; this.hpStr = '' + hpInt; }
    if (state.charges.dd !== this.hDd || state.charges.D !== this.hD) {
      this.hDd = state.charges.dd; this.hD = state.charges.D;
      this.chargeStr = state.charges.dd + ' / ' + state.charges.D;
    }
    if (state.wave !== this.hWave) { this.hWave = state.wave; this.waveStr = 'WAVE ' + state.wave; }

    const right = 59.4;
    // wave, right-aligned, thin
    this.text(this.waveStr, right - this.waveStr.length, 15.85, RGBA.hudWhiteDim, 1);

    // cross icon + barricade HP
    const iconX = m.ox + 50.5 * m.cw;
    const s = m.ch * 0.34;
    const y1 = m.oy + 17.35 * m.ch;
    ctx.fillStyle = RGBA.hudWhite;
    ctx.fillRect(iconX - s * 0.34, y1 - s, s * 0.68, s * 2);
    ctx.fillRect(iconX - s, y1 - s * 0.34, s * 2, s * 0.68);
    const hpColor = b.maxHp > 0 && b.hp <= b.maxHp * 0.25
      ? PALETTE.bloodBright
      : (b.maxHp > 0 && b.hp <= b.maxHp * 0.5 ? PALETTE.amber : RGBA.hudWhite);
    this.text(this.hpStr, 52.1, 16.95, hpColor, 1.25);

    // magazine icon + dd / D charges
    const y2 = m.oy + 18.75 * m.ch;
    ctx.fillStyle = RGBA.hudWhite;
    ctx.fillRect(iconX - s * 0.72, y2 - s * 0.95, s * 1.44, s * 1.9);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(iconX - s * 0.44, y2 - s * 0.62, s * 0.88, s * 1.3);
    ctx.fillStyle = RGBA.hudWhite;
    ctx.fillRect(iconX - s * 0.30, y2 - s * 0.30, s * 0.60, Math.max(1, s * 0.18));
    ctx.fillRect(iconX - s * 0.30, y2 + s * 0.10, s * 0.60, Math.max(1, s * 0.18));
    this.text(this.chargeStr, 52.1, 18.35, RGBA.hudWhite, 1.25);

    if (this.muted) this.drawMuteIcon(m.ox + 48.4 * m.cw, m.oy + 16.2 * m.ch, m.ch * 0.30);

    this.drawCombo(state.combo);
  }

  private drawMuteIcon(x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = RGBA.hudWhiteDim;
    ctx.fillRect(x - s, y - s * 0.42, s * 0.7, s * 0.84);
    ctx.beginPath();
    ctx.moveTo(x - s * 0.3, y - s * 0.42);
    ctx.lineTo(x + s * 0.35, y - s);
    ctx.lineTo(x + s * 0.35, y + s);
    ctx.lineTo(x - s * 0.3, y + s * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = RGBA.hudWhiteDim;
    ctx.lineWidth = Math.max(1, s * 0.22);
    ctx.beginPath();
    ctx.moveTo(x + s * 0.7, y - s * 0.5);
    ctx.lineTo(x + s * 1.5, y + s * 0.5);
    ctx.moveTo(x + s * 1.5, y - s * 0.5);
    ctx.lineTo(x + s * 0.7, y + s * 0.5);
    ctx.stroke();
  }

  private drawCombo(combo: number): void {
    if (combo < 2) { this.hCombo = combo; return; }
    if (combo !== this.hCombo) { this.hCombo = combo; this.comboStr = 'x' + combo; }
    const m = this.m;
    const sc = this.comboScale(combo);
    const color = combo >= 10
      ? (this.gore === 'off' ? PALETTE.amber : PALETTE.bloodBright)
      : PALETTE.white;
    this.textPx(this.comboStr, m.ox + m.cw * 0.5, m.oy - (BAND_TOP - 3.4) * m.ch - m.ch * sc,
      m.cw * sc, m.ch * sc, color);
  }

  private comboScale(combo: number): number {
    let s = 1 + Math.min(combo, 18) * 0.09;
    if (s > COMBO_SCALE_CAP) s = COMBO_SCALE_CAP;
    return s + this.fx.comboPop * 0.3;
  }

  // -- public text API (Phase E) --------------------------------------------

  /** Field-relative cells. Rows -6..-1 are the sky band, 16..19 the near
   *  foreground band. See NOTES.md. */
  text(s: string, col: number, row: number, color: string = PALETTE.bone, scale = 1): void {
    if (!s) return;
    const m = this.m;
    this.textPx(s, m.ox + col * m.cw, m.oy + row * m.ch, m.cw * scale, m.ch * scale, color);
  }

  centerText(s: string, row: number, color: string = PALETTE.bone, scale = 1): void {
    if (!s) return;
    this.text(s, (COLS - s.length * scale) / 2, row, color, scale);
  }

  fillCells(col: number, row: number, w: number, h: number, color: string): void {
    const m = this.m;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(m.ox + col * m.cw, m.oy + row * m.ch, w * m.cw, h * m.ch);
  }

  overlay(color: string, alpha: number): void {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * (alpha > 1 ? 1 : alpha);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.globalAlpha = prev;
  }

  private overlayRaw(rgba: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = rgba;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
  }

  /** Vim-style showcmd, bottom right of the field, oversized. Core mechanic. */
  showcmd(pending: string): void {
    if (!pending) return;
    const sc = 2.1;
    const w = pending.length * sc;
    const col = 49.0 - w;
    const row = 17.0;
    this.fillCells(col - 0.5, row - 0.15, w + 1.0, sc + 0.3, RGBA.showcmdBed);
    this.text(pending, col, row, PALETTE.amber, sc);
  }

  /** Whole field flashes for 80ms. main.ts calls this on an unknown key. */
  flashError(): void { this.fx.flashError(80); }

  // -- panels, rules, keycaps (Phase E cards) --------------------------------

  /** A weathered paper (or ink) panel in cell units, with a soft drop shadow. */
  panel(col: number, row: number, w: number, h: number,
        opts?: { alpha?: number; ink?: boolean }): void {
    const m = this.m;
    const ctx = this.ctx;
    const ink = opts?.ink === true;
    const alpha = opts?.alpha ?? 1;
    if (alpha <= 0 || w <= 0 || h <= 0) return;
    this.lastPanelPaper = !ink;

    const x = m.ox + col * m.cw;
    const y = m.oy + row * m.ch;
    const pw = w * m.cw;
    const ph = h * m.ch;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, alpha);

    // torn edge, deterministic: one path, walked clockwise
    const seed = ((col * 131) ^ (row * 17) ^ (w * 7) ^ (h * 3)) | 0;
    const jx = m.cw * 0.22;
    const jy = m.ch * 0.16;
    const nx = Math.max(3, Math.min(30, Math.round(w / 2)));
    const ny = Math.max(3, Math.min(24, Math.round(h)));
    const edge = (i: number, k: number) => {
      const hsh = hash3(seed, i, k);
      return ((hsh & 255) / 255) - 0.5;
    };

    ctx.beginPath();
    for (let i = 0; i <= nx; i++) ctx.lineTo(x + (pw * i) / nx, y + edge(i, 0) * jy);
    for (let i = 0; i <= ny; i++) ctx.lineTo(x + pw + edge(i, 1) * jx, y + (ph * i) / ny);
    for (let i = nx; i >= 0; i--) ctx.lineTo(x + (pw * i) / nx, y + ph + edge(i, 2) * jy);
    for (let i = ny; i >= 0; i--) ctx.lineTo(x + edge(i, 3) * jx, y + (ph * i) / ny);
    ctx.closePath();

    // drop shadow
    ctx.save();
    ctx.translate(m.cw * 0.35, m.ch * 0.30);
    ctx.fillStyle = RGBA.panelShadow;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = ink ? PALETTE.inkPanel : PALETTE.paper;
    ctx.fill();
    ctx.strokeStyle = ink ? 'rgba(201,203,189,0.35)' : PALETTE.paperEdge;
    ctx.lineWidth = Math.max(1, m.ch * 0.05);
    ctx.stroke();

    if (!ink) {
      // tea-stains and foxing so it reads as salvaged paper
      ctx.globalAlpha = ctx.globalAlpha * 0.12;
      ctx.fillStyle = '#8a7a55';
      for (let s = 0; s < 5; s++) {
        const hs = hash3(seed, s, 91);
        const sx = x + ((hs & 1023) / 1023) * pw;
        const sy = y + (((hs >>> 10) & 1023) / 1023) * ph;
        ctx.beginPath();
        ctx.ellipse(sx, sy, m.cw * (1 + ((hs >>> 20) & 7)), m.ch * (0.4 + ((hs >>> 24) & 3) * 0.3),
          0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = prev;
  }

  /** A hand-drawn-looking horizontal rule. */
  rule(col: number, row: number, w: number, color?: string): void {
    if (w <= 0) return;
    const m = this.m;
    const ctx = this.ctx;
    const x = m.ox + col * m.cw;
    const y = m.oy + (row + 0.5) * m.ch;
    const pw = w * m.cw;
    ctx.strokeStyle = color ?? (this.lastPanelPaper ? PALETTE.ink : PALETTE.dim);
    ctx.lineWidth = Math.max(1, m.ch * 0.055);
    ctx.lineCap = 'round';
    const segs = Math.max(3, Math.min(40, Math.round(w / 2)));
    const seed = ((col * 71) ^ (row * 29) ^ (w * 13)) | 0;
    ctx.beginPath();
    for (let i = 0; i < segs; i++) {
      const h0 = hash3(seed, i, 5);
      const h1 = hash3(seed, i, 6);
      const gx = pw * 0.012;
      const x0 = x + (pw * i) / segs + gx;
      const x1 = x + (pw * (i + 1)) / segs - gx;
      ctx.moveTo(x0, y + (((h0 & 255) / 255) - 0.5) * m.ch * 0.10);
      ctx.lineTo(x1, y + (((h1 & 255) / 255) - 0.5) * m.ch * 0.10);
    }
    ctx.stroke();
  }

  /** A key-cap box with a letter in it, as sketched in a notebook. */
  keycap(label: string, col: number, row: number, w?: number): void {
    const m = this.m;
    const ctx = this.ctx;
    const cells = w ?? Math.max(2, label.length + 1.4);
    const x = m.ox + col * m.cw;
    const y = m.oy + row * m.ch + m.ch * 0.06;
    const pw = cells * m.cw;
    const ph = m.ch * 1.05;
    const stroke = this.lastPanelPaper ? PALETTE.ink : PALETTE.bone;
    const inkText = this.lastPanelPaper ? PALETTE.ink : PALETTE.amber;

    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1, m.ch * 0.05);
    ctx.lineJoin = 'round';
    // two slightly offset passes so it looks sketched, not printed
    const seed = ((col * 53) ^ (row * 97) ^ label.length) | 0;
    for (let p = 0; p < 2; p++) {
      const h0 = hash3(seed, p, 1);
      const ox = (((h0 & 255) / 255) - 0.5) * m.cw * 0.12;
      const oy = ((((h0 >>> 8) & 255) / 255) - 0.5) * m.ch * 0.10;
      ctx.beginPath();
      ctx.rect(x + ox, y + oy, pw, ph);
      ctx.stroke();
    }
    const tx = col + (cells - label.length) * 0.5;
    this.text(label, tx, row + 0.08, inkText, 1);
  }

  // -- internals -------------------------------------------------------------

  private textPx(s: string, px: number, py: number, cw: number, ch: number, color: string): void {
    const ctx = this.ctx;
    const m = this.m;
    const slot = SLOT_OF.get(color);
    if (slot !== undefined && cw === m.cw && ch === m.ch) {
      for (let i = 0; i < s.length; i++) {
        this.atlas.blit(ctx, s.charCodeAt(i), slot, px + i * cw, py);
      }
      return;
    }
    ctx.font = fontString(this.fontPx * (ch / m.ch));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    const hx = cw * 0.5;
    const hy = ch * 0.5;
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code === 32) continue;
      ctx.fillText(code < 128 ? CHARS[code] : s.charAt(i), px + i * cw + hx, py + hy);
    }
  }

  // -- gore ------------------------------------------------------------------

  /**
   * A kill. The word bursts above the head; the figure comes apart beneath it.
   *
   * gore 'off'  — grey dissolve of the glyphs, a puff of grey motes, no blood.
   * gore 'low'  — letters scatter, a few dark droplets, light ground stain.
   * gore 'full' — letters, cloth and flesh chunks, and at high combo an
   *               arterial spray cone plus heavy ground splatter.
   */
  private burst(zp: ZPos, heavy: boolean, combo: number): void {
    const rng = this.rng;
    const p = this.particles;
    const n = zp.len;
    const level = this.gore;
    const figH = figureHeightCells(zp.kindIdx);
    const feet = zp.row + FIG_HEAD_GAP + figH;
    const mid = feet - figH * 0.55;
    const cxp = zp.col + n * 0.5;

    if (level === 'off') {
      // clean dissolve: the glyphs lift and fade, the figure puffs into motes
      for (let k = 0; k < n; k++) {
        p.spawn(K_GLYPH, zp.col + k, zp.row,
          rng.range(-1.2, 1.2), rng.range(-2.6, -0.8),
          rng.range(0.45, 0.75), zp.row, 1, 0,
          zp.text.charCodeAt(k), C.GREY, P_GHOST);
      }
      const motes = 6 + (heavy ? 8 : 0);
      for (let d = 0; d < motes; d++) {
        p.spawn(K_CHUNK, cxp + rng.range(-0.6, 0.6), mid + rng.range(-0.4, 0.4),
          rng.range(-1.5, 1.5), rng.range(-2.2, -0.4),
          rng.range(0.35, 0.6), feet, rng.range(0.10, 0.20), rng.range(-1, 1),
          rng.int(CHUNK_SHAPES), T.GREY, P_GHOST);
      }
      return;
    }

    const full = level === 'full';
    const c = combo < 0 ? 0 : combo;
    const escalate = full ? Math.min(1, c / 12) : 0;
    const spread = heavy ? 1.8 : 1;

    // --- the word comes apart ------------------------------------------------
    for (let k = 0; k < n; k++) {
      const x = zp.col + k;
      const push = (k - (n - 1) * 0.5) * 1.6;
      p.spawn(K_GLYPH, x, zp.row,
        (push + rng.range(-6, 6)) * spread,
        rng.range(-17, -6) * spread,
        rng.range(0.55, 1.15), feet + rng.range(-0.1, 0.35), 1, 0,
        zp.text.charCodeAt(k),
        (k & 1) === 0 ? C.BONE : C.BLOOD_BRIGHT,
        P_BLEEDS);
    }

    // --- droplets ------------------------------------------------------------
    const drops = full ? (heavy ? 12 : 5 + ((escalate * 8) | 0)) : 3;
    for (let d = 0; d < drops; d++) {
      p.spawn(K_CHUNK, cxp + rng.range(-0.8, 0.8), mid,
        rng.range(-12, 12) * spread, rng.range(-15, -2) * spread,
        rng.range(0.35, 0.9), feet + rng.range(-0.2, 0.5),
        rng.range(0.07, 0.15), rng.range(-3, 3),
        rng.int(CHUNK_SHAPES), rng.next() < 0.5 ? T.BLOOD : T.BLOOD_BRIGHT,
        P_BLEEDS);
    }
    if (!full) return;

    // --- the figure comes apart ---------------------------------------------
    const limbs = 5 + ((escalate * 7) | 0) + (heavy ? 8 : 0);
    for (let d = 0; d < limbs; d++) {
      const tone = d % 3 === 0 ? T.CLOTH : (d % 3 === 1 ? T.FLESH : T.BLOOD_DARK);
      p.spawn(K_CHUNK,
        cxp + rng.range(-0.7, 0.7), mid + rng.range(-0.5, 0.5),
        rng.range(-11, 11) * spread, rng.range(-16, -4) * spread,
        rng.range(0.6, 1.3), feet + rng.range(-0.15, 0.45),
        rng.range(0.16, 0.34) * (heavy ? 1.35 : 1), rng.range(-4, 4),
        rng.int(CHUNK_SHAPES), tone, P_BLEEDS);
    }

    // --- arterial spray at high combo ---------------------------------------
    if (c >= 10 || heavy) {
      const jets = 14 + ((escalate * 16) | 0) + (heavy ? 14 : 0);
      for (let d = 0; d < jets; d++) {
        // a cone thrown back down-range, away from the gun
        const a = Math.PI * (0.86 + rng.range(-0.16, 0.16));
        const sp = rng.range(12, 30) * spread;
        p.spawn(K_CHUNK, cxp, mid,
          Math.cos(a) * sp, Math.sin(a) * sp * 0.75 - 4,
          rng.range(0.4, 0.85), feet + rng.range(0, 0.6),
          rng.range(0.05, 0.12), rng.range(-6, 6),
          rng.int(CHUNK_SHAPES), T.BLOOD_BRIGHT, P_BLEEDS);
      }
      this.fx.flashRed(0.10);
    }
  }

  /** combo_break: the digits shatter and fall. */
  private shatterCombo(): void {
    const s = this.comboStr;
    if (!s || this.hCombo < 2) return;
    const sc = this.comboScale(this.hCombo);
    const rng = this.rng;
    const row = -(BAND_TOP - 3.4) - sc;
    for (let k = 0; k < s.length; k++) {
      this.particles.spawn(K_GLYPH, 0.5 + k * sc, row,
        rng.range(-9, 9), rng.range(-7, 2),
        rng.range(0.6, 1.1), ROWS + BAND_BOTTOM - 0.5, 1, 0,
        s.charCodeAt(k), C.WHITE, P_STICK);
    }
    this.comboStr = '';
    this.hCombo = -1;
    this.fx.addShake(1.5);
  }
}

/** exact-string lookup from a palette colour to its atlas slot */
const SLOT_OF = new Map<string, number>();
for (let i = 0; i < ATLAS_COLORS.length; i++) {
  if (!SLOT_OF.has(ATLAS_COLORS[i])) SLOT_OF.set(ATLAS_COLORS[i], i);
}
