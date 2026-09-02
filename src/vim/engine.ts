// Phase A — an explicit Vim normal-mode state machine.
// idle -> count -> operator-pending -> motion/textobject/char-pending -> emit
import type { Command, MotionKind, Operator, TextObjectKind } from '../core/types';

export interface IVimEngine {
  feed(key: string): Command | null;
  pending(): string;
  reset(): void;
}

type Await = 'none' | 'char' | 'g' | 'textobj' | 'search';
type FindKind = 'f' | 'F' | 't' | 'T';

const SIMPLE_MOTIONS: Record<string, MotionKind> = {
  h: 'h', j: 'j', k: 'k', l: 'l',
  w: 'w', W: 'W', b: 'b', B: 'B', e: 'e', E: 'E',
  $: '$', '^': '^', _: '_', G: 'G', '{': '{', '}': '}', '%': '%',
  H: 'H', M: 'M', L: 'L',
};

const OBJ_CHAR: Record<string, string> = {
  w: 'w', '(': '(', ')': '(', '[': '[', ']': '[', '{': '{', '}': '{', '"': '"', "'": "'",
};

export class VimEngine implements IVimEngine {
  /** Called when a key is rejected (Vim beeps; we flash the buffer red). */
  onError?: (key: string) => void;

  private countA = '';        // count typed before the operator
  private countB = '';        // count typed after the operator
  private op: Operator | undefined;
  private awaiting: Await = 'none';
  private findKind: FindKind | undefined;
  private objPrefix: 'i' | 'a' | undefined;
  private searchBuf = '';
  private searchBack = false;
  private raw = '';
  private lastFind: { kind: FindKind; char: string } | undefined;
  private lastSearch: { query: string; backward: boolean; word: boolean } | undefined;
  private lastChange: Command | undefined;

  reset(): void {
    this.countA = ''; this.countB = '';
    this.op = undefined;
    this.awaiting = 'none';
    this.findKind = undefined;
    this.objPrefix = undefined;
    this.searchBuf = '';
    this.searchBack = false;
    this.raw = '';
  }

  pending(): string {
    if (this.awaiting === 'search') return (this.searchBack ? '?' : '/') + this.searchBuf;
    return this.raw;
  }

  private fail(key: string): null {
    this.reset();
    this.onError?.(key);
    return null;
  }

  private resolvedCount(): number {
    const a = this.countA ? parseInt(this.countA, 10) : 0;
    const b = this.countB ? parseInt(this.countB, 10) : 0;
    if (a && b) return a * b;
    return a || b || 1;
  }

  private emit(cmd: Command): Command {
    if (cmd.operator || cmd.textObject) this.lastChange = cmd;
    this.reset();
    return cmd;
  }

  feed(key: string): Command | null {
    if (key === '') return null;

    // ---- search mode swallows almost everything -----------------------------
    if (this.awaiting === 'search') {
      if (key === '<Esc>') { this.reset(); return null; }
      if (key === '<CR>') {
        const q = this.searchBuf;
        const back = this.searchBack;
        const raw = (back ? '?' : '/') + q + '\r';
        this.reset();
        if (!q) { this.onError?.('<CR>'); return null; }
        this.lastSearch = { query: q, backward: back, word: false };
        return this.emit({ count: 1, search: back ? { query: q, backward: true } : { query: q }, raw });
      }
      if (key === '<BS>') { this.searchBuf = this.searchBuf.slice(0, -1); return null; }
      if (key.length === 1) { this.searchBuf += key; this.raw = (this.searchBack ? '?' : '/') + this.searchBuf; }
      return null;
    }

    if (key === '<Esc>') { this.reset(); return null; }

    this.raw += key;

    // ---- pending char for f/F/t/T -------------------------------------------
    if (this.awaiting === 'char') {
      if (key.length !== 1) return this.fail(key);
      const kind = this.findKind!;
      this.lastFind = { kind, char: key };
      return this.emit({
        count: this.resolvedCount(),
        operator: this.op,
        motion: { kind, char: key },
        raw: this.raw,
      });
    }

    // ---- pending `g` ---------------------------------------------------------
    if (this.awaiting === 'g') {
      if (key !== 'g') return this.fail(key);
      return this.emit({
        count: this.countA || this.countB ? this.resolvedCount() : 0,
        operator: this.op,
        motion: { kind: 'gg' },
        raw: this.raw,
      });
    }

    // ---- pending text object -------------------------------------------------
    if (this.awaiting === 'textobj') {
      const base = OBJ_CHAR[key];
      if (!base) return this.fail(key);
      const to = (this.objPrefix + base) as TextObjectKind;
      return this.emit({ count: this.resolvedCount(), operator: this.op, textObject: to, raw: this.raw });
    }

    // ---- counts ---------------------------------------------------------------
    if (key >= '1' && key <= '9') {
      if (this.op) this.countB += key; else this.countA += key;
      return null;
    }
    if (key === '0' && (this.op ? this.countB : this.countA) !== '') {
      if (this.op) this.countB += key; else this.countA += key;
      return null;
    }

    // ---- `.` repeat ------------------------------------------------------------
    if (key === '.' && !this.op) {
      const lc = this.lastChange;
      if (!lc) return this.fail(key);
      const newCount = this.countA ? parseInt(this.countA, 10) : 0;
      const cmd: Command = {
        ...lc,
        count: newCount || lc.count,
        repeat: true,
        raw: this.raw,
      };
      if (lc.motion) cmd.motion = { ...lc.motion };
      this.reset();
      this.lastChange = lc;
      return cmd;
    }

    // ---- `/` and `?` search --------------------------------------------------------
    if ((key === '/' || key === '?') && !this.op) {
      this.awaiting = 'search';
      this.searchBack = key === '?';
      this.searchBuf = '';
      this.raw = key;
      return null;
    }

    // ---- `n` / `N` repeat the last search ---------------------------------------------
    if ((key === 'n' || key === 'N') && !this.op) {
      const ls = this.lastSearch;
      if (!ls) return this.fail(key);
      const back = key === 'N' ? !ls.backward : ls.backward;
      const search: NonNullable<Command['search']> = { query: ls.word ? '' : ls.query };
      if (back) search.backward = true;
      if (ls.word) search.wordUnderCursor = true;
      return this.emit({ count: this.resolvedCount(), search, raw: this.raw });
    }

    // ---- `*` / `#` search the word under the crosshair ----------------------------------
    if ((key === '*' || key === '#') && !this.op) {
      const back = key === '#';
      this.lastSearch = { query: '', backward: back, word: true };
      const search: NonNullable<Command['search']> = { query: '', wordUnderCursor: true };
      if (back) search.backward = true;
      return this.emit({ count: this.resolvedCount(), search, raw: this.raw });
    }

    // ---- operators --------------------------------------------------------------
    if (key === 'd') {
      if (this.op === 'd') return this.emit({ count: this.resolvedCount(), operator: 'dd', raw: this.raw });
      if (this.op) return this.fail(key);
      this.op = 'd';
      return null;
    }
    if (key === 'c') {
      if (this.op) return this.fail(key);
      this.op = 'c';
      return null;
    }
    if (key === 'x' || key === 'X' || key === 'D' || key === 'J') {
      if (this.op) return this.fail(key);
      return this.emit({ count: this.resolvedCount(), operator: key as Operator, raw: this.raw });
    }

    // ---- text-object prefixes (only meaningful after an operator) -----------------
    if (key === 'i' || key === 'a') {
      if (!this.op) return this.fail(key);
      this.awaiting = 'textobj';
      this.objPrefix = key;
      return null;
    }

    // ---- `g` prefix ----------------------------------------------------------------
    if (key === 'g') { this.awaiting = 'g'; return null; }

    // ---- f/F/t/T --------------------------------------------------------------------
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      this.awaiting = 'char';
      this.findKind = key;
      return null;
    }

    // ---- ; and , : expanded into the concrete find they repeat -----------------------
    if (key === ';' || key === ',') {
      const lf = this.lastFind;
      if (!lf) return this.fail(key);
      let kind: FindKind = lf.kind;
      if (key === ',') kind = kind === 'f' ? 'F' : kind === 'F' ? 'f' : kind === 't' ? 'T' : 't';
      return this.emit({
        count: this.resolvedCount(),
        operator: this.op,
        motion: { kind, char: lf.char, repeatFind: true },
        raw: this.raw,
      });
    }

    // ---- `0` as a motion --------------------------------------------------------------
    if (key === '0') {
      return this.emit({ count: this.resolvedCount(), operator: this.op, motion: { kind: '0' }, raw: this.raw });
    }

    // ---- plain motions -------------------------------------------------------------------
    const mk = SIMPLE_MOTIONS[key];
    if (mk) {
      const count = mk === 'G' && !this.countA && !this.countB ? 0 : this.resolvedCount();
      return this.emit({ count, operator: this.op, motion: { kind: mk }, raw: this.raw });
    }

    return this.fail(key);
  }
}
