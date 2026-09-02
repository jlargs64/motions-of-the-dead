// Phase E — the Motion Ledger. The point of the game: it tells you which Vim
// you actually know and which Vim you keep avoiding.
import type { Bus } from '../core/bus';
import type { GameState } from '../core/state';
import type { Buffer, Cursor, Zombie } from '../core/types';
import { optimalKill, tokensUsed } from '../sim/optimal';

const KEY = 'motd.ledger';
const MAX_RUNS = 40;

export interface MotionStat { used: number; kills: number }
export interface RunRecord {
  at: number; wave: number; score: number; kills: number; keystrokes: number; kpk: number;
}
export interface LedgerData {
  motions: Record<string, MotionStat>;
  missed: Record<string, number>;
  runs: RunRecord[];
  highScore: number;
}

export interface RunSummary {
  topUsed: Array<[string, number]>;
  neverUsed: Array<[string, number]>;
  kpk: number;
  prevKpk: number | null;
  trend: number[];
  wastedKeystrokes: number;
}

function emptyData(): LedgerData {
  return { motions: {}, missed: {}, runs: [], highScore: 0 };
}

function load(): LedgerData {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return emptyData();
    const d = JSON.parse(raw) as Partial<LedgerData>;
    return {
      motions: d.motions ?? {},
      missed: d.missed ?? {},
      runs: Array.isArray(d.runs) ? d.runs : [],
      highScore: typeof d.highScore === 'number' ? d.highScore : 0,
    };
  } catch { return emptyData(); }
}

function save(d: LedgerData): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(d)); } catch { /* private window */ }
}

interface Snapshot { buffer: Buffer; cursor: Cursor; charges: { dd: number; D: number }; raw: string }

export class Ledger {
  data: LedgerData = load();

  /** Reset every run. */
  private usedThisRun = new Set<string>();
  private runUsage = new Map<string, number>();
  private optimalTokens = new Map<string, number>();
  /** State at the first command after the last kill: the anchor a kill is judged from. */
  private anchor: Snapshot | null = null;
  private keysSinceAnchor = 0;
  private wasted = 0;

  constructor(private state: GameState, bus: Bus) {
    bus.on('command', (e) => this.onCommand(e.cmd.raw));
    bus.on('kill', (e) => this.onKill(e.zombieId, e.via));
    bus.on('wave_start', (e) => { if (e.n === 1) this.beginRun(); });
    bus.on('death', () => this.endRun());
  }

  beginRun(): void {
    this.usedThisRun.clear();
    this.runUsage.clear();
    this.optimalTokens.clear();
    this.anchor = null;
    this.keysSinceAnchor = 0;
    this.wasted = 0;
  }

  private onCommand(raw: string): void {
    for (const tok of tokensUsed(raw)) {
      this.usedThisRun.add(tok);
      this.runUsage.set(tok, (this.runUsage.get(tok) ?? 0) + 1);
      const m = this.data.motions[tok] ?? (this.data.motions[tok] = { used: 0, kills: 0 });
      m.used++;
    }
    // The first command after a kill anchors the next comparison: everything
    // from here until the next kill is what that kill actually cost you.
    if (!this.anchor) {
      const s = this.state;
      this.anchor = {
        buffer: { rows: s.buffer.rows.slice(), zombies: s.buffer.zombies.map(copy) },
        cursor: { row: s.cursor.row, col: s.cursor.col },
        charges: { dd: s.charges.dd, D: s.charges.D },
        raw,
      };
      this.keysSinceAnchor = 0;
    }
    this.keysSinceAnchor += raw.length;
  }

  private onKill(zombieId: number, via: string): void {
    for (const tok of tokensUsed(via)) {
      const m = this.data.motions[tok] ?? (this.data.motions[tok] = { used: 0, kills: 0 });
      m.kills++;
    }
    const anchor = this.anchor;
    // Only the first kill of a sequence is second-guessed; multi-kills were good.
    if (!anchor) return;
    const spent = this.keysSinceAnchor;
    this.anchor = null;
    this.keysSinceAnchor = 0;

    const target = anchor.buffer.zombies.find((z) => z.id === zombieId);
    if (!target) return;                       // it spawned after the anchor
    const best = optimalKill(anchor.buffer, anchor.cursor, target, anchor.charges);
    if (!best || best.keys.length >= spent) return;
    this.wasted += spent - best.keys.length;
    for (const tok of tokensUsed(best.keys)) {
      this.optimalTokens.set(tok, (this.optimalTokens.get(tok) ?? 0) + 1);
      if (!this.usedThisRun.has(tok)) this.data.missed[tok] = (this.data.missed[tok] ?? 0) + 1;
    }
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
    this.data.runs.push(rec);
    if (this.data.runs.length > MAX_RUNS) this.data.runs.splice(0, this.data.runs.length - MAX_RUNS);
    if (s.score > this.data.highScore) this.data.highScore = s.score;
    save(this.data);
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

  clear(): void { this.data = emptyData(); save(this.data); }
}

function copy(z: Zombie): Zombie {
  return { id: z.id, kind: z.kind, row: z.row, col: z.col, text: z.text, hp: z.hp, speed: z.speed };
}
