// The about screen's copy: four short pages, each one a few paragraphs, held
// as data so the menu (for `text()`), the card (for drawing) and the tests
// (for fit) all read the same words.
//
// Pure: no renderer, no DOM. The card is `Screens.drawAbout`; the rows the
// menu navigates are `ABOUT_ROWS`, derived from the pages so the tab strip and
// the copy can never disagree about the order.
import type { MenuRow } from './menu';

export interface AboutPage {
  /** Stable id, also the row id the menu and the harness use. */
  id: string;
  /** The tab's name, as the player reads it. */
  label: string;
  /** The dim line `text()` prints beside the tab. */
  hint: string;
  /** Paragraphs. Wrapped to the card at draw time; plain ASCII, no markup. */
  body: readonly string[];
}

/** The card gives the copy 44 cells across and 15 rows down. */
export const ABOUT_WIDTH = 44;
export const ABOUT_LINES = 15;

export const ABOUT_PAGES: readonly AboutPage[] = [
  {
    id: 'idea', label: 'the idea', hint: 'a shooter you edit',
    body: [
      'The field is a text buffer read side-on: 16 lanes, 52 columns of open '
      + 'ground. Zombies are words. They walk in from the west toward your '
      + 'barricade.',
      'Your cursor is the crosshair. You kill by editing: dw takes the word '
      + 'under it, x one character, d3w three words at once. Every horizontal '
      + 'motion runs along the axis the threat travels.',
      'Survival is the endless night, one wave per lesson, with a store between '
      + 'nights. Missions teach one motion at a time on a quiet field.',
    ],
  },
  {
    id: 'keys', label: 'the keys', hint: 'everything is Vim',
    body: [
      'Everything is Vim, including this menu: j and k move, Enter or l opens, '
      + 'h or Esc backs out, / searches, and counts work, so 3j and 5G do what '
      + 'you expect.',
      'In a run, i is the way in. Insert mode is death - that is the joke. Esc '
      + 'clears a half-typed command; Esc with nothing pending pauses.',
      'Put the crosshair on a word and it locks on: the aim rides that zombie '
      + 'east while you compose the command. On the death screen i inserts you '
      + 'back into the horde, and :q! does what it always does.',
    ],
  },
  {
    id: 'lesson', label: 'the lesson', hint: 'why it is a game',
    body: [
      'Inefficient motions get you killed. That is the whole pedagogy. A zombie '
      + 'you reach with llllll was one f away, and the difference is the time '
      + 'it took to bite you.',
      'The waves follow a Vim syllabus one lesson at a time, so the horde only '
      + 'ever asks for a motion you have been shown.',
      'Your service record keeps what you actually know: the motions you use, '
      + 'the ones you missed that would have won the fight, and your keystrokes '
      + 'per kill, run over run.',
    ],
  },
  {
    id: 'build', label: 'the build', hint: 'no assets, no network',
    body: [
      'Vite, TypeScript and Canvas 2D, with zero runtime dependencies. Nothing '
      + 'here is an asset: every glyph and figure is drawn procedurally and '
      + 'every sound is synthesised when the page loads.',
      'No network calls, no analytics, no accounts. Your save is one blob in '
      + 'this browser\'s localStorage, and the save screen carries it elsewhere.',
      'Made by Justin Largo. The horde is a text buffer.',
    ],
  },
];

/** One row per page, so the menu's j/k walk the tabs. */
export const ABOUT_ROWS: readonly MenuRow[] = ABOUT_PAGES.map((p) => ({
  id: p.id, label: p.label, hint: p.hint,
}));

/**
 * Greedy word wrap of every paragraph to `width` cells, one blank line between
 * paragraphs. Nothing is truncated: `tests/ui.test.ts` asserts every page fits
 * ABOUT_LINES, so the card can draw the result as-is.
 */
export function wrapPage(body: readonly string[], width = ABOUT_WIDTH): string[] {
  const out: string[] = [];
  for (const para of body) {
    if (out.length) out.push('');
    let cur = '';
    for (const w of para.split(' ')) {
      if (cur === '') { cur = w; continue; }
      if (cur.length + 1 + w.length <= width) { cur += ` ${w}`; continue; }
      out.push(cur);
      cur = w;
    }
    if (cur !== '') out.push(cur);
  }
  return out;
}
