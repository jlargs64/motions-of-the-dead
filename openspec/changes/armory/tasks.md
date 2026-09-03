## 1. Registry and save wiring

- [ ] 1.1 Create `src/ui/cosmetics.ts` with `SLOTS`, item ids, prices (tunable constants), `resolveEquipped(save)`, `affordableUnowned(save)`
- [ ] 1.2 Add a registry test: unique ids, default first with price 0, at least two items per slot
- [ ] 1.3 Read and write `salvage`, `unlocks`, `settings.equipped` through the `player-save` API; add a test for buy, cannot-afford and equip transitions

## 2. Renderer style

- [ ] 2.1 Define `Style` and `Renderer.style`; refactor `drawGame` and helpers to read style instead of module constants
- [ ] 2.2 Split `palette.ts` into named palette tables baked once at load; add moonlit, sodium, bloodmoon, terminal, paper
- [ ] 2.3 Add a palette completeness test and extend `scripts/render-smoke.mts` to every palette at every gore level
- [ ] 2.4 Extend the layout test ink contrast check to run per palette
- [ ] 2.5 Crosshair glyphs: block, underscore, bracket pair, beam; keep lock-on unchanged
- [ ] 2.6 Barricade materials in `figures.ts`: timber, sandbags, bookshelves, hash wall; HP ramp shared
- [ ] 2.7 Survivor silhouettes in `figures.ts`, same `SURVIVOR_H`

## 3. Guns and dissolves

- [ ] 3.1 Define `GunSet`; `Fx.addShot` takes an optional operator; `main.ts` pairs the `command` and `shot` events from one bus drain
- [ ] 3.2 Tracer shapes line, dots, spread, flame, arrow and muzzle styles in `fx.ts` and `renderer.ts`
- [ ] 3.3 Dissolve recipes in `particles.ts`: chunks, ash, static, redacted; gore gating preserved; gore off stays bloodless
- [ ] 3.4 Test: the same replay log produces a byte-identical final state under every gun set

## 4. Audio, voices, death lines

- [ ] 4.1 Turn kill profiles, key click and shot sounds into `SoundPreset` tables: field, arcade, hush, typewriter; `Audio.preset` setter
- [ ] 4.2 Voice tables announcer, vim, deadpan covering every medal from `medals-and-wallet`; export `voice(medal)`
- [ ] 4.3 Death line packs in `deaths.ts`, unioned with reactive lines when equipped
- [ ] 4.4 Extend the ASCII test over voices and death packs

## 5. Word packs

- [ ] 5.1 Refactor `src/sim/words.ts` into `WORD_PACKS` and `wordFor(kind, rng, pack)`; horror equals the current arrays
- [ ] 5.2 Write the go, python, c, rust, javascript, polyglot, memes, corporate, lovecraft, shakespeare pools
- [ ] 5.3 Pack test: `^[A-Za-z0-9_]+$`, length ranges per kind, minimum pool sizes, armorable non-empty, 500-spawn `w` check per pack
- [ ] 5.4 Add `wordPack?` to `SimState` (additive), set in `Sim.start(opts)`; record in DECISIONS.md
- [ ] 5.5 `Game` accepts `wordPack`; `cli.ts` writes it on `init`; `repl.ts` `newRepl` passes it; `replay.ts` and `browser-replay.mts` read it, defaulting to horror
- [ ] 5.6 Check in a rust-pack replay log under `runs/` and add a replay test for it; confirm `npm run smoke` output is unchanged
- [ ] 5.7 `figures.ts`: `figureKind` prefers `kind`, length fallback only when kind is absent; update `zombie-figures` spec

## 6. Armory screen

- [ ] 6.1 Create `src/ui/armory.ts`: two-axis focus model, `feedKey`, `click(cell)`, buy and equip actions
- [ ] 6.2 Draw the card in `screens.ts`: header with salvage, slot column, item row with equipped, owned, price and red unaffordable states
- [ ] 6.3 Preview: temporary style override for the idle field; synthetic shot and kill burst every two seconds for guns and dissolves; five sample words for packs; one-shot sound on focus
- [ ] 6.4 Wire the `armory` menu entry and the `N new` badge via `affordableUnowned`
- [ ] 6.5 Layout test over every slot focused with the longest label and price
- [ ] 6.6 `main.ts`: apply resolved style, sound preset, voice and death pack at boot and after every change; pass the equipped word pack into survival runs

## 7. Verify

- [ ] 7.1 `npm run verify` green, including the new palette smoke and the rust replay
- [ ] 7.2 Update README (Armory section, word packs, save fields) and DECISIONS.md (word pack in SimState, kind before length, guns are cosmetic)
