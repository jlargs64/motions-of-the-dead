import { beforeEach, describe, expect, it } from 'vitest';
import { cycleGore, cycleLineNumbers, goreBlurb, goreLabel, lineNumbersBlurb, lineNumbersLabel, loadSettings, saveSettings } from '../src/ui/settings';
import { deathLine } from '../src/ui/deaths';
import { createState } from '../src/core/state';
import type { RunSummary } from '../src/ui/ledger';

// A localStorage that behaves, so the settings round-trip is actually tested.
class MemStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

describe('settings', () => {
  beforeEach(() => { (globalThis as any).localStorage = new MemStore(); });

  it('defaults to full gore and relative line numbers', () => {
    expect(loadSettings().gore).toBe('full');
    expect(loadSettings().lineNumbers).toBe('relative');
  });
  it('cycles numbers relative -> absolute -> off', () => {
    expect(cycleLineNumbers('relative')).toBe('absolute');
    expect(cycleLineNumbers('absolute')).toBe('off');
    expect(cycleLineNumbers('off')).toBe('relative');
  });
  it('round-trips through localStorage', () => {
    saveSettings({ gore: 'off', lineNumbers: 'absolute' });
    expect(loadSettings().gore).toBe('off');
    expect(loadSettings().lineNumbers).toBe('absolute');
  });
  it('cycles full -> low -> off -> full', () => {
    expect(cycleGore('full')).toBe('low');
    expect(cycleGore('low')).toBe('off');
    expect(cycleGore('off')).toBe('full');
  });
  it('ignores garbage in storage', () => {
    (globalThis as any).localStorage.setItem('motd.settings', '{"gore":"buckets"}');
    expect(loadSettings().gore).toBe('full');
  });
  it('survives storage that throws', () => {
    (globalThis as any).localStorage = {
      getItem() { throw new Error('private window'); },
      setItem() { throw new Error('private window'); },
    };
    expect(() => saveSettings({ gore: 'low', lineNumbers: 'off' })).not.toThrow();
    expect(loadSettings().gore).toBe('full');
  });
  it('number labels are short enough to fit the options card', () => {
    for (const n of ['off', 'absolute', 'relative'] as const) {
      expect(lineNumbersLabel(n).length).toBeLessThanOrEqual(8);
      expect(lineNumbersBlurb(n).length).toBeLessThanOrEqual(23);
    }
  });
  it('labels are short enough to fit the options card', () => {
    for (const g of ['off', 'low', 'full'] as const) {
      expect(goreLabel(g).length).toBeGreaterThanOrEqual(3);
      expect(goreLabel(g).length).toBeLessThanOrEqual(4);
      expect(goreBlurb(g).length).toBeLessThanOrEqual(30);
    }
  });
});

function summary(over: Partial<RunSummary> = {}): RunSummary {
  return { topUsed: [], neverUsed: [], kpk: 3, prevKpk: null, trend: [], wastedKeystrokes: 0, ...over };
}

describe('death lines react to the run', () => {
  it('calls out arrow-key reaching', () => {
    const st = createState(1); st.wave = 5;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 9 })).toContain('arrow keys');
  });
  it('calls out hoarded charges', () => {
    const st = createState(1); st.wave = 6; st.charges.dd = 2;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 })).toContain('Hoarder');
  });
  it('calls out overkills', () => {
    const st = createState(1); st.wave = 9; st.charges.dd = 0; st.sim.overkills = 7;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 })).toContain('overkills');
  });
  it('calls out never pressing f', () => {
    const st = createState(1); st.wave = 9; st.charges.dd = 0;
    const line = deathLine({ state: st, summary: summary({ neverUsed: [['f', 4]] }), unknownKeys: 0 });
    expect(line).toContain('never once pressed f');
  });
  it('always returns something', () => {
    const st = createState(1); st.wave = 12; st.charges.dd = 0; st.sim.longestCombo = 10;
    expect(deathLine({ state: st, summary: summary(), unknownKeys: 0 }).length).toBeGreaterThan(10);
  });
});
