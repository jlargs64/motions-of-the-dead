// Phase A — pure Vim motion/operator semantics over a text buffer.
// If `dw` doesn't do what Vim does, the game teaches wrong Vim.
import type { Buffer, Command, Cursor, MotionKind, TextObjectKind } from '../core/types';
import { FIELD_COLS } from '../core/field';

export interface Span { row: number; colStart: number; colEnd: number } // colEnd exclusive

export interface ResolveResult {
  newCursor: Cursor;
  affected: Span[];
  linewise: boolean;
  /** false when the motion failed (f{char} not found, % with no bracket, …). */
  ok: boolean;
}

interface Pos { row: number; col: number }
type MotionType = 'exclusive' | 'inclusive' | 'linewise';

// ---------------------------------------------------------------- primitives

const KEYWORD = /[A-Za-z0-9_]/;

export function lineLen(rows: readonly string[], r: number): number {
  const s = rows[r];
  return s === undefined ? 0 : s.length;
}

function charAt(rows: readonly string[], r: number, c: number): string {
  const s = rows[r];
  if (s === undefined) return ' ';
  const ch = s[c];
  return ch === undefined ? ' ' : ch;
}

/** 0 = blank, 1 = punctuation, 2 = keyword. With `big`, non-blank is all 1. */
function cls(rows: readonly string[], p: Pos, big: boolean): 0 | 1 | 2 {
  const ch = charAt(rows, p.row, p.col);
  if (ch === ' ' || ch === '\t' || ch === '') return 0;
  if (big) return 1;
  return KEYWORD.test(ch) ? 2 : 1;
}

function isBlankLine(rows: readonly string[], r: number): boolean {
  const s = rows[r];
  return s === undefined || s.trim().length === 0;
}

function advance(rows: readonly string[], p: Pos): Pos | null {
  if (p.col + 1 < lineLen(rows, p.row)) return { row: p.row, col: p.col + 1 };
  if (p.row + 1 < rows.length) return { row: p.row + 1, col: 0 };
  return null;
}

function retreat(rows: readonly string[], p: Pos): Pos | null {
  if (p.col > 0) return { row: p.row, col: p.col - 1 };
  if (p.row > 0) return { row: p.row - 1, col: Math.max(0, lineLen(rows, p.row - 1) - 1) };
  return null;
}

/**
 * The game runs with Vim's `virtualedit=all`: rows are right-trimmed so that
 * `$`, `e` and `dw`-at-end-of-line mean something, which would otherwise leave
 * column 0 as the only legal column on a blank row. The cursor is a gun sight
 * over a 60-wide grid, so it is clamped to the grid, not to the text.
 */
export function clampCursor(rows: readonly string[], c: Cursor): Cursor {
  const row = Math.max(0, Math.min(c.row, rows.length - 1));
  const col = Math.max(0, Math.min(c.col, FIELD_COLS - 1));
  return { row, col };
}

function firstNonBlank(rows: readonly string[], r: number): number {
  const s = rows[r] ?? '';
  for (let i = 0; i < s.length; i++) if (s[i] !== ' ' && s[i] !== '\t') return i;
  return 0;
}

function cmp(a: Pos, b: Pos): number {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

// ---------------------------------------------------------------- word motions

function wordFwd(rows: readonly string[], from: Pos, big: boolean): Pos {
  let p: Pos = { row: from.row, col: from.col };
  const c0 = cls(rows, p, big);
  if (c0 !== 0) {
    for (;;) {
      const n = advance(rows, p);
      if (!n) return p;
      if (n.row !== p.row || cls(rows, n, big) !== c0) { p = n; break; }
      p = n;
    }
  } else {
    const n = advance(rows, p);
    if (!n) return p;
    p = n;
  }
  while (cls(rows, p, big) === 0) {
    if (isBlankLine(rows, p.row) && lineLen(rows, p.row) === 0) return p; // empty line is a word
    const n = advance(rows, p);
    if (!n) return p;
    p = n;
  }
  return p;
}

function wordBack(rows: readonly string[], from: Pos, big: boolean): Pos {
  const first = retreat(rows, from);
  if (!first) return { row: from.row, col: from.col };
  let p = first;
  while (cls(rows, p, big) === 0) {
    if (lineLen(rows, p.row) === 0) return p;
    const n = retreat(rows, p);
    if (!n) return p;
    p = n;
  }
  const c = cls(rows, p, big);
  for (;;) {
    const n = retreat(rows, p);
    if (!n) return p;
    if (n.row !== p.row || cls(rows, n, big) !== c) return p;
    p = n;
  }
}

function wordEnd(rows: readonly string[], from: Pos, big: boolean): Pos {
  const first = advance(rows, from);
  if (!first) return { row: from.row, col: from.col };
  let p = first;
  while (cls(rows, p, big) === 0) {
    const n = advance(rows, p);
    if (!n) return p;
    p = n;
  }
  const c = cls(rows, p, big);
  for (;;) {
    const n = advance(rows, p);
    if (!n) return p;
    if (n.row !== p.row || cls(rows, n, big) !== c) return p;
    p = n;
  }
}

// ---------------------------------------------------------------- paragraphs

function paraFwd(rows: readonly string[], from: Pos): Pos {
  const last = rows.length - 1;
  let r = from.row;
  while (r < last && isBlankLine(rows, r)) r++;
  while (r < last && !isBlankLine(rows, r)) r++;
  if (r === last && !isBlankLine(rows, last)) return { row: last, col: Math.max(0, lineLen(rows, last) - 1) };
  return { row: r, col: 0 };
}

function paraBack(rows: readonly string[], from: Pos): Pos {
  let r = from.row;
  while (r > 0 && isBlankLine(rows, r)) r--;
  while (r > 0 && !isBlankLine(rows, r)) r--;
  return { row: r, col: 0 };
}

// ---------------------------------------------------------------- brackets

const OPEN = '([{';
const CLOSE = ')]}';

function matchBracket(rows: readonly string[], p: Pos): Pos | null {
  const line = rows[p.row] ?? '';
  let idx = -1;
  for (let i = p.col; i < line.length; i++) {
    if (OPEN.includes(line[i]) || CLOSE.includes(line[i])) { idx = i; break; }
  }
  if (idx < 0) return null;
  const ch = line[idx];
  const oi = OPEN.indexOf(ch);
  if (oi >= 0) {
    let depth = 0;
    for (let i = idx; i < line.length; i++) {
      if (line[i] === OPEN[oi]) depth++;
      else if (line[i] === CLOSE[oi]) { depth--; if (depth === 0) return { row: p.row, col: i }; }
    }
    return null;
  }
  const ci = CLOSE.indexOf(ch);
  let depth = 0;
  for (let i = idx; i >= 0; i--) {
    if (line[i] === CLOSE[ci]) depth++;
    else if (line[i] === OPEN[ci]) { depth--; if (depth === 0) return { row: p.row, col: i }; }
  }
  return null;
}

/** Enclosing pair for a text object: [openCol, closeCol] on the cursor's line. */
function enclosingPair(rows: readonly string[], p: Pos, open: string, close: string): [number, number] | null {
  const line = rows[p.row] ?? '';
  if (line[p.col] === open) {
    let depth = 0;
    for (let i = p.col; i < line.length; i++) {
      if (line[i] === open) depth++;
      else if (line[i] === close) { depth--; if (depth === 0) return [p.col, i]; }
    }
    return null;
  }
  // scan back for an unmatched open
  let depth = 0;
  let openIdx = -1;
  for (let i = p.col; i >= 0; i--) {
    if (line[i] === close && i !== p.col) depth++;
    else if (line[i] === open) { if (depth === 0) { openIdx = i; break; } depth--; }
  }
  if (openIdx < 0) return null;
  depth = 0;
  for (let i = openIdx; i < line.length; i++) {
    if (line[i] === open) depth++;
    else if (line[i] === close) { depth--; if (depth === 0) return [openIdx, i]; }
  }
  return null;
}

function quotePair(rows: readonly string[], p: Pos, q: string): [number, number] | null {
  const line = rows[p.row] ?? '';
  const idx: number[] = [];
  for (let i = 0; i < line.length; i++) if (line[i] === q) idx.push(i);
  for (let i = 0; i + 1 < idx.length; i += 2) {
    if (p.col <= idx[i + 1]) return [idx[i], idx[i + 1]];
  }
  return null;
}

// ---------------------------------------------------------------- motion

export interface MotionResult { pos: Pos; type: MotionType; ok: boolean }

export function motionTarget(
  rows: readonly string[], cursor: Cursor, kind: MotionKind, count: number, ch?: string,
  repeatFind?: boolean,
): MotionResult {
  const last = rows.length - 1;
  let p: Pos = { row: cursor.row, col: cursor.col };
  const n = Math.max(1, count);

  switch (kind) {
    case 'h': return { pos: { row: p.row, col: Math.max(0, p.col - n) }, type: 'exclusive', ok: true };
    case 'l':
      // virtualedit=all: `l` walks into the empty part of the row.
      return { pos: { row: p.row, col: Math.min(FIELD_COLS - 1, p.col + n) }, type: 'exclusive', ok: true };
    case 'j': return { pos: { row: Math.min(last, p.row + n), col: p.col }, type: 'linewise', ok: p.row + n <= last };
    case 'k': return { pos: { row: Math.max(0, p.row - n), col: p.col }, type: 'linewise', ok: p.row - n >= 0 };
    case '0': return { pos: { row: p.row, col: 0 }, type: 'exclusive', ok: true };
    case '^': return { pos: { row: p.row, col: firstNonBlank(rows, p.row) }, type: 'exclusive', ok: true };
    case '_': {
      // Linewise: count-1 lanes down, then the first non-blank. `d_` == `dd`.
      const r = Math.min(last, p.row + n - 1);
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case '$': {
      const r = Math.min(last, p.row + n - 1);
      return { pos: { row: r, col: Math.max(0, lineLen(rows, r) - 1) }, type: 'inclusive', ok: true };
    }
    case 'gg': {
      const r = Math.max(0, Math.min(last, count > 0 ? count - 1 : 0));
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case 'G': {
      const r = count > 0 ? Math.max(0, Math.min(last, count - 1)) : last;
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case 'H': {
      const r = Math.min(last, n - 1);
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case 'L': {
      const r = Math.max(0, last - (n - 1));
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case 'M': {
      const r = Math.floor(last / 2);
      return { pos: { row: r, col: firstNonBlank(rows, r) }, type: 'linewise', ok: true };
    }
    case 'w': case 'W': {
      const big = kind === 'W';
      for (let i = 0; i < n; i++) p = wordFwd(rows, p, big);
      return { pos: p, type: 'exclusive', ok: true };
    }
    case 'b': case 'B': {
      const big = kind === 'B';
      for (let i = 0; i < n; i++) p = wordBack(rows, p, big);
      return { pos: p, type: 'exclusive', ok: true };
    }
    case 'e': case 'E': {
      const big = kind === 'E';
      for (let i = 0; i < n; i++) p = wordEnd(rows, p, big);
      return { pos: p, type: 'inclusive', ok: true };
    }
    case '{': { for (let i = 0; i < n; i++) p = paraBack(rows, p); return { pos: p, type: 'exclusive', ok: true }; }
    case '}': { for (let i = 0; i < n; i++) p = paraFwd(rows, p); return { pos: p, type: 'exclusive', ok: true }; }
    case '%': {
      const m = matchBracket(rows, p);
      return m ? { pos: m, type: 'inclusive', ok: true } : { pos: p, type: 'inclusive', ok: false };
    }
    case 'f': case 'F': case 't': case 'T': {
      if (!ch) return { pos: p, type: 'exclusive', ok: false };
      const line = rows[p.row] ?? '';
      const fwd = kind === 'f' || kind === 't';
      const till = kind === 't' || kind === 'T';
      let col = p.col;
      for (let i = 0; i < n; i++) {
        // `;` after t/T must skip the adjacent occurrence (real Vim behaviour)
        let start = fwd ? col + 1 : col - 1;
        if (till && repeatFind && i === 0) {
          if (fwd && line[col + 1] === ch) start = col + 2;
          else if (!fwd && line[col - 1] === ch) start = col - 2;
        }
        let found = -1;
        if (fwd) { for (let j = start; j < line.length; j++) if (line[j] === ch) { found = j; break; } }
        else { for (let j = start; j >= 0; j--) if (line[j] === ch) { found = j; break; } }
        if (found < 0) return { pos: p, type: fwd ? 'inclusive' : 'exclusive', ok: false };
        col = found;
      }
      if (till) col = fwd ? col - 1 : col + 1;
      if (col < 0 || col >= Math.max(1, line.length)) return { pos: p, type: 'inclusive', ok: false };
      return { pos: { row: p.row, col }, type: fwd ? 'inclusive' : 'exclusive', ok: true };
    }
    case ';': case ',':
      // The engine expands these into the concrete f/F/t/T before resolve sees them.
      return { pos: p, type: 'exclusive', ok: false };
  }
}

// ---------------------------------------------------------------- text objects

function textObjectSpan(rows: readonly string[], cursor: Cursor, to: TextObjectKind): Span | null {
  const p: Pos = { row: cursor.row, col: cursor.col };
  const line = rows[p.row] ?? '';
  const inner = to[0] === 'i';
  const what = to.slice(1);

  if (what === 'w') {
    if (line.length === 0) return { row: p.row, colStart: 0, colEnd: 0 };
    const c = cls(rows, p, false);
    let s = p.col, e = p.col;
    while (s > 0 && cls(rows, { row: p.row, col: s - 1 }, false) === c) s--;
    while (e + 1 < line.length && cls(rows, { row: p.row, col: e + 1 }, false) === c) e++;
    if (!inner) {
      let e2 = e;
      while (e2 + 1 < line.length && cls(rows, { row: p.row, col: e2 + 1 }, false) === 0) e2++;
      if (e2 === e) { while (s > 0 && cls(rows, { row: p.row, col: s - 1 }, false) === 0) s--; }
      e = e2;
    }
    return { row: p.row, colStart: s, colEnd: e + 1 };
  }

  if (what === '"' || what === "'") {
    const pair = quotePair(rows, p, what);
    if (!pair) return null;
    const [a, b] = pair;
    return inner
      ? { row: p.row, colStart: a + 1, colEnd: b }
      : { row: p.row, colStart: a, colEnd: b + 1 };
  }

  const openIdx = OPEN.indexOf(what === ')' ? '(' : what === ']' ? '[' : what === '}' ? '{' : what);
  if (openIdx < 0) return null;
  const pair = enclosingPair(rows, p, OPEN[openIdx], CLOSE[openIdx]);
  if (!pair) return null;
  const [a, b] = pair;
  return inner
    ? { row: p.row, colStart: a + 1, colEnd: b }
    : { row: p.row, colStart: a, colEnd: b + 1 };
}

// ---------------------------------------------------------------- spans

function spanBetween(rows: readonly string[], a: Pos, b: Pos, inclusive: boolean, out: Span[]): void {
  if (a.row === b.row) {
    const end = inclusive ? b.col + 1 : b.col;
    if (end > a.col) out.push({ row: a.row, colStart: a.col, colEnd: end });
    return;
  }
  out.push({ row: a.row, colStart: a.col, colEnd: lineLen(rows, a.row) });
  for (let r = a.row + 1; r < b.row; r++) out.push({ row: r, colStart: 0, colEnd: lineLen(rows, r) });
  const end = inclusive ? b.col + 1 : b.col;
  if (end > 0) out.push({ row: b.row, colStart: 0, colEnd: end });
}

function linewiseSpans(rows: readonly string[], r0: number, r1: number, out: Span[]): void {
  for (let r = r0; r <= r1; r++) out.push({ row: r, colStart: 0, colEnd: Math.max(1, lineLen(rows, r)) });
}

// ---------------------------------------------------------------- search

/** The keyword run under the cursor, or the next one on that lane. `*` / `#`. */
export function wordUnder(rows: readonly string[], p: Cursor): string {
  const line = rows[p.row] ?? '';
  let i = p.col;
  while (i < line.length && !KEYWORD.test(line[i])) i++;
  if (i >= line.length) return '';
  let s = i;
  while (s > 0 && KEYWORD.test(line[s - 1])) s--;
  let e = i;
  while (e + 1 < line.length && KEYWORD.test(line[e + 1])) e++;
  return line.slice(s, e + 1);
}

function matchAt(line: string, at: number, q: string, whole: boolean): boolean {
  if (line.startsWith(q, at) === false) return false;
  if (!whole) return true;
  const before = at > 0 ? line[at - 1] : '';
  const after = at + q.length < line.length ? line[at + q.length] : '';
  return !(before && KEYWORD.test(before)) && !(after && KEYWORD.test(after));
}

/** Next (or previous) match in buffer order, wrapping. */
function searchFrom(
  rows: readonly string[], cur: Cursor, q: string, backward: boolean, whole: boolean,
): Cursor | null {
  const total = rows.length;
  const step = backward ? -1 : 1;
  // Walk every position once, starting one cell past the cursor, wrapping.
  let row = cur.row;
  let col = cur.col + step;
  for (let guard = 0; guard <= total + 1; guard++) {
    const line = rows[row] ?? '';
    if (backward) {
      for (let i = Math.min(col, line.length - 1); i >= 0; i--) {
        if (matchAt(line, i, q, whole)) return { row, col: i };
      }
      row = (row - 1 + total) % total;
      col = (rows[row] ?? '').length - 1;
    } else {
      for (let i = Math.max(0, col); i + q.length <= line.length; i++) {
        if (matchAt(line, i, q, whole)) return { row, col: i };
      }
      row = (row + 1) % total;
      col = 0;
    }
  }
  return null;
}

// ---------------------------------------------------------------- entry point

export function resolve(cmd: Command, buffer: Buffer, cursor: Cursor): ResolveResult {
  const rows = buffer.rows;
  const cur = clampCursor(rows, cursor);
  const affected: Span[] = [];
  const last = rows.length - 1;

  // --- /search, ?search, * and # : pure crosshair jumps -----------------------
  if (cmd.search) {
    const whole = !!cmd.search.wordUnderCursor;
    const q = whole ? wordUnder(rows, cur) : cmd.search.query;
    if (!q) return { newCursor: cur, affected, linewise: false, ok: false };
    const hit = searchFrom(rows, cur, q, !!cmd.search.backward, whole);
    return hit
      ? { newCursor: hit, affected, linewise: false, ok: true }
      : { newCursor: cur, affected, linewise: false, ok: false };
  }

  const n = Math.max(1, cmd.count || 1);
  const op = cmd.operator;

  // --- standalone operators --------------------------------------------------
  if (op === 'x') {
    const len = lineLen(rows, cur.row);
    const end = Math.min(len, cur.col + n);
    if (end > cur.col) affected.push({ row: cur.row, colStart: cur.col, colEnd: end });
    return { newCursor: cur, affected, linewise: false, ok: affected.length > 0 };
  }
  if (op === 'X') {
    const start = Math.max(0, cur.col - n);
    if (cur.col > start) affected.push({ row: cur.row, colStart: start, colEnd: cur.col });
    return { newCursor: { row: cur.row, col: start }, affected, linewise: false, ok: affected.length > 0 };
  }
  if (op === 'D') {
    const len = lineLen(rows, cur.row);
    if (len > cur.col) affected.push({ row: cur.row, colStart: cur.col, colEnd: len });
    return { newCursor: cur, affected, linewise: false, ok: true };
  }
  if (op === 'dd') {
    const r1 = Math.min(last, cur.row + n - 1);
    linewiseSpans(rows, cur.row, r1, affected);
    return { newCursor: { row: Math.min(cur.row, last), col: 0 }, affected, linewise: true, ok: true };
  }
  if (op === 'J') {
    // Join is handled by the sim (it crushes rather than deletes).
    return { newCursor: cur, affected, linewise: false, ok: cur.row < last };
  }

  // --- operator + text object -------------------------------------------------
  if (cmd.textObject) {
    const sp = textObjectSpan(rows, cur, cmd.textObject);
    if (!sp || sp.colEnd <= sp.colStart) {
      return { newCursor: cur, affected, linewise: false, ok: false };
    }
    if (op) {
      affected.push(sp);
      return { newCursor: { row: sp.row, col: sp.colStart }, affected, linewise: false, ok: true };
    }
    return { newCursor: { row: sp.row, col: sp.colStart }, affected, linewise: false, ok: true };
  }

  // --- motion (with or without operator) --------------------------------------
  if (!cmd.motion) return { newCursor: cur, affected, linewise: false, ok: false };

  let kind = cmd.motion.kind;
  // `cw` on a non-blank behaves like `ce` (likewise cW/cE).
  if (op === 'c' && (kind === 'w' || kind === 'W') && cls(rows, cur, kind === 'W') !== 0) {
    kind = kind === 'w' ? 'e' : 'E';
  }

  const m = motionTarget(rows, cur, kind, cmd.count, cmd.motion.char, cmd.motion.repeatFind);
  if (!m.ok) return { newCursor: cur, affected, linewise: false, ok: false };

  if (!op) {
    let pos = m.pos;
    if (m.type === 'linewise') pos = { row: pos.row, col: pos.col };
    return { newCursor: clampCursor(rows, pos), affected, linewise: m.type === 'linewise', ok: true };
  }

  // operator + motion
  if (m.type === 'linewise') {
    const r0 = Math.min(cur.row, m.pos.row);
    const r1 = Math.max(cur.row, m.pos.row);
    linewiseSpans(rows, r0, r1, affected);
    return { newCursor: { row: r0, col: 0 }, affected, linewise: true, ok: true };
  }

  let a: Pos = cur;
  let b: Pos = m.pos;
  // An inclusive motion stays inclusive when it runs backwards (`d%` from a
  // closing bracket takes both brackets); exclusive stays exclusive.
  let inclusive = m.type === 'inclusive';
  if (cmp(b, a) < 0) { const t = a; a = b; b = t; }

  // :h word — with an operator, `w` never carries past the end of the last word
  // it moved over. So `dw` on the final word of a line stops at end of line.
  if ((op === 'd' || op === 'c') && (kind === 'w' || kind === 'W')) {
    const big = kind === 'W';
    const tc = cls(rows, b, big);
    const startsWord = tc !== 0 && (b.col === 0 || cls(rows, { row: b.row, col: b.col - 1 }, big) !== tc);
    if (b.row > a.row || !startsWord) {
      b = { row: a.row, col: lineLen(rows, a.row) };
      inclusive = false;
    }
  }

  if (cmp(a, b) === 0 && !inclusive) return { newCursor: cur, affected, linewise: false, ok: false };

  spanBetween(rows, a, b, inclusive, affected);
  return { newCursor: { row: a.row, col: a.col }, affected, linewise: false, ok: affected.length > 0 };
}

/** Total number of cells covered by a span list. */
export function spanCells(spans: readonly Span[]): number {
  let n = 0;
  for (const s of spans) n += Math.max(0, s.colEnd - s.colStart);
  return n;
}

/** True if [col, col+len) on `row` is entirely inside the span list. */
export function coversRange(spans: readonly Span[], row: number, col: number, len: number): boolean {
  for (let c = col; c < col + len; c++) {
    let hit = false;
    for (const s of spans) {
      if (s.row === row && c >= s.colStart && c < s.colEnd) { hit = true; break; }
    }
    if (!hit) return false;
  }
  return true;
}

/** True if any cell of [col, col+len) on `row` is inside the span list. */
export function overlapsRange(spans: readonly Span[], row: number, col: number, len: number): boolean {
  for (const s of spans) {
    if (s.row !== row) continue;
    if (col < s.colEnd && s.colStart < col + len) return true;
  }
  return false;
}
