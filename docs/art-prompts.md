# Vision-model prompts — reference art for retuning the renderer

**Workflow this file is built for:**

1. `npm run shot -- --only wave` → `runs/shots/current/wave1-18s.png` (the current build)
2. Paste **Block 0** + **Block 1** + one prompt below into an image model. Attach
   `wave1-18s.png` too if the tool takes image input.
3. Save what comes back into `runs/shots/ref/<prompt-letter>-<n>.png`
4. Tell Claude Code: "ref/A-1.png, make the renderer look like this"

The game ships **zero image assets** — every figure is drawn procedurally in
`src/render/figures.ts` / `scene.ts` with Canvas 2D primitives. These prompts
therefore ask for **flat, poster-like, limited-palette reference art that can be
rebuilt from rectangles, arcs and gradients** — not painterly concept art and not
sprite sheets. Anything with photographic texture or soft airbrushed volume is
unusable: it cannot be translated into draw calls.

---

## Block 0 — shared context (paste before every prompt)

```
You are producing REFERENCE ART for a game called MOTIONS OF THE DEAD. The
artwork will not be used as an asset. A programmer will look at it and rebuild
it in code using Canvas 2D primitives, so the art must be constructible from
flat fills, hard-edged rectangles, simple arcs and straight linear or radial
gradients. Think silkscreen poster, flat vector, or 16-bit era pixel art — NOT
digital painting, NOT airbrush, NOT photobashing, NOT a rendered 3D still.

THE GAME
A nocturnal survival shooter where the only player input is Vim normal-mode
motions. The play field is a text buffer read side-on: 16 horizontal lanes, 52
columns of open ground, monospace grid. Zombies are English words made of
letters — each word is a zombie, and a small shambling figure stands under its
word. They enter at the far west (left) and walk east (right) toward a filthy
timber barricade at the right edge. A lone survivor stands behind that
barricade, lit by one floodlight on a pole above him. The player kills by
typing Vim commands (dw, d2w, x, f, $) which fire along the lane. Tone: grim,
gory, unglamorous, 2 AM, wet mud and cordite. Not cartoonish, not neon, not
cyberpunk, no sci-fi.

ART DIRECTION REFERENCE
The Last Stand (Con Artist Games, 2007). Slate night sky, black treeline,
dishwater fog, cold blue-green grass, one warm floodlight from the east side,
dark near-silhouette actors each carrying one warm rim-light edge on the side
facing the lamp. Heavy value contrast; low saturation everywhere except blood
and lamplight.

FIXED PALETTE — use these values and close neighbours only
  night/background   #0d1117    sky top #2b3446    sky horizon #4a5568
  fog #5b6470        treeline #161b26
  grass far #3a4a44  grass near #2d3a35  grass deep #222c28
  dried blood #5a1a18  wet blood #8a0f0f   bright blood #d11a1a
  timber #4a4034     timber shadow #2a241d   timber highlight #6b5d4a
  wire #7a7d80       sandbag #5b5642        paving #3a3d42
  lamp core #f2e6be  lamp warm #cdb277      west shadow #04060a
  house wall #1c1f26 lit window #d9b25c     rust #5a3a24
  survivor jacket #3d6b39 lit #54874b  trousers #232833  skin #b08d6f
  zombie skin #8f9c86 shadowed #63705e  zombie cloth #242a2e lit #39424a
  zombie blood #7a1512  bone/sick #c9cbbd   exposed flesh #8c6f63
  muzzle flash core #ffe6a0   flash edge #ff9020
  HUD white #e8e8e0   HUD grey #9aa0a6    crosshair amber #e0a020

HARD CONSTRAINTS
- Flat shading. At most three value steps per surface: shadow, base, lit edge.
  No soft gradients across a body, no ambient occlusion, no specular blooms.
- Hard edges everywhere. Minimal anti-aliasing. No blur, no depth of field, no
  film grain, no per-pixel noise overlay, no vignette.
- Lighting is a single hard key from the UPPER RIGHT plus a cold ambient fill
  from above. Every form has a near-black west side and one warm lit east edge.
- Never render text, letters, numbers, UI, a watermark or a signature unless a
  prompt explicitly asks for lettering.
- Stay inside the palette above.
```

---

## Block 1 — what is currently wrong (paste after Block 0)

```
A build of this game already exists and looks weak. Your reference art must
specifically solve these seven faults. Treat this list as the brief.

1. NO SILHOUETTE. The zombie figures currently read as thin scarecrow sticks:
   a one-pixel torso line, a tiny hook for a head, one stick arm. They have no
   mass, no shoulders, no hips, no pair of legs. Give the figures real
   silhouette weight — a solid readable body mass that survives being shrunk
   to 40 pixels tall.
2. NO RIM LIGHT. In the build the figures are the same value as the grass
   behind them, so they vanish. Every figure must separate from its background
   by value: dark body against lighter ground, plus one clear warm lit edge on
   the right-hand contour.
3. NO GROUND CONTACT. Figures float. Each one needs a definite dark contact
   shadow pooled at its feet, sitting flat on the ground plane.
4. THE LIGHT CONE IS A SLAB. The floodlight currently paints a flat
   translucent grey rectangle with a hard vertical edge across the field, which
   reads as a broken UI panel. Show what a real floodlight pool should look
   like: a bright ellipse of ground under the lamp falling off with distance,
   warm at the centre, cold and near-black at the far west, no straight edges.
5. THE GROUND IS NOISE MUSH. The field is currently uniform per-pixel grain
   with no structure. Give the ground readable structure instead: banded
   horizontal depth (darker far, lighter near, or the reverse), tyre ruts,
   patches of mud, trampled tracks — shapes, not grain.
6. FLAT OVERALL CONTRAST. Everything in the build sits inside one narrow
   blue-grey value range. Push a real value structure: near-black treeline,
   mid sky, dark ground, bright lamp pool, near-white lit edges.
7. WEAK BLOOD. Blood decals read as faint pink smudges. Make blood the only
   saturated thing in frame — dark wet mass with bright arterial edges,
   irregular and directional.
```

---

## Prompt A — the target frame (run this one first)

This is the highest-value image: one picture that defines everything at once.

```
Produce a single 16:9 landscape reference frame of the whole game screen as it
SHOULD look. 1920x1080.

LAYOUT, exactly as specified — this is a game screen, not a free illustration:
- Top 15% of the frame: night sky, dark slate at the top grading to a lighter
  cold horizon, with a hard near-black silhouetted treeline along the bottom of
  it. The treeline must read as bare winter trees with irregular trunks and
  crowns — NOT as a row of identical triangles or a sawblade pattern.
- The remaining 85%: an open flat field seen side-on, in slight three-quarter
  view, receding to the treeline. Cold blue-green trampled grass and mud, with
  readable ground structure — tyre ruts running east to west, bare mud patches,
  dark trampled trails, dried blood stains flat on the dirt.
- Right 12% of the frame: a wall of scavenged timber barricade running from the
  top of the field to the bottom of the frame, filthy planks nailed across each
  other at rough angles, with sandbags stacked at its base and coils of barbed
  wire along the top. Behind and right of it, a dark corrugated house wall with
  one warm lit window.
- A single tall steel floodlight pole rises above the barricade near the top
  right, its caged lamp head angled down and west. It casts a warm elliptical
  pool of light over the near-right third of the field, falling off to
  near-black at the far west edge of the frame. The pool has NO straight edges.
- The lone survivor stands behind the barricade, facing LEFT, roughly a
  thirtieth of the frame height tall, in an olive field jacket with a rifle
  shouldered. He is a dark silhouette rimmed with warm light along his back and
  the top of his head, because the lamp is above and behind him.
- Scattered across the open field, ABOUT TWELVE zombie figures at varying
  distances, all facing RIGHT, all walking east toward the barricade. They are
  small — between one thirtieth and one twentieth of the frame height — and
  this is the point of the image: each one must still be instantly readable at
  that size. Solid dark hunched bodies with real shoulder and hip mass, heads
  lolling forward, arms hanging, a visible pair of legs mid-stride, one warm
  rim-light stripe down the right-hand contour, and a hard dark contact shadow
  at the feet. Vary them: most are ordinary gaunt walkers, one is a hugely
  swollen bloater, one is a thin sprinter leaning far forward, one is a crawler
  dragging itself along the dirt.
- Leave the left third of the frame comparatively empty and dark. That is where
  the game's HUD and line-number gutter sit; do not draw any HUD or text there.

No letters, no numbers, no interface, no crosshair, no health bar. Flat shading,
hard edges, palette-locked, no grain overlay, no vignette.
```

---

## Prompt B — zombie figure study

The single most useful follow-up: big clean figures I can read as shapes.

```
Produce a figure study sheet of the five zombie types, drawn LARGE and clean on
a flat dark background (#0d1117). 1600x1200. No transparency needed.

Five figures standing in a row, evenly spaced, all in strict side view facing
RIGHT, all standing on one shared ground line with a hard dark contact shadow
pooled under each. Each figure roughly 900 pixels tall so its construction is
completely legible.

Left to right:
1. WALKER — tall gaunt adult, hunched, head lolling forward ahead of the hips,
   arms hanging slack, knees loose, weight dragging. Ruined dark civilian work
   clothes, torn at forearms and shins. Roughly 0.38 as wide as tall.
2. ARMORED — the same walker wearing improvised plate: a riot vest, strapped
   scrap metal, a dented helmet over the skull. Heavier, more deliberate.
   Roughly 0.42 as wide as tall.
3. RUNNER — whip-thin ex-athlete, sprinting on the balls of its feet, leaning
   forward about 26 degrees, arms driving back, mouth open, long stride. Torn
   vest, bare arms. Roughly 0.30 as wide as tall.
4. BLOATER — the tallest and by far the widest, roughly 0.72 as wide as tall.
   Swollen distended abdomen bursting a shirt, split skin showing raw flesh,
   tiny head sunk into the shoulders, arms held out by its own bulk, ponderous
   waddle. Repulsive, not comic.
5. CRAWLER — low to the ground, only about a third the height of the walker.
   Torso and arms only, dragging itself east with useless legs trailing, jaw
   near the dirt, a smear of dark blood behind it.

RENDERING — this is the important part:
Draw each figure as a FLAT POSTER SILHOUETTE in exactly three values: a
near-black shadow mass (#12161d), a base body value (#242a2e cloth, #63705e
dead skin), and a single warm lit edge (#cdb277) along the right-hand contour
only — shoulder, cheek, forearm, front thigh, front shin. Dark dried blood
(#7a1512) on the chest and chin. No interior detail beyond those three values.
No face features. No rendering, no gradients, no texture.

Then, along the bottom of the same image, add one extra row: the WALKER only,
repeated four times at one twelfth the height above, as a four-frame walk cycle
— legs offset back, neutral, forward, neutral; arms opposing; body bobbing down
and up. This bottom row shows how the silhouette must survive at gameplay size.
```

---

## Prompt C — survivor figure study

```
Produce a figure study of the player character, drawn LARGE and clean on a flat
dark background (#0d1117). 1200x1200.

Three poses in a row, all in strict side view facing LEFT, sharing one ground
line with a hard dark contact shadow under each. Each figure roughly 900 pixels
tall.

1. IDLE — standing braced behind cover, rifle held low across the body, feet
   planted, weight settled. Tired and dug in, not a heroic pose.
2. FIRING — rifle shouldered and level, cheek to the stock, forward foot
   loaded. Leave clear empty space at the muzzle; do not draw a muzzle flash.
3. RECOIL — the shot just landed, shoulder driven back, muzzle kicked up,
   rear foot taking the weight.

The survivor: worn olive-green field jacket, dark trousers, heavy boots, a
scavenged bolt-action rifle, weathered skin, no hat.

RENDERING — flat poster silhouette in exactly three values: near-black shadow
mass (#232833), a base jacket value (#3d6b39), and a single warm lit edge
(#cdb277). Because the floodlight is above and BEHIND him, the lit edge lands on
the BACK of his shoulders, the top of his head, the back of the arm and the heel
side of the boot — while his face, chest and the whole front of the figure fall
into shadow. Getting that backlit read correct is the point of this study.
No gradients, no texture, no interior detail beyond the three values.
```

---

## Prompt D — lighting and atmosphere study

Answers "what should the floodlight and the ground actually look like."

```
Produce a comparison sheet: the same simple night scene rendered three times
with three different lighting treatments, stacked as three horizontal bands in
one 1600x1500 image.

THE SCENE, identical in all three bands: an empty flat field seen side-on, a
near-black treeline along the top, a timber barricade wall down the right edge,
a steel floodlight pole above the barricade with its caged head angled down and
west, and exactly three small dark hunched figures standing in the open field at
near, middle and far distance. No text, no HUD, no letters.

BAND 1 — POOL: the floodlight throws a single warm elliptical pool on the
ground beneath and west of the lamp, brightest directly under it, falling off
smoothly to near-black by the far west edge. The light lives on the GROUND. No
visible cone in the air, no straight edges anywhere.

BAND 2 — VOLUME: the same, plus a faint visible cone of light in the air —
haze catching the beam — with soft irregular edges, plus the same ground pool.
Show how much atmospheric haze is too much versus just enough.

BAND 3 — BANDED: no smooth falloff at all. The ground is divided into four or
five hard horizontal depth bands, each a flat single value, stepping from warm
lit near the barricade to near-black at the far west. Deliberately posterised.

In every band the three figures must remain readable as dark masses with a warm
right-hand rim and a hard contact shadow, including the far one standing in the
near-black region. Flat shading, hard edges, palette-locked, no grain.
```

---

## Prompt E — barricade elevation study

The right edge of the current build is a crammed illegible strip.

```
Produce an elevation study of the barricade line, drawn flat and clean, front-on
with no perspective, as an architectural elevation. 1400x1000. Background flat
#0d1117.

A single continuous run of scavenged timber barricade fills the width of the
image: filthy scrap planks nailed across each other at rough angles, splintered
ends, mismatched lengths, nail heads visible. Sandbags stacked along the base.
Coils of barbed wire strung along the top on short stakes.

Then show FOUR STATES of the same eight-plank section, as four panels across the
bottom third of the image, left to right:
  1. INTACT — every plank sound.
  2. SCUFFED — bullet holes, dark blood spatter, one plank cracked.
  3. FAILING — two planks hanging loose, a gap punched through, splinters.
  4. BREACHED — a hole clean through, planks snapped back, wire torn.

RENDERING: flat shading, three values per plank only — timber shadow (#2a241d),
timber base (#4a4034), timber lit edge (#6b5d4a) along the top and right of each
plank. Wire is a single flat grey (#7a7d80). Sandbags flat (#5b5642) with one
darker crease value. No wood grain texture, no photographic detail, no gradients.
Hard edges throughout. No text, no labels, no numbers on the panels.
```

---

## Prompt F — word-and-figure attachment study

Solves a real gameplay-readability bug: which word belongs to which body.

```
Produce a design comparison sheet solving one specific problem, as four
horizontal bands in one 1400x1200 image.

THE PROBLEM: in this game each zombie is a WORD, and a small shambling figure
stands with it. In the current build the word floats up and to the left of its
figure with nothing connecting them, so with a dozen zombies on screen the
player cannot tell which word belongs to which body.

Draw four different solutions. In each band, show the same three small dark
hunched figures walking right across a dark blue-green field, each figure paired
with a bone-white monospace lowercase word. Use the words: shamble, rot, husk.

BAND 1 — ABOVE: the word sits directly and tightly above its figure, centred on
the figure's spine, close enough that the pairing is unambiguous.
BAND 2 — BANNER: the word sits above the figure on a small dark translucent
plate, like a nameplate, so it reads against any background.
BAND 3 — TETHER: the word sits above and offset, joined to the figure's head by
a thin faint vertical leader line.
BAND 4 — WORN: the word is not floating at all — the letters are printed across
the figure's own chest and shoulders, following the body, as if stencilled on it.

The words are the only lettering allowed in this image; spell them exactly, in a
plain monospace face, bone-white (#c9cbbd). No other text, no labels, no numbers,
no captions on the bands. Flat shading, hard edges, palette-locked.
```

---

## Prompt G — wordmark logo

```
Produce the title wordmark for MOTIONS OF THE DEAD. Lettering is required here —
render the text exactly and check the spelling letter by letter.

Text, three lines, centred:
  MOTIONS
  OF THE
  DEAD

Typeface: heavy condensed monospace or squared-off slab, all caps, wide letter
spacing, drawn as if stencilled onto metal. The monospace feel matters — this is
a game about a text editor — but it must read as signage, not as a code listing.

Treatment: bone-white lettering (#c9cbbd) with the paint worn off the edges,
scratched and chipped. A thin dried-blood underline (#5a1a18) beneath DEAD,
dragged to the right like a smear. One or two dark blood spatters crossing the
letterforms — wet enough to feel it, never enough to obscure a character. The
right-hand edge of every stroke catches a faint warm rim (#cdb277).

Composition: horizontal, roughly 3:2, transparent background, generous padding.
No frame, no border, no background plate, no subtitle, no tagline, no extra
words, no zombies, no figures. Lettering only. Flat, hard-edged, three values.
```

---

## Prompt H — app icon

```
Produce a square app icon, one design, as a single 1024x1024 image that stays
readable when scaled down to 32x32.

Concept: an amber Vim block cursor — a solid filled rectangle, #e0a020 — sitting
over a single bone-white uppercase monospace letter W, on a flat near-black
field (#0d1117). The letter is partly eaten away: its right side crumbles into
dark blood-red flecks (#8a0f0f) drifting east, as if the glyph is decaying.

Rules: extremely simple, high contrast, three colours plus the background. No
gradient background, no bevel, no gloss, no drop shadow, no outer glow, no
border, no rounded-rectangle frame — the platform adds that. Nothing in the
image may be thinner than one sixteenth of the canvas width; finer detail
disappears at 32 pixels. Fill the canvas edge to edge with the dark field
colour. This asset is NOT transparent. Render the letter W and nothing else
textual.
```

---

## Accepting or rejecting a returned image

Reject and re-run if any of these is true:

1. It is painterly, blurred, grainy, or has soft volumetric shading — it cannot
   be turned into draw calls.
2. Figures do not separate from the ground by value, or have no warm right-edge
   rim, or have no contact shadow.
3. The light pool has a straight edge.
4. Colours drift outside Block 0 (eyedrop a few pixels).
5. It baked in text, a HUD, or a watermark that Block 0 forbade.

Then: drop the keeper in `runs/shots/ref/`, and diff it against
`runs/shots/current/wave1-18s.png` before asking for renderer changes.
