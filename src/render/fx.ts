// ============================================================================
// Phase C — Renderer. Screen-level effect timers + the shot ring.
//
// Pure state + update(dtMs). This file owns none of the canvas. Every field is
// a number or a typed array, so there is nothing to allocate and nothing to
// collect.
// ============================================================================

export const SHAKE_MAX = 14;         // shake units; 1 unit ~= SHAKE_UNIT cells
export const LANE_FLASH_MS = 220;
export const LANE_FLASH_WHITE_MS = 60;
export const OVERKILL_MS = 500;
/** How long a refusal notice stays up. Long enough to read mid-fight. */
export const NOTICE_MS = 1400;
export const SWEEP_MS = 700;

/** A live shot: muzzle flash, tracer, and the covered-span underline. */
export const SHOT_CAP = 12;
export const MUZZLE_MS = 60;
export const TRACER_MS = 110;
export const SHOT_MS = 240;

export class Fx {
  /** current shake amplitude in cell-height units */
  shake = 0;
  /** 0..1 white full-screen flash */
  white = 0;
  /** 0..1 blood full-screen flash */
  red = 0;
  /** red edge vignette pulse, 0..1 */
  vignette = 0;
  /** full-lane detonation flash: lane index, and ms elapsed */
  laneFlashRow = -1;
  laneFlashMs = 0;
  /** OVERKILL stamp, ms remaining of OVERKILL_MS */
  overkill = 0;
  /** Refusal notice, ms remaining of NOTICE_MS. The text lives on Renderer. */
  notice = 0;
  /** wave sweep, ms elapsed, or -1 when idle */
  sweepMs = -1;
  /** combo counter punch, 0..1 */
  comboPop = 0;
  /** ms remaining of the gun's muzzle flash */
  muzzle = 0;

  // --- shot ring (fixed capacity, no allocation) -----------------------------
  readonly shotRow = new Int16Array(SHOT_CAP);
  readonly shotC0 = new Int16Array(SHOT_CAP);
  readonly shotC1 = new Int16Array(SHOT_CAP);
  readonly shotHits = new Int16Array(SHOT_CAP);
  readonly shotAge = new Float32Array(SHOT_CAP);
  shotCount = 0;
  private shotRing = 0;

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    if (this.shake > 0) {
      this.shake -= this.shake * Math.min(1, 9 * dt) + 1.6 * dt;
      if (this.shake < 0.02) this.shake = 0;
    }
    if (this.white > 0) { this.white -= dt * 5.5; if (this.white < 0) this.white = 0; }
    if (this.red > 0) { this.red -= dt * 3.6; if (this.red < 0) this.red = 0; }
    if (this.vignette > 0) { this.vignette -= dt * 2.2; if (this.vignette < 0) this.vignette = 0; }
    if (this.comboPop > 0) { this.comboPop -= dt * 4.5; if (this.comboPop < 0) this.comboPop = 0; }
    if (this.overkill > 0) { this.overkill -= dtMs; if (this.overkill < 0) this.overkill = 0; }
    if (this.notice > 0) { this.notice -= dtMs; if (this.notice < 0) this.notice = 0; }
    if (this.muzzle > 0) { this.muzzle -= dtMs; if (this.muzzle < 0) this.muzzle = 0; }
    if (this.laneFlashRow >= 0) {
      this.laneFlashMs += dtMs;
      if (this.laneFlashMs >= LANE_FLASH_MS) { this.laneFlashRow = -1; this.laneFlashMs = 0; }
    }
    if (this.sweepMs >= 0) {
      this.sweepMs += dtMs;
      if (this.sweepMs >= SWEEP_MS) this.sweepMs = -1;
    }
    // age shots and compact the live prefix
    let i = 0;
    while (i < this.shotCount) {
      const a = this.shotAge[i] + dtMs;
      if (a >= SHOT_MS) {
        const last = --this.shotCount;
        if (i !== last) {
          this.shotRow[i] = this.shotRow[last];
          this.shotC0[i] = this.shotC0[last];
          this.shotC1[i] = this.shotC1[last];
          this.shotHits[i] = this.shotHits[last];
          this.shotAge[i] = this.shotAge[last];
        }
        continue;
      }
      this.shotAge[i] = a;
      i++;
    }
  }

  addShot(row: number, c0: number, c1: number, hits: number): void {
    let i: number;
    if (this.shotCount < SHOT_CAP) { i = this.shotCount++; }
    else { i = this.shotRing; this.shotRing = (this.shotRing + 1) % SHOT_CAP; }
    this.shotRow[i] = row;
    this.shotC0[i] = c0;
    this.shotC1[i] = c1;
    this.shotHits[i] = hits;
    this.shotAge[i] = 0;
    if (this.muzzle < MUZZLE_MS) this.muzzle = MUZZLE_MS;
  }

  addShake(m: number): void {
    const v = this.shake + m;
    this.shake = v > SHAKE_MAX ? SHAKE_MAX : v;
  }
  flashWhite(v: number): void { if (v > this.white) this.white = v; }
  flashRed(v: number): void { if (v > this.red) this.red = v; }
  pulseVignette(v: number): void { if (v > this.vignette) this.vignette = v; }
  stampOverkill(): void { this.overkill = OVERKILL_MS; }
  stampNotice(): void { this.notice = NOTICE_MS; }
  detonateLane(row: number): void { this.laneFlashRow = row; this.laneFlashMs = 0; }
  sweep(): void { this.sweepMs = 0; }
  popCombo(): void { this.comboPop = 1; }

  reset(): void {
    this.shake = 0; this.white = 0; this.red = 0; this.vignette = 0;
    this.laneFlashRow = -1; this.laneFlashMs = 0;
    this.overkill = 0; this.notice = 0; this.sweepMs = -1; this.comboPop = 0;
    this.muzzle = 0; this.shotCount = 0; this.shotRing = 0;
  }
}

/** Cheap deterministic hash of three ints -> uint32. No allocation. */
export function hash3(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
