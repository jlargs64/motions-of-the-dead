# Phase C — Renderer + FX: the scene, the layers, the judgment calls

Art direction target: **The Last Stand** (Con Artist Games, 2007). A wide
nocturnal exterior lit by **one floodlight** on a post beside the house. Slate
sky, black conifer treeline, fog on the horizon, trodden grass that falls into
near-black at the west edge where the horde comes from. A junk-heap barricade
(planks, a car door, a fridge, tyres, chain-link, sandbags) spans columns
50..55; a survivor in a green jacket stands on a pallet behind it and aims
left, downrange, at wherever the cursor is. The house he is defending fills the
east edge, one window lit. The horde shambles in from column 0 as tall, gaunt
silhouettes, each with its word above its head.

The previous renderer was a terminal — near-black with bone glyphs. That rule
is revoked. This one is a *place*. The one thing that did not change: **the
words must stay the crispest, highest-contrast thing on screen.** Every
atmospheric decision below is subordinate to that.

---

## Files

| file | owns |
|---|---|
| `palette.ts`   | every colour, the glyph-atlas colour slots, the chunk tones, the six-step figure shading ramps, every pre-baked `rgba()` string |
| `glyphs.ts`    | the pre-baked monospace glyph atlas (`drawImage`, never `fillText`) |
| `chunks.ts`    | the pre-baked gib-chunk atlas (6 shapes x 8 rotations x 6 tones) and the muzzle-flash sprite |
| `particles.ts` | the fixed struct-of-arrays pool, capacity **2000** |
| `fx.ts`        | screen-effect timers + the fixed-capacity shot ring |
| `scene.ts`     | the static scene bake (back + front layers), `lightFalloff`, and the persistent gore layer |
| `figures.ts`   | the procedural zombie figures (silhouette + rim, shaded by the light) and the survivor |
| `renderer.ts`  | the only entry point; geometry, draw order, HUD, the public API |

---

## Grid, bands, and what the UI layer can draw into

The logical grid from `src/core/field.ts` is untouched: **16 lanes x 60
columns**, of which 0..51 are walkable, 52 is the barricade, 52..59 is the wall
plus the survivor's ground.

The renderer lays out **26 rows** total and centres them:

```
row  -6 ┐
row  -5 │  SKY BAND (6 rows)      night sky -> treeline -> fog
row  -4 │    treeline tips reach up to row -4.7
row  -3 │    conifer bases sit on the horizon at row -2.0
row  -2 │    fog band spans rows -2.7 .. -0.85
row  -1 ┘    far grass
row   0 ┐
  ...   │  THE FIELD — 16 lanes. Metrics.rows === 16. Cell (0,0) is here.
row  15 ┘
row  16 ┐
row  17 │  NEAR FOREGROUND BAND (4 rows) — grass, the feet of the near lanes, showcmd
row  18 │
row  19 ┘
```

`Metrics.ox/oy` point at **field cell (0,0)**, so every coordinate in the public
text API is field-relative. Rows `-6 .. -1` are the sky band; rows `16 .. 19`
are the foreground band. `centerText(s, 8)` is the middle of the playfield.

**Cards drawn by `src/ui/screens.ts` may use rows `-6 .. 19` and columns
`0 .. 59`.** A full-bleed card is `panel(2, -5, 56, 24)`. A comfortable centred
card is `panel(8, -2, 44, 18)`.

**Regions the renderer already owns** (avoid, or draw a panel over them):

| region | cells |
|---|---|
| HUD status block (NIGHT, barricade bar, charges) | cols `0.4 .. 14`, rows `-5.5 .. -3.2` |
| zombies-remaining strip | cols `15.8 .. 44.2`, row `-5.8 .. -5.4` |
| combo counter | cols `46 .. ~53`, rows `-5.0 .. -2.6` (grows upward, bottom-anchored at row -2.6) |
| barricade heap + sandbags | cols `49.4 .. 55.0`, all field rows |
| survivor + pallet | cols `~54.6 .. 57`, rows `~6.7 .. 12.4` |
| house facade + floodlight post | cols `56.5 .. 60`, all rows (baked) |
| showcmd | right-aligned ending at col `49.0`, row `17.0`, scale 2.1 |

Cells are integer pixels with aspect **0.58** (wider than a terminal — this is a
scene, not a buffer). Cell height is derived from viewport height first, then
clamped so the width also fits; `cw >= 3`, `ch >= 6`. `Metrics.scale` is
`ch / 16`. HiDPI via `setTransform(dpr,0,0,dpr,0,0)` with dpr clamped to 2.

The **grid is centred but the scene is not letterboxed with bars** — the sky and
ground are baked across the whole canvas, so any aspect ratio from 320x240 to
3840x2160 looks like a photograph rather than a boxed-in terminal. The
cinematic feel comes from a soft gradient letterbox in the front layer, not
from hard black bars.

---

## Draw order (back to front)

1. `bg` fill (only ever visible at the extreme edge during heavy shake)
2. **shake transform pushed** (`ctx.save()` in `beginFrame`)
3. **static back layer** — one `drawImage`. Sky gradient, horizon bloom, ragged
   conifer treeline, grass gradient + mottled blotches + tufts, trodden ruts
   (no lane stripes), dried blood in the grass, fog band, the paving strip, the
   house facade with its lit window, the pallet, the floodlight post, the
   heap's westward shadow, and finally **the light**: the westward darkening
   wash, the warm wedge from the lamp head, and the lamp glow.
4. **gore layer** — one `drawImage`. Persistent ground splatter (skipped when
   `gore === 'off'`).
5. **barricade** — void, the east upright, per-lane leaning planks from the
   plank table, the four props, sandbags, barbed wire, caked blood.
6. **zombie figures**, iterated lane 0..15 so nearer lanes overlap farther
   ones, each shaded from the light table (and the muzzle flash).
7. **zombie words** — two passes: every scrim, then every glyph.
8. **survivor** + muzzle flash.
9. **shots** — tracers, then the covered-span underline.
10. **particles** (glyph shards and gib chunks).
11. **cursor** — lane tint + amber crosshair.
12. **field FX** — lane detonation flash, wave sweep, error wash, vignette
    pulse, red/white full-screen flashes.
13. **static front layer** — film grain, corner vignette + soft letterbox,
    drawn with the shake transform *undone*, because the camera frame must not
    shake.
14. **pause dim** (when `paused`).
15. **HUD** — top-left status block, top-edge strip, combo (hidden on the title).
16. **showcmd**, then the OVERKILL stamp.
17. `ctx.restore()` in `endFrame`.

Steps 3 and 13 are **one `drawImage` each**. Nothing procedural in the scene is
recomputed per frame.

---

## The light

There is exactly one light source: a floodlight on a post at `POST_COL` 56.7,
its head at (`LIGHT_COL` 55.0, `LIGHT_ROW` -1.5). Everything about it is baked
into the back layer, and everything that moves reads the same falloff:

```ts
lightFalloff(col) = 1 / (1 + ((LIGHT_COL - col) / 22)^2)     // 1 at the lamp
```

That gives ~0.14 at column 0, ~0.34 at column 24, ~0.91 at column 48.

- **The wash.** A horizontal linear gradient whose alpha at each column is
  `(1 - lightFalloff(col)) * 0.86` over the ground and `* 0.45` over the sky
  and treeline, so the west edge goes near-black and the ground brightens
  toward the wall. Words are drawn on top and are never dimmed: a zombie at
  spawn is a nametag walking out of the dark, on purpose.
- **The wedge.** A warm `lightWarm` polygon from the lamp head fanning west and
  down over the ground, fading out by column 10.
- **The lamp glow** around the head, spilling a little onto the sky and the
  house.
- **The heap's shadow** falls west (the lamp is east of it).

`Renderer.lightAt: Float32Array(60)` is filled in `resize()` from the same
function. `drawFigures` reads `lightAt[round(centreCol)]` and passes it to
`drawZombie` as `shade`, which selects a step from the six-step ramps in
`palette.ts` (`FIG_BODY`, `FIG_RIM`, `FIG_SKIN`, `FIG_BLOOD`, `FIG_PLATE`).
No gradients per figure, no `globalAlpha` juggling, no colour mixing in the
draw loop.

**Muzzle flash lighting.** During the 60 ms muzzle window, any figure within
`MUZZLE_REACH` (6) columns of a live shot's near end and within one lane of its
row gets `shade += (muzzle / MUZZLE_MS) * 0.6`. It reuses the 12-slot shot
ring; there is no extra state.

Lighting is independent of the gore level.

---

## Per-lane vertical layout: figure + word

Each zombie is a **tall hunched silhouette with its word floating above its
head like a nametag**. A lane is one cell high, which is not enough for both,
so the figure is painted taller than its lane and hangs *below* the word into
the lanes beneath. The logical grid is untouched — this is purely how a lane is
painted.

```
row r      +----------------------------+   <- the WORD, in its real cells
           |  g h o u l                 |      on a dark scrim pill
row r+1.05 +----------------------------+   <- head top: FIG_HEAD_GAP
              (o)      figure           |
              /|\      centred under
              / \      the word span
row r+1.05+H  ---      feet / ground plane
```

`feetRow = row + FIG_HEAD_GAP + figureHeightCells(kind)` with
`FIG_HEAD_GAP = 1.05`, so the head top is always at least a cell below the word
row and **never touches the glyphs** (the glyph box bottoms out around 0.9 of a
cell). Figure heights in cell units: walker/armoured 3.2, runner 3.0, bloater
3.35, crawler 1.1. A per-zombie scale of 0.9..1.1 (from `hash3(id, ..)`) grows
or shrinks the body around the same feet; at 1.1 the head top rises ~0.1 cell
into the gap, still clear of the glyphs.

Consequence: a figure overlaps roughly the next 3.3 lanes down, and a lane-15
figure stands in the foreground band. That is deliberate — it produces the
depth-stacked crowd of the reference. It is safe because **figures are drawn
for all 16 lanes before any word is drawn**, and every word sits on its own
scrim (core alpha 0.70). A word can never be occluded by a figure.

The figure is horizontally centred on `z.col + text.length / 2` and faces
**right**, the direction it walks.

### Anatomy

One figure is: a ground shadow (offset west, away from the lamp), the legs as
one stroked path, the torso as one filled path (shoulders wider than the hips,
one shoulder hitched, a four-point ragged hem), two dangling arms as one
stroked path with pale hands, a small head hung forward off the shoulders with
a dark skull cap and jaw shadow, a **rim stroke** down the east edge of torso
and head in `FIG_RIM[shade]`, and (gore on) one wound smear. About 11 fills
and strokes.

Per-zombie variation is re-derived from `hash3(id, 0x5a, 0x77)` every frame,
allocation-free: height scale, hunch (how far the head hangs forward), one of
four head shapes, hem raggedness, wound position.

### Kind variations
- **walker** — baseline shamble.
- **armored** — a scrap plate across the chest in `FIG_PLATE[shade]`, which
  stays recognisably the bracket green `#4a7c3f` at every step.
- **runner** — lean, 26% forward lean, longer stride and reach, gait at 2x.
- **bloater** — 0.72 of height wide, with a distended gut ellipse.
- **crawler** — prone, low, legs dragging west, one arm clawing east.

### Gait
A 4-frame cycle read out of module-level `Float32Array` tables (`GAIT_LEG`,
`GAIT_ARM`, `GAIT_BOB`), indexed by
`(floor(sim.time / 140) * rate + z.id * 3) & 3`. Deterministic, per-zombie
phase-offset, zero allocation, no trig. Legs alternate, arms sway out of phase,
the body bobs.

### Twitch
Zombies within 8 columns of the wall twitch harder as they close:
`twitch = (8 - dist) / 8`, direction from `hash3(z.id, frame >> 1, 0x2b)`.
This is the figure-side companion to the word flicker.

### Cost
`scripts/render-smoke.mts` renders 120 frames with 40 zombies and fails above
8 ms/frame; it currently measures ~0.25 ms and ~3100 ctx calls per frame on the
fake context.

---

## Legibility: the scrim

Every word gets **two chamfered pills** under it before any glyph is drawn: a
soft wide halo (`rgba(13,17,23,0.30)`) and a tighter core
(`rgba(13,17,23,0.70)`, or `0.80` for bloaters).

The pill is three **non-overlapping** `fillRect`s — a full-width middle band and
two inset end caps. This matters: the fill is translucent, and the obvious
two-rect "plus" construction would double the alpha in the middle and print a
visible cross under every word. Three rects, no overlap, flat alpha.

Scrims are drawn in a pass of their own, ahead of a second pass that draws all
the glyphs, so a neighbouring word's scrim can never paint over this word's
letters.

---

## The barricade

A junk heap, columns **50.0 .. 55.0**, spanning all 16 lanes. It is drawn per
frame (damage removes material, and painting "less" over a baked image would
mean re-baking on every HP quantum), but it is cheap: every plank comes from a
table and every shape is a fill or one stroked path.

`barricadeGlyphs(barricade)` is called by the renderer and cached: the result is
a 16-char string, so it is only rebuilt when the HP ratio *quantised to 1/256*
changes. It is decoded into `wallLevels: Uint8Array(16)` each frame:
`'#' -> 4, '=' -> 3, '-' -> 2, '.' -> 1, ' ' -> 0`. The frozen field contract
makes lane 0 fail first.

**The plank table.** 16 lanes x 3 planks, laid out once at module load from
`hash3(lane, i, 0x9e)`: centre (fractions of the wall width / lane height),
length, thickness, tone (one of four timbers) and an angle in -18..+18 degrees
pre-resolved to `cos`/`sin`. A plank is a filled quad plus a lit top edge —
two draw calls, no transforms, no trig.

Per lane, by level:

| level | planks | extra |
|---|---|---|
| 4 | 3 | — |
| 3 | 2 | — |
| 2 | 2 | three splinters off the west face; the lane's prop drops to an outline |
| 1 | 1 stub (45% length) | splinters |
| 0 | none | **breach**: void, two plank ends, one fallen plank on the ground, a red glow on the west lip; no barbed wire |

**Props**, one per lane group, drawn on top of the planks and as broken as the
group's worst lane (full at level >= 3, outline at 2, gone below):

- lanes 0..2 — a **chain-link panel**: frame + diagonal lattice
- lanes 3..5 — a **car door**, rust, window up
- lanes 8..10 — a **fridge**, upright, door seam and handles
- lanes 13..15 — a **stack of three tyres**

**Dressing.** The whole wall column is filled with `void_` first, so every gap
opens onto darkness for free. One full-height upright on the east side carries
the **barbed wire** zig-zag (barbs skipped on breached lanes). **Sandbags** pile
at the west foot in the bottom four lanes.

**Blood cakes the base of the heap and accumulates across the run** in
`wallGore: Float32Array(16)`, fed by `barricade_hit` and by any gore particle
that lands at column >= 49. It is painted as a per-lane ellipse whose alpha and
height both grow with the accumulated value, capped at 0.62.

`barricade_hit` carries no row, so the renderer attributes it to
**`frontLane`** — the lane of the zombie whose rightmost column is nearest the
wall, recomputed every frame in `indexZombies`.

---

## The survivor

Standing at column **55.6**, feet on row **12.2**, on a pallet baked into the
back layer, about 5.5 cells tall. Head, dark hair, green jacket with a lit east
edge and a shaded back, braced legs and boots, a tucked back arm — all fills
and one stroked path.

The **front arm actually points at the cursor**: the aim vector is computed in
*pixel* space (cells are not square) from the shoulder to the centre of the
cursor cell, every frame. `dx` is clamped to `<= -1` so he always aims
downrange, and a zero-length vector falls back to straight left. The rifle is
a long dark barrel continuing the arm line, and `drawSurvivor` writes the
muzzle position into a caller-owned `Float64Array(2)` so the flash and tracers
agree with the drawn arm without allocating a point.

East of him, baked: a strip of cracked paving, the **house facade** (clapboard,
one lit and half-boarded window at rows -2..0.5) filling columns 57..60 top to
bottom, and the **floodlight post**.

---

## Muzzle flash, tracer, span underline

`{ t: 'shot'; row; colStart; colEnd; hits }` pushes into a fixed **12-slot ring**
in `Fx` (`Int16Array`/`Float32Array`, no objects). Timings:

- **muzzle flash** — 60 ms. A pre-baked radial sprite (core `#ffe6a0` into
  `#ff9020`, with two star spikes), blitted at the gun, scaling down as it dies.
- **tracer** — 110 ms. Two strokes from the gun to the near end of the covered
  span: a wide soft orange one and a thin bright core.
- **span underline** — 240 ms. A faint `flashCore` wash over the whole lane band
  from `colStart` to `colEnd`, plus a hard bright bar along the bottom of those
  cells. It is `flashCore` when `hits > 0` and `amber` when the command covered
  nothing — so a whiffed motion reads differently from a connecting one.

This is the core feedback loop, so it is deliberately the brightest thing that
happens in the field.

---

## Gore

```ts
export type GoreLevel = 'off' | 'low' | 'full';
gore: GoreLevel;   // public mutable, default 'full'
```

| | `'off'` | `'low'` | `'full'` |
|---|---|---|---|
| word | grey glyphs lift and fade (ghost, no gravity) | letters scatter and land | letters scatter and land |
| figure | a puff of grey motes | — | cloth / flesh / dark-blood chunks |
| droplets | none | 3, dark | 5..12, escalating |
| arterial spray | none | none | at combo >= 10 or a bloater burst |
| ground gore | none | 35% deposit weight | full |
| blood in the baked grass | not baked | baked | baked |
| wall caking | none | yes | yes |
| flashes | white/amber substituted for red | red | red |
| vignette pulse | slate | blood | blood |

Escalation with `state.combo` is `min(1, combo / 12)`, applied to droplet count,
limb-chunk count and spray density. A bloater killed by `dd`/`D` forces the
heavy path regardless of combo: 1.8x velocity spread, 1.35x chunk size, a lane
detonation flash and an 8-unit shake.

`'off'` is a first-class mode, not a stub: kills still shake the screen, still
stamp OVERKILL, still get a full-lane detonation for bloaters, and the glyphs
still visibly come apart. It just does it in grey. Switching `gore` to or from
`'off'` sets `sceneDirty`, so the baked grass loses (or regains) its dried
blood on the next frame.

**Ground gore persists for the whole run.** Truth is
`GoreLayer.grid: Float32Array(60 * 19)` in cell space, capped at 6 per cell;
the painted canvas is derived from it. Each deposit stamps one deterministic
ellipse plus three specks. On resize the layer is rebuilt from the grid, which
approximates the accumulated look with 1..4 blobs per cell rather than
replaying every historical deposit — close enough that a resize does not read
as a reset.

Gore can land in rows `-1 .. 18` (`GORE_TOP = -1`, `GORE_EXTRA = 3`), so
splatter from lane 15 lands on the foreground band rather than being clipped.

---

## HUD

Top-left in the sky band and along the top edge, as in the reference. **No
panel behind it.** Hidden on the title screen.

- `NIGHT n` — col 0.6, row -5.5, in the dimmer white. The mute glyph sits to
  its right when `muted`.
- **barricade bar** — cols 0.6..10.6, row -4.35, 0.55 cells tall, on a dark
  track. Fill proportional to HP; white, then amber at or below 50%, then
  bright blood at or below 25%. Up to five deterministic crack lines (from
  `hash3`) appear across the filled part. The numeral sits at the bar's right
  end at 1.25x.
- **magazine strip** — row -3.45: the magazine icon, then `dd n   D n`, labels
  dim and counts white.
- **zombies remaining** — a thin strip, cols 16..44, row -5.75, filled from the
  left by `(waveSize - resolvedThisWave) / waveSize`. Only while `playing`
  with a non-zero wave.
- **showcmd** stays Vim-correct and oversized: right-aligned ending at column
  49.0, row 17.0, scale 2.1, in amber over a dim bed. It is a core mechanic, so
  it gets to be the largest text on screen.
- **combo** — bottom-anchored at row -2.6, left edge col 46, growing upward.
  Scale `1 + min(combo,18) * 0.09` capped at 2.4, plus a 0.3 punch per `combo`
  event. White until combo 10, then bright blood (amber when gore is off).
  `combo_break` shatters the digits into white glyph particles that fall across
  the scene and stick. At max scale `x18` spans cols 46..53.2, rows -5.0..-2.6,
  clear of the strip.

### Gutter

Vim's `nu` / `rnu`, 1-based to agree with `{n}G`. Drawn **without a scrim**:
each number is blitted from the atlas twice, once in `bg` one pixel down-right
and once in `dim` (amber on the cursor's lane), so it reads as scratched onto
the ground rather than printed in an editor gutter. The margin west of the
field is preferred; on narrow screens it falls back inside column 0.

### Front layer

`bakeFront` lays a static **film grain** (a 128x128 tile of `hashCell` noise,
alpha 0.04..0.06, scaled by `round(ch / 16)` so it stays fine on large
displays, tiled with `createPattern` at bake time) under the radial vignette
(alpha 0.32 at 62% radius, 0.74 at the corners) and the soft letterbox. One
`drawImage` per frame, shake undone.

---

## Cursor

The cursor is a **crosshair**, not a caret — `virtualedit=all` means it spends
most of its life on bare ground. Four amber corner brackets around the cell, a
centre pip, and a pulsing alpha. It never knocks out the glyph beneath it, so a
targeted letter stays readable. A very faint amber tint (`alpha 0.055`) runs
the width of the field across the cursor's lane, so `j`/`k` reads instantly.

---

## Word flicker, re-keyed to the wall

Flicker is now keyed to **column distance from the barricade**, not row:
`dist = BARRICADE_COL - (z.col + text.length)`. Inside 8 columns, per-glyph
noise probability ramps `4/7/11/16/22/30/40/52` out of 128, driven by
`hash3(z.id, glyphIndex, frame / 3)` — deterministic, per glyph, no strings, no
allocation. The replacement characters come from a `Uint16Array` of `%#@$&*?!`.

Bloaters (`kind === 'bloater' || length >= 8`) render in `sickDark` on a heavier
scrim; crawlers and 1-char words render at `alpha 0.78`. Armoured brackets stay
`#4a7c3f`, matched by the green plate on the figure.

---

## Pause

`paused: boolean` dims the scene with two pre-baked washes — a slate
`rgba(43,52,70,0.52)` to knock the saturation down and a
`rgba(13,17,23,0.30)` to knock the value down. This is a deliberate substitute
for `ctx.filter = 'saturate(...)'`, which is expensive and unevenly supported.
The dim is applied *before* the HUD so the HUD stays readable, and the UI layer
draws its pause card on top of everything.

---

## `panel` / `rule` / `keycap`

Written for `src/ui/screens.ts`.

- **`panel(col, row, w, h, { alpha, ink })`** — a single deterministic torn-edge
  path (jitter from `hash3` on a seed derived from the rect, so a given panel is
  identical every frame), filled twice: once translated as a drop shadow, once
  as the sheet. Paper mode is `#d8cfb8` with a `#b6aa8d` edge and five foxing
  stains; `ink: true` is `#161b22` with a bone hairline and no stains, for cards
  that must sit over the live scene.
- **`rule(col, row, w, color?)`** — one stroked path of short segments with
  sub-pixel vertical jitter and small gaps, so it reads as drawn rather than
  ruled.
- **`keycap(label, col, row, w?)`** — two slightly offset stroked rects (the
  sketched-twice look) with the label centred. Default width is
  `max(2, label.length + 1.4)` cells.

**Judgment call the UI layer needs to know about:** `keycap` and `rule` have no
colour parameter for their box/ink, so they take their contrast from the last
`panel()` call — after a paper panel they draw in `PALETTE.ink`, otherwise in
`PALETTE.bone` / `PALETTE.dim` for legibility over the night scene. Draw the
panel first, then its contents. `rule` accepts an explicit colour if you need to
override.

---

## Zero-allocation measures

- **Static scene**: two offscreen canvases baked once per resize (and once more
  if `gore` toggles to/from `'off'`), each blitted with a single `drawImage`.
  Bakes are capped at ~4.2M device pixels and scaled up on blit; at those sizes
  the low-frequency content loses nothing visible. Baking may allocate freely —
  it is not a hot path — and is guarded behind a `sceneDirty` flag so the key
  string is not even built per frame.
- **Glyph atlas**: ASCII 32..127 x 13 colour slots, baked once per resize,
  capped at ~8M device pixels. The draw loop issues `drawImage` and never
  touches `ctx.font`. `text()` only falls back to `fillText` for a colour
  outside the atlas or `scale !== 1` — i.e. HUD numbers and cards, never the
  field.
- **Chunk atlas**: 6 shapes x 8 rotations x 6 tones baked once per resize, so a
  tumbling gib is one `drawImage` rather than a rotated path fill.
- **Particles**: struct-of-arrays over `Float32Array`/`Uint16Array`/`Uint8Array`,
  capacity **2000**, removal by swap-with-last, round-robin recycling when full.
  Positions are in cell units, so the pool is resolution independent. Each
  particle carries its own `ground` row, so gore arcs and settles near where it
  came from instead of falling to the bottom of the screen.
- Every `rgba()` string is pre-baked in `palette.ts`.
- HUD strings (`hpStr`, `chargeStr`, `waveStr`, `comboStr`) and the barricade
  glyph string are rebuilt only when an underlying value changes.
- A 128-entry table of one-char strings backs the `fillText` fallback.
- Bracket detection for armoured zombies compares char codes, not substrings.
- The zombie position index is a `Map<id, ZPos>` of pooled objects updated in
  place; dead entries are swept every 64 frames into a free list. Sweeping must
  lag at least one frame because `kill` fires *after* the sim has removed the
  zombie, so the renderer resolves the burst against the previous frame's entry.
- Figure gait, twitch, splinters, grain, sandbag jitter and panel tears all come
  from `hash3`, never from `Math.random` and never from a stored table of
  objects.

Measured with the headless harness: **~2000 canvas operations per frame** at
1600x900 with 40 zombies and 335 particles in flight (mostly `fillRect` and
`drawImage`), and the particle pool peaks at 409 of 2000 under a continuous
kill stream at high combo. The only frames that spike are resize frames, which
run a bake.

---

## Robustness

Verified with a headless harness (a fake canvas whose 2D context is a `Proxy`
that records every call and throws on any non-finite numeric argument or any
non-finite property assignment), driven over 260 frames at each of
320x240 / 1280x720 / 1600x900 / 3840x2160, at every `dpr` from 1 to 2, at all
three gore levels, with every event tag fired and a mid-run `resize()`:

- no non-finite coordinates anywhere,
- `save`/`restore` perfectly balanced (max depth 2),
- the particle pool never exceeds its capacity,
- `Metrics` stays sane at every size.

---

## Assumptions about `GameState`

- `buffer.rows` is **no longer read at all**. Zombies are truth; the renderer
  draws from `buffer.zombies` and calls `barricadeGlyphs(state.barricade)`
  itself.
- `sim.time` is a millisecond clock shared with `sim.flashUntil`. It drives the
  shamble gait, so a paused or rewound sim simply freezes the horde's animation,
  which is correct.
- `armored` zombies carry their bracket/quote as the first and last character.
- `bloater` is treated as `kind === 'bloater' || text.length >= 8`; `crawler` as
  `kind === 'crawler' || text.length <= 1`.
- Zombies with `row < 0 || row >= 16` are skipped, as are ones entirely off the
  walkable columns.
- `barricade.hp` may be fractional; the HUD ceils it and the wall quantises it.
- The `shot` event is emitted once per affected lane and its `colStart`/
  `colEnd` are inclusive field columns; the renderer swaps them if they arrive
  reversed and clamps them to `0 .. 51`.
- `charge_used` carries no row, so it detonates the **cursor's** lane;
  `barricade_hit` carries no row, so it bloodies the **front** lane.
