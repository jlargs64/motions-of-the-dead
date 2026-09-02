// Phase F — the headless facade over Phase A + B. No canvas, no DOM, no audio.
import { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import type { GameEvent } from '../core/types';
import { VimEngine } from '../vim/engine';
import { Sim } from '../sim/sim';
import { splitKeys } from '../sim/optimal';
import { renderText } from './format';

export interface GameOpts {
  /** Seconds per sim step. Default 1/60. */
  fixedDt?: number;
  /** Headless play starts a run immediately; the browser starts on the title. */
  autoStart?: boolean;
}

export class Game {
  readonly bus = new Bus();
  readonly sim: Sim;
  readonly engine = new VimEngine();
  private readonly dtMs: number;
  private carry = 0;

  constructor(seed: number, opts?: GameOpts) {
    this.dtMs = (opts?.fixedDt ?? 1 / 60) * 1000;
    this.sim = new Sim(seed, this.bus);
    this.engine.onError = () => this.sim.unknownKey();
    if (opts?.autoStart !== false) this.sim.start();
    this.bus.drain();
  }

  /** Feed keystrokes. Use Vim <Esc> / <CR> notation for specials. */
  keys(s: string): GameEvent[] {
    for (const k of splitKeys(s)) {
      // Outside a live run, `i` inserts you back into the horde.
      if (this.sim.state.phase !== 'playing') {
        if (k === 'i') { this.engine.reset(); this.sim.start(); }
        else if (k === 't') { this.engine.reset(); this.sim.startTutorial(); }
        continue;
      }
      // `r` is Vim's replace, which this game does not implement; during the
      // warm-up it restarts the current step instead of beeping.
      if (k === 'r' && this.sim.state.sim.tutorial >= 0) {
        this.engine.reset();
        this.sim.retryTutorialStep();
        continue;
      }
      this.sim.noteKeystroke();
      const cmd = this.engine.feed(k);
      if (cmd) this.sim.apply(cmd);
    }
    return this.bus.drain();
  }

  /** Advance sim time in fixed steps. Deterministic. */
  step(ms: number): GameEvent[] {
    this.carry += ms;
    let guard = 0;
    while (this.carry >= this.dtMs - 1e-9 && guard++ < 100_000) {
      this.sim.tick(this.dtMs);
      this.carry -= this.dtMs;
    }
    return this.bus.drain();
  }

  text(): string { return renderText(this.sim.state, this.engine.pending()); }
  json(): GameState { return this.sim.state; }
  isOver(): boolean { return this.sim.state.phase === 'dead'; }
  pending(): string { return this.engine.pending(); }
}
