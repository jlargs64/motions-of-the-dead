# Phase C — Renderer + FX: the scene, the layers, the judgment calls

Art direction target: **The Last Stand** (Con Artist Games, 2007). A wide
nocturnal exterior. Slate sky, black conifer treeline, dishwater fog on the
horizon, cold blue-green grass trodden with dried blood. A filthy timber
barricade stands vertically at column 52; a survivor in a green jacket holds
the paving behind it and aims left, downrange, at wherever the cursor is. The
horde shambles in from column 0.

The previous renderer was a terminal — near-black with bone glyphs. That rule
is revoked. This one is a *place*. The one thing that did not change: **the
words must stay the crispest, highest-contrast thing on screen.** Every
atmospheric decision below is subordinate to that.

---

## Files

| file | owns |
|---|---|
| `palette.ts`   | every colour, the glyph-atlas colour slots, the chunk tones, every pre-baked `rgba()` string |
| `glyphs.ts`    | the pre-baked monospace glyph atlas (`drawImage`, never `fillText`) |
| `chunks.ts`    | the pre-baked gib-chunk atlas (6 shapes x 8 rotations x 6 tones) and the muzzle-flash sprite |
| `particles.ts` | the fixed struct-of-arrays pool, capacity **2000** |
| `fx.ts`        | screen-effect timers + the fixed-capacity shot ring |
| `scene.ts`     | the static scene bake (back + front layers) and the persistent gore layer |
| `figures.ts`   | the procedural zombie figures and the survivor |
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
row  17 │  NEAR FOREGROUND BAND (4 rows) — grass/paving, and the HUD
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
| combo counter | cols `0 .. ~6`, rows `-5.3 .. -2.6` (grows upward, bottom-anchored at row -2.6) |
| barricade + posts + sandbags | cols `50.5 .. 54.2`, all field rows |
| survivor | cols `~54.8 .. 57.2`, rows `~8.6 .. 12` |
| junk (drums, crates) | cols `56.9 .. 60`, rows `1.3 .. 5.2` and `11.9 .. 15` |
| HUD block | cols `48.4 .. 59.4`, rows `15.85 .. 19.1` |
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
   conifer treeline, grass gradient + mottled blotches + tufts, lane banding,
   trodden path, dried blood in the grass, fog band, the survivor's paving,
   slab seams, junk, and the wall's ground contact shadow.
4. **gore layer** — one `drawImage`. Persistent ground splatter (skipped when
   `gore === 'off'`).
5. **barricade** — void, per-lane planks, leaning posts, sandbags, barbed wire,
   caked blood.
6. **zombie figures**, iterated lane 0..15 so nearer lanes overlap farther ones.
7. **zombie words** — two passes: every scrim, then every glyph.
8. **survivor** + muzzle flash.
9. **shots** — tracers, then the covered-span underline.
10. **particles** (glyph shards and gib chunks).
11. **cursor** — lane tint + amber crosshair.
12. **field FX** — lane detonation flash, wave sweep, error wash, vignette
    pulse, red/white full-screen flashes.
13. **static front layer** — corner vignette + soft letterbox, drawn with the
    shake transform *undone*, because the camera frame must not shake.
14. **pause dim** (when `paused`).
15. **HUD** — bottom-right block, top-left combo.
16. **showcmd**, then the OVERKILL stamp.
17. `ctx.restore()` in `endFrame`.

Steps 3 and 13 are **one `drawImage` each**. Nothing procedural in the scene is
recomputed per frame.

---

## Per-lane vertical layout: figure + word

Each zombie is a **shambling figure with its word floating above its head like a
nametag**. A lane is one cell high, which is not enough for both, so the figure
is painted taller than its lane and hangs *below* the word into the lanes
beneath. The logical grid is untouched — this is purely how a lane is painted.

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
`FIG_HEAD_GAP = 1.05`, so the head top is always exactly 1.05 cells below the
word row and **never touches the glyphs** (the glyph box bottoms out around
0.9 of a cell). Figure heights in cell units: walker/armoured 1.34, runner 1.28,
bloater 1.40, crawler 0.58.

Consequence: a figure overlaps roughly the next 1.4 lanes down. That is
deliberate — it produces the depth-stacked crowd of the reference. It is safe
because **figures are drawn for all 16 lanes before any word is drawn**, and
every word sits on its own scrim. A word can never be occluded by a figure.

The figure is horizontally centred on `z.col + text.length / 2` and faces
**right**, the direction it walks.

### Kind variations
- **walker** — baseline shamble, arms hanging forward.
- **armored** — a scrap plate strapped across the chest in the same sickly green
  `#4a7c3f` as its brackets, with pauldron straps.
- **runner** — lean, 26% forward lean, longer stride, gait cycles at 2x.
- **bloater** — wide (0.78 of height), slumped, with a distended gut ellipse.
- **crawler** — prone, low to the ground, legs dragging left, one arm clawing
  forward.

### Gait
A 4-frame cycle read out of module-level `Float32Array` tables (`GAIT_LEG`,
`GAIT_ARM`, `GAIT_BOB`), indexed by
`(floor(sim.time / 140) * rate + z.id * 3) & 3`. Deterministic, per-zombie
phase-offset, zero allocation, no trig. Legs alternate, arms sway out of phase,
the body bobs, and the whole figure leans forward.

### Twitch
Zombies within 8 columns of the wall twitch harder as they close:
`twitch = (8 - dist) / 8`, direction from `hash3(z.id, frame >> 1, 0x2b)`.
This is the figure-side companion to the word flicker.

### Cost
Each figure is ~4 canvas operations: one stroked path carrying both legs and
both arms, a torso `fillRect`, a head ellipse, and a shadow. 40 zombies is
~400 ops.

---

## Legibility: the scrim

Every word gets **two chamfered pills** under it before any glyph is drawn: a
soft wide halo (`rgba(13,17,23,0.30)`) and a tighter core
(`rgba(13,17,23,0.62)`, or `0.76` for bloaters).

The pill is three **non-overlapping** `fillRect`s — a full-width middle band and
two inset end caps. This matters: the fill is translucent, and the obvious
two-rect "plus" construction would double the alpha in the middle and print a
visible cross under every word. Three rects, no overlap, flat alpha.

Scrims are drawn in a pass of their own, ahead of a second pass that draws all
the glyphs, so a neighbouring word's scrim can never paint over this word's
letters.

---

## The barricade

Columns **51.85 .. 54.15**, spanning all 16 lanes. `barricadeGlyphs(barricade)`
is called by the renderer (it is no longer in `buffer.rows`) and cached: the
result is a 16-char string, so it is only rebuilt when the HP *ratio quantised
to 1/256* changes, not on every fractional HP tick.

Per lane, `'#' -> 4, '=' -> 3, '-' -> 2, '.' -> 1, ' ' -> 0` selects a plank
width fraction of `1.0 / 0.84 / 0.60 / 0.34 / 0`:

- The whole wall column is filled with `void_` (`#12161d`) first, so **every gap
  opens onto darkness** for free.
- Intact lanes: a full timber baulk — body, a `timberShadow` bottom edge that
  doubles as the seam to the lane below, a `timberHi` top edge, and one grain
  streak positioned from `hash3(lane, 7, 3)`.
- Degraded lanes lose width and grow three deterministic splinters off the
  ragged right edge.
- A fully-gone lane is a **breach**: nothing but the void, two splintered plank
  stubs at the edges, and a faint red glow so the player's eye is pulled to it.
- Three **leaning posts** run the full height, each with a lean that varies with
  lane depth and two nailed cross-braces.
- **Sandbags** (ellipses with a lashing line) pile at the foot of the wall, in
  the bottom three lanes only.
- A **barbed wire** zig-zag runs down the wall as one stroked path, with barb
  ticks at each vertex — skipped on breached lanes.

**Blood cakes the base of the wall and accumulates across the run** in
`wallGore: Float32Array(16)`, fed by `barricade_hit` and by any gore particle
that lands at column >= 49. It is painted as a per-lane ellipse whose alpha and
height both grow with the accumulated value, capped at 0.62.

`barricade_hit` carries no row, so the renderer attributes it to
**`frontLane`** — the lane of the zombie whose rightmost column is nearest the
wall, recomputed every frame in `indexZombies`.

---

## The survivor

Standing at column **56.0**, feet on row **11.7**, about 3.1 cells tall. Head,
dark hair, green jacket torso with a lit shoulder edge and a shaded back edge,
braced legs, and a tucked back arm — all fills and one stroked path.

The **front arm actually points at the cursor**: the aim vector is computed in
*pixel* space (cells are not square) from the shoulder to the centre of the
cursor cell, every frame. `dx` is clamped to `<= -1` so he always aims
downrange, and a zero-length vector falls back to straight left. The pistol is
a short dark stub continuing the arm line, and `drawSurvivor` writes the muzzle
position into a caller-owned `Float64Array(2)` so the flash and tracers agree
with the drawn arm without allocating a point.

He is the only moving part of the right-hand scenery; the drums, crates and
paving are baked.

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

Bottom-right, **no panel behind it**, exactly as in the reference. All in
`rgba(232,232,224,0.80)`.

- `WAVE n` — row 15.85, right-aligned to column 59.4, in the dimmer white.
- **cross icon** (two `fillRect`s) at column 50.5, row 17.35, with barricade HP
  at 1.25x beside it. The number turns amber below 50% and bright blood below
  25%.
- **magazine icon** (outlined box with two ticks) at column 50.5, row 18.75,
  with `dd / D` charges beside it.
- **`muted`** — a speaker-off glyph at column 48.4, row 16.2, rendered only when
  the public `muted` field is true. The UI layer owns the field; the renderer
  owns the pixels.
- **showcmd** stays Vim-correct and oversized: right-aligned ending at column
  49.0, row 17.0, scale 2.1, in amber over a dim bed. It is a core mechanic, so
  it gets to be the largest text on screen.
- **combo** stays top-left in the sky band, bottom-anchored at row -2.6 so it
  grows upward. Scale `1 + min(combo,18) * 0.09` capped at 2.4, plus a 0.3 punch
  per `combo` event. White until combo 10, then bright blood (amber when gore is
  off). `combo_break` shatters the digits into white glyph particles that fall
  across the scene and stick.

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
