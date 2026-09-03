// Phase 0 — the game, narrated into the log.
//
// Everything here is driven off the event bus and a read-only look at
// `GameState`, so the sim needs no logging calls of its own and cannot be
// changed by one. What gets logged is chosen around one question: a run has
// just ended and the player did not see why. The answer is the last few
// `barricade_hit` lines and whatever the player was doing between them, so
// those are `info` and the play-by-play is `debug`.
import type { Bus } from './bus';
import type { GameState } from './state';
import { log } from './log';

/** How close to gone the wall has to be before every hit is worth an info. */
const WALL_WARN = 0.35;

/**
 * Subscribe the logger to a bus. Returns an unsubscribe. `state` is a getter
 * rather than a value because the sim mutates one object in place.
 */
export function watch(bus: Bus, state: () => GameState): () => void {
  const off: Array<() => void> = [];
  /** Commands since the last kill, so a death can say what was being tried. */
  let sinceKill: string[] = [];

  off.push(bus.on('wave_start', (e) => {
    const s = state();
    log.info('run', `night ${e.n} begins`, {
      size: s.sim.waveSize,
      charges: `dd${s.charges.dd}/D${s.charges.D}`,
      cap: `dd${s.sim.chargeCap.dd}/D${s.sim.chargeCap.D}`,
      wall: `${Math.ceil(s.barricade.hp)}/${s.barricade.maxHp}`,
      supplies: s.supplies,
      traps: s.sim.traps.length,
      demands: e.unlocks.join('') || '-',
    });
  }));

  off.push(bus.on('wave_clear', (e) => {
    log.info('run', `night ${e.n} cleared`, {
      ms: Math.round(e.ms),
      supplies: state().supplies,
    });
  }));

  // The one line that answers "why did it end". Every breach is logged, with
  // what the player had to work with at the time - a wall going down with two
  // charges banked is a different bug from one going down with none.
  off.push(bus.on('barricade_hit', (e) => {
    const s = state();
    const frac = s.barricade.maxHp > 0 ? e.hpLeft / s.barricade.maxHp : 0;
    const line = frac <= WALL_WARN ? log.warn : log.info;
    line.call(log, 'run', `wall hit for ${e.dmg}, ${e.hpLeft} left`, {
      night: s.wave,
      alive: s.buffer.zombies.length,
      queued: s.sim.spawnQueue.length,
      charges: `dd${s.charges.dd}/D${s.charges.D}`,
      supplies: s.supplies,
      tried: sinceKill.slice(-6).join(' ') || '(nothing since the last kill)',
    });
  }));

  off.push(bus.on('death', (e) => {
    const s = state();
    log.error('run', `run over on night ${e.wave}`, {
      score: e.score,
      kills: s.sim.kills,
      keystrokes: s.sim.keystrokes,
      charges: `dd${s.charges.dd}/D${s.charges.D}`,
      supplies: s.supplies,
      alive: s.buffer.zombies.length,
      tried: sinceKill.slice(-8).join(' ') || '(nothing since the last kill)',
    });
  }));

  off.push(bus.on('revive', () => {
    log.info('run', 'second wind: the wall came back', { night: state().wave });
  }));

  off.push(bus.on('buy', (e) => {
    log.info('store', `bought ${e.item}`, { cost: e.cost, left: state().supplies });
  }));

  // ---- the play-by-play, only when asked for -----------------------------

  off.push(bus.on('command', (e) => {
    sinceKill.push(e.cmd.raw);
    if (sinceKill.length > 24) sinceKill.shift();
    log.debug('input', e.cmd.raw, { ms: e.ms });
  }));

  off.push(bus.on('kill', (e) => {
    sinceKill = [];
    log.debug('sim', `killed ${e.kind} via ${e.via}`, e.overkill ? { overkill: true } : undefined);
  }));

  off.push(bus.on('charge_used', (e) => {
    const s = state();
    // Running dry is the thing the ammo economy made possible, so the last
    // charge of a kind is worth saying out loud rather than at debug.
    const left = s.charges[e.kind];
    if (left === 0) log.info('sim', `last ${e.kind} charge spent`, { night: s.wave });
    else log.debug('sim', `${e.kind} charge spent`, { left });
  }));

  off.push(bus.on('combo_break', (e) => {
    // A refused command is the most likely way for a player to lose a night
    // without noticing they did: nothing moves, nothing is drawn. The sim
    // marks these rather than the log guessing from the reason text.
    if (e.refused) {
      log.warn('sim', `command did nothing: ${e.reason}`, {
        night: state().wave,
        charges: `dd${state().charges.dd}/D${state().charges.D}`,
      });
      return;
    }
    log.debug('sim', `combo broken: ${e.reason}`);
  }));

  off.push(bus.on('trap_fire', (e) => {
    log.debug('sim', `trap ${e.trapId} fired`, { row: e.row, col: e.col });
  }));

  off.push(bus.on('medal', (e) => {
    log.debug('sim', `medal ${e.name}`, { bonus: e.bonus });
  }));

  return () => { for (const fn of off) fn(); };
}
