// Phase F — the stable text surface agents parse. Do not reflow casually.
import { BARRICADE_COL, FIELD_COLS, ROWS, barricadeGlyphs } from '../core/field';
import type { GameState } from '../core/state';
import type { Zombie } from '../core/types';
import { waveDef } from '../sim/waves';
import { MISSIONS } from '../sim/missions';
import { missionPar } from '../sim/optimal';
import {
  ITEMS, canBuy, manifestLine, ownedText, wiredLanes,
} from '../sim/store';
import { SURVEY_RULER, spanCost, trapCols, trapLanes } from '../sim/traps';
import { optimalKill } from '../sim/optimal';
import { familyById, orderText } from '../sim/drills';

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
  ' no charge, but scores nothing. Armor is the exception: a non-text-object hit chips a bracket.' +
  ' LEGS  the first `x` (or `X`) into a word also shoots its legs out: speed halved for good,' +
  ' marked [hobbled] in the ZOMBIES table. Once per zombie; a crawler has no legs to lose.';

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

/**
 * The store, as an agent reads it. One line per item with a `>` on the
 * selection, the id in brackets so a bot can name what it is buying, and the
 * NEXT NIGHT row last. `MANIFEST` reads `locked` until it is bought.
 */
function storeBlock(s: GameState): string[] {
  const sm = s.sim;
  const out: string[] = [];
  out.push(`STORE  NIGHT ${s.wave} CLEARED  SUPPLIES ${s.supplies}  NEXT NIGHT ${s.wave + 1}`);
  out.push('  keys: j/k select (counts, gg G H M L), l or <CR> buy, n next night,' +
    ' <Esc> cancel placement');
  for (let i = 0; i < ITEMS.length; i++) {
    const it = ITEMS[i];
    const mark = i === sm.shop.cursor ? '> ' : '  ';
    const afford = canBuy(s, it.id) ? '' : '  --';
    out.push(`${mark}[${it.id}]`.padEnd(15, ' ') +
      `${it.name.padEnd(13, ' ')} ${pad(it.price, 4)}  ` +
      `${ownedText(s, it.id).padEnd(12, ' ')}${afford}  ${it.blurb}`);
  }
  out.push(`${sm.shop.cursor >= ITEMS.length ? '> ' : '  '}[next]`.padEnd(15, ' ') +
    `NEXT NIGHT ${s.wave + 1}`);
  out.push(`MANIFEST  ${sm.manifest ? manifestLine(s.wave) : 'locked (buy manifest)'}`);
  return out;
}

/** What is being placed, what the span under the crosshair costs, and how to
 *  commit it. A trap at the wall's foot is useless: the barricade resolves a
 *  zombie that arrives on the same step, so the strip says so. */
function placingLine(s: GameState): string {
  const shop = s.sim.shop;
  const a = shop.anchor;
  const cost = spanCost(shop.item, a, shop.place);
  const anchor = a ? `anchor lane ${a.row + 1} col ${a.col}` : 'anchor none';
  const wall = shop.place.col >= FIELD_COLS - 1 && shop.item !== 'wire'
    ? '  (at the wall: the barricade resolves it first)' : '';
  return `PLACING ${shop.item}  crosshair lane ${shop.place.row + 1} col ${shop.place.col}` +
    `  ${anchor}  cost ${cost}  <CR> ${a || shop.item === 'tripwire' || shop.item === 'wire'
      ? 'plants' : 'anchors'}  <Esc> cancels${wall}`;
}

/** Every planted trap, in every phase. Wire is a lane bit, so it gets a line. */
function trapsBlock(s: GameState): string[] {
  const sm = s.sim;
  const out: string[] = ['TRAPS  id kind       lanes  cols     charges'];
  for (const t of sm.traps) {
    out.push(`      ${pad(t.id, 4)} ${t.kind.padEnd(10, ' ')} ` +
      `${trapLanes(t).padEnd(6, ' ')} ${trapCols(t).padEnd(8, ' ')} ${pad(t.charges, 7)}`);
  }
  if (sm.traps.length === 0) out.push('        (none)');
  const wired = wiredLanes(sm.wireLanes).map((r) => r + 1);
  out.push(`WIRE  lanes ${wired.length ? wired.join(' ') : '(none)'}`);
  return out;
}

/** The Spotter's hint: the oracle's cheapest answer for whoever is nearest
 *  the wall, while there are hints left. */
function spotterLine(s: GameState, nearest: Zombie | null): string | null {
  if (s.sim.spotter <= 0 || !nearest) return null;
  const opt = optimalKill(s.buffer, s.cursor, nearest, s.charges);
  return `SPOTTER  ${opt ? opt.keys : '(nothing in the motion set reaches it)'}` +
    `  (${s.sim.spotter} left)`;
}

/**
 * The mission, as an agent reads it: id, beat, keys against par on the first
 * line, then what the mission is and what finishes it (DECISIONS #91). In
 * DONE the second line is the stars and the three keys that leave it.
 */
function missionBlock(s: GameState): string[] {
  const sm = s.sim;
  const m = MISSIONS[sm.mission];
  if (!m) return [];
  const beat = sm.missionBeat === 'done' ? 'DONE' : 'TRY';
  const par = missionPar(m.id);
  const out = [`MISSION ${m.id} ${beat} keys=${sm.missionKeys} par=${par}` +
    `  ${sm.mission + 1}/${MISSIONS.length} "${m.title}" (${m.section})`];
  if (sm.missionBeat === 'done') {
    const stars = sm.missionKeys <= par ? 3 : sm.missionKeys <= Math.ceil(par * 1.5) ? 2 : 1;
    out.push(`  stars ${stars}/3  keys: n next mission, r try again, <Esc> back to the list`);
  } else {
    const goal = m.goal === 'reach' ? 'put the crosshair on a zombie'
      : m.goal === 'plant' ? `plant a ${m.plant?.item ?? 'trap'} over ${m.plant?.lanes ?? 1} lanes`
        : 'kill them all';
    out.push(`  ${m.keys.join(' ')} : ${m.hint}  (goal: ${goal}; r restarts)`);
  }
  return out;
}

/**
 * The drill, as an agent reads it (drills-and-coach D5): family, seconds left,
 * kills, PERFECTs and scenes on the first line with the designated target - or
 * the placement order - and the keys that matter; the family's keycaps and
 * blurb on the second. On the end card, the score and the two keys that leave.
 */
function drillBlock(s: GameState): string[] {
  const sm = s.sim;
  const fam = familyById(sm.drill);
  if (!fam) return [];
  const score = `kills ${sm.kills}  perfect ${sm.drillPerfect}  scenes ${sm.drillScenes}`;
  if (s.phase === 'stats') {
    return [`DRILL OVER  ${fam.id}  ${score}  keys: r run it again, <Esc> back to drills`];
  }
  const left = `${Math.floor(Math.max(0, sm.drillLeft) / 1000)}s left`;
  let what: string;
  if (sm.drillOrder) {
    what = `ORDER ${orderText(sm.drillOrder)}  (<CR> anchors, move, <CR> plants; r: new order)`;
  } else {
    const z = s.buffer.zombies.find((x) => x.id === sm.drillTarget);
    what = z
      ? `target #${z.id} "${z.text}" lane ${z.row + 1} col ${z.col}  (r: new scene)`
      : 'target gone  (r: new scene)';
  }
  return [
    `DRILL ${fam.id}  ${left}  ${score}  ${what}`,
    `  ${fam.keys.join(' ')} : ${fam.blurb}`,
  ];
}

export function renderText(state: GameState, pending: string, menu?: string[]): string {
  const s = state;
  const sm = s.sim;
  const def = waveDef(s.wave);
  const out: string[] = [];

  // On the menu there is no field to describe, so print the menu instead:
  // one line per row, `>` on the cursor. `keys('jj')` then `keys('<CR>')`
  // drives it exactly as a player would. (`title` is the old name for `menu`.)
  if (s.phase === 'menu' || s.phase === 'title') {
    out.push(`PHASE ${s.phase}  MODE ${sm.mode}  (not in a run)`);
    if (menu) out.push(...menu);
    out.push('KEYS  j k (with counts)  gg G H M L  /text<CR>  n N  Enter or l' +
      '  h or Esc back  i starts survival');
    return out.join('\n');
  }

  out.push(
    `WAVE ${s.wave} "${def.title}"  SCORE ${s.score}  SUPPLIES ${s.supplies}` +
    `  COMBO x${s.combo}` +
    `  BARRICADE ${s.barricade.hp}/${s.barricade.maxHp}` +
    `  dd:${s.charges.dd} D:${s.charges.D}` +
    `  PENDING: ${pending}`,
  );
  out.push(
    `PHASE ${s.phase}  MODE ${sm.mode}  TIME ${(sm.time / 1000).toFixed(1)}s` +
    `  SPAWNED ${sm.spawnedThisWave}/${sm.waveSize}` +
    `  ALIVE ${s.buffer.zombies.length}` +
    `  BREATHER ${(Math.max(0, sm.breather) / 1000).toFixed(1)}s` +
    `  LONGEST_COMBO ${sm.longestCombo}`,
  );
  if (sm.mission >= 0) {
    out.push(...missionBlock(s));
  } else if (sm.drill !== '') {
    // Before the store branch: a placement order plays in the store's phase.
    out.push(...drillBlock(s));
  } else if (s.phase === 'shop') {
    out.push(...storeBlock(s));
  } else {
    out.push(`LESSON  ${def.section} / ${def.title} — ${def.keys.join(' ')} : ${def.desc}`);
  }
  // Placement is its own context and can be reached from the store *or* from
  // a plant mission, so its line hangs off the mode rather
  // than off whichever branch printed above it.
  if (s.phase === 'shop' && sm.shop.mode === 'place') out.push(placingLine(s));
  out.push(LEGEND);
  out.push(EROSION_NOTE);
  out.push(CHARGES_NOTE);
  out.push(FIELD_NOTE);
  out.push(RULER);

  const wall = barricadeGlyphs(s.barricade);
  // In placement mode the lanes print the survey ruler instead of the field -
  // the field is empty at wave end, and the ruler is what the motions resolve
  // against - and the caret follows the placement crosshair, not the cursor.
  const placing = s.phase === 'shop' && sm.shop.mode === 'place';
  const aim = placing ? sm.shop.place : s.cursor;
  const caret = PREFIX + ' '.repeat(Math.max(0, aim.col)) + '^';
  for (let r = 0; r < ROWS; r++) {
    const line = placing
      ? SURVEY_RULER
      : (s.buffer.rows[r] ?? '').padEnd(FIELD_COLS, ' ');
    out.push(`lane ${pad(r + 1, 2)} ${line}${wall[r] ?? ' '}`);
    if (r === aim.row) out.push(caret);
  }

  const zs = s.buffer.zombies.slice().sort((a, b) => (a.row - b.row) || (a.col - b.col));
  out.push('ZOMBIES  lane col kind     cols_to_wall  text');
  for (const z of zs) {
    out.push(`        ${pad(z.row + 1, 4)}${pad(z.col, 4)} ${z.kind.padEnd(8, ' ')} ` +
      `${pad(BARRICADE_COL - (z.col + z.text.length), 12)}  ${z.text}${z.hobbled ? '  [hobbled]' : ''}` +
      `${sm.drill !== '' && z.id === sm.drillTarget ? '  <-- target' : ''}`);
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
  const spot = spotterLine(s, nearest);
  if (spot) out.push(spot);
  out.push(...trapsBlock(s));
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
