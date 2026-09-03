// Phase 0 — diagnostics. A level, a ring buffer, and an optional sink.
//
// This exists because "the game randomly ended" is not a reproducible bug
// report and the game had no way to make it into one. Nothing here touches
// `GameState`: a log line must never be able to change what the sim does, or
// `npm run verify:browser` would be comparing two different games.
//
// It imports nothing. No DOM, no console at module scope, no timers - so
// importing this file under Node (headless sim, tests) is inert, and a test
// that never installs a sink never prints a line.

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Loudest first. A level admits itself and everything above it. */
const ORDER: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

export interface LogEntry {
  /** Wall-clock ms since the logger was created, so entries can be diffed. */
  t: number;
  level: LogLevel;
  /** Where it came from: `sim`, `run`, `store`, `input`. */
  tag: string;
  msg: string;
  /** Structured payload. Kept as a value, never formatted, so a sink can
   *  print it or a test can assert on it. */
  data?: Record<string, unknown>;
}

/**
 * How many entries the ring holds. The point is to survive long enough that a
 * player who watched a run end can ask what happened; a few hundred lines is
 * several seconds of debug-level play and costs nothing to keep.
 */
export const RING_MAX = 500;

/** Where a line goes once it passes the level. Installed by `main.ts`. */
export type LogSink = (e: LogEntry) => void;

class Logger {
  private level: LogLevel = 'info';
  private ring: LogEntry[] = [];
  private sink: LogSink | null = null;
  private t0 = 0;
  /** Monotonic clock, injectable so a test does not depend on wall time. */
  private now: () => number = () => 0;

  /**
   * Point the logger at a clock. `main.ts` passes `performance.now`; anything
   * that does not is stamped 0, which is honest rather than wrong.
   */
  useClock(now: () => number): void {
    this.now = now;
    this.t0 = now();
  }

  setLevel(level: LogLevel): void { this.level = level; }
  getLevel(): LogLevel { return this.level; }

  /** Install the sink that actually prints. Without one, lines only ring. */
  setSink(sink: LogSink | null): void { this.sink = sink; }

  /** Is this level being kept? Cheap enough to guard an expensive payload. */
  enabled(level: LogLevel): boolean {
    return ORDER.indexOf(level) <= ORDER.indexOf(this.level);
  }

  write(level: LogLevel, tag: string, msg: string, data?: Record<string, unknown>): void {
    if (!this.enabled(level)) return;
    const e: LogEntry = { t: Math.round(this.now() - this.t0), level, tag, msg };
    if (data) e.data = data;
    this.ring.push(e);
    if (this.ring.length > RING_MAX) this.ring.shift();
    // A throwing sink must not take the game with it: this is diagnostics.
    if (this.sink) { try { this.sink(e); } catch { /* ignore */ } }
  }

  error(tag: string, msg: string, data?: Record<string, unknown>): void { this.write('error', tag, msg, data); }
  warn(tag: string, msg: string, data?: Record<string, unknown>): void { this.write('warn', tag, msg, data); }
  info(tag: string, msg: string, data?: Record<string, unknown>): void { this.write('info', tag, msg, data); }
  debug(tag: string, msg: string, data?: Record<string, unknown>): void { this.write('debug', tag, msg, data); }

  /** The last `n` entries, oldest first. This is the bug report. */
  recent(n = RING_MAX): LogEntry[] {
    return n >= this.ring.length ? this.ring.slice() : this.ring.slice(this.ring.length - n);
  }

  /** One line per entry, for pasting into an issue. */
  dump(n = RING_MAX): string {
    return this.recent(n).map(format).join('\n');
  }

  reset(): void {
    this.ring = [];
    this.level = 'info';
    this.sink = null;
    this.t0 = this.now();
  }
}

/** `12345 info  sim   wave cleared {"n":3}` */
export function format(e: LogEntry): string {
  const head = `${String(e.t).padStart(7, ' ')} ${e.level.padEnd(5, ' ')} ${e.tag.padEnd(6, ' ')} ${e.msg}`;
  if (!e.data) return head;
  let tail: string;
  try { tail = JSON.stringify(e.data); } catch { tail = '[uninspectable]'; }
  return `${head}  ${tail}`;
}

/** The one logger. A module-level singleton, like `bus`. */
export const log = new Logger();
