// Phase F — the stable text surface agents parse. Do not reflow casually.
import { BARRICADE_COL, FIELD_COLS, ROWS, barricadeGlyphs } from '../core/field';
import type { GameState } from '../core/state';
import type { Zombie } from '../core/types';
import { waveDef } from '../sim/waves';
import { TUTORIAL } from '../sim/tutorial';

const LEGEND =
  'LEGEND  walker=plain word, any operator covering it' +
  ' | runner=short word, 2x speed' +
  ' | armored=bracketed/quoted, TEXT OBJECT ONLY (di( ca" diw ...)' +
  ' | bloater=8+ chars, dd/D bursts the whole lane and costs a charge' +
  ' | crawler=1 char, x only (anything else is an OVERKILL and breaks combo)';

const EROSION_NOTE =
  'PARTIAL HITS  A command that covers only PART of a word does not miss: those letters are' +
  ' deleted and the rest closes up. So `x` whittles a walker down one character at a time' +
  ' (7 keystrokes for a 7-letter word, versus 2 for `dw`). Eroding keeps your combo and costs' +
  ' no charge, but scores nothing. Armor is the exception: a non-text-object hit chips a bracket.';

const CHARGES_NOTE =
  'CHARGES  dd always spends a dd charge; D always spends a D charge; any other operator that' +
  ' destroys more than 4 cells of empty ground beyond what it kills (d$ from column 0, dG, dj ...)' +
  ' also spends a D charge. At zero charges the command does nothing and breaks your combo.' +
  ' Moving is always free: move precisely, then cut.';

const FIELD_NOTE =
  `FIELD  ${ROWS} lanes numbered 1..${ROWS} top to bottom (1-based, like Vim lines: 7G goes to lane 7),` +
  ` columns 0..${FIELD_COLS - 1}. Zombies enter at column 0 and walk EAST.` +
  ` The barricade stands at column ${BARRICADE_COL}; the glyph after each lane is that lane's section` +
  " of wall (# intact, then = - . and blank for a breach). You are behind it.";

const PREFIX = '        ';   // width of "lane NN "

const RULER = (() => {
  let r = '';
  for (let c = 0; c < FIELD_COLS; c++) r += c % 10 === 0 ? String(c / 10) : '.';
  return PREFIX + r;
})();

function pad(n: number, w: number): string { return String(n).padStart(w, ' '); }

export function renderText(state: GameState, pending: string): string {
  const s = state;
  const sm = s.sim;
  const def = waveDef(s.wave);
  const out: string[] = [];

  out.push(
    `WAVE ${s.wave} "${def.title}"  SCORE ${s.score}  COMBO x${s.combo}` +
    `  BARRICADE ${s.barricade.hp}/${s.barricade.maxHp}` +
    `  dd:${s.charges.dd} D:${s.charges.D}` +
    `  PENDING: ${pending}`,
  );
  out.push(
    `PHASE ${s.phase}  TIME ${(sm.time / 1000).toFixed(1)}s` +
    `  SPAWNED ${sm.spawnedThisWave}/${sm.waveSize}` +
    `  ALIVE ${s.buffer.zombies.length}` +
    `  BREATHER ${(Math.max(0, sm.breather) / 1000).toFixed(1)}s` +
    `  LONGEST_COMBO ${sm.longestCombo}`,
  );
  if (sm.tutorial >= 0) {
    const st = TUTORIAL[sm.tutorial];
    out.push(`TUTORIAL  step ${sm.tutorial + 1}/${TUTORIAL.length} "${st.title}" — ${st.keys.join(' ')} : ${st.hint}` +
      `  (goal: ${st.goal === 'reach' ? 'put the crosshair on a zombie' : 'kill them all'})`);
  } else {
    out.push(`LESSON  ${def.section} / ${def.title} — ${def.keys.join(' ')} : ${def.desc}`);
  }
  out.push(LEGEND);
  out.push(EROSION_NOTE);
  out.push(CHARGES_NOTE);
  out.push(FIELD_NOTE);
  out.push(RULER);

  const wall = barricadeGlyphs(s.barricade);
  const caret = PREFIX + ' '.repeat(Math.max(0, s.cursor.col)) + '^';
  for (let r = 0; r < ROWS; r++) {
    const line = (s.buffer.rows[r] ?? '').padEnd(FIELD_COLS, ' ');
    out.push(`lane ${pad(r + 1, 2)} ${line}${wall[r] ?? ' '}`);
    if (r === s.cursor.row) out.push(caret);
  }

  const zs = s.buffer.zombies.slice().sort((a, b) => (a.row - b.row) || (a.col - b.col));
  out.push('ZOMBIES  lane col kind     cols_to_wall  text');
  for (const z of zs) {
    out.push(`        ${pad(z.row + 1, 4)}${pad(z.col, 4)} ${z.kind.padEnd(8, ' ')} ` +
      `${pad(BARRICADE_COL - (z.col + z.text.length), 12)}  ${z.text}`);
  }
  if (zs.length === 0) out.push('        (none on the field)');

  let nearest: Zombie | null = null;
  for (const z of zs) {
    if (!nearest || z.col + z.text.length > nearest.col + nearest.text.length) nearest = z;
  }
  if (nearest) {
    out.push(`NEAREST lane ${nearest.row + 1} col ${nearest.col} ${nearest.kind} "${nearest.text}"` +
      `  cols_to_wall ${BARRICADE_COL - (nearest.col + nearest.text.length)}`);
  }

  const on = zombieUnder(s, s.cursor.row, s.cursor.col);
  const locked = on && sm.lockId === on.id ? ' [LOCKED - it will carry your crosshair as it walks]' : '';
  const onDesc = on
    ? `"${on.text}" ${on.kind} col ${on.col}..${on.col + on.text.length - 1}${locked}`
    : '<empty>';
  out.push(`CURSOR lane ${s.cursor.row + 1} col ${s.cursor.col}  (on: ${onDesc})`);
  if (s.phase === 'dead') {
    out.push(`GAME OVER  wave ${s.wave}  score ${s.score}  longest combo ${sm.longestCombo}` +
      `  kills ${sm.kills}  keystrokes ${sm.keystrokes}`);
  }
  return out.join('\n');
}

function zombieUnder(s: GameState, row: number, col: number): Zombie | null {
  for (const z of s.buffer.zombies) {
    if (z.row === row && col >= z.col && col < z.col + z.text.length) return z;
  }
  return null;
}
