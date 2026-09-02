import { VimEngine } from '../src/vim/engine';
import { resolve } from '../src/vim/resolve';
import type { Buffer, Command, Cursor } from '../src/core/types';

/** Parse a fixture string. `|` marks the cursor (it sits on the char after it). */
export function parse(s: string): { buffer: Buffer; cursor: Cursor } {
  const lines = s.split('\n');
  let cursor: Cursor = { row: 0, col: 0 };
  const rows = lines.map((line, r) => {
    const i = line.indexOf('|');
    if (i >= 0) { cursor = { row: r, col: i }; return line.slice(0, i) + line.slice(i + 1); }
    return line;
  });
  return { buffer: { rows, zombies: [] }, cursor };
}

/** Split a keystroke string into engine tokens, honouring <Esc>/<CR>/<BS>. */
export function tokens(s: string): string[] {
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

/** Apply resolve()'s spans to the text, the way Vim's delete would. */
export function applyResolved(buffer: Buffer, cursor: Cursor, cmd: Command): { buffer: Buffer; cursor: Cursor } {
  const r = resolve(cmd, buffer, cursor);
  const rows = buffer.rows.slice();
  if (r.affected.length === 0) return { buffer: { rows, zombies: [] }, cursor: r.newCursor };
  if (r.linewise) {
    const r0 = r.affected[0].row;
    const r1 = r.affected[r.affected.length - 1].row;
    rows.splice(r0, r1 - r0 + 1);
    if (rows.length === 0) rows.push('');
  } else {
    const f = r.affected[0];
    const l = r.affected[r.affected.length - 1];
    if (f.row === l.row) {
      rows[f.row] = rows[f.row].slice(0, f.colStart) + rows[f.row].slice(f.colEnd);
    } else {
      const merged = rows[f.row].slice(0, f.colStart) + rows[l.row].slice(l.colEnd);
      rows.splice(f.row, l.row - f.row + 1, merged);
    }
  }
  return { buffer: { rows, zombies: [] }, cursor: r.newCursor };
}

/** Feed keys through a real engine and apply every complete command. */
export function run(before: string, keys: string): { text: string; cursor: Cursor } {
  const eng = new VimEngine();
  let { buffer, cursor } = parse(before);
  for (const k of tokens(keys)) {
    const cmd = eng.feed(k);
    if (!cmd) continue;
    const next = applyResolved(buffer, cursor, cmd);
    buffer = next.buffer;
    cursor = next.cursor;
  }
  return { text: buffer.rows.join('\n'), cursor };
}

/** Feed keys, apply nothing, just report where the cursor ends up. */
export function moveOnly(before: string, keys: string): Cursor {
  const eng = new VimEngine();
  const { buffer } = parse(before);
  let cursor = parse(before).cursor;
  for (const k of tokens(keys)) {
    const cmd = eng.feed(k);
    if (!cmd) continue;
    cursor = resolve(cmd, buffer, cursor).newCursor;
  }
  return cursor;
}
