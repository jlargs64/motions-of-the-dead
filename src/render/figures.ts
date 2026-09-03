// ============================================================================
// Phase C — Renderer. Procedural figures: the horde and the survivor.
//
// Art direction: the pixel-art sheet in docs/ref (walker / armored walker /
// runner / bloater / crawler; survivor in a green field jacket with a
// scavenged bolt-action rifle). Every figure is a real body — head, neck,
// shoulders, torso, two arms with hands, two legs with feet — cel-shaded in
// two flat tones: a lit east face toward the lamp and a shadow west face. The
// zombies read by their SKIN: bare head, forearms and shins are the lightest
// thing on the figure and the only thing that separates them from the dark
// ground, so every kind shows skin somewhere.
//
// Nothing here allocates: every parameter is a number, the gait tables are
// module-level typed arrays, per-zombie variation is re-derived from the id
// with `hash3` each frame, and the one "return value" is written into a
// caller-owned Float64Array.
//
// Zombies face RIGHT (the direction they walk). The survivor faces LEFT.
// ============================================================================
import {
  FIG_BELLY, FIG_BELLY_DK, FIG_BLOOD, FIG_BLOOD_HI, FIG_BODY, FIG_BODY_DK, FIG_HOLLOW,
  FIG_PLATE, FIG_PLATE_DK, FIG_RIM, FIG_SKIN, FIG_SKIN_DK, PALETTE, SHADE_STEPS,
} from './palette';
import { hash3 } from './fx';

/** scratch for one aim-basis point; the draw loop allocates nothing */
const PT = new Float64Array(2);

/** figure kind indices */
export const F_WALKER = 0;
export const F_ARMORED = 1;
export const F_RUNNER = 2;
export const F_BLOATER = 3;
export const F_CRAWLER = 4;

export function figureKind(kind: string, len: number): number {
  if (kind === 'crawler' || len <= 1) return F_CRAWLER;
  if (kind === 'armored') return F_ARMORED;
  if (kind === 'runner') return F_RUNNER;
  if (kind === 'bloater' || len >= 8) return F_BLOATER;
  return F_WALKER;
}

// 4-frame shamble cycle. Deterministic, cheap, and read straight out of a table.
const GAIT_LEG = new Float32Array([-1, 0, 1, 0]);
const GAIT_ARM = new Float32Array([0.7, 0, -0.7, 0]);
const GAIT_BOB = new Float32Array([0, -1, 0, 1]);

/** total figure height as a multiple of the cell height, per kind */
const FIG_H = new Float32Array([3.4, 3.4, 3.3, 3.3, 1.25]);
/** figure width (shoulder span) as a fraction of its own height */
const FIG_W = new Float32Array([0.34, 0.40, 0.30, 0.66, 1.5]);
/** forward lean, in fractions of height */
const FIG_LEAN = new Float32Array([0.07, 0.05, 0.24, 0.06, 0]);

/** Height of a figure in cell heights, for the caller's layout maths. This is
 *  the nominal height; the per-zombie scale (0.9..1.1) only ever shrinks or
 *  grows the drawn body around the same feet position. */
export function figureHeightCells(kindIdx: number): number {
  return FIG_H[kindIdx];
}

/** Width of a figure in cell heights. */
export function figureWidthCells(kindIdx: number): number {
  return FIG_H[kindIdx] * FIG_W[kindIdx];
}

/** One limb segment as a round-capped stroke. */
function limb(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, style: string): void {
  ctx.strokeStyle = style;
  ctx.lineWidth = w < 1 ? 1 : w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

/**
 * A head seen in three-quarter profile, facing east: skull in two tones, a
 * dark socket, the jaw shadow, and one rim of lamplight on the crown.
 * `open` > 0 drops the jaw (runners, the bloater).
 */
function head(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, si: number,
  kind: number, open: number, rim: boolean,
): void {
  const rx = r * (kind === 1 ? 0.84 : kind === 2 ? 0.94 : 0.90);
  const ry = r * (kind === 1 ? 1.08 : 1.0);
  // skull: lit tone, then the west half in shadow
  ctx.fillStyle = FIG_SKIN[si];
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FIG_SKIN_DK[si];
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();
  // jaw, hanging forward and down off the skull
  ctx.fillStyle = FIG_SKIN[si];
  ctx.fillRect(x, y + ry * 0.35, rx * 0.85, ry * (0.45 + open * 0.35));
  // the hollows: brow shadow, one socket, the mouth
  ctx.fillStyle = FIG_HOLLOW[si];
  ctx.fillRect(x + rx * 0.25, y - ry * 0.28, rx * 0.42, ry * 0.30);
  ctx.fillRect(x + rx * 0.10, y + ry * 0.36, rx * 0.75, r < 6 ? 1 : ry * 0.12);
  if (open > 0) ctx.fillRect(x + rx * 0.25, y + ry * 0.48, rx * 0.55, ry * open * 0.40);
  // hair / scalp on the dark side for two of the four head kinds
  if (kind === 0 || kind === 3) {
    ctx.fillStyle = FIG_BODY_DK[si];
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.15, y - ry * 0.35, rx * 0.95, ry * 0.62, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  }
  if (rim) {
    ctx.strokeStyle = FIG_RIM[si];
    ctx.lineWidth = r * 0.16 < 1 ? 1 : r * 0.16;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, -Math.PI * 0.55, -Math.PI * 0.05);
    ctx.stroke();
  }
}

/**
 * Draw one shambling zombie, centred on `cxp`, standing on `feetY`.
 *
 * @param step    0..3 gait frame
 * @param twitch  0..1 extra jitter as it closes on the wall
 * @param jitter  signed -1..1 deterministic noise for the twitch direction
 * @param bloody  false when gore is off
 * @param shade   0..1 how much of the floodlight reaches this figure; picks a
 *                step from the palette ramps. 0 is the unlit west edge.
 * @param id      the zombie id; seeds the per-zombie build (height, hunch,
 *                hem, head) so the same zombie looks the same every frame
 * @param maim    letters shot off the word so far. Each one takes a piece of
 *                the figure: 1 the near arm, 2 the far arm, 3 a bite from the
 *                flank, 4 the top of the skull, 5+ a second wound. At one
 *                letter left it is drawn as a crawler regardless.
 */
export function drawZombie(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, ch: number,
  kindIdx: number, step: number, twitch: number, jitter: number, bloody: boolean,
  shade: number, id: number, maim = 0, hobbled = false,
): void {
  const si = shade <= 0 ? 0 : shade >= 1 ? SHADE_STEPS - 1 : (shade * (SHADE_STEPS - 1) + 0.5) | 0;
  const build = hash3(id, 0x5a, 0x77);
  const hs = 0.9 + (build & 255) / 255 * 0.2;              // height scale
  const hunch = ((build >>> 8) & 255) / 255;               // 0..1
  const headKind = (build >>> 16) & 3;                     // 0..3 head shapes
  const h = ch * FIG_H[kindIdx] * hs;
  const w = h * FIG_W[kindIdx];
  // The body leans east and the arms reach east, so the drawn mass sits east
  // of the nominal centre. Bias it back west so the figure lines up under the
  // middle of its own word.
  cxp -= w * 0.22;
  const leg = GAIT_LEG[step & 3];
  const arm = GAIT_ARM[step & 3];
  const bob = GAIT_BOB[step & 3] * h * 0.014;
  const tx = jitter * twitch * h * 0.04;
  const ty = bob + jitter * twitch * h * 0.025;

  // ground contact shadow — longer toward the west, away from the lamp
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp - w * 0.15, feetY, w * 0.80, ch * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.lineCap = 'round';
  if (kindIdx === F_CRAWLER) {
    drawCrawler(ctx, cxp + tx, feetY + ty, h, w, step, bloody, si, build);
    return;
  }
  if (kindIdx === F_BLOATER) {
    drawBloater(ctx, cxp + tx, feetY + ty, h, w, leg, arm, bloody, si, build, maim, hobbled);
    return;
  }

  const runner = kindIdx === F_RUNNER;
  const armored = kindIdx === F_ARMORED;
  const cloth = FIG_BODY[si], clothDk = FIG_BODY_DK[si];
  const skin = FIG_SKIN[si], skinDk = FIG_SKIN_DK[si];
  const lean = FIG_LEAN[kindIdx] * h;
  const hipY = feetY - h * 0.50 + ty;
  const shY = feetY - h * (0.78 - hunch * 0.04) + ty;
  const hipX = cxp + tx;
  const shX = hipX + lean * 0.9;
  const headR = h * 0.068;
  const headX = shX + w * (0.30 + hunch * 0.22) + (runner ? w * 0.2 : 0);
  const headY = shY - headR * (1.05 - hunch * 0.35);
  const kneeY = feetY - h * 0.26 + ty;

  // --- legs: thigh in cloth, shin in skin (the trousers are rags) ------------
  // Hobbled (DECISIONS #94): the far shin is gone below the knee and the body
  // drags itself along on the stump, so the stride shortens to a lurch.
  const stride = h * (runner ? 0.20 : 0.10) * leg * (hobbled ? 0.45 : 1);
  const thighW = w * 0.27, shinW = w * 0.19;
  // far (west) leg first, in shadow tones
  {
    const fx = hipX - w * 0.14 - stride, kx = hipX - w * 0.10 - stride * 0.4;
    if (hobbled) {
      // the thigh trails behind and ends in meat; the stump drags on the ground
      const sx = hipX - w * 0.30 - stride * 0.5, sy = feetY + ty - h * 0.06;
      stump(ctx, hipX - w * 0.14, hipY, sx, sy, thighW, h, clothDk, si, bloody);
    } else {
      limb(ctx, hipX - w * 0.14, hipY, kx, kneeY, thighW, clothDk);
      limb(ctx, kx, kneeY, fx, feetY + ty - shinW * 0.3, shinW, armored ? clothDk : skinDk);
      ctx.fillStyle = armored ? FIG_HOLLOW[si] : skinDk;
      ctx.fillRect(fx - shinW * 0.5, feetY + ty - shinW * 0.7, shinW * 1.5, shinW * 0.7);
    }
  }
  {
    const fx = hipX + w * 0.16 + stride, kx = hipX + w * 0.18 + stride * 0.5;
    limb(ctx, hipX + w * 0.14, hipY, kx, kneeY, thighW, cloth);
    limb(ctx, kx, kneeY, fx, feetY + ty - shinW * 0.3, shinW, armored ? cloth : skin);
    ctx.fillStyle = armored ? FIG_HOLLOW[si] : skin;
    ctx.fillRect(fx - shinW * 0.4, feetY + ty - shinW * 0.7, shinW * 1.6, shinW * 0.7);
  }

  // --- far arm (west), behind the torso ---------------------------------------
  // The arms hang: down off the shoulder, bent a little at the elbow, hands
  // swinging below the hips. Runners throw theirs back. A high hunch brings
  // the hands forward, so the shamble has some reach without pointing.
  const reach = h * (runner ? -0.08 : 0.06 + hunch * 0.10);
  const drop = h * (runner ? 0.14 : 0.31 + arm * 0.02);
  {
    const sx = shX - w * 0.30, sy = shY + h * 0.03;
    const ex = sx + reach * 0.4 + (runner ? -w * 0.3 : -w * 0.06), ey = sy + h * 0.15;
    if (maim >= 2) {
      stump(ctx, sx, sy, sx + (ex - sx) * 0.6, sy + (ey - sy) * 0.6, w * 0.22, h, clothDk, si, bloody);
    } else {
      const hx = sx + reach - arm * w * 0.30, hy = sy + drop + (runner ? -h * 0.04 : 0.0);
      limb(ctx, sx, sy, ex, ey, w * 0.22, clothDk);
      limb(ctx, ex, ey, hx, hy, w * 0.17, armored ? clothDk : skinDk);
      ctx.fillStyle = skinDk;
      ctx.fillRect(hx - w * 0.07, hy - w * 0.02, w * 0.15, w * 0.15);
    }
  }

  // --- torso silhouette: shoulders wider than hips, ragged hem ---------------
  const shHalf = w * 0.50, hipHalf = w * 0.34;
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(hipX - hipHalf, hipY + h * 0.03);
  ctx.lineTo(shX - shHalf, shY + h * 0.06);                                // back
  ctx.lineTo(shX - shHalf * 0.60, shY - h * 0.02 - hunch * h * 0.025);   // hunched shoulder
  ctx.lineTo(shX + shHalf * 0.15, shY - h * 0.005);                       // neck root
  ctx.lineTo(shX + shHalf, shY + h * 0.06);                                // front shoulder
  ctx.lineTo(hipX + hipHalf, hipY + h * 0.02);
  // hem: jittered points below the hips
  for (let k = 0; k < 4; k++) {
    const hh = hash3(id, k, 0x3c);
    const fx = hipX + hipHalf - k * hipHalf * 0.67 - w * 0.05 * ((hh & 15) / 15);
    const fy = hipY + h * (0.03 + 0.07 * (((hh >>> 4) & 15) / 15));
    ctx.lineTo(fx, fy);
  }
  ctx.closePath();
  ctx.fill();
  // shadow face: the west 42% of the torso
  ctx.fillStyle = clothDk;
  ctx.beginPath();
  ctx.moveTo(hipX - hipHalf, hipY + h * 0.03);
  ctx.lineTo(shX - shHalf, shY + h * 0.06);
  ctx.lineTo(shX - shHalf * 0.60, shY - h * 0.02 - hunch * h * 0.025);
  ctx.lineTo(shX - shHalf * 0.16, shY);
  ctx.lineTo(hipX - hipHalf * 0.16, hipY + h * 0.06);
  ctx.closePath();
  ctx.fill();
  // neck
  ctx.fillStyle = skinDk;
  ctx.fillRect(shX + w * 0.02, shY - h * 0.03, w * 0.22, h * 0.05);

  if (armored) {
    // plate carrier strapped over the chest, two pouches, the whole thing green
    const px = shX - shHalf * 0.86, pw = shHalf * 1.72;
    const py = shY + h * 0.05, ph = h * 0.20;
    ctx.fillStyle = FIG_PLATE[si];
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = FIG_PLATE_DK[si];
    ctx.fillRect(px, py, pw * 0.42, ph);
    ctx.fillRect(px + pw * 0.50, py + ph * 0.55, pw * 0.18, ph * 0.32);   // pouch
    ctx.fillRect(px + pw * 0.74, py + ph * 0.55, pw * 0.18, ph * 0.32);
    ctx.fillStyle = FIG_HOLLOW[si];
    ctx.fillRect(px, py + ph * 0.48, pw, h * 0.008 < 1 ? 1 : h * 0.008);  // strap
  } else if (bloody) {
    // one wound, placed per zombie: a dark smear running down from it
    ctx.fillStyle = FIG_BLOOD[si];
    const bx = hipX - w * 0.20 + ((build >>> 20) & 7) * w * 0.06;
    const by = shY + h * (0.09 + ((build >>> 23) & 3) * 0.04);
    ctx.fillRect(bx, by, w * 0.16, h * 0.03);
    ctx.fillRect(bx + w * 0.02, by + h * 0.02, w * 0.07, h * 0.13);
    ctx.fillRect(bx + w * 0.09, by + h * 0.03, w * 0.04, h * 0.07);
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(bx + w * 0.03, by + h * 0.005, w * 0.05, h * 0.02);
  }

  // --- wounds: what the shots have taken out of the torso so far -----------
  if (maim >= 3) {
    wound(ctx, hipX + hipHalf * 0.45, hipY - h * 0.12, w * 0.20, h * 0.055, h, si, bloody);
  }
  if (maim >= 5) {
    wound(ctx, shX - shHalf * 0.30, shY + h * 0.11, w * 0.17, h * 0.05, h, si, bloody);
  }

  // --- near arm (east), hanging in front of the torso -------------------------
  {
    const sx = shX + w * 0.28, sy = shY + h * 0.03;
    const ex = sx + (runner ? -w * 0.35 : reach * 0.5 + w * 0.04), ey = sy + h * (runner ? 0.10 : 0.15);
    if (maim >= 1) {
      stump(ctx, sx, sy, sx + (ex - sx) * 0.55, sy + (ey - sy) * 0.55, w * 0.24, h, cloth, si, bloody);
    } else {
      const hx = sx + (runner ? -w * 0.10 : reach + w * 0.06) + arm * w * 0.30, hy = sy + drop + (runner ? -h * 0.10 : -h * 0.01);
      limb(ctx, sx, sy, ex, ey, w * 0.24, cloth);
      limb(ctx, ex, ey, hx, hy, w * 0.18, armored ? cloth : skin);
      ctx.fillStyle = skin;
      ctx.fillRect(hx - w * 0.06, hy - w * 0.02, w * 0.16, w * 0.16);
      // a hooked finger or two off the hand
      ctx.fillRect(hx + w * 0.08, hy + w * 0.12, w * 0.06, w * 0.06);
    }
  }

  // --- head -------------------------------------------------------------------
  head(ctx, headX, headY, headR, si, headKind, runner ? 0.8 : hunch > 0.7 ? 0.5 : 0, true);
  if (armored) {
    // helmet: a dome over the skull with a brim, in the plate green
    ctx.fillStyle = FIG_PLATE[si];
    ctx.beginPath();
    ctx.ellipse(headX, headY - headR * 0.18, headR * 1.05, headR * 0.98, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = FIG_PLATE_DK[si];
    ctx.beginPath();
    ctx.ellipse(headX, headY - headR * 0.18, headR * 1.05, headR * 0.98, 0, Math.PI, Math.PI * 1.5);
    ctx.fill();
    ctx.fillRect(headX - headR * 1.12, headY - headR * 0.30, headR * 2.3, headR * 0.18);
  }
  if (bloody) {
    // blood down the chin
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.fillRect(headX + headR * 0.30, headY + headR * 0.55, headR * 0.35, headR * (runner ? 0.9 : 0.5));
  }
  if (maim >= 4) scalp(ctx, headX, headY, headR, si, bloody);

  // rim: the lamp catches the front shoulder
  ctx.strokeStyle = FIG_RIM[si];
  ctx.lineWidth = h * 0.012 < 1 ? 1 : h * 0.012;
  ctx.beginPath();
  ctx.moveTo(shX + shHalf * 0.20, shY - h * 0.004);
  ctx.lineTo(shX + shHalf, shY + h * 0.06);
  ctx.stroke();
}

/** The bloater: a distended pale gut on short thick legs, arms held wide. */
function drawBloater(
  ctx: CanvasRenderingContext2D,
  cx: number, feetY: number, h: number, w: number, leg: number, arm: number, bloody: boolean,
  si: number, build: number, maim: number, hobbled: boolean,
): void {
  const cloth = FIG_BODY[si], clothDk = FIG_BODY_DK[si];
  const skin = FIG_SKIN[si], skinDk = FIG_SKIN_DK[si];
  const hipY = feetY - h * 0.40;
  const shY = feetY - h * 0.76;
  const headR = h * 0.062;
  const headX = cx + w * 0.14;
  const headY = shY - headR * 0.55;
  const stride = h * 0.07 * leg;
  const legW = w * 0.20;

  // legs: short, thick, spread. Hobbled: the far one ends at the knee.
  if (hobbled) {
    stump(ctx, cx - w * 0.20, hipY, cx - w * 0.30 - stride * 0.5, feetY - h * 0.10, legW, h, clothDk, si, bloody);
  } else {
    limb(ctx, cx - w * 0.20, hipY, cx - w * 0.26 - stride, feetY - legW * 0.3, legW, clothDk);
    ctx.fillStyle = skinDk;
    ctx.fillRect(cx - w * 0.26 - stride - legW * 0.5, feetY - legW * 0.6, legW * 1.4, legW * 0.6);
  }
  limb(ctx, cx + w * 0.18, hipY, cx + w * 0.26 + stride, feetY - legW * 0.3, legW, cloth);
  ctx.fillStyle = skin;
  ctx.fillRect(cx + w * 0.26 + stride - legW * 0.4, feetY - legW * 0.6, legW * 1.5, legW * 0.6);

  // far arm, out wide
  if (maim >= 2) {
    stump(ctx, cx - w * 0.40, shY + h * 0.05, cx - w * 0.53, shY + h * 0.16, w * 0.14, h, clothDk, si, bloody);
  } else {
    limb(ctx, cx - w * 0.40, shY + h * 0.05, cx - w * 0.62, shY + h * 0.24, w * 0.14, clothDk);
    limb(ctx, cx - w * 0.62, shY + h * 0.24, cx - w * 0.60 - arm * w * 0.06, shY + h * 0.40, w * 0.11, skinDk);
  }

  // torso: a shirt straining over the shoulders, in cloth
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.44, hipY + h * 0.02);
  ctx.lineTo(cx - w * 0.48, shY + h * 0.06);
  ctx.lineTo(cx - w * 0.20, shY - h * 0.02);
  ctx.lineTo(cx + w * 0.30, shY - h * 0.01);
  ctx.lineTo(cx + w * 0.48, shY + h * 0.08);
  ctx.lineTo(cx + w * 0.42, hipY + h * 0.02);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = clothDk;
  ctx.fillRect(cx - w * 0.46, shY + h * 0.02, w * 0.28, hipY - shY);

  // the gut: a pale sphere slumping forward and down over the belt
  const gx = cx + w * 0.06, gy = hipY - h * 0.08;
  const grx = w * 0.50, gry = h * 0.20;
  ctx.fillStyle = FIG_BELLY[si];
  ctx.beginPath();
  ctx.ellipse(gx, gy, grx, gry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FIG_BELLY_DK[si];
  ctx.beginPath();
  ctx.ellipse(gx, gy, grx, gry, 0, Math.PI * 0.55, Math.PI * 1.45);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(gx, gy + gry * 0.55, grx * 0.9, gry * 0.45, 0, 0, Math.PI);   // underside
  ctx.fill();
  if (bloody) {
    // split skin across the gut: a dark tear with a bright wet centre
    ctx.fillStyle = FIG_BLOOD[si];
    const tx = gx + grx * (0.05 + ((build >>> 20) & 3) * 0.08);
    ctx.fillRect(tx - grx * 0.20, gy - gry * 0.30, grx * 0.42, gry * 0.14);
    ctx.fillRect(tx, gy - gry * 0.22, grx * 0.10, gry * 0.55);
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(tx - grx * 0.08, gy - gry * 0.26, grx * 0.18, gry * 0.07);
  }
  // shots into the gut open it up
  if (maim >= 3) wound(ctx, gx + grx * 0.30, gy + gry * 0.10, grx * 0.34, gry * 0.30, h, si, bloody);
  if (maim >= 5) wound(ctx, gx - grx * 0.40, gy - gry * 0.15, grx * 0.28, gry * 0.26, h, si, bloody);

  // near arm, out wide
  if (maim >= 1) {
    stump(ctx, cx + w * 0.42, shY + h * 0.06, cx + w * 0.55, shY + h * 0.16, w * 0.15, h, cloth, si, bloody);
  } else {
    limb(ctx, cx + w * 0.42, shY + h * 0.06, cx + w * 0.64, shY + h * 0.22, w * 0.15, cloth);
    limb(ctx, cx + w * 0.64, shY + h * 0.22, cx + w * 0.66 + arm * w * 0.06, shY + h * 0.40, w * 0.12, skin);
    ctx.fillStyle = skin;
    ctx.fillRect(cx + w * 0.60, shY + h * 0.38, w * 0.12, w * 0.10);
  }

  // head, sunk into the shoulders, jaw open
  ctx.fillStyle = skinDk;
  ctx.fillRect(headX - headR * 0.6, shY - h * 0.03, headR * 1.3, h * 0.05);
  head(ctx, headX, headY, headR, si, (build >>> 16) & 3, 0.5, true);
  if (maim >= 4) scalp(ctx, headX, headY, headR, si, bloody);
}

// --- damage ------------------------------------------------------------------

/** An arm that ends early: the upper arm to `dx,dy`, meat at the end, and if
 *  gore is on, blood running off it. */
function stump(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, dx: number, dy: number,
  w: number, h: number, cloth: string, si: number, bloody: boolean,
): void {
  limb(ctx, sx, sy, dx, dy, w, cloth);
  ctx.fillStyle = bloody ? FIG_BLOOD[si] : FIG_HOLLOW[si];
  ctx.beginPath();
  ctx.ellipse(dx, dy, w * 0.58, w * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(dx - w * 0.22, dy - w * 0.10, w * 0.30, w * 0.22);
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.fillRect(dx - w * 0.10, dy + w * 0.20, w * 0.16, h * 0.07);
    ctx.fillRect(dx + w * 0.16, dy + w * 0.20, w * 0.10, h * 0.11);
  }
}

/** A hole through the body: dark inside, a wet rim, a run of blood below. */
function wound(
  ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
  h: number, si: number, bloody: boolean,
): void {
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.2, rx * 1.25, ry * 1.35, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = FIG_HOLLOW[si];
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(x - rx * 0.6, y - ry * 0.9, rx * 0.7, ry * 0.45);
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.fillRect(x - rx * 0.15, y + ry, rx * 0.3, h * 0.10);
  }
}

/** The top of the skull is gone. */
function scalp(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number, si: number, bloody: boolean,
): void {
  // knock the crown off: paint the top of the head out in hollow, then the
  // ragged edge of the skull in blood
  ctx.fillStyle = FIG_HOLLOW[si];
  ctx.fillRect(x - r * 1.0, y - r * 1.15, r * 2.0, r * 0.62);
  ctx.fillStyle = bloody ? FIG_BLOOD[si] : FIG_HOLLOW[si];
  ctx.fillRect(x - r * 0.92, y - r * 0.60, r * 1.84, r * 0.18);
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(x - r * 0.55, y - r * 0.62, r * 0.55, r * 0.10);
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.fillRect(x - r * 0.70, y - r * 0.45, r * 0.22, r * 0.85);
    ctx.fillRect(x + r * 0.40, y - r * 0.45, r * 0.18, r * 0.60);
  }
}

function drawCrawler(
  ctx: CanvasRenderingContext2D,
  cx: number, feetY: number, h: number, w: number, step: number, bloody: boolean,
  si: number, build: number,
): void {
  const arm = GAIT_ARM[step & 3];
  const cloth = FIG_BODY[si], clothDk = FIG_BODY_DK[si];
  const skin = FIG_SKIN[si], skinDk = FIG_SKIN_DK[si];
  // on hands and knees, facing east: hips west, shoulders east and higher
  const hipX = cx - w * 0.16, hipY = feetY - h * 0.42;
  const shX = cx + w * 0.16, shY = feetY - h * 0.56;
  const headR = h * 0.17;

  if (bloody) {
    // the trail it drags: a pool under the body, smeared west
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.14, feetY - h * 0.02, w * 0.42, h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // dragged legs trailing west along the ground
  limb(ctx, hipX, hipY, hipX - w * 0.20, feetY - h * 0.10, w * 0.12, clothDk);
  limb(ctx, hipX - w * 0.20, feetY - h * 0.10, hipX - w * 0.42, feetY - h * 0.04, w * 0.09, skinDk);
  limb(ctx, hipX + w * 0.02, hipY + h * 0.04, hipX - w * 0.14, feetY - h * 0.06, w * 0.12, cloth);
  limb(ctx, hipX - w * 0.14, feetY - h * 0.06, hipX - w * 0.36, feetY, w * 0.09, skin);

  // far arm, planted
  limb(ctx, shX - w * 0.02, shY + h * 0.04, shX + w * 0.10 - arm * w * 0.05, feetY, w * 0.09, skinDk);

  // torso: a low slab, hunched at the shoulders
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(hipX - w * 0.06, hipY + h * 0.14);
  ctx.lineTo(hipX - w * 0.04, hipY - h * 0.10);
  ctx.lineTo(shX + w * 0.02, shY - h * 0.10);
  ctx.lineTo(shX + w * 0.12, shY - h * 0.02);
  ctx.lineTo(shX + w * 0.10, shY + h * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = clothDk;
  ctx.beginPath();
  ctx.moveTo(hipX - w * 0.06, hipY + h * 0.14);
  ctx.lineTo(hipX - w * 0.04, hipY - h * 0.10);
  ctx.lineTo(cx, shY - h * 0.05);
  ctx.lineTo(cx - w * 0.02, hipY + h * 0.15);
  ctx.closePath();
  ctx.fill();

  // near arm, reaching east and down to the ground
  limb(ctx, shX + w * 0.06, shY + h * 0.04, shX + w * 0.22 + arm * w * 0.06, feetY - h * 0.02, w * 0.10, skin);
  ctx.fillStyle = skin;
  ctx.fillRect(shX + w * 0.20 + arm * w * 0.06, feetY - h * 0.06, w * 0.09, h * 0.06);

  // head, low at the east end, looking at the ground ahead
  head(ctx, shX + w * 0.20, shY - h * 0.02, headR, si, (build >>> 16) & 3, 0.4, false);
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD_HI[si];
    ctx.fillRect(shX + w * 0.24, shY + h * 0.06, headR * 0.5, headR * 0.5);
  }
}

// ============================================================================
// The survivor. Big enough to read as a person at the wall, holding a
// scavenged bolt-action rifle that follows the cursor.
// ============================================================================

/** total survivor height, in cell heights */
export const SURVIVOR_H = 4.0;

/**
 * @param out receives [gunX, gunY] so the muzzle flash and tracer agree with
 *            the drawn rifle without allocating a point object.
 */
export function drawSurvivor(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, ch: number,
  aimX: number, aimY: number, breathe: number,
  out: Float64Array,
): void {
  const h = ch * SURVIVOR_H;
  const w = h * 0.32;
  const bob = breathe * h * 0.005;

  const hipY = feetY - h * 0.50 + bob;
  const shY = feetY - h * 0.79 + bob;
  const headY = feetY - h * 0.90 + bob;
  const kneeY = feetY - h * 0.26;

  // shadow
  ctx.globalAlpha = 0.42;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp, feetY, w * 0.95, ch * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';

  // legs — braced stance, weight on the back (east) foot; trousers to the boot
  const legW = w * 0.30;
  limb(ctx, cxp - w * 0.08, hipY, cxp - w * 0.34, kneeY, legW, PALETTE.trouser);
  limb(ctx, cxp - w * 0.34, kneeY, cxp - w * 0.46, feetY - legW * 0.3, legW * 0.9, PALETTE.trouser);
  limb(ctx, cxp + w * 0.14, hipY, cxp + w * 0.36, kneeY, legW, '#2c313a');
  limb(ctx, cxp + w * 0.36, kneeY, cxp + w * 0.52, feetY - legW * 0.3, legW * 0.9, '#2c313a');
  // boots: a squarer mass than the trouser line, toes west
  ctx.fillStyle = '#12151a';
  ctx.fillRect(cxp - w * 0.80, feetY - h * 0.038, w * 0.56, h * 0.040);
  ctx.fillRect(cxp + w * 0.24, feetY - h * 0.038, w * 0.56, h * 0.040);

  // --- the aim basis ------------------------------------------------------
  // The rifle pivots at the firing shoulder. (ux,uy) points down the barrel,
  // (rx,ry) is perpendicular with +b meaning "below the barrel".
  const sX = cxp + w * 0.02;
  const sY = shY + h * 0.07;
  let dx = aimX - sX;
  let dy = aimY - sY;
  if (dx > -1) dx = -1;                       // he always aims left, downrange
  let len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0.0001)) { dx = -1; dy = 0; len = 1; }
  const ux = dx / len, uy = dy / len;
  const rx = uy, ry = -ux;
  const pt = PT;
  const at = (a: number, b: number): void => {
    pt[0] = sX + ux * a + rx * b;
    pt[1] = sY + uy * a + ry * b;
  };

  // far arm (east shoulder) to the grip, drawn behind the torso
  at(h * 0.09, h * 0.06);
  const gripX = pt[0], gripY = pt[1];
  limb(ctx, cxp + w * 0.30, shY + h * 0.05, gripX, gripY, w * 0.26, PALETTE.jacketDk);

  // torso — the field jacket: broad shoulders, leaning west over the rifle,
  // a hem below the hips. Lit face east, shadow face west.
  const lean = w * 0.14;
  ctx.fillStyle = PALETTE.jacket;
  ctx.beginPath();
  ctx.moveTo(cxp - w * 0.58 - lean, shY + h * 0.03);        // west shoulder
  ctx.lineTo(cxp - w * 0.26 - lean, shY - h * 0.02);        // collar
  ctx.lineTo(cxp + w * 0.30, shY - h * 0.01);
  ctx.lineTo(cxp + w * 0.56, shY + h * 0.05);               // east shoulder
  ctx.lineTo(cxp + w * 0.52, hipY + h * 0.08);              // hem, east corner
  ctx.lineTo(cxp - w * 0.54 - lean * 0.4, hipY + h * 0.09);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.jacketDk;                          // shadowed west face
  ctx.beginPath();
  ctx.moveTo(cxp - w * 0.58 - lean, shY + h * 0.03);
  ctx.lineTo(cxp - w * 0.26 - lean, shY - h * 0.02);
  ctx.lineTo(cxp - w * 0.14, shY);
  ctx.lineTo(cxp - w * 0.12, hipY + h * 0.085);
  ctx.lineTo(cxp - w * 0.54 - lean * 0.4, hipY + h * 0.09);
  ctx.closePath();
  ctx.fill();
  // collar and the lit seam down the front
  ctx.fillStyle = PALETTE.jacketHi;
  ctx.fillRect(cxp - w * 0.24, shY - h * 0.018, w * 0.50, h * 0.022 < 1 ? 1 : h * 0.022);
  ctx.fillRect(cxp + w * 0.02, shY + h * 0.02, h * 0.012 < 1 ? 1 : h * 0.012, hipY - shY + h * 0.05);
  // a shirt at the throat
  ctx.fillStyle = '#c9cbbd';
  ctx.fillRect(cxp - w * 0.14, shY - h * 0.01, w * 0.14, h * 0.035);

  // head: skull with cropped hair and a short neck, cheek down on the stock
  const hr = h * 0.068;
  const hx = cxp - w * 0.12;
  ctx.fillStyle = PALETTE.skinDk;
  ctx.fillRect(cxp - w * 0.16, headY + hr * 0.6, w * 0.28, hr * 0.7);
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.ellipse(hx, headY, hr * 0.94, hr * 1.02, -0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.skinDk;                            // face in shadow (he faces away from the lamp)
  ctx.beginPath();
  ctx.ellipse(hx, headY, hr * 0.94, hr * 1.02, -0.10, Math.PI * 0.5, Math.PI * 1.5);
  ctx.fill();
  ctx.fillStyle = '#1e1a17';                                 // hair
  ctx.beginPath();
  ctx.ellipse(hx + hr * 0.05, headY - hr * 0.40, hr * 0.96, hr * 0.62, -0.10, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d0f12';                                 // eye, squinting down the sights
  ctx.fillRect(hx - hr * 0.62, headY - hr * 0.10, hr * 0.28, hr * 0.14);

  // rim: the lamp sits above and east of him, so the light rides the back of
  // the shoulders and the crown while his face and chest stay dark.
  ctx.strokeStyle = 'rgba(240,220,170,0.60)';
  ctx.lineWidth = h * 0.014 < 1 ? 1 : h * 0.014;
  ctx.beginPath();
  ctx.moveTo(cxp + w * 0.52, hipY + h * 0.06);
  ctx.lineTo(cxp + w * 0.56, shY + h * 0.05);
  ctx.lineTo(cxp + w * 0.30, shY - h * 0.01);
  ctx.moveTo(hx + hr * 0.95, headY + hr * 0.30);
  ctx.lineTo(hx + hr * 0.90, headY - hr * 0.50);
  ctx.lineTo(hx + hr * 0.30, headY - hr * 1.0);
  ctx.stroke();

  // --- the rifle ------------------------------------------------------------
  // A scavenged bolt-action: wooden stock from the butt behind the shoulder
  // to the forestock, a steel barrel running on past it, the bolt and the
  // trigger guard. Built in the aim basis so it holds at any angle.
  const L = h * 0.74;            // shoulder to muzzle
  const butt = -h * 0.09;
  ctx.fillStyle = PALETTE.stock;
  ctx.beginPath();
  at(butt, -h * 0.040); ctx.moveTo(pt[0], pt[1]);           // butt, top
  at(h * 0.06, -h * 0.026); ctx.lineTo(pt[0], pt[1]);        // comb
  at(L * 0.60, -h * 0.018); ctx.lineTo(pt[0], pt[1]);        // forestock, top
  at(L * 0.60, h * 0.016); ctx.lineTo(pt[0], pt[1]);         // forestock, under
  at(h * 0.14, h * 0.020); ctx.lineTo(pt[0], pt[1]);         // wrist
  at(h * 0.02, h * 0.052); ctx.lineTo(pt[0], pt[1]);         // grip
  at(butt, h * 0.050); ctx.lineTo(pt[0], pt[1]);             // butt, under
  ctx.closePath();
  ctx.fill();
  // barrel and receiver
  ctx.fillStyle = PALETTE.steel;
  ctx.beginPath();
  at(h * 0.04, -h * 0.034); ctx.moveTo(pt[0], pt[1]);
  at(L, -h * 0.012); ctx.lineTo(pt[0], pt[1]);
  at(L, h * 0.004); ctx.lineTo(pt[0], pt[1]);
  at(h * 0.20, h * 0.000); ctx.lineTo(pt[0], pt[1]);
  at(h * 0.04, -h * 0.010); ctx.lineTo(pt[0], pt[1]);
  ctx.closePath();
  ctx.fill();
  // bolt handle, sticking up and back; trigger guard hanging under the wrist
  ctx.strokeStyle = PALETTE.steelHi;
  ctx.lineWidth = h * 0.012 < 1 ? 1 : h * 0.012;
  ctx.beginPath();
  at(h * 0.09, -h * 0.034); ctx.moveTo(pt[0], pt[1]);
  at(h * 0.06, -h * 0.062); ctx.lineTo(pt[0], pt[1]);
  at(L, -h * 0.012); ctx.moveTo(pt[0], pt[1]);              // the lamp along the top of the barrel
  at(h * 0.22, -h * 0.026); ctx.lineTo(pt[0], pt[1]);
  ctx.stroke();
  ctx.strokeStyle = PALETTE.steel;
  ctx.beginPath();
  at(h * 0.12, h * 0.020); ctx.moveTo(pt[0], pt[1]);
  at(h * 0.14, h * 0.046); ctx.lineTo(pt[0], pt[1]);
  at(h * 0.20, h * 0.046); ctx.lineTo(pt[0], pt[1]);
  ctx.stroke();
  // wood grain highlight on the comb
  ctx.strokeStyle = PALETTE.stockHi;
  ctx.beginPath();
  at(butt + h * 0.02, -h * 0.030); ctx.moveTo(pt[0], pt[1]);
  at(h * 0.05, -h * 0.020); ctx.lineTo(pt[0], pt[1]);
  ctx.stroke();

  // near arm (west shoulder) out to the forestock, and both hands
  at(L * 0.50, h * 0.030);
  const foreX = pt[0], foreY = pt[1];
  limb(ctx, cxp - w * 0.40 - lean * 0.5, shY + h * 0.06, (cxp - w * 0.40 + foreX) * 0.5, (shY + h * 0.06 + foreY) * 0.5 + h * 0.06, w * 0.28, PALETTE.jacket);
  limb(ctx, (cxp - w * 0.40 + foreX) * 0.5, (shY + h * 0.06 + foreY) * 0.5 + h * 0.06, foreX, foreY, w * 0.25, PALETTE.jacketHi);
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(foreX, foreY, h * 0.026, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.arc(gripX, gripY, h * 0.024, 0, Math.PI * 2);
  ctx.fill();

  at(L * 1.02, -h * 0.004);
  out[0] = pt[0];
  out[1] = pt[1];
}
