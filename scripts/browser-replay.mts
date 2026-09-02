// Drive the PRODUCTION bundle (dist/assets/*.js) through window.__motd with a
// mock DOM, replaying a recorded headless log. Proves browser == headless.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve as res } from 'node:path';
import { pathToFileURL } from 'node:url';

function ctxFor(): any {
  const t: any = {
    canvas: null,
    measureText: (s: string) => ({ width: s.length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return new Proxy(t, {
    get: (o, k: string) => (k in o ? o[k] : () => undefined),
    set: (o, k: string, v) => { o[k] = v; return true; },
  });
}
function mkCanvas(w = 1280, h = 800): any {
  const c: any = {
    width: w, height: h, clientWidth: w, clientHeight: h, style: {},
    getContext: () => c._ctx, addEventListener() {}, focus() {},
    getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }),
  };
  c._ctx = ctxFor(); c._ctx.canvas = c; return c;
}
const screen = mkCanvas();
const g: any = globalThis;
g.window = g;
g.document = {
  getElementById: (id: string) => (id === 'screen' ? screen : null),
  createElement: (t: string) => (t === 'canvas' ? mkCanvas(2048, 2048) : {}),
  addEventListener() {},
  querySelectorAll: () => [],
  documentElement: { style: {} },
};
g.MutationObserver = class { observe() {} disconnect() {} };
g.fetch = () => Promise.resolve({});
const runs = res(process.cwd(), 'runs');
const logFile = readdirSync(runs).filter((f) => f.endsWith('.jsonl')).sort().pop()!;
const lines = readFileSync(join(runs, logFile), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const init = lines.find((l: any) => l.t === 'init');
if (!init) { process.stderr.write(`${logFile}: no init line\n`); process.exit(1); }

// The bundle reads ?seed= at module load, so this has to be right before import.
const search = `?agent=1&seed=${init.seed}`;
g.location = { search, href: `http://x/${search}` };
g.devicePixelRatio = 1;
g.innerWidth = 1280; g.innerHeight = 800;
g.addEventListener = () => {};
const rafQueue: Array<(t: number) => void> = [];
g.requestAnimationFrame = (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length; };
/** Run the most recently scheduled frame callback through the real renderer. */
const drawFrame = (t: number): void => { rafQueue[rafQueue.length - 1]?.(t); };
g.AudioContext = undefined;

const dist = res(process.cwd(), 'dist/assets');
const bundle = readdirSync(dist).find((f) => f.endsWith('.js'))!;
await import(pathToFileURL(join(dist, bundle)).href);

const motd = (g as any).__motd;
if (!motd) throw new Error('window.__motd missing from the production bundle');
motd.pause(true);
drawFrame(0);                            // one real frame through the real renderer

if (motd.json().rngSeed !== init.seed) {
  process.stderr.write(`seed mismatch: bundle ${motd.json().rngSeed}, log ${init.seed}\n`);
  process.exit(1);
}

motd.start();                            // the log was recorded from a started run
let n = 0;
for (const l of lines) {
  if (l.t !== 'in') continue;
  const m = /^step\s+(\d+)$/.exec(l.line.trim());
  if (m) motd.step(Number(m[1]));
  else if (/^(quit|:q|state|help|auto .*|seed .*)$/.test(l.line.trim())) continue;
  else motd.keys(l.line.trim());
  n++;
  drawFrame(n * 16.67);                  // render every step, exercising the real draw path
}
const finalLine = lines.find((l: any) => l.t === 'final');
const browserState = JSON.stringify(motd.json());
const headlessState = JSON.stringify(finalLine.state);
console.log(`bundle       ${bundle}`);
console.log(`log          ${logFile} (seed ${init.seed}, ${n} inputs replayed)`);
console.log(`frames drawn through the real renderer: ${n + 1}`);
console.log(`browser state == headless state: ${browserState === headlessState}`);
if (browserState !== headlessState) {
  const a = JSON.parse(browserState), b = JSON.parse(headlessState);
  for (const k of Object.keys(b)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) console.log('  differs:', k);
  process.exit(1);
}
console.log('OK: the production browser build matches the headless sim exactly');
