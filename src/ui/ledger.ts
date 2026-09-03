// Phase E — the Motion Ledger. The point of the game: it tells you which Vim
// you actually know and which Vim you keep avoiding.
import type { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import { tokensUsed } from '../sim/optimal';
import { wastedOf } from '../sim/judgement';
import { coach } from '../sim/coach';
import type { CoachEntry } from '../sim/coach';
import { FIRST_BLOOD, STYLE_BONUS, salvageFor } from '../sim/medals';
import { MAX_RUNS } from '../save/schema';
import type { Lifetime, RunRecord } from '../save/schema';
import { countMedal, creditSalvage } from '../save/save';
import type { SaveStore } from '../save/save';

// The shapes live in src/save/schema.ts now: the ledger is a view over
// `save.lifetime`, not the owner of a localStorage key.
export type { MotionStat, RunRecord } from '../save/schema';
/** @deprecated Read `Lifetime` from src/save/schema instead. */
export type LedgerData = Lifetime;

export interface RunSummary {
  topUsed: Array<[string, number]>;
  neverUsed: Array<[string, number]>;
  kpk: number;
  prevKpk: number | null;
  trend: number[];
  wastedKeystrokes: number;
}

function emptyLifetime(): Lifetime {
  return { motions: {}, missed: {}, runs: [], highScore: 0, kills: 0, medals: {} };
}

export class Ledger {
  /**
   * The live `save.lifetime` object. Hot-path writes (one per token per
   * command) mutate it in place; the persist happens once, at endRun().
   */
  get data(): Lifetime { return this.store.get().lifetime; }

  /** Reset every run. */
  private usedThisRun = new Set<string>();
  private runUsage = new Map<string, number>();
  private optimalTokens = new Map<string, number>();
  private wasted = 0;
  private bus: Bus;

  constructor(private state: GameState, bus: Bus, private store: SaveStore) {
    this.bus = bus;
    bus.on('command', (e) => this.onCommand(e.cmd.raw));
    bus.on('kill', (e) => this.onKill(e.via));
    // The sim does the second-guessing now (DECISIONS #68); this is the
    // Ledger reading its work rather than running the oracle a second time.
    bus.on('kill_judged', (e) => this.onJudged(e.spent, e.optimal));
    bus.on('medal', (e) => this.onMedal(e.name));
    bus.on('wave_start', (e) => { if (e.n === 1) this.beginRun(); });
    bus.on('death', () => this.endRun());
  }

  beginRun(): void {
    this.usedThisRun.clear();
    this.runUsage.clear();
    this.optimalTokens.clear();
    this.wasted = 0;
  }

  private onCommand(raw: string): void {
    // FIRST BLOOD is the first *lifetime* press of a token, so it is judged
    // here and not in the sim, which must not read the save (DECISIONS #71).
    let fresh = false;
    for (const tok of tokensUsed(raw)) {
      this.usedThisRun.add(tok);
      this.runUsage.set(tok, (this.runUsage.get(tok) ?? 0) + 1);
      const m = this.data.motions[tok] ?? (this.data.motions[tok] = { used: 0, kills: 0 });
      if (m.used === 0) fresh = true;
      m.used++;
    }
    // At most one per command, however many new tokens it pressed.
    if (fresh) this.bus.emit({ t: 'medal', name: FIRST_BLOOD, bonus: STYLE_BONUS[FIRST_BLOOD] });
  }

  private onKill(via: string): void {
    for (const tok of tokensUsed(via)) {
      const m = this.data.motions[tok] ?? (this.data.motions[tok] = { used: 0, kills: 0 });
      m.kills++;
    }
  }

  /** What the sim's oracle comparison means for the death screen's tables. */
  private onJudged(spent: number, optimal: string | null): void {
    // A drill scene has a known answer, so nothing in it is a motion you
    // "missed"; the drill scores the kill itself (drills-and-coach D5).
    if (this.state.sim.mode === 'drill') return;
    const wasted = wastedOf(spent, optimal);
    if (wasted === 0 || optimal === null) return;
    this.wasted += wasted;
    for (const tok of tokensUsed(optimal)) {
      this.optimalTokens.set(tok, (this.optimalTokens.get(tok) ?? 0) + 1);
      if (!this.usedThisRun.has(tok)) this.data.missed[tok] = (this.data.missed[tok] ?? 0) + 1;
    }
  }

  /** Every medal, wherever it came from, counts and pays lifetime salvage. */
  private onMedal(name: string): void {
    // A drill's only economy touch is the salvage a personal best pays
    // (drills-and-coach D5); its PERFECTs are scored on the end card instead.
    if (this.state.sim.mode === 'drill') return;
    countMedal(this.store, name);
    creditSalvage(this.store, salvageFor(name));
  }

  endRun(): void {
    const s = this.state;
    const kills = Math.max(1, s.sim.kills);
    const rec: RunRecord = {
      at: Date.now(),
      wave: s.wave,
      score: s.score,
      kills: s.sim.kills,
      keystrokes: s.sim.keystrokes,
      kpk: Math.round((s.sim.keystrokes / kills) * 100) / 100,
    };
    this.store.set((save) => {
      const lt = save.lifetime;
      lt.runs.push(rec);
      if (lt.runs.length > MAX_RUNS) lt.runs.splice(0, lt.runs.length - MAX_RUNS);
      if (s.score > lt.highScore) lt.highScore = s.score;
      lt.kills += s.sim.kills;
    });
    this.store.flush();
  }

  summary(): RunSummary {
    const s = this.state;
    const kills = Math.max(1, s.sim.kills);
    const runs = this.data.runs;
    const used: Array<[string, number]> = [...this.runUsage];
    used.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));

    const never: Array<[string, number]> = [];
    for (const [tok, n] of this.optimalTokens) {
      if (!this.usedThisRun.has(tok)) never.push([tok, n]);
    }
    never.sort((a, b) => b[1] - a[1]);

    return {
      topUsed: used.slice(0, 3),
      neverUsed: never.slice(0, 3),
      kpk: Math.round((s.sim.keystrokes / kills) * 100) / 100,
      prevKpk: runs.length > 1 ? runs[runs.length - 2].kpk : null,
      trend: runs.slice(-8).map((r) => r.kpk),
      wastedKeystrokes: this.wasted,
    };
  }

  get highScore(): number { return this.data.highScore; }

  // ---------------------------------------------------------------- lifetime
  // The death screen reports the run you just lost; the menu's `ledger` screen
  // reports every run in the save, so these read `lifetime` rather than the
  // per-run maps.

  /** Lifetime kills, summed at the end of each run. */
  get lifetimeKills(): number { return this.data.kills; }

  /** How many runs the save remembers (capped at MAX_RUNS). */
  get runCount(): number { return this.data.runs.length; }

  /** Most-pressed tokens across every run, commonest first. */
  topUsedEver(n = 3): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [tok, m] of Object.entries(this.data.motions)) {
      if (m.used > 0) out.push([tok, m.used]);
    }
    out.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    return out.slice(0, n);
  }

  /** Tokens that would have been optimal and were never pressed, worst first. */
  topMissedEver(n = 3): Array<[string, number]> {
    const out: Array<[string, number]> = [];
    for (const [tok, c] of Object.entries(this.data.missed)) {
      if (c > 0) out.push([tok, c]);
    }
    out.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
    return out.slice(0, n);
  }

  /** Keystrokes-per-kill for the last `n` runs, oldest first. */
  kpkTrend(n = 8): number[] {
    return this.data.runs.slice(-n).map((r) => r.kpk);
  }

  /** One row per token the save has seen: missed first, then most used (drills-and-coach D8). */
  table(): Array<{ tok: string; used: number; kills: number; missed: number }> {
    const toks = new Set([...Object.keys(this.data.motions), ...Object.keys(this.data.missed)]);
    const out: Array<{ tok: string; used: number; kills: number; missed: number }> = [];
    for (const tok of toks) {
      const m = this.data.motions[tok];
      const row = { tok, used: m?.used ?? 0, kills: m?.kills ?? 0, missed: this.data.missed[tok] ?? 0 };
      if (row.used > 0 || row.missed > 0) out.push(row);
    }
    out.sort((a, b) => (b.missed - a.missed) || (b.used - a.used) || (a.tok < b.tok ? -1 : 1));
    return out;
  }

  /** Lifetime medals, every name summed. */
  get medalTotal(): number {
    let n = 0;
    for (const c of Object.values(this.data.medals)) n += c;
    return n;
  }

  /** The coach's verdict over the lifetime ledger (drills-and-coach D7). */
  coach(): CoachEntry[] { return coach(this.data); }

  clear(): void {
    this.store.set((save) => { save.lifetime = emptyLifetime(); });
    this.store.flush();
  }
}
