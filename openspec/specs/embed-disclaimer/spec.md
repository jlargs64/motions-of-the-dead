# embed-disclaimer Specification

## Purpose
TBD - created by archiving change add-analytics-and-disclaimer. Update Purpose after archive.
## Requirements
### Requirement: Four topics, above the embed
The blog page that embeds the game SHALL render a disclaimer immediately above the `{{< game >}}` shortcode, covering four topics: graphic gore and violence; flashing, strobing and screen shake; anonymous usage analytics; and progress stored locally in the browser. It SHALL be readable without scrolling past the iframe and SHALL NOT be collapsed behind a toggle. `/projects/` itself SHALL be a grid of project cards carrying no embed, so the disclaimer and the iframe always appear on the same page as each other.

#### Scenario: Reader opens the game's project page
- **WHEN** `/projects/motions-of-the-dead/` renders
- **THEN** the four topics appear in the source before the `<iframe>`, and the iframe is still `loading="lazy"`

#### Scenario: The index carries no embed
- **WHEN** `/projects/` renders
- **THEN** it lists a card per project with a title and a one-sentence hook, and contains no `<iframe>`, so no reader reaches the game without passing the disclaimer

#### Scenario: Narrow screen
- **WHEN** the page is viewed at 375px wide
- **THEN** the disclaimer is fully visible above the frame with no horizontal scroll

### Requirement: The analytics line is specific and linked
The analytics topic SHALL say the game uses a cookieless analytics service, SHALL name Umami, and SHALL link to the site's privacy policy. The linked privacy policy SHALL be published, not a draft, and SHALL describe the game's reporting: that it shares the blog's Umami website, that it records no pageview of its own, and what the four events carry.

#### Scenario: The link resolves
- **WHEN** a reader clicks the privacy link in the disclaimer
- **THEN** `/privacy/` renders, rather than 404ing because `content/privacy.md` is `draft = true`

#### Scenario: The policy covers the game
- **WHEN** a reader reads the Analytics section of the privacy policy
- **THEN** it states that the embedded game reports to the same Umami website as the blog with `data-auto-track="false"`, so a visit is counted once rather than twice, and lists the four events and the fields each one carries

### Requirement: The local-save line matches what the game stores
The storage topic SHALL state that progress is saved in the reader's own browser under `motd.save`, is never transmitted, and is lost if they clear site data. It SHALL NOT promise a cloud save or an account.

#### Scenario: Wording matches the save contract
- **WHEN** the disclaimer is written
- **THEN** its storage claim agrees with `openspec/specs/player-save`: one versioned localStorage blob, no network

### Requirement: The game is still one click from a clean page
The disclaimer SHALL NOT gate the iframe behind a click-to-consent step. The shortcode's existing click-to-focus overlay, fullscreen button and "Open in a new tab" link SHALL keep working unchanged.

#### Scenario: Play is not blocked
- **WHEN** a reader clicks the game's overlay
- **THEN** the frame focuses and keys reach the game, with no interstitial from the disclaimer

