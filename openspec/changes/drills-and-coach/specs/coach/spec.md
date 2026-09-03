## ADDED Requirements

### Requirement: Drill families
The game SHALL define drill families, each naming a set of motion and text-object tokens it teaches: find (`f` `F` `t` `T` `;` `,`), line-ends (`0` `^` `_` `$`), vertical (counted `j` `k`, `G`, `gg`, `H`, `M`, `L`), paragraph (`{` `}`), search (`/` `*` `#`), brackets (bracket text objects), quotes (quote text objects), word-objects (`iw` `aw`), counts (counted operators). Every token the oracle can emit SHALL belong to at most one family.

#### Scenario: Token maps to one family
- **WHEN** the token `;` is looked up
- **THEN** exactly the find family is returned

#### Scenario: Unfamilied token
- **WHEN** the token `l` is looked up
- **THEN** no family is returned and the coach ignores it

### Requirement: Coach ranking
The coach SHALL compute, from the save's lifetime `missed` and `motions[tok].used`, a need score per token of `missed / (1 + used)`, ignore tokens with fewer than 3 lifetime misses, sum need per family, and return families ranked by descending need with ties broken by curriculum order. The result SHALL be at most three families.

#### Scenario: Never used outranks occasionally skipped
- **WHEN** `f` has missed 12 and used 0, and `w` has missed 12 and used 300
- **THEN** the find family ranks above any family containing `w`

#### Scenario: Below threshold
- **WHEN** every token in the quotes family has 2 or fewer misses
- **THEN** the quotes family does not appear in the ranking

#### Scenario: Empty ledger
- **WHEN** the save has no lifetime data
- **THEN** the coach returns an empty ranking and every surface shows a neutral line instead of a recommendation

### Requirement: Coach surfaces
The coach's ranking SHALL be shown on the drills screen as the ranked families tagged `overdue`, on the ledger screen as the ranked families with the token that contributed most to each, and on the death screen as one line naming the top family and its drill. Every string SHALL be printable ASCII.

#### Scenario: Death screen line
- **WHEN** the top family is find
- **THEN** the death screen shows a line naming find and the keys `f t ;` and how to reach the drill

#### Scenario: Drills screen tags
- **WHEN** the ranking is find, brackets, search
- **THEN** those three entries on the drills screen carry the `overdue` tag and the others do not
