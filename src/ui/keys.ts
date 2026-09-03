// Browser KeyboardEvent.key -> the one-token vocabulary `Game.keys()` speaks.
//
// `Game.keys()` splits its input into single characters, except for a `<...>`
// group, which is one token. A browser key name like `ArrowDown` is neither:
// fed raw it becomes the nine keystrokes A r r o w D o w n, and in the store
// `n` is NEXT NIGHT (DECISIONS #90). So every name longer than one character
// is wrapped as a token here, and a press that is only a modifier is dropped.

/**
 * Keys that are not a keystroke on their own. `Shift` fires a keydown before
 * every capital letter; feeding it would break the combo on each `G` and `D`.
 */
const SILENT = new Set([
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock',
  'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock',
  'Dead', 'Process', 'Compose', 'Unidentified',
]);

/**
 * One key event's `key` as a `Game.keys()` token, or null if the press is
 * not a keystroke at all. Printable characters pass through; `Escape`,
 * `Enter` and `Backspace` take their Vim names; every other name (`ArrowDown`,
 * `Tab`, `Home`, `F5`, ...) is wrapped as a single `<Name>` token, which the
 * Vim engine fails as one unknown key (DECISIONS #34).
 */
export function keyToken(key: string): string | null {
  switch (key) {
    case 'Escape': return '<Esc>';
    case 'Enter': return '<CR>';
    case 'Backspace': return '<BS>';
    default: break;
  }
  if (key.length === 1) return key;
  if (SILENT.has(key)) return null;
  return `<${key}>`;
}
