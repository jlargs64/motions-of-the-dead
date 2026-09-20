// Analytics is a bus listener and nothing else. `src/core/bus.ts` is a frozen
// contract - every workstream communicates ONLY via GameEvents - so this reads
// the bus like any other subscriber and never opens a channel of its own.
//
// Four events, allowlisted. The bus emits `kill`, `shot`, `command` and
// `kill_judged` thousands of times a run; forwarding any of them would be a
// denial of service on my own dashboard. An allowlist rather than a denylist
// means a tag added to `GameEvent` later stays silent until someone puts it
// here on purpose.
//
// Nothing here reads `motd.save`, the save `id`, the seed or the run log. The
// payloads are integers and short enums, and that is the whole contract with
// the player: counts of what happened, nothing about who did it.

import type { Bus } from '../core/bus';
import { track } from './umami';

/**
 * Every event this game sends is prefixed with it. One Umami website carries
 * the whole site, so `run_end` on its own would collide the moment a second
 * project starts reporting; `motd:run_end` sorts with its siblings and filters
 * with one prefix. Umami allows 50 characters for a name and the longest here
 * is 18, so there is room (DECISIONS #100).
 */
export const EVENT_PREFIX = 'motd';

/** `motd:run_start`, and so on. The only place an event name is built. */
export function eventName(name: string): string {
  return `${EVENT_PREFIX}:${name}`;
}

/** Subscribe the allowlist to `bus`. Returns a detach function for tests. */
export function attachAnalytics(bus: Bus): () => void {
  const send = (name: string, data?: Record<string, number | string>) =>
    track(eventName(name), data);
  const off = [
    // `wave_start` fires every wave; a run only begins once.
    bus.on('wave_start', (e) => { if (e.n === 1) send('run_start'); }),
    bus.on('death', (e) => send('run_end', { wave: e.wave, score: e.score })),
    // `keys` and `par` are dropped - the outcome is the interesting number,
    // and the ledger already keeps the keystrokes where they belong.
    bus.on('mission_done', (e) => send('mission_done', { id: e.id, stars: e.stars })),
    bus.on('drill_done', (e) => send('drill_done', {
      family: e.family, perfect: e.perfect, scenes: e.scenes,
    })),
  ];
  return () => { for (const detach of off) detach(); };
}
