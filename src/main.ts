// Phase Z — wiring. Canvas, RAF, keyboard, and the agent hook.
import { Game } from './harness/api';
import { Renderer, PALETTE } from './render/renderer';
import { Audio as GameAudio } from './audio/audio';
import { Ledger } from './ui/ledger';
import { Screens } from './ui/screens';
import { cycleGore, cycleLineNumbers, loadSettings, saveSettings } from './ui/settings';
import { TUTORIAL } from './sim/tutorial';

const canvas = document.getElementById('screen') as HTMLCanvasElement;

const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam && /^\d+$/.test(seedParam) ? Number(seedParam) : (Date.now() & 0x7fffffff);

const game = new Game(seed, { autoStart: false });
const renderer = new Renderer(canvas, game.bus);
const audio = new GameAudio(game.bus);
const ledger = new Ledger(game.json(), game.bus);
const screens = new Screens(ledger);
const settings = loadSettings();
renderer.gore = settings.gore;
renderer.lineNumbers = settings.lineNumbers;

let paused = false;      // the pause/options card
let frozen = false;      // the agent hook's `pause`, which stops time entirely
let last = performance.now();

game.engine.onError = (key) => {
  screens.unknownKeys++;
  renderer.flashError();
  game.sim.unknownKey();
  void key;
};

// ---------------------------------------------------------------- keyboard

/** Browser KeyboardEvent -> the engine's token vocabulary. */
function normalize(e: KeyboardEvent): string {
  switch (e.key) {
    case 'Escape': return '<Esc>';
    case 'Enter': return '<CR>';
    case 'Backspace': return '<BS>';
    default: return e.key;
  }
}

function toggleMute(): void { audio.toggleMute(); }

window.addEventListener('keydown', (e) => {
  // Leave the browser's own shortcuts alone; grab everything else, including
  // `/`, `'`, space and the quick-find keys.
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();

  const key = normalize(e);
  audio.unlock();
  audio.keyClick(key);

  // There is no global mute key. Sound lives on the pause card (Esc), because
  // every letter worth binding is already a Vim motion.
  if (paused) {
    switch (screens.feedPauseKey(key)) {
      case 'resume': paused = false; break;
      case 'sound': toggleMute(); break;
      case 'gore':
        settings.gore = cycleGore(settings.gore);
        renderer.gore = settings.gore;
        saveSettings(settings);
        break;
      case 'numbers':
        settings.lineNumbers = cycleLineNumbers(settings.lineNumbers);
        renderer.lineNumbers = settings.lineNumbers;
        saveSettings(settings);
        break;
      case 'title': paused = false; game.sim.toTitle(); break;
      default: break;
    }
    return;
  }

  const state = game.json();
  const phase = state.phase;
  if (phase === 'title') {
    if (key === 'i') { screens.resetRun(); game.sim.start(); }
    if (key === 't') { screens.resetRun(); game.sim.startTutorial(); }
    return;
  }
  if (phase === 'dead') {
    const action = screens.feedDeathKey(key);
    if (action === 'restart') { screens.resetRun(); game.engine.reset(); game.sim.start(); }
    else if (key === 't' && screens.cmdline === '') { screens.resetRun(); game.engine.reset(); game.sim.startTutorial(); }
    else if (action === 'title') game.sim.toTitle();
    return;
  }

  // Playing. Esc clears a half-typed command; Esc with nothing pending pauses.
  if (key === '<Esc>' && game.pending() === '') { paused = true; return; }
  if (key === 'r' && state.sim.tutorial >= 0 && game.pending() === '') {
    game.engine.reset();
    game.sim.retryTutorialStep();
    return;
  }
  game.keys(key);
}, { passive: false });

canvas.addEventListener('click', () => { audio.unlock(); canvas.focus(); });
window.addEventListener('blur', () => { if (game.json().phase === 'playing') paused = true; });
window.addEventListener('resize', () => renderer.resize());
renderer.resize();

// ---------------------------------------------------------------- loop

function frame(now: number): void {
  const dt = Math.min(100, now - last);
  last = now;

  const state = game.json();
  const halted = paused || frozen;
  if (!halted) game.step(dt);
  audio.update(halted ? 0 : dt);

  renderer.pendingCmd = game.pending();
  renderer.paused = paused;
  renderer.muted = audio.muted;
  renderer.beginFrame(dt);
  if (state.phase === 'title') {
    // Show the field behind the title card — an empty barricade at night is
    // the best thing this game has to look at.
    renderer.drawGame(state);
    renderer.overlay(PALETTE.bg, 0.55);
    screens.drawTitle(renderer, now);
  } else {
    // A warm-up step that teaches `{n}G` needs the n visible next to each lane.
    const step = state.phase === 'playing' && state.sim.tutorial >= 0 ? TUTORIAL[state.sim.tutorial] : undefined;
    renderer.lineNumbers = step?.absoluteGutter && settings.lineNumbers !== 'off' ? 'absolute' : settings.lineNumbers;
    renderer.drawGame(state);
    if (state.phase === 'playing' && state.sim.tutorial >= 0) screens.drawTutorial(renderer, state);
    else if (state.phase === 'playing' && state.sim.breather > 0) screens.drawWaveCard(renderer, state);
    if (state.phase === 'dead') screens.drawDeath(renderer, state);
    if (paused) screens.drawPause(renderer, audio.muted, settings);
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
  };
}
