/**
 * Bumped whenever a rule change makes older `runs/*.jsonl` logs
 * non-byte-comparable. 2 was the survival store: an older log replays as a
 * *game*, but diverges at the first `wave_clear`, because survival no longer
 * sets a breather there (DECISIONS #82). 3 is the overrun rule: `SimState`
 * gained `killsThisWave` and `tutorialEscaped`, so a version-2 log's recorded
 * final state is missing two fields, and a night nobody fought now ends the
 * run instead of clearing (DECISIONS #89). 4 is missions: `tutorial`,
 * `tutorialHold` and `tutorialEscaped` became `mission`, `missionBeat`,
 * `missionHold`, `missionKeys` and `missionEscaped` (DECISIONS #91). 5 is the
 * leg shot: the first `x` into a word halves the zombie's speed and sets
 * `Zombie.hobbled`, so a version-4 log with an `x` in it walks its horde at a
 * different pace from here on (DECISIONS #94). The replay checkers skip
 * anything below this and print which logs they skipped.
 *
 * It sits alone in its own file because `scripts/browser-replay.mts` reads it
 * before it has finished standing up its mock DOM, and must not drag the sim
 * in with it.
 */
export const LOG_VERSION = 5;
