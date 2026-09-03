// ============================================================================
// Phase D — AUDIO. Everything is synthesized at runtime with WebAudio.
// Zero assets, zero network, zero runtime dependencies.
//
// Nothing here touches `window`, `AudioContext` or `localStorage` at module
// scope, so importing this file under Node (headless sim, tests) is inert.
// The AudioContext is built lazily inside unlock(), which main.ts calls from
// the first keydown to satisfy the browser autoplay policy. Until then every
// public method is a safe no-op.
// ============================================================================
import type { Bus } from '../core/bus';
import type { ZombieKind } from '../core/types';
// The medal table is data the sim owns; audio reads the rung a name stands
// for, and never the other way round.
import { MULTI_KILL_MIN, medalTier } from '../sim/medals';
// Item kinds are data the sim owns too: a plant and a purchase arrive as the
// same `buy` event, and only the table knows which is which.
import { itemById } from '../sim/store';

// --- tuning constants -------------------------------------------------------
const MASTER_LEVEL = 0.9;
const MAX_VOICES = 24;          // hard cap on concurrent one-shots
const NOISE_SECONDS = 2;        // length of the single shared white-noise buffer
const MUTE_KEY = 'motd.muted';
const MUTE_RAMP = 0.03;         // 30ms, no clicks
const AMBIENT_BED_LEVEL = 0.055;
const DUCK_FACTOR = 0.45;
const DUCK_SECONDS = 0.2;
const GROAN_MIN_MS = 5000;
const GROAN_MAX_MS = 14000;
const SILENT = 0.0001;          // never ramp to exactly 0

// --- tiny helpers -----------------------------------------------------------

/** Attack/decay envelope on a gain param. Exponential ramps, never to 0. */
function env(p: AudioParam, t0: number, peak: number, attack: number, decay: number): void {
  const top = Math.max(peak, SILENT * 2);
  p.setValueAtTime(SILENT, t0);
  p.exponentialRampToValueAtTime(top, t0 + attack);
  p.exponentialRampToValueAtTime(SILENT, t0 + attack + decay);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Hard-clip transfer curve for the overkill splat. Built once, shared. */
function makeClipCurve() {
  const n = 129;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = clamp(x * 5, -1, 1);
  }
  return c;
}

function loadMuted(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(m: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // private window / storage disabled — the preference just does not persist
  }
}

// --- kill profiles ----------------------------------------------------------
// The `kill` event carries no word length, so weight is derived from kind:
// crawler (1 char) is the highest and tiniest, bloater (8+) the lowest.
interface KillProfile {
  f0: number;       // thump start Hz
  f1: number;       // thump end Hz
  dur: number;      // thump decay seconds
  amp: number;      // thump peak
  wave: OscillatorType;
  nf: number;       // noise bandpass centre
  nq: number;
  nDur: number;     // noise decay
  nAmp: number;
  nRate: number;    // playback rate of the shared noise buffer
  wet: boolean;     // extra squelch layer
}

const KILL: Record<ZombieKind, KillProfile> = {
  crawler: { f0: 300, f1: 150, dur: 0.09, amp: 0.16, wave: 'triangle', nf: 2400, nq: 1.4, nDur: 0.05, nAmp: 0.10, nRate: 1.3, wet: false },
  runner:  { f0: 215, f1: 90,  dur: 0.13, amp: 0.20, wave: 'triangle', nf: 1700, nq: 2.4, nDur: 0.06, nAmp: 0.14, nRate: 1.1, wet: false },
  walker:  { f0: 140, f1: 52,  dur: 0.22, amp: 0.26, wave: 'sine',     nf: 900,  nq: 1.0, nDur: 0.13, nAmp: 0.15, nRate: 1.0, wet: false },
  armored: { f0: 150, f1: 58,  dur: 0.20, amp: 0.24, wave: 'sine',     nf: 1250, nq: 1.6, nDur: 0.10, nAmp: 0.13, nRate: 1.0, wet: false },
  bloater: { f0: 88,  f1: 30,  dur: 0.45, amp: 0.34, wave: 'sine',     nf: 520,  nq: 0.7, nDur: 0.30, nAmp: 0.20, nRate: 0.6, wet: true },
};

/** One tracked one-shot: a sub-mix gain plus the sources feeding it. */
interface Voice {
  gain: GainNode;
  srcs: AudioScheduledSourceNode[];
  endsAt: number;
}

export class Audio {
  private unsubs: Array<() => void> = [];

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientBus: GainNode | null = null;   // duckable sub-bus -> master
  private noise: AudioBuffer | null = null;     // the one shared white-noise buffer
  private clipCurve: ReturnType<typeof makeClipCurve> | null = null;

  private voices: Voice[] = [];

  private _muted = loadMuted();
  private disposed = false;

  private ambientWanted = false;
  private bedSrc: AudioBufferSourceNode | null = null;
  private bedGain: GainNode | null = null;
  private groanIn = GROAN_MIN_MS;

  private comboRung = 0;

  constructor(bus: Bus) {
    const u = this.unsubs;
    u.push(bus.on('kill', (e) => this.onKill(e.kind, e.overkill)));
    u.push(bus.on('medal', (e) => this.onMedal(e.name)));
    u.push(bus.on('combo', (e) => this.onCombo(e.n)));
    u.push(bus.on('combo_break', () => this.onComboBreak()));
    u.push(bus.on('barricade_hit', (e) => this.onBarricadeHit(e.dmg)));
    u.push(bus.on('wave_start', () => this.onWaveStart()));
    u.push(bus.on('wave_clear', () => this.onWaveClear()));
    u.push(bus.on('charge_used', (e) => this.onChargeUsed(e.kind)));
    u.push(bus.on('buy', (e) => this.onBuy(e.item)));
    u.push(bus.on('trap_fire', () => this.onTrapFire()));
    u.push(bus.on('revive', () => this.onRevive()));
    u.push(bus.on('death', () => this.onDeath()));
  }

  // --- lifecycle ------------------------------------------------------------

  /** Create/resume the AudioContext. Idempotent. Call on the first keydown. */
  unlock(): void {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      this.startAmbient();
      return;
    }
    if (typeof window === 'undefined') return;
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    this.ctx = ctx;

    // masterGain -> compressor -> destination
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    comp.connect(ctx.destination);

    const master = ctx.createGain();
    master.gain.value = this._muted ? SILENT : MASTER_LEVEL;
    master.connect(comp);
    this.master = master;

    // ambient rides its own sub-bus so it can be ducked independently
    const amb = ctx.createGain();
    amb.gain.value = 1;
    amb.connect(master);
    this.ambientBus = amb;

    this.noise = this.makeNoise(ctx);

    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    this.startAmbient();
  }

  /** Returns the new muted state. */
  toggleMute(): boolean {
    this._muted = !this._muted;
    saveMuted(this._muted);
    if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      const p = this.master.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(Math.max(p.value, SILENT), t);
      p.linearRampToValueAtTime(this._muted ? SILENT : MASTER_LEVEL, t + MUTE_RAMP);
    }
    if (this._muted) this.stopAmbient(MUTE_RAMP);
    else this.startAmbient();
    return this._muted;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** Stop everything (used on teardown). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.ambientWanted = false;
    const ctx = this.ctx;
    if (ctx) {
      this.stopAmbient(0.02);
      this.stopAllVoices(ctx.currentTime);
      void ctx.close().catch(() => {});
    }
    this.voices.length = 0;
    this.ctx = null;
    this.master = null;
    this.ambientBus = null;
    this.noise = null;
    this.clipCurve = null;
  }

  // --- per-frame ------------------------------------------------------------

  /** Called once per frame with dt in ms; drives ambient scheduling. */
  update(dtMs: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.prune(ctx.currentTime);
    if (!this.ambientWanted || this._muted || this.disposed) return;
    this.groanIn -= dtMs;
    if (this.groanIn <= 0) {
      this.groanIn = GROAN_MIN_MS + Math.random() * (GROAN_MAX_MS - GROAN_MIN_MS);
      this.groan();
    }
  }

  // --- keystroke ------------------------------------------------------------

  /** Soft click, pitch varies deterministically by key. Peak ~0.055. */
  keyClick(key: string): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(0.05);
    if (!v) return;

    const code = key.length > 0 ? key.charCodeAt(0) : 32;
    const centre = 780 + (code % 41) * 52;      // 780..2860Hz, stable per key

    const src = this.noiseSrc(v, t, 0.012, 1);
    if (!src) return;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = centre;
    bp.Q.value = 7;
    const g = ctx.createGain();
    env(g.gain, t, 0.055, 0.001, 0.008);        // ~9ms total
    src.connect(bp).connect(g).connect(v.gain);
  }

  // --- event handlers -------------------------------------------------------

  private onKill(kind: ZombieKind, overkill: boolean): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const p = KILL[kind];
    const v = this.voice(p.dur + 0.25);
    if (!v) return;

    this.duck();

    // body thump — pitch drops with the weight of the corpse
    const osc = ctx.createOscillator();
    osc.type = p.wave;
    osc.frequency.setValueAtTime(p.f0, t);
    osc.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur * 0.8);
    const og = ctx.createGain();
    env(og.gain, t, p.amp, 0.004, p.dur);
    osc.connect(og).connect(v.gain);
    this.play(v, osc, t, p.dur + 0.03);

    // wet noise burst
    const ns = this.noiseSrc(v, t, p.nDur + 0.03, p.nRate);
    if (ns) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = p.nf;
      bp.Q.value = p.nq;
      const ng = ctx.createGain();
      env(ng.gain, t, p.nAmp, 0.002, p.nDur);
      ns.connect(bp).connect(ng).connect(v.gain);
    }

    // bloater: an extra downward squelch under the thump
    if (p.wet) {
      const sq = ctx.createOscillator();
      sq.type = 'sine';
      sq.frequency.setValueAtTime(420, t);
      sq.frequency.exponentialRampToValueAtTime(58, t + 0.16);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const sg = ctx.createGain();
      env(sg.gain, t, 0.10, 0.006, 0.20);
      sq.connect(lp).connect(sg).connect(v.gain);
      this.play(v, sq, t, 0.23);
    }

    // armored: brittle glassy crack as the bracket shatters
    if (kind === 'armored') {
      this.shard(v, t, 2900, 2150, 0.07, 0.085);
      this.shard(v, t + 0.012, 3900, 3200, 0.045, 0.05);
    }

    // overkill: an ugly clipped white-noise splat
    if (overkill) {
      const os = this.noiseSrc(v, t + 0.008, 0.17, 1);
      if (os) {
        const shaper = ctx.createWaveShaper();
        shaper.curve = this.clip();
        shaper.oversample = 'none';
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        lp.Q.value = 0.8;
        const g = ctx.createGain();
        env(g.gain, t + 0.008, 0.22, 0.003, 0.14);
        os.connect(shaper).connect(lp).connect(g).connect(v.gain);
      }
    }
  }

  private onCombo(n: number): void {
    if (n % 5 !== 0) return;
    this.comboRung++;                 // ladder advances even while muted
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(0.28);
    if (!v) return;

    const rung = Math.min(this.comboRung, 14);
    const f = 196 * Math.pow(2, (rung * 2) / 12);   // two semitones per rung

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.03, t + 0.17);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    env(g.gain, t, 0.10, 0.008, 0.17);
    osc.connect(lp).connect(g).connect(v.gain);
    this.play(v, osc, t, 0.2);
  }

  /**
   * A medal sting. Multi-kills ring a rising major triad whose root and layer
   * count climb with the rung, so a KILLIONAIRE is unmistakably not a DOUBLE
   * KILL; style medals get a distinct two-note figure instead, high and short,
   * so PERFECT never sounds like a kill count. `ready()` covers mute and
   * `voice()` covers the voice cap, so a jammed lane cannot flood either.
   */
  private onMedal(name: string): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const tier = medalTier(name);

    if (tier === 0) {
      // style: a clean rising fifth, two notes, out of the way of the ladder
      const v = this.voice(0.34);
      if (!v) return;
      this.note(v, t, 880, 0.10, 0.075);
      this.note(v, t + 0.085, 1318.5, 0.20, 0.065);
      return;
    }

    const rung = Math.min(tier - MULTI_KILL_MIN, 8);        // 0..8
    const v = this.voice(0.55);
    if (!v) return;
    // Two semitones per rung, as the combo ladder climbs, starting at A3.
    const f = 220 * Math.pow(2, (rung * 2) / 12);
    // One layer per two rungs: the triad fills in as the count goes up.
    const layers = 1 + Math.min(2, rung >> 1);
    const ratios = [1, 1.5, 2];
    for (let i = 0; i < layers; i++) {
      this.note(v, t + i * 0.045, f * ratios[i], 0.26 + i * 0.06, 0.085 - i * 0.015);
    }
    // The top of the ladder gets a bright shard on top of the triad.
    if (rung >= 5) this.shard(v, t + 0.09, f * 4, f * 2.5, 0.30, 0.05);
  }

  private onComboBreak(): void {
    this.comboRung = 0;
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = 0.35;
    const v = this.voice(dur + 0.1);
    if (!v) return;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + dur);
    lp.Q.value = 1.2;
    const g = ctx.createGain();
    env(g.gain, t, 0.15, 0.01, dur);
    lp.connect(g).connect(v.gain);

    for (const cents of [-9, 9]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = cents;
      osc.frequency.setValueAtTime(300, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + dur);
      osc.connect(lp);
      this.play(v, osc, t, dur + 0.02);
    }
  }

  private onBarricadeHit(dmg: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const amp = clamp(0.10 + dmg * 0.018, 0.10, 0.42);
    const v = this.voice(0.45);
    if (!v) return;

    // sub thud, ~45Hz with a fast pitch drop into it
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(95, t);
    sub.frequency.exponentialRampToValueAtTime(44, t + 0.07);
    const sg = ctx.createGain();
    env(sg.gain, t, amp, 0.005, 0.32);
    sub.connect(sg).connect(v.gain);
    this.play(v, sub, t, 0.36);

    // wood crack
    const ns = this.noiseSrc(v, t, 0.1, 1);
    if (ns) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.2;
      const ng = ctx.createGain();
      env(ng.gain, t, amp * 0.55, 0.001, 0.075);
      ns.connect(bp).connect(ng).connect(v.gain);
    }
  }

  private onWaveStart(): void {
    this.comboRung = 0;
    this.ambientWanted = true;
    this.groanIn = GROAN_MIN_MS + Math.random() * 4000;
    this.startAmbient();
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(2.0);
    if (!v) return;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 0.7);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.8);
    const g = ctx.createGain();
    env(g.gain, t, 0.10, 0.7, 1.1);
    lp.connect(g).connect(v.gain);

    for (const f of [44, 66]) {
      const osc = ctx.createOscillator();
      osc.type = f === 44 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.connect(lp);
      this.play(v, osc, t, 1.85);
    }
  }

  private onWaveClear(): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(0.7);
    if (!v) return;
    // two-note fall, low and dry: F3 -> C3
    this.note(v, t, 174.6, 0.22, 0.09);
    this.note(v, t + 0.18, 130.8, 0.32, 0.07);
  }

  private onChargeUsed(kind: 'dd' | 'D'): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(0.14);
    if (!v) return;

    // mechanical click
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = kind === 'dd' ? 140 : 190;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    const g = ctx.createGain();
    env(g.gain, t, 0.10, 0.001, 0.014);
    osc.connect(lp).connect(g).connect(v.gain);
    this.play(v, osc, t, 0.03);

    // the chunk of the mechanism seating
    const ns = this.noiseSrc(v, t + 0.006, 0.07, 1);
    if (ns) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'dd' ? 950 : 1250;
      bp.Q.value = 3;
      const ng = ctx.createGain();
      env(ng.gain, t + 0.006, 0.12, 0.002, 0.05);
      ns.connect(bp).connect(ng).connect(v.gain);
    }
  }

  /**
   * A purchase. A trap is not a transaction, it is a thing you put in the
   * ground, so a plant gets the mallet and everything else gets the till.
   */
  private onBuy(item: string): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const trap = itemById(item)?.kind === 'trap';
    const v = this.voice(trap ? 0.30 : 0.34);
    if (!v) return;

    if (trap) {
      // a stake going in: a low thud with a wooden knock on top
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(210, t);
      osc.frequency.exponentialRampToValueAtTime(70, t + 0.09);
      const g = ctx.createGain();
      env(g.gain, t, 0.20, 0.002, 0.10);
      osc.connect(g).connect(v.gain);
      this.play(v, osc, t, 0.14);

      const ns = this.noiseSrc(v, t, 0.05, 1);
      if (ns) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1600;
        bp.Q.value = 2.2;
        const ng = ctx.createGain();
        env(ng.gain, t, 0.13, 0.001, 0.04);
        ns.connect(bp).connect(ng).connect(v.gain);
      }
      return;
    }

    // the till: two bright taps, the second a fifth up, over a paper rustle
    this.note(v, t, 660, 0.10, 0.10);
    this.note(v, t + 0.075, 990, 0.16, 0.085);
    const ns = this.noiseSrc(v, t + 0.02, 0.12, 1);
    if (ns) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3200;
      const ng = ctx.createGain();
      env(ng.gain, t + 0.02, 0.05, 0.008, 0.10);
      ns.connect(hp).connect(ng).connect(v.gain);
    }
  }

  /** A trap going off: a metal snap, dry, with no meat in it. */
  private onTrapFire(): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(0.22);
    if (!v) return;

    const ns = this.noiseSrc(v, t, 0.06, 1);
    if (ns) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(900, t + 0.05);
      bp.Q.value = 1.6;
      const ng = ctx.createGain();
      env(ng.gain, t, 0.24, 0.001, 0.05);
      ns.connect(bp).connect(ng).connect(v.gain);
    }
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.07);
    const g = ctx.createGain();
    env(g.gain, t, 0.11, 0.001, 0.07);
    osc.connect(g).connect(v.gain);
    this.play(v, osc, t, 0.10);
  }

  /** Second Wind: the wall coming back. A rising swell, and a breath. */
  private onRevive(): void {
    this.comboRung = 0;
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(1.1);
    if (!v) return;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.55);
    const g = ctx.createGain();
    env(g.gain, t, 0.26, 0.28, 0.85);
    lp.connect(g).connect(v.gain);
    for (const f of [98, 147, 196]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 0.75, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.5);
      osc.connect(lp);
      this.play(v, osc, t, 0.95);
    }
  }

  private onDeath(): void {
    this.comboRung = 0;
    this.ambientWanted = false;
    this.stopAmbient(0.15);
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    this.stopAllVoices(t);

    const v = this.voice(2.4);
    if (!v) return;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(110, t + 2.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.12);
    g.gain.exponentialRampToValueAtTime(SILENT, t + 2.0);
    lp.connect(g).connect(v.gain);

    for (const cents of [-11, 13]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      osc.detune.value = cents;
      osc.connect(lp);
      this.play(v, osc, t, 2.1);
    }
  }

  // --- ambient --------------------------------------------------------------

  private startAmbient(): void {
    if (!this.ready() || !this.ambientWanted) return;
    if (this.bedSrc) return;
    const ctx = this.ctx!;
    const buf = this.noise;
    const bus = this.ambientBus;
    if (!buf || !bus) return;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.28;          // slowed white noise reads darker

    // two cascaded lowpasses ~= an integrator; white -> brown-ish bed
    const lp1 = ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = 320;
    lp1.Q.value = 0.3;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 140;
    lp2.Q.value = 0.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(AMBIENT_BED_LEVEL, t + 2.5);

    src.connect(lp1).connect(lp2).connect(g).connect(bus);
    src.start(t);
    this.bedSrc = src;
    this.bedGain = g;
  }

  private stopAmbient(fade = 0.6): void {
    const ctx = this.ctx;
    const src = this.bedSrc;
    const g = this.bedGain;
    this.bedSrc = null;
    this.bedGain = null;
    if (!ctx || !src) return;
    const t = ctx.currentTime;
    if (g) {
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(g.gain.value, SILENT), t);
        g.gain.exponentialRampToValueAtTime(SILENT, t + fade);
      } catch {
        // param already detached
      }
    }
    try {
      src.stop(t + fade + 0.05);
    } catch {
      // already stopped
    }
  }

  /** Distant groan: LFO-wobbled saw through a slowly opening lowpass. */
  private groan(): void {
    if (!this.ready() || !this.ambientBus) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const v = this.voice(3.1, this.ambientBus);
    if (!v) return;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 52 + Math.random() * 34;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3.5 + Math.random() * 3;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 3 + Math.random() * 5;
    lfo.connect(lfoAmt).connect(osc.frequency);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(160, t);
    lp.frequency.exponentialRampToValueAtTime(430, t + 1.1);
    lp.frequency.exponentialRampToValueAtTime(150, t + 2.8);

    const g = ctx.createGain();
    const peak = 0.035 + Math.random() * 0.025;
    g.gain.setValueAtTime(SILENT, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.9);
    g.gain.exponentialRampToValueAtTime(SILENT, t + 2.9);

    osc.connect(lp).connect(g).connect(v.gain);
    this.play(v, osc, t, 3.0);
    this.play(v, lfo, t, 3.0);
  }

  /** Duck the ambient sub-bus for ~200ms so a kill cuts through. */
  private duck(): void {
    if (!this.ctx || !this.ambientBus || !this.bedSrc) return;
    const t = this.ctx.currentTime;
    const p = this.ambientBus.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(DUCK_FACTOR, t + 0.02);
    p.linearRampToValueAtTime(1, t + DUCK_SECONDS);
  }

  // --- voice plumbing -------------------------------------------------------

  private ready(): boolean {
    return this.ctx !== null && this.master !== null && !this._muted && !this.disposed;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const n = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private clip(): ReturnType<typeof makeClipCurve> {
    if (!this.clipCurve) this.clipCurve = makeClipCurve();
    return this.clipCurve;
  }

  private prune(t: number): void {
    const v = this.voices;
    let w = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (x.endsAt > t) v[w++] = x;
      else x.gain.disconnect();
    }
    v.length = w;
  }

  private voice(dur: number, dest?: AudioNode): Voice | null {
    const ctx = this.ctx;
    const out = dest ?? this.master;
    if (!ctx || !out) return null;
    const t = ctx.currentTime;
    this.prune(t);
    if (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      if (oldest) this.cutVoice(oldest, t);
    }
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(out);
    const v: Voice = { gain: g, srcs: [], endsAt: t + dur };
    this.voices.push(v);
    return v;
  }

  private play(v: Voice, s: AudioScheduledSourceNode, t0: number, dur: number): void {
    v.srcs.push(s);
    s.start(t0);
    s.stop(t0 + dur);
    if (t0 + dur > v.endsAt) v.endsAt = t0 + dur;
  }

  private noiseSrc(v: Voice, t0: number, dur: number, rate: number): AudioBufferSourceNode | null {
    const ctx = this.ctx;
    const buf = this.noise;
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    // `duration` is measured in buffer seconds, so scale by rate to get `dur`
    // seconds of real playback time.
    const bufDur = Math.min(dur * rate, NOISE_SECONDS - 0.02);
    const offset = Math.random() * Math.max(0, NOISE_SECONDS - bufDur - 0.02);
    v.srcs.push(src);
    src.start(t0, offset, bufDur);
    if (t0 + dur > v.endsAt) v.endsAt = t0 + dur;
    return src;
  }

  /** A single short filtered sine note (used by wave_clear). */
  private note(v: Voice, t0: number, freq: number, dur: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    env(g.gain, t0, peak, 0.012, dur);
    osc.connect(lp).connect(g).connect(v.gain);
    this.play(v, osc, t0, dur + 0.05);
  }

  /** Brittle high ping — the armored bracket shattering. */
  private shard(v: Voice, t0: number, f0: number, f1: number, dur: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    env(g.gain, t0, peak, 0.001, dur);
    osc.connect(hp).connect(g).connect(v.gain);
    this.play(v, osc, t0, dur + 0.02);
  }

  private cutVoice(v: Voice, t: number): void {
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, SILENT), t);
      v.gain.gain.exponentialRampToValueAtTime(SILENT, t + 0.012);
    } catch {
      // param detached
    }
    for (const s of v.srcs) {
      try {
        s.stop(t + 0.02);
      } catch {
        // already stopped
      }
    }
    v.srcs.length = 0;
  }

  /** Silence every live one-shot. The gains stay in the list a beat longer so
   *  the 12ms fade actually plays out; prune() disconnects them after. */
  private stopAllVoices(t: number): void {
    for (const v of this.voices) {
      this.cutVoice(v, t);
      v.endsAt = t + 0.05;
    }
  }
}
