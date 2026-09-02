// Phase B — the simulation. Owns tick(dt) and every game rule.
// Imports nothing from render/, audio/ or ui/. Runs headless in Node.
import { BARRICADE_COL, FIELD_COLS, ROWS, deriveRows, zombieAt } from '../core/field';
import { Rng } from '../core/rng';
import { BARRICADE_MAX, createState } from '../core/state';
import type { GameState, SpawnSpec } from '../core/state';
import type { Bus } from '../core/bus';
import type { Command, Zombie, ZombieKind } from '../core/types';
import { clampCursor, resolve } from '../vim/resolve';
import type { Span } from '../vim/resolve';
import { chargeKindFor, planKills } from './rules';
import { wordFor } from './words';
import { TUTORIAL, TUTORIAL_HOLD_MS } from './tutorial';
import {
  BREATHER_MS, COMBO_WINDOW_MS, baseSpeed, composition, spawnWindowMs, waveDef, waveSize,
} from './waves';

const CHARGES_DD = 2;
const CHARGES_D = 3;
const MAX_ZOMBIES = 80;      // hard entity cap; the renderer is sized for this
const SPAWN_TRIES = 24;

export class Sim {
  readonly state: GameState;
  private rng: Rng;
  private bus: Bus;
  private accum = new Map<number, number>();   // per-zombie row progress, 0..1

  constructor(seed: number, bus: Bus) {
    this.state = createState(seed);
    this.rng = new Rng(seed);
    this.bus = bus;
    this.state.sim.rngState = this.rng.state;
    deriveRows(this.state.buffer.zombies, this.state.barricade, this.state.buffer.rows);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Title -> playing. Wave 1 starts immediately. */
  start(): void {
    this.resetRun();
    this.startWave(1);
    this.refresh();
  }

  private resetRun(): void {
    const s = this.state;
    s.phase = 'playing';
    s.wave = 0;
    s.score = 0;
    s.combo = 0;
    s.barricade.hp = BARRICADE_MAX;
    s.buffer.zombies.length = 0;
    s.cursor = { row: 0, col: 0 };
    this.accum.clear();
    this.rng = new Rng(s.rngSeed);
    const sm = s.sim;
    sm.time = 0; sm.waveTime = 0; sm.breather = 0; sm.spawnQueue.length = 0;
    sm.spawnedThisWave = 0; sm.resolvedThisWave = 0; sm.waveSize = 0;
    sm.nextZombieId = 1; sm.lastKillAt = -1e9; sm.longestCombo = 0;
    sm.kills = 0; sm.overkills = 0; sm.commands = 0; sm.keystrokes = 0;
    sm.waveStartedAt = 0; sm.unlocks = []; sm.flashUntil = 0;
    sm.lockId = 0; sm.lockOffset = 0; sm.tutorial = -1; sm.tutorialHold = 0;
  }

  /** Back to the title screen, keeping the ledger and high score intact. */
  toTitle(): void {
    this.state.phase = 'title';
    this.state.buffer.zombies.length = 0;
    this.accum.clear();
    this.state.sim.tutorial = -1;
    this.refresh();
  }

  /** The warm-up. No clock, no wall damage, no score. Rolls into wave 1. */
  startTutorial(): void {
    this.resetRun();
    const sm = this.state.sim;
    sm.tutorial = 0;
    sm.tutorialHold = 0;
    this.state.cursor = { row: 8, col: 0 };
    this.setupTutorialStep(0);
    this.refresh();
  }

  /** Restart the current warm-up step. Nothing here is meant to be losable. */
  retryTutorialStep(): void {
    const sm = this.state.sim;
    if (sm.tutorial < 0) return;
    sm.tutorialHold = 0;
    this.setupTutorialStep(sm.tutorial);
    this.state.cursor = { row: 8, col: 0 };
    sm.lockId = 0;
    sm.lockOffset = 0;
    this.refresh();
  }

  private setupTutorialStep(i: number): void {
    const step = TUTORIAL[i];
    if (!step || step.spawn.length === 0) return;
    const sm = this.state.sim;
    // Charges refill every step: a wasted dd must never make a step unwinnable.
    this.state.charges.dd = CHARGES_DD;
    this.state.charges.D = CHARGES_D;
    this.state.buffer.zombies.length = 0;
    this.accum.clear();
    for (const [kind, row, col, text, speed] of step.spawn) {
      const z: Zombie = {
        id: sm.nextZombieId++, kind, row, col, text,
        hp: kind === 'armored' ? 2 : 1, speed,
      };
      this.state.buffer.zombies.push(z);
      this.accum.set(z.id, 0);
    }
  }

  private tickTutorial(dtMs: number): void {
    const s = this.state;
    const sm = s.sim;
    this.moveZombies(dtMs);

    if (sm.tutorialHold > 0) {
      sm.tutorialHold -= dtMs;
      if (sm.tutorialHold <= 0) {
        sm.tutorialHold = 0;
        sm.tutorial++;
        if (sm.tutorial >= TUTORIAL.length) {
          // The warm-up does not count: the run proper starts here.
          this.resetRun();
          this.startWave(1);
        } else {
          this.setupTutorialStep(sm.tutorial);
        }
      }
      this.refresh();
      return;
    }

    const step = TUTORIAL[sm.tutorial];
    const done = s.buffer.zombies.length === 0   // they got ahead of the lesson
      || (step.goal === 'reach' && zombieAt(s.buffer.zombies, s.cursor.row, s.cursor.col) !== null);
    if (done) sm.tutorialHold = TUTORIAL_HOLD_MS;
    this.refresh();
  }

  private startWave(n: number): void {
    const s = this.state;
    const sm = s.sim;
    s.wave = n;
    s.charges.dd = CHARGES_DD;
    s.charges.D = CHARGES_D;
    sm.waveTime = 0;
    sm.waveStartedAt = sm.time;
    sm.spawnedThisWave = 0;
    sm.resolvedThisWave = 0;
    sm.spawnQueue.length = 0;

    const size = waveSize(n);
    sm.waveSize = size;
    const speed = baseSpeed(n);
    const table = composition(n);
    for (let i = 0; i < size; i++) {
      const kind = this.pickKind(table);
      const text = wordFor(kind, this.rng);
      const win = spawnWindowMs(n);
      const at = Math.round((i / size) * win + this.rng.range(0, win / size));
      sm.spawnQueue.push({ at, kind, text, speed: kind === 'runner' ? speed * 2 : speed });
    }
    sm.spawnQueue.sort((a, b) => a.at - b.at);
    const def = waveDef(n);
    sm.unlocks = def.motions;
    sm.rngState = this.rng.state;
    this.bus.emit({ t: 'wave_start', n, unlocks: def.motions });
  }

  private pickKind(table: Array<[ZombieKind, number]>): ZombieKind {
    const r = this.rng.next();
    let acc = 0;
    for (const [kind, w] of table) { acc += w; if (r < acc) return kind; }
    return table[table.length - 1][0];
  }

  // ------------------------------------------------------------------ tick

  tick(dtMs: number): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const sm = s.sim;
    sm.time += dtMs;

    if (sm.tutorial >= 0) { this.tickTutorial(dtMs); return; }

    if (sm.breather > 0) {
      sm.breather -= dtMs;
      if (sm.breather <= 0) { sm.breather = 0; this.startWave(s.wave + 1); }
      this.refresh();
      return;
    }

    sm.waveTime += dtMs;
    this.runSpawns();
    this.moveZombies(dtMs);

    if (s.combo > 0 && sm.time - sm.lastKillAt > COMBO_WINDOW_MS) {
      this.breakCombo('combo timed out');
    }

    if (sm.spawnQueue.length === 0 && s.buffer.zombies.length === 0 &&
        (sm.spawnedThisWave > 0 || sm.resolvedThisWave > 0)) {
      this.bus.emit({ t: 'wave_clear', n: s.wave, ms: sm.time - sm.waveStartedAt });
      sm.breather = BREATHER_MS;
    }
    this.refresh();
  }

  private refresh(): void {
    const s = this.state;
    deriveRows(s.buffer.zombies, s.barricade, s.buffer.rows);
    this.applyLock();
    // The cursor holds its column even when the lane under it empties out -
    // see clampCursor: this game is virtualedit=all.
    s.cursor = clampCursor(s.buffer.rows, s.cursor);
  }

  /**
   * Target lock. Put the crosshair on a word and it rides that word east as
   * the zombie walks, keeping the same offset into it. Without it you lose
   * your aim every time the horde takes a step, which has nothing to do with
   * Vim and everything to do with being annoying.
   */
  private applyLock(): void {
    const sm = this.state.sim;
    if (sm.lockId === 0) return;
    const zs = this.state.buffer.zombies;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.id !== sm.lockId) continue;
      const off = Math.max(0, Math.min(sm.lockOffset, z.text.length - 1));
      this.state.cursor.row = z.row;
      this.state.cursor.col = z.col + off;
      return;
    }
    sm.lockId = 0;          // it died, or walked into the wall
    sm.lockOffset = 0;
  }

  /** Re-acquire (or drop) the lock after the player moves the crosshair. */
  private updateLock(): void {
    const s = this.state;
    const sm = s.sim;
    const z = zombieAt(s.buffer.zombies, s.cursor.row, s.cursor.col);
    if (z) { sm.lockId = z.id; sm.lockOffset = s.cursor.col - z.col; }
    else { sm.lockId = 0; sm.lockOffset = 0; }
  }

  // ------------------------------------------------------------------ spawning

  private runSpawns(): void {
    const sm = this.state.sim;
    const zs = this.state.buffer.zombies;
    while (sm.spawnQueue.length > 0 && sm.spawnQueue[0].at <= sm.waveTime) {
      const spec = sm.spawnQueue[0];
      if (zs.length >= MAX_ZOMBIES) break;
      const row = this.findSpawnLane(spec.text.length);
      if (row < 0) { spec.at += 250; sm.spawnQueue.sort((a, b) => a.at - b.at); break; }
      sm.spawnQueue.shift();
      this.spawn(spec, row);
    }
    sm.rngState = this.rng.state;
  }

  /** A lane with room at the western edge, or -1 to try again shortly. */
  private findSpawnLane(len: number): number {
    const zs = this.state.buffer.zombies;
    if (len >= FIELD_COLS) return -1;
    for (let i = 0; i < SPAWN_TRIES; i++) {
      const row = this.rng.int(ROWS);
      let ok = true;
      for (let j = 0; j < zs.length; j++) {
        const z = zs[j];
        if (z.row !== row) continue;
        if (z.col - 1 < len) { ok = false; break; }   // needs a clear cell of gap
      }
      if (ok) return row;
    }
    return -1;
  }

  private spawn(spec: SpawnSpec, row: number): void {
    const sm = this.state.sim;
    const z: Zombie = {
      id: sm.nextZombieId++,
      kind: spec.kind,
      row,
      col: 0,
      text: spec.text,
      hp: spec.kind === 'armored' ? 2 : 1,
      speed: spec.speed,
    };
    this.state.buffer.zombies.push(z);
    this.accum.set(z.id, 0);
    sm.spawnedThisWave++;
  }

  // ------------------------------------------------------------------ movement

  private moveZombies(dtMs: number): void {
    const zs = this.state.buffer.zombies;
    const dt = dtMs / 1000;
    // Nearest the wall moves first, so a stalled queue releases cleanly.
    for (let col = FIELD_COLS - 1; col >= 0; col--) {
      for (let i = zs.length - 1; i >= 0; i--) {
        const z = zs[i];
        if (z.col !== col) continue;
        let a = (this.accum.get(z.id) ?? 0) + dt * z.speed;
        while (a >= 1) {
          const target = z.col + 1;
          if (target + z.text.length > BARRICADE_COL) { this.hitBarricade(z, i); a = 0; break; }
          if (this.blocked(z, target)) { a = 1; break; }
          z.col = target;
          a -= 1;
        }
        this.accum.set(z.id, a);
      }
    }
  }

  private blocked(self: Zombie, col: number): boolean {
    const zs = this.state.buffer.zombies;
    const len = self.text.length;
    for (let j = 0; j < zs.length; j++) {
      const o = zs[j];
      if (o === self || o.row !== self.row) continue;
      if (col - 1 < o.col + o.text.length && o.col - 1 < col + len) return true;
    }
    return false;
  }

  private hitBarricade(z: Zombie, index: number): void {
    const s = this.state;
    if (s.sim.tutorial >= 0) { this.remove(index); return; }   // no stakes in the warm-up
    const dmg = z.text.length;
    s.barricade.hp = Math.max(0, s.barricade.hp - dmg);
    this.remove(index);
    s.sim.resolvedThisWave++;
    this.bus.emit({ t: 'barricade_hit', dmg, hpLeft: s.barricade.hp });
    this.breakCombo('the barricade took a hit');
    if (s.barricade.hp <= 0) this.die();
  }

  private die(): void {
    const s = this.state;
    s.phase = 'dead';
    this.bus.emit({ t: 'death', wave: s.wave, score: s.score });
  }

  private remove(index: number): void {
    const zs = this.state.buffer.zombies;
    this.accum.delete(zs[index].id);
    zs.splice(index, 1);
  }

  // ------------------------------------------------------------------ commands

  /** Feed a raw keystroke count so the ledger can compute keystrokes-per-kill. */
  noteKeystroke(): void { this.state.sim.keystrokes++; }

  /** An unknown key. Vim beeps; we flash the buffer red and break the combo. */
  unknownKey(): void {
    this.state.sim.flashUntil = this.state.sim.time + 80;
    this.breakCombo('unknown key');
  }

  apply(cmd: Command): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const sm = s.sim;
    sm.commands++;
    this.bus.emit({ t: 'command', cmd, ms: Math.round(sm.time) });

    if (cmd.operator === 'J') { this.applyJoin(); this.updateLock(); this.refresh(); return; }

    const r = resolve(cmd, s.buffer, s.cursor);

    // Cursor first: even a whiffed operator moves you in Vim.
    s.cursor = clampCursor(s.buffer.rows, r.newCursor);
    this.updateLock();

    if (cmd.search) return;              // a snipe is a move, not an attack
    if (!cmd.operator) return;           // pure motion

    if (!r.ok || r.affected.length === 0) {
      this.breakCombo(`${cmd.raw} hit nothing`);
      return;
    }

    const plan = planKills(cmd, r.affected, s.buffer.zombies);
    if (plan.touched === 0) {
      this.emitShots(r.affected, 0);          // you fired into the dark
      this.breakCombo(`${cmd.raw} hit nothing`);
      return;
    }

    const charge = chargeKindFor(cmd, r.affected, plan);
    if (charge) {
      if (s.charges[charge] <= 0) { this.breakCombo(`no ${charge} charges left`); return; }
      s.charges[charge]--;
      this.bus.emit({ t: 'charge_used', kind: charge });
    }

    this.emitShots(r.affected, plan.victims.length);

    // Chips first: stripping armor shifts no index.
    for (const i of plan.chips) {
      const z = s.buffer.zombies[i];
      z.hp--;
      if (z.hp <= 0) {
        // Both bracket glyphs stripped: it is just a walker now.
        z.text = z.text.slice(1, -1);
        z.col += 1;
        z.kind = 'walker';
        z.hp = 1;
      }
    }
    // Carve the survivors before anything is spliced out from under the indices.
    for (const e of plan.erosions) {
      const z = s.buffer.zombies[e.index];
      z.col = e.col;
      z.text = e.text;
    }
    // Victims descending, so splicing cannot invalidate a later index.
    for (let i = plan.victims.length - 1; i >= 0; i--) {
      const idx = plan.victims[i];
      const z = s.buffer.zombies[idx];
      this.kill(idx, cmd.raw, z.kind === 'crawler' && cmd.operator !== 'x');
    }
    if (plan.overkill) this.breakCombo('overkill');
    this.refresh();
  }

  private applyJoin(): void {
    const s = this.state;
    const row = s.cursor.row;
    if (row + 1 >= ROWS) { this.breakCombo('nothing below to join'); return; }
    const zs = s.buffer.zombies;
    const resident: Zombie[] = [];
    for (const z of zs) if (z.row === row) resident.push(z);

    let moved = 0;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (z.row !== row + 1) continue;
      let crushed = false;
      for (const o of resident) {
        if (z.col < o.col + o.text.length && o.col < z.col + z.text.length) { crushed = true; break; }
      }
      if (crushed) { this.kill(i, 'J', false); }
      else { z.row = row; resident.push(z); }
      moved++;
    }
    if (moved === 0) this.breakCombo('nothing below to join');
  }

  /** One shot per affected lane, so the renderer can flash and trace. */
  private emitShots(spans: readonly Span[], hits: number): void {
    for (let r = 0; r < ROWS; r++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const sp of spans) {
        if (sp.row !== r) continue;
        if (sp.colStart < lo) lo = sp.colStart;
        if (sp.colEnd > hi) hi = sp.colEnd;
      }
      if (hi < 0) continue;
      this.bus.emit({ t: 'shot', row: r, colStart: lo, colEnd: hi, hits });
    }
  }

  private kill(index: number, via: string, overkill: boolean): void {
    const s = this.state;
    const sm = s.sim;
    const z = s.buffer.zombies[index];
    const len = z.text.length;
    const kind = z.kind;
    const id = z.id;
    this.remove(index);

    sm.kills++;
    sm.resolvedThisWave++;
    if (overkill) sm.overkills++;

    if (sm.time - sm.lastKillAt <= COMBO_WINDOW_MS) s.combo++;
    else s.combo = 1;
    sm.lastKillAt = sm.time;
    if (s.combo > sm.longestCombo) sm.longestCombo = s.combo;

    s.score += Math.round(10 * len * (1 + s.combo / 10));
    this.bus.emit({ t: 'kill', zombieId: id, kind, via, overkill });
    this.bus.emit({ t: 'combo', n: s.combo });
  }

  private breakCombo(reason: string): void {
    this.state.combo = 0;
    this.bus.emit({ t: 'combo_break', reason });
  }
}
