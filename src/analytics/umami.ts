// The only file in this project that knows `window` exists. Everything about
// analytics that can fail lives here, and none of it is allowed to.
//
// `umami` is resolved at call time and never cached: the tag is deferred, so
// the first event can fire before the script has landed. That event is dropped.
// There is no queue and no retry - a queue is state on the one module that must
// never throw, kept in order to recover at most one `run_start` (DECISIONS #98).

type Umami = { track?: (name: string, data?: Record<string, unknown>) => unknown };

/** The payloads the allowlist is allowed to build: numbers and short enums. */
export type EventData = Record<string, number | string>;

export function track(name: string, data?: EventData): void {
  try {
    // `globalThis`, not `window`: under node there is no `window` to reference.
    const u = (globalThis as { umami?: Umami }).umami;
    if (!u || typeof u.track !== 'function') return;
    u.track(name, data);
  } catch {
    // An ad blocker's stub, a network error inside the tag, a browser that
    // throws on a blocked request. None of it is the game's problem.
  }
}
