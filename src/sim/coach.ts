// Phase B - the coach: which drill the lifetime ledger says you need.
//
// Pure over the save's `lifetime` shape, passed in - the sim never reads the
// save (DECISIONS #71), so the shape is stated structurally here rather than
// imported from `src/save` (drills-and-coach D7).
import { FAMILIES, familyOf } from './drills';
import type { DrillFamily, FamilyId } from './drills';

/** What the coach reads: per-token use, and per-token "optimal, never pressed". */
export interface CoachInput {
  motions: Record<string, { used: number }>;
  missed: Record<string, number>;
}

/** Tokens with fewer lifetime misses than this are one unlucky wave, not a habit. */
export const COACH_MIN_MISSED = 3;
/** How many families the coach names. */
export const COACH_TOP = 3;

export interface CoachEntry {
  family: FamilyId;
  /** Summed `missed / (1 + used)` over the family's tokens. */
  need: number;
  /** The token that contributed most. */
  token: string;
}

/** `missed / (1 + used)`: never-touched outranks occasionally-skipped. */
export function needOf(missed: number, used: number): number {
  return missed / (1 + used);
}

/**
 * Families ranked by need, at most COACH_TOP, ties broken by curriculum order
 * (the order of FAMILIES). Empty when nothing clears the threshold.
 */
export function coach(lt: CoachInput): CoachEntry[] {
  const acc = new Map<FamilyId, { need: number; token: string; top: number }>();
  for (const [tok, missed] of Object.entries(lt.missed)) {
    if (missed < COACH_MIN_MISSED) continue;
    const fam = familyOf(tok);
    if (!fam) continue;
    const n = needOf(missed, lt.motions[tok]?.used ?? 0);
    if (n <= 0) continue;
    const cur = acc.get(fam.id) ?? { need: 0, token: tok, top: -1 };
    cur.need += n;
    if (n > cur.top) { cur.top = n; cur.token = tok; }
    acc.set(fam.id, cur);
  }
  // A family with no tokens of its own reads another's score: placement is
  // ranked from the counted motions exactly as `counts` is (D9).
  for (const f of FAMILIES) {
    if (!f.rankAs || acc.has(f.id)) continue;
    const src = acc.get(f.rankAs);
    if (src) acc.set(f.id, { ...src });
  }
  const out: CoachEntry[] = [];
  for (const f of FAMILIES) {
    const a = acc.get(f.id);
    if (a && a.need > 0) out.push({ family: f.id, need: a.need, token: a.token });
  }
  // Array.prototype.sort is stable, so equal needs keep curriculum order.
  out.sort((a, b) => b.need - a.need);
  return out.slice(0, COACH_TOP);
}

/** The family behind an entry. Always defined: entries only name FAMILIES. */
export function entryFamily(e: CoachEntry): DrillFamily {
  return FAMILIES.find((f) => f.id === e.family) ?? FAMILIES[0];
}

/** What every surface says when the ledger has nothing to recommend yet. */
export const COACH_QUIET = 'coach: nothing overdue yet. die a few more times';

/**
 * The death screen's one line: the top family, its keys, and where the drill
 * is. Neutral when there is no ranking (D7). Printable ASCII.
 */
export function coachLine(entries: readonly CoachEntry[]): string {
  const top = entries[0];
  if (!top) return COACH_QUIET;
  const f = entryFamily(top);
  return `coach: practise ${f.name} (${f.keys.join(' ')}) - drills on the menu`;
}
