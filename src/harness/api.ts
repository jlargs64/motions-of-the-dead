// Phase F — the headless facade over Phase A + B. No canvas, no DOM, no audio.
import { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import type { GameEvent } from '../core/types';
import { VimEngine } from '../vim/engine';
import { Sim } from '../sim/sim';
import { splitKeys } from '../sim/optimal';
import { Menu } from '../ui/menu';
import { FAMILIES, familyById } from '../sim/drills';
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
  /**
   * The main menu's model. `src/ui/menu.ts` is pure - no canvas, no DOM, no
   * store - so the headless harness can hold it and an agent drives exactly
   * the same menu the browser does. `main.ts` reads this instance rather than
   * building its own.
   */
  readonly menu = new Menu();
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
      const phase = this.sim.state.phase;
      // The menu is a real screen with real motions; keys go to it, not the
      // Vim engine. `t` is gone: missions are the `missions` row now.
      if (phase === 'menu' || phase === 'title') { this.feedMenu(k); continue; }
      // The store is the other screen the sim owns outright. `main.ts` routes
      // shop keys through here rather than through a switch of its own, so a
      // log containing a shopping trip replays identically in both builds
      // (DECISIONS #77).
      if (phase === 'shop') { this.feedShop(k); continue; }
      // A drill's end card takes `r` and `<Esc>`, nothing else.
      if (phase === 'stats') { this.feedDrillEnd(k); continue; }
      // On the death screen `i` still inserts you back into the horde.
      if (phase !== 'playing') {
        if (k === 'i') { this.engine.reset(); this.sim.start(); }
        continue;
      }
      if (this.sim.state.sim.mission >= 0) { this.feedMission(k); continue; }
      if (this.sim.state.sim.drill !== '') { this.feedDrill(k); continue; }
      this.sim.noteKeystroke();
      const cmd = this.engine.feed(k);
      if (cmd) this.sim.apply(cmd);
    }
    return this.bus.drain();
  }

  /**
   * One keystroke inside a mission (DECISIONS #91). `r` is Vim's replace,
   * which this game does not implement, so in TRY it restarts the beat and in
   * DONE it retries; DONE also takes `n` for the next mission and `<Esc>` back
   * to the list, and nothing else. Every TRY key counts against par, half-typed
   * commands and the `<Esc>` that clears them included.
   */
  private feedMission(k: string): void {
    const sm = this.sim.state.sim;
    if (sm.missionBeat === 'done') {
      if (k === 'n') { this.engine.reset(); this.sim.nextMission(); }
      else if (k === 'r') { this.engine.reset(); this.sim.retryMission(); }
      else if (k === '<Esc>') { this.engine.reset(); this.leaveMission(); }
      return;
    }
    if (k === 'r') { this.engine.reset(); this.sim.retryMission(); return; }
    this.sim.noteMissionKey();
    this.sim.noteKeystroke();
    const cmd = this.engine.feed(k);
    if (cmd) this.sim.apply(cmd);
  }

  /**
   * One keystroke inside a drill (drills-and-coach D5). `r` with nothing
   * pending throws the scene away for the next one; everything else is a Vim
   * key. Half a command followed by `r` is still a command in progress.
   */
  private feedDrill(k: string): void {
    if (k === 'r' && this.engine.pending() === '') { this.sim.skipScene(); return; }
    this.sim.noteKeystroke();
    const cmd = this.engine.feed(k);
    if (cmd) this.sim.apply(cmd);
  }

  /** The drill end card: `r` runs the same family again, `<Esc>` leaves. */
  private feedDrillEnd(k: string): void {
    if (k === 'r') { this.engine.reset(); this.sim.retryDrill(); }
    else if (k === '<Esc>') { this.engine.reset(); this.leaveDrill(); }
  }

  /** Out of a drill and back onto the drills list, with the cursor on it. */
  leaveDrill(): void {
    const fam = familyById(this.sim.state.sim.drill);
    const i = fam ? FAMILIES.indexOf(fam) : 0;
    this.sim.toMenu();
    this.menu.reset();
    this.menu.open('drills', Math.max(0, i));
  }

  /** Out of a mission and back onto the list, with the cursor on it. */
  leaveMission(): void {
    const i = this.sim.state.sim.mission;
    this.sim.toMenu();
    this.menu.reset();
    this.menu.open('missions', i);
  }

  /**
   * One store keystroke. Four keys are intercepted before the Vim engine sees
   * them - `<CR>`, `<Esc>`, and in list mode `l` and `n` - because the engine
   * would read them as a motion, a reset and a search repeat. Everything else
   * is a real command: it moves the selection, or the placement crosshair.
   *
   * Store keys are not counted into `sim.keystrokes`, for the same reason menu
   * keys are not: keystrokes-per-kill is a measure of how you fight.
   */
  private feedShop(k: string): void {
    const shop = this.sim.state.sim.shop;
    // A plant mission runs in this phase, so `r` has to reach the retry here
    // too - during a mission it is not a Vim key - and its keys count.
    if (this.sim.state.sim.mission >= 0) {
      if (k === 'r') { this.engine.reset(); this.sim.retryMission(); return; }
      this.sim.noteMissionKey();
    }
    // A placement order runs here too: `r` deals the next order, and every
    // other key counts toward its PERFECT (drills-and-coach D9).
    if (this.sim.state.sim.drill !== '') {
      if (k === 'r' && this.engine.pending() === '') { this.sim.skipScene(); return; }
      this.sim.noteDrillKey();
    }
    if (k === '<CR>') { this.engine.reset(); this.sim.shopEnter(); return; }
    if (k === '<Esc>') { this.engine.reset(); this.sim.shopCancel(); return; }
    if (shop.mode === 'list') {
      if (k === 'l') { this.engine.reset(); this.sim.shopBuy(); return; }
      if (k === 'n') { this.engine.reset(); this.sim.shopResume(); return; }
    }
    const cmd = this.engine.feed(k);
    if (cmd) this.sim.shopCommand(cmd);
  }

  /** One menu keystroke. Only the two actions the sim owns are carried out;
   *  screen navigation happens inside the Menu itself. */
  private feedMenu(k: string): void {
    const a = this.menu.feed(k);
    if (!a) return;
    if (a.t === 'start') { this.engine.reset(); this.menu.reset(); this.sim.start(a.mode); }
    else if (a.t === 'mission') { this.engine.reset(); this.menu.reset(); this.sim.startMission(a.index); }
    else if (a.t === 'drill') { this.engine.reset(); this.menu.reset(); this.sim.startDrill(a.family); }
  }

  /**
   * Pick a suspended run back up (DECISIONS #96): the engine forgets any
   * half-typed command and the sim takes the snapshot. The browser's menu
   * calls this from its `resume` row; headless it is how a test proves a
   * restored run steps identically to the one it was cut from.
   */
  restore(state: GameState, progress?: Record<string, number>): void {
    this.engine.reset();
    this.carry = 0;
    this.sim.restore(state, progress);
    this.bus.drain();
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

  text(): string {
    return renderText(this.sim.state, this.engine.pending(), this.menu.lines());
  }
  json(): GameState { return this.sim.state; }
  isOver(): boolean { return this.sim.state.phase === 'dead'; }
  pending(): string { return this.engine.pending(); }
}
