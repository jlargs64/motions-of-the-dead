# Phase C — Renderer + FX: the scene, the layers, the judgment calls

Art direction target: **The Last Stand** (Con Artist Games, 2007). A wide
nocturnal exterior lit by **one floodlight** on a post beside the house. Slate
sky, a black treeline of bare winter trunks, fog on the horizon, trodden grass
that falls into
near-black at the west edge where the horde comes from. A timber barricade
(two posts, horizontal planks, cross-braced panels, a coil of barbed wire,
sandbags at the foot) spans columns 50..55; a survivor in a green jacket stands
on a pallet behind it with a bolt-action rifle and aims left, downrange, at
wherever the cursor is. The house he is defending fills the east edge, one
window lit. The horde shambles in from column 0 as gaunt, cel-shaded bodies —
bare skull, forearms and shins pale against the dark ground — each with its
word above its head.

The second art pass followed a pixel-art asset sheet (walker / armored walker /
runner / bloater / crawler, the survivor's rifle poses, timber barricade,
sandbags, wire coils, floodlight pole, ammo boxes, decaying monospace letters,
amber word banners). The game still ships **zero image assets**; the sheet was
read and rebuilt in draw calls. The word under the cursor is printed as an
**amber banner with ink letters**, and the crosshair inverts to ink over it.

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
| `figures.ts`   | the procedural zombie figures (two-tone cel-shaded bodies, lit by the lamp) and the survivor with his rifle |
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
row  -3 │    the scrub band the trunks stand in sits on the horizon at row -2.0
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
| survivor + pallet | cols `~55.1 .. 58.2`, rows `~8.4 .. 12.4` |
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
   treeline (scrub band + bare trunks), grass gradient + five flat depth bands
   + mottled blotches + tufts, trodden ruts
   (no lane stripes), dried blood in the grass, fog band, the paving strip, the
   house facade with its lit window, the pallet, the floodlight post, the
   heap's westward shadow, and finally **the light**: the westward darkening
   wash, the warm elliptical ground pool, the short beam off the lamp head,
   and the lamp glow.
4. **gore layer** — one `drawImage`. Persistent ground splatter (skipped when
   `gore === 'off'`).
4b. **lane bands** — every other lane darkened across the 52 walkable columns
   (`RGBA.laneBand`), a pale hairline on the top of every lane. Sixteen
   `fillRect`s. The scene bake still has no stripes; these are drawn over it
   so they can sit under the figures and the words (DECISIONS #95).
5. **barricade** — void, the east upright, per-lane leaning planks from the
   plank table, the four props, sandbags, barbed wire, caked blood.
6. **zombie figures**, iterated lane 0..15 so nearer lanes overlap farther
   ones, each shaded from the light table (and the muzzle flash).
7. **zombie words** — two passes: every scrim, then every glyph.
8. **survivor** + muzzle flash.
9. **shots** — tracers, then the covered-span underline.
10. **particles** (glyph shards and gib chunks).
11. **cursor** — lane tint + amber crosshair.
12. **field FX** — lane detonation flash, wave sweep, refusal wash, vignette
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
  `(1 - lightFalloff(col)) * 0.62` over the ground and `* 0.45` over the sky
  and treeline, so the west edge goes near-black and the ground brightens
  toward the wall. Words are drawn on top and are never dimmed: a zombie at
  spawn is a nametag walking out of the dark, on purpose.
- **The ground pool.** A warm ellipse centred on the ground at column
  `LIGHT_COL - 13`, radii 26 columns by 5.2 rows, painted with a radial gradient
  under a `scale()` so it has **no straight edge anywhere**. The light lives on
  the ground.
- **The cone.** From the caged lamp head down and west to the pool: ten nested
  wedges, each filled with the same whisper-faint radial gradient centred on
  the lamp and *clipped* to the wedge, from the full width in to a sliver along
  the axis. The sum is brightest on the axis and steps off so gently at the
  sides that no straight edge survives; the gradient is already zero at the far
  end. Earlier versions — a full-height wedge, then three bright wedges — read
  as a translucent UI panel laid over the field.
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
cell). Figure heights in cell units: walker/armoured 3.4, runner 3.3, bloater
3.3, crawler 1.25. A per-zombie scale of 0.9..1.1 (from `hash3(id, ..)`) grows
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

Every figure is a body, cel-shaded in two flat tones per surface: a lit east
face (`FIG_BODY`, `FIG_SKIN`) toward the lamp and a shadow west face
(`FIG_BODY_DK`, `FIG_SKIN_DK`). Far limbs take the shadow tones, near limbs the
lit ones, and the torso gets its west 42% painted over in shadow. Skin is the
lightest thing on a figure and is what reads against the dark ground, so every
kind shows some: bare skull, neck, forearms, hands, shins and feet on a walker.

A walker is: a ground shadow (offset west, away from the lamp); two legs, each
a cloth thigh to a knee at 26% of height and a skin shin to a foot; the far
arm (sleeve, forearm, hand) hanging behind the torso; the torso as one filled
path (shoulders wider than the hips, one hitched, a four-point ragged hem) with
its shadow face; a neck; the near arm hanging in front with a hooked finger;
the head — skull in two tones, a forward jaw, brow hollow, socket and mouth in
`FIG_HOLLOW`, scalp on two of four head kinds, a rim of lamplight on the crown;
one wound smear with a bright wet centre; blood down the chin; a rim on the
front shoulder. Arms *hang* — down off the shoulder, bent at the elbow, hands
below the hips — and a high hunch brings them forward; they never point.

Per-zombie variation is re-derived from `hash3(id, 0x5a, 0x77)` every frame,
allocation-free: height scale, hunch (how far the head hangs forward and how
far the hands reach), one of four head shapes, hem raggedness, wound position.

### Kind variations
- **walker** — baseline shamble.
- **armored** — a helmet dome with a brim and a plate carrier with two pouches
  and a strap, all in `FIG_PLATE[shade]`, which stays recognisably the bracket
  green at every step; trousers and sleeves to the wrist, boots, skin only on
  the face and hands.
- **runner** — thin, 24% forward lean, double stride, arms thrown back, jaw
  wide open, gait at 2x.
- **bloater** — 0.66 of height wide: a shirt straining over the shoulders, a
  pale distended gut (`FIG_BELLY`) slumping over the belt with a split down it,
  short thick spread legs, arms held out wide, a small head sunk into the
  shoulders.
- **crawler** — on hands and knees facing east, legs dragging west along the
  ground, head low at the front, a blood trail pooled under the body.

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

A timber wall, columns **50.0 .. 55.0**, spanning all 16 lanes. It is drawn per
frame (damage removes material, and painting "less" over a baked image would
mean re-baking on every HP quantum), but it is cheap: every shape is a
`fillRect` or one stroked path, keyed on `hash3(lane, slot, salt)` so the wall
is identical every frame for a given HP.

`barricadeGlyphs(barricade)` is called by the renderer and cached: the result is
a 16-char string, so it is only rebuilt when the HP ratio *quantised to 1/256*
changes. It is decoded into `wallLevels: Uint8Array(16)` each frame:
`'#' -> 4, '=' -> 3, '-' -> 2, '.' -> 1, ' ' -> 0`. The frozen field contract
makes lane 0 fail first.

**Structure.** Two full-height **posts** (west at 16% of the wall width, east at
70%), dark timber with a lit east face. Between their centres, per lane, up to
three **horizontal planks** at 5%, 37% and 69% of the lane height, each 26% of
a lane thick: a slab in one of four timber tones, a lit top edge, a dark under
edge, a nail at each end, and a knot on one plank in eight. Over every panel of
**four lanes**, an **X of cross-braces** (two thick diagonals with a lit edge).
The posts are drawn after the planks so the plank ends tuck behind them.

Per lane, by level:

| level | planks | extra |
|---|---|---|
| 4 | 3 | — |
| 3 | 2 (slots 0 and 2) | slot 1 is a splintered stub off one post |
| 2 | 1 (slot 1) | slots 0 and 2 are stubs |
| 1 | 0 | three stubs |
| 0 | 0 | **breach**: two stubs, a red glow on the west lip; no wire on this lane |

A panel keeps both braces while its worst lane is at level >= 2, one brace at
level 1, none once a lane is breached.

**Dressing.** The whole wall column is filled with `void_` first, so every gap
opens onto darkness for free. A **coil of barbed wire** runs down the west face
— narrow rings every half lane, a barb glinting on every other one, skipped on
breached lanes. **Sandbags** heap against the west foot: a four-wide, three-course
pyramid at the bottom and a three-wide, two-course one at lane 8, each bag a
lozenge with a dark underside and a lit crown.

**Blood cakes the base of the heap and accumulates across the run** in
`wallGore: Float32Array(16)`, fed by `barricade_hit` and by any gore particle
that lands at column >= 49. It is painted as a per-lane ellipse whose alpha and
height both grow with the accumulated value, capped at 0.62.

`barricade_hit` carries no row, so the renderer attributes it to
**`frontLane`** — the lane of the zombie whose rightmost column is nearest the
wall, recomputed every frame in `indexZombies`.

---

## The survivor

Standing at column **56.9**, feet on row **12.2**, on a pallet baked into the
back layer, 4 cells tall. Cropped dark hair, a face in shadow (he faces away
from the lamp), a bright green field jacket with a lit east face and a shaded
west face, a pale shirt at the throat, braced trousered legs and boots.

The **rifle actually points at the cursor**: the aim vector is computed in
*pixel* space (cells are not square) from the firing shoulder to the centre of
the cursor cell, every frame. `dx` is clamped to `<= -1` so he always aims
downrange, and a zero-length vector falls back to straight left. The
**bolt-action rifle** — wooden stock from the butt behind the shoulder to the
forestock, a steel barrel running on to 74% of his height, bolt handle, trigger
guard — is built from points in the aim basis `(ux,uy)` plus the perpendicular
`(uy,-ux)`, so it holds its shape at any angle. The rear arm goes to the grip
behind the torso, the front arm reaches out to the forestock, and both hands
are drawn last. `drawSurvivor` writes the muzzle position into a caller-owned
`Float64Array(2)` so the flash and tracers agree with the drawn rifle without
allocating a point. Three olive **ammo crates** sit on the paving at his feet.

East of him, baked: a strip of cracked paving, the **house facade** (clapboard,
one lit and half-boarded window at rows -2..0.5) filling columns 58..60 top to
bottom, and the **floodlight post** at `POST_COL` 57.9 — east of `SURV_COL`
56.9, or it grows out of the survivor's head.

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
| figure | a puff of grey motes | — | cloth / flesh / dark-blood / bone gibs that land and lie on the grass, plus one skull |
| droplets | none | 3, dark | 10..24, escalating |
| red mist | none | none | 14..44 tiny bright drops, low and wide |
| arterial spray | none | none | every kill; cone widens with combo and on a bloater burst |
| ground gore | none | 35% deposit weight | full |
| blood in the baked grass | not baked | baked | baked |
| wall caking | none | yes | yes |
| flashes | white/amber substituted for red | red | red, plus a faint red pulse per kill |
| vignette pulse | slate | blood | blood |

Escalation with `state.combo` is `min(1, combo / 12)`, applied to droplet count,
mist count, limb-chunk count, spray density and the spray cone. A bloater killed
by `dd`/`D` forces the heavy path regardless of combo: 1.8x velocity spread,
1.4x chunk size, a lane detonation flash and an 8-unit shake.

**Maiming.** A partial hit (an `x`, a `d$` that only reaches halfway) takes
letters off the word, and the renderer takes body parts off the figure to
match. `indexZombies` keeps each zombie's length from the previous frame in
`zpos`; when it shrinks and the figure was not armored (brackets are not
flesh), the difference is added to `ZPos.lost` and `maim()` fires a small burst
from the side that was shot: up to three resting gibs (flesh, cloth, bone),
droplets, and at `full` a short squirt the way the shot went. `lost` is passed
to `drawZombie` as `maim`, which removes parts in a fixed order:

| letters lost | walker / runner / armored | bloater |
|---|---|---|
| 1 | near arm becomes a stump | near arm becomes a stump |
| 2 | far arm becomes a stump | far arm becomes a stump |
| 3 | a hole through the flank | the gut is opened |
| 4 | the top of the skull is gone | the top of the skull is gone |
| 5+ | a second hole, high on the back | a second hole in the gut |

**Hobbled** is separate from the maim ladder: `Zombie.hobbled` (DECISIONS #94)
is passed to `drawZombie` as its own flag. The far leg ends in a `stump()` at
the knee dragging on the ground, and the stride shortens to 45%. A bloater's
far leg does the same. The letter that came off with it still fires `maim()`
as usual, so the shot has its gibs.

One letter left is a crawler regardless (`figureKind`), and the sim flips the
kind to match (DECISIONS #92), so the last step of the sequence is the whole
figure going down on its hands. Stumps and wounds are painted in `FIG_HOLLOW`
alone when gore is off.

**Gibs rest.** Limb chunks and the skull carry `P_REST | P_BLEEDS`: on first
ground contact they stain the cell once and drop the bleed bit, then bounce
with a 0.30 restitution and come to a stop (velocity and spin zeroed) where
they lie for the rest of a 1.6..3.4 s life, fading out over the last 45%.
Droplets, mist and spray stay `P_BLEEDS` only and vanish on impact.

`'off'` is a first-class mode, not a stub: kills still shake the screen, still
stamp OVERKILL, still get a full-lane detonation for bloaters, and the glyphs
still visibly come apart. It just does it in grey. Switching `gore` to or from
`'off'` sets `sceneDirty`, so the baked grass loses (or regains) its dried
blood on the next frame.

**Ground gore persists for the whole run.** Truth is
`GoreLayer.grid: Float32Array(60 * 19)` in cell space, capped at `GORE_CAP`
(10) per cell; the painted canvas is derived from it. Each deposit stamps one
deterministic pool, a splash tail thrown off it at a hashed angle, and six
specks. Tone follows the cell's *accumulated* level, not the deposit: under 2.2
it is dry, above that the pool is painted in wet `blood`, and past 4.5 it gets a
`bloodBright` centre, so a lane that keeps getting killed in visibly soaks
through. On resize the layer is rebuilt from the grid, which approximates the
accumulated look with 1..5 blobs per cell rather than replaying every
historical deposit — close enough that a resize does not read as a reset.

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

When the cursor sits on a word, `drawWords` paints that word as a solid
**amber banner** (`PALETTE.amber`) with **ink** glyphs instead of a dark scrim
with bone glyphs, and sets `cursorOnWord` so the crosshair brackets go to ink
too. Not while the store is placing: there the crosshair is the placement
cursor and the play cursor is not what `<CR>` acts on.

The cursor is a **crosshair**, not a caret — `virtualedit=all` means it spends
most of its life on bare ground. Four amber corner brackets around the cell, a
centre pip, and a pulsing alpha. It never knocks out the glyph beneath it, so a
targeted letter stays readable. A very faint amber tint (`alpha 0.055`) runs
the width of the field across the cursor's lane, so `j`/`k` reads instantly.
When a zombie stands anywhere in that lane the tint goes **hot**: a warmer
orange at 0.16 with a bright hairline top and bottom (`laneCursorHot`,
`laneCursorEdge`), so a horizontal cut is known to have a target before it is
typed. `indexZombies` fills a 16-bit `laneMask` for this and for the gutter,
where an occupied lane's number prints in bone rather than dim (DECISIONS #95).

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
draws its pause card on top of everything. The card is `panel(14, -1, 32, 18)`:
it grew three rows for the `w  save & quit` row in survival (DECISIONS #96).

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
