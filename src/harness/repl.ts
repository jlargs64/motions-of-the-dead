// Phase F — the command grammar shared by the CLI and the replay checker.
import { Game } from './api';
import { LOG_VERSION } from './logversion';
import { MISSIONS } from '../sim/missions';
import type { GameEvent } from '../core/types';

export { LOG_VERSION };

export interface Repl {
  game: Game;
  seed: number;
  auto: boolean;
  quit: boolean;
}

export const HELP = [
  'MOTIONS OF THE DEAD — terminal harness',
  '',
  '  <keys>      feed keystrokes to the Vim engine, e.g.  d2w   f;x   ci(   3j',
  '              specials: <Esc> <CR> <BS>. `i` restarts after death.',
  '  step [ms]   advance the sim (default 500ms). The world only moves when told.',
  '  state       print the full GameState as JSON',
  '  seed <n>    start a fresh run on seed n',
  '  auto on|off advance in real time between commands (default off)',
  `  t [n]       start mission n (1..${MISSIONS.length}, default 1; boot camp is 1..8)`,
  '  help        this',
  '  quit / :q   exit',
].join('\n');

export function newRepl(seed: number): Repl {
  return { game: new Game(seed), seed, auto: false, quit: false };
}

export interface DispatchResult { out: string; events: GameEvent[]; print: boolean }

export function dispatch(r: Repl, raw: string): DispatchResult {
  const line = raw.trim();
  if (line === '') return { out: '', events: [], print: false };

  if (line === 'quit' || line === ':q' || line === ':q!' || line === 'exit') {
    r.quit = true;
    return { out: 'ok', events: [], print: false };
  }
  if (line === 'help' || line === '?') return { out: HELP, events: [], print: false };
  if (line === 'state') return { out: JSON.stringify(r.game.json(), null, 2), events: [], print: false };

  const m = /^step(?:\s+(\d+))?$/.exec(line);
  if (m) {
    const ms = m[1] ? Number(m[1]) : 500;
    return { out: '', events: r.game.step(ms), print: true };
  }

  const s = /^seed\s+(\d+)$/.exec(line);
  if (s) {
    r.seed = Number(s[1]);
    r.game = new Game(r.seed);
    return { out: `new run, seed ${r.seed}`, events: [], print: true };
  }

  // `t` is Vim's till-motion once a run is live, so missions need their own
  // command here rather than a keystroke (DECISIONS #61).
  const mi = /^(?:t|tutorial|mission)(?:\s+(\d+))?$/.exec(line);
  if (mi) {
    const n = mi[1] ? Number(mi[1]) : 1;
    r.game.engine.reset();
    r.game.menu.reset();
    r.game.sim.startMission(n - 1);
    return { out: `mission ${n}`, events: r.game.bus.drain(), print: true };
  }

  const a = /^auto\s+(on|off)$/.exec(line);
  if (a) {
    r.auto = a[1] === 'on';
    return { out: `auto ${a[1]}`, events: [], print: false };
  }

  return { out: '', events: r.game.keys(line), print: true };
}

/** Compact one-line event summaries, for the CLI. */
export function summarize(events: GameEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.t) {
      case 'kill': out.push(`  kill #${e.zombieId} ${e.kind} via ${e.via}${e.overkill ? '  *** OVERKILL ***' : ''}`); break;
      case 'combo_break': out.push(`  combo broken: ${e.reason}`); break;
      case 'barricade_hit': out.push(`  BARRICADE HIT -${e.dmg} (${e.hpLeft} left)`); break;
      case 'wave_start': out.push(`  == WAVE ${e.n} == demands: ${e.unlocks.join(' ') || '(no new motions)'}`); break;
      case 'wave_clear': out.push(`  wave ${e.n} cleared in ${(e.ms / 1000).toFixed(1)}s`); break;
      case 'charge_used': out.push(`  ${e.kind} charge spent`); break;
      case 'death': out.push(`  YOU DIED — wave ${e.wave}, score ${e.score}`); break;
      default: break;
    }
  }
  return out;
}
