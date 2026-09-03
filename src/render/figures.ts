// ============================================================================
// Phase C — Renderer. Procedural figures: the horde and the survivor.
//
// Art direction: *The Last Stand*. Zombies are tall, gaunt, hunched
// silhouettes — a dark body with one warm rim where the floodlight catches the
// east edge. Nothing here allocates: every parameter is a number, the gait
// tables are module-level typed arrays, per-zombie variation is re-derived
// from the id with `hash3` each frame, and the one "return value" is written
// into a caller-owned Float64Array.
//
// Zombies face RIGHT (the direction they walk). The survivor faces LEFT.
// ============================================================================
import {
  FIG_BLOOD, FIG_BODY, FIG_PLATE, FIG_RIM, FIG_SKIN, PALETTE, SHADE_STEPS,
} from './palette';
import { hash3 } from './fx';

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
const FIG_H = new Float32Array([3.2, 3.2, 3.0, 3.35, 1.1]);
/** figure width as a fraction of its own height */
const FIG_W = new Float32Array([0.38, 0.42, 0.30, 0.72, 1.6]);
/** forward lean, in fractions of height */
const FIG_LEAN = new Float32Array([0.06, 0.05, 0.26, 0.10, 0]);

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
 */
export function drawZombie(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, ch: number,
  kindIdx: number, step: number, twitch: number, jitter: number, bloody: boolean,
  shade: number, id: number,
): void {
  const si = shade <= 0 ? 0 : shade >= 1 ? SHADE_STEPS - 1 : (shade * (SHADE_STEPS - 1) + 0.5) | 0;
  const build = hash3(id, 0x5a, 0x77);
  const hs = 0.9 + (build & 255) / 255 * 0.2;              // height scale
  const hunch = ((build >>> 8) & 255) / 255;               // 0..1
  const headKind = (build >>> 16) & 3;                     // 0..3 head shapes
  const h = ch * FIG_H[kindIdx] * hs;
  const w = h * FIG_W[kindIdx];
  const leg = GAIT_LEG[step & 3];
  const arm = GAIT_ARM[step & 3];
  const bob = GAIT_BOB[step & 3] * h * 0.016;
  const tx = jitter * twitch * h * 0.04;
  const ty = bob + jitter * twitch * h * 0.025;

  // ground contact shadow — longer toward the west, away from the lamp
  ctx.globalAlpha = 0.32;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp - w * 0.25, feetY, w * 0.85, ch * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (kindIdx === F_CRAWLER) {
    drawCrawler(ctx, cxp + tx, feetY + ty, h, w, step, bloody, si, build);
    return;
  }

  const body = FIG_BODY[si];
  const lean = FIG_LEAN[kindIdx] * h;
  const hipY = feetY - h * 0.46 + ty;
  const shY = feetY - h * (0.78 - hunch * 0.05) + ty;
  const hipX = cxp + tx + lean * 0.30;
  const shX = cxp + tx + lean * 0.85;
  // the head hangs forward and down off hunched shoulders
  const headR = h * (kindIdx === F_BLOATER ? 0.085 : 0.072);
  const headX = shX + w * (0.18 + hunch * 0.22);
  const headY = shY - headR * (1.15 - hunch * 0.45);

  // --- legs: one stroked path -------------------------------------------------
  ctx.strokeStyle = body;
  ctx.lineWidth = Math.max(1, w * 0.22);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const stride = h * (kindIdx === F_RUNNER ? 0.20 : 0.11) * leg;
  ctx.moveTo(hipX - w * 0.18, hipY);
  ctx.lineTo(hipX - w * 0.18 + stride, feetY);
  ctx.moveTo(hipX + w * 0.18, hipY);
  ctx.lineTo(hipX + w * 0.18 - stride, feetY);
  ctx.stroke();

  // --- torso silhouette: one filled path with a ragged hem -------------------
  ctx.fillStyle = body;
  ctx.beginPath();
  // gaunt: shoulders wider than the hips, one shoulder hitched up
  ctx.moveTo(hipX - w * 0.36, hipY);
  ctx.lineTo(shX - w * 0.55, shY + h * 0.05);            // back, flaring to the shoulder
  ctx.lineTo(shX - w * 0.34, shY - h * 0.035 - hunch * h * 0.025);   // hunched shoulder
  ctx.lineTo(shX + w * 0.06, shY - h * 0.015);            // neck
  ctx.lineTo(shX + w * 0.50, shY + h * 0.05);             // front shoulder
  ctx.lineTo(hipX + w * 0.38, hipY);                      // front, tapering in
  // hem: four jittered points below the hips
  for (let k = 0; k < 4; k++) {
    const hh = hash3(id, k, 0x3c);
    const fx = hipX + w * (0.38 - k * 0.25) - w * 0.06 * ((hh & 15) / 15);
    const fy = hipY + h * (0.03 + 0.09 * (((hh >>> 4) & 15) / 15));
    ctx.lineTo(fx, fy);
  }
  ctx.lineTo(hipX - w * 0.36, hipY + h * 0.02);
  ctx.closePath();
  ctx.fill();

  if (kindIdx === F_BLOATER) {
    // distended gut slumping forward
    ctx.beginPath();
    ctx.ellipse(hipX + w * 0.14, hipY - h * 0.12, w * 0.48, h * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- arms: dangling forward, out of phase with the legs ----------------------
  ctx.lineWidth = Math.max(1, w * 0.17);
  ctx.beginPath();
  const reach = h * (kindIdx === F_RUNNER ? 0.34 : 0.27);
  const drop = h * (0.20 + arm * 0.05);
  // far arm (west, drawn first so the near one overlaps)
  ctx.moveTo(shX - w * 0.30, shY + h * 0.04);
  ctx.lineTo(shX + reach * 0.70 - arm * w * 0.2, shY + drop + h * 0.06);
  // near arm, reaching further
  ctx.moveTo(shX + w * 0.30, shY + h * 0.03);
  ctx.lineTo(shX + reach, shY + drop - h * 0.03 + arm * h * 0.02);
  ctx.stroke();
  // hands: a pale smudge at the end of each arm
  ctx.fillStyle = FIG_SKIN[si];
  ctx.fillRect(shX + reach * 0.70 - arm * w * 0.2 - w * 0.06, shY + drop + h * 0.05, w * 0.14, w * 0.14);
  ctx.fillRect(shX + reach - w * 0.06, shY + drop - h * 0.04 + arm * h * 0.02, w * 0.16, w * 0.16);

  if (kindIdx === F_ARMORED) {
    // scrap plate strapped over the chest — the same green as the brackets
    ctx.fillStyle = FIG_PLATE[si];
    ctx.fillRect(shX - w * 0.42, shY + h * 0.05, w * 0.84, h * 0.19);
    ctx.fillStyle = body;
    ctx.fillRect(shX - w * 0.42, shY + h * 0.115, w * 0.84, Math.max(1, h * 0.012));
  }

  // --- head ---------------------------------------------------------------
  const skin = FIG_SKIN[si];
  ctx.fillStyle = skin;
  ctx.beginPath();
  if (headKind === 1) ctx.ellipse(headX, headY, headR * 0.80, headR * 1.08, 0.18, 0, Math.PI * 2);
  else if (headKind === 2) ctx.ellipse(headX, headY + headR * 0.1, headR * 0.95, headR * 0.92, -0.25, 0, Math.PI * 2);
  else ctx.ellipse(headX, headY, headR * 0.88, headR, 0, 0, Math.PI * 2);
  ctx.fill();
  // skull cap / hair on the dark side, and a jaw shadow under the brow
  ctx.fillStyle = body;
  ctx.fillRect(headX - headR * 0.95, headY - headR * 1.0, headR * (headKind === 3 ? 1.6 : 1.2), headR * 0.55);
  ctx.fillRect(headX - headR * 0.2, headY - headR * 0.05, headR * 0.9, Math.max(1, headR * 0.22));

  // --- rim: the lamp catches the east edge ----------------------------------
  ctx.strokeStyle = FIG_RIM[si];
  ctx.lineWidth = Math.max(1, h * 0.02);
  ctx.beginPath();
  ctx.moveTo(hipX + w * 0.38, hipY + h * 0.04);
  ctx.lineTo(shX + w * 0.50, shY + h * 0.05);
  ctx.lineTo(shX + w * 0.08, shY - h * 0.012);
  ctx.moveTo(headX + headR * 0.55, headY + headR * 0.75);
  ctx.lineTo(headX + headR * 0.86, headY);
  ctx.lineTo(headX + headR * 0.45, headY - headR * 0.85);
  ctx.stroke();

  if (bloody) {
    // one wound, placed per zombie: a dark smear running down from it
    ctx.fillStyle = FIG_BLOOD[si];
    const bx = hipX - w * 0.28 + ((build >>> 20) & 7) * w * 0.06;
    const by = shY + h * (0.10 + ((build >>> 23) & 3) * 0.05);
    ctx.fillRect(bx, by, w * 0.20, h * 0.035);
    ctx.fillRect(bx + w * 0.05, by, w * 0.08, h * 0.14);
  }
}

function drawCrawler(
  ctx: CanvasRenderingContext2D,
  cxp: number, feetY: number, h: number, w: number, step: number, bloody: boolean,
  si: number, build: number,
): void {
  const arm = GAIT_ARM[step & 3];
  const body = FIG_BODY[si];
  const bodyY = feetY - h * 0.40;
  ctx.strokeStyle = body;
  ctx.lineWidth = Math.max(1, h * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  // dragged legs trailing west
  ctx.moveTo(cxp - w * 0.10, bodyY + h * 0.10);
  ctx.lineTo(cxp - w * 0.48, feetY - h * 0.02);
  ctx.moveTo(cxp - w * 0.10, bodyY + h * 0.16);
  ctx.lineTo(cxp - w * 0.42, feetY + h * 0.03);
  // one arm clawing east
  ctx.moveTo(cxp + w * 0.08, bodyY + h * 0.06);
  ctx.lineTo(cxp + w * 0.42, bodyY + h * (0.22 + arm * 0.12));
  ctx.stroke();

  // torso, hunched up at the shoulders
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(cxp - w * 0.24, bodyY + h * 0.36);
  ctx.lineTo(cxp - w * 0.22, bodyY + h * 0.06);
  ctx.lineTo(cxp + w * 0.06, bodyY - h * 0.04);
  ctx.lineTo(cxp + w * 0.20, bodyY + h * 0.02);
  ctx.lineTo(cxp + w * 0.18, bodyY + h * 0.36);
  ctx.closePath();
  ctx.fill();

  const hr = h * 0.14;
  ctx.fillStyle = FIG_SKIN[si];
  ctx.beginPath();
  ctx.ellipse(cxp + w * 0.24, bodyY + h * 0.08, hr, hr * 0.9, (build & 1) ? 0.3 : -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = FIG_RIM[si];
  ctx.lineWidth = Math.max(1, h * 0.03);
  ctx.beginPath();
  ctx.moveTo(cxp + w * 0.20, bodyY + h * 0.02);
  ctx.lineTo(cxp + w * 0.30, bodyY - h * 0.02);
  ctx.stroke();
  if (bloody) {
    ctx.fillStyle = FIG_BLOOD[si];
    ctx.globalAlpha = 0.8;
    ctx.fillRect(cxp - w * 0.34, feetY - h * 0.08, w * 0.36, h * 0.12);
    ctx.globalAlpha = 1;
  }
}

// ============================================================================
// The survivor. Big enough to read as a person at the wall, with one moving
// part: the aiming arm.
// ============================================================================

/** total survivor height, in cell heights */
export const SURVIVOR_H = 5.5;

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
  const w = h * 0.28;
  const bob = breathe * h * 0.005;

  const hipY = feetY - h * 0.46 + bob;
  const shY = feetY - h * 0.78 + bob;
  const headY = feetY - h * 0.89 + bob;

  // shadow
  ctx.globalAlpha = 0.40;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(cxp, feetY, w * 0.95, ch * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // legs — braced stance, back foot planted right
  ctx.strokeStyle = PALETTE.trouser;
  ctx.lineWidth = Math.max(1, w * 0.30);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cxp - w * 0.10, hipY); ctx.lineTo(cxp - w * 0.55, feetY);
  ctx.moveTo(cxp + w * 0.14, hipY); ctx.lineTo(cxp + w * 0.62, feetY);
  ctx.stroke();
  // boots
  ctx.fillStyle = '#15181d';
  ctx.fillRect(cxp - w * 0.78, feetY - h * 0.03, w * 0.42, h * 0.035);
  ctx.fillRect(cxp + w * 0.42, feetY - h * 0.03, w * 0.42, h * 0.035);

  // back arm, tucked
  ctx.strokeStyle = PALETTE.jacket;
  ctx.lineWidth = Math.max(1, w * 0.26);
  ctx.beginPath();
  ctx.moveTo(cxp + w * 0.10, shY + h * 0.04);
  ctx.lineTo(cxp + w * 0.34, shY + h * 0.20);
  ctx.stroke();

  // torso — the green jacket, lit from the lamp above and behind
  ctx.fillStyle = PALETTE.jacket;
  ctx.fillRect(cxp - w * 0.5, shY, w, hipY - shY + h * 0.04);
  ctx.fillStyle = PALETTE.jacketHi;
  ctx.fillRect(cxp - w * 0.5, shY, w, Math.max(1, h * 0.03));
  ctx.fillRect(cxp + w * 0.40, shY, w * 0.10, hipY - shY + h * 0.04);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(cxp - w * 0.5, shY, w * 0.22, hipY - shY + h * 0.04);
  // collar
  ctx.fillStyle = PALETTE.jacketHi;
  ctx.fillRect(cxp - w * 0.28, shY - h * 0.012, w * 0.56, Math.max(1, h * 0.02));

  // head + dark hair
  const hr = h * 0.075;
  ctx.fillStyle = PALETTE.skin;
  ctx.beginPath();
  ctx.ellipse(cxp - w * 0.06, headY, hr * 0.9, hr, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1e1a17';
  ctx.fillRect(cxp - w * 0.06 - hr * 0.9, headY - hr * 1.0, hr * 1.9, hr * 0.8);
  ctx.fillRect(cxp - w * 0.06 + hr * 0.45, headY - hr * 0.6, hr * 0.45, hr * 0.9);

  // --- the aiming arm ------------------------------------------------------
  const shoulderX = cxp - w * 0.16;
  const shoulderY = shY + h * 0.06;
  let dx = aimX - shoulderX;
  let dy = aimY - shoulderY;
  if (dx > -1) dx = -1;                       // he always aims left, downrange
  let len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0.0001)) { dx = -1; dy = 0; len = 1; }
  const ux = dx / len;
  const uy = dy / len;
  const armLen = h * 0.26;
  const gx = shoulderX + ux * armLen;
  const gy = shoulderY + uy * armLen;

  ctx.strokeStyle = PALETTE.jacket;
  ctx.lineWidth = Math.max(1, w * 0.28);
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(gx, gy);
  ctx.stroke();

  // the rifle: a long dark barrel continuing the arm line, stock tucked back
  ctx.strokeStyle = '#15181d';
  ctx.lineWidth = Math.max(1, w * 0.16);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(gx - ux * h * 0.10, gy - uy * h * 0.10);
  ctx.lineTo(gx + ux * h * 0.24, gy + uy * h * 0.24);
  ctx.stroke();
  ctx.lineCap = 'round';

  out[0] = gx + ux * h * 0.25;
  out[1] = gy + uy * h * 0.25;
}
