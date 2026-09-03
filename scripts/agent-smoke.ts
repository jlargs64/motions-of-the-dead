// Phase F — a rule-based bot (no LLM). It reads the same state an agent reads
// and plays with the same optimality heuristic the ledger uses. If this bot
// can't reach wave 6 on seed 1, no agent can, and neither can a human.
import { Game } from '../src/harness/api';
import { optimalKill } from '../src/sim/optimal';
import { shopRoutine } from '../src/harness/shopbot';
import type { Zombie } from '../src/core/types';

/** Override with the 4th arg. 55ms is a machine; 120ms is a quick human. */
const MS_PER_KEYSTROKE = Number(process.argv[4] ?? 55);
const TARGET_WAVE = Number(process.argv[3] ?? 6);
const SEED = Number(process.argv[2] ?? 1);

/** What the bot spent the wallet on, for the tuning pass. */
function bought(st: ReturnType<Game['json']>): string {
  const p = st.sim.purchases;
  const parts = Object.keys(p)
    .filter((k) => p[k as keyof typeof p] > 0)
    .map((k) => `${k}x${p[k as keyof typeof p]}`);
  return parts.length ? parts.join(',') : 'nothing';
}

/** Whoever is nearest the wall. Ties break toward the lower lane. */
function pickTarget(zs: readonly Zombie[]): Zombie | null {
  let best: Zombie | null = null;
  for (const z of zs) {
    if (!best) { best = z; continue; }
    const a = z.col + z.text.length;
    const b = best.col + best.text.length;
    if (a > b || (a === b && z.row > best.row)) best = z;
  }
  return best;
}

function main(): number {
  const g = new Game(SEED);
  let guard = 0;
  let commands = 0;
  let whiffs = 0;

  while (!g.isOver() && g.json().wave < TARGET_WAVE && guard++ < 200_000) {
    const st = g.json();
    // Charges do not refill in survival any more (DECISIONS #78), so the bot
    // has to buy ammunition every night or it runs dry by wave 6.
    if (st.phase === 'shop') { shopRoutine(g); continue; }
    if (st.sim.breather > 0) { g.step(200); continue; }
    const zs = st.buffer.zombies;
    if (zs.length === 0) { g.step(100); continue; }

    const target = pickTarget(zs)!;
    const opt = optimalKill(st.buffer, st.cursor, target, st.charges);
    if (!opt) {
      // Nothing in the motion set reaches it this instant; let the world move.
      whiffs++;
      g.step(100);
      continue;
    }
    g.keys(opt.keys);
    commands++;
    g.step(opt.keys.length * MS_PER_KEYSTROKE);
  }

  const st = g.json();
  const reached = st.wave;
  const ok = !g.isOver() && reached >= TARGET_WAVE;
  const kpk = st.sim.kills > 0 ? (st.sim.keystrokes / st.sim.kills).toFixed(2) : 'n/a';
  process.stdout.write(
    `seed ${SEED}: wave ${reached}  score ${st.score}  kills ${st.sim.kills}` +
    // The wallet per wave is what `survival-store` prices against.
    `  supplies ${st.supplies} (${(st.supplies / Math.max(1, reached)).toFixed(0)}/wave)` +
    `  overkills ${st.sim.overkills}  keystrokes/kill ${kpk}` +
    `  barricade ${st.barricade.hp}/${st.barricade.maxHp}` +
    `  commands ${commands}  unreachable ${whiffs}` +
    `  bought ${bought(st)}\n`,
  );
  if (!ok) {
    process.stdout.write(g.text() + '\n');
    process.stderr.write(`FAIL: bot wanted wave ${TARGET_WAVE}, reached ${reached} (dead=${g.isOver()})\n`);
    return 1;
  }
  process.stdout.write(`OK: bot reached wave ${TARGET_WAVE} on seed ${SEED}\n`);
  return 0;
}

process.exit(main());
