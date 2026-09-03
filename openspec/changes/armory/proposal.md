## Why

Survival now pays two currencies (`medals-and-wallet`): a run wallet spent at the store, and lifetime **salvage** that nothing spends yet. Salvage needs a sink that gives a player something to aim for across runs without touching difficulty. The armory is that sink: cosmetics, bought with salvage, equipped from the main menu, previewed live. The headline item is the word pack, because the zombies *are* words and swapping the vocabulary is the most visible skin the game can have.

## What Changes

- New **Armory** screen reachable from the main menu (`main-menu` owns the entry and its `N new` badge). Navigated with `j`/`k` across slots and `h`/`l` across items in a slot; Enter buys an unowned item or equips an owned one; Esc returns to the menu.
- New **cosmetic slot** system. Each slot has a default item that is always owned and a list of purchasable items priced in salvage. Slots: palette, crosshair, guns (tracer and muzzle per operator), kill dissolve, barricade material, survivor silhouette, death lines, sound preset, callout voice, word pack.
- Purchases move an item id into `unlocks` and subtract salvage in the `motd.save` blob owned by `player-save`. Equipped items live in `settings.equipped`, a slot-to-item map, also in the save blob.
- The armory card shows a **live preview** of the focused item: the field behind the card re-renders with the candidate palette, crosshair, barricade, survivor and dissolve; the sound preset plays its kill sample; the word pack shows five sample words in the five zombie kinds.
- **Word packs**, the one cosmetic that reaches the sim. A pack is a vocabulary table with the same shape as `src/sim/words.ts`. The selected pack id is run config stored additively in `SimState` and written into the harness `init` log line so replays stay deterministic. The smoke bot and every existing test run on the default pack. Required packs: the default horror pack; Go, Python, C, Rust, JavaScript/TypeScript, and a Polyglot mix; Memes; Corporate; Lovecraft; Shakespeare insults.
- Word pack entries are constrained so every word is exactly one Vim word: `[A-Za-z0-9_]+` only. That bans spaces, brackets, quotes, backticks and every other punctuation character, which keeps the armored wrapper, text objects, `f`/`t`, `w`/`W` and `*`/`#` semantics intact. A test enforces the constraint and the kind rules over every pack.
- Guns are cosmetic names on existing operators: `x` pistol, `dw`/`cw` rifle, `dd` shotgun spread, `D` flame. They change tracer shape, muzzle flash and the shot sound. They change nothing about what the command does.

No rule of play changes. Zero runtime dependencies. Everything rendered stays printable ASCII (DECISIONS R11). `src/sim` continues to import nothing from `render`, `audio` or `ui`.

## Capabilities

### New Capabilities
- `armory-screen`: the menu screen for browsing, previewing, buying and equipping cosmetics with salvage.
- `cosmetics`: the slot and item registry, what each slot controls in the renderer, audio and UI layers, and how the equipped set is applied and persisted.
- `word-packs`: sim-side vocabulary packs, their content rules, the run config that selects one, and the determinism guarantees around it.

### Modified Capabilities
- `zombie-figures`: figure kind is currently derived from `kind` and word length; with word packs the length thresholds for bloater and crawler figures must follow the pack tables rather than the default vocabulary. Requirement text is adjusted, not the drawn figures.

## Impact

- `src/ui/`: new `armory.ts` screen, new `cosmetics.ts` registry; `screens.ts` gains the armory card; `deaths.ts` reads the equipped death line pack.
- `src/render/`: `palette.ts` gains named palette variants; `renderer.ts`, `fx.ts`, `figures.ts`, `particles.ts` take an `equipped` style object for crosshair, guns, dissolve, barricade and survivor.
- `src/audio/audio.ts`: kill and shot profiles become a preset table; a `preset` setter.
- `src/sim/words.ts`: becomes a registry of packs; `wordFor(kind, rng, pack)`. `src/sim/sim.ts` reads the pack id from `SimState`. `src/core/state.ts` gains an additive optional `wordPack` field on `SimState`, recorded in DECISIONS.
- `src/harness/`: `Game` accepts a `wordPack` option; `cli.ts` writes it on the `init` line; `scripts/replay.ts` and `scripts/browser-replay.mts` read it back.
- `src/main.ts`: applies the equipped set at boot and on change; passes the equipped word pack into survival runs.
- Tests: pack validation test, kind rule test per pack, layout test for the armory card, replay test with a non-default pack, render smoke over every palette.
- Depends on `player-save` (save blob, salvage, unlocks, settings), `main-menu` (entry, badge, navigation conventions), `medals-and-wallet` (salvage income).
