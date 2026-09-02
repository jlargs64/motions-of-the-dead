// ============================================================================
// Phase C — Renderer. Fixed-capacity struct-of-arrays particle pool.
//
// Positions are in *cell* units relative to field cell (0,0) so the pool is
// resolution independent: the renderer multiplies by cw/ch at blit time.
// Allocation happens exactly once, at construction. Removal is a swap with the
// last live slot and a decrement — no splice, no free list objects, no GC.
//
// Capacity is 2000: a high-combo bloater gib burst is ~180 particles and we
// want several of them in flight at once without recycling anything visible.
// ============================================================================

export const PARTICLE_CAP = 2000;

/** particle kinds */
export const K_GLYPH = 0;  // blit a character from the glyph atlas
export const K_CHUNK = 1;  // blit a tumbling gib from the chunk atlas

/** flags */
export const P_BLEEDS = 1; // deposits persistent gore where it lands
export const P_GHOST = 2;  // ignores gravity and the ground entirely
export const P_STICK = 4;  // dies on landing without depositing

export type LandFn = (col: number, row: number, amount: number) => void;

export class Particles {
  readonly x = new Float32Array(PARTICLE_CAP);
  readonly y = new Float32Array(PARTICLE_CAP);
  readonly vx = new Float32Array(PARTICLE_CAP);
  readonly vy = new Float32Array(PARTICLE_CAP);
  readonly life = new Float32Array(PARTICLE_CAP);    // seconds remaining
  readonly maxLife = new Float32Array(PARTICLE_CAP); // seconds
  readonly ground = new Float32Array(PARTICLE_CAP);  // landing row, cell units
  readonly size = new Float32Array(PARTICLE_CAP);    // cell-height multiples
  readonly rot = new Float32Array(PARTICLE_CAP);     // turns
  readonly vr = new Float32Array(PARTICLE_CAP);      // turns / s
  readonly glyph = new Uint16Array(PARTICLE_CAP);    // char code, or shape idx
  readonly color = new Uint8Array(PARTICLE_CAP);     // atlas slot, or tone idx
  readonly kind = new Uint8Array(PARTICLE_CAP);
  readonly flag = new Uint8Array(PARTICLE_CAP);

  count = 0;
  private ring = 0;

  /** When full, slots are recycled round-robin (O(1)) so a burst is never
   *  dropped and the stolen slot is always an old one. */
  spawn(
    kind: number,
    x: number, y: number, vx: number, vy: number,
    life: number, ground: number, size: number, spin: number,
    glyph: number, color: number, flag: number,
  ): void {
    let i: number;
    if (this.count < PARTICLE_CAP) { i = this.count++; }
    else { i = this.ring; this.ring = (this.ring + 1) % PARTICLE_CAP; }
    this.kind[i] = kind;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = life; this.maxLife[i] = life;
    this.ground[i] = ground;
    this.size[i] = size;
    this.rot[i] = 0; this.vr[i] = spin;
    this.glyph[i] = glyph; this.color[i] = color; this.flag[i] = flag;
  }

  /**
   * @param dt      seconds
   * @param gravity cells per second squared
   * @param maxCol  clamp for the deposit column
   * @param maxRow  clamp for the deposit row
   * @param onLand  called for bleeding particles that hit their ground plane
   */
  update(dt: number, gravity: number, maxCol: number, maxRow: number, onLand: LandFn): void {
    const drag = Math.pow(0.72, dt); // frame-rate independent horizontal damping
    let i = 0;
    while (i < this.count) {
      const l = this.life[i] - dt;
      if (l <= 0) { this.remove(i); continue; }
      const f = this.flag[i];
      const ghost = (f & P_GHOST) !== 0;

      let vy = ghost ? this.vy[i] : this.vy[i] + gravity * dt;
      const vx = this.vx[i] * drag;
      const nx = this.x[i] + vx * dt;
      let ny = this.y[i] + vy * dt;

      if (!ghost && ny >= this.ground[i]) {
        if ((f & P_BLEEDS) !== 0) {
          let c = Math.round(nx);
          if (c < 0) c = 0; else if (c > maxCol) c = maxCol;
          let r = Math.round(this.ground[i]);
          if (r < 0) r = 0; else if (r > maxRow) r = maxRow;
          onLand(c, r, this.size[i]);
          this.remove(i);
          continue;
        }
        if ((f & P_STICK) !== 0) { this.remove(i); continue; }
        ny = this.ground[i];
        vy = -Math.abs(vy) * 0.28;
        if (Math.abs(vy) < 1.2) { this.remove(i); continue; }
      }

      this.life[i] = l;
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.x[i] = nx;
      this.y[i] = ny;
      this.rot[i] += this.vr[i] * dt;
      i++;
    }
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last]; this.y[i] = this.y[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
      this.ground[i] = this.ground[last]; this.size[i] = this.size[last];
      this.rot[i] = this.rot[last]; this.vr[i] = this.vr[last];
      this.glyph[i] = this.glyph[last]; this.color[i] = this.color[last];
      this.kind[i] = this.kind[last]; this.flag[i] = this.flag[last];
    }
  }

  clear(): void { this.count = 0; this.ring = 0; }
}
