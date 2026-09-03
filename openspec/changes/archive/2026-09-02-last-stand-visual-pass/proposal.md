## Why

`src/render/NOTES.md` names The Last Stand (Con Artist Games, 2007) as the art
direction target, but the rendered game does not get there. Screenshots of the
current build show a flat, evenly lit green field with 5%-of-screen-height stick
figures, a neat vertical plank strip for a barricade, a blank grey slab filling
the right quarter of the screen, a visible line-number gutter with lane stripes,
and a plain monospace HUD. It reads as a text editor with scenery behind it. The
reference reads as a place: one hard light source, tall ragged silhouettes
walking out of the dark, a hand-built junk-heap barricade, a grungy HUD. The
composition (horde from the west, wall and survivor on the east, treeline,
vignette, nametag scrims) is already right and is kept; this change closes the
gap in lighting, scale, set dressing, and chrome.

## What Changes

- **Lighting.** A single hard light source on the barricade side (a floodlight
  on a post) baked into the back layer as a cone falling west across the field,
  with the spawn edge dropping to near-black. Figures are shaded by their
  distance from the light. The muzzle flash briefly lights the figures nearest
  the shot.
- **Figures.** Zombie figures scale from ~1.3 cells to ~3.2 cells tall, drawn
  as hunched, ragged silhouettes with a lit rim on the light-facing side and per-
  zombie height and coat variation. Words stay above the head on their scrim and
  remain the crispest thing on screen. The survivor scales to match.
- **Barricade and east ground.** The barricade becomes a leaning junk heap
  (angled planks, sandbags, tyres, a fridge, a car door, a chain-link section)
  spanning roughly columns 50 to 55, degrading and breaching per lane as today.
  The grey paving shrinks to a narrow strip; a dark house wall with one lit
  window stands behind the survivor, and the floodlight post is part of it.
- **Field reads as ground, not a buffer.** Lane banding stripes are removed
  from the bake in favour of trodden ruts. The line-number gutter stays (it is
  the count for `j`/`k` and part of the pedagogy) but loses its scrim and shrinks
  to a scratched-in marker style. The cursor's lane tint remains the `j`/`k`
  cue.
- **HUD and chrome.** `WAVE n` becomes `NIGHT n` to match the title and wave
  cards. Barricade HP is drawn as a cracked bar with the numeral, charges as a
  magazine strip, and a zombies-remaining strip runs along the top edge. A faint
  static film-grain and a heavier corner vignette are added to the front layer.
  The death card reads "YOU DID NOT SURVIVE THE NIGHT".
- **Non-changes.** No new runtime dependencies, no assets, no fonts, no network.
  Grid geometry, `Metrics`, the public text API used by `src/ui/screens.ts`, the
  sim, and the harness are untouched. Gore levels keep their current meaning.

## Capabilities

### New Capabilities
- `scene-lighting`: a single baked light source, distance-based figure shading, and muzzle-flash illumination of nearby figures.
- `zombie-figures`: the tall silhouette figure style, per-kind and per-zombie variation, scale, and the guarantee that words stay legible above them.
- `barricade-set`: the junk-heap barricade, its per-lane degradation and breach look, the survivor's ground, house wall, and floodlight post.
- `field-surface`: the removal of editor tells from the play field: no lane stripes, restyled gutter, cursor lane tint as the only lane cue.
- `hud-chrome`: the NIGHT label, barricade bar, charge strip, zombies-remaining strip, film grain, and death-card wording.

### Modified Capabilities
<!-- openspec/specs/ is empty; there are no existing specs to modify. -->

## Impact

- `src/render/scene.ts`: back-layer bake gains the light cone and the darkened
  west edge, loses lane banding, replaces paving/junk with the house wall,
  floodlight post and narrow strip. Front-layer bake gains grain and a heavier
  vignette.
- `src/render/figures.ts`: new figure geometry and shading input; `FIG_H`,
  `FIG_W`, `figureHeightCells`, `drawZombie`, `drawSurvivor`, `SURVIVOR_H`.
- `src/render/renderer.ts`: `FIG_HEAD_GAP` and per-lane figure placement,
  barricade drawing (`WALL_X0`/`WALL_X1` widen), survivor position, HUD block,
  gutter style, muzzle-flash figure lighting, `waveStr` text.
- `src/render/palette.ts`: light, shadow, rust, chain-link and house-wall
  colours; pre-baked `rgba()` strings for shading steps.
- `src/ui/screens.ts` and `src/ui/deaths.ts`: death-card headline.
- `src/render/NOTES.md`: regions the renderer owns move (barricade widens, HUD
  block changes), and the figure and lighting sections are rewritten.
- Tests: `tests/ui-layout.test.ts` pins card layout against renderer-owned
  regions and must be re-run; `scripts/render-smoke.mts` must still pass at
  every gore level and viewport it covers.
- Performance budget: figures grow from ~4 to ~8 canvas ops each, so 40 zombies
  is ~320 ops per frame; still within the current per-frame budget. Nothing new
  is computed per frame in the scene.
