// Phase B/E — "what was the cheapest way to kill that?"
// Brute force over a narrowed candidate set, then verify each candidate by
// running it through the real engine + resolve. The motion set is small, so
// this stays cheap enough to run once per kill and once per bot turn.
import type { Buffer, Command, Cursor, Zombie } from '../core/types';
import { VimEngine } from '../vim/engine';
import { motionTarget, resolve } from '../vim/resolve';
import type { Span } from '../vim/resolve';
import { chargeKindFor, outcomeFor, planKills, splashRowMask } from './rules';

export interface Optimal { keys: string; cost: number }

/** Split a keystroke string into engine tokens, honouring <Esc>/<CR>. */
export function splitKeys(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '<') {
      const j = s.indexOf('>', i);
      if (j > i) { out.push(s.slice(i, j + 1)); i = j; continue; }
    }
    out.push(s[i]);
  }
  return out;
}

export interface SimRun { cursor: Cursor; cmd: Command; spans: Span[] }

/** Run a keystroke string against a static buffer. Null if anything misfires. */
export function dryRun(buffer: Buffer, cursor: Cursor, keys: string): SimRun | null {
  const eng = new VimEngine();
  let bad = false;
  eng.onError = () => { bad = true; };
  let cur: Cursor = { row: cursor.row, col: cursor.col };
  let cmd: Command | null = null;
  let spans: Span[] = [];
  for (const k of splitKeys(keys)) {
    const c = eng.feed(k);
    if (bad) return null;
    if (!c) continue;
    const r = resolve(c, buffer, cur);
    if (!r.ok) return null;
    cur = r.newCursor;
    cmd = c;
    spans = r.affected;
  }
  if (eng.pending() !== '') return null;
  return cmd ? { cursor: cur, cmd, spans } : null;
}

const OPS_BY_KIND: Record<string, string[]> = {
  crawler: ['x'],
  armored: [
    'di(', 'da(', 'di[', 'da[', 'di{', 'da{', 'di"', 'da"', "di'", "da'",
    'ci(', 'ca(', 'diw', 'daw', 'ciw', 'caw',
  ],
  bloater: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw'],
  walker: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw', 'x'],
  runner: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw', 'x'],
};

const CHARGE_OPS = new Set(['dd', 'D']);

/** Keystrokes a charge is notionally worth when ranking candidates. */
export const CHARGE_PENALTY = 3;

function num(n: number): string { return n > 1 ? String(n) : ''; }

/** Cheapest keystrokes to move the cursor to each reachable column on its row. */
function columnMap(buffer: Buffer, at: Cursor): Map<number, string> {
  const best = new Map<number, string>();
  const put = (col: number, keys: string) => {
    const prev = best.get(col);
    if (prev === undefined || keys.length < prev.length || (keys.length === prev.length && keys < prev)) {
      best.set(col, keys);
    }
  };
  put(at.col, '');

  const cands: string[] = ['0', '^', '$'];
  for (let n = 1; n <= 30; n++) { cands.push(num(n) + 'l'); cands.push(num(n) + 'h'); }
  for (let n = 1; n <= 8; n++) {
    for (const m of ['w', 'b', 'e', 'W', 'B', 'E']) cands.push(num(n) + m);
  }
  const line = buffer.rows[at.row] ?? '';
  const seen = new Set<string>();
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === ' ' || seen.has(c)) continue;
    seen.add(c);
    for (let n = 1; n <= 3; n++) {
      for (const m of ['f', 't', 'F', 'T']) cands.push(num(n) + m + c);
    }
  }

  for (const keys of cands) {
    const toks = splitKeys(keys);
    let count = 0;
    let i = 0;
    // A leading `0` is the motion, not a count.
    while (i < toks.length && toks[i] >= '0' && toks[i] <= '9' && !(i === 0 && toks[i] === '0')) {
      count = count * 10 + Number(toks[i]); i++;
    }
    const kind = toks[i] as Parameters<typeof motionTarget>[2];
    const ch = toks[i + 1];
    const m = motionTarget(buffer.rows, at, kind, count || 1, ch);
    if (!m || !m.ok || m.pos.row !== at.row) continue;
    put(m.pos.col, keys);
  }
  return best;
}

/** Cheapest keystrokes to reach `row` from the cursor, and where they land. */
function rowCandidates(buffer: Buffer, cursor: Cursor, row: number): Array<{ keys: string; at: Cursor }> {
  const out: Array<{ keys: string; at: Cursor }> = [];
  const seen = new Set<string>();
  const tryKeys = (keys: string) => {
    if (seen.has(keys)) return;
    seen.add(keys);
    if (keys === '') {
      if (cursor.row === row) out.push({ keys: '', at: cursor });
      return;
    }
    const r = dryRun(buffer, cursor, keys);
    if (!r || r.cursor.row !== row) return;
    out.push({ keys, at: r.cursor });
  };
  tryKeys('');
  const d = row - cursor.row;
  if (d > 0) tryKeys(num(d) + 'j');
  if (d < 0) tryKeys(num(-d) + 'k');
  tryKeys(String(row + 1) + 'G');
  if (row === 0) { tryKeys('gg'); tryKeys('H'); }
  tryKeys('M');
  for (const p of ['}', '{', '2}', '2{', '3}', '3{']) tryKeys(p);
  return out;
}

/**
 * The minimum-keystroke command that kills `target` from `cursor`.
 * Returns null if nothing in the motion set gets there cleanly.
 */
export function optimalKill(
  buffer: Buffer, cursor: Cursor, target: Zombie, charges: { dd: number; D: number },
): Optimal | null {
  const ops = (OPS_BY_KIND[target.kind] ?? OPS_BY_KIND.walker)
    .filter((o) => !CHARGE_OPS.has(o) || charges[o as 'dd' | 'D'] > 0);
  if (ops.length === 0) return null;

  const len = target.text.length;
  const cols = new Set<number>([target.col, target.col + 1, target.col + len - 1, 0]);
  if (len > 2) cols.add(target.col + (len >> 1));
  if (cursor.row === target.row) cols.add(cursor.col);

  const cands: string[] = [];
  const seen = new Set<string>();
  for (const rc of rowCandidates(buffer, cursor, target.row)) {
    const colMap = columnMap(buffer, rc.at);
    for (const col of cols) {
      const cm = colMap.get(col);
      if (cm === undefined) continue;
      for (const op of ops) {
        const keys = rc.keys + cm + op;
        if (seen.has(keys)) continue;
        seen.add(keys);
        cands.push(keys);
      }
    }
  }
  cands.sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));

  // Charges are scarce and reset only on a wave clear, so a command that spends
  // one is worth CHARGE_PENALTY extra keystrokes when we rank it. Without this
  // the "optimal" answer is always `D`, and the ledger teaches nothing.
  let best: Optimal | null = null;
  let bestEffective = Infinity;
  for (const keys of cands) {
    if (keys.length > bestEffective) break;      // sorted by length: nothing cheaper is left
    const r = dryRun(buffer, cursor, keys);
    if (!r) continue;
    const plan = planKills(r.cmd, r.spans, buffer.zombies);
    const ck = chargeKindFor(r.cmd, r.spans, plan);
    if (ck && charges[ck] <= 0) continue;
    if (plan.overkill) continue;          // never recommend a combo-breaker, even as collateral
    const mask = splashRowMask(r.cmd, r.spans, buffer.zombies);
    if (outcomeFor(r.cmd, r.spans, target, mask) !== 'kill') continue;
    // A command that clears several at once earns its charge back.
    const effective = keys.length + (ck ? Math.max(0, CHARGE_PENALTY - (plan.victims.length - 1) * 2) : 0);
    if (effective < bestEffective) { bestEffective = effective; best = { keys, cost: keys.length }; }
  }
  return best;
}

/** The distinct motion/operator tokens a keystroke string exercises. */
export function tokensUsed(keys: string): string[] {
  const eng = new VimEngine();
  const out: string[] = [];
  for (const k of splitKeys(keys)) {
    const c = eng.feed(k);
    if (!c) continue;
    if (c.search) { out.push('/'); continue; }
    if (c.repeat) { out.push('.'); }
    if (c.operator) out.push(c.operator);
    if (c.textObject) out.push(c.textObject);
    if (c.motion) out.push(c.motion.kind);
  }
  return out;
}
