// Renders every raster icon and the social card from one source each, so no
// binary in `public/` is hand-made and all of them can be rebuilt:
//
//   npm run icons
//   CHROME=/path/to/chrome npm run icons
//
// `public/icon.svg` is the icon's source of truth. iOS needs a PNG for
// apple-touch-icon and Android's manifest wants PNG sizes, so those are baked
// from the SVG here rather than drawn twice. The social card's source is the
// HTML template below — the same palette and the same monospace face the game
// itself uses, so the card cannot drift from the art direction.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const PUBLIC = join(ROOT, 'public');
const CHROME = process.env.CHROME
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(CHROME)) {
  console.error(`chrome not found at ${CHROME}\nset CHROME=/path/to/chrome`);
  process.exit(1);
}
mkdirSync(PUBLIC, { recursive: true });

const work = join(tmpdir(), `motd-icons-${process.pid}`);
mkdirSync(work, { recursive: true });

function shoot(url: string, out: string, w: number, h: number): void {
  const r = spawnSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${w},${h}`,
    `--screenshot=${out}`,
    url,
  ], { stdio: 'pipe' });
  if (r.status !== 0 || !existsSync(out)) {
    console.error(r.stderr?.toString().slice(0, 400));
    throw new Error(`chrome failed for ${out}`);
  }
}

// --- the icon, at the sizes the platforms actually ask for ------------------
// The SVG is drawn into a page sized exactly to the target so Chrome rasterises
// it at full resolution rather than scaling a 512 bitmap down.
const ICON_SIZES = [180, 192, 512] as const;
const svgUrl = 'file://' + join(PUBLIC, 'icon.svg');

for (const n of ICON_SIZES) {
  const page = join(work, `icon-${n}.html`);
  writeFileSync(page, `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#0d1117}
img{display:block;width:${n}px;height:${n}px}</style>
<img src="${svgUrl}" width="${n}" height="${n}">`);
  const out = join(PUBLIC, `icon-${n}.png`);
  shoot('file://' + page, out, n, n);
  console.log(`ok   icon-${n}.png`);
}

// --- the social card --------------------------------------------------------
// 1200x630 is the size Open Graph and Twitter both render at.
const CARD_W = 1200;
const CARD_H = 630;
const card = join(work, 'card.html');
writeFileSync(card, `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:${CARD_W}px;height:${CARD_H}px;
    background:#0d1117;overflow:hidden}
  body{display:flex;flex-direction:column;justify-content:center;
    padding:0 82px;box-sizing:border-box;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  /* the night the game is set in: sky, treeline, field, lamp pool */
  .sky{position:absolute;inset:0 0 auto 0;height:190px;
    background:linear-gradient(#2b3446,#4a5568)}
  .trees{position:absolute;top:150px;left:0;right:0;height:52px;background:#161b26}
  .field{position:absolute;top:190px;left:0;right:0;bottom:0;
    background:linear-gradient(#3f5548 0%,#4d6a4c 55%,#2a3a2c 100%)}
  .pool{position:absolute;right:-120px;top:300px;width:760px;height:290px;
    border-radius:50%;
    background:radial-gradient(closest-side,rgba(242,230,190,.30),rgba(205,178,119,0))}
  .vig{position:absolute;inset:0;
    background:radial-gradient(120% 100% at 50% 52%,rgba(6,9,14,0) 30%,rgba(6,9,14,.86) 100%)}
  .wrap{position:relative;z-index:2}
  h1{margin:0;font-size:118px;line-height:.94;letter-spacing:.06em;
    font-weight:800;color:#c9cbbd;text-transform:uppercase}
  .rule{margin:22px 0 0;width:432px;height:11px;background:#5a1a18}
  .rule::after{content:"";display:block;margin-left:432px;margin-top:-11px;
    width:96px;height:6px;background:#4a1512}
  p{margin:30px 0 0;font-size:29px;color:#9aa0a6;letter-spacing:.02em}
  b{color:#e0a020;font-weight:600}
</style>
<div class="sky"></div><div class="trees"></div><div class="field"></div>
<div class="pool"></div><div class="vig"></div>
<div class="wrap">
  <h1>Motions<br>of the<br>Dead</h1>
  <div class="rule"></div>
  <p>a survival shooter you play in <b>vim normal mode</b></p>
</div>`);
shoot('file://' + card, join(PUBLIC, 'social-card.png'), CARD_W, CARD_H);
console.log('ok   social-card.png');

rmSync(work, { recursive: true, force: true });
console.log(`${ICON_SIZES.length + 1}/${ICON_SIZES.length + 1} -> public/`);
