// Screenshots the REAL game in headless Chrome so a visual change can be judged
// against a baseline without opening a browser by hand. Zero dependencies:
// node:http serves dist/, the agent hook (`?agent`) drives the sim, Chrome's
// --screenshot writes the PNGs.
//
//   npm run shot                      -> runs/shots/current/*.png
//   npm run shot -- --out baseline    -> runs/shots/baseline/*.png
//   CHROME=/path/to/chrome npm run shot
//
// Every shot is deterministic: seed 7, fixed sim time, sim paused before the
// screenshot so the frame is stable.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIST = join(ROOT, 'dist');
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const outName = outArg >= 0 ? argv[outArg + 1] : 'current';
// `--only store` shoots just the shots whose name contains `store`, which is
// the difference between a four-minute loop and a fifteen-second one while a
// card is being laid out.
const onlyArg = argv.indexOf('--only');
const only = onlyArg >= 0 ? argv[onlyArg + 1] : '';
const OUT = join(ROOT, 'runs', 'shots', outName);
const CHROME = process.env.CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 1600; const H = 900; const PORT = 4179; const SEED = 7;

interface Shot { name: string; ms: number; hp?: number; keys?: string; title?: boolean; shop?: boolean; mission?: number }
const SHOTS: Shot[] = [
  { name: 'title', ms: 0, title: true },
  { name: 'menu-missions', ms: 0, title: true, keys: 'j<CR>jj' },
  { name: 'menu-missions-lanes', ms: 0, title: true, keys: 'j<CR>3j' },
  { name: 'menu-missions-ends', ms: 0, title: true, keys: 'j<CR>G' },
  { name: 'menu-options', ms: 0, title: true, keys: '6G<CR>' },
  { name: 'menu-ledger', ms: 0, title: true, keys: '5G<CR>' },
  { name: 'menu-save', ms: 0, title: true, keys: '7G<CR>' },
  { name: 'menu-about', ms: 0, title: true, keys: 'G<CR>' },
  { name: 'menu-about-keys', ms: 0, title: true, keys: 'G<CR>j' },
  { name: 'wave1-18s', ms: 18_000 },
  { name: 'wave2-95s', ms: 95_000 },
  { name: 'wave2-hp40', ms: 95_000, hp: 40 },
  { name: 'wave1-pending', ms: 18_000, keys: 'd2' },
  // The cursor parked on a word: the amber banner and the inverted crosshair.
  { name: 'wave1-onword', ms: 18_000, keys: 'jw' },
  // The same word with its legs shot out: the stump, and the hot cursor lane.
  { name: 'wave1-hobbled', ms: 18_000, keys: 'jwx' },
  // A refused command: the reason on screen and the empty magazine in the HUD.
  { name: 'refused-dry', ms: 18_000, keys: 'DDDDdddd' },
  // The store, settled after its page turn, and the placement strip over the
  // survey grid. `shop` clears the night so the wave-clear opens it for real.
  { name: 'store', ms: 18_000, shop: true },
  { name: 'store-next', ms: 18_000, shop: true, keys: 'G' },
  { name: 'store-manifest', ms: 18_000, shop: true, keys: 'gg13jl' },
  { name: 'store-placing', ms: 18_000, shop: true, keys: 'gg10jl3Gf2<CR>2j' },
  // The warm-up's placement mission, before and after the anchor.
  { name: 'mission-trap', ms: 0, mission: 8 },
  { name: 'mission-trap-anchored', ms: 0, mission: 8, keys: '<CR>2j' },
  { name: 'death', ms: 600_000 },
];

if (!existsSync(CHROME)) {
  process.stderr.write(`shot: Chrome not found at ${CHROME}; set CHROME=/path/to/chrome\n`);
  process.exit(2);
}

// --- build ------------------------------------------------------------------
const build = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
const bundle = /src="([^"]+\.js)"/.exec(indexHtml)?.[1];
if (!bundle) { process.stderr.write('shot: could not find the bundle in dist/index.html\n'); process.exit(1); }

// --- the driver page ----------------------------------------------------------
// Waits for the module to install window.__motd, then starts, fast-forwards,
// optionally sets HP and types a pending command, and freezes time.
const driver = `<!doctype html><html><head><meta charset="utf-8"><title>shot</title>
<style>html,body{margin:0;height:100%;background:#0a0a0c;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
<script type="module" crossorigin src="${bundle}"></script>
<script>
const q = new URLSearchParams(location.search);
const ms = +(q.get('ms') || 0), hp = q.get('hp'), keys = q.get('keys') || '', title = q.has('title');
const shop = q.has('shop');
const mission = q.get('mission');
function go() {
  const m = window.__motd;
  if (!m) { setTimeout(go, 20); return; }
  // On the menu there is nothing to start; the keys drive the menu itself.
  if (title) { if (keys) m.keys(keys); return; }
  if (mission !== null) {
    m.game.sim.startMission(+mission - 1);
    if (keys) m.keys(keys);
    m.pause(true);
    return;
  }
  m.start(); m.step(ms);
  if (hp !== null) m.game.sim.state.barricade.hp = +hp;
  if (shop) {
    // Clear the night the way killing everything would, then let the tick
    // notice: the store opens through the real wave-clear path.
    const st = m.json();
    st.sim.spawnQueue.length = 0;
    st.buffer.zombies.length = 0;
    st.sim.resolvedThisWave = 1;
    m.step(20);
    st.supplies = 240;
  }
  if (keys) m.keys(keys);
  m.pause(true);
}
setTimeout(go, 50);
</script></head><body><canvas id="screen"></canvas></body></html>`;
const driverPath = join(DIST, 'shot.html');
writeFileSync(driverPath, driver);

// --- static server ------------------------------------------------------------
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const file = join(DIST, url === '/' ? 'index.html' : url);
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise<void>((ok) => server.listen(PORT, ok));

// --- shoot ----------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
let failed = 0;
try {
  for (const s of SHOTS) {
    if (only && !s.name.includes(only)) continue;
    const qs = new URLSearchParams({ agent: '', seed: String(SEED), ms: String(s.ms) });
    if (s.hp !== undefined) qs.set('hp', String(s.hp));
    if (s.keys) qs.set('keys', s.keys);
    if (s.title) qs.set('title', '');
    if (s.shop) qs.set('shop', '');
    if (s.mission !== undefined) qs.set('mission', String(s.mission));
    const url = `http://localhost:${PORT}/shot.html?${qs.toString()}`;
    const png = join(OUT, `${s.name}.png`);
    // async: the static server runs on this event loop, so Chrome must not be
    // awaited synchronously or the page request deadlocks.
    const status = await new Promise<number>((done) => {
      const p = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        `--window-size=${W},${H}`, '--virtual-time-budget=2500',
        `--screenshot=${png}`, url,
      ], { stdio: 'ignore' });
      const t = setTimeout(() => { p.kill('SIGKILL'); done(-1); }, 30_000);
      p.on('close', (code) => { clearTimeout(t); done(code ?? -1); });
    });
    const ok = status === 0 && existsSync(png) && statSync(png).size > 10_000;
    if (!ok) failed++;
    process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${s.name}.png\n`);
  }
} finally {
  unlinkSync(driverPath);
  server.close();
}
const shot = SHOTS.filter((s) => !only || s.name.includes(only)).length;
process.stdout.write(`${shot - failed}/${shot} shots -> ${OUT}\n`);
process.exit(failed ? 1 : 0);
