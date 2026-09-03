# mission-campaign Specification

## Purpose
The mission list and the table behind it: boot camp (the old warm-up) plus one
mission per lesson of the survival curriculum, grouped by section, with stars
per mission persisted in the player save and a pointer from survival's wave
card. Nothing locks; stars are the pull. Owns `src/sim/missions.ts`, the list
in `Screens.drawMissions`, the `{`/`}` section motions on the menu, and
`recordMission` in the save layer.

Depends on `main-menu` (the menu model and its conventions) and `player-save`
(the `missions` slot). Beats and par are `mission-beats`; the demo pane is
`mission-demo`.
## Requirements

### Requirement: Mission table covers the syllabus
The game SHALL define one mission per lesson in `CURRICULUM` (33 missions) plus the eight Boot camp missions ported from the warm-up, grouped by section, in `src/sim/missions.ts` as `MISSIONS`. Each mission SHALL have a stable string id, a section, a title, keycaps, a one-line ASCII hint, a scripted spawn list, a start cursor, a goal of `reach`, `clear` or `plant`, and a compact demo script for the select screen. Section, title and keycaps for the 33 lesson missions SHALL be read from `waveDef(n)` so the two tables share their text.

#### Scenario: Every lesson has a mission
- **WHEN** `MISSIONS` is filtered to entries with a `lesson` index
- **THEN** there are exactly `LESSON_COUNT` of them, one per index 1..`LESSON_COUNT`, each with `section`, `title` and `keys` equal to `waveDef(lesson)`

#### Scenario: Boot camp is the warm-up
- **WHEN** `MISSIONS` is filtered to section `Boot camp`
- **THEN** there are eight entries, first in the table, whose spawn lists, goals and keycaps match the former `TUTORIAL` steps in order

#### Scenario: Ids are unique and ASCII
- **WHEN** all mission ids, titles and hints are collected
- **THEN** every id is unique and every string contains only printable ASCII (codes 32..126)

### Requirement: Mission list shows everything and locks nothing
The mission list SHALL render every section heading and every mission at all times. A lesson mission whose lesson index is greater than the highest starred lesson index plus one SHALL render dimmed; Boot camp missions never dim. Every mission SHALL be selectable regardless of stars.

#### Scenario: Fresh profile
- **WHEN** no mission has stars
- **THEN** Boot camp and lesson 1 render in normal ink, lessons 2 and beyond render dimmed, and selecting lesson 20 starts lesson 20

#### Scenario: Progress moves the dim line
- **WHEN** lesson 5 has 2 stars and no later lesson has stars
- **THEN** lessons 1..6 render in normal ink and lessons 7 and beyond render dimmed

### Requirement: Mission list navigation is Vim
The mission list SHALL move the selection with `j`/`k` (with counts), jump with `gg`/`G`/`H`/`M`/`L`, skip sections with `{`/`}`, select with Enter or `l`, go back with Esc or `h`, and jump to the first title containing a typed query with `/query<CR>` (`n`/`N` repeat it). The list SHALL show at most 16 lines (section headings count as lines) and SHALL scroll to keep the selection visible, drawing a `^` marker above or a `v` marker below when lines are clipped.

#### Scenario: Section skip
- **WHEN** the selection is on the first Boot camp mission and `}` is pressed
- **THEN** the selection is on the first Basic Vim mission

#### Scenario: Search select
- **WHEN** `/find<CR>` is typed
- **THEN** the selection is on the first mission whose title contains `find` case-insensitively, and the list scrolls to show it

#### Scenario: Scroll markers
- **WHEN** the selection is on the last mission
- **THEN** a `^` marker is drawn, no `v` marker is drawn, and the selected row is visible

### Requirement: Mission list rows
Each row SHALL show the mission's stars as three glyphs from the set `*` and `.` (for example `**.`) and its title, un-truncated for every title in the table. The right pane SHALL show the selected mission's keycaps, its looping demo, its hint, its par and its best keystroke count when one is recorded. Nothing on a row SHALL leave the panel or overlap another string on the row.

#### Scenario: Unplayed row
- **WHEN** a mission has no record
- **THEN** its row shows `...` and the right pane shows the par with no best

#### Scenario: Longest title fits
- **WHEN** the layout test draws the list at every selection with every scroll position that produces
- **THEN** every string stays inside the panel, no two strings on a row overlap, and no title is truncated

### Requirement: Stars persist
On reaching DONE the sim SHALL emit `{ t: 'mission_done'; id; keys; par; stars }`. The save layer SHALL expose `recordMission(store, id, keys, stars)` which writes `missions[id] = { stars, bestKeys }` and SHALL only change a field when stars increase or `bestKeys` decreases (a `bestKeys` of 0 means no record).

#### Scenario: First clear
- **WHEN** mission `basic-words` is cleared in 9 keys with par 6
- **THEN** a `mission_done` event with `stars` 2 is emitted and the save records `{ stars: 2, bestKeys: 9 }`

#### Scenario: Worse repeat does not regress
- **WHEN** the same mission is later cleared in 14 keys
- **THEN** the save still holds `{ stars: 2, bestKeys: 9 }`

#### Scenario: Better repeat improves
- **WHEN** the same mission is later cleared in 6 keys
- **THEN** the save holds `{ stars: 3, bestKeys: 6 }`

### Requirement: Survival points at the mission
The survival wave card SHALL show the line `mission unstarred - missions on the menu` in dim ink when the current wave's lesson maps to a mission with zero stars, and SHALL omit the line otherwise.

#### Scenario: Unstarred lesson
- **WHEN** wave 11 starts and mission `ess-find` has no stars
- **THEN** the wave card shows the pointer line and the layout test finds no overlap

#### Scenario: Starred lesson
- **WHEN** wave 11 starts and mission `ess-find` has 1 or more stars
- **THEN** the wave card does not show the pointer line

### Requirement: Entry points
The `missions` menu entry SHALL open the mission list with the selection on the first unstarred mission (or the first mission when all are starred) the first time it is opened after a run. In the headless harness `t` is not a key (`main-menu` removed it); the CLI `t [n]` command SHALL start mission `n` directly.

#### Scenario: Menu entry
- **WHEN** lesson 1 has stars and the `missions` row is selected on a fresh menu
- **THEN** the list opens with the selection on the mission for lesson 2

#### Scenario: CLI command
- **WHEN** the CLI receives the command `t 3`
- **THEN** `json().sim.mission` is 2, `sim.missionBeat` is `try` and `sim.mode` is `mission`
