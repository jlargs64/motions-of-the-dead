// ============================================================================
// Phase C — Renderer. Procedural figures: the horde and the survivor.
//
// Every figure is a handful of fills and one stroked path. Nothing here
// allocates: all parameters are numbers, the gait tables are module-level
// typed arrays, and the one "return value" is written into a caller-owned
// Float64Array.
//
// Zombies face RIGHT (the direction they walk). The survivor faces LEFT.
// ============================================================================
import { PALETTE } from './palette';

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
const FIG_H = new Float32Array([1.34, 1.34, 1.28, 1.40, 0.58]);
/** figure width as a fraction of its own height */
const FIG_W = new Float32Array([0.44, 0.50, 0.34, 0.78, 1.55]);
/** forward lean, in fractions of height */
const FIG_LEAN = new Float32Array([0.07, 0.06, 0.26, 0.12, 0]);

/** Height of a figure in cell heights, for the caller's layout maths. */
export function figureHeightCells(kindIdx: number): number {
  return FIG_H[kindIdx];
}

/** Width of a figure in cell heights. */
export function figureWidthCells(kindIdx: number): number {
  return FIG_H[kindIdx] * FIG_W[kindIdx];
}

/**
 * Draw one shambling zombie, centred on `cxp`, standing on `feetY`.
 *
 * @param step    0..3 gait frame
 * @param twitch  0..1 extra jitter as it closes on the wall
 * @param jitter  signed -1..1 deterministic noise for the twitch direction
 * @param bloody  false when gore is off
 */
export function drawZombie(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, ch: number,
  kindIdx: number, step: number, twitch: number, jitter: number, bloody: boolean,
): void {
  const h = ch * FIG_H[kindIdx];
  const w = h * FIG_W[kindIdx];
  const leg = GAIT_LEG[step & 3];
  const arm = GAIT_ARM[step & 3];
  const bob = GAIT_BOB[step & 3] * h * 0.022;
  const tx = jitter * twitch * h * 0.05;
  const ty = bob + jitter * twitch * h * 0.035;

  // ground contact shadow
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp, feetY, w * 0.62, ch * 0.10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (kindIdx === F_CRAWLER) {
    drawCrawler(ctx, cxp + tx, feetY + ty, h, w, step, bloody);
    return;
  }

  const lean = FIG_LEAN[kindIdx] * h;
  const hipY = feetY - h * 0.36 + ty;
  const shY = feetY - h * 0.74 + ty;
  const headY = feetY - h * 0.86 + ty;
  const hipX = cxp + tx + lean * 0.35;
  const shX = cxp + tx + lean;
  const headX = shX + lean * 0.30;

  // --- limbs: one stroked path for both legs and both arms ------------------
  ctx.strokeStyle = PALETTE.zCloth;
  ctx.lineWidth = Math.max(1, w * 0.26);
  ctx.lineCap = 'round';
  ctx.beginPath();
  // legs
  const stride = h * (kindIdx === F_RUNNER ? 0.20 : 0.13) * leg;
  ctx.moveTo(hipX - w * 0.16, hipY);
  ctx.lineTo(hipX - w * 0.16 + stride, feetY);
  ctx.moveTo(hipX + w * 0.16, hipY);
  ctx.lineTo(hipX + w * 0.16 - stride, feetY);
  // arms: zombies reach forward (to the right)
  const reach = h * (kindIdx === F_RUNNER ? 0.34 : 0.30);
  const drop = h * (0.10 + arm * 0.07);
  ctx.moveTo(shX - w * 0.10, shY);
  ctx.lineTo(shX + reach * 0.85, shY + drop + h * 0.05);
  ctx.moveTo(shX + w * 0.08, shY + h * 0.02);
  ctx.lineTo(shX + reach, shY + drop - h * 0.04);
  ctx.stroke();

  // hands
  ctx.fillStyle = PALETTE.zSkinDark;
  ctx.fillRect(shX + reach * 0.85 - w * 0.09, shY + drop + h * 0.02, w * 0.19, w * 0.19);
  ctx.fillRect(shX + reach - w * 0.09, shY + drop - h * 0.07, w * 0.19, w * 0.19);

  // --- torso ---------------------------------------------------------------
  const tw = w;
  const th = hipY - shY;
  ctx.fillStyle = PALETTE.zCloth;
  ctx.fillRect(hipX - tw * 0.5, shY, tw, feetY - h * 0.34 - shY);
  // ragged shoulder highlight
  ctx.fillStyle = PALETTE.zClothHi;
  ctx.fillRect(shX - tw * 0.5, shY, tw, Math.max(1, h * 0.06));
  // torn hem
  ctx.fillStyle = PALETTE.zCloth;
  ctx.fillRect(hipX - tw * 0.5, hipY - th * 0.02, tw * 0.34, h * 0.06);
  ctx.fillRect(hipX + tw * 0.06, hipY - th * 0.02, tw * 0.30, h * 0.09);

  if (kindIdx === F_ARMORED) {
    // scrap plate strapped over the chest — matches the green brackets
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(shX - tw * 0.40, shY + h * 0.05, tw * 0.80, h * 0.17);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fillRect(shX - tw * 0.40, shY + h * 0.05, tw * 0.80, Math.max(1, h * 0.02));
    ctx.fillStyle = PALETTE.zClothHi;
    ctx.fillRect(shX - tw * 0.46, shY + h * 0.03, tw * 0.06, h * 0.22);
    ctx.fillRect(shX + tw * 0.40, shY + h * 0.03, tw * 0.06, h * 0.22);
  }

  if (kindIdx === F_BLOATER) {
    // distended gut slumping forward
    ctx.fillStyle = PALETTE.zSkinDark;
    ctx.beginPath();
    ctx.ellipse(hipX + tw * 0.16, hipY - h * 0.10, tw * 0.42, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- head ----------------------------------------------------------------
  const hr = h * (kindIdx === F_BLOATER ? 0.125 : 0.115);
  ctx.fillStyle = PALETTE.zSkin;
  ctx.beginPath();
  ctx.ellipse(headX, headY, hr * 0.92, hr, 0, 0, Math.PI * 2);
  ctx.fill();
  // jaw / eye socket, facing right
  ctx.fillStyle = PALETTE.zSkinDark;
  ctx.fillRect(headX + hr * 0.10, headY - hr * 0.22, hr * 0.55, Math.max(1, hr * 0.26));

  if (bloody) {
    ctx.fillStyle = PALETTE.zBlood;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(headX - hr * 0.2, headY + hr * 0.35, hr * 0.7, hr * 0.9);
    ctx.fillRect(hipX - tw * 0.22, shY + h * 0.12, tw * 0.30, h * 0.07);
    ctx.globalAlpha = 1;
  }
}

function drawCrawler(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, h: number, w: number, step: number, bloody: boolean,
): void {
  const arm = GAIT_ARM[step & 3];
  const bodyY = feetY - h * 0.42;
  ctx.strokeStyle = PALETTE.zCloth;
  ctx.lineWidth = Math.max(1, h * 0.20);
  ctx.lineCap = 'round';
  ctx.beginPath();
  // dragged legs trailing left
  ctx.moveTo(cxp - w * 0.10, bodyY + h * 0.10);
  ctx.lineTo(cxp - w * 0.46, feetY - h * 0.02);
  ctx.moveTo(cxp - w * 0.10, bodyY + h * 0.14);
  ctx.lineTo(cxp - w * 0.40, feetY + h * 0.04);
  // one arm clawing forward
  ctx.moveTo(cxp + w * 0.06, bodyY + h * 0.06);
  ctx.lineTo(cxp + w * 0.40, bodyY + h * (0.20 + arm * 0.10));
  ctx.stroke();

  ctx.fillStyle = PALETTE.zCloth;
  ctx.fillRect(cxp - w * 0.20, bodyY, w * 0.40, h * 0.34);
  ctx.fillStyle = PALETTE.zSkin;
  ctx.beginPath();
  ctx.ellipse(cxp + w * 0.22, bodyY + h * 0.06, h * 0.13, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  if (bloody) {
    ctx.fillStyle = PALETTE.zBlood;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(cxp - w * 0.30, feetY - h * 0.06, w * 0.34, h * 0.10);
    ctx.globalAlpha = 1;
  }
}

// ============================================================================
// The survivor. Small, dark, scenery — with one moving part: the aiming arm.
// ============================================================================

/** total survivor height, in cell heights */
export const SURVIVOR_H = 3.1;

/**
 * @param out receives [gunX, gunY] so the muzzle flash and tracer agree with
 *            the drawn arm without allocating a point object.
 */
export function drawSurvivor(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, ch: number,
  aimX: number, aimY: number, breathe: number,
  out: Float64Array,
): void {
  const h = ch * SURVIVOR_H;
  const w = h * 0.30;
  const bob = breathe * h * 0.006;

  const hipY = feetY - h * 0.44 + bob;
  const shY = feetY - h * 0.76 + bob;
  const headY = feetY - h * 0.88 + bob;

  // shadow
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp, feetY, w * 0.85, ch * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // legs — braced stance, back foot planted right
  ctx.strokeStyle = PALETTE.trouser;
  ctx.lineWidth = Math.max(1, w * 0.32);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cxp - w * 0.10, hipY); ctx.lineTo(cxp - w * 0.55, feetY);
  ctx.moveTo(cxp + w * 0.14, hipY); ctx.lineTo(cxp + w * 0.62, feetY);
  ctx.stroke();

  // back arm, tucked
  ctx.strokeStyle = PALETTE.jacket;
  ctx.lineWidth = Math.max(1, w * 0.28);
  ctx.beginPath();
  ctx.moveTo(cxp + w * 0.10, shY + h * 0.04);
  ctx.lineTo(cxp + w * 0.34, shY + h * 0.20);
  ctx.stroke();

  // torso — the green jacket
  ctx.fillStyle = PALETTE.jacket;
  ctx.fillRect(cxp - w * 0.5, shY, w, hipY - shY + h * 0.04);
  ctx.fillStyle = PALETTE.jacketHi;
  ctx.fillRect(cxp - w * 0.5, shY, w, Math.max(1, h * 0.035));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cxp + w * 0.28, shY, w * 0.22, hipY - shY + h * 0.04);

  // head + dark hair
  const hr = h * 0.085;
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.ellipse(cxp - w * 0.06, headY, hr * 0.9, hr, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1e1a17';
  ctx.fillRect(cxp - w * 0.06 - hr * 0.9, headY - hr * 1.0, hr * 1.9, hr * 0.8);

  // --- the aiming arm ------------------------------------------------------
  const shoulderX = cxp - w * 0.16;
  const shoulderY = shY + h * 0.07;
  let dx = aimX - shoulderX;
  let dy = aimY - shoulderY;
  if (dx > -1) dx = -1;                       // he always aims left, downrange
  let len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0.0001)) { dx = -1; dy = 0; len = 1; }
  const ux = dx / len;
  const uy = dy / len;
  const armLen = h * 0.30;
  const gx = shoulderX + ux * armLen;
  const gy = shoulderY + uy * armLen;

  ctx.strokeStyle = PALETTE.jacket;
  ctx.lineWidth = Math.max(1, w * 0.30);
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(gx, gy);
  ctx.stroke();

  // pistol: a short dark stub continuing the arm line
  ctx.strokeStyle = '#15181d';
  ctx.lineWidth = Math.max(1, w * 0.20);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(gx + ux * h * 0.14, gy + uy * h * 0.14);
  ctx.stroke();
  ctx.lineCap = 'round';

  out[0] = gx + ux * h * 0.15;
  out[1] = gy + uy * h * 0.15;
}
