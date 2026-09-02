# Phase D — Audio: judgment calls

Everything below is a decision that was not pinned down by the brief. Fold into
DECISIONS.md as needed.

## Structure

- **Single file.** `src/audio/audio.ts` holds the whole subsystem (~640 lines).
  Splitting the synth voices into a second module would have required exporting
  an internal "kit" interface across the boundary for no real benefit; the
  public surface is one class.
- **Signal chain.** `voice gain -> masterGain -> DynamicsCompressor -> destination`,
  with `ambientBus (unity, duckable) -> masterGain` as a parallel path. The
  compressor sits *after* master so muting cannot pump it. Compressor is set
  fairly gentle (threshold -14, knee 12, ratio 6, attack 3ms, release 180ms) —
  it exists to catch pile-ups of simultaneous kills, not to squash the mix.
- **Master level 0.9**, mute ramps to `0.0001` rather than literal `0` (the
  "never ramp to zero" rule is applied uniformly, even to linear ramps).

## Voice management

- **Hard cap 24 concurrent one-shots.** Each one-shot allocates a tracked
  `Voice` = one sub-mix `GainNode` + its scheduled sources + an `endsAt`
  timestamp. `prune()` runs on every `update()` and every allocation; expired
  voices get their gain `disconnect()`ed deterministically rather than waiting
  on GC.
- **Over cap we drop the *oldest*, not the newest.** The oldest voice is faded
  to silence over 12ms and its sources stopped. Rationale: in a pile-up the
  newest kill is the one the player just caused and needs feedback for.
- **Groans and the ambient bed.** Groans are routed through the ambient bus but
  *are* counted as voices, so `death` and `dispose` cut them with everything
  else. The looping bed is tracked separately (`bedSrc`/`bedGain`) since it has
  no natural end.
- **Cutting a voice may schedule `stop()` before a source's future `start()`.**
  This is deliberate and spec-legal: per the Web Audio spec such a source simply
  never plays, which is exactly the desired "cut it" semantics.

## Kill weighting

The `kill` event carries no word length, so weight is derived from `kind`,
which is itself a length proxy in the sim (crawler = 1 char, bloater = 8+):

| kind    | thump      | character                                        |
|---------|------------|--------------------------------------------------|
| crawler | 300→150 Hz | tiny, high, dry tick                              |
| runner  | 215→90 Hz  | sharp, fast decay, bright bandpass                |
| walker  | 140→52 Hz  | the reference mid thump                           |
| armored | 150→58 Hz  | walker + two brittle triangle shards (2.9k, 3.9k) |
| bloater | 88→30 Hz   | deep, slow, plus a 420→58 Hz squelch layer        |

`overkill` layers a hard-clipped noise splat (WaveShaper, 5x gain into a
hard-clip curve, lowpassed at 2.6k) on top of whatever the kind produced.

## Other calls

- **Keystroke click** is a 12ms noise burst through a bandpass at
  `780 + (charCode % 41) * 52` Hz (780–2860 Hz), envelope 1ms attack / 8ms
  decay, peak **0.055**. `% 41` (prime) keeps adjacent keys from colliding on
  the same centre frequency. Deterministic — same key always sounds the same.
- **Combo ladder** advances two semitones per rung from G3 (196 Hz), capped at
  14 rungs (~985 Hz) so a long run does not climb into ear-piercing territory.
  The rung counter advances even while muted, so unmuting mid-run lands the
  ladder where it should be. Reset by `combo_break`, `wave_start` and `death`.
- **Barricade amplitude** is `clamp(0.10 + dmg * 0.018, 0.10, 0.42)` — a 1 dmg
  scrape is audible but a 20 dmg hit is roughly 4x louder.
- **Brown noise** is approximated by two cascaded lowpasses (320 Hz then
  140 Hz, low Q) on the shared white buffer played at 0.28x rate, rather than a
  true integrator via `ScriptProcessor`/`AudioWorklet` — no worklet means no
  second file to load and no main-thread audio callback.
- **Ambient duck** is 0.45x over 20ms with a 200ms linear return, triggered on
  every kill and applied to the whole ambient bus (bed *and* groans).
- **Groan interval** is a uniform random 5–14s, reset to 5–9s on `wave_start`
  so a fresh wave gets one reasonably early.
- **`Math.random()` is used for audio jitter** (noise buffer read offsets, groan
  pitch/timing). It is deliberately *not* the sim RNG — audio must never touch
  `rngState` or replays would diverge.

## Defensive behaviour

- Nothing touches `window`, `AudioContext` or `localStorage` at module scope, so
  importing the module in Node is inert. Verified: importing under `tsx` and
  firing every event tag with no AudioContext present is a clean no-op.
- Node 26 exposes a `localStorage` global that *throws* on access unless
  `--localstorage-file` is passed; the `try/catch` around both read and write
  covers that as well as private-window `SecurityError`.
- `unlock()` is idempotent, resumes a suspended context, and re-starts the
  ambient bed if a wave is already running.
- Muting stops the ambient bed and skips all scheduling work (not just gain-zero
  it), so a muted game does no audio work beyond `prune()`.
- `dispose()` unsubscribes, cuts everything, closes the context and nulls the
  graph; calling it twice is safe, and every method no-ops afterwards.
