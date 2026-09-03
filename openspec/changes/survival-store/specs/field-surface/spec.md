## ADDED Requirements

### Requirement: Trap glyphs on the field
The field SHALL draw every planted trap on its lanes from the glyph atlas: a tripwire or fence cell as `|` in the dim palette colour, a minefield cell as `*`, and a barbed-wire lane as `~` in the wall column. Trap glyphs SHALL draw beneath zombie text so a word walking onto a trap stays readable.

#### Scenario: Fence drawn
- **WHEN** a fence covers rows 2..4 at column 20
- **THEN** cells (2,20), (3,20) and (4,20) show `|` and no other cell shows a trap glyph

### Requirement: Survey grid in placement mode
While `shop.mode` is `place`, the field SHALL draw the survey ruler on every lane in the dim ink, the placement crosshair as the normal cursor, the anchor cell as `+` when set, and the pending span highlighted in amber. When `shop.mode` returns to `list` the grid SHALL disappear.

#### Scenario: Span highlight
- **WHEN** a fence is anchored on lane 3 column 20 and the crosshair is on lane 6 column 20
- **THEN** cells (2..5, 20) are highlighted and (2,20) shows `+`
