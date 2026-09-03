## Why

The Motion Ledger already knows which Vim the player avoids: after every kill it brute-forces the cheapest command that would have worked and records, lifetime, every motion that was optimal and never pressed. That knowledge is shown once, on the death screen, and then buried. A player who leans on `hjkl`, `w`, `dw` and `G` has no way to find out that `f`, `t`, `;`, `$` and the text objects are where their keystrokes are going, and no place to practice them without dying to wave 11 first. The game needs a coach that reads the ledger and a set of drills that turn its verdict into a sixty-second loop with a score.

## What Changes

- **The Coach**: a ranking of the motions the player most needs, computed from the save's lifetime `missed` counts weighted against lifetime `used`, grouped into drill families that mirror the curriculum sections in `src/sim/waves.ts`. The top three are shown on the drills screen, the ledger screen and the death screen.
- **A placement drill**: one of the families is the survival store's placement mode, scored on whether the span you planted matches the span you were ordered to plant. It is the only family that is not a kill, and the only context in the game where a counted motion is the *only* way to do the thing (design D9). Boot-camp mission 8 teaches the mechanism; this is where it gets reps.
- **Drills**: a new `drill` game mode. One drill per family. A drill is a sixty-second sprint through procedurally generated scenes, each verified by the oracle in `src/sim/optimal.ts` so that the cheapest kill genuinely uses the family's motion. Frozen horde, invulnerable wall, seeded RNG. Score is kills and PERFECT rate. Personal bests persist in the save under `drills` and pay salvage.
- **The Ledger screen**: a lifetime stats page reachable from the main menu, with the per-motion used / kills / missed table, keystrokes-per-kill trend, medal counts, and the coach's top three with a one-key jump into the matching drill.
- **Shared kill-judgement module**: the ledger's anchor-and-optimal comparison moves out of `src/ui/ledger.ts` into `src/sim` so the sim (PERFECT medal, drills) and the UI (ledger) judge a kill with the same code.
- **Oracle extension**: `optimalKill` gains search candidates (`*`, `#`, `/word<CR>`) so the search family can be verified. Additive; existing verdicts for non-search scenes are unchanged.

## Capabilities

### New Capabilities
- `coach`: ranking of motions to practice from lifetime ledger data, drill families, and where the recommendation is shown.
- `drill-mode`: the sixty-second sprint, procedural scene generation with oracle verification, scoring, persistence of bests, salvage payout.
- `ledger-screen`: the lifetime stats page in the main menu.
- `kill-judgement`: the shared module that decides, for one kill, what the player spent versus what the oracle says it cost, consumed by the ledger, the PERFECT medal and drills.

### Modified Capabilities
- None. The existing specs under `openspec/specs/` cover rendering of the field, barricade, figures, lighting and HUD; none of their requirements change.

## Impact

- `src/sim/optimal.ts`: search candidates added to the candidate set; `tokensUsed` unchanged.
- `src/sim/`: new `judgement.ts` (anchor snapshot and optimal comparison, moved from the ledger), new `drills.ts` (families, scene templates, generation, verification, sprint rules), new `coach.ts` (ranking), and `cheapestPlacement` beside the family table for the placement family's PERFECT rule.
- `src/sim/store.ts`, `src/sim/traps.ts`: read-only consumers. The placement family drives the real `Sim.shopCommand` placement path rather than a copy of it, exactly as boot-camp mission 8 does.
- `src/ui/ledger.ts`: becomes a thin consumer of `judgement.ts` and the save; no longer owns localStorage.
- `src/ui/screens.ts`: drills screen, ledger screen, drill end card; death screen gains the coach line.
- `src/core/state.ts`: `SimState` gains additive drill bookkeeping (drill id, time left, scenes cleared, perfect count, scene RNG state). `mode` itself is owned by `main-menu`.
- `src/harness/api.ts`, `src/harness/format.ts`: `text()` reports the drill clock and score so an agent can play a drill.
- Tests: family verification over many seeds, determinism of a drill under a fixed seed, coach ranking fixtures, layout assertions for the new cards, ASCII assertion over every new string.
- Depends on `player-save` (save blob), `main-menu` (`SimState.mode`, menu entries), `medals-and-wallet` (PERFECT medal, salvage), and `survival-store` (placement mode, the survey grid, `Trap`).
