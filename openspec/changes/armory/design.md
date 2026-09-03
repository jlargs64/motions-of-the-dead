## Context

The renderer already has every colour in one `PALETTE` object with pre-baked rgba slots (`src/render/palette.ts`), a parametric particle system with a glyph atlas and a chunk atlas (`particles.ts`), a shot model with muzzle and tracer timings (`fx.ts`), and table-driven figures (`figures.ts`). Audio is fully synthesized from per-kind kill profiles (`audio.ts`). The vocabulary is four constant arrays plus a wrap table in `src/sim/words.ts`, consumed at exactly one call site in `sim.ts`. Death lines are a reactive table in `ui/deaths.ts`. Every one of these is already data. The armory mostly turns constants into tables and adds a selector.

Constraints that bind this design:
- `src/sim` and `src/vim` import nothing from `render`, `audio` or `ui`. The sim may know a word pack. It may never know a palette.
- Replays are byte-identical across headless and browser builds. Any input to the sim, including vocabulary, has to be in the log.
- Everything drawn goes through a 32..127 glyph atlas (R11). Word packs and labels are ASCII.
- Zero runtime dependencies. No fonts, no images, no audio files.
- The save blob, its `salvage`, `unlocks` and `settings.equipped`, belongs to `player-save`. This change reads and writes through its API and adds no storage keys.

## Goals / Non-Goals

**Goals:**
- A salvage sink that is visible from the first run and grows with the player.
- Cosmetics that change how the game looks, sounds and reads, never how it plays.
- Word packs that stay Vim-correct: every entry is one word under `w`, one WORD under `W`, and has no delimiter the text object or armor code could mistake.
- Live preview on the card so buying is never blind.
- Determinism preserved: a replay log names its pack, and the verify chain proves the pack made no difference to the sim contract.

**Non-Goals:**
- Anything that changes speed, waste allowance, charges, wall HP or scoring. Those belong to `survival-store` and are consumables, not cosmetics.
- Player-authored word packs or importing packs from files. A later change can add it; the registry shape leaves room.
- Cloud sync of purchases. `player-save` designs the blob to merge; this change only writes set-union fields (`unlocks`) and a scalar (`salvage`).
- Localisation. Packs are English and ASCII.

## Decisions

**D1. One registry, ten slots, items are plain data.**
`src/ui/cosmetics.ts` exports `SLOTS: Slot[]` where a slot is `{ id, label, items: Item[] }` and an item is `{ id, label, blurb, price }`. The first item in every slot is the default and has price 0. Item ids are globally unique strings like `palette.bloodmoon`, `words.rust`, `guns.flame`. `unlocks` stores item ids. `settings.equipped` maps slot id to item id, missing keys mean the default. Alternative considered: a per-slot enum in `Settings`. Rejected because adding a slot would then be a settings schema change; a map is open.

**D2. The renderer takes a `Style` object, not ten setters.**
`Renderer.style: Style` where `Style = { palette: PaletteName; crosshair: CrosshairGlyph; guns: GunSet; dissolve: DissolveKind; barricade: BarricadeMaterial; survivor: SilhouetteKind }`. `main.ts` derives `Style` from `settings.equipped` through `cosmetics.ts` and assigns it once at boot, once per change, and once per preview frame. The draw loop reads `this.style` and allocates nothing. Alternative: mutate `PALETTE` in place. Rejected because pre-baked rgba slots are derived from it and would need a rebake pass every swap; instead each named palette is baked once at module load into its own slot table and the renderer holds a reference.

**D3. Palettes are full tables, not tints.**
Each palette variant supplies every key of `PALETTE`. Moonlit is the current default. Sodium lamp warms the light and greys the field. Blood moon reddens sky and fog. Terminal green is a monochrome phosphor look and the one palette where `bone`, `dim` and `white` collapse toward one hue, so the layout test that asserts card ink contrast (R10) runs over every palette. Paper inverts to a daylight notebook look and must keep the field readable; a render smoke over all five palettes at all three gore levels is added to `scripts/render-smoke.mts`.

**D4. Guns are operator-keyed style, applied at the `shot` event.**
`GunSet` maps `x | d | c | dd | D | J` to `{ tracer: 'line' | 'dots' | 'spread' | 'flame' | 'arrow'; muzzle: 'flash' | 'puff' | 'bloom'; sound: SoundId }`. The `shot` event does not carry the operator, so `Fx.addShot` gains an optional operator argument that `main.ts` supplies from the preceding `command` event on the same bus drain. The sim is untouched. Alternative: add `operator` to the `shot` event. It is an additive field on a frozen contract and would be recorded in DECISIONS; deferred until something in the sim needs it.

**D5. Kill dissolves are particle recipes.**
`DissolveKind` selects a recipe in `particles.ts`: chunks (current), ash (K_GLYPH particles, P_GHOST, upward drift, grey ramp), static (glyphs jitter in place and fade, no gravity), redacted (a black bar sweeps the word left to right, P_STICK). Gore level still gates blood; a dissolve chooses shape, gore chooses fluids. `off` gore with the chunks dissolve keeps the existing clean grey fade so the R8 promise holds.

**D6. Barricade material and survivor silhouette are figure tables.**
`figures.ts` already draws from Float32Array tables. Each material is a glyph ramp plus a colour trio; each silhouette is a pose table with the same `SURVIVOR_H`. No new drawing primitives.

**D7. Sound presets are profile tables and a master tone.**
`audio.ts` kill profiles and the key click become `SoundPreset = { kills: Record<ZombieKind, Profile>; click: Profile; shots: Record<SoundId, Profile> }`. Presets: field (current), arcade (square waves, shorter decays), hush (low amplitude, soft attacks), typewriter (click-heavy, kills are carriage returns). The preview plays the walker kill of the focused preset once.

**D8. Callout voice and death lines are string tables selected by id.**
`medals-and-wallet` renders callouts through a `voice(medal): string` lookup; this change supplies the tables: announcer (`TRIPLE KILL`), vim (`E486: Pattern not found` on a miss, `3 fewer lines` on a lane wipe), deadpan (`fine.`). Death line packs add pools to `deaths.ts` that are unioned with the reactive lines when equipped.

**D9. Word packs live in the sim and are the only cosmetic that does.**
`src/sim/words.ts` exports `WORD_PACKS: Record<WordPackId, WordPack>` where `WordPack = { id; label; walkers; runners; bloaters; crawlers; armorable? }` and `wordFor(kind, rng, pack)`. `SimState` gains `wordPack?: WordPackId` (additive, optional, default `'horror'`), set by `Sim.start(opts)` before the first spawn. `Game` accepts `{ wordPack }`; `cli.ts` writes it on the `init` line; `replay.ts` and `browser-replay.mts` pass it back. `agent-smoke.ts` stays on the default. A replay test runs seed 1 on the `rust` pack headless twice and asserts identical final state, and asserts that the kind of every spawned zombie matches its pool.

**D10. Pack content rules are enforced by a test, not by trust.**
Every entry in every pool must match `^[A-Za-z0-9_]+$`. That single rule guarantees: one Vim word and one WORD per zombie, no armor delimiters (`() [] {} " '` and backtick) inside a body, nothing that pairs with `%`, nothing the naive quote pairing (DECISIONS #16) could catch, and nothing outside the glyph atlas. Kind rules per pool: crawlers are exactly 1 character; runners are 2..5 characters; bloaters are 8 or more and at most 12 so `(word)` armor and a 52-column lane stay sane; walkers are 3..7; `armorable` defaults to walkers of length 6 or less and must be non-empty. Pools must have at least 8 entries each except crawlers, which need at least 6, so `*`/`#` families still form. Digits are allowed so `x86`, `utf8`, `i32` and `404` can be zombies; a leading digit is legal because the engine never parses a count out of a buffer.

**D11. Pack contents.**
- horror: the current pools, unchanged.
- go: `func chan defer range struct select interface goroutine nil panic recover iota`; runners `go err ok len cap map`; crawlers from single-letter receivers.
- python: `def self yield lambda import except finally __init__ __name__ decorator generator comprehension`; runners `pip def len str int`.
- c: `malloc calloc sizeof struct typedef static extern volatile pointer segfault`; runners `int ptr char void`.
- rust: `borrow unwrap mutable lifetime impl trait match enum Option Result expect clone`; runners `fn mut let ref Box Vec`.
- javascript: `undefined prototype closure promise callback async await typeof hoisting NaN`; runners `let var npm dom fetch`.
- polyglot: a mix drawn from all five language packs.
- memes: ASCII, PG-13, no slurs, no trademarked character names: `doge stonks bonk yeet sus bruh cringe based ratio copium hopium hodl rickroll smol chonk npc touchgrass poggers`; bloaters like `understandable`, `unbelievable`. Each entry is reviewed against the content rule and a plain-language taste rule: nothing that targets a group of people.
- corporate: `synergy leverage pivot bandwidth deliverable stakeholder alignment runway onboarding circleback`.
- lovecraft: `eldritch cyclopean squamous gibbous noisome blasphemous antediluvian ichor`.
- shakespeare: `knave varlet cur lout coxcomb malapert dotard fustilarian rampallian canker`.
Exact lists are finalised in implementation under D10; the test is the contract.

**D12. Preview is a real render with a temporary style.**
While the armory card is focused on an item, `main.ts` renders the field behind the card with `Style` overridden for that one slot, then restores. The field on the menu is the idle barricade at night, so palette, barricade and survivor previews are exact. For dissolve and guns the preview fires a synthetic `shot` and `kill` into `Fx` and `Particles` every two seconds against a stand-in word drawn in the preview lane; nothing is emitted on the bus and the sim is not running. For word packs the card prints one sample per kind: crawler, runner, walker, armored, bloater, taken deterministically as the first entry of each pool so the layout test can pin widths.

**D13. Buying is one Enter, no confirm, refund by re-buy is impossible.**
Prices are small relative to income (`medals-and-wallet` targets roughly 30 to 80 salvage per run early on). Palettes 120, crosshairs 60, guns 150 per set, dissolves 100, barricades 100, silhouettes 80, death lines 60, sound presets 90, voices 60, word packs 200 for languages and 250 for memes and polyglot. All tunable constants in `cosmetics.ts`. An unaffordable item shows its price in red and Enter does nothing but flash. Alternative: confirm dialog. Rejected; it adds keystrokes to a game about fewer keystrokes.

**D14. Menu badge counts affordable unowned items.**
`main-menu` shows `N new` next to armory. `cosmetics.ts` exports `affordableUnowned(save): number` so the badge means "you can buy something right now", which is the only version of the badge that pulls a player in.

## Risks / Trade-offs

- [Paper and terminal palettes break field legibility] -> render smoke over every palette at every gore level; layout test asserts card ink contrast per palette; a palette that fails ships disabled.
- [A word pack entry breaks Vim semantics] -> D10 regex test over every pool; a second test spawns 500 zombies per pack and asserts `w` from the start of each lands exactly on the next zombie.
- [Non-default pack diverges browser from headless] -> pack id on the `init` line; `verify:browser` runs the newest log's pack; a fixed test log on the `rust` pack is checked in under `runs/`.
- [Bloater and crawler figure selection keyed on length misfires for a pack] -> `figureKind` prefers `kind` over length and the length fallback is only for tests that build zombies without a kind; spec delta on `zombie-figures` records it.
- [Meme vocabulary ages or offends] -> content rule in D11, list reviewed in PR, one pack is trivial to edit; no user-authored packs in this change.
- [Preview firing synthetic particles allocates in the draw loop] -> preview uses the same pooled `Particles` and respects `PARTICLE_CAP`; fires at most one burst per two seconds.
- [Ten slots overwhelm a new player] -> slots are listed in the order a player notices them: word pack, palette, guns first; locked-looking items are never hidden, only priced.

## Migration Plan

- Existing players have an empty `unlocks` and no `equipped` map; defaults apply and nothing they see changes.
- Old replay logs have no `wordPack` on the `init` line; readers default to `horror`.
- Rollback is removing the menu entry; the save fields are additive and harmless.

## Open Questions

- Should salvage spent be recorded for a lifetime stat and a death line (`Died with 900 salvage unspent. Window shopper.`)? Leaning yes, one field in the save, owned by `player-save`.
- Should the `shot` event carry the operator (D4 alternative) so the harness `text()` can print the gun name? Defer until the harness wants it.
