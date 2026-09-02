// Phase F — `npm run play`. Stdin/stdout REPL, no browser anywhere.
import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { HELP, dispatch, newRepl, summarize } from './repl';

const argSeed = Number(process.argv[2]);
const seed = Number.isFinite(argSeed) && argSeed > 0 ? argSeed : 1;

const runsDir = join(process.cwd(), 'runs');
mkdirSync(runsDir, { recursive: true });
const logPath = join(runsDir, `${seed}-${Date.now()}.jsonl`);

const repl = newRepl(seed);
let lastWall = Date.now();

function log(obj: unknown): void {
  appendFileSync(logPath, JSON.stringify(obj) + '\n');
}

log({ t: 'init', seed, fixedDt: 1 / 60 });

process.stdout.write(HELP + '\n\n');
process.stdout.write(repl.game.text() + '\n');
process.stdout.write(`\n[log ${logPath}]\n> `);

const rl = createInterface({ input: process.stdin, terminal: false });

function feed(line: string): void {
  const r = dispatch(repl, line);
  log({ t: 'in', line, events: r.events });
  if (r.out) process.stdout.write(r.out + '\n');
  const notes = summarize(r.events);
  if (notes.length) process.stdout.write(notes.join('\n') + '\n');
  if (r.print) process.stdout.write(repl.game.text() + '\n');
}

rl.on('line', (line) => {
  try {
    if (repl.auto) {
      const now = Date.now();
      const dt = Math.min(5000, now - lastWall);
      lastWall = now;
      if (dt > 0) feed(`step ${dt}`);
    }
    feed(line);
    if (repl.quit) { finish(0); return; }
  } catch (err) {
    process.stderr.write(`sim threw: ${(err as Error).stack ?? String(err)}\n`);
    finish(1);
    return;
  }
  process.stdout.write('> ');
});

rl.on('close', () => finish(0));

function finish(code: number): void {
  try { log({ t: 'final', state: repl.game.json() }); } catch { /* ignore */ }
  process.stdout.write(`\n[log written to ${logPath}]\n`);
  process.exit(code);
}
