// Phase Z — wiring. Canvas, RAF, keyboard, and the agent hook.
import { Game } from './harness/api';
import { Renderer, PALETTE } from './render/renderer';
import { Audio as GameAudio } from './audio/audio';
import { Ledger } from './ui/ledger';
import { MissionDemo } from './ui/missiondemo';
import type { MenuAction } from './ui/menu';
import { Screens } from './ui/screens';
import { SaveScreen } from './ui/savescreen';
import { cycleGore, cycleLineNumbers, loadSettings, saveSettings } from './ui/settings';
import {
  E482_CLIPBOARD, E484_OPEN, E485_READ, SaveStore, clearSuspended, exportFilename, exportSave,
  importSave, load as loadSave, merge, recordMission, suspendRun,
} from './save/save';
import type { SuspendedRun } from './save/schema';
import { MISSIONS, firstUnstarred } from './sim/missions';
import type { GameState } from './core/state';
import { format, log } from './core/log';
import { watch } from './core/watch';
import { keyToken } from './ui/keys';

const canvas = document.getElementById('screen') as HTMLCanvasElement;

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) : (Date.now() & 0x7fffffff);

// ---------------------------------------------------------------- logging
// `?debug=1` turns the play-by-play on. Without it the log keeps info and
// worse, which is enough to answer "why did that run end" after the fact:
// every breach, every night, and every command that silently did nothing.
// The ring is always kept - it costs nothing and it is the whole point - and
// the console sink is what the flag really controls.
const debug = params.has('debug') && params.get('debug') !== '0';
log.useClock(() => performance.now());
log.setLevel(debug ? 'debug' : 'info');
log.setSink((e) => {
  const line = format(e);
  if (e.level === 'error') console.error(line);
  else if (e.level === 'warn') console.warn(line);
  else if (e.level === 'info') console.info(line);
  else console.debug(line);
});

const game = new Game(seed, { autoStart: false });
watch(game.bus, () => game.json());
log.info('boot', 'motions of the dead', { seed, debug });
const renderer = new Renderer(canvas, game.bus);
const audio = new GameAudio(game.bus);
// One store, one write path. Everything that persists goes through it.
const store = new SaveStore(loadSave());
const ledger = new Ledger(game.json(), game.bus, store);
const screens = new Screens(ledger);
const saveScreen = new SaveScreen();
// One Menu, shared with the harness hook so an agent and a player drive the
// same cursor and the same screen stack.
const menu = game.menu;
// The mission select screen's right pane. Its own Sim, its own engine; it
// never touches the live GameState.
const demo = new MissionDemo();
// The list opens on the first mission without stars, and a mission reaching
// DONE writes its stars and best through the one store (DECISIONS #93).
menu.pickMission = () => firstUnstarred(store.get().missions);
game.bus.on('mission_done', (e) => recordMission(store, e.id, e.keys, e.stars));
// A run on hold shows on the menu as the `resume` row (DECISIONS #96).
function syncSuspended(): void {
  const run = store.get().suspended;
  menu.suspended = run ? { night: run.night, score: run.score } : null;
}
syncSuspended();
const settings = loadSettings(store);
renderer.gore = settings.gore;
renderer.lineNumbers = settings.lineNumbers;

let paused = false;      // the pause/options card
let frozen = false;      // the agent hook's `pause`, which stops time entirely
let last = performance.now();

// Debounced writes lose the last second on a hard crash; these cover tab close,
// navigation and backgrounding, which is everything that happens on purpose.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});
window.addEventListener('beforeunload', () => { store.flush(); });

// ------------------------------------------------------- save transfer (DOM)
// src/ui draws the save screen and nothing else; the three elements it needs
// live in index.html and are driven from here.

const downloadAnchor = document.getElementById('save-download') as HTMLAnchorElement | null;
const filePicker = document.getElementById('save-file') as HTMLInputElement | null;
const pasteBox = document.getElementById('save-paste') as HTMLTextAreaElement | null;
/** True while the hidden textarea holds the keyboard, waiting for a paste. */
let pasteWaiting = false;

function exportToFile(): void {
  if (!downloadAnchor) { saveScreen.fail(E484_OPEN, 'no download element'); return; }
  try {
    const url = URL.createObjectURL(
      new Blob([exportSave(store.get())], { type: 'application/json' }));
    const name = exportFilename();
    downloadAnchor.href = url;
    downloadAnchor.download = name;
    downloadAnchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    saveScreen.say(`saved ${name}`);
  } catch { saveScreen.fail(E484_OPEN, 'download blocked'); }
}

function exportToClipboard(): void {
  const clip = navigator.clipboard;
  if (!clip?.writeText) { saveScreen.fail(E482_CLIPBOARD); return; }
  clip.writeText(exportSave(store.get())).then(
    () => saveScreen.say('copied'),
    () => saveScreen.fail(E482_CLIPBOARD),
  );
}

function importFromFile(): void {
  if (!filePicker) { saveScreen.fail(E484_OPEN, 'no file picker'); return; }
  filePicker.value = '';
  filePicker.click();
}

filePicker?.addEventListener('change', () => {
  const file = filePicker.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => saveScreen.fail(E484_OPEN, file.name);
  reader.onload = () => saveScreen.offer(importSave(String(reader.result ?? ''), store.get()));
  try { reader.readAsText(file); } catch { saveScreen.fail(E484_OPEN, file.name); }
});

/** Firefox gates readText behind a permission; the textarea is the fallback. */
function importFromPaste(): void {
  const clip = navigator.clipboard;
  if (clip?.readText) {
    clip.readText().then(
      (text) => saveScreen.offer(importSave(text, store.get())),
      () => beginPaste(),
    );
    return;
  }
  beginPaste();
}

function beginPaste(): void {
  if (!pasteBox) { saveScreen.fail(E485_READ, 'clipboard blocked'); return; }
  pasteBox.value = '';
  pasteWaiting = true;
  pasteBox.focus();
  saveScreen.say('paste, then Enter');
}

function endPaste(): void {
  pasteWaiting = false;
  pasteBox?.blur();
  canvas.focus();
}

function submitPaste(): void {
  const text = pasteBox?.value ?? '';
  endPaste();
  saveScreen.offer(importSave(text, store.get()));
}

/** The one place the local save is allowed to change from an import. */
function applyImport(): void {
  const incoming = saveScreen.incoming;
  if (!incoming) return;
  const mode = saveScreen.mode;
  const merged = merge(store.get(), incoming.save, mode);
  store.replace(merged);
  store.flush();
  // The Ledger reads straight through the store, so it needs nothing; the
  // renderer holds copies of two settings and does.
  const next = loadSettings(store);
  settings.gore = next.gore;
  settings.lineNumbers = next.lineNumbers;
  settings.equipped = next.equipped;
  renderer.gore = settings.gore;
  renderer.lineNumbers = settings.lineNumbers;
  syncSuspended();
  saveScreen.reset();
  saveScreen.say(`${mode === 'merge' ? 'merged' : 'replaced'}`
    + ` - high score ${merged.lifetime.highScore}`);
}

function closeSaveScreen(): void {
  if (pasteWaiting) endPaste();
  saveScreen.reset();
  if (menu.screen === 'save') menu.back();
}

function feedSaveScreen(key: string): void {
  switch (saveScreen.feedKey(key)) {
    case 'export-file': exportToFile(); break;
    case 'export-clipboard': exportToClipboard(); break;
    case 'import-file': importFromFile(); break;
    case 'import-paste': importFromPaste(); break;
    case 'confirm': applyImport(); break;
    case 'cancel': break;
    case 'back': closeSaveScreen(); break;
    default: break;
  }
}

/** Everything a menu row can ask for. The Menu itself owns the screen stack. */
function runMenuAction(a: MenuAction): void {
  if (!a) return;
  switch (a.t) {
    case 'start':
      screens.resetRun();
      game.engine.reset();
      menu.reset();
      game.sim.start(a.mode);
      break;
    case 'mission':
      screens.resetRun();
      game.engine.reset();
      menu.reset();
      game.sim.startMission(a.index);
      break;
    case 'screen':
      // The save card is drawn by SaveScreen, which places no menu rows, so
      // the click map has to be cleared by hand on the way in and out.
      if (a.screen === 'save') { saveScreen.reset(); screens.clearMenuRows(); }
      else if (pasteWaiting) endPaste();
      break;
    case 'resume': resumeRun(); break;
    case 'option': applyOption(a.what); break;
    case 'save-key': feedSaveScreen(a.key); break;
    case 'note': break;              // the Menu already posted the line
    default: break;
  }
}

/**
 * A survival run can be put down at the pause card and picked up from the menu
 * (DECISIONS #96). Only survival: a mission is a minute long and `r` restarts
 * it, and its keys are counted against par.
 */
function canSuspend(state: GameState): boolean {
  return state.sim.mode === 'survival' && state.sim.mission < 0
    && (state.phase === 'playing' || state.phase === 'shop');
}

/** `w` on the pause card: write the run down, flush it, and leave for the menu. */
function suspendCurrentRun(): void {
  const state = game.json();
  if (!canSuspend(state)) return;
  const snap = game.sim.snapshot();
  suspendRun(store, snap.state, snap.progress);
  store.flush();
  log.info('run', `suspended at night ${state.wave}`, { score: state.score });
  paused = false;
  menu.reset();
  game.sim.toMenu();
  syncSuspended();
}

/**
 * The `resume` row. The slot is cleared the moment the run is back on the
 * field, so a night cannot be replayed from the same save; a snapshot the
 * sim will not take is dropped with a line on the menu rather than a crash.
 */
function resumeRun(): void {
  const run: SuspendedRun | null = store.get().suspended;
  if (!run) return;
  try {
    screens.resetRun();
    menu.reset();
    game.restore(run.state as unknown as GameState, run.progress);
    ledger.beginRun();
    log.info('run', `resumed at night ${run.night}`, { score: run.score });
  } catch (err) {
    log.warn('run', 'suspended run could not be restored', { err: String(err) });
    menu.message = 'E484: the saved run could not be read; it was dropped';
  }
  clearSuspended(store);
  store.flush();
  syncSuspended();
}

/** The pause card and the options screen share one set of toggles (D5). */
function applyOption(what: 'sound' | 'gore' | 'numbers'): void {
  switch (what) {
    case 'sound': toggleMute(); break;
    case 'gore':
      settings.gore = cycleGore(settings.gore);
      renderer.gore = settings.gore;
      saveSettings(store, settings);
      break;
    case 'numbers':
      settings.lineNumbers = cycleLineNumbers(settings.lineNumbers);
      renderer.lineNumbers = settings.lineNumbers;
      saveSettings(store, settings);
      break;
  }
}

// An unknown key is silent: no error wash, no chrome. Players fat-finger keys,
// and `v` (no visual mode) is the common one. We only count it, for the death
// line, and let the sim break the combo.
game.engine.onError = (key) => {
  screens.unknownKeys++;
  game.sim.unknownKey();
  void key;
};

// ---------------------------------------------------------------- keyboard

function toggleMute(): void { audio.toggleMute(); }

/** `title` is the old name for `menu` and still renders as one (DECISIONS #56). */
function inMenu(phase: string): boolean { return phase === 'menu' || phase === 'title'; }

/**
 * What the placement strip teaches, if anything: a plant mission's own title
 * and hint while it is running, otherwise the survey-grid explainer until
 * this run has actually planted something.
 */
function placementTeach(state: GameState): readonly string[] {
  const sm = state.sim;
  const m = sm.mission >= 0 ? MISSIONS[sm.mission] : undefined;
  if (m) return [`MISSION  ${m.title}`, m.hint, 'r  start over'];
  const p = sm.purchases;
  const planted = p.tripwire + p.fence + p.minefield + p.wire;
  return planted === 0 ? Screens.PLACE_FIRST : [];
}

window.addEventListener('keydown', (e) => {
  // Leave the browser's own shortcuts alone; grab everything else, including
  // `/`, `'`, space and the quick-find keys.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // The paste box owns the keyboard while it is focused, or the player cannot
  // type into it. Enter submits, Esc backs out; nothing else is ours.
  if (pasteWaiting) {
    if (e.key === 'Enter') { e.preventDefault(); submitPaste(); }
    else if (e.key === 'Escape') { e.preventDefault(); endPaste(); }
    return;
  }
  e.preventDefault();

  // One event, one token. A bare modifier is not a keystroke; a named key like
  // `ArrowDown` is a single unknown key, never a run of letters (DECISIONS #90).
  const key = keyToken(e.key);
  if (key === null) return;
  audio.unlock();
  audio.keyClick(key);

  // There is no global mute key. Sound lives on the pause card (Esc), because
  // every letter worth binding is already a Vim motion.
  if (paused) {
    const act = screens.feedPauseKey(key);
    switch (act) {
      case 'resume': paused = false; break;
      case 'sound':
      case 'gore':
      case 'numbers': applyOption(act); break;
      case 'menu': paused = false; menu.reset(); game.sim.toMenu(); break;
      case 'suspend': suspendCurrentRun(); break;
      default: break;
    }
    return;
  }

  const state = game.json();
  const phase = state.phase;
  if (inMenu(phase)) { runMenuAction(menu.feed(key)); return; }
  if (phase === 'dead') {
    const action = screens.feedDeathKey(key);
    if (action === 'restart') { screens.resetRun(); game.engine.reset(); game.sim.start(); }
    // `Esc` is the quiet way out; `:q!` is still the joke.
    else if (action === 'menu' || (key === '<Esc>' && screens.cmdline === '')) {
      menu.reset();
      game.sim.toMenu();
    }
    return;
  }

  // The store. Every key goes through `game.keys()`, which is what keeps the
  // browser and the headless harness on one path (DECISIONS #77) - so a
  // recorded shopping trip replays through `dist/` byte for byte.
  // Between nights is the natural place to stop for the day, so `<Esc>` on
  // the store's list opens the pause card here; headless it still does
  // nothing, and in placement it still cancels (DECISIONS #96).
  if (phase === 'shop') {
    if (key === '<Esc>' && state.sim.shop.mode === 'list' && state.sim.mission < 0) { paused = true; return; }
    game.keys(key);
    return;
  }

  // A mission owns its keys: `r` retries, and on DONE `n` / `r` / Esc go
  // through `game.keys` exactly as they do headless (DECISIONS #93). Esc with
  // nothing pending still pauses during TRY.
  if (state.sim.mission >= 0) {
    if (state.sim.missionBeat === 'try' && key === '<Esc>' && game.pending() === '') { paused = true; return; }
    game.keys(key);
    return;
  }
  // Playing. Esc clears a half-typed command; Esc with nothing pending pauses.
  if (key === '<Esc>' && game.pending() === '') { paused = true; return; }
  game.keys(key);
}, { passive: false });

// Mouse selection. Pixels -> a cell row via the renderer's own metrics, then
// the row index the last draw actually placed there (DECISIONS #59). No DOM
// element is added, so the mock-canvas replay stays valid.
canvas.addEventListener('click', (e) => {
  audio.unlock();
  canvas.focus();
  if (paused || !inMenu(game.json().phase)) return;
  const m = renderer.metrics();
  const rect = canvas.getBoundingClientRect();
  const cellRow = Math.floor((e.clientY - rect.top - m.oy) / m.ch);
  const i = screens.menuHit(cellRow);
  if (i < 0) return;
  runMenuAction(menu.click(i));
});
window.addEventListener('blur', () => {
  const p = game.json().phase;
  if (p === 'playing' || p === 'shop') paused = true;
});
window.addEventListener('resize', () => renderer.resize());
renderer.resize();

// ---------------------------------------------------------------- loop

/** The last phase drawn, so a transition can be logged exactly once. */
let lastPhase = '';

function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;

  const state = game.json();
  // `phase` is not an event, and it is the first thing you want to know when
  // a run "just ended": whether it went to `dead` or somewhere else entirely.
  if (state.phase !== lastPhase) {
    log.info('run', `phase ${lastPhase || '(none)'} -> ${state.phase}`, {
      night: state.wave,
      wall: `${Math.ceil(state.barricade.hp)}/${state.barricade.maxHp}`,
    });
    lastPhase = state.phase;
  }
  const halted = paused || frozen;
  if (!halted) game.step(dt);
  audio.update(halted ? 0 : dt);

  renderer.pendingCmd = game.pending();
  renderer.paused = paused;
  renderer.muted = audio.muted;
  renderer.beginFrame(dt);
  if (inMenu(state.phase)) {
    // Show the field behind the menu — an empty barricade at night is the
    // best thing this game has to look at.
    renderer.drawGame(state);
    renderer.overlay(PALETTE.bg, 0.55);
    switch (menu.screen) {
      case 'missions':
        // The pane follows the cursor and plays on the frame clock.
        demo.sync(menu.cursor);
        if (!halted) demo.advance(dt);
        screens.drawMissions(renderer, menu, demo, store.get().missions);
        break;
      case 'options': screens.drawOptions(renderer, menu, audio.muted, settings); break;
      case 'ledger': screens.drawLedgerScreen(renderer, menu); break;
      case 'about': screens.drawAbout(renderer, menu); break;
      case 'save': saveScreen.draw(renderer, store.get()); break;
      default: screens.drawMenu(renderer, menu, now); break;
    }
  } else {
    // A mission that teaches a counted or absolute motion needs its count
    // printed in the gutter; `off` still wins, because that was a deliberate
    // choice.
    const m = state.phase === 'playing' && state.sim.mission >= 0 ? MISSIONS[state.sim.mission] : undefined;
    renderer.lineNumbers = m?.gutter && settings.lineNumbers !== 'off'
      ? m.gutter : settings.lineNumbers;
    renderer.drawGame(state);
    if (state.phase === 'shop') {
      // Placing shows the strip, not the card: the survey grid the renderer
      // draws on the field is the thing you need to see. The strip's teaching
      // region is a plant mission's only home - one panel on those rows,
      // not two fighting for them (DECISIONS #85).
      if (state.sim.shop.mode === 'place') {
        screens.drawPlacement(renderer, state, placementTeach(state));
      } else {
        screens.drawStore(renderer, state, now);
      }
    }
    else if (state.phase === 'playing' && state.sim.mission >= 0) screens.drawMissionStrip(renderer, state);
    else if (state.phase === 'playing' && state.sim.breather > 0) {
      screens.drawWaveCard(renderer, state, store.get().missions);
    }
    if (state.phase === 'dead') screens.drawDeath(renderer, state);
    if (paused) screens.drawPause(renderer, audio.muted, settings, canSuspend(state));
  }
  renderer.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- agent hook

const agentMode = import.meta.env.DEV || params.has('agent');
if (agentMode) {
  (window as unknown as Record<string, unknown>).__motd = {
    game,
    text: () => game.text(),
    json: () => game.json(),
    keys: (s: string) => game.keys(s),
    step: (ms: number) => game.step(ms),
    pause: (v = true) => { frozen = v; },
    start: () => game.sim.start(),
    menu,
    // The bug report. `__motd.logs()` after a run ends is the whole story;
    // `__motd.logLevel('debug')` turns the play-by-play on without a reload.
    logs: (n?: number) => log.dump(n),
    logLevel: (l: 'error' | 'warn' | 'info' | 'debug') => log.setLevel(l),
  };
}
