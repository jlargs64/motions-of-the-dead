// Drives the REAL renderer + UI against a fake canvas: no browser, no assets.
// Catches the class of bug you otherwise only find by opening the page —
// NaN coordinates, unbalanced save/restore, a crash on an empty field, a
// gore level that throws. Run with `npm run smoke:render`.
const calls = new Map<string, number>();
let depth = 0;
let maxDepth = 0;
const problems: string[] = [];

function ctxFor(): any {
  const t: any = {
    canvas: null,
    measureText: (s: string) => ({ width: s.length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    getImageData: (_x: number, _y: number, w = 1, h = 1) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
  };
  return new Proxy(t, {
    get(o, k: string) {
      if (k in o) return o[k];
      return (...a: unknown[]) => {
        calls.set(k, (calls.get(k) ?? 0) + 1);
        if (k === 'save') { depth++; if (depth > maxDepth) maxDepth = depth; }
        if (k === 'restore') depth--;
        for (const v of a) {
          if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`non-finite arg to ctx.${k}(${a.join(', ')})`);
        }
        return undefined;
      };
    },
    set(o, k: string, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`non-finite ctx.${k}`);
      o[k] = v; return true;
    },
  });
}
function mkCanvas(w: number, h: number): any {
  const c: any = {
    width: w, height: h, clientWidth: w, clientHeight: h, style: {},
    getContext: () => c._ctx, addEventListener() {}, focus() {},
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
  };
  c._ctx = ctxFor(); c._ctx.canvas = c; return c;
}
const g: any = globalThis;
g.window = g;
g.document = { createElement: (t: string) => (t === 'canvas' ? mkCanvas(2048, 2048) : { style: {} }), getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
g.devicePixelRatio = 2;
g.innerWidth = 1600; g.innerHeight = 900;
g.OffscreenCanvas = undefined;

const { Game } = await import('../src/harness/api.js');
const { Renderer, PALETTE } = await import('../src/render/renderer.js');
const { Ledger } = await import('../src/ui/ledger.js');
const { Screens } = await import('../src/ui/screens.js');
const { optimalKill } = await import('../src/sim/optimal.js');
const { loadSettings } = await import('../src/ui/settings.js');

type Gore = 'off' | 'low' | 'full';
let frames = 0;

type Nums = 'off' | 'absolute' | 'relative';

function session(w: number, h: number, gore: Gore, nums: Nums, seed: number, maxFrames: number): string {
  const canvas = mkCanvas(w, h);
  const game = new Game(seed, { autoStart: false });
  const r = new Renderer(canvas as any, game.bus);
  const ledger = new Ledger(game.json(), game.bus);
  const screens = new Screens(ledger);
  const settings = loadSettings();
  settings.gore = gore;
  settings.lineNumbers = nums;
  r.gore = gore;
  r.lineNumbers = nums;
  game.engine.onError = () => { screens.unknownKeys++; r.flashError(); game.sim.unknownKey(); };
  r.resize();

  let paused = false;
  const draw = (now: number) => {
    const st = game.json();
    r.pendingCmd = game.pending();
    r.paused = paused;
    r.muted = false;
    r.beginFrame(16.67);
    if (st.phase === 'title') { r.overlay(PALETTE.bg, 1); screens.drawTitle(r, now); }
    else {
      r.drawGame(st);
      if (st.phase === 'playing' && st.sim.tutorial >= 0) screens.drawTutorial(r, st);
      else if (st.phase === 'playing' && st.sim.breather > 0) screens.drawWaveCard(r, st);
      if (st.phase === 'dead') screens.drawDeath(r, st);
      if (paused) screens.drawPause(r, false, settings);
    }
    r.endFrame();
    frames++;
  };

  for (let i = 0; i < 40; i++) draw(i * 16.67);        // title

  // Walk the warm-up first: it draws its own card and its own hordes.
  game.sim.startTutorial();
  let tg = 0;
  while (game.json().sim.tutorial >= 0 && tg++ < 3000) {
    const st = game.json();
    const zs = st.buffer.zombies;
    if (st.sim.tutorialHold > 0 || !zs.length) { game.step(100); draw(tg * 16.67); continue; }
    const z = zs[zs.length - 1];
    const o = optimalKill(st.buffer, st.cursor, z, st.charges);
    if (o) game.keys(o.keys);
    if (tg % 37 === 0) game.sim.retryTutorialStep();     // the panic button
    game.step(120);
    draw(tg * 16.67);
  }
  if (game.json().wave !== 1) throw new Error(`warm-up did not roll into wave 1 (wave ${game.json().wave})`);

  let t = 0;
  let n = 0;
  while (!game.isOver() && n < maxFrames) {
    const st = game.json();
    if (st.phase === 'playing' && st.sim.breather === 0 && st.buffer.zombies.length) {
      let z = st.buffer.zombies[0];
      for (const q of st.buffer.zombies) if (q.col + q.text.length > z.col + z.text.length) z = q;
      const o = optimalKill(st.buffer, st.cursor, z, st.charges);
      // Mostly good play, with unknown keys and misses sprinkled in.
      if (o && n % 11 !== 0) game.keys(o.keys); else game.keys(n % 3 === 0 ? 'q' : 'dw');
    }
    game.step(16.67); t += 16.67;
    draw(t); n++;
    if (n === 300) paused = true;
    if (n === 340) paused = false;
    if (n % 900 === 0) r.resize();
  }
  for (let i = 0; i < 60; i++) draw(t + i * 16.67);     // death card
  screens.feedDeathKey(':'); screens.feedDeathKey('q'); screens.feedDeathKey('<CR>');
  draw(t);
  return `${w}x${h} gore=${gore} nums=${nums} seed=${seed}: wave ${game.json().wave}, ${game.json().sim.kills} kills, dead=${game.isOver()}`;
}

const lines: string[] = [];
lines.push(session(1600, 900, 'full', 'relative', 1, 4000));
lines.push(session(320, 240, 'low', 'absolute', 2, 400));
lines.push(session(3840, 2160, 'off', 'off', 3, 400));
lines.push(session(1280, 720, 'full', 'absolute', 4, 400));

for (const l of lines) process.stdout.write(l + '\n');
process.stdout.write(`frames drawn: ${frames}   ctx ops: ${[...calls.values()].reduce((a, b) => a + b, 0)}   max save depth: ${maxDepth}\n`);
if (depth !== 0) problems.push(`unbalanced save/restore: depth ended at ${depth}`);
if (problems.length) {
  for (const p of problems.slice(0, 10)) process.stderr.write(`FAIL ${p}\n`);
  process.stderr.write(`FAIL ${problems.length} rendering problem(s)\n`);
  process.exit(1);
}
process.stdout.write('OK: renderer + UI survive warm-up, play, pause and death at 4 sizes, 3 gore levels and 3 gutter modes\n');
