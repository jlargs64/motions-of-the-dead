## 1. Screenshot harness and baseline

- [x] 1.1 Add `scripts/shot.mts`: builds, serves `dist/`, writes a `shot.html` that calls `window.__motd.start()`, `step(ms)`, `pause()`, and screenshots with headless Chrome at 1600x900 for title, wave 1 at 18 s, and wave 2 at 95 s (seed 7) into `runs/shots/`
- [x] 1.2 Add `npm run shot` and capture the pre-change baseline into `runs/shots/baseline/`
- [x] 1.3 Add a 40-zombie frame-time guard (< 8 ms) to `scripts/render-smoke.mts`

## 2. Lighting

- [x] 2.1 Add `light`, `lightWarm`, `shadowWest`, and 6-step `figBody[]` / `figRim[]` ramps to `src/render/palette.ts`
- [x] 2.2 Bake the floodlight cone, westward darkening wash and heap shadow into `Scene.bakeBack`, with a shared `lightFalloff(col)` function exported from `scene.ts`
- [x] 2.3 Build `lightAt: Float32Array(60)` in `Renderer.resize()` from `lightFalloff` and pass a `shade` argument through `drawZombie`
- [x] 2.4 Apply the muzzle-flash boost to figures near the shot span during the 60 ms window using the existing `Fx` shot ring
- [x] 2.5 Run `npm run shot`, confirm the west edge is near-black and figures darken with distance; `npm test` and `npm run smoke:render` pass

## 3. Figures

- [x] 3.1 Update `FIG_H`, `FIG_W`, `FIG_LEAN` and rewrite `drawZombie` as silhouette + east rim + head + ground shadow with `hash3`-driven per-zombie height, hunch, hem and head variation
- [x] 3.2 Keep the armoured plate, runner lean, bloater gut and prone crawler readable at every shade step
- [x] 3.3 Raise scrim core alpha to 0.70 and confirm `FIG_HEAD_GAP` clearance with the new heights
- [x] 3.4 Scale `drawSurvivor` to `SURVIVOR_H = 5.5`, move to column 55.6 / feet row 12.2 on a pallet step, verify aim and muzzle output
- [x] 3.5 Run `npm run shot` and the smoke timing guard; adjust op count if over budget

## 4. Barricade and east set

- [x] 4.1 Bake the house wall, lit window, floodlight post and narrow paving strip; remove drums and crates from `bakeJunk`
- [x] 4.2 Widen the wall to columns 50.0..55.0 and draw per-lane leaning planks with deterministic angles keyed on `(lane, index)`
- [x] 4.3 Draw the four lane-group props (chain-link, car door, fridge, tyres) with level-based degradation: full, minus one plank, outline plus splinters, stub, breach
- [x] 4.4 Re-attach sandbags, barbed wire (intact lanes only), breach glow and `wallGore` caking to the new geometry
- [x] 4.5 Run `npm run shot` at full HP and at 40% HP and confirm bottom-up failure reads correctly

## 5. Field surface

- [x] 5.1 Remove lane banding from `bakeBack` and add 3 to 4 trodden ruts at deterministic non-lane-aligned rows
- [x] 5.2 Restyle `drawGutter`: no scrim, scale 0.8, dim colour with a 1 px dark offset, current lane amber; `lineNumbers` setting untouched
- [x] 5.3 Confirm the cursor lane tint is still clearly visible over the new ground

## 6. HUD and chrome

- [x] 6.1 Change `waveStr` to `NIGHT n` and grep the renderer and UI for any remaining `WAVE` string
- [x] 6.2 Draw the top-left status block: NIGHT label, cracked barricade bar with thresholds, HP numeral, `dd` / `D` magazine strip, mute glyph beside the label
- [x] 6.3 Draw the zombies-remaining strip along the top edge from wave totals and the alive count
- [x] 6.4 Move the combo counter to column 46, bottom-anchored at row -2.6, and verify no overlap with the strip at combo 18+
- [x] 6.5 Bake static grain (alpha 0.04..0.06, scaled by `Metrics.scale`) and the 0.55 corner vignette into `bakeFront`
- [x] 6.6 Change the death card headline in `src/ui/screens.ts` to `YOU DID NOT SURVIVE THE NIGHT` and refit the card

## 7. Verification and docs

- [x] 7.1 Update the "regions the renderer owns" table, figure, lighting, barricade and HUD sections in `src/render/NOTES.md`
- [x] 7.2 Run `npm run verify` (tests, build, smoke, render smoke, replay, browser replay) and fix anything `tests/ui-layout.test.ts` flags
- [x] 7.3 Capture final `npm run shot` set and compare side by side with `runs/shots/baseline/`
