import { describe, expect, it } from 'vitest';
import { VimEngine } from '../src/vim/engine';
import { tokens } from './helpers';
import type { Command } from '../src/core/types';

function feedAll(keys: string, eng = new VimEngine()): { cmds: Command[]; eng: VimEngine; errors: string[] } {
  const cmds: Command[] = [];
  const errors: string[] = [];
  eng.onError = (k) => errors.push(k);
  for (const k of tokens(keys)) { const c = eng.feed(k); if (c) cmds.push(c); }
  return { cmds, eng, errors };
}
const one = (keys: string) => feedAll(keys).cmds[0];

describe('VimEngine — counts', () => {
  it('3w resolves to count 3', () => expect(one('3w').count).toBe(3));
  it('d3w resolves to count 3', () => expect(one('d3w').count).toBe(3));
  it('3dw resolves to count 3', () => expect(one('3dw').count).toBe(3));
  it('2d3w multiplies to 6', () => expect(one('2d3w').count).toBe(6));
  it('10x resolves to count 10', () => expect(one('10x').count).toBe(10));
  it('leading 0 is a motion, not a count', () => {
    expect(one('0').motion?.kind).toBe('0');
    expect(one('20j').count).toBe(20);
  });
});

describe('VimEngine — operators without motions', () => {
  for (const [keys, op] of [['dd', 'dd'], ['D', 'D'], ['x', 'x'], ['X', 'X'], ['J', 'J']] as const) {
    it(`${keys} is complete on its own`, () => {
      const c = one(keys);
      expect(c.operator).toBe(op);
      expect(c.motion).toBeUndefined();
    });
  }
  it('3dd carries the count', () => expect(one('3dd').count).toBe(3));
  it('a lone d emits nothing and stays pending', () => {
    const { cmds, eng } = feedAll('d');
    expect(cmds).toHaveLength(0);
    expect(eng.pending()).toBe('d');
  });
});

describe('VimEngine — f/F/t/T and ; ,', () => {
  it('f consumes the next key as char', () => {
    const c = one('fx');
    expect(c.motion).toEqual({ kind: 'f', char: 'x' });
  });
  it('f is pending until the char arrives', () => {
    const { cmds, eng } = feedAll('f');
    expect(cmds).toHaveLength(0);
    expect(eng.pending()).toBe('f');
  });
  it('; repeats the last find with the stored char', () => {
    const { cmds } = feedAll('fq;');
    expect(cmds[1].motion).toEqual({ kind: 'f', char: 'q', repeatFind: true });
  });
  it(', reverses the last find', () => {
    const { cmds } = feedAll('fq,');
    expect(cmds[1].motion).toEqual({ kind: 'F', char: 'q', repeatFind: true });
  });
  it(', after t becomes T', () => {
    const { cmds } = feedAll('tq,');
    expect(cmds[1].motion?.kind).toBe('T');
  });
  it('; with no prior find is an error', () => {
    const { cmds, errors } = feedAll(';');
    expect(cmds).toHaveLength(0);
    expect(errors).toEqual([';']);
  });
  it('dfx keeps the operator', () => {
    const c = one('dfx');
    expect(c.operator).toBe('d');
    expect(c.motion).toEqual({ kind: 'f', char: 'x' });
  });
});

describe('VimEngine — text objects', () => {
  const cases: Array<[string, string]> = [
    ['ci(', 'i('], ['ca(', 'a('], ['ci)', 'i('], ['ca)', 'a('],
    ['di[', 'i['], ['da]', 'a['], ['di{', 'i{'], ['da}', 'a{'],
    ['di"', 'i"'], ['ca"', 'a"'], ["di'", "i'"], ["ca'", "a'"],
    ['diw', 'iw'], ['daw', 'aw'],
  ];
  for (const [keys, to] of cases) {
    it(`${keys} => ${to}`, () => {
      const c = one(keys);
      expect(c.textObject).toBe(to);
      expect(c.operator).toBe(keys[0]);
    });
  }
  it('i without an operator is an error', () => {
    const { cmds, errors } = feedAll('i');
    expect(cmds).toHaveLength(0);
    expect(errors).toEqual(['i']);
  });
  it('di is pending', () => expect(feedAll('di').eng.pending()).toBe('di'));
});

describe('VimEngine — gg', () => {
  it('a lone g is pending', () => {
    const { cmds, eng } = feedAll('g');
    expect(cmds).toHaveLength(0);
    expect(eng.pending()).toBe('g');
  });
  it('gg is a motion', () => expect(one('gg').motion?.kind).toBe('gg'));
  it('dgg keeps the operator', () => expect(one('dgg').operator).toBe('d'));
  it('gx is an error', () => expect(feedAll('gx').errors).toEqual(['x']));
});

describe('VimEngine — . repeat', () => {
  it('re-emits the last change with repeat: true', () => {
    const { cmds } = feedAll('dw.');
    expect(cmds[1].repeat).toBe(true);
    expect(cmds[1].motion?.kind).toBe('w');
    expect(cmds[1].count).toBe(1);
  });
  it('keeps the original count when none is given', () => {
    const { cmds } = feedAll('d3w.');
    expect(cmds[1].count).toBe(3);
  });
  it('a new count overrides the original', () => {
    const { cmds } = feedAll('d3w2.');
    expect(cmds[1].count).toBe(2);
  });
  it('pure motions are not repeatable', () => {
    const { cmds, errors } = feedAll('w.');
    expect(cmds).toHaveLength(1);
    expect(errors).toEqual(['.']);
  });
});

describe('VimEngine — search', () => {
  it('/query<CR> emits a search command', () => {
    const c = one('/brains<CR>');
    expect(c.search).toEqual({ query: 'brains' });
    expect(c.raw).toBe('/brains\r');
  });
  it('shows the query while typing', () => {
    expect(feedAll('/bra').eng.pending()).toBe('/bra');
  });
  it('Esc cancels the search', () => {
    const { cmds, eng } = feedAll('/bra<Esc>');
    expect(cmds).toHaveLength(0);
    expect(eng.pending()).toBe('');
  });
  it('an empty search is an error', () => {
    const { cmds, errors } = feedAll('/<CR>');
    expect(cmds).toHaveLength(0);
    expect(errors).toEqual(['<CR>']);
  });
  it('search swallows keys that would otherwise be motions', () => {
    const c = one('/dw<CR>');
    expect(c.search).toEqual({ query: 'dw' });
  });
});

describe('VimEngine — ? n N * #', () => {
  it('? enters a backward search', () => {
    const c = one('?gore<CR>');
    expect(c.search).toEqual({ query: 'gore', backward: true });
  });
  it('? shows its own prompt while typing', () => {
    expect(feedAll('?go').eng.pending()).toBe('?go');
  });
  it('n repeats the last search', () => {
    const { cmds } = feedAll('/gore<CR>n');
    expect(cmds[1].search).toEqual({ query: 'gore' });
  });
  it('N flips the direction', () => {
    const { cmds } = feedAll('/gore<CR>N');
    expect(cmds[1].search).toEqual({ query: 'gore', backward: true });
  });
  it('N after ? flips back to forward', () => {
    const { cmds } = feedAll('?gore<CR>N');
    expect(cmds[1].search).toEqual({ query: 'gore' });
  });
  it('n with no prior search is an error', () => {
    expect(feedAll('n').errors).toEqual(['n']);
  });
  it('* searches the word under the crosshair', () => {
    expect(one('*').search).toEqual({ query: '', wordUnderCursor: true });
  });
  it('# searches it backward', () => {
    expect(one('#').search).toEqual({ query: '', wordUnderCursor: true, backward: true });
  });
  it('n after * repeats the word search', () => {
    const { cmds } = feedAll('*n');
    expect(cmds[1].search).toEqual({ query: '', wordUnderCursor: true });
  });
  it('_ is a motion', () => expect(one('_').motion?.kind).toBe('_'));
  it('d_ keeps the operator', () => expect(one('d_').operator).toBe('d'));
});

describe('VimEngine — pending / showcmd', () => {
  const cases: Array<[string, string]> = [
    ['', ''], ['d', 'd'], ['d2', 'd2'], ['2d3', '2d3'], ['f', 'f'],
    ['g', 'g'], ['di', 'di'], ['3', '3'], ['/foo', '/foo'],
  ];
  for (const [keys, want] of cases) {
    it(`pending after ${JSON.stringify(keys)} is ${JSON.stringify(want)}`, () => {
      expect(feedAll(keys).eng.pending()).toBe(want);
    });
  }
  it('clears once the command completes', () => expect(feedAll('d2w').eng.pending()).toBe(''));
  it('Esc clears pending', () => expect(feedAll('2d3<Esc>').eng.pending()).toBe(''));
  it('reset() clears pending', () => {
    const { eng } = feedAll('d2');
    eng.reset();
    expect(eng.pending()).toBe('');
  });
});

describe('VimEngine — unknown keys', () => {
  for (const k of ['q', 'Z', '!', 'v', 'p', 'u', 'y', 'o']) {
    it(`${k} emits nothing and reports an error`, () => {
      const { cmds, errors } = feedAll(k);
      expect(cmds).toHaveLength(0);
      expect(errors).toEqual([k]);
    });
  }
  it('an unknown key clears pending state', () => {
    const { eng } = feedAll('d2q');
    expect(eng.pending()).toBe('');
  });
  it('dx is an error (x is not a motion)', () => expect(feedAll('dx').errors).toEqual(['x']));
});

describe('VimEngine — raw keystrokes are recorded for the ledger', () => {
  it('captures the whole sequence', () => {
    expect(one('2d3w').raw).toBe('2d3w');
    expect(one('ci(').raw).toBe('ci(');
    expect(one('dfz').raw).toBe('dfz');
  });
});
