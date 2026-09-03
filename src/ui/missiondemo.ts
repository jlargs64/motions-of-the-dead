// Phase G - the mission select screen's right pane.
//
// The demo is the game playing itself: each key of the mission's demo string
// is fed through a real `VimEngine` into a real `Sim`, so the command form, the
// motion, the coverage rules and the kill are all resolved by the same code
// that runs a live game. Nothing here is an animation.
//
// It holds its OWN Sim, so browsing the menu never touches the live
// `GameState` - the menu-isolation rule in the game-mode-contract spec. And it
// never calls `tick()`: no clock means nothing walks, nothing spawns, the
// barricade is never hit, and a demo can loop forever without the mission
// state machine advancing under it.
import { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import { Sim } from '../sim/sim';
import { DEMO_KEY_MS, DEMO_LOOP_MS, MISSIONS } from '../sim/missions';
import { splitKeys } from '../sim/optimal';
import { VimEngine } from '../vim/engine';

/** Fixed: the demo scenes are scripted, so the seed only has to be stable. */
const DEMO_SEED = 0x5eed;

/**
 * Ceiling on one frame's contribution, so a backgrounded tab does not come
 * back and replay a thousand keys. It MUST stay above both DEMO_KEY_MS and
 * DEMO_LOOP_MS or a single frame could never advance the demo at all.
 */
const MAX_FRAME_MS = 2000;

export class MissionDemo {
  private bus = new Bus();
  private sim = new Sim(DEMO_SEED, this.bus);
  private engine = new VimEngine();
  /** The demo string, split into engine tokens. */
  private keys: string[] = [];
  /** Which mission is loaded, or -1 before the first `sync`. */
  private loaded = -1;
  /** How many keys have been fed this pass. */
  private pos = 0;
  /** Sim time banked toward the next key, or toward the loop reset. */
  private clock = 0;
  /** Distinct keys fed this pass, for lighting the keycaps. */
  private fed = new Set<string>();
  /** Passes completed, so the drawing can say the demo is looping. */
  passes = 0;

  /** The pane's own field. Read-only to the drawing. */
  get state(): GameState { return this.sim.state; }
  /** Which mission the pane is showing. */
  get step(): number { return this.loaded; }
  /** Keys fed / keys in the demo, for the progress line. */
  get position(): number { return this.pos; }
  get total(): number { return this.keys.length; }
  /** True while the finished scene is being held before the reset. */
  get resting(): boolean { return this.pos >= this.keys.length; }

  /** Has this key been pressed yet this pass? Lights one keycap. The `{n}`
   *  cap stands for any count, so it lights on the first digit. */
  lit(key: string): boolean {
    if (key === '{n}') { for (const k of this.fed) if (k >= '0' && k <= '9') return true; return false; }
    return this.fed.has(key);
  }

  /** Point the pane at a mission. A no-op when it is already there, so this
   *  is safe to call every frame. */
  sync(step: number): void {
    if (step === this.loaded) return;
    this.loaded = step;
    this.passes = 0;
    this.restart();
  }

  /** Back to the top of the demo string with a fresh scene. */
  private restart(): void {
    const demo = MISSIONS[this.loaded]?.demo;
    this.pos = 0;
    this.clock = 0;
    this.fed.clear();
    this.engine.reset();
    if (!demo) { this.keys = []; return; }
    this.keys = splitKeys(demo.keys);
    this.sim.startScene(demo.spawn, { row: demo.cursor[0], col: demo.cursor[1] });
    this.bus.drain();
  }

  /**
   * Advance the demo by `dtMs` of wall time. Keys are fed one per
   * DEMO_KEY_MS; when the string runs out the scene is held for DEMO_LOOP_MS
   * and then starts over. A long frame feeds several keys rather than
   * stalling, so a backgrounded tab catches up instead of drifting.
   */
  advance(dtMs: number): void {
    if (this.loaded < 0 || this.keys.length === 0) return;
    this.clock += dtMs > MAX_FRAME_MS ? MAX_FRAME_MS : dtMs;
    let guard = 0;
    while (guard++ < 64) {
      if (this.pos >= this.keys.length) {
        if (this.clock < DEMO_LOOP_MS) return;
        this.passes++;
        this.restart();
        return;
      }
      if (this.clock < DEMO_KEY_MS) return;
      this.clock -= DEMO_KEY_MS;
      this.feedOne();
    }
  }

  private feedOne(): void {
    const key = this.keys[this.pos++];
    this.fed.add(key);
    const cmd = this.engine.feed(key);
    if (cmd) this.sim.apply(cmd);
    this.bus.drain();          // the pane has no FX; drop the events
  }

  /** Run the whole demo string at once. Used by the tests. */
  runToEnd(): void {
    while (this.pos < this.keys.length) this.feedOne();
  }

  /**
   * Was the goal actually met by the demo? A demo may declare its own goal:
   * the pane has no store, so a `plant` mission's demo proves the counted
   * motion the plant is made of and says `clear` for itself.
   */
  cleared(): boolean {
    const step = MISSIONS[this.loaded];
    if (!step) return false;
    const s = this.sim.state;
    const goal = step.demo.goal ?? step.goal;
    if (goal === 'clear') return s.buffer.zombies.length === 0;
    for (const z of s.buffer.zombies) {
      if (z.row === s.cursor.row
        && s.cursor.col >= z.col && s.cursor.col < z.col + z.text.length) return true;
    }
    return false;
  }
}
