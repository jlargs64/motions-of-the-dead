// Phase Z — determinism check. Feed a runs/*.jsonl log into a fresh Game and
// assert the final GameState is byte-identical.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_VERSION, dispatch, newRepl } from '../src/harness/repl';
import type { GameEvent } from '../src/core/types';

interface InitLine { t: 'init'; seed: number; fixedDt: number; version?: number }
interface InLine { t: 'in'; line: string; events: GameEvent[] }
interface FinalLine { t: 'final'; state: unknown }
type LogLine = InitLine | InLine | FinalLine;

/** A log's `init.version`, or 1 for anything recorded before it was written. */
function logVersion(path: string): number {
  const first = readFileSync(path, 'utf8').split('\n', 1)[0];
  try {
    const l = JSON.parse(first) as Partial<InitLine>;
    return l.t === 'init' ? (l.version ?? 1) : 1;
  } catch { return 1; }
}

/**
 * The newest log this build can still be held to. A log recorded before a rule
 * change replays as a game but not byte for byte, and failing on it would be
 * blaming the log for the change (DECISIONS #82).
 */
function newestLog(): { path: string; skipped: string[] } | null {
  const dir = join(process.cwd(), 'runs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
  if (files.length === 0) throw new Error('no runs/*.jsonl to replay — play one with `npm run play`');
  const skipped: string[] = [];
  for (let i = files.length - 1; i >= 0; i--) {
    const path = join(dir, files[i]);
    if (logVersion(path) >= LOG_VERSION) return { path, skipped };
    skipped.push(files[i]);
  }
  return null;
}

function main(): number {
  let path = process.argv[2];
  if (!path) {
    const pick = newestLog();
    if (!pick) {
      process.stdout.write(
        `no runs/*.jsonl at log version ${LOG_VERSION} or above.\n` +
        'Every log on disk predates a rule change - the survival store, or the\n' +
        'overrun rule that ends a night nobody fought - so none of them is\n' +
        'byte-comparable against this build. Record a new baseline with\n' +
        '`npm run play`.\n');
      return 0;
    }
    path = pick.path;
    for (const f of pick.skipped) {
      process.stdout.write(`skipped ${f}: recorded before log version ${LOG_VERSION} (an older rule set)\n`);
    }
  }
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
