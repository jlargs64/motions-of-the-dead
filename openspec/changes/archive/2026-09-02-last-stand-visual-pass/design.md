## Context

The renderer (`src/render/`) is a Canvas 2D pipeline with two baked static
layers (back and front), a persistent gore layer, and a per-frame pass for the
barricade, figures, words, survivor, shots, particles, cursor, FX and HUD. Draw
order and the zero-allocation rules are documented in `src/render/NOTES.md`. The
grid is 16 lanes x 60 columns with 0.58 cell aspect; the renderer lays out 26
rows (6 sky, 16 field, 4 foreground). `Metrics.ox/oy` point at field cell (0,0)
and every public text-API coordinate is field-relative. `src/ui/screens.ts`
draws cards through that API and `tests/ui-layout.test.ts` pins that those
cards fit.

Constraints that survive this change unchanged:

- Zero runtime dependencies, no assets, no fonts, no network. Everything is
  drawn procedurally.
- **Words are the crispest, highest-contrast thing on screen.** Every
  atmospheric decision is subordinate to that.
- Nothing procedural in the scene is recomputed per frame. Steps 3 and 13 of the
  draw order stay one `drawImage` each.
- No per-frame allocation in the figure, particle or FX paths.
- Deterministic: every jitter comes from `hash3` on stable seeds, never
  `Math.random`.
- The logical grid, `Metrics`, and the sim are untouched.

The reference is The Last Stand (2007): a nocturnal suburban lot, one hard
light, tall gaunt zombies emerging from darkness, a junk-heap barricade, a
grungy blood-and-rust HUD. The goal is that feel, not a copy of its assets.

## Goals / Non-Goals

**Goals:**
- One readable light source that shapes the whole frame.
- Figures large enough to read as a crowd of people, without ever occluding a
  word.
- A barricade that looks hand-built and gets visibly worse per lane.
- Kill the editor tells (stripes, scrimmed gutter) while keeping the `j`/`k`
  count that the pedagogy depends on.
- HUD and cards that say NIGHT and look weathered, still in the system
  monospace font.
- Frame budget unchanged: 40 zombies plus a full gib burst at 60 fps on a
  2019 laptop, as today.

**Non-Goals:**
- Gameplay changes. No new sim events, no between-wave day screen (a separate
  change).
- Loading a display font. The stencil look is faked with weight, jitter and
  erosion in the existing atlas approach, or not at all.
- Real dynamic lighting. The light is baked; per-frame lighting is limited to a
  per-figure shade lookup and one short-lived muzzle glow.
- Rewriting the particle or FX systems.

## Decisions

### D1. Light is baked into the back layer and sampled by figures as a 1-D table

The floodlight sits on a post at column ~55, row ~-1.5 (top of the wall, east
side). The back-layer bake paints (a) a radial cone in `light` colour with
alpha falling off westward, (b) a westward multiply-style darkening wash that
reaches near-black by column 4, and (c) a hard shadow band cast west of the
barricade heap. Figures cannot sample the baked pixels cheaply, so the
renderer keeps a `Float32Array(60)` **light table**, `lightAt[col]` in 0..1,
built once in `resize()` from the same falloff function the bake uses. Each
figure looks up `lightAt[round(centreCol)]` and passes it to `drawZombie` as a
`shade` scalar that selects a pre-baked fill from a 6-step ramp in
`palette.ts` (`figBody[0..5]`, `figRim[0..5]`). No gradients per figure, no
`globalAlpha` juggling.

*Alternatives considered:* a per-frame `ctx.filter` or composite pass over the
figure layer (expensive, uneven browser support, and it would dim the words);
per-figure radial gradients (allocation per frame, and 40 gradients a frame is
measurable).

### D2. Muzzle flash lights figures via a transient boost in the same table path

On a `shot` event the renderer records the shot row and covered span already
(the 12-slot `Fx` ring). During the 60 ms muzzle window, figures whose centre
column is within 6 columns of the span's near end and whose lane is within 1 of
the shot row get `shade = min(1, shade + boost)` where `boost = muzzle / MUZZLE_MS
* 0.6`. That reuses the ring; no new state. Words are not affected: they are
already full contrast.

### D3. Figures are ~3.2 cells tall, hang below their word, and are drawn as a silhouette plus rim

`FIG_H` becomes `[3.2, 3.2, 3.0, 3.35, 1.1]` cells for walker, armoured,
runner, bloater, crawler; `FIG_W` ratios narrow slightly so a walker is ~1.2
cells wide. `FIG_HEAD_GAP` stays 1.05 so the head top never touches the glyph
box. The figure now overlaps roughly 3.3 lanes below its word. This is safe for
the same reason as today: all 16 lanes of figures are drawn before any word,
and every word sits on its own scrim. The scrim core alpha rises from 0.62 to
0.70 to keep contrast over the larger, lighter-rimmed shapes.

A figure is drawn as: ground shadow ellipse, one filled silhouette path (hunched
torso, hanging head, two dangling arms, two legs from the gait table, ragged
coat hem as 3 to 4 jittered points), a rim stroke on the east edge in
`figRim[shade]`, a head fill, and for armoured kinds a plate. That is ~8 ops per
figure, ~320 for 40 zombies, versus ~160 today. Measured budget allows it; the
render smoke script gets a 40-zombie frame-time assertion so it stays honest.

Per-zombie variation comes from `hash3(z.id, k, salt)`: height scale 0.9..1.1,
hem raggedness, hunch amount, and one of 3 head shapes. Nothing is stored on the
zombie; it is recomputed from the id each frame, allocation-free.

*Alternative considered:* a pre-baked sprite atlas per kind and gait frame
(cheap to blit, but 5 kinds x 4 frames x 6 shades x variation is a large atlas,
and it loses the per-zombie twitch and the survivor-facing rim).

### D4. Survivor scales to 5.5 cells and moves onto a raised step

`SURVIVOR_H` becomes 5.5. Feet at row 12.2, column 55.6, standing on a stacked
pallet so his head clears the heap and the aim line from shoulder to cursor
stays visible over the wall. The aim vector, muzzle position output and tracer
origin are unchanged in kind; only the constants move. The HUD block moves out
from under him (see D8).

### D5. The barricade becomes a heap drawn in three passes, still per-lane

Columns 50.0 to 55.0. Per lane, the wall level (0..4 from `barricadeGlyphs`)
still selects what is drawn, so degradation and breach behaviour is preserved:

1. **Backing** (baked, back layer): the void behind the heap, the house wall
   with one lit window at rows -2..4, columns 55.5..60, and the floodlight post.
2. **Heap body** (per frame, cheap): per lane a set of 2 to 3 leaning planks at
   `hash3` angles between -18 and +18 degrees, plus one large prop per 3 to 4
   lanes: a tyre stack (lanes 13..15), a fridge (lanes 8..10), a car door (lanes
   3..5), a chain-link panel (lanes 0..2) drawn as a diagonal lattice stroke.
   Level 4 draws everything; level 3 drops one plank; level 2 drops the prop's
   fill to an outline and grows splinters; level 1 leaves one plank stub;
   level 0 is a breach: void, stubs, a red glow, as today.
3. **Dressing** (per frame): sandbags in lanes 12..15 at the foot, barbed wire
   across intact lanes, caked blood from `wallGore`.

The plank set per lane is deterministic from `(lane, planksIndex)` so the heap
is identical every frame. Because these are all `fillRect`/one stroked path
each, the per-frame cost is about 6 ops per lane, ~100 ops total, roughly
double today's wall.

*Alternative considered:* baking the heap into the back layer and only drawing
damage over it. Rejected because damage removes material, and painting "less"
over a baked image needs the void to show through, which means re-baking on
every HP quantum. Per-frame is simpler and cheap enough.

### D6. Lane banding is removed; the gutter loses its scrim; numbers stay

Banding stripes are deleted from `bakeBack`. In their place three or four
trodden ruts run east-west at deterministic rows, painted as low-alpha darker
smears that do not align to lane edges. The gutter (`drawGutter`) drops the
`GUTTER_SCRIM` pill, renders at scale 0.8 in `PALETTE.dim` with a 1 px dark
offset copy underneath for legibility over the grass, and the current lane's
number stays amber. The default of `lineNumbers: 'relative'` is unchanged
because the relative count is the pedagogy for `j`/`k`; the option to turn the
gutter off already exists on the pause card.

### D7. Film grain and vignette live in the front bake

A static grain field (one `ImageData` filled from `hash3` per pixel at a fixed
seed, alpha 0.04..0.06) is drawn into the front layer at bake time under the
existing vignette, whose corner alpha rises from its current value to a 0.55
peak. Static grain is a deliberate choice: animated grain would need a per-frame
blit of a second canvas, and the reference's grain reads as texture, not noise.

### D8. HUD moves to the top-left and top edge; `WAVE` becomes `NIGHT`

The reference puts the barricade bar and survivor status top-left and a
zombies-remaining bar along the top. The HUD block leaves cols 48..59, rows
15.85..19.1 (which now sit behind the survivor's pallet) and becomes:

- Top-left, rows -5.4..-3.6, cols 0.5..14: `NIGHT n` label, a barricade bar
  (`fillRect` track with 3 to 5 `hash3` crack lines, fill in `hudWhite` turning
  amber then bright blood at the same thresholds as today, numeral at the right
  end).
- Below it, row -3.2: the magazine strip: two small outlined boxes labelled
  `dd` and `D` with their counts.
- Top edge, row -5.7, cols 16..44: the zombies-remaining strip. A thin track
  with a fill proportional to `(total - killed) / total` for the current wave,
  drawn from `state.sim.spawned` and the alive count already indexed in
  `indexZombies`. Skull ticks are not needed; the bar is enough.
- Combo counter moves right of the strip so the two do not collide: bottom-
  anchored at row -2.6, left edge col 46, still growing upward.
- showcmd stays where it is (right-aligned to col 49.0, row 17.0). The mute
  glyph moves to the right of the NIGHT label.

`waveStr` becomes `'NIGHT ' + state.wave`. The death card headline in
`screens.ts` becomes `YOU DID NOT SURVIVE THE NIGHT`; the summary line already
says NIGHT. `NOTES.md`'s "regions the renderer owns" table is rewritten to
match, and `tests/ui-layout.test.ts` is re-run against the new regions.

### D9. Gore levels keep their meaning; lighting does not depend on gore

Blood in the grass and wall caking remain gated by `gore`. The light cone,
shading, grain and vignette apply at every gore level, including `off`, since
they are not gore.

## Risks / Trade-offs

- [Bigger figures make the field look busier and could pull the eye from words]
  → Words keep full contrast on a slightly heavier scrim; figures are
  silhouettes (dark body, thin rim), never mid-tones; the light table keeps
  the west third of the field dark, so the crowd fades in rather than filling
  the frame.
- [Figures 3.3 lanes tall overlap far more; a lane-15 figure hangs into the
  foreground band] → `GORE_EXTRA` already lets gore land in rows 16..18; the
  foreground band is 4 rows so there is room. Nothing is clipped.
- [Per-frame op count roughly doubles for figures and the wall] → measured
  budget today is far under 16 ms; the render smoke script gains a timing guard
  at 40 zombies so a regression is caught before it ships.
- [Moving the HUD breaks card layouts pinned in `ui-layout.test.ts`] → the
  test is the point: run it, adjust the regions table, adjust card placement
  only if a card now collides.
- [A dark west edge hides a zombie's figure at spawn] → the word is never dim;
  a spawning zombie is always readable by its nametag. The reference does the
  same thing on purpose.
- [The wall widening from 2.3 to 5 columns eats into the survivor's ground]
  → the paving strip shrinks and the house wall replaces the junk; nothing the
  player interacts with lives there.
- [Static grain looks like dirt on the monitor on very large displays] →
  alpha is capped at 0.06 and the grain cell is scaled with `Metrics.scale` so
  it stays fine-grained rather than blocky.

## Migration Plan

Pure renderer change; no data, no settings schema, no save format. Ship in the
task order below so each step is visible on its own. Rollback is a git revert
of the change; nothing persists.

## Open Questions

- Whether the floodlight should flicker (a 1-in-200 frame dip of the light
  table's global multiplier). Cheap to add; decide by eye after D1 lands.
- Whether the combo counter should stay top-left in the sky and the zombies
  strip go elsewhere. Decide once the HUD block is drawn and compared.
