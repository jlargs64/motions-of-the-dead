// ============================================================================
// Phase C — Renderer + FX. The only entry point other phases import.
//
// Art direction: *The Last Stand* (Con Artist Games, 2007). A wide nocturnal
// exterior lit by one floodlight on a post beside the house. Slate sky, black
// conifer treeline, fog on the horizon, trodden grass that falls into darkness
// at the west edge where the horde comes from. A junk-heap barricade — planks,
// a car door, a fridge, tyres, chain-link, sandbags — spans columns 50..55; the
// survivor stands on a pallet behind it and aims left, downrange, at wherever
// your cursor is. Each zombie is a tall hunched silhouette with its word
// floating above its head like a nametag. You kill by editing the words.
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
  BAND_BOTTOM, BAND_TOP, GoreLayer, Scene, lightFalloff,
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
/** width : height of one cell. Wider than a terminal — this is a scene. */
const CELL_ASPECT = 0.58;
const MAX_DPR = 2;
/** Cap on the baked glyph atlas (~32MB of texture). */
const MAX_ATLAS_PX = 8_000_000;
/** deterministic seed for the scene bake; identical every run */
const SCENE_SEED = 0xb10d5ce7;

/** the barricade heap occupies these columns, in cell units */
const WALL_X0 = 50.0;
const WALL_X1 = 55.0;
/** the survivor */
const SURV_COL = 55.6;
const SURV_FEET_ROW = 12.2;

/** a figure's head top sits this far below its word row, in cells */
const FIG_HEAD_GAP = 1.05;

/** HUD: top-left status block in the sky band, and the top-edge strip */
const HUD_COL = 0.6;
const HUD_ROW = -5.5;
const HUD_BAR_COLS = 10;
const STRIP_COL0 = 16;
const STRIP_COL1 = 44;
const STRIP_ROW = -5.75;
/** the combo counter's left edge; it grows upward from row -2.6 */
const COMBO_COL = 46;

// --- feel --------------------------------------------------------------------
/** words start jittering this many columns from the wall */
const FLICKER_DIST = 8;
const FLICKER_THR = new Uint8Array([4, 7, 11, 16, 22, 30, 40, 52]); // /128
const NOISE = '%#@$&*?!';
const NOISE_CODES = new Uint16Array(NOISE.length);
for (let i = 0; i < NOISE.length; i++) NOISE_CODES[i] = NOISE.charCodeAt(i);

/** muzzle flash: extra shade on figures within this many columns of the shot */
const MUZZLE_REACH = 6;
const MUZZLE_BOOST = 0.6;

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

// --- the plank table -------------------------------------------------------------
// 16 lanes x 3 leaning planks, laid out once from hash3 so the heap is the same
// every frame and every run. Fractions of the wall width / lane height; the
// angle is pre-resolved to cos/sin so the draw loop does no trig.
const PLANKS_PER_LANE = 3;
const PLANK_N = ROWS * PLANKS_PER_LANE;
const PLANK_CX = new Float32Array(PLANK_N);
const PLANK_CY = new Float32Array(PLANK_N);
const PLANK_LEN = new Float32Array(PLANK_N);
const PLANK_TH = new Float32Array(PLANK_N);
const PLANK_COS = new Float32Array(PLANK_N);
const PLANK_SIN = new Float32Array(PLANK_N);
const PLANK_TONE = new Uint8Array(PLANK_N);
const PLANK_TONES = ['#4a4034', '#5a4d3d', '#3e3529', '#514332'];
for (let r = 0; r < ROWS; r++) {
  for (let i = 0; i < PLANKS_PER_LANE; i++) {
    const k = r * PLANKS_PER_LANE + i;
    const h = hash3(r, i, 0x9e);
    PLANK_CX[k] = 0.30 + i * 0.22 + ((h & 255) / 255 - 0.5) * 0.14;
    PLANK_CY[k] = 0.5 + (((h >>> 8) & 255) / 255 - 0.5) * 0.5;
    PLANK_LEN[k] = 0.50 + ((h >>> 16) & 255) / 255 * 0.30;
    PLANK_TH[k] = 0.24 + ((h >>> 24) & 15) / 15 * 0.14;
    const ang = (((h >>> 4) & 255) / 255 - 0.5) * 2 * (18 * Math.PI / 180);
    PLANK_COS[k] = Math.cos(ang);
    PLANK_SIN[k] = Math.sin(ang);
    PLANK_TONE[k] = (h >>> 12) & 3;
  }
}
const PROP_CHAIN = 0;
const PROP_DOOR = 1;
const PROP_FRIDGE = 2;
const PROP_TYRES = 3;

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
  /** floodlight brightness per column, 0..1; figures pick their shade from it */
  private lightAt = new Float32Array(COLS);
  private gunX = 0;
  private gunY = 0;
  private aimOut = new Float64Array(2);

  // cached strings — rebuilt only when an underlying value changes
  private hpStr = '0';
  private ddStr = '';
  private dStr = '';
  private waveStr = '';
  private comboStr = '';
  private hHp = -1; private hDd = -1; private hD = -1;
  private hWave = -1; private hCombo = -1;
  private wallGlyphs = '';
  private wallHp = -1;
  /** per-lane wall level 4..0, decoded from wallGlyphs each frame */
  private wallLevels = new Uint8Array(ROWS);
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
        this.goreLayer.add(50, lane, 0.5);
        this.goreLayer.add(49, lane, 0.3);
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
    for (let c = 0; c < COLS; c++) this.lightAt[c] = lightFalloff(c);
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
    if (state.phase !== 'title') this.drawHud(state);
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
    const fx = this.fx;
    const bloody = this.gore !== 'off';
    const tick = (simTime / GAIT_MS) | 0;
    // the muzzle flash throws light onto whoever is near the shot for 60ms
    const boost = fx.muzzle > 0 ? (fx.muzzle / MUZZLE_MS) * MUZZLE_BOOST : 0;
    for (let r = 0; r < ROWS; r++) {
      for (let i = 0; i < zs.length; i++) {
        const z = zs[i];
        if (z.row !== r) continue;
        const n = z.text.length;
        if (z.col + n <= 0 || z.col >= FIELD_COLS) continue;
        const k = figureKind(z.kind, n);
        const centre = z.col + n * 0.5;
        const cxp = m.ox + centre * m.cw;
        const feetY = m.oy + (r + FIG_HEAD_GAP + figureHeightCells(k)) * m.ch;
        const dist = BARRICADE_COL - (z.col + n);
        const twitch = dist >= FLICKER_DIST ? 0 : (FLICKER_DIST - dist) / FLICKER_DIST;
        const rate = k === F_RUNNER ? 2 : 1;          // runners shamble faster
        const step = (tick * rate + z.id * 3) & 3;
        const h = hash3(z.id, this.frame >> 1, 0x2b);
        const jitter = ((h & 255) / 127.5) - 1;
        let ci = (centre + 0.5) | 0;
        if (ci < 0) ci = 0; else if (ci >= COLS) ci = COLS - 1;
        let shade = this.lightAt[ci];
        if (boost > 0 && this.litByShot(r, centre)) {
          shade += boost;
          if (shade > 1) shade = 1;
        }
        drawZombie(ctx, cxp, feetY, m.ch, k, step, twitch, jitter, bloody, shade, z.id);
      }
    }
  }

  /** Is a figure at (row, col) inside the muzzle flash of a live shot? Near
   *  end of the covered span is the end closest to the gun. */
  private litByShot(row: number, col: number): boolean {
    const fx = this.fx;
    for (let i = 0; i < fx.shotCount; i++) {
      if (fx.shotAge[i] >= MUZZLE_MS) continue;
      const dr = row - fx.shotRow[i];
      if (dr > 1 || dr < -1) continue;
      const c0 = fx.shotC0[i], c1 = fx.shotC1[i];
      const near = c0 > c1 ? c0 : c1;
      const dc = col - near;
      if (dc <= MUZZLE_REACH && dc >= -MUZZLE_REACH) return true;
    }
    return false;
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

  /**
   * The heap. Per lane, 2..3 leaning planks from the module-level plank table
   * plus one large prop per group of lanes; the wall level 4..0 from
   * `barricadeGlyphs` decides how much of it is still standing. Everything is
   * keyed on (lane, index) so the heap is identical every frame for a given HP.
   */
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

    // the dark behind the heap — every gap opens onto this
    ctx.fillStyle = PALETTE.void_;
    ctx.fillRect(x0 + w * 0.10, top, w * 0.90, ROWS * m.ch);

    // the upright the wire is strung on, east side, full height
    ctx.fillStyle = PALETTE.timberShadow;
    ctx.fillRect(x1 - w * 0.26, top - m.ch * 0.4, Math.max(2, m.cw * 0.32), ROWS * m.ch + m.ch * 0.4);
    ctx.fillStyle = 'rgba(107,93,74,0.30)';
    ctx.fillRect(x1 - w * 0.26, top - m.ch * 0.4, Math.max(1, m.cw * 0.10), ROWS * m.ch + m.ch * 0.4);

    // levels per lane, reused by the props
    const lv = this.wallLevels;
    for (let r = 0; r < ROWS; r++) {
      const code = r < g.length ? g.charCodeAt(r) : 32;
      lv[r] = code < 128 ? WALL_LEVEL_OF[code] : 4;
    }

    // planks
    for (let r = 0; r < ROWS; r++) {
      const lvl = lv[r];
      const y = top + r * m.ch;
      if (lvl === 0) {
        // breach: a hole. Splintered plank ends at either side, a fallen plank
        // on the ground, and a faint red glow on the west lip to pull the eye.
        ctx.fillStyle = PALETTE.timberShadow;
        ctx.fillRect(x0 + w * 0.10, y + m.ch * 0.2, w * 0.14, m.ch * 0.30);
        ctx.fillRect(x1 - w * 0.36, y + m.ch * 0.55, w * 0.10, m.ch * 0.26);
        this.plank(r, 0, x0, y + m.ch * 0.55, w, m.ch, 0.6);
        ctx.fillStyle = RGBA.breachGlow;
        ctx.fillRect(x0 + w * 0.10, y, w * 0.30, m.ch);
        continue;
      }
      const count = lvl === 4 ? 3 : lvl === 1 ? 1 : 2;
      for (let i = 0; i < count; i++) {
        this.plank(r, i, x0, y, w, m.ch, lvl === 1 ? 0.45 : 1);
      }
      if (lvl <= 2) {
        // splinters off the ragged west face
        ctx.fillStyle = PALETTE.timber;
        for (let sp = 0; sp < 3; sp++) {
          const hs = hash3(r, sp, 11);
          const sy = y + (sp + 0.15) * (m.ch / 3.4);
          ctx.fillRect(x0 + w * (0.12 + ((hs >>> 4) & 7) * 0.02), sy,
            w * 0.08 * ((hs & 15) / 15 + 0.3), m.ch * 0.14);
        }
      }
    }

    // props, one per lane group; a prop is as broken as its worst lane
    this.prop(PROP_CHAIN, 0, 2, x0, w, top, lv);
    this.prop(PROP_DOOR, 3, 5, x0, w, top, lv);
    this.prop(PROP_FRIDGE, 8, 10, x0, w, top, lv);
    this.prop(PROP_TYRES, 13, 15, x0, w, top, lv);

    this.drawSandbags(x0, w, top);
    this.drawWire(x0, x1, top, lv);

    // caked blood at the foot of the heap, accumulated across the run
    if (this.gore !== 'off') {
      ctx.fillStyle = PALETTE.bloodDry;
      for (let r = 0; r < ROWS; r++) {
        const v = this.wallGore[r];
        if (v <= 0.01) continue;
        ctx.globalAlpha = Math.min(0.62, v * 0.62);
        ctx.beginPath();
        ctx.ellipse(x0 + w * 0.28, top + (r + 0.72) * m.ch,
          w * 0.30 + m.cw * 0.35, m.ch * (0.20 + v * 0.16), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** One leaning plank from the table: a filled quad and a lit top edge. */
  private plank(r: number, i: number, x0: number, y: number, w: number, ch: number, lenScale: number): void {
    const ctx = this.ctx;
    const k = r * PLANKS_PER_LANE + i;
    const cx = x0 + w * PLANK_CX[k];
    const cy = y + ch * PLANK_CY[k];
    const hx = w * PLANK_LEN[k] * 0.5 * lenScale;
    const hy = ch * PLANK_TH[k] * 0.5;
    const c = PLANK_COS[k], s = PLANK_SIN[k];
    // corners: along the plank (±hx) and across it (±hy)
    const ax = cx - hx * c + hy * s, ay = cy - hx * s - hy * c;   // top-west
    const bx = cx + hx * c + hy * s, by = cy + hx * s - hy * c;   // top-east
    const dx = cx + hx * c - hy * s, dy = cy + hx * s + hy * c;   // bottom-east
    const ex = cx - hx * c - hy * s, ey = cy - hx * s + hy * c;   // bottom-west
    ctx.fillStyle = PLANK_TONES[PLANK_TONE[k]];
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(dx, dy); ctx.lineTo(ex, ey);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PALETTE.timberHi;
    ctx.lineWidth = Math.max(1, ch * 0.05);
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.stroke();
  }

  /** A large piece of junk spanning lanes r0..r1. Full at level >= 3, an
   *  outline with the fill knocked out at level 2, gone below that. */
  private prop(kind: number, r0: number, r1: number, x0: number, w: number, top: number, lv: Uint8Array): void {
    let lvl = 4;
    for (let r = r0; r <= r1; r++) if (lv[r] < lvl) lvl = lv[r];
    if (lvl <= 1) return;
    const outline = lvl === 2;
    const ctx = this.ctx;
    const m = this.m;
    const y = top + r0 * m.ch;
    const h = (r1 - r0 + 1) * m.ch;
    ctx.lineWidth = Math.max(1, m.ch * 0.06);
    if (kind === PROP_CHAIN) {
      // a chain-link panel: frame + diagonal lattice
      const px = x0 + w * 0.18, pw = w * 0.62;
      const py = y + m.ch * 0.15, ph = h - m.ch * 0.3;
      ctx.strokeStyle = PALETTE.chain;
      ctx.strokeRect(px, py, pw, ph);
      if (!outline) {
        ctx.lineWidth = Math.max(1, m.ch * 0.03);
        ctx.beginPath();
        const n = 7;
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          ctx.moveTo(px, py + ph * f); ctx.lineTo(px + pw * (1 - f), py + ph);
          ctx.moveTo(px + pw * f, py); ctx.lineTo(px + pw, py + ph * (1 - f));
          ctx.moveTo(px, py + ph * f); ctx.lineTo(px + pw * f, py);
          ctx.moveTo(px + pw * f, py + ph); ctx.lineTo(px + pw, py + ph * f);
        }
        ctx.stroke();
      }
    } else if (kind === PROP_DOOR) {
      // a car door, rusted, window up
      const px = x0 + w * 0.14, pw = w * 0.70;
      const py = y + m.ch * 0.2, ph = h - m.ch * 0.4;
      if (outline) { ctx.strokeStyle = PALETTE.rust; ctx.strokeRect(px, py, pw, ph); return; }
      ctx.fillStyle = PALETTE.rust;
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = PALETTE.void_;
      ctx.fillRect(px + pw * 0.12, py + ph * 0.08, pw * 0.76, ph * 0.36);   // window
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(px, py, pw, Math.max(1, ph * 0.03));                     // lit top edge
      ctx.fillStyle = '#2a1c12';
      ctx.fillRect(px + pw * 0.62, py + ph * 0.58, pw * 0.22, Math.max(1, ph * 0.06)); // handle
    } else if (kind === PROP_FRIDGE) {
      // a fridge on its side would be wider than the heap; upright it is
      const px = x0 + w * 0.22, pw = w * 0.56;
      const py = y + m.ch * 0.1, ph = h - m.ch * 0.2;
      if (outline) { ctx.strokeStyle = '#565a5e'; ctx.strokeRect(px, py, pw, ph); return; }
      ctx.fillStyle = '#565a5e';
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = '#3d4044';
      ctx.fillRect(px, py + ph * 0.38, pw, Math.max(1, ph * 0.02));         // door seam
      ctx.fillRect(px + pw * 0.10, py + ph * 0.10, Math.max(1, pw * 0.06), ph * 0.22); // handles
      ctx.fillRect(px + pw * 0.10, py + ph * 0.46, Math.max(1, pw * 0.06), ph * 0.40);
      ctx.fillStyle = '#6a6e72';
      ctx.fillRect(px, py, pw, Math.max(1, ph * 0.02));
    } else {
      // a stack of tyres
      const cx = x0 + w * 0.46;
      const rx = w * 0.30, ry = m.ch * 0.42;
      for (let t = 0; t < 3; t++) {
        const cy = y + h - m.ch * (0.5 + t * 0.9);
        if (outline) {
          ctx.strokeStyle = '#22252a';
          ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
          continue;
        }
        ctx.fillStyle = '#141618';
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#22252a';
        ctx.beginPath(); ctx.ellipse(cx, cy - ry * 0.15, rx * 0.5, ry * 0.32, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  private drawSandbags(x0: number, w: number, top: number): void {
    const ctx = this.ctx;
    const m = this.m;
    ctx.fillStyle = PALETTE.sandbag;
    for (let r = ROWS - 4; r < ROWS; r++) {
      for (let s = 0; s < 3; s++) {
        const h = hash3(r, s, 29);
        const x = x0 + w * (0.02 + s * 0.11) + ((h & 15) / 15 - 0.5) * m.cw * 0.2;
        const y = top + r * m.ch + m.ch * (0.10 + (s & 1) * 0.40);
        ctx.beginPath();
        ctx.ellipse(x, y + m.ch * 0.22, m.cw * 0.62, m.ch * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = Math.max(1, m.ch * 0.035);
    ctx.beginPath();
    for (let r = ROWS - 4; r < ROWS; r++) {
      ctx.moveTo(x0 - m.cw * 0.6, top + r * m.ch + m.ch * 0.5);
      ctx.lineTo(x0 + w * 0.3, top + r * m.ch + m.ch * 0.5);
    }
    ctx.stroke();
  }

  private drawWire(x0: number, x1: number, top: number, lv: Uint8Array): void {
    const ctx = this.ctx;
    const m = this.m;
    const w = x1 - x0;
    const wa = x0 + w * 0.60, wb = x1 - w * 0.16;
    ctx.strokeStyle = PALETTE.wire;
    ctx.lineWidth = Math.max(1, m.ch * 0.03);
    ctx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      const x = (r & 1) === 0 ? wa : wb;
      const y = top + r * m.ch;
      if (r === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // barbs at each vertex, skipped where the wall is gone
    ctx.strokeStyle = RGBA.wireGlint;
    ctx.lineWidth = Math.max(1, m.ch * 0.025);
    ctx.beginPath();
    for (let r = 0; r <= ROWS; r++) {
      if (r < ROWS && lv[r] === 0) continue;
      const x = (r & 1) === 0 ? wa : wb;
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
    // No scrim: the numbers are scratched onto the ground, not printed in a
    // gutter. A one-pixel dark copy underneath keeps them legible over grass.
    const off = Math.max(1, Math.round(m.scale));
    for (let r = 0; r < ROWS; r++) {
      const here = r === cur;
      const label = (this.lineNumbers === 'absolute' || here)
        ? String(r + 1)
        : String(Math.abs(r - cur));
      const col = outside ? -0.9 - label.length : 0.2;
      const x = m.ox + col * m.cw;
      const y = m.oy + r * m.ch;
      this.textPx(label, x + off, y + off, m.cw, m.ch, PALETTE.bg);
      this.textPx(label, x, y, m.cw, m.ch, here ? PALETTE.amber : PALETTE.dim);
    }
  }

  /**
   * Top-left, in the sky band, as in the reference: NIGHT n, a cracked
   * barricade bar with the numeral, the magazine strip (dd / D charges), and a
   * zombies-remaining strip along the top edge. No panel behind any of it.
   */
  private drawHud(state: GameState): void {
    const m = this.m;
    const ctx = this.ctx;
    const b = state.barricade;

    const hpInt = Math.max(0, Math.ceil(b.hp));
    if (hpInt !== this.hHp) { this.hHp = hpInt; this.hpStr = '' + hpInt; }
    if (state.charges.dd !== this.hDd) { this.hDd = state.charges.dd; this.ddStr = '' + state.charges.dd; }
    if (state.charges.D !== this.hD) { this.hD = state.charges.D; this.dStr = '' + state.charges.D; }
    if (state.wave !== this.hWave) { this.hWave = state.wave; this.waveStr = 'NIGHT ' + state.wave; }

    // --- NIGHT n --------------------------------------------------------------
    this.text(this.waveStr, HUD_COL, HUD_ROW, RGBA.hudWhiteDim, 1);
    if (this.muted) {
      this.drawMuteIcon(m.ox + (HUD_COL + this.waveStr.length + 1.4) * m.cw, m.oy + (HUD_ROW + 0.5) * m.ch, m.ch * 0.30);
    }

    // --- barricade bar ---------------------------------------------------------
    const frac = b.maxHp > 0 ? Math.max(0, Math.min(1, b.hp / b.maxHp)) : 0;
    const hpColor = frac <= 0.25 ? PALETTE.bloodBright : (frac <= 0.5 ? PALETTE.amber : RGBA.hudWhite);
    const bx = m.ox + HUD_COL * m.cw;
    const by = m.oy + (HUD_ROW + 1.15) * m.ch;
    const bw = HUD_BAR_COLS * m.cw;
    const bh = m.ch * 0.55;
    ctx.fillStyle = RGBA.hudTrack;
    ctx.fillRect(bx - m.cw * 0.2, by - m.ch * 0.08, bw + m.cw * 0.4, bh + m.ch * 0.16);
    ctx.fillStyle = hpColor;
    ctx.fillRect(bx, by, bw * frac, bh);
    // cracks: short dark diagonals, fixed per bar so they read as damage not noise
    ctx.strokeStyle = RGBA.hudCrack;
    ctx.lineWidth = Math.max(1, m.ch * 0.04);
    ctx.beginPath();
    for (let c = 0; c < 5; c++) {
      const hc = hash3(c, 0x41, 0x7);
      const fx = 0.12 + c * 0.18 + ((hc & 15) / 15) * 0.06;
      if (fx > frac) break;
      const x = bx + bw * fx;
      const lean = (((hc >>> 4) & 15) / 15 - 0.5) * m.cw * 0.6;
      ctx.moveTo(x, by);
      ctx.lineTo(x + lean, by + bh * 0.55);
      ctx.lineTo(x + lean * 0.3, by + bh);
    }
    ctx.stroke();
    this.text(this.hpStr, HUD_COL + HUD_BAR_COLS + 0.6, HUD_ROW + 0.8, hpColor, 1.25);

    // --- magazine strip: dd and D charges -------------------------------------
    const y2 = m.oy + (HUD_ROW + 2.55) * m.ch;
    const ix = m.ox + (HUD_COL + 0.5) * m.cw;
    const sI = m.ch * 0.30;
    ctx.fillStyle = RGBA.hudWhite;
    ctx.fillRect(ix - sI * 0.72, y2 - sI * 0.95, sI * 1.44, sI * 1.9);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(ix - sI * 0.44, y2 - sI * 0.62, sI * 0.88, sI * 1.3);
    ctx.fillStyle = RGBA.hudWhite;
    ctx.fillRect(ix - sI * 0.30, y2 - sI * 0.30, sI * 0.60, Math.max(1, sI * 0.18));
    ctx.fillRect(ix - sI * 0.30, y2 + sI * 0.10, sI * 0.60, Math.max(1, sI * 0.18));
    const rowM = HUD_ROW + 2.05;
    this.text('dd', HUD_COL + 1.6, rowM, RGBA.hudWhiteDim, 1);
    this.text(this.ddStr, HUD_COL + 3.9, rowM, RGBA.hudWhite, 1);
    this.text('D', HUD_COL + 6.0, rowM, RGBA.hudWhiteDim, 1);
    this.text(this.dStr, HUD_COL + 7.3, rowM, RGBA.hudWhite, 1);

    // --- zombies remaining, along the top edge --------------------------------
    const sim = state.sim;
    const total = sim.waveSize;
    if (total > 0 && state.phase === 'playing') {
      let left = total - sim.resolvedThisWave;
      if (left < 0) left = 0;
      const zx = m.ox + STRIP_COL0 * m.cw;
      const zy = m.oy + STRIP_ROW * m.ch;
      const zw = (STRIP_COL1 - STRIP_COL0) * m.cw;
      const zh = m.ch * 0.30;
      ctx.fillStyle = RGBA.hudTrack;
      ctx.fillRect(zx - m.cw * 0.2, zy - m.ch * 0.06, zw + m.cw * 0.4, zh + m.ch * 0.12);
      ctx.fillStyle = RGBA.hudWhiteDim;
      ctx.fillRect(zx, zy, zw * (left / total), zh);
    }

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
    this.textPx(this.comboStr, m.ox + COMBO_COL * m.cw, m.oy - (BAND_TOP - 3.4) * m.ch - m.ch * sc,
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
      this.particles.spawn(K_GLYPH, COMBO_COL + k * sc, row,
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
