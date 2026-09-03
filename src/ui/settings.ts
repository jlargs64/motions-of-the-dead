// Phase E - player settings. A view over `save.settings`; the store owns the
// persistence, so nothing here touches localStorage.
import type { GoreLevel } from '../render/renderer';
import { coerceSettings, defaultSettings } from '../save/schema';
import type { SaveStore } from '../save/save';

export type LineNumbers = 'off' | 'absolute' | 'relative';

export interface Settings {
  gore: GoreLevel;
  lineNumbers: LineNumbers;
  /** slot -> cosmetic id. Empty until `armory` lands. */
  equipped: Record<string, string>;
}

const NUM_ORDER: LineNumbers[] = ['relative', 'absolute', 'off'];
const GORE_ORDER: GoreLevel[] = ['full', 'low', 'off'];

/** A detached copy, so a caller mutating it does not skip the store. */
export function loadSettings(store: SaveStore): Settings {
  const s = coerceSettings(store.get().settings);
  return { gore: s.gore, lineNumbers: s.lineNumbers, equipped: { ...s.equipped } };
}

export function saveSettings(store: SaveStore, s: Settings): void {
  store.set((save) => {
    save.settings = {
      gore: GORE_ORDER.includes(s.gore) ? s.gore : 'full',
      lineNumbers: NUM_ORDER.includes(s.lineNumbers) ? s.lineNumbers : 'relative',
      equipped: { ...s.equipped },
    };
  });
}

export function defaultUiSettings(): Settings {
  const d = defaultSettings();
  return { gore: d.gore, lineNumbers: d.lineNumbers, equipped: {} };
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
