// The save screen: export your progress, or bring someone else's in. Drawn
// with the renderer's glyph API like every other card — the download anchor,
// the file input and the paste textarea are DOM and live in main.ts.
import type { Renderer } from '../render/renderer';
import type { Save } from '../save/schema';
import type { ImportResult, MergeMode } from '../save/save';
import { NEWER_WARNING, OWN_BACKUP } from '../save/save';
import { INK, INK_DIM, INK_HOT, INK_RED, fit } from './screens';

export type SaveAction =
  | 'export-file' | 'export-clipboard' | 'import-file' | 'import-paste'
  | 'confirm' | 'cancel' | 'back' | null;

/** Panel cols 6..54 (usable 6.5..53.5), rows -3..17 (usable -2.5..15.5). */
const P_COL = 6;
const P_ROW = -3;
const P_W = 48;
const P_H = 20;

const LABEL = 9;      // left column: dim labels and keycaps
const DESC = 14;      // what a keycap does
const VALUE = 26;     // the right-hand value column
const DESC_MAX = 39;  // 53.5 - DESC
const VALUE_MAX = 27; // 53.5 - VALUE
const LINE_MAX = 44;  // 53.5 - LABEL

// The `THIS BROWSER` block runs two label/value pairs per row so the version,
// run count and salvage fit alongside the score and the kills (DECISIONS #60).
const L_VALUE = 20;      // left value column
const L_VALUE_MAX = 10;
const R_LABEL = 32;      // right label column
const R_VALUE = 41;      // right value column
const R_VALUE_MAX = 12;
const WIDE_MAX = 33;     // a value that gets the whole width, from L_VALUE

/** `2026-09-03 14:12`, or `never` for a save that has not been written yet. */
export function stamp(ms: number): string {
  if (!ms) return 'never';
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + ` ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class SaveScreen {
  /** One line under the card: `copied`, `merged`, or an error. */
  status = '';
  error = '';
  /** A validated import waiting on the player's confirmation. Null = actions view. */
  incoming: Extract<ImportResult, { ok: true }> | null = null;
  /** Which action the confirmation card has highlighted. */
  mode: MergeMode = 'merge';

  reset(): void {
    this.status = '';
    this.error = '';
    this.incoming = null;
    this.mode = 'merge';
  }

  say(status: string): void { this.status = status; this.error = ''; }

  /** `E485: Can't read file` plus the specific reason, on one line. */
  fail(error: string, reason?: string): void {
    this.error = reason ? `${error} - ${reason}` : error;
    this.status = '';
  }

  /**
   * Hand the screen a parse result. A failure becomes the error line; a
   * success opens the confirmation card, defaulting to `replace` when the file
   * is the player's own backup so importing it does not double the counters.
   */
  offer(result: ImportResult): void {
    if (!result.ok) { this.fail(result.error, result.reason); return; }
    this.incoming = result;
    this.mode = result.ownBackup ? 'replace' : 'merge';
    this.error = '';
    this.status = '';
  }

  // ---------------------------------------------------------------- draw

  draw(r: Renderer, save: Save): void {
    if (this.incoming) this.drawConfirm(r, this.incoming);
    else this.drawActions(r, save);
  }

  private drawActions(r: Renderer, save: Save): void {
    r.panel(P_COL, P_ROW, P_W, P_H);
    r.centerText('SAVE', -2, INK, 1.9);
    r.centerText('a backup you can carry to another browser', -1, INK_DIM);
    r.rule(LABEL, 0, 42);

    r.text('EXPORT', LABEL, 1, INK_DIM);
    r.keycap('e', LABEL, 2, 3);
    r.text('download a .json file', DESC, 2, INK);
    r.keycap('y', LABEL, 3, 3);
    r.text('copy to the clipboard', DESC, 3, INK);

    r.text('IMPORT', LABEL, 5, INK_DIM);
    r.keycap('o', LABEL, 6, 3);
    r.text('open a .json file', DESC, 6, INK);
    r.keycap('p', LABEL, 7, 3);
    r.text('paste from the clipboard', DESC, 7, INK);

    r.rule(LABEL, 9, 42);
    r.text('THIS BROWSER', LABEL, 10, INK_DIM);
    r.text('high score', LABEL, 11, INK_DIM);
    r.text(fit(String(save.lifetime.highScore), L_VALUE_MAX), L_VALUE, 11, INK);
    r.text('runs', R_LABEL, 11, INK_DIM);
    r.text(fit(String(save.lifetime.runs.length), R_VALUE_MAX), R_VALUE, 11, INK);
    r.text('kills', LABEL, 12, INK_DIM);
    r.text(fit(String(save.lifetime.kills), L_VALUE_MAX), L_VALUE, 12, INK);
    r.text('salvage', R_LABEL, 12, INK_DIM);
    r.text(fit(String(save.salvage), R_VALUE_MAX), R_VALUE, 12, INK);
    r.text('last saved', LABEL, 13, INK_DIM);
    r.text(fit(stamp(save.updatedAt), WIDE_MAX), L_VALUE, 13, INK_DIM);
    r.text('version', LABEL, 14, INK_DIM);
    r.text(fit(String(save.version), WIDE_MAX), L_VALUE, 14, INK_DIM);

    this.drawFooter(r, 'Esc  back');
  }

  private drawConfirm(r: Renderer, inc: Extract<ImportResult, { ok: true }>): void {
    r.panel(P_COL, P_ROW, P_W, P_H);
    r.centerText('IMPORT', -2, INK, 1.9);
    r.centerText('nothing changes until you choose', -1, INK_DIM);
    r.rule(LABEL, 0, 42);

    r.text('IN THIS FILE', LABEL, 1, INK_DIM);
    r.text('high score', LABEL, 2, INK_DIM);
    r.text(fit(String(inc.summary.highScore), VALUE_MAX), VALUE, 2, INK);
    r.text('kills', LABEL, 3, INK_DIM);
    r.text(fit(String(inc.summary.kills), VALUE_MAX), VALUE, 3, INK);
    r.text('unlocks', LABEL, 4, INK_DIM);
    r.text(fit(String(inc.summary.unlocks), VALUE_MAX), VALUE, 4, INK);
    r.text('saved', LABEL, 5, INK_DIM);
    r.text(fit(stamp(inc.summary.updatedAt), VALUE_MAX), VALUE, 5, INK_DIM);

    if (inc.warning) r.text(fit(NEWER_WARNING, LINE_MAX), LABEL, 7, INK_RED);
    if (inc.ownBackup) r.text(fit(OWN_BACKUP, LINE_MAX), LABEL, 8, INK_HOT);

    r.rule(LABEL, 9, 42);
    const merge = this.mode === 'merge';
    r.keycap('m', LABEL, 10, 3);
    r.text(fit('merge - add it to what is here', DESC_MAX), DESC, 10, merge ? INK_HOT : INK_DIM);
    r.keycap('R', LABEL, 11, 3);
    r.text(fit('replace - use the file, drop mine', DESC_MAX), DESC, 11, merge ? INK_DIM : INK_HOT);
    r.text(fit(merge ? 'nothing is lost either way you merge'
      : 'replace throws away this browser\'s progress', LINE_MAX), LABEL, 13, INK_DIM);

    this.drawFooter(r, 'Enter  do it        Esc  cancel');
  }

  /** Row 15 is the status line, and the key hint when there is nothing to say. */
  private drawFooter(r: Renderer, hint: string): void {
    if (this.error) r.text(fit(this.error, LINE_MAX), LABEL, 15, INK_HOT);
    else if (this.status) r.text(fit(this.status, LINE_MAX), LABEL, 15, INK);
    else r.centerText(hint, 15, INK_DIM);
  }

  // ---------------------------------------------------------------- input

  /** Returns what main.ts should do, the way `feedPauseKey` does. */
  feedKey(key: string): SaveAction {
    if (this.incoming) {
      if (key === '<Esc>') { this.reset(); return 'cancel'; }
      if (key === 'm' || key === 'M') { this.mode = 'merge'; return null; }
      if (key === 'r' || key === 'R') { this.mode = 'replace'; return null; }
      if (key === '<CR>') return 'confirm';
      return null;
    }
    if (key === '<Esc>') return 'back';
    if (key === 'e' || key === 'E') return 'export-file';
    if (key === 'y' || key === 'Y') return 'export-clipboard';
    if (key === 'o' || key === 'O') return 'import-file';
    if (key === 'p' || key === 'P') return 'import-paste';
    return null;
  }
}
