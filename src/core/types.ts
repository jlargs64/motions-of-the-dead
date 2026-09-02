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
export interface Zombie { id: number; kind: ZombieKind; row: Row; col: Col; text: string; hp: number; speed: number; }
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
  | { t: 'combo_break'; reason: string }
  | { t: 'barricade_hit'; dmg: number; hpLeft: number }
  | { t: 'wave_start'; n: number; unlocks: MotionKind[] }
  | { t: 'wave_clear'; n: number; ms: number }
  | { t: 'charge_used'; kind: 'dd' | 'D' }
  | { t: 'death'; wave: number; score: number };
