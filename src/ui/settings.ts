// Phase E - player settings. localStorage only, and it must never throw.
import type { GoreLevel } from '../render/renderer';

const KEY = 'motd.settings';

export type LineNumbers = 'off' | 'absolute' | 'relative';

export interface Settings { gore: GoreLevel; lineNumbers: LineNumbers }

const DEFAULTS: Settings = { gore: 'full', lineNumbers: 'relative' };
const NUM_ORDER: LineNumbers[] = ['relative', 'absolute', 'off'];
const GORE_ORDER: GoreLevel[] = ['full', 'low', 'off'];

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const d = JSON.parse(raw) as Partial<Settings>;
    return {
      gore: GORE_ORDER.includes(d.gore as GoreLevel) ? d.gore as GoreLevel : 'full',
      lineNumbers: NUM_ORDER.includes(d.lineNumbers as LineNumbers)
        ? d.lineNumbers as LineNumbers : 'relative',
    };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s: Settings): void {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(s)); } catch { /* private window */ }
}

export function cycleGore(g: GoreLevel): GoreLevel {
  return GORE_ORDER[(GORE_ORDER.indexOf(g) + 1) % GORE_ORDER.length];
}

export function cycleLineNumbers(n: LineNumbers): LineNumbers {
  return NUM_ORDER[(NUM_ORDER.indexOf(n) + 1) % NUM_ORDER.length];
}

export function lineNumbersLabel(n: LineNumbers): string {
  return n === 'relative' ? 'RELATIVE' : n === 'absolute' ? 'ABSOLUTE' : 'OFF';
}

export function lineNumbersBlurb(n: LineNumbers): string {
  return n === 'relative' ? 'the count for j and k'
    : n === 'absolute' ? 'the count for {n}G'
      : 'no gutter';
}

export function goreLabel(g: GoreLevel): string {
  return g === 'full' ? 'FULL' : g === 'low' ? 'LOW' : 'OFF';
}

export function goreBlurb(g: GoreLevel): string {
  return g === 'full' ? 'chunks, spray, the lot'
    : g === 'low' ? 'blood, but no chunks'
      : 'no blood, clean fade';
}
