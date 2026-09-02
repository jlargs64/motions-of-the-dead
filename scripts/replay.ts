// Phase Z — determinism check. Feed a runs/*.jsonl log into a fresh Game and
// assert the final GameState is byte-identical.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { dispatch, newRepl } from '../src/harness/repl';
import type { GameEvent } from '../src/core/types';

interface InitLine { t: 'init'; seed: number; fixedDt: number }
interface InLine { t: 'in'; line: string; events: GameEvent[] }
interface FinalLine { t: 'final'; state: unknown }
type LogLine = InitLine | InLine | FinalLine;

function newestLog(): string {
  const dir = join(process.cwd(), 'runs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) throw new Error('no runs/*.jsonl to replay — play one with `npm run play`');
  return join(dir, files[files.length - 1]);
}

function main(): number {
  const path = process.argv[2] ?? newestLog();
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogLine);

  const init = lines.find((l): l is InitLine => l.t === 'init');
  if (!init) { process.stderr.write(`${path}: no init line\n`); return 1; }

  const repl = newRepl(init.seed);
  let inputs = 0;
  let eventMismatch = 0;

  for (const l of lines) {
    if (l.t !== 'in') continue;
    inputs++;
    const r = dispatch(repl, l.line);
    if (JSON.stringify(r.events) !== JSON.stringify(l.events)) {
      eventMismatch++;
      if (eventMismatch === 1) {
        process.stderr.write(`event divergence at input #${inputs} (${JSON.stringify(l.line)})\n`);
        process.stderr.write(`  logged: ${JSON.stringify(l.events)}\n`);
        process.stderr.write(`  replay: ${JSON.stringify(r.events)}\n`);
      }
    }
  }

  const got = JSON.stringify(repl.game.json());
  const finalLine = lines.find((l): l is FinalLine => l.t === 'final');

  let stateOk: boolean;
  if (finalLine) {
    stateOk = JSON.stringify(finalLine.state) === got;
  } else {
    // No final state recorded: prove determinism by replaying a second time.
    const again = newRepl(init.seed);
    for (const l of lines) if (l.t === 'in') dispatch(again, l.line);
    stateOk = JSON.stringify(again.game.json()) === got;
    process.stdout.write('(log has no final state; compared two replays instead)\n');
  }

  process.stdout.write(`${path}: ${inputs} inputs, events ${eventMismatch === 0 ? 'identical' : `DIVERGED x${eventMismatch}`}, final state ${stateOk ? 'identical' : 'DIVERGED'}\n`);
  if (!stateOk || eventMismatch > 0) return 1;
  process.stdout.write('OK: replay is deterministic\n');
  return 0;
}

process.exit(main());
