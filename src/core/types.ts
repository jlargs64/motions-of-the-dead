// ============================================================================
// FROZEN CONTRACT — Phase 0. Do not modify. Additive optional fields only,
// and only where DECISIONS.md records the reason.
// ============================================================================
// The horde is a buffer. Rows are lines. Columns are cells. A zombie occupies
// a contiguous span of cells on one row.
export type Row = number; export type Col = number;

export type ZombieKind =
  | 'walker'   // plain word. dies to any operator that covers it.
  | 'armored'  // wrapped in brackets/quotes: (word) "word" [word] {word}. ONLY dies to a text-object operator (di(, ca", etc.). Other ops just chip the bracket glyphs.
  | 'runner'   // short word, moves 2x speed. Rewards f/t/; snipes.
  | 'bloater'  // long word (8+ chars). dw on it works but dd/D splash-kills neighbors and costs a charge.
  | 'crawler'; // single char. Only x kills it cleanly. Everything else overkills and costs combo.

// Rows are lanes. Zombies spawn at column 0 and walk RIGHT toward the
// barricade at FIELD_COLS; `speed` is columns per second.
export interface Zombie {
  id: number; kind: ZombieKind; row: Row; col: Col; text: string; hp: number; speed: number;
  /**
   * Additive (DECISIONS #94): the legs have been shot out. Set once, by the
   * first `x`/`X` that erodes the word, and `speed` was halved as it was set.
   * Absent means whole; it is never cleared.
   */
  hobbled?: true;
}
export interface Barricade { hp: number; maxHp: number; }
export interface Cursor { row: Row; col: Col; }

export interface Buffer { rows: string[]; zombies: Zombie[]; }   // rows are derived from zombies each tick; zombies are truth

export type Operator = 'd' | 'c' | 'x' | 'X' | 'D' | 'dd' | 'J';
export type MotionKind = 'h'|'j'|'k'|'l'|'w'|'W'|'b'|'B'|'e'|'E'|'0'|'^'|'_'|'$'|'gg'|'G'|'f'|'F'|'t'|'T'|';'|','|'{'|'}'|'%'|'H'|'M'|'L';
export type TextObjectKind = 'iw'|'aw'|'i('|'a('|'i['|'a['|'i{'|'a{'|'i"'|'a"'|"i'"|"a'";

export interface Command {
  count: number;                    // resolved count, default 1
  operator?: Operator;
  // `repeatFind` is additive (see DECISIONS.md #3): `;`/`,` are expanded by the
  // engine into the concrete f/F/t/T they repeat, so resolve() stays pure.
  motion?: { kind: MotionKind; char?: string; repeatFind?: true };
  textObject?: TextObjectKind;
  repeat?: true;                    // the `.` command
  // `/query<CR>` and `?query<CR>` — a snipe: jumps the crosshair to a match.
  // `wordUnderCursor` is `*` / `#`: resolve() supplies the query itself.
  search?: { query: string; backward?: true; wordUnderCursor?: true };
  raw: string;                      // the keystrokes that produced this, for the ledger
}

export type GameEvent =
  | { t: 'command'; cmd: Command; ms: number }
  | { t: 'kill'; zombieId: number; kind: ZombieKind; via: string; overkill: boolean }
  // One per affected lane. Drives the muzzle flash and the tracer from the
  // survivor's gun out to where the cursor was aimed.
  | { t: 'shot'; row: Row; colStart: Col; colEnd: Col; hits: number }
  | { t: 'combo'; n: number }
  // `refused` is additive (DECISIONS.md #86): a command the sim declined to
  // run at all - no charge left, or a motion that landed nowhere - looks
  // exactly like a command that worked, because nothing moves and nothing is
  // drawn. It marks the breaks that owe the player a reason.
  | { t: 'combo_break'; reason: string; refused?: true }
  | { t: 'barricade_hit'; dmg: number; hpLeft: number }
  | { t: 'wave_start'; n: number; unlocks: MotionKind[] }
  | { t: 'wave_clear'; n: number; ms: number }
  | { t: 'charge_used'; kind: 'dd' | 'D' }
  // `medal` and `kill_judged` are additive (DECISIONS.md #67). A medal is a
  // callout with a `supplies` payout attached; `kill_judged` is the sim showing
  // its work, so the Motion Ledger never has to run the oracle a second time.
  | { t: 'medal'; name: string; bonus: number }
  | { t: 'kill_judged'; zombieId: number; spent: number; optimal: string | null }
  // `buy`, `trap_fire` and `revive` are additive (DECISIONS.md #77): the
  // survival store's purchases are sim inputs, so a `runs/*.jsonl` replay has
  // to carry them. `item` is an `ItemId`, typed loosely because `types.ts` is
  // imported *by* `state.ts`, which owns that union.
  | { t: 'buy'; item: string; cost: number }
  | { t: 'trap_fire'; trapId: number; row: Row; col: Col }
  | { t: 'revive' }
  // `mission_done` is additive (DECISIONS #91): a mission reaching DONE, with
  // the keystrokes it took against the oracle's par and the stars that earns.
  // The save layer records it; the sim never reads the save.
  | { t: 'mission_done'; id: string; keys: number; par: number; stars: number }
  | { t: 'death'; wave: number; score: number };
