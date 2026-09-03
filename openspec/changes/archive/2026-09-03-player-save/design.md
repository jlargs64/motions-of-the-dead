## Context

Persistence today is two `try { localStorage } catch {}` blocks in `src/ui/ledger.ts` and `src/ui/settings.ts`. There is no version field, so a schema change would silently drop data. The renderer is canvas-only and `src/ui/screens.ts` draws no DOM, so file download and file pickup have nowhere to live yet; `main.ts` is the one file that owns the DOM.

Six later changes need a durable home: lifetime stats and medal counts, salvage, unlocks and equipped cosmetics, mission stars and best keystrokes, drill bests. The user has also said cloud sync behind Firebase auth and a one-time purchase are plausible later. Nothing here wires that in, but the shape of the save must not fight it.

Constraints: zero runtime dependencies, everything drawn must be printable ASCII (DECISIONS R11), the sim stays headless and never imports from `src/save`, existing tests keep passing, and `localStorage` may be missing or throw (private windows, Node harness).

## Goals / Non-Goals

**Goals:**
- One versioned blob, one key, one module that every other feature writes through.
- Import that cannot lose progress: a merge with clearly stated per-field rules.
- Export and import that work from a canvas game with no framework.
- Migration from `motd.ledger` and `motd.settings` that is idempotent and leaves the old keys in place.
- A shape that merges cleanly across devices later.

**Non-Goals:**
- Cloud sync, auth, or entitlements logic. Only the empty slot.
- Tamper resistance. A local save is the player's own file. A checksum detects corruption, not cheating. Leaderboards, if ever, need server-side validation and are out of scope.
- Any change to what the Ledger measures.

## Decisions

**D1. One key, one blob, `version: 1`.**
Alternative: keep per-feature keys. Rejected: export would have to enumerate keys, and every new feature would add a migration surface. A single blob means export is `JSON.stringify(save)` and import is one validation path.

**D2. Schema.**
```
{
  version: 1,
  createdAt: number, updatedAt: number,       // ms epoch
  lifetime: {
    motions: { [tok]: { used, kills } },        // from Ledger.data.motions
    missed:  { [tok]: number },                 // from Ledger.data.missed
    runs:    RunRecord[],                       // last 40, from Ledger.data.runs
    highScore: number,
    kills: number,
    medals: { [name]: number },                 // filled by medals-and-wallet
  },
  salvage: number,                              // filled by medals-and-wallet
  unlocks: string[],                            // filled by armory
  missions: { [id]: { stars: number, bestKeys: number } },   // filled by missions
  drills:   { [family]: { best: number } },     // filled by drills-and-coach
  settings: { gore, lineNumbers, equipped: { [slot]: id } },
  entitlements: {},                             // reserved
}
```
Every collection is keyed by string id rather than positional so later changes add keys without touching this module. Unknown keys on load are preserved, not stripped, so a newer export imported into an older build round-trips.

**D3. Merge rules, stated once and used for both import and (later) sync.**
- Counters (`motions.*.used`, `motions.*.kills`, `missed.*`, `lifetime.kills`, `lifetime.medals.*`, `salvage`): sum.
- Bests (`highScore`, `missions.*.stars`, `drills.*.best`): max. `missions.*.bestKeys`: min, since fewer keystrokes is better.
- Sets (`unlocks`): union.
- Lists (`runs`): concatenate, sort by `at`, dedupe on `at`, keep the last 40.
- Settings: the local copy wins unless the player chose "replace" at import, in which case the imported copy wins.
- `createdAt`: min. `updatedAt`: now.
Alternative: overwrite on import. Rejected: a player restoring an old backup onto a newer local save would lose the newer progress, which is the exact failure the feature exists to prevent. The player can still get overwrite semantics by choosing "replace" and clearing first.

**D4. Migration runs inside `load()` and is idempotent.**
If `motd.save` is absent and either legacy key exists, build a v1 blob from them and write it. Legacy keys are not deleted. Rationale: a rollback to the previous build keeps working, and the migration can be re-run harmlessly. A `migratedFrom: 'legacy'` marker is not stored; presence of `motd.save` is the marker.

**D5. Validation on import is structural, with a checksum for corruption.**
Export writes `{ ...save, checksum }` where `checksum` is a 32-bit FNV-1a over the canonical JSON of the blob without the checksum field. Import parses JSON, checks `version` is a known integer, checks the checksum, then coerces each field through the same defaults `load()` uses, so a hand-edited or partially corrupt file degrades to defaults per field instead of failing whole. A failed parse or a bad checksum produces one ASCII error line on the save screen, Vim-styled (`E484: Can't open file`, `E485: Can't read file`) to match the death screen's `E37`.

**D6. Export and import surfaces are DOM elements in `index.html`, driven by `main.ts`.**
- Download: a hidden `<a download="motd-save-<date>.json">` with a Blob URL, clicked programmatically.
- Clipboard: `navigator.clipboard.writeText` with the same JSON.
- File import: a hidden `<input type="file" accept=".json,application/json">`, triggered by a key on the save screen; contents read with `FileReader`.
- Paste import: `navigator.clipboard.readText` where permitted; as a fallback, a hidden `<textarea>` is focused so the player can paste, then Enter submits.
Alternative: draw a text box on the canvas and capture paste events. Rejected: keyboard-driven paste into a canvas is fragile across browsers, and two hidden elements are a smaller cost than a canvas text editor. The "no DOM in screens" rule stands: `src/ui/savescreen.ts` only draws; `main.ts` owns the elements.

**D7. Ledger and Settings become views over the save.**
`Ledger` takes a `SaveStore` in its constructor and reads and writes `save.lifetime`. `loadSettings`/`saveSettings` read and write `save.settings`. The `SaveStore` interface is `{ get(): Save; set(mutate: (s: Save) => void): void }` so writes are funneled through one place that stamps `updatedAt` and persists. Rationale: one write path is what makes a later Firestore store a drop-in.

**D8. Writes are debounced, not synchronous.**
`set()` mutates in memory and schedules a persist on the next macrotask; `beforeunload` and `visibilitychange` flush. Rationale: medals and drills will write several times a second. localStorage writes are synchronous and the game runs at 60 Hz.

**D9. The save module never imports from `src/sim`, and `src/sim` never imports from `src/save`.**
The harness and the replay chain run with no save at all. Keeping the sim ignorant of persistence is what keeps `verify:browser` meaningful.

## Risks / Trade-offs

- [localStorage quota with 40 runs plus growing collections] -> the blob is well under 100 KB at the caps in D2; `runs` is capped and every other collection is bounded by the number of motions, missions, drills and cosmetics, all of which are small constants.
- [Clipboard APIs are permission-gated in Firefox and unavailable on `file://`] -> download and file picker are the primary path; clipboard is the convenience path and its failure shows one error line.
- [A player imports a save from a newer build] -> unknown keys are preserved and `version` greater than known shows a warning line but still merges known fields.
- [Merge sums a counter the player already has, doubling stats if they import their own export] -> `runs` dedupes on timestamp, but plain counters would double. Mitigation: the export carries `exportedAt` and an `id` (random 64-bit at `createdAt`); importing a file whose `id` matches the local save offers "this is your own backup" and switches the default action to replace. Sums remain correct for merging two different devices.
- [Debounced writes lose the last second on a hard crash] -> acceptable; the flush on `visibilitychange` covers tab close and navigation.

## Migration Plan

1. Ship the module and the migration in `load()`. First launch on an existing browser reads the legacy keys, writes `motd.save`, and behaves identically.
2. Rollback: the previous build still reads `motd.ledger` and `motd.settings`, which were never deleted. Progress made on the new build after migration is not visible to the old build, which is acceptable for a rollback window.
3. Removing the legacy read path is a later cleanup, not part of this change.

## Open Questions

- Should "replace" import also be offered as a first-class "reset progress" on the save screen? Leaning yes, behind a `:reset!`-style confirmation to match the game's command-line bit.
- Default filename date format: ISO date only, or date and time? Leaning date and time so two exports in one day do not collide.
