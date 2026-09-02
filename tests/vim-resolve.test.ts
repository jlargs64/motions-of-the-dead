import { describe, expect, it } from 'vitest';
import { moveOnly, run } from './helpers';

// before / keys / after fixtures. `|` marks the cursor.
const EDITS: Array<[string, string, string, string?]> = [
  // --- w / W ---------------------------------------------------------------
  ['|hello world', 'dw', 'world'],
  ['hello |world', 'dw', 'hello ', 'dw on the last word stops at end of line'],
  ['|hello world foo', 'd2w', 'foo'],
  ['|hello world foo', '2dw', 'foo'],
  ['|a b c d e f g', '2d3w', 'g', 'counts multiply'],
  ['|foo.bar baz', 'dw', '.bar baz', 'w stops at punctuation'],
  ['|foo.bar baz', 'dW', 'baz', 'W skips punctuation'],
  ['|one   two', 'dw', 'two'],
  // --- e / E ---------------------------------------------------------------
  ['|hello world', 'de', ' world', 'e is inclusive'],
  ['hello |world', 'de', 'hello '],
  ['|one two three', 'd2e', ' three'],
  ['|a.b c', 'dE', ' c'],
  // --- b / B ---------------------------------------------------------------
  ['foo |bar baz', 'db', 'bar baz'],
  ['foo bar |baz', 'd2b', 'baz'],
  ['foo.bar |baz', 'dB', 'baz'],
  // --- x / X / D -----------------------------------------------------------
  ['|hello', 'x', 'ello'],
  ['|hello', '3x', 'lo'],
  ['hel|lo', 'X', 'helo'],
  ['hello |world', 'D', 'hello '],
  ['|hello', 'D', ''],
  // --- 0 / ^ / $ -----------------------------------------------------------
  ['|hello world', 'd$', ''],
  ['hello wor|ld', 'd0', 'ld'],
  ['   foo b|ar', 'd^', '   ar'],
  // --- h / l / j / k --------------------------------------------------------
  ['|hello', 'dl', 'ello'],
  ['|hello', '3dl', 'lo'],
  ['hell|o', 'dh', 'helo'],
  ['a|bc\ndef', 'dj', '', 'j is linewise'],
  ['abc\nd|ef', 'dk', '', 'k is linewise'],
  // --- dd -------------------------------------------------------------------
  ['|abc\ndef', 'dd', 'def'],
  ['|abc\ndef\nghi', '2dd', 'ghi'],
  ['abc\n|def\nghi', 'dd', 'abc\nghi'],
  // --- f / F / t / T / ; / , -------------------------------------------------
  ['|hello world', 'dfo', ' world', 'f is inclusive'],
  ['|hello world', 'dto', 'o world', 't is exclusive'],
  ['|hello world', 'd2fo', 'rld'],
  ['hello wor|ld', 'dFo', 'hello wld', 'F is exclusive backward'],
  ['hello wor|ld', 'dTo', 'hello wold'],
  // --- text objects -----------------------------------------------------------
  ['x = (f|oo)', 'di(', 'x = ()'],
  ['x = (f|oo)', 'da(', 'x = '],
  ['x = (f|oo)', 'ci(', 'x = ()'],
  ['x = (f|oo)', 'di)', 'x = ()', ') maps to i('],
  ['say "hi t|here"', 'di"', 'say ""'],
  ['say "hi t|here"', 'da"', 'say '],
  ["say 'q|uoted' ok", "di'", "say '' ok"],
  ['[a|bc]', 'di[', '[]'],
  ['{a|bc}', 'da{', ''],
  ['f|oo bar', 'diw', ' bar'],
  ['f|oo bar', 'daw', 'bar'],
  ['foo b|ar', 'daw', 'foo', 'aw takes leading blanks when there are no trailing ones'],
  ['(a(b|c)d)', 'di(', '(a()d)', 'innermost pair wins'],
  // --- cw special case ----------------------------------------------------------
  ['|one two', 'cw', ' two', 'cw acts like ce'],
  ['|one two', 'c2w', '', 'c2w acts like c2e'],
  ['|one.two', 'cw', '.two'],
  // --- % ---------------------------------------------------------------------------
  ['|foo(bar)baz', 'd%', 'baz', '% is inclusive'],
  ['foo(bar|)baz', 'd%', 'foobaz'],
  // --- gg / G -----------------------------------------------------------------------
  ['|abc\ndef\nghi', 'dG', ''],
  ['abc\ndef\ng|hi', 'dgg', ''],
  ['|abc\ndef\nghi', 'd2G', 'ghi'],
  // --- . repeat ----------------------------------------------------------------------
  ['|aaa bbb ccc', 'dw.', 'ccc'],
  ['|aaa bbb ccc ddd', 'dw2.', 'ddd', 'a new count overrides the original'],
  ['|abcdef', 'x..', 'def'],
  // --- <Esc> clears pending -------------------------------------------------------------
  ['|hello world', 'd<Esc>w', 'hello world', 'Esc aborts the operator'],
  ['|hello world', '3<Esc>x', 'ello world', 'Esc clears the count too'],
];

describe('resolve() — Vim edit fixtures', () => {
  for (const [before, keys, after, note] of EDITS) {
    it(`${JSON.stringify(before)} + ${keys} => ${JSON.stringify(after)}${note ? ` (${note})` : ''}`, () => {
      expect(run(before, keys).text).toBe(after);
    });
  }
});

// before / keys / [row, col]
const MOVES: Array<[string, string, [number, number], string?]> = [
  ['|hello world', 'w', [0, 6]],
  ['|hello world', 'e', [0, 4]],
  ['hello |world', 'b', [0, 0]],
  ['|hello world', '$', [0, 10]],
  ['hello wor|ld', '0', [0, 0]],
  ['   fo|o', '^', [0, 3]],
  ['|hello world', 'fo', [0, 4]],
  ['|hello world', '2fo', [0, 7]],
  ['|hello world', 'fo;', [0, 7], '; repeats f'],
  ['|hello world', 'fo;,', [0, 4], ', reverses'],
  ['|abcabc', 'tc', [0, 1]],
  ['|abcabc', 'tc;', [0, 4], '; after t skips the adjacent match'],
  ['a\n\nb\n\nc', '}', [1, 0]],
  ['a\n\nb\n\nc', '2}', [3, 0]],
  ['a\n\nb\n\n|c', '{', [3, 0]],
  ['abc\ndef\ng|hi', 'gg', [0, 0]],
  ['|abc\ndef\nghi', 'G', [2, 0]],
  ['|abc\ndef\nghi', '2G', [1, 0]],
  ['|abc\ndef\nghi\njkl\nmno', 'L', [4, 0]],
  ['|abc\ndef\nghi\njkl\nmno', 'M', [2, 0]],
  ['abc\ndef\nghi\njkl\nm|no', 'H', [0, 0]],
  ['|abc\ndef\nghi\njkl\nmno', '3j', [3, 0]],
  ['|foo(bar)baz', '%', [0, 7]],
  ['foo(bar|)baz', '%', [0, 3]],
  ['|foo\nbar', '/bar<CR>', [1, 0], 'search jumps to the next match'],
  ['|foo bar foo', '/foo<CR>', [0, 8]],
  ['|foo bar foo', '/nope<CR>', [0, 0], 'a failed search does not move'],
  ['|abcdef', '3l', [0, 3]],
  ['abcd|ef', '2h', [0, 2]],
  ['|one two three', '3w', [0, 12], 'w on the last word lands on the last char'],
];

// The game sets virtualedit=all: rows are right-trimmed, so without it the only
// legal column on a blank row is 0 and `l` is a no-op. See DECISIONS.md #3.
// vim-hero's Search and "Moving to Line Ends" sections, wired to the engine.
describe('resolve() — search, repeat search, and word search', () => {
  const FIELD = 'shamble  drag\ncreep  shamble\ndrag  gore';
  it('/ finds the next match', () => {
    expect(moveOnly('|' + FIELD, '/drag<CR>')).toEqual({ row: 0, col: 9 });
  });
  it('? searches backward, wrapping', () => {
    expect(moveOnly('|' + FIELD, '?drag<CR>')).toEqual({ row: 2, col: 0 });
  });
  it('n repeats the last search', () => {
    expect(moveOnly('|' + FIELD, '/drag<CR>n')).toEqual({ row: 2, col: 0 });
  });
  it('N repeats it the other way', () => {
    expect(moveOnly('|' + FIELD, '/drag<CR>nN')).toEqual({ row: 0, col: 9 });
  });
  it('n with no prior search is an error', () => {
    expect(moveOnly('|abc', 'n')).toEqual({ row: 0, col: 0 });
  });
  it('* jumps to the next zombie with the same word', () => {
    expect(moveOnly('|' + FIELD, '*')).toEqual({ row: 1, col: 7 });
  });
  it('# goes the other way', () => {
    expect(moveOnly('creep  shamble\n|shamble  drag', '#')).toEqual({ row: 0, col: 7 });
  });
  it('* matches whole words only', () => {
    expect(moveOnly('|rot\ncarrot\nrot', '*')).toEqual({ row: 2, col: 0 });
  });
  it('_ goes to the first zombie in the lane', () => {
    expect(moveOnly('     |gore  moan', '_')).toEqual({ row: 0, col: 5 });
  });
  it('d_ is linewise, like dd', () => {
    expect(run('|abc\ndef', 'd_').text).toBe('def');
  });
  it('2_ reaches down a lane', () => {
    expect(moveOnly('|abc\n   def', '2_')).toEqual({ row: 1, col: 3 });
  });
});

describe('resolve() — virtualedit=all (a deliberate divergence from stock Vim)', () => {
  it('l walks past the end of a short line', () => {
    expect(moveOnly('|abc', '9l')).toEqual({ row: 0, col: 9 });
  });
  it('l walks across a blank line', () => {
    expect(moveOnly('|\nabc', '5l')).toEqual({ row: 0, col: 5 });
  });
  it('l stops at the field edge (52 walkable columns)', () => {
    expect(moveOnly('|abc', '99l')).toEqual({ row: 0, col: 51 });
  });
  it('h comes back out of virtual space', () => {
    expect(moveOnly('|abc', '20l5h')).toEqual({ row: 0, col: 15 });
  });
  it('j and k carry the column across a blank line', () => {
    expect(moveOnly('abcdefgh\n\n|abcdefgh', '6l2k')).toEqual({ row: 0, col: 6 });
  });
  it('$ still goes to the real end of the text', () => {
    expect(moveOnly('|abc', '20l$')).toEqual({ row: 0, col: 2 });
  });
  it('b still finds the real word from virtual space', () => {
    expect(moveOnly('|foo bar', '30lb')).toEqual({ row: 0, col: 4 });
  });
  it('an operator fired from virtual space affects nothing', () => {
    expect(run('|foo', '20ldw').text).toBe('foo');
  });
});

describe('resolve() — cursor motions', () => {
  for (const [before, keys, [row, col], note] of MOVES) {
    it(`${JSON.stringify(before)} + ${keys} => ${row},${col}${note ? ` (${note})` : ''}`, () => {
      expect(moveOnly(before, keys)).toEqual({ row, col });
    });
  }
});
