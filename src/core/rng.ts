// FROZEN CONTRACT — Phase 0. Seeded, deterministic, allocation-free.
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [0,n) */
  int(n: number): number { return Math.floor(this.next() * n); }
  /** float in [lo,hi) */
  range(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  pick<T>(arr: readonly T[]): T { return arr[this.int(arr.length)]; }
  get state(): number { return this.s; }
  set state(v: number) { this.s = v >>> 0; }
}
