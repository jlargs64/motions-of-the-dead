import { describe, expect, it } from 'vitest';
import { ROWS, deriveRows } from '../src/core/field';
import type { JudgeAnchor } from '../src/core/state';
import type { Buffer, Zombie, ZombieKind } from '../src/core/types';
import { judgeKill, noteCommand, wastedOf } from '../src/sim/judgement';
import { COUNT_TOKEN, optimalKill, optimalKills, tokensUsed } from '../src/sim/optimal';

type Spec = [ZombieKind, number, number, string];

function zombies(specs: Spec[]): Zombie[] {
  return specs.map(([kind, row, col, text], i) => ({
    id: i + 1, kind, row, col, text, hp: kind === 'armored' ? 2 : 1, speed: 0,
  }));
}

function buffer(zs: Zombie[]): Buffer {
  const rows = new Array<string>(ROWS).fill('');
  deriveRows(zs, { hp: 100, maxHp: 100 }, rows);
  return { rows, zombies: zs };
}

function anchor(specs: Spec[], row: number, col: number, keys = 0): JudgeAnchor {
  return {
    zombies: zombies(specs), cursor: { row, col }, charges: { dd: 2, D: 3 },
    keys, searchTarget: 0, find: false,
  };
}

// ---------------------------------------------------------- the shared module

describe('kill judgement is one module for the ledger, the medal and the drills', () => {
  const scene: Spec[] = [['walker', 4, 2, 'gore'], ['walker', 4, 12, 'zed'], ['walker', 9, 20, 'husk']];

  it('is PERFECT when the player matched the oracle, with nothing wasted', () => {
    const a = anchor(scene, 4, 2);
    const best = optimalKill(buffer(a.zombies), a.cursor, a.zombies[1], a.charges)!;
    expect(best).not.toBeNull();
    a.keys = best.keys.length;
    const j = judgeKill(a, 2)!;
    expect(j.optimal).toBe(best.keys);
    expect(j.spent).toBe(best.keys.length);
    expect(j.wasted).toBe(0);
    expect(j.perfect).toBe(true);
    expect(j.optimalTokens).toEqual(tokensUsed(best.keys));
  });

  it('is PERFECT when the player beat the narrowed oracle', () => {
    const a = anchor(scene, 4, 2);
    const best = optimalKill(buffer(a.zombies), a.cursor, a.zombies[1], a.charges)!;
    a.keys = best.keys.length - 1;
    const j = judgeKill(a, 2)!;
    expect(j.perfect).toBe(true);
    expect(j.wasted).toBe(0);
  });

  it('one extra keystroke is not PERFECT and wastes exactly one', () => {
    const a = anchor(scene, 4, 2);
    const best = optimalKill(buffer(a.zombies), a.cursor, a.zombies[1], a.charges)!;
    a.keys = best.keys.length + 1;
    const j = judgeKill(a, 2)!;
    expect(j.perfect).toBe(false);
    expect(j.wasted).toBe(1);
  });

  it('a zombie that spawned after the anchor is not judged', () => {
    const a = anchor(scene, 4, 2, 5);
    expect(judgeKill(a, 99)).toBeNull();
  });

  it('spent, optimal, wasted and perfect agree with the ledger arithmetic', () => {
    // The ledger reads `kill_judged` and recomputes waste from spent and
    // optimal; the medal reads `perfect`. Both must be the same rule.
    for (const spent of [1, 3, 4, 9]) {
      const a = anchor(scene, 4, 2, spent);
      const j = judgeKill(a, 2)!;
      expect(j.wasted).toBe(wastedOf(j.spent, j.optimal));
      expect(j.perfect).toBe(j.optimal !== null && j.spent <= j.optimal.length);
    }
    expect(wastedOf(4, null)).toBe(0);
    expect(wastedOf(2, 'wdw')).toBe(0);
    expect(wastedOf(5, 'wdw')).toBe(2);
  });

  it('noteCommand counts raw characters and remembers a find', () => {
    const a = anchor(scene, 4, 2);
    noteCommand(a, { count: 1, raw: '2w', motion: { kind: 'w' } });
    expect(a.keys).toBe(2);
    expect(a.find).toBe(false);
    noteCommand(a, { count: 1, raw: 'fz', motion: { kind: 'f', char: 'z' } });
    expect(a.keys).toBe(4);
    expect(a.find).toBe(true);
  });
});

// ---------------------------------------------------------- oracle: search

describe('the oracle knows * # and /text<CR>', () => {
  it('a far sibling is reached by a search', () => {
    const zs = zombies([['walker', 2, 4, 'rot'], ['walker', 13, 30, 'rot'], ['walker', 6, 10, 'gore']]);
    const best = optimalKill(buffer(zs), { row: 2, col: 4 }, zs[1], { dd: 2, D: 3 })!;
    expect(best).not.toBeNull();
    // `#` wraps backward to the same sibling and sorts before `*`; both are
    // the search family, and either is what the drill teaches.
    expect(/^(\*|#|\/rot\r|\/rot<CR>)/.test(best.keys)).toBe(true);
    expect(best.keys.length).toBe(3);
  });

  it('n chains after * when the first sibling is not the target', () => {
    // Siblings both ways round the cursor, so neither `*` nor `#` lands on
    // the target first and the repeat has to be chained.
    const zs = zombies([
      ['walker', 5, 4, 'rot'], ['walker', 3, 20, 'rot'], ['walker', 8, 20, 'rot'], ['walker', 12, 40, 'rot'],
    ]);
    const best = optimalKill(buffer(zs), { row: 5, col: 4 }, zs[3], { dd: 2, D: 3 })!;
    expect(best.keys).toMatch(/^[*#]n[cd]w$/);
  });

  it('existing verdicts for scenes without duplicate words are unchanged', () => {
    // The words sit far enough apart that a sweep would waste more than the
    // allowance, and there are no charges, so the verdicts are the word-sized
    // cuts the oracle has always given (`cw` sorts before `dw`).
    const zs = zombies([['walker', 4, 2, 'gore'], ['walker', 4, 14, 'zed'], ['walker', 5, 2, 'husk'],
      ['walker', 8, 2, 'moan']]);
    const ch = { dd: 0, D: 0 };
    const buf = buffer(zs);
    expect(optimalKill(buf, { row: 4, col: 2 }, zs[0], ch)!.keys).toBe('cw');
    expect(optimalKill(buf, { row: 4, col: 2 }, zs[1], ch)!.keys).toBe('Wcw');
    expect(optimalKill(buf, { row: 4, col: 2 }, zs[2], ch)!.keys).toBe('jcw');
    expect(optimalKill(buf, { row: 4, col: 2 }, zs[3], ch)!.keys).toBe('4jcw');
    // A search never wins a tie, and from the empty ground in front of the
    // word the two-key `dE` still beats any three-key jump-and-cut.
    expect(optimalKill(buf, { row: 4, col: 0 }, zs[0], ch)!.keys).toBe('dE');
    expect(optimalKills(buf, { row: 4, col: 0 }, zs[0], ch).some((o) => o.keys[0] === '*')).toBe(false);
  });

  it('optimalKills reports every command tied for cheapest', () => {
    const zs = zombies([['walker', 4, 0, 'gore'], ['walker', 4, 12, 'zed'], ['walker', 4, 24, 'husk'],
      ['walker', 4, 40, 'moan']]);
    const all = optimalKills(buffer(zs), { row: 4, col: 0 }, zs[2], { dd: 0, D: 0 }).map((o) => o.keys);
    expect(all[0]).toMatch(/^2[wW]cw$/);
    expect(all).toContain('fhcw');
    for (const k of all) expect(k.length).toBe(4);
    expect(optimalKill(buffer(zs), { row: 4, col: 0 }, zs[2], { dd: 0, D: 0 })!.keys).toBe(all[0]);
  });
});

describe('tokensUsed names counts and the search keys', () => {
  it('a count is a token of its own', () => {
    expect(tokensUsed('d3w')).toEqual([COUNT_TOKEN, 'd', 'w']);
    expect(tokensUsed('3jdw')).toContain(COUNT_TOKEN);
    expect(tokensUsed('jdw')).not.toContain(COUNT_TOKEN);
    expect(tokensUsed('0dw')).not.toContain(COUNT_TOKEN);
  });
  it('* and # are themselves; n repeats; / is /', () => {
    expect(tokensUsed('*dw')).toEqual(['*', 'd', 'w']);
    expect(tokensUsed('#dw')).toEqual(['#', 'd', 'w']);
    expect(tokensUsed('*ndw')).toEqual(['*', 'n', 'd', 'w']);
    expect(tokensUsed('/rot<CR>dw')).toEqual(['/', 'd', 'w']);
  });
});
