## Context

`src/ui/ledger.ts` snapshots the field at the first command after each kill, counts keystrokes until the next kill, then calls `optimalKill(buffer, cursor, target, charges)` from `src/sim/optimal.ts`. It records lifetime `motions[tok].used`, `motions[tok].kills` and `missed[tok]` in `localStorage` under `motd.ledger`. After `player-save` lands, that data lives in the save blob under `lifetime` and the ledger no longer owns storage.

`optimalKill` narrows to row candidates, a per-column cheapest-keystroke map, and the operators that kill the target's kind, then verifies every candidate through the real `VimEngine` and `resolve`. Its candidate set covers `h j k l w b e W B E 0 ^ $ f t F T ; , { } G gg H M` with counts, the operators in `OPS_BY_KIND`, and the text objects. It does not include `/`, `?`, `*`, `#`, `n`, `N`. A charge is worth `CHARGE_PENALTY = 3` keystrokes, refunded two per extra victim.

`src/sim/tutorial.ts` defines a scripted scene as `[kind, lane, col, text, speed][]`. `src/core/rng.ts` is a seeded, state-exposing RNG whose cursor already lives in `SimState.rngState`.

`main-menu` introduces `SimState.mode: 'survival' | 'mission' | 'drill'`. `medals-and-wallet` introduces the PERFECT medal (kill matched the oracle) and lifetime salvage. `player-save` introduces the versioned save with `lifetime` and `drills` sections.

Constraints: zero runtime dependencies, the sim runs headless in Node and imports nothing from render, audio or ui, every rendered string is printable ASCII (DECISIONS R11), card layout is asserted in `tests/ui-layout.test.ts` (R14), and `npm run verify` proves browser and headless states are byte-identical.

## Goals / Non-Goals

**Goals:**
- Turn the ledger's lifetime `missed` data into a ranked, actionable recommendation that names a drill.
- A drill whose every scene provably rewards the motion it claims to teach, verified by the same oracle that judges kills.
- Drills that replay deterministically under a seed and that an agent can play through `text()`.
- One implementation of "what did this kill cost versus what it could have cost", shared by the ledger, the PERFECT medal and drill scoring.
- A ledger screen that makes lifetime progress visible without dying first.

**Non-Goals:**
- Teaching a motion from scratch. That is `missions`. Drills assume the player has met the motion and need reps.
- Any purchase, store or supply behaviour. Drills pay salvage on a personal best; that is the only economy touch.
- Changing survival difficulty, waste rules or the oracle's verdicts for scenes without search.
- Cloud sync or leaderboards.

## Decisions

### D1. Kill judgement lives in `src/sim/judgement.ts`

This module is created by `medals-and-wallet`, which lands first; this change extends it with search candidates and drill scoring and must not fork it. The anchor snapshot, keystroke counting and `optimalKill` comparison currently in the `Ledger` class become a pure module: `beginAnchor(state, raw)`, `judgeKill(anchor, keysSpent, target, charges) -> { spent, optimal, wasted, optimalTokens, perfect }`. The ledger, the PERFECT medal in `medals-and-wallet` and drill scoring all call it.

Why: three consumers of one rule is a disagreement waiting to happen. `rules.ts` already exists for exactly this reason on the kill side; `judgement.ts` is the same move for the cost side. Alternative considered: leave it in the ledger and have the sim import from `src/ui`. Rejected because the sim must not import from `src/ui` (README layout rule, enforced by harness tests).

### D2. Drill families mirror curriculum sections

| family | motions verified | scene template |
|---|---|---|
| find | `f` `F` `t` `T` `;` `,` | one lane, 3 to 5 short words, target chosen so a find beats counted `w` |
| line-ends | `0` `^` `_` `$` | one or two lanes, target at far east or far west, cursor mid-lane |
| vertical | counted `j` `k`, `{n}G`, `gg`, `G`, `H` `M` `L` | targets scattered across lanes, cursor far away |
| paragraph | `{` `}` | blocks of occupied lanes separated by empty lanes |
| search | `/` `*` `#` | families of identical words across lanes; target is the far sibling |
| brackets | `di(` `da[` `ci{` and friends | armored zombies, mixed bracket kinds |
| quotes | `di"` `da'` | armored zombies, quote kinds |
| word-objects | `diw` `daw` `ciw` | cursor placed inside a word, not at its start |
| counts | `d3w`, `3x`, `d2j` | adjacent words or stacked lanes where one counted command clears several |
| placement | counted `j` `k`, `{n}G`, `w` `b` `f` `t`, `0` `$` | the store's survey grid; a span order to fill (see D9) |

Why: the coach needs to say "practice find" and the player needs one place to go. Sections in `src/sim/waves.ts` already group motions by idea. Alternative: one drill per motion. Rejected: `f` alone without `;` is not the skill, and twenty-plus drills is a menu nobody reads.

### D3. Generate, then verify with the oracle

A scene is generated from the family template using the drill RNG, then `optimalKill` is run for the designated target from the designated cursor. The scene is kept only if `tokensUsed(best.keys)` contains a motion in the family's verified set. Budget: up to 24 attempts per scene; on exhaustion, fall back to the family's hand-written fixture scene for that slot. Every family SHALL ship at least three fixtures so the fallback is never empty.

Why: the oracle is what will judge the player's kill as PERFECT. If the oracle says `f` is cheapest, then `f` is what a PERFECT requires, so the drill cannot lie. Alternative: hand-author every scene. Rejected: hand-authored scenes are finite and players memorise them; generation with verification gives endless variety at the same guarantee. The attempt cap keeps the worst-case generation under a frame.

### D4. The search family extends the oracle, additively

`optimalKill` gains candidates `*`, `#`, and `/word<CR>` where `word` is the target's text, plus `n` chained on `*` and `/`. They are verified through `dryRun` like every other candidate. For scenes with no duplicate words and no search candidate that is shorter, existing verdicts do not change, because candidates are sorted by length and the search candidates are 2 or more keystrokes.

Why: without this, the search family cannot be verified and the PERFECT medal can never fire for a search kill. Alternative: verify the search family with a bespoke predicate. Rejected: two oracles.

### D9. The placement family is scored on the span, not on a kill

`survival-store` added a placement mode over a synthetic survey grid, where a
multi-lane trap can only be planted by anchoring and then making a *counted*
vertical or horizontal motion. It is the one context in the game where a
counted motion is the only way to do the thing, and boot-camp mission 8 (`Set a
trap`) teaches it once. This family is where it gets reps.

A placement scene is an **order**, not a horde: `fence, 3 lanes, column 30`,
`minefield, 15 columns, lane 8`, `tripwire, lane 5 column 42`. The scene is
generated by drawing an item, a span and an origin from the drill RNG; the
crosshair starts somewhere deliberately far from the order so a counted motion
beats walking. Scoring is the span the player actually planted against the one
they were asked for: an exact match scores, anything else is a miss and the
next order is dealt.

This is the only family not verified through `optimalKill`, because nothing
here is a kill and the oracle has nothing to say about it. Its guarantee comes
from the other side instead: the *cheapest* keystroke path to a given order is
computable directly — the vertical distance and horizontal distance from the
crosshair to the anchor, plus the span motion — so PERFECT for a placement is
`spent <= cheapestPlacement(order, cursor).length`. That function is small,
pure and testable, and it lives beside the family table rather than inside the
oracle.

Why not fold it into the `vertical` family: a counted `j` there is one of
several ways to reach a target, and the drill accepts any of them. Here it is
the *only* way, which is a different lesson and deserves its own reps.
Alternative considered: leave placement to mission 8. Rejected — one scripted
scene teaches the mechanism and gives no practice, which is the same gap this
whole change exists to close.

The coach ranks this family from `missed` counts on counted motions the same
way it ranks `vertical`; a player whose counted `j` never shows up as optimal
gets pointed at both.

### D5. Drill sprint rules live in the sim

A drill is `mode = 'drill'` with: a fixed 60 000 ms clock counted in `SimState`, zero zombie speed, barricade damage disabled, `dd` and `D` charges fixed at 1 each per scene so charge-bearing answers stay possible but never optimal for a single target, and a scene that is replaced the moment its target dies or when the player presses `r`. Killing a non-target zombie counts as a kill but not a scene clear. Score is `{ kills, perfect, scenes }`. `perfect` increments when `judgeKill(...).perfect` is true for the scene's target.

Why: the sprint is a game rule, so it belongs where `tick(dt)` is and where `text()` and `json()` can see it. Alternative: run drills as a UI-layer wrapper over survival like `paused`. Rejected: a headless agent could not play a drill, and the replay check would not cover it.

### D6. Determinism

The drill seed comes from the run seed. Scene generation draws from the sim RNG whose cursor is `SimState.rngState`, so `json()` remains a complete snapshot and `scripts/replay.ts` covers drills with no changes. The 24-attempt cap is deterministic because rejection is a function of the state.

### D7. Coach ranking

For each motion token `t`: `need(t) = missed(t) / (1 + used(t))`. Sum `need` over the tokens of each family, rank families descending, tie-break by curriculum order. Tokens with fewer than three lifetime `missed` are ignored so one unlucky wave does not produce a recommendation. The top three families are the coach's verdict; the death screen shows the top one as a single line, the drills screen shows all three tagged `overdue`, the ledger screen shows all three with the token that drove each.

Why: `missed` alone ranks a motion the player uses constantly but occasionally skips above one they have never touched. Dividing by `used` favours the never-touched. Alternative: ratio of missed to optimal-appearances. Rejected: the ledger does not record optimal-appearances where the player did press the motion; adding that is a second counter for a marginal gain, and can come later.

### D8. Ledger screen is data from the save, drawn like every other card

Read-only. Per-motion table sorted by `missed` descending then `used` descending, capped to what fits the panel with a `j`/`k` scroll. Trend from the last eight runs. Medal counts from `lifetime.medals`. Coach top three each with a keycap; pressing `1`, `2` or `3` starts that drill. Layout asserted in `tests/ui-layout.test.ts` with the longest values the save can hold.

## Risks / Trade-offs

- [The oracle's candidate set is finite, so a family whose motions it never emits cannot be verified] -> Each family's verified set is checked by a test that generates 200 scenes per family under fixed seeds and asserts the accept rate is above 30 percent. A family that falls below that fails the build rather than shipping a drill that silently falls back to fixtures.
- [Generation cost on a slow machine: 24 attempts times `optimalKill`] -> `optimalKill` runs once per kill in survival today without a frame hitch; a scene is generated on the previous scene's clear and the budget is capped. Measured in the render smoke.
- [Coach recommends a family the player has never been taught] -> The drills screen names the matching mission alongside the drill so the player can choose to learn first. No gate.
- [Moving judgement out of the ledger changes the ledger's numbers] -> The move is behaviour-preserving and pinned by the existing ledger tests before the ledger is rewired.
- [Search candidates change an existing oracle verdict] -> Only when a search candidate is strictly shorter than the previous best, which by construction means the previous best was not optimal. The vim-resolve and sim fixtures pin the non-search verdicts.
- [Frozen horde makes drills feel unlike the game] -> Deliberate: the drill isolates aim, not pressure. A "moving" toggle at 50 percent speed is listed as a follow-up, not shipped here.

## Migration Plan

1. Land `judgement.ts` with the ledger rewired to it; ledger tests must pass unchanged.
2. Land the oracle search candidates with new fixtures; existing fixtures must pass unchanged.
3. Land `drills.ts` and the `drill` mode in the sim with harness `text()` support; add the replay coverage.
4. Land the screens and the coach.
Rollback: each step is independent; the menu entry for drills can be hidden while the sim work is present.

## Open Questions

- Should a personal best in a drill also count toward the lifetime `motions[tok].kills`? Proposed: yes, kills are kills; `used` too. Missed is not recorded in drills because every scene has a known answer.
- Salvage amount per personal best. Proposed: 10 per new best, flat, decided finally in `medals-and-wallet`.
