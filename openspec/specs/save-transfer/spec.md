# save transfer

## Purpose
Exporting the save to a file or clipboard and importing it from a file or pasted text, including validation, error reporting, and the save screen the player uses (see openspec/changes/archive).

## Requirements

### Requirement: Export file format
`exportSave(save)` SHALL return a JSON string of the save plus `exportedAt` (ms) and `checksum`, where `checksum` is the 32-bit FNV-1a hash, as 8 lowercase hex digits, of the canonical JSON (keys sorted recursively) of the object without the `checksum` field.

#### Scenario: Round trip
- **WHEN** a save is exported and the result is passed to `importSave`
- **THEN** validation succeeds and the parsed save deep-equals the original apart from `exportedAt` and `checksum`

#### Scenario: Corrupted byte
- **WHEN** one character of the exported string is altered outside the `checksum` field
- **THEN** `importSave` reports a checksum failure

### Requirement: Export to file
On the save screen, the export-to-file key SHALL trigger a browser download named `motd-save-YYYY-MM-DD-HHMM.json` containing the export string. The download SHALL be performed through a hidden anchor owned by `main.ts`; `src/ui` SHALL NOT create DOM elements.

#### Scenario: Download triggered
- **WHEN** the player presses the export-to-file key
- **THEN** a Blob URL is assigned to the hidden anchor, the anchor is clicked, and the URL is revoked afterwards

### Requirement: Export to clipboard
The export-to-clipboard key SHALL write the export string with `navigator.clipboard.writeText`. On success the save screen SHALL show `copied` for at least one second. On failure it SHALL show a one-line ASCII error and leave the file export available.

#### Scenario: Clipboard blocked
- **WHEN** `writeText` rejects
- **THEN** the screen shows `E482: Can't create file (clipboard blocked)` and no exception escapes

### Requirement: Import from file
The import-from-file key SHALL open a hidden `<input type="file">` accepting `.json`. The chosen file SHALL be read as text and passed through validation, then the save screen SHALL show a confirmation card with the incoming save's `highScore`, total kills, unlock count and `updatedAt`, and the two actions `merge` and `replace`.

#### Scenario: Valid file chosen
- **WHEN** the player selects a valid export
- **THEN** the confirmation card appears with those four values and `merge` highlighted

#### Scenario: Invalid file chosen
- **WHEN** the file is not JSON or fails validation
- **THEN** the screen shows `E485: Can't read file` followed by the specific reason, and the local save is untouched

### Requirement: Import from pasted text
The import-from-paste key SHALL attempt `navigator.clipboard.readText`. If that is unavailable or rejected, `main.ts` SHALL focus a hidden textarea so the player can paste, and Enter SHALL submit its contents. The pasted text SHALL follow the same validation and confirmation path as a file.

#### Scenario: Paste fallback
- **WHEN** `readText` is undefined
- **THEN** the hidden textarea receives focus, the screen shows `paste, then Enter`, and Enter submits the textarea value

### Requirement: Confirmation before any change
No import SHALL modify the local save until the player confirms `merge` or `replace` on the confirmation card. Esc SHALL cancel and discard the incoming data.

#### Scenario: Cancelled import
- **WHEN** the player presses Esc on the confirmation card
- **THEN** the local save is byte-identical to before the import began

#### Scenario: Confirmed merge
- **WHEN** the player confirms `merge`
- **THEN** the store is updated with `merge(local, incoming, 'merge')`, persisted, and the screen shows `merged` with the new high score

### Requirement: Newer version warning
When the incoming `version` is greater than the build knows, the confirmation card SHALL show `newer save format, some fields may be ignored` and SHALL still allow merge of known fields.

#### Scenario: Future version
- **WHEN** an import has `version` 2 and the build knows 1
- **THEN** the warning line appears and known fields merge normally

### Requirement: Save screen layout
The save screen SHALL be a paper panel drawn through the renderer glyph API, listing the export and import actions with keycaps, the local save's `updatedAt`, high score and total kills, and one status line. All strings SHALL be printable ASCII and the layout SHALL be asserted by the UI layout test with the longest values the fields can hold.

#### Scenario: Layout assertion
- **WHEN** the layout test draws the save screen with a 10-digit high score and the longest error string
- **THEN** nothing leaves the panel and nothing overlaps on a row
