// Phase B — the simulation. Owns tick(dt) and every game rule.
// Imports nothing from render/, audio/ or ui/. Runs headless in Node.
import { BARRICADE_COL, FIELD_COLS, ROWS, deriveRows, zombieAt } from '../core/field';
import { Rng } from '../core/rng';
import { BARRICADE_MAX, CHARGES_D, CHARGES_DD, createState, freshPurchases, freshShop } from '../core/state';
import type { GameMode, GameState, ItemId, SpawnSpec } from '../core/state';
import type { Bus } from '../core/bus';
import type { Command, Cursor, Zombie, ZombieKind } from '../core/types';
import { clampCursor, resolve } from '../vim/resolve';
import type { Span } from '../vim/resolve';
import { HOBBLE_FACTOR, WASTE_ALLOWANCE, chargeKindFor, isLegShot, planKills } from './rules';
import type { Plan } from './rules';
import { beginAnchor, judgeKill, noteCommand } from './judgement';
import type { JudgeAnchor, Judgement } from './judgement';
import {
  DRILL_CHARGES, DRILL_MS, FAMILIES, cheapestPlacement, familyById, generateScene, orderHit,
} from './drills';
import type { DrillFamily } from './drills';
import {
  PERFECT, STYLE_BONUS, isTrapKill, judgeMultiKill, judgeStyle,
} from './medals';
import type { Medal } from './medals';
import { wordFor } from './words';
import { MISSIONS, MISSION_HOLD_MS, MISSION_SUPPLIES, starsFor } from './missions';
import type { MissionSpawn } from './missions';
import { missionPar } from './optimal';
import {
  BREATHER_MS, COMBO_WINDOW_MS, baseSpeed, composition, spawnWindowMs, waveDef, waveSize,
} from './waves';
import {
  FLARE_SPEED, ITEMS, PLANKS_HP, REVIVE_HP, SANDBAGS_HP, SHOP_ROWS,
  SPOTTER_KILLS, WHETSTONE_CELLS, canBuy, itemById,
} from './store';
import { fenceLanes, fireTraps, mineBlocks, surveyBuffer } from './traps';

/**
 * `J` resolves by hand rather than through `planKills` - it crushes by
 * geometry, not by a span - so it builds the Plan the medal ladder reads.
 * Cells, chips and erosions are not part of a crush.
 */
function joinPlan(victims: number[]): Plan {
  return {
    victims, chips: [], erosions: [], killedCells: 0, erodedCells: 0,
    overkill: false, touched: victims.length,
  };
}

const MAX_ZOMBIES = 80;      // hard entity cap; the renderer is sized for this
const SPAWN_TRIES = 24;

export class Sim {
  readonly state: GameState;
  private rng: Rng;
  private bus: Bus;
  private accum = new Map<number, number>();   // per-zombie row progress, 0..1
  /** The anchor the current command's first kill was judged from, for the
   *  style medals awarded after the victims loop. */
  private consumed: JudgeAnchor | null = null;
  /**
   * A drill scene's target died inside `apply()`'s victims loop. The field is
   * replaced only once that loop and the medals are done, or the next victim's
   * index would point into the new scene. Transient within one command, so it
   * needs no place in `json()`.
   */
  private dealPending = false;

  constructor(seed: number, bus: Bus) {
    this.state = createState(seed);
    this.rng = new Rng(seed);
    this.bus = bus;
    this.state.sim.rngState = this.rng.state;
    deriveRows(this.state.buffer.zombies, this.state.barricade, this.state.buffer.rows);
  }

  // ------------------------------------------------------------------ lifecycle

  /** Menu -> playing. Wave 1 starts immediately. The mode picks the rules. */
  start(mode: GameMode = 'survival'): void {
    this.resetRun(mode);
    this.startWave(1);
    this.refresh();
  }

  private resetRun(mode: GameMode = 'survival'): void {
    const s = this.state;
    s.phase = 'playing';
    s.wave = 0;
    s.score = 0;
    // The wallet is per-run, and a mission starts through here too, so a
    // plant mission's stake cannot be banked (DECISIONS #67).
    s.supplies = 0;
    s.combo = 0;
    s.barricade.hp = BARRICADE_MAX;
    s.buffer.zombies.length = 0;
    s.cursor = { row: 0, col: 0 };
    this.accum.clear();
    this.rng = new Rng(s.rngSeed);
    const sm = s.sim;
    sm.mode = mode;
    sm.time = 0; sm.waveTime = 0; sm.breather = 0; sm.spawnQueue.length = 0;
    sm.spawnedThisWave = 0; sm.resolvedThisWave = 0; sm.killsThisWave = 0;
    sm.waveSize = 0;
    sm.nextZombieId = 1; sm.lastKillAt = -1e9; sm.longestCombo = 0;
    sm.kills = 0; sm.overkills = 0; sm.commands = 0; sm.keystrokes = 0;
    sm.waveStartedAt = 0; sm.unlocks = []; sm.flashUntil = 0;
    sm.lockId = 0; sm.lockOffset = 0;
    sm.mission = -1; sm.missionBeat = 'try'; sm.missionHold = 0; sm.missionKeys = 0;
    sm.judge = null;
    this.consumed = null;
    // The store is per-run too: traps, ammo caps and every banked item die
    // with the run (DECISIONS #77).
    s.barricade.maxHp = BARRICADE_MAX;
    s.charges.dd = CHARGES_DD;
    s.charges.D = CHARGES_D;
    sm.shop = freshShop();
    sm.traps = [];
    sm.nextTrapId = 1;
    sm.chargeCap = { dd: CHARGES_DD, D: CHARGES_D };
    sm.purchases = freshPurchases();
    sm.wasteBonus = 0; sm.flare = false; sm.wireLanes = 0; sm.spotter = 0;
    sm.manifest = false; sm.secondWind = false; sm.freeRepeat = 0;
    sm.missionEscaped = false;
    sm.drill = ''; sm.drillLeft = 0; sm.drillScenes = 0; sm.drillPerfect = 0;
    sm.drillTarget = 0; sm.drillOrder = null; sm.drillKeys = 0;
    this.dealPending = false;
  }

  /** Back to the main menu, keeping the ledger and high score intact. */
  toMenu(): void {
    const sm = this.state.sim;
    this.state.phase = 'menu';
    this.state.buffer.zombies.length = 0;
    this.accum.clear();
    sm.mission = -1;
    sm.drill = '';
    sm.drillOrder = null;
    // Nothing you bought survives leaving the run.
    sm.traps = [];
    sm.wireLanes = 0;
    sm.shop = freshShop();
    this.refresh();
  }

  /** @deprecated The title screen is the menu now. Kept as an alias so old
   *  call sites and fixtures keep working (DECISIONS #56). */
  toTitle(): void { this.toMenu(); }

  /**
   * Everything a run needs to be picked up later (DECISIONS #96): a deep copy
   * of the state, and the one thing `json()` does not carry - each zombie's
   * fraction of a column walked - so a restored run steps on exactly as the
   * live one would have. Plain data, so it survives JSON and localStorage.
   */
  snapshot(): { state: GameState; progress: Record<string, number> } {
    const progress: Record<string, number> = {};
    for (const [id, a] of this.accum) progress[String(id)] = a;
    return { state: JSON.parse(JSON.stringify(this.state)) as GameState, progress };
  }

  /**
   * Pick a run back up from a `snapshot()`. The state object keeps its
   * identity - the renderer, the ledger and `Game.json()` all hold it - so
   * the fields are written into it rather than swapped out from under them.
   * The RNG resumes from `sim.rngState`, which is why the next night's horde
   * is the one it would have been. Throws on a snapshot that is not a state.
   */
  restore(snap: GameState, progress: Record<string, number> = {}): void {
    if (!snap || typeof snap !== 'object' || !snap.sim || !snap.buffer || !Array.isArray(snap.buffer.zombies)) {
      throw new Error('restore: not a game state');
    }
    const copy = JSON.parse(JSON.stringify(snap)) as GameState;
    const s = this.state;
    s.buffer = copy.buffer;
    s.cursor = copy.cursor;
    s.barricade = copy.barricade;
    s.wave = copy.wave;
    s.score = copy.score;
    s.supplies = copy.supplies;
    s.combo = copy.combo;
    s.charges = copy.charges;
    s.phase = copy.phase;
    s.rngSeed = copy.rngSeed;
    s.sim = copy.sim;
    this.rng = new Rng(s.rngSeed);
    this.rng.state = s.sim.rngState;
    this.accum.clear();
    for (const z of s.buffer.zombies) {
      const a = progress[String(z.id)];
      this.accum.set(z.id, typeof a === 'number' && Number.isFinite(a) ? a : 0);
    }
    this.consumed = null;
    this.refresh();
  }

  /**
   * Start mission `i`: a scripted scene, no clock, no wall damage, no score,
   * and a par to beat (DECISIONS #91). Out-of-range clamps rather than
   * throwing, so a stale save index still lands somewhere.
   */
  startMission(i = 0): void {
    const idx = Math.max(0, Math.min(Math.floor(i) || 0, MISSIONS.length - 1));
    this.resetRun('mission');
    const sm = this.state.sim;
    sm.mission = idx;
    this.enterTry();
  }

  /**
   * Stand up a scripted scene with no wave, no spawn queue and no clock.
   *
   * This is the mission select screen's demo pane: it feeds keystrokes through
   * a Vim engine into its own Sim so kills, erosion and charges are resolved
   * by the real rules, and it never calls `tick()` - so nothing moves, nothing
   * spawns, the wall is never hit and no mission ever auto-advances. Keeping
   * the demo on its own Sim is what lets the menu honour its isolation rule:
   * the live GameState is untouched while the pane plays.
   */
  startScene(spawn: readonly MissionSpawn[], cursor: Cursor): void {
    this.resetRun('mission');
    this.state.charges.dd = CHARGES_DD;
    this.state.charges.D = CHARGES_D;
    this.state.cursor = { row: cursor.row, col: cursor.col };
    this.spawnScene(spawn);
    this.refresh();
  }

  /** `r`: the same mission from the top of TRY. Nothing here is losable. */
  retryMission(): void {
    if (this.state.sim.mission < 0) return;
    this.enterTry();
  }

  /** `n` on DONE: the next mission in table order, or the menu after the last. */
  nextMission(): void {
    const sm = this.state.sim;
    if (sm.mission < 0 || sm.missionBeat !== 'done') return;
    if (sm.mission + 1 >= MISSIONS.length) { this.toMenu(); return; }
    this.startMission(sm.mission + 1);
  }

  /** One keystroke fed during TRY. Counted against par; `r` is not one. */
  noteMissionKey(): void {
    const sm = this.state.sim;
    if (sm.mission >= 0 && sm.missionBeat === 'try') sm.missionKeys++;
  }

  /** The oracle's par for the current mission, or -1 outside one. */
  currentPar(): number {
    const m = MISSIONS[this.state.sim.mission];
    return m ? missionPar(m.id) : -1;
  }

  /** TRY from the top: fresh scene, full magazine, zero keys, start cursor. */
  private enterTry(): void {
    const s = this.state;
    const sm = s.sim;
    const m = MISSIONS[sm.mission];
    if (!m) return;
    sm.missionBeat = 'try';
    sm.missionHold = 0;
    sm.missionKeys = 0;
    sm.missionEscaped = false;
    s.phase = 'playing';
    s.cursor = { row: m.start[0], col: m.start[1] };
    // Charges refill every attempt: a wasted dd must never make a mission
    // unwinnable (DECISIONS R17).
    s.charges.dd = CHARGES_DD;
    s.charges.D = CHARGES_D;
    // Before the scene is stood up again, so a placement mission re-arms from
    // the cursor it is about to have rather than the one it had.
    sm.lockId = 0;
    sm.lockOffset = 0;
    this.spawnScene(m.spawn);
    if (m.goal === 'plant' && m.plant) this.armMissionPlacement(m.plant.item);
    this.refresh();
  }

  /**
   * Put a plant mission straight into the store's placement mode, with no
   * store and no economy in front of it. `phase` is `shop` because that is
   * what routes keys to `shopCommand` and what makes the renderer draw the
   * survey grid - the mission is the real placement mode, not a mock of it
   * (DECISIONS #85).
   */
  private armMissionPlacement(item: ItemId): void {
    const s = this.state;
    const sm = s.sim;
    s.supplies = MISSION_SUPPLIES;
    sm.traps = [];
    sm.wireLanes = 0;
    sm.purchases = freshPurchases();
    s.phase = 'shop';
    sm.shop.cursor = 0;
    sm.shop.mode = 'place';
    sm.shop.item = item;
    sm.shop.anchor = null;
    sm.shop.place = { row: s.cursor.row, col: s.cursor.col };
  }

  /**
   * A plant during a mission: done when the span is at least as wide as the
   * lesson asked for, and re-armed when it is not, so a one-lane fence is a
   * retry rather than a dead end.
   */
  private missionPlanted(): void {
    const s = this.state;
    const sm = s.sim;
    const m = MISSIONS[sm.mission];
    const want = m?.plant;
    const trap = sm.traps[sm.traps.length - 1];
    const lanes = trap ? trap.row1 - trap.row0 + 1 : 0;
    if (!want || lanes < want.lanes) {
      // Not wide enough. Leave the stub on the field as the evidence and hand
      // placement straight back.
      sm.shop.mode = 'place';
      sm.shop.item = want ? want.item : sm.shop.item;
      sm.shop.anchor = null;
      return;
    }
    s.phase = 'playing';
    sm.shop.mode = 'list';
    sm.shop.item = '';
    sm.missionHold = MISSION_HOLD_MS;
  }

  /** Replace the field with exactly this list of zombies. */
  private spawnScene(spawn: readonly MissionSpawn[]): void {
    const sm = this.state.sim;
    this.state.buffer.zombies.length = 0;
    this.accum.clear();
    for (const [kind, row, col, text, speed] of spawn) {
      const z: Zombie = {
        id: sm.nextZombieId++, kind, row, col, text,
        hp: kind === 'armored' ? 2 : 1, speed,
      };
      this.state.buffer.zombies.push(z);
      this.accum.set(z.id, 0);
    }
  }

  private tickMission(dtMs: number): void {
    const s = this.state;
    const sm = s.sim;
    // DONE is a card waiting for a key. Nothing walks under it.
    if (sm.missionBeat === 'done') { this.refresh(); return; }
    this.moveZombies(dtMs);

    if (sm.missionHold > 0) {
      sm.missionHold -= dtMs;
      if (sm.missionHold <= 0) { sm.missionHold = 0; this.missionDone(); }
      this.refresh();
      return;
    }

    const m = MISSIONS[sm.mission];
    // An empty field only counts as a clear when the player emptied it. Left
    // alone, every zombie used to reach the wall, be silently deleted, and the
    // empty field it left behind advanced the mission (DECISIONS #89).
    if (sm.missionEscaped) {
      if (s.buffer.zombies.length === 0) this.retryMission();
      this.refresh();
      return;
    }
    const done = s.buffer.zombies.length === 0   // they got ahead of the lesson
      || (m.goal === 'reach' && zombieAt(s.buffer.zombies, s.cursor.row, s.cursor.col) !== null);
    if (done) sm.missionHold = MISSION_HOLD_MS;
    this.refresh();
  }

  /** The hold has run out: judge the keystrokes against par and wait. */
  private missionDone(): void {
    const sm = this.state.sim;
    const m = MISSIONS[sm.mission];
    if (!m) return;
    sm.missionBeat = 'done';
    const par = missionPar(m.id);
    const stars = starsFor(sm.missionKeys, par);
    this.bus.emit({ t: 'mission_done', id: m.id, keys: sm.missionKeys, par, stars });
  }

  private startWave(n: number): void {
    const s = this.state;
    const sm = s.sim;
    s.wave = n;
    // Survival buys its ammunition; every other mode refills (DECISIONS #78).
    if (sm.mode !== 'survival') {
      s.charges.dd = CHARGES_DD;
      s.charges.D = CHARGES_D;
    }
    sm.waveTime = 0;
    sm.waveStartedAt = sm.time;
    sm.spawnedThisWave = 0;
    sm.resolvedThisWave = 0;
    sm.killsThisWave = 0;
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
    // A flare burns for one night: runners keep their 2x on the reduced base,
    // because the multiplier lands on the already-doubled queued speed.
    if (sm.flare) {
      for (const spec of sm.spawnQueue) spec.speed *= FLARE_SPEED;
      sm.flare = false;
    }
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
    const sm = s.sim;
    // A placement order is played in the store's phase, and the drill clock
    // does not stop for it (drills-and-coach D9).
    if (s.phase !== 'playing' && !(s.phase === 'shop' && sm.drill !== '')) return;
    sm.time += dtMs;

    if (sm.drill !== '') { this.tickDrill(dtMs); return; }
    if (sm.mission >= 0) { this.tickMission(dtMs); return; }

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

    // `phase` is re-read here: the zombie that emptied the field may have been
    // the one that breached the wall, and a death must not be overwritten by a
    // wave clear on the same tick.
    if (s.phase === 'playing' &&
        sm.spawnQueue.length === 0 && s.buffer.zombies.length === 0 &&
        (sm.spawnedThisWave > 0 || sm.resolvedThisWave > 0)) {
      // A wave the wall fought on its own is not a wave you cleared. Standing
      // still and letting all of them through used to cost 41 of 100 HP on
      // wave 1 and then hand you wave 2, so the only way to lose by idling was
      // to idle twice (DECISIONS #89). One kill anywhere in the night - your
      // own or a trap you paid for - is enough to have played it, and the
      // whole night has to have shown up: a partial wave the wall happened to
      // absorb is a breach, which Second Wind answers, not an overrun.
      if (sm.killsThisWave === 0 && sm.waveSize > 0 && sm.spawnedThisWave >= sm.waveSize) {
        this.die('overrun');
        this.refresh();
        return;
      }
      this.bus.emit({ t: 'wave_clear', n: s.wave, ms: sm.time - sm.waveStartedAt });
      // Survival shops between nights; every other mode keeps the breather.
      if (sm.mode === 'survival') this.openShop();
      else sm.breather = BREATHER_MS;
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
        // Set when the zombie left the list under us: its accumulator went
        // with it, and writing one back would resurrect a dead id.
        let gone = false;
        while (a >= 1) {
          const target = z.col + 1;
          if (target + z.text.length > BARRICADE_COL) {
            // Barbed wire spends itself holding the first one that arrives.
            if (this.wireHolds(z)) { a = -z.speed; break; }
            this.hitBarricade(z, i);
            gone = true;
            break;
          }
          if (this.blocked(z, target)) { a = 1; break; }
          z.col = target;
          a -= 1;
          // Checked per column, not per tick, so a runner cannot step over a
          // wire it crossed on the way (DECISIONS #80).
          if (this.springTrap(z, i)) { gone = true; break; }
        }
        if (!gone) this.accum.set(z.id, a);
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

  /**
   * Barbed wire on this zombie's lane: it clears the lane's bit and reports
   * that the wall was spared. The caller sets the accumulator negative, so the
   * zombie stands still for a second before it tries again.
   */
  private wireHolds(z: Zombie): boolean {
    const sm = this.state.sim;
    const bit = 1 << z.row;
    if ((sm.wireLanes & bit) === 0) return false;
    sm.wireLanes &= ~bit;
    return true;
  }

  /**
   * The trap under this zombie, if any. Returns true when the zombie is gone
   * from the list, so the movement loop stops touching it. Armor takes one
   * chip and survives: a fence is not a text object.
   */
  private springTrap(z: Zombie, index: number): boolean {
    const sm = this.state.sim;
    const at = fireTraps(sm.traps, z);
    if (at < 0) return false;
    const trap = sm.traps[at];
    const { id, kind } = trap;
    trap.charges--;
    if (trap.charges <= 0) sm.traps.splice(at, 1);
    // The cell where the two actually met, which is where the renderer throws
    // the flash - not the head of the word, which may be a column short of it.
    const cell = Math.min(Math.max(trap.col0, z.col), z.col + z.text.length - 1);
    this.bus.emit({ t: 'trap_fire', trapId: id, row: z.row, col: cell });

    if (z.kind === 'armored') {
      z.hp--;
      if (z.hp <= 0) {
        z.text = z.text.slice(1, -1);
        z.col += 1;
        z.kind = 'walker';
        z.hp = 1;
      }
      return false;
    }
    this.trapKill(index, `trap:${kind}:${id}`);
    return true;
  }

  /**
   * A trap kill pays base score and nothing else: no combo multiplier, no
   * combo, no medal, no supplies, and a crawler taken by a mine is not an
   * overkill (DECISIONS #80). `applyLock` drops the lock on its own when the
   * zombie carrying it is gone.
   */
  private trapKill(index: number, via: string): void {
    const s = this.state;
    const sm = s.sim;
    const z = s.buffer.zombies[index];
    const len = z.text.length;
    const kind = z.kind;
    const id = z.id;
    this.remove(index);

    sm.kills++;
    sm.resolvedThisWave++;
    sm.killsThisWave++;
    s.score += 10 * len;
    this.bus.emit({ t: 'kill', zombieId: id, kind, via, overkill: false });
    if (sm.spotter > 0) sm.spotter--;
  }

  private hitBarricade(z: Zombie, index: number): void {
    const s = this.state;
    // No stakes in a mission - the wall takes no damage and the run cannot
    // end - but a zombie that walked past you is not a zombie you handled, so
    // the beat is marked failed and `tickMission` restarts it (DECISIONS #89).
    if (s.sim.mission >= 0) {
      s.sim.missionEscaped = true;
      this.remove(index);
      this.flash();
      return;
    }
    // A drill's horde stands still, so this is the belt to that brace: the
    // wall takes nothing and the sprint goes on (drills-and-coach D5).
    if (s.sim.drill !== '') { this.remove(index); return; }
    const dmg = z.text.length;
    s.barricade.hp = Math.max(0, s.barricade.hp - dmg);
    this.remove(index);
    s.sim.resolvedThisWave++;
    this.bus.emit({ t: 'barricade_hit', dmg, hpLeft: s.barricade.hp });
    this.breakCombo('the barricade took a hit');
    if (s.barricade.hp <= 0) this.die();
  }

  /**
   * `cause` is `'breach'` when the wall reached 0 HP and `'overrun'` when a
   * whole wave walked through it unopposed. Second Wind buys back wall HP, so
   * it answers a breach and not an overrun: the wall is not what failed when
   * you killed nothing, and reviving it would only hand you the next wave.
   */
  private die(cause: 'breach' | 'overrun' = 'breach'): void {
    const s = this.state;
    const sm = s.sim;
    // Second Wind: the wall comes back once, and the run does not end. The
    // combo is already broken by the hit that got us here, so this only has to
    // make sure of it - a second `combo_break` would be noise in the log.
    if (cause === 'breach' && sm.secondWind) {
      sm.secondWind = false;
      s.barricade.hp = Math.min(s.barricade.maxHp, REVIVE_HP);
      s.combo = 0;
      this.bus.emit({ t: 'revive' });
      return;
    }
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

  /**
   * An unknown key. Vim beeps; we say nothing at all. A fat-fingered `v` is not
   * a mistake worth washing the field red for, so this is silent - no flash, no
   * chrome. It still breaks the combo and still counts toward the death line.
   */
  unknownKey(): void {
    this.breakCombo('unknown key');
  }

  /**
   * The beep on its own. A refused purchase or an operator typed at the store
   * emits nothing but this: there is no combo to break between nights, and the
   * spec asks for a flash and no event.
   */
  private flash(): void {
    this.state.sim.flashUntil = this.state.sim.time + 80;
  }

  apply(cmd: Command): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const sm = s.sim;
    sm.commands++;
    this.consumed = null;
    this.bus.emit({ t: 'command', cmd, ms: Math.round(sm.time) });

    // The first command after run start or after a kill anchors the next
    // judgment: everything from here until the next kill is what that kill
    // actually cost you. Snapshot before the command resolves.
    let judge = sm.judge;
    const anchored = judge === null;
    if (judge === null) judge = sm.judge = beginAnchor(s);
    noteCommand(judge, cmd);

    if (cmd.operator === 'J') { this.applyJoin(cmd); this.updateLock(); this.refresh(); return; }

    const r = resolve(cmd, s.buffer, s.cursor);

    // Cursor first: even a whiffed operator moves you in Vim.
    s.cursor = clampCursor(s.buffer.rows, r.newCursor);
    this.updateLock();

    // A sequence that opens with a snipe remembers what it sniped, so the kill
    // that follows can be a CALLED SHOT.
    if (anchored && cmd.search) {
      const on = zombieAt(s.buffer.zombies, s.cursor.row, s.cursor.col);
      judge.searchTarget = on ? on.id : 0;
    }

    if (cmd.search) return;              // a snipe is a move, not an attack
    if (!cmd.operator) return;           // pure motion

    if (!r.ok || r.affected.length === 0) {
      // Nothing was even aimed at - an `f` that found no such character, a
      // `%` with no bracket. No shot is emitted, so without this the screen
      // says nothing at all.
      this.refuse(`${cmd.raw} found nothing`);
      return;
    }

    const plan = planKills(cmd, r.affected, s.buffer.zombies);
    if (plan.touched === 0) {
      this.emitShots(r.affected, 0);          // you fired into the dark
      this.breakCombo(`${cmd.raw} hit nothing`);
      return;
    }

    const charge = chargeKindFor(cmd, r.affected, plan, WASTE_ALLOWANCE + sm.wasteBonus);
    if (charge) {
      // A banked Repeater pays for a `.` instead of the magazine.
      if (cmd.repeat && sm.freeRepeat > 0) {
        sm.freeRepeat--;
      } else if (s.charges[charge] <= 0) {
        // The one that ends runs: in survival these do not refill, so a player
        // reaching for `dd` on a crowded lane gets silence and keeps reaching
        // (DECISIONS #86). A drill has no magazine at all, and says so.
        this.refuse(sm.drill !== ''
          ? `no ${charge} charges - a drill has no magazine; cut the word, not the gap`
          : `no ${charge} charges - buy one in the store`);
        return;
      } else {
        s.charges[charge]--;
        this.bus.emit({ t: 'charge_used', kind: charge });
      }
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
    const legShot = isLegShot(cmd);
    for (const e of plan.erosions) {
      const z = s.buffer.zombies[e.index];
      z.col = e.col;
      z.text = e.text;
      // A single shot into a word takes the legs: the first `x` halves its
      // speed for the rest of its life (DECISIONS #94). Once - a hobbled
      // zombie is not slowed again, and a crawler has no legs to lose.
      if (legShot && !z.hobbled && z.kind !== 'crawler') {
        z.hobbled = true;
        z.speed *= HOBBLE_FACTOR;
      }
      // Shot down to its last letter, it is a crawler now in every sense: it
      // draws as one, it is only cleanly killed by `x`, and a runner that lost
      // its legs no longer runs (DECISIONS #92). A hobbled runner already paid
      // for its legs, so it is not halved twice.
      if (z.text.length === 1 && z.kind !== 'crawler') {
        if (z.kind === 'runner' && !z.hobbled) z.speed *= 0.5;
        z.kind = 'crawler';
      }
    }
    // The plan's indices point into the list as it stands now; the medals are
    // judged from the victims' kinds, so keep a view of it before the splices.
    const before = s.buffer.zombies.slice();
    // Victims descending, so splicing cannot invalidate a later index.
    for (let i = plan.victims.length - 1; i >= 0; i--) {
      const idx = plan.victims[i];
      const z = s.buffer.zombies[idx];
      this.kill(idx, cmd.raw, z.kind === 'crawler' && cmd.operator !== 'x');
    }
    this.award(cmd, plan, before, cmd.raw);
    if (plan.overkill) this.breakCombo('overkill');
    if (this.dealPending) { this.dealPending = false; this.dealScene(); }
    this.refresh();
  }

  private applyJoin(cmd: Command): void {
    const s = this.state;
    const row = s.cursor.row;
    if (row + 1 >= ROWS) { this.breakCombo('nothing below to join'); return; }
    const zs = s.buffer.zombies;
    const before = zs.slice();
    const resident: Zombie[] = [];
    for (const z of zs) if (z.row === row) resident.push(z);

    // Descending, so a splice cannot invalidate an index still to come - which
    // also means an index into `before` stays valid the whole way down.
    const victims: number[] = [];
    let moved = 0;
    for (let i = zs.length - 1; i >= 0; i--) {
      const z = zs[i];
      if (z.row !== row + 1) continue;
      let crushed = false;
      for (const o of resident) {
        if (z.col < o.col + o.text.length && o.col < z.col + z.text.length) { crushed = true; break; }
      }
      if (crushed) { victims.push(i); this.kill(i, 'J', false); }
      else { z.row = row; resident.push(z); }
      moved++;
    }
    if (moved === 0) { this.breakCombo('nothing below to join'); return; }
    // A crush is a kill by one command, so it climbs the same ladder.
    victims.reverse();                    // the Plan contract wants them ascending
    this.award(cmd, joinPlan(victims), before, 'J');
    if (this.dealPending) { this.dealPending = false; this.dealScene(); }
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
    sm.killsThisWave++;
    if (overkill) sm.overkills++;

    if (sm.time - sm.lastKillAt <= COMBO_WINDOW_MS) s.combo++;
    else s.combo = 1;
    sm.lastKillAt = sm.time;
    if (s.combo > sm.longestCombo) sm.longestCombo = s.combo;

    s.score += Math.round(10 * len * (1 + s.combo / 10));
    // Score is the record; supplies are the money. A trap kill pays neither
    // wallet nor medal (DECISIONS #70).
    const trap = isTrapKill(via);
    if (!trap) s.supplies += len;
    this.bus.emit({ t: 'kill', zombieId: id, kind, via, overkill });
    this.bus.emit({ t: 'combo', n: s.combo });
    if (sm.spotter > 0) sm.spotter--;
    const j = trap ? null : this.judge(id);
    // The scene's target is what clears it; anything else was a kill and
    // nothing more. PERFECT is the shared judgement's word (drills-and-coach D5).
    if (sm.drill !== '' && id === sm.drillTarget) {
      sm.drillScenes++;
      if (j?.perfect) sm.drillPerfect++;
      this.dealPending = true;
    }
  }

  /**
   * The first kill after an anchor is the one that gets second-guessed: how
   * many keystrokes it took against the cheapest way there was. Later victims
   * of the same command, and kills before a new anchor, were good by
   * definition.
   */
  private judge(zombieId: number): Judgement | null {
    const sm = this.state.sim;
    const anchor = sm.judge;
    if (!anchor) return null;
    sm.judge = null;
    this.consumed = anchor;
    const j = judgeKill(anchor, zombieId);
    if (!j) return null;                 // it spawned after the anchor
    this.bus.emit({ t: 'kill_judged', zombieId, spent: j.spent, optimal: j.optimal });
    if (j.perfect) this.medal({ name: PERFECT, bonus: STYLE_BONUS[PERFECT] });
    return j;
  }

  // ------------------------------------------------------------------ drills
  // A sixty-second sprint through scenes of one family (drills-and-coach D5):
  // frozen horde, invulnerable wall, empty magazine, one scene at a time,
  // replaced the moment its target dies or the player presses `r`.

  /** The running drill's family, or undefined. */
  private drillFamily(): DrillFamily | undefined {
    return this.state.sim.drill === '' ? undefined : familyById(this.state.sim.drill);
  }

  /**
   * Start a drill. An unknown id starts the first family rather than
   * throwing, so a stale save key still lands somewhere.
   */
  startDrill(id: string): void {
    const fam = familyById(id) ?? FAMILIES[0];
    this.resetRun('drill');
    const sm = this.state.sim;
    sm.drill = fam.id;
    sm.drillLeft = DRILL_MS;
    this.dealScene();
    this.refresh();
  }

  /** `r` mid-drill: this scene is thrown away and the next is dealt. No credit. */
  skipScene(): void {
    if (!this.drillFamily() || this.state.phase === 'stats') return;
    this.dealScene();
    this.refresh();
  }

  /** `r` on the end card: the same family from the top. */
  retryDrill(): void {
    const fam = this.drillFamily();
    if (!fam || this.state.phase !== 'stats') return;
    this.startDrill(fam.id);
  }

  /** One keystroke fed to a placement order, counted for its PERFECT rule. */
  noteDrillKey(): void {
    if (this.state.sim.drill !== '') this.state.sim.drillKeys++;
  }

  /**
   * The next scene, drawn and verified by the family (D3) from the sim RNG
   * (D6). The judge anchor is dropped so the first kill in the new scene is
   * judged from where the new scene puts the crosshair; the magazine is set
   * to the drill's, which is empty.
   */
  private dealScene(): void {
    const s = this.state;
    const sm = s.sim;
    const fam = this.drillFamily();
    if (!fam) return;
    const scene = generateScene(fam, this.rng);
    sm.rngState = this.rng.state;
    sm.judge = null;
    this.consumed = null;
    sm.lockId = 0;
    sm.lockOffset = 0;
    s.charges.dd = DRILL_CHARGES.dd;
    s.charges.D = DRILL_CHARGES.D;
    sm.drillKeys = 0;
    s.cursor = { row: scene.cursor[0], col: scene.cursor[1] };
    if (scene.order) {
      // The store's real placement path, as boot-camp mission 8 takes it
      // (D9): `phase` is `shop` so keys route to `shopCommand` and the
      // renderer draws the survey grid. The wallet covers any span.
      this.spawnScene([]);
      sm.drillTarget = 0;
      sm.drillOrder = { ...scene.order };
      s.supplies = MISSION_SUPPLIES;
      sm.traps = [];
      sm.wireLanes = 0;
      sm.purchases = freshPurchases();
      s.phase = 'shop';
      sm.shop.cursor = 0;
      sm.shop.mode = 'place';
      sm.shop.item = scene.order.item;
      sm.shop.anchor = null;
      sm.shop.place = { row: s.cursor.row, col: s.cursor.col };
      return;
    }
    s.phase = 'playing';
    sm.drillOrder = null;
    this.spawnScene(scene.spawn);
    sm.drillTarget = s.buffer.zombies[scene.target]?.id ?? 0;
  }

  private tickDrill(dtMs: number): void {
    const sm = this.state.sim;
    sm.drillLeft -= dtMs;
    if (sm.drillLeft <= 0) { sm.drillLeft = 0; this.endDrill(); }
    this.refresh();
  }

  /** The clock ran out: the end card, and the score for the save to keep. */
  private endDrill(): void {
    const s = this.state;
    const sm = s.sim;
    s.phase = 'stats';
    sm.shop.mode = 'list';
    sm.shop.item = '';
    sm.shop.anchor = null;
    this.bus.emit({
      t: 'drill_done', family: sm.drill, kills: sm.kills, perfect: sm.drillPerfect, scenes: sm.drillScenes,
    });
  }

  /**
   * A plant during a placement order: a hit only on the exact span, PERFECT
   * when it took no more keystrokes than the cheapest way there was, and the
   * next order either way (D9). The trap is cleared with the order.
   */
  private drillPlanted(): void {
    const s = this.state;
    const sm = s.sim;
    const order = sm.drillOrder;
    const trap = sm.traps[sm.traps.length - 1];
    if (order && trap && orderHit(order, trap)) {
      sm.kills++;
      sm.drillScenes++;
      if (sm.drillKeys <= cheapestPlacement(order, s.cursor).cost) {
        sm.drillPerfect++;
        this.medal({ name: PERFECT, bonus: STYLE_BONUS[PERFECT] });
      }
    }
    this.dealScene();
  }

  /** Multi-kill and style medals for one command, after its victims are gone. */
  private award(cmd: Command, plan: Plan, before: readonly Zombie[], via: string): void {
    if (isTrapKill(via)) return;
    const multi = judgeMultiKill(plan);
    if (multi) this.medal(multi);
    for (const m of judgeStyle(cmd, plan, before, this.consumed)) this.medal(m);
  }

  /** One medal: it pays the wallet and it announces itself. */
  private medal(m: Medal): void {
    this.state.supplies += m.bonus;
    this.bus.emit({ t: 'medal', name: m.name, bonus: m.bonus });
  }

  private breakCombo(reason: string): void {
    this.state.combo = 0;
    this.bus.emit({ t: 'combo_break', reason });
  }

  /**
   * A command the sim declined to run. Distinct from an ordinary combo break
   * because there is nothing on screen to see: no shot, no kill, no movement.
   * It flashes the field like an unknown key does and carries a reason the
   * renderer can print (DECISIONS #86).
   */
  private refuse(reason: string): void {
    this.flash();
    this.state.combo = 0;
    this.bus.emit({ t: 'combo_break', reason, refused: true });
  }

  // ------------------------------------------------------------------ the store
  // Every entry point here is a *sim input*, reached from `Game.keys()` by a
  // keystroke, so a `runs/*.jsonl` log replays a shopping trip exactly
  // (DECISIONS #77). Nothing here reads the clock: `tick()` already returns
  // early for any phase that is not `playing`.

  /** Survival `wave_clear` -> the store. Time stops until `shopResume`. */
  openShop(): void {
    const s = this.state;
    const sm = s.sim;
    s.phase = 'shop';
    sm.shop.cursor = 0;
    sm.shop.mode = 'list';
    sm.shop.item = '';
    sm.shop.anchor = null;
    sm.shop.place = { row: s.cursor.row, col: s.cursor.col };
    // Both of these are per-visit, not per-run (DECISIONS #81): Manifest has
    // to be re-bought each night, and Whetstone expires with the night it
    // bought, which is the night that just ended.
    sm.manifest = false;
    sm.wasteBonus = 0;
    this.refresh();
  }

  /**
   * One resolved Vim command, in whichever context the store is in. Operators,
   * text objects and searches are not store input: they flash and do nothing.
   */
  shopCommand(cmd: Command): void {
    const s = this.state;
    if (s.phase !== 'shop') return;
    if (cmd.operator || cmd.textObject || cmd.search || !cmd.motion) { this.flash(); return; }
    if (s.sim.shop.mode === 'place') this.movePlacement(cmd);
    else this.moveShopCursor(cmd);
  }

  /** The list cursor. Vertical motions only; it clamps and never wraps. */
  private moveShopCursor(cmd: Command): void {
    const shop = this.state.sim.shop;
    const n = SHOP_ROWS;
    const count = Math.max(1, cmd.count || 1);
    let row = shop.cursor;
    switch (cmd.motion!.kind) {
      case 'j': row += count; break;
      case 'k': row -= count; break;
      case 'gg': row = cmd.count > 0 ? cmd.count - 1 : 0; break;
      case 'G': row = cmd.count > 0 ? cmd.count - 1 : n - 1; break;
      case 'H': row = 0; break;
      case 'M': row = (n - 1) >> 1; break;
      case 'L': row = n - 1; break;
      // Horizontal motions have no meaning over a list. `l` never reaches
      // here - the harness intercepts it as `buy` - so this is a no-op, not a
      // beep: nothing was typed wrong.
      default: return;
    }
    shop.cursor = Math.max(0, Math.min(n - 1, row));
  }

  /** The placement crosshair, resolved against the survey grid. */
  private movePlacement(cmd: Command): void {
    const shop = this.state.sim.shop;
    const buf = surveyBuffer();
    const r = resolve(cmd, buf, shop.place);
    shop.place = clampCursor(buf.rows, r.newCursor);
    // Barbed wire only ever goes at the wall, so the column is not yours.
    if (shop.item === 'wire') shop.place.col = FIELD_COLS - 1;
  }

  /** `<CR>`: buy the selected row, or anchor / plant what is being placed. */
  shopEnter(): void {
    const s = this.state;
    if (s.phase !== 'shop') return;
    if (s.sim.shop.mode === 'place') { this.plant(); return; }
    this.shopBuy();
  }

  /** `<Esc>`: back out of placement. In the list it does nothing, as in Vim. */
  shopCancel(): void {
    const s = this.state;
    const sm = s.sim;
    if (s.phase !== 'shop') return;
    if (sm.shop.mode !== 'place') return;
    // A mission has no store behind placement, so backing out of it would
    // land on a card that does not belong to the mission. It clears the
    // half-made span instead, which is what `<Esc>` means everywhere else.
    if (sm.mission >= 0 || sm.drill !== '') { sm.shop.anchor = null; return; }
    this.endPlacement();
  }

  /** `l` on the selected row: an instant item, a trap's placement, or out. */
  shopBuy(): void {
    const s = this.state;
    const shop = s.sim.shop;
    if (s.phase !== 'shop' || shop.mode !== 'list') return;
    const item = ITEMS[shop.cursor];
    if (!item) { this.shopResume(); return; }        // the NEXT NIGHT row
    if (item.kind === 'trap') { this.beginPlacement(item.id); return; }
    this.buy(item.id);
  }

  /** `n`, or `<CR>` on NEXT NIGHT. The store does not reopen for this night. */
  shopResume(): void {
    const s = this.state;
    if (s.phase !== 'shop') return;
    s.phase = 'playing';
    s.sim.shop.mode = 'list';
    s.sim.shop.item = '';
    s.sim.shop.anchor = null;
    this.startWave(s.wave + 1);
    this.refresh();
  }

  /**
   * One instant purchase. It succeeds only when the wallet covers the price
   * and the owned count is under the cap; a refusal changes nothing and emits
   * nothing but the flash.
   */
  buy(id: ItemId): void {
    const s = this.state;
    const sm = s.sim;
    if (s.phase !== 'shop') return;
    const item = itemById(id);
    if (!item || item.kind === 'trap' || !canBuy(s, id)) { this.flash(); return; }

    s.supplies -= item.price;
    this.applyItem(id);
    sm.purchases[id]++;
    this.bus.emit({ t: 'buy', item: id, cost: item.price });
  }

  /** What each instant item does. Traps do their work in `plant`. */
  private applyItem(id: ItemId): void {
    const s = this.state;
    const sm = s.sim;
    switch (id) {
      case 'dd': s.charges.dd++; break;
      case 'D': s.charges.D++; break;
      // Bandolier raises what you can carry; it does not hand you a round.
      case 'bandolier': sm.chargeCap.dd++; sm.chargeCap.D++; break;
      case 'whetstone': sm.wasteBonus = WHETSTONE_CELLS; break;
      case 'repeater': sm.freeRepeat++; break;
      case 'planks':
        s.barricade.hp = Math.min(s.barricade.maxHp, s.barricade.hp + PLANKS_HP);
        break;
      case 'sandbags':
        s.barricade.maxHp += SANDBAGS_HP;
        s.barricade.hp += SANDBAGS_HP;
        break;
      case 'flare': sm.flare = true; break;
      case 'spotter': sm.spotter = SPOTTER_KILLS; break;
      case 'manifest': sm.manifest = true; break;
      case 'secondwind': sm.secondWind = true; break;
      default: break;
    }
  }

  /** A trap is not bought at `l`; it is bought where you put it. */
  private beginPlacement(id: ItemId): void {
    const s = this.state;
    const shop = s.sim.shop;
    if (!canBuy(s, id)) { this.flash(); return; }
    shop.mode = 'place';
    shop.item = id;
    shop.anchor = null;
    shop.place = { row: s.cursor.row, col: s.cursor.col };
    if (id === 'wire') shop.place.col = FIELD_COLS - 1;
  }

  private endPlacement(): void {
    const shop = this.state.sim.shop;
    shop.mode = 'list';
    shop.item = '';
    shop.anchor = null;
  }

  /**
   * `<CR>` in placement. A tripwire and a lane of wire plant on the first
   * press; a fence and a minefield anchor on the first and span on the second,
   * so a big one costs a counted motion. A span the wallet cannot cover is
   * refused with the anchor kept - nothing was charged to set it.
   */
  private plant(): void {
    const s = this.state;
    const sm = s.sim;
    const shop = sm.shop;
    const item = itemById(shop.item);
    if (!item) { this.endPlacement(); return; }
    const place = shop.place;

    if (item.id === 'tripwire') {
      if (!this.debit(item.price, item.id)) return;
      sm.traps.push({
        id: sm.nextTrapId++, kind: 'tripwire',
        row0: place.row, row1: place.row, col0: place.col, col1: place.col,
        charges: 1,
      });
      if (sm.mission >= 0) { this.missionPlanted(); this.refresh(); return; }
      if (sm.drill !== '') { this.drillPlanted(); this.refresh(); return; }
      this.endPlacement();
      return;
    }

    if (item.id === 'wire') {
      const bit = 1 << place.row;
      if ((sm.wireLanes & bit) !== 0) { this.flash(); return; }   // already wired
      if (!this.debit(item.price, item.id)) return;
      sm.wireLanes |= bit;
      this.endPlacement();
      return;
    }

    if (!shop.anchor) { shop.anchor = { row: place.row, col: place.col }; return; }
    const a = shop.anchor;

    if (item.id === 'fence') {
      const row0 = Math.min(a.row, place.row);
      const row1 = Math.max(a.row, place.row);
      const lanes = fenceLanes(row0, row1);
      if (!this.debit(item.price * lanes, item.id)) return;
      // The column is the anchor's: moving east between the two presses aims
      // the second lane, it does not drag the fence.
      sm.traps.push({
        id: sm.nextTrapId++, kind: 'fence',
        row0, row1, col0: a.col, col1: a.col, charges: lanes,
      });
      if (sm.mission >= 0) { this.missionPlanted(); this.refresh(); return; }
      if (sm.drill !== '') { this.drillPlanted(); this.refresh(); return; }
    } else {
      const col0 = Math.min(a.col, place.col);
      const col1 = Math.max(a.col, place.col);
      const blocks = mineBlocks(col0, col1);
      if (!this.debit(item.price * blocks, item.id)) return;
      sm.traps.push({
        id: sm.nextTrapId++, kind: 'minefield',
        row0: a.row, row1: a.row, col0, col1, charges: blocks,
      });
      if (sm.mission >= 0) { this.missionPlanted(); this.refresh(); return; }
      if (sm.drill !== '') { this.drillPlanted(); this.refresh(); return; }
    }
    this.endPlacement();
  }

  /** Charge the wallet, or flash and leave everything alone. */
  private debit(cost: number, id: ItemId): boolean {
    const s = this.state;
    if (s.supplies < cost) { this.flash(); return false; }
    s.supplies -= cost;
    s.sim.purchases[id]++;
    this.bus.emit({ t: 'buy', item: id, cost });
    return true;
  }
}
