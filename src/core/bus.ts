// FROZEN CONTRACT — Phase 0.
// Typed synchronous event bus. Every workstream communicates ONLY via
// GameEvents and the read-only GameState.
import type { GameEvent } from './types';

type EventTag = GameEvent['t'];
type EventOf<K extends EventTag> = Extract<GameEvent, { t: K }>;
type Handler<K extends EventTag> = (e: EventOf<K>) => void;

export class Bus {
  private handlers = new Map<EventTag, Set<Handler<any>>>();
  private log: GameEvent[] = [];

  emit(e: GameEvent): void {
    this.log.push(e);
    const set = this.handlers.get(e.t);
    if (!set) return;
    for (const fn of set) fn(e as any);
  }

  on<K extends EventTag>(t: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(t);
    if (!set) { set = new Set(); this.handlers.set(t, set); }
    set.add(fn);
    return () => { set!.delete(fn); };
  }

  /** Take and clear everything emitted since the last drain. Used by the harness. */
  drain(): GameEvent[] {
    if (this.log.length === 0) return [];
    const out = this.log;
    this.log = [];
    return out;
  }

  clearListeners(): void { this.handlers.clear(); }
}

export const bus = new Bus();
