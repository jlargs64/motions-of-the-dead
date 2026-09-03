// Phase B/E — "what was the cheapest way to kill that?"
// Brute force over a narrowed candidate set, then verify each candidate by
// running it through the real engine + resolve. The motion set is small, so
// this stays cheap enough to run once per kill and once per bot turn.
import type { Buffer, Command, Cursor, Zombie } from '../core/types';
import { ROWS, deriveRows } from '../core/field';
import { CHARGES_D, CHARGES_DD } from '../core/state';
import { VimEngine } from '../vim/engine';
import { clampCursor, motionTarget, resolve } from '../vim/resolve';
import type { Span } from '../vim/resolve';
import { chargeKindFor, outcomeFor, planKills, splashRowMask } from './rules';
import { MISSIONS, missionIndex } from './missions';
import type { Mission, MissionSpawn } from './missions';

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

/**
 * Counted operators, additive (drills-and-coach): `d3e` takes three words
 * for three keys where `2wcw` is four, `d2j` two lanes, `3x` three crawlers.
 * Ranked half a key dearer than an uncounted answer of the same length, so
 * `2x` never displaces `lx`; they win only where the count genuinely saves.
 */
const COUNTED_WORD_OPS = ['d2w', 'd3w', 'd2e', 'd3e'];
const COUNTED_RE = /(?:^|\D)(?:d[23][wejk]|[23]x)$/;

/**
 * A linewise cut issued from where the cursor stands, when the target's lane
 * is one to three below or above: `dj`, `d2j`, `d3k`. These cannot be built
 * as row-jump-then-operator like every other candidate, because the jump *is*
 * the operator's motion. The waste rule prices them like any other sweep.
 */
function lanewiseCandidates(cursor: Cursor, target: Zombie): string[] {
  const d = target.row - cursor.row;
  if (d === 0 || Math.abs(d) > 3) return [];
  return [`d${num(Math.abs(d))}${d > 0 ? 'j' : 'k'}`];
}

const OPS_BY_KIND: Record<string, string[]> = {
  crawler: ['x', '2x', '3x'],
  armored: [
    'di(', 'da(', 'di[', 'da[', 'di{', 'da{', 'di"', 'da"', "di'", "da'",
    'ci(', 'ca(', 'diw', 'daw', 'ciw', 'caw',
  ],
  bloater: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw', ...COUNTED_WORD_OPS],
  walker: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw', 'x', ...COUNTED_WORD_OPS],
  runner: ['dw', 'dW', 'de', 'dE', 'daw', 'diw', 'd$', 'D', 'dd', 'cw', 'x', ...COUNTED_WORD_OPS],
};

const CHARGE_OPS = new Set(['dd', 'D']);

/** Keystrokes a charge is notionally worth when ranking candidates. */
export const CHARGE_PENALTY = 3;

function num(n: number): string { return n > 1 ? String(n) : ''; }

/**
 * Cheapest keystrokes to move the cursor to each reachable column on its row.
 * Every column keeps *all* the shortest ways there, lexicographically ordered,
 * so `optimalKills` can report a tie: `2wdw` and `fgdw` are both three keys
 * to the same word. The first entry is what `optimalKill` alone returns.
 */
function columnMap(buffer: Buffer, at: Cursor): Map<number, string[]> {
  const best = new Map<number, string[]>();
  const put = (col: number, keys: string) => {
    const prev = best.get(col);
    if (prev === undefined || keys.length < prev[0].length) { best.set(col, [keys]); return; }
    if (keys.length === prev[0].length && !prev.includes(keys)) { prev.push(keys); prev.sort(); }
  };
  put(at.col, '');

  const cands: string[] = ['0', '^', '_', '$'];
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
function rowCandidates(
  buffer: Buffer, cursor: Cursor, row: number, extra: readonly string[] = [],
): Array<{ keys: string; at: Cursor }> {
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
  // `}` lands on the blank lane past a block, never on a zombie, so on its own
  // it is never part of a kill. One `j` after it is the lane the next block
  // starts on; one `k` after `{` is the last lane of the block before.
  for (const p of ['}j', '{k', '2}j', '2{k', '3}j', '3{k']) tryKeys(p);
  for (const k of extra) tryKeys(k);
  return out;
}

/**
 * A search costs half a keystroke more than a motion of the same length when
 * candidates are ranked, so `*dw` never displaces a `wdw` verdict it used to
 * tie with. The search candidates are additive (drills-and-coach D4): they
 * win only where they are genuinely shorter, as they are for a far sibling.
 */
export const SEARCH_TIEBREAK = 0.5;

function isSearchKeys(keys: string): boolean {
  const c = keys[0];
  return c === '/' || c === '?' || c === '*' || c === '#';
}

/** A search or a counted operator: worth SEARCH_TIEBREAK extra when ranked. */
function dearer(keys: string): boolean {
  return isSearchKeys(keys) || COUNTED_RE.test(keys);
}

/** `*`, `#`, `/text<CR>`, and `n` chained on each, for this target's text. */
function searchCandidates(target: Zombie): string[] {
  const q = `/${target.text}<CR>`;
  return ['*', '#', '*n', '#n', q, `${q}n`];
}

/**
 * The minimum-keystroke command that kills `target` from `cursor`.
 * Returns null if nothing in the motion set gets there cleanly.
 */
export function optimalKill(
  buffer: Buffer, cursor: Cursor, target: Zombie, charges: { dd: number; D: number },
): Optimal | null {
  return optimalKills(buffer, cursor, target, charges)[0] ?? null;
}

/**
 * Every command tied for cheapest, in rank order: `optimalKill` is the first.
 * A drill verifies a scene against the whole set, because ties are decided
 * lexicographically and a digit sorts before a letter - `2wdw` outranks `fgdw`
 * at three keys each, and a find drill would otherwise never verify a scene
 * that a find genuinely solves as cheaply as anything (drills-and-coach D3).
 */
export function optimalKills(
  buffer: Buffer, cursor: Cursor, target: Zombie, charges: { dd: number; D: number },
): Optimal[] {
  const ops = (OPS_BY_KIND[target.kind] ?? OPS_BY_KIND.walker)
    .filter((o) => !CHARGE_OPS.has(o) || charges[o as 'dd' | 'D'] > 0);
  if (ops.length === 0) return [];

  const len = target.text.length;
  const cols = new Set<number>([target.col, target.col + 1, target.col + len - 1, 0]);
  if (len > 2) cols.add(target.col + (len >> 1));
  if (cursor.row === target.row) cols.add(cursor.col);

  const cands: string[] = [];
  const seen = new Set<string>();
  for (const rc of rowCandidates(buffer, cursor, target.row, searchCandidates(target))) {
    const colMap = columnMap(buffer, rc.at);
    for (const col of cols) {
      const cms = colMap.get(col);
      if (cms === undefined) continue;
      for (const cm of cms) {
        for (const op of ops) {
          const keys = rc.keys + cm + op;
          if (seen.has(keys)) continue;
          seen.add(keys);
          cands.push(keys);
        }
      }
    }
  }
  if (target.kind !== 'armored') {
    for (const keys of lanewiseCandidates(cursor, target)) {
      if (!seen.has(keys)) { seen.add(keys); cands.push(keys); }
    }
  }
  cands.sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));

  // Charges are scarce and reset only on a wave clear, so a command that spends
  // one is worth CHARGE_PENALTY extra keystrokes when we rank it. Without this
  // the "optimal" answer is always `D`, and the ledger teaches nothing.
  const out: Optimal[] = [];
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
    const effective = keys.length + (ck ? Math.max(0, CHARGE_PENALTY - (plan.victims.length - 1) * 2) : 0)
      + (dearer(keys) ? SEARCH_TIEBREAK : 0);
    if (effective > bestEffective) continue;
    if (effective < bestEffective) { bestEffective = effective; out.length = 0; }
    out.push({ keys, cost: keys.length });
  }
  return out;
}

/**
 * The cheapest motion-only keystrokes that put the cursor exactly on `to`, or
 * null when nothing in the motion set lands there. Fewest tokens first, then
 * lexicographic. The placement drill's PERFECT rule is built on this: the
 * survey grid is a buffer like any other (drills-and-coach D9).
 */
export function moveKeys(buffer: Buffer, from: Cursor, to: Cursor): string | null {
  let best: string | null = null;
  let bestN = Infinity;
  const offer = (keys: string) => {
    const n = splitKeys(keys).length;
    if (n < bestN || (n === bestN && best !== null && keys < best)) { best = keys; bestN = n; }
  };
  const rows = rowCandidates(buffer, from, to.row);
  for (const rc of rows) {
    const cms = columnMap(buffer, rc.at).get(to.col);
    if (cms === undefined) continue;
    for (const cm of cms) offer(rc.keys + cm);
  }
  if (best !== null) return best;
  // No single motion lands there - column 38 of the survey ruler is neither a
  // mark nor within thirty `l` of a far cursor - so allow one hop between:
  // `f3` to the mark, then `8l`. Two motions is what a player would type.
  for (const rc of rows) {
    const first = columnMap(buffer, rc.at);
    for (const [col, cms] of first) {
      if (col === to.col) continue;
      const second = columnMap(buffer, { row: to.row, col }).get(to.col);
      if (second === undefined) continue;
      offer(rc.keys + cms[0] + second[0]);
    }
  }
  return best;
}

/**
 * The token a count is recorded under. `3j` and `d3w` are a lesson of their
 * own, and the ledger could not see one until it was a token; it is spelled
 * like the curriculum's keycap so the tables read the same (drills-and-coach).
 */
export const COUNT_TOKEN = '{n}';

/** `*` and `#` are their own tokens; `n`/`N` repeat; `/` and `?` are `/`. */
function searchToken(c: Command): string {
  const last = c.raw[c.raw.length - 1];
  if (last === '*' || last === '#') return last;
  if (last === 'n' || last === 'N') return 'n';
  return '/';
}

/** The distinct motion/operator tokens a keystroke string exercises. */
export function tokensUsed(keys: string): string[] {
  const eng = new VimEngine();
  const out: string[] = [];
  for (const k of splitKeys(keys)) {
    const c = eng.feed(k);
    if (!c) continue;
    if (c.search) { out.push(searchToken(c)); continue; }
    if (c.count > 1) out.push(COUNT_TOKEN);
    if (c.repeat) { out.push('.'); }
    if (c.operator) out.push(c.operator);
    if (c.textObject) out.push(c.textObject);
    if (c.motion) out.push(c.motion.kind);
  }
  return out;
}

// ---------------------------------------------------------------- mission par

/** A static scene the par search can carve without touching a live state. */
function sceneBuffer(spawn: readonly MissionSpawn[]): Buffer {
  const zombies: Zombie[] = spawn.map(([kind, row, col, text], i) => ({
    id: i + 1, kind, row, col, text, hp: kind === 'armored' ? 2 : 1, speed: 0,
  }));
  const buffer: Buffer = { rows: new Array<string>(ROWS).fill(''), zombies };
  deriveRows(zombies, WALL, buffer.rows);
  return buffer;
}

const WALL = { hp: 100, maxHp: 100 };

/** Cheapest motion-only keystrokes that land the cursor inside any zombie. */
function reachPar(buffer: Buffer, cursor: Cursor): number {
  let best = Infinity;
  for (const z of buffer.zombies) {
    for (const rc of rowCandidates(buffer, cursor, z.row)) {
      const colMap = columnMap(buffer, rc.at);
      for (let c = z.col; c < z.col + z.text.length; c++) {
        const cms = colMap.get(c);
        if (cms === undefined) continue;
        const n = splitKeys(rc.keys + cms[0]).length;
        if (n < best) best = n;
      }
    }
  }
  return best;
}

/**
 * Greedy sequential par for a `clear` scene: from the start with full charges,
 * take the zombie the oracle kills cheapest, apply that command for real
 * (chips, erosions and charges included), and repeat until the field is
 * empty. Greedy over kill order, so it is an upper bound on the true optimum
 * for a crowded scene - which only ever errs in the player's favour.
 */
function clearPar(buffer: Buffer, start: Cursor, charges: { dd: number; D: number }): number {
  let cursor: Cursor = { row: start.row, col: start.col };
  let keys = 0;
  let guard = 0;
  while (buffer.zombies.length > 0 && guard++ < 64) {
    let best: Optimal | null = null;
    for (const z of buffer.zombies) {
      const o = optimalKill(buffer, cursor, z, charges);
      if (!o) continue;
      if (!best || o.cost < best.cost || (o.cost === best.cost && o.keys < best.keys)) best = o;
    }
    if (!best) return Infinity;
    const r = dryRun(buffer, cursor, best.keys);
    if (!r) return Infinity;
    keys += splitKeys(best.keys).length;
    const zs = buffer.zombies;
    const plan = planKills(r.cmd, r.spans, zs);
    const ck = chargeKindFor(r.cmd, r.spans, plan);
    if (ck) charges[ck]--;
    for (const i of plan.chips) {
      const z = zs[i];
      z.hp--;
      if (z.hp <= 0) { z.text = z.text.slice(1, -1); z.col += 1; z.kind = 'walker'; z.hp = 1; }
    }
    for (const e of plan.erosions) { zs[e.index].col = e.col; zs[e.index].text = e.text; }
    for (let i = plan.victims.length - 1; i >= 0; i--) zs.splice(plan.victims[i], 1);
    deriveRows(zs, WALL, buffer.rows);
    cursor = clampCursor(buffer.rows, r.cursor);
  }
  return buffer.zombies.length === 0 ? keys : Infinity;
}

/** The shortest planting sequence: anchor, one counted lane change, plant. */
function plantPar(lanes: number): number {
  const drop = lanes - 1;
  return 2 + (drop > 1 ? String(drop).length : 0) + (drop > 0 ? 1 : 0);
}

/**
 * Par for one mission, from the oracle. An explicit `par` on the mission wins
 * (the search lessons); otherwise `clear` is greedy sequential `optimalKill`,
 * `reach` is the cheapest motion-only path and `plant` is the planting keys.
 */
export function parFor(m: Mission): number {
  if (m.par !== undefined) return m.par;
  if (m.goal === 'plant') return plantPar(m.plant?.lanes ?? 1);
  const buffer = sceneBuffer(m.spawn);
  const start: Cursor = { row: m.start[0], col: m.start[1] };
  return m.goal === 'reach' ? reachPar(buffer, start) : clearPar(buffer, start, parCharges(m));
}

/**
 * The magazine par is judged with. `dd` and `D` clear a lane for one or two
 * keys, so with a full magazine the oracle's answer to a lesson about `w` is
 * `D`, and three stars would mean not using the lesson. A mission gets the
 * charges only when its keycaps are about them; the player still has a full
 * magazine in TRY, and spending it is simply a way to beat par.
 */
function parCharges(m: Mission): { dd: number; D: number } {
  const caps = m.keys.join('');
  const about = m.keys.includes('D') || caps.includes('dd');
  return about ? { dd: CHARGES_DD, D: CHARGES_D } : { dd: 0, D: 0 };
}

const PAR = new Map<string, number>();

/** `parFor`, memoised by mission id. -1 for an unknown id. */
export function missionPar(id: string): number {
  const hit = PAR.get(id);
  if (hit !== undefined) return hit;
  const i = missionIndex(id);
  if (i < 0) return -1;
  const par = parFor(MISSIONS[i]);
  PAR.set(id, par);
  return par;
}
