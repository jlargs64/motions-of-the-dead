## Context

Kill resolution lives in `Sim.apply()` (`src/sim/sim.ts`): `planKills` returns the victims of one command, then `kill()` is called per victim and scores `10 * len * (1 + combo/10)`. The combo is time-windowed (2.5 s) and is not "one command killed three". The Motion Ledger (`src/ui/ledger.ts`) snapshots the field at the first command after each kill, counts keystrokes until the next kill, and brute-forces the cheapest kill with `optimalKill`. That is the oracle for PERFECT, but it runs in the browser UI layer, so nothing in the sim can pay out on it today.

Constraints: `src/sim` imports nothing from `ui`, `render` or `audio`. `GameState` must stay a complete, replayable snapshot, and `verify:browser` asserts the browser and headless final states are byte-identical. Rendered strings are ASCII only. Zero runtime dependencies.

## Goals / Non-Goals

**Goals:**
- Medals judged deterministically inside the sim from `GameState` and inputs only.
- A run wallet (`supplies`) that the store can spend, earned alongside score without changing score.
- Lifetime salvage credited from medals, persisted via `player-save`.
- Callouts that feel like Halo: big, short, stacked, with sound.
- The ledger keeps every current death-screen statistic without running the oracle twice.

**Non-Goals:**
- Spending supplies or salvage (that is `survival-store` and `armory`).
- Changing the score formula, the combo window, or the waste rule.
- Leaderboards or any anti-tamper.

## Decisions

**1. Judging moves into the sim as two pure modules.**
`src/sim/judgement.ts` owns the anchor snapshot, keystroke accounting and the `optimalKill` comparison (`beginAnchor`, `judgeKill -> { spent, optimal, wasted, optimalTokens, perfect }`); it is the one place the sim, the ledger and later `drills-and-coach` judge what a kill cost. `src/sim/medals.ts` owns the medal ladder, payouts, `judgeMultiKill(plan)` and `judgeStyle(cmd, plan, zombiesBefore, anchor)`. These are pure functions over the command, the `Plan` from `rules.ts` and the pre-splice zombie list. `Sim.apply()` calls them after the victims loop and emits one `medal` event per medal. Alternative considered: keep judging in `ledger.ts` and have the UI write `supplies` into the state. Rejected because the harness, the smoke bot and the replay checker would then disagree with the browser on `supplies`, breaking the byte-identical guarantee.

**2. The anchor lives in `SimState` (additive).**
`SimState.judge: { zombies: Zombie[]; cursor: Cursor; charges: {dd,D}; keys: number } | null`. It is set on the first `apply()` after a kill (or after run start) and cleared on the first kill after it, exactly as the ledger does today (DECISIONS #36). It is in the state rather than a private field so `json()` remains a full snapshot and replays cannot diverge on it. Cost: a copy of the zombie list, at most 64 entries, once per kill sequence. Acceptable.

**3. PERFECT is judged only on the first kill of a sequence, against `optimalKill`.**
Same rule the ledger uses: multi-kills after the anchor were good by definition. PERFECT fires when `judge.keys` is less than or equal to `optimalKill(...).keys.length` (beating the narrowed oracle counts). The sim emits `{ t: 'kill_judged'; zombieId; spent; optimal: string | null }` so the ledger can keep its `wasted`, `missed` and never-used tables without calling the oracle again. Risk: `optimalKill` now runs in the headless harness and smoke bot on every kill sequence. It already runs per kill in the browser today; the smoke bot reaches wave ~53 so budget the cost and measure in `npm run smoke`.

**3a. Trap kills earn nothing here.** A kill whose `via` starts with `trap:` (see `survival-store`) SHALL NOT be judged, pay supplies, or count toward a multi-kill ladder. Traps pay base score only.

**4. Multi-kill counts victims of one command, including `J` crushes and `dd`/`D` splash.**
The ladder is `plan.victims.length`: 2 DOUBLE KILL, 3 TRIPLE KILL, 4 OVERKILL, 5 KILLTACULAR, 6 KILLTROCITY, 7 KILLIMANJARO, 8 KILLTASTROPHE, 9 KILLPOCALYPSE, 10+ KILLIONAIRE. Names are data in `medals.ts` so the armory can later sell callout packs. Overkilled crawlers count as victims but a command whose plan has `overkill` earns no style medal.

**5. Style medals are judged from the command and the victims' kinds before splicing.**
- SNIPE: motion kind in `f F t T` (including `;`/`,` expansions, which the engine marks `repeatFind`) and at least one victim was a `runner`.
- BREACH: `cmd.textObject` set and at least one victim was `armored` at plan time.
- CALLED SHOT: the anchor's first command was a search (`/ ? * #`) and the kill lands on the zombie that search moved onto, within the same sequence. Recorded by storing `judge.searchTarget: number` (zombie id) when the anchoring command has `search`.
- PERFECT: see decision 3.
Several style medals can fire on one kill; each pays.

**6. FIRST BLOOD is a browser-layer medal and pays salvage only.**
The sim cannot know lifetime history without taking external input, which would make replays depend on the save. `Ledger` already sees every `command` and knows lifetime `motions`; it emits FIRST BLOOD through the same bus (`{ t: 'medal', name: 'FIRST BLOOD', bonus: 0 }`) so the callout and sting are shared, and credits salvage directly. The harness never emits it. Alternative: inject a `known` set into `Sim.start()`. Rejected for the determinism reason above.

**7. Payout tables are constants in `medals.ts`.**
Per kill: `supplies += len` (no combo multiplier; the multiplier stays a score thing). Multi-kill bonus by tier: 10, 25, 50, 80, 120, 160, 200, 240, 300. Style bonus: PERFECT 15, SNIPE 10, BREACH 15, CALLED SHOT 20. Salvage: 1 per style medal, tier number per multi-kill medal, 5 for FIRST BLOOD. All tunable in one place; tests assert the table rather than magic numbers.

**8. `supplies` resets in `Sim.start()` and is untouched by the warm-up.**
The warm-up wipes score and kills when it rolls into wave 1 (R12); supplies are wiped at the same point so the tutorial cannot bank a wallet.

**9. Callouts are a renderer-side stack fed by `medal` events.**
Up to three visible, newest on top, each 1100 ms with a 150 ms scale-in, drawn centered in the sky band above the combo counter (rows -5.5..-3), text scale by tier. Audio: a short synthesized sting whose pitch and layer count rise with tier; style medals use a distinct two-note figure. Nothing about callouts touches `GameState`.

**10. Salvage crediting goes through the save module.**
`Ledger` calls `save.creditSalvage(n)` from `player-save`. If this change lands before `player-save`, salvage accrues under `motd.ledger.salvage` behind the same function name and `player-save` migrates it. Record which happened in DECISIONS.md.

## Risks / Trade-offs

- [Oracle cost moves into the headless path] -> measure `npm run smoke` wall time before and after; if it regresses more than 2x, cap `optimalKill` to kills within the current lane set the same way `rowCandidates` narrows, or judge PERFECT only when `judge.keys <= 6`.
- [Byte-identical browser/headless check breaks if any UI code writes to `supplies`] -> `supplies` is written only in `Sim`; a test asserts the ledger and renderer never mutate state.
- [Callout stack overlaps the combo counter or the zombies-remaining strip] -> extend `tests/ui-layout.test.ts` with the callout band at max tier and max stack.
- [Medal spam on `dd` in a jammed lane makes the wallet balloon] -> tier payouts grow sub-linearly past KILLTACULAR; the store prices in `survival-store` are tuned against the smoke bot's average supplies per wave, which this change records in the smoke output.
- [FIRST BLOOD fires for every token on a fresh save, flooding the first run] -> only fire when `lifetime.motions[tok].used` was 0 before this command and at most one FIRST BLOOD per command.

## Migration Plan

Additive fields default to `0` / `null` in `createState`, so old `runs/*.jsonl` logs replay unchanged in event streams except for the new `medal` and `kill_judged` events. Regenerate the baseline logs with `npm run play` after landing, and note in DECISIONS.md that pre-medal logs are not byte-comparable.

## Open Questions

- Should DOUBLE KILL pay at all, or only announce? Halo pays nothing for medals; this game has a wallet to feed. Default: it pays, and `survival-store` tunes prices against it.
- Zombie-toned renames for the ladder (for example "DOUBLE TAP", "MASS GRAVE") can ship as the default pack or as an armory unlock. Default: ship Halo names, sell alternates later.
