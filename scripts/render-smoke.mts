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
const { Renderer, PALETTE, PAGE_TURN_MS } = await import('../src/render/renderer.js');
const { Ledger } = await import('../src/ui/ledger.js');
const { Screens } = await import('../src/ui/screens.js');
const { SaveScreen } = await import('../src/ui/savescreen.js');
const { ABOUT_PAGES } = await import('../src/ui/about.js');
const { MissionDemo } = await import('../src/ui/missiondemo.js');
const { DEMO_KEY_MS, MISSIONS } = await import('../src/sim/missions.js');
const { SaveStore, exportSave, importSave } = await import('../src/save/save.js');
const { defaultSave } = await import('../src/save/schema.js');
const { optimalKill } = await import('../src/sim/optimal.js');
const { MULTI_KILL_NAMES, MULTI_KILL_BONUS, PERFECT, SNIPE, STYLE_BONUS } = await import('../src/sim/medals.js');
const { loadSettings } = await import('../src/ui/settings.js');

type Gore = 'off' | 'low' | 'full';
let frames = 0;

type Nums = 'off' | 'absolute' | 'relative';

function session(w: number, h: number, gore: Gore, nums: Nums, seed: number, maxFrames: number): string {
  const canvas = mkCanvas(w, h);
  const game = new Game(seed, { autoStart: false });
  const r = new Renderer(canvas as any, game.bus);
  const store = new SaveStore(defaultSave());
  const ledger = new Ledger(game.json(), game.bus, store);
  const screens = new Screens(ledger);
  const settings = loadSettings(store);
  settings.gore = gore;
  settings.lineNumbers = nums;
  r.gore = gore;
  r.lineNumbers = nums;
  game.engine.onError = () => { screens.unknownKeys++; game.sim.unknownKey(); };
  r.resize();

  let paused = false;
  // The save card is `SaveScreen` and the demo pane a `MissionDemo`, exactly
  // as in main.ts.
  const saveCard = new SaveScreen();
  const demo = new MissionDemo();
  // The same choice main.ts makes: a plant mission's title and hint, or the
  // survey-grid explainer until this run has planted something.
  const placeTeach = (st: ReturnType<typeof game.json>): readonly string[] => {
    const m = st.sim.mission >= 0 ? MISSIONS[st.sim.mission] : undefined;
    if (m) return [`MISSION  ${m.title}`, m.hint, 'r  start over'];
    const p = st.sim.purchases;
    return p.tripwire + p.fence + p.minefield + p.wire === 0 ? Screens.PLACE_FIRST : [];
  };

  const draw = (now: number) => {
    const st = game.json();
    r.pendingCmd = game.pending();
    r.paused = paused;
    r.muted = false;
    r.beginFrame(16.67);
    if (st.phase === 'menu' || st.phase === 'title') {
      r.overlay(PALETTE.bg, 1);
      switch (game.menu.screen) {
        case 'missions':
          demo.sync(game.menu.cursor);
          demo.advance(16.67);
          screens.drawMissions(r, game.menu, demo);
          break;
        case 'options': screens.drawOptions(r, game.menu, false, settings); break;
        case 'ledger': screens.drawLedgerScreen(r, game.menu); break;
        case 'about': screens.drawAbout(r, game.menu); break;
        case 'save': saveCard.draw(r, store.get()); break;
        default: screens.drawMenu(r, game.menu, now); break;
      }
    }
    else {
      r.drawGame(st);
      if (st.phase === 'shop') {
        if (st.sim.shop.mode === 'place') screens.drawPlacement(r, st, placeTeach(st));
        else screens.drawStore(r, st, now);
      }
      else if (st.phase === 'playing' && st.sim.mission >= 0) screens.drawMissionStrip(r, st);
      else if (st.phase === 'playing' && st.sim.breather > 0) screens.drawWaveCard(r, st);
      if (st.phase === 'dead') screens.drawDeath(r, st);
      if (paused) screens.drawPause(r, false, settings);
    }
    r.endFrame();
    frames++;
  };

  // --- the menu and its sub-screens, driven by the real key matcher --------
  // `draw` dispatches on game.menu.screen, so walking the menu with keys()
  // exercises every card the same way a player would reach it.
  for (let i = 0; i < 40; i++) draw(i * 16.67);        // the main menu
  game.keys('jjj');                                    // onto a `soon` row
  game.keys('<CR>');                                   // and its note
  draw(0);
  game.keys('/xyz<CR>');                               // an E486 in the footer
  draw(0);
  game.keys('/dr');                                    // a live search prompt
  draw(0);
  game.keys('<Esc>');
  game.keys('99');                                     // a pending count
  draw(0);
  game.keys('<Esc>');

  // The mission list, with every demo played right through at least one loop.
  game.keys('gg');                                     // back to the top row
  game.keys('j<CR>');                                  // the `missions` row
  for (let i = 0; i < MISSIONS.length; i++) {
    const keys = MISSIONS[i].demo.keys.length + 8;
    for (let f = 0; f < keys; f++) { draw(f * 16.67); demo.advance(DEMO_KEY_MS); }
    if (i < MISSIONS.length - 1) game.keys('j');
  }
  game.keys('gg');                                     // scroll back to the top
  draw(0);
  game.keys('}}');                                     // two sections down
  draw(0);
  game.keys('/lane<CR>');                              // search inside the list
  draw(0);
  game.keys('h');
  const listOut: string = game.menu.screen;
  if (listOut !== 'main') throw new Error(`mission list did not unwind (${listOut})`);

  game.keys('5G<CR>');                                 // ledger, fresh profile
  for (let i = 0; i < 4; i++) draw(i * 16.67);
  store.get().lifetime.highScore = 9_999_999_999;
  store.get().lifetime.kills = 9_999_999_999;
  store.get().lifetime.runs = Array.from({ length: 40 }, (_, i) => ({
    at: i, wave: 33, score: 9_999_999, kills: 99_999, keystrokes: 400_000, kpk: 999.99,
  }));
  for (const tok of ['di(', 'ca"', 'd3w', 'dd', 'D', 'f', 'gg']) {
    store.get().lifetime.motions[tok] = { used: 999_999, kills: 999_999 };
    store.get().lifetime.missed[tok] = 999_999;
  }
  for (let i = 0; i < 4; i++) draw(i * 16.67);          // ledger, loaded
  game.keys('h');

  game.keys('6G<CR>');                                 // options
  for (const gl of ['full', 'low', 'off'] as const) {
    for (const nl of ['relative', 'absolute', 'off'] as const) {
      settings.gore = gl;
      settings.lineNumbers = nl;
      for (let i = 0; i < 3; i++) { draw(i * 16.67); game.keys('j'); }
    }
  }
  settings.gore = gore;
  settings.lineNumbers = nums;
  game.keys('h');

  game.keys('7G<CR>');                                 // save
  for (let i = 0; i < 4; i++) draw(i * 16.67);
  game.keys('h');

  game.keys('G<CR>');                                  // about, every page
  for (let i = 0; i < ABOUT_PAGES.length; i++) { draw(i * 16.67); game.keys('j'); }
  game.keys('h');
  const unwound: string = game.menu.screen;
  if (unwound !== 'main') throw new Error(`menu did not unwind (${unwound})`);
  game.keys('gg');
  draw(0);

  // Walk every mission first: TRY with the oracle, the GOOD hold, the DONE
  // strip, then `n` into the next; the last one's `n` lands on the menu.
  game.sim.startMission(0);
  let tg = 0;
  while (game.json().sim.mission >= 0 && tg++ < 6000) {
    const st = game.json();
    if (st.sim.missionBeat === 'done') {
      for (let i = 0; i < 3; i++) draw(tg * 16.67);
      game.keys('n');
      draw(tg * 16.67);
      continue;
    }
    // The placement mission cannot be killed through: anchor, reach two lanes
    // down, plant. Drawn key by key so the strip and the span highlight are
    // both exercised through the real draw path.
    if (st.phase === 'shop' && st.sim.shop.mode === 'place') {
      for (const k of ['<CR>', '2j', '<CR>']) { game.keys(k); draw(tg * 16.67); }
      continue;
    }
    const zs = st.buffer.zombies;
    if (st.sim.missionHold > 0 || !zs.length) { game.step(100); draw(tg * 16.67); continue; }
    const z = zs[zs.length - 1];
    const o = optimalKill(st.buffer, st.cursor, z, st.charges);
    if (o) game.keys(o.keys);
    else if (MISSIONS[st.sim.mission].goal === 'reach') game.keys('$');
    if (tg % 37 === 0) game.keys('r');                  // the panic button
    game.step(120);
    draw(tg * 16.67);
  }
  if (game.json().phase !== 'menu') throw new Error(`missions did not end on the menu (${game.json().phase})`);
  for (let i = 0; i < 4; i++) draw(i * 16.67);
  game.sim.start();

  // --- medal callouts, at the top of the ladder and at full stack ----------
  // Natural play earns PERFECT constantly and a KILLIONAIRE almost never, so
  // the stack is forced here: three max-tier callouts at once, then a mixed
  // stack arriving over three frames, drawn right through their lifetime.
  const top = MULTI_KILL_NAMES.length - 1;
  const medal = (name: string, bonus: number) => game.bus.emit({ t: 'medal', name, bonus });
  let mt = 0;
  for (let i = 0; i < 3; i++) medal(MULTI_KILL_NAMES[top], MULTI_KILL_BONUS[top]);
  for (let i = 0; i < 75; i++) { draw(mt); mt += 16.67; }         // ~1250ms, one full life
  for (const [name, bonus] of [
    [MULTI_KILL_NAMES[top], MULTI_KILL_BONUS[top]],
    [PERFECT, STYLE_BONUS[PERFECT]],
    [SNIPE, STYLE_BONUS[SNIPE]],
  ] as const) {
    medal(name, bonus);
    for (let i = 0; i < 6; i++) { draw(mt); mt += 16.67; }
  }
  for (let i = 0; i < 80; i++) { draw(mt); mt += 16.67; }
  // and a fourth arriving while three are up, which drops the oldest
  for (const name of MULTI_KILL_NAMES) { medal(name, 10); draw(mt); mt += 16.67; }
  for (let i = 0; i < 75; i++) { draw(mt); mt += 16.67; }

  let t = 0;
  let n = 0;
  /**
   * The store, drawn the way it is reached: a walk down the list, a placement
   * with an anchor and a span, then out. Every key goes through `keys()`, so
   * this exercises the real card, the survey grid and the trap glyphs.
   */
  const shopTrip = (): void => {
    game.json().supplies += 400;             // enough to place something
    // The page turn is a full-viewport canvas sweep; hold still through the
    // whole of it so every frame of it goes through the real draw path.
    for (let i = 0; i * 16.67 <= PAGE_TURN_MS + 40; i++) { draw(t); t += 16.67; n++; }
    const keys = ['j', 'j', '3j', 'G', 'gg', '13j', 'l', 'gg', '10j', 'l',
      '4G', 'f2', '<CR>', '3j', '<CR>', 'n'];
    for (const k of keys) {
      game.keys(k);
      draw(t); t += 16.67; n++;
    }
  };

  while (!game.isOver() && n < maxFrames) {
    const st = game.json();
    if (st.phase === 'shop') { shopTrip(); continue; }
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

  // --- the save screen, every state it can be in ---------------------------
  const saveScreen = saveCard;
  const drawSave = (label: string) => {
    r.beginFrame(16.67);
    r.overlay(PALETTE.bg, 1);
    saveScreen.draw(r, store.get());
    r.endFrame();
    frames++;
    void label;
  };
  drawSave('actions');
  saveScreen.say('copied');
  drawSave('actions + copied');
  saveScreen.fail("E482: Can't create file (clipboard blocked)");
  drawSave('actions + clipboard error');
  saveScreen.fail("E485: Can't read file", 'checksum mismatch');
  drawSave('actions + checksum error');

  // A confirmation card fed by the real export/import path.
  const big = store.get();
  big.lifetime.highScore = 9_999_999_999;
  big.lifetime.kills = 9_999_999;
  big.unlocks = Array.from({ length: 40 }, (_, i) => `cosmetic-${i}`);
  saveScreen.offer(importSave(exportSave(big), big));       // own backup
  drawSave('confirm (own backup)');
  saveScreen.mode = 'merge';
  drawSave('confirm (merge highlighted)');
  const other = defaultSave();
  other.version = 2;
  other.lifetime.highScore = 1234;
  saveScreen.offer(importSave(exportSave(other), big));     // newer format
  drawSave('confirm (newer format)');
  saveScreen.reset();

  // and once through the menu's own dispatch, which is how a player gets here
  game.sim.toMenu();
  game.keys('7G<CR>');                                 // save is the seventh row
  const opened: string = game.menu.screen;
  if (opened !== 'save') throw new Error(`the save row did not open the save screen (${opened})`);
  for (let i = 0; i < 4; i++) draw(i * 16.67);
  game.keys('h');

  return `${w}x${h} gore=${gore} nums=${nums} seed=${seed}: wave ${game.json().wave}, ${game.json().sim.kills} kills, dead=${game.isOver()}`;
}

const lines: string[] = [];
lines.push(session(1600, 900, 'full', 'relative', 1, 4000));
lines.push(session(320, 240, 'low', 'absolute', 2, 400));
lines.push(session(3840, 2160, 'off', 'off', 3, 400));
lines.push(session(1280, 720, 'full', 'absolute', 4, 400));

// --- frame-time guard: 40 zombies, no particles ---------------------------
// The fake ctx is a Proxy, so this measures the renderer's own JS cost, not
// the GPU. It catches a per-frame allocation or an op-count explosion in the
// figure / wall paths. Budget: 8 ms average over 120 frames at 1600x900.
function crowd(): { avgMs: number; opsPerFrame: number } {
  const canvas = mkCanvas(1600, 900);
  const game = new Game(11, { autoStart: true });
  const r = new Renderer(canvas as any, game.bus);
  r.resize();
  game.step(3000);
  const st = game.json();
  const zs = st.buffer.zombies;
  zs.length = 0;
  const kinds = ['walker', 'runner', 'armored', 'bloater', 'crawler'] as const;
  const words = ['shamble', 'spit', '(lurch)', 'putrescent', 'z'];
  for (let i = 0; i < 40; i++) {
    const k = i % 5;
    zs.push({ id: 1000 + i, kind: kinds[k], row: i % 16, col: 2 + ((i * 7) % 44), text: words[k], hp: 1, speed: 1 });
  }
  const before = [...calls.values()].reduce((a, b) => a + b, 0);
  const frames = 120;
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    r.beginFrame(16.67);
    r.drawGame(st);
    r.endFrame();
  }
  const ms = performance.now() - t0;
  const after = [...calls.values()].reduce((a, b) => a + b, 0);
  return { avgMs: ms / frames, opsPerFrame: (after - before) / frames };
}
const c = crowd();
lines.push(`crowd 40 zombies: ${c.avgMs.toFixed(2)} ms/frame, ${c.opsPerFrame | 0} ctx ops/frame`);
if (c.avgMs > 8) problems.push(`frame-time guard: ${c.avgMs.toFixed(2)} ms/frame with 40 zombies exceeds 8 ms`);

for (const l of lines) process.stdout.write(l + '\n');
process.stdout.write(`frames drawn: ${frames}   ctx ops: ${[...calls.values()].reduce((a, b) => a + b, 0)}   max save depth: ${maxDepth}\n`);
if (depth !== 0) problems.push(`unbalanced save/restore: depth ended at ${depth}`);
if (problems.length) {
  for (const p of problems.slice(0, 10)) process.stderr.write(`FAIL ${p}\n`);
  process.stderr.write(`FAIL ${problems.length} rendering problem(s)\n`);
  process.exit(1);
}
process.stdout.write(`OK: renderer + UI survive the menu, the mission list and all ${MISSIONS.length} demos,`
  + ' the options / ledger / save screens, every mission, play, pause and death'
  + ' at 4 sizes, 3 gore levels and 3 gutter modes\n');
