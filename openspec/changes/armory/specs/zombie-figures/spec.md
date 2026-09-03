## MODIFIED Requirements

### Requirement: Figure kind selection
The renderer SHALL choose a figure by the zombie's `kind` first. The word-length fallback (1 character draws a crawler, 8 or more draws a bloater) SHALL apply only when `kind` is absent. Word packs vary word lengths within a kind, and a 3-letter walker or a 7-letter bloater SHALL still draw as its kind.

#### Scenario: Kind wins over length
- **WHEN** a walker with the text `err` and a runner with the text `fetch` are drawn
- **THEN** the walker figure and the runner figure are used respectively

#### Scenario: Fallback without kind
- **WHEN** a test draws a figure with an empty kind and a 9-character word
- **THEN** the bloater figure is used
