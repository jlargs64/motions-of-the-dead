// ============================================================================
// Phase C — Renderer. Palette + baked colour slots.
//
// Art direction: *The Last Stand* (Con Artist Games, 2007). A nocturnal
// exterior — slate night sky, black treeline, dishwater fog, cold blue-green
// grass, filthy timber barricade, a survivor on the right. The old
// "near-black + bone + blood only" rule is gone; this is a real palette.
//
// Every colour the draw loop can use lives here, and every rgba() string it
// can need is pre-baked, because the draw loop allocates nothing.
// ============================================================================

export const PALETTE: {
  // --- legacy keys (Phase E / main.ts depend on these names) ---------------
  bg: string; bone: string; blood: string; bloodBright: string;
  green: string; amber: string; dim: string; white: string;
  // --- scene ----------------------------------------------------------------
  skyTop: string; skyHorizon: string; fog: string; tree: string;
  fieldFar: string; fieldNear: string; fieldDeep: string;
  bloodDry: string; paving: string;
  /** the floodlight: lamp core, warm cone, and the darkness it leaves west */
  light: string; lightWarm: string; shadowWest: string;
  houseWall: string; houseWallDark: string; window: string; rust: string; chain: string;
  // --- barricade ------------------------------------------------------------
  timber: string; timberShadow: string; timberHi: string;
  wire: string; sandbag: string; void_: string;
  // --- actors ---------------------------------------------------------------
  jacket: string; jacketHi: string; jacketDk: string; trouser: string; skin: string; skinDk: string;
  stock: string; stockHi: string; steel: string; steelHi: string;
  zSkin: string; zSkinDark: string; zCloth: string; zClothHi: string;
  zBlood: string; sick: string; sickDark: string; flesh: string;
  // --- fx / ui --------------------------------------------------------------
  flashCore: string; flashEdge: string; grey: string;
  paper: string; paperEdge: string; ink: string; inkPanel: string;
} = {
  bg: '#0d1117',
  bone: '#c9cbbd',          // pale sick zombie glyph
  blood: '#8a0f0f',
  bloodBright: '#d11a1a',
  green: '#4a7c3f',         // armoured brackets
  amber: '#e0a020',         // crosshair
  dim: '#8a929e',           // legible grey over grass (was near-black)
  white: '#e8e8e0',         // HUD white

  skyTop: '#1a2130',
  skyHorizon: '#3a4453',
  fog: '#4d5561',
  tree: '#0f131b',
  fieldFar: '#242e29',
  fieldNear: '#2c3a31',
  fieldDeep: '#171d1a',
  bloodDry: '#5a1a18',
  paving: '#2a2d32',

  light: '#f2e6be',
  lightWarm: '#cdb277',
  shadowWest: '#04060a',
  houseWall: '#1c1f26',
  houseWallDark: '#12141a',
  window: '#d9b25c',
  rust: '#5a3a24',
  chain: '#6d7379',

  timber: '#4a4034',
  timberShadow: '#2a241d',
  timberHi: '#6b5d4a',
  wire: '#7a7d80',
  sandbag: '#5b5642',
  void_: '#12161d',

  jacket: '#436f38',
  jacketHi: '#5c8f4a',
  jacketDk: '#2a4a25',
  trouser: '#23272f',
  skin: '#b08d6f',
  skinDk: '#7d6350',
  stock: '#5a3e28',
  stockHi: '#7a563a',
  steel: '#2a2e35',
  steelHi: '#5b6470',

  zSkin: '#8f9c86',
  zSkinDark: '#63705e',
  zCloth: '#242a2e',
  zClothHi: '#39424a',
  zBlood: '#7a1512',
  sick: '#c9cbbd',
  sickDark: '#9fa392',
  flesh: '#8c6f63',

  flashCore: '#ffe6a0',
  flashEdge: '#ff9020',
  grey: '#9aa0a6',
  paper: '#d8cfb8',
  paperEdge: '#b6aa8d',
  ink: '#1b1a17',
  inkPanel: '#161b22',
};

// --- glyph atlas colour slots ------------------------------------------------
// Kept deliberately short: the atlas is 96 glyphs wide by this many rows.
export const C = {
  BG: 0,
  BONE: 1,
  BLOOD: 2,
  BLOOD_BRIGHT: 3,
  GREEN: 4,
  AMBER: 5,
  DIM: 6,
  WHITE: 7,
  BLOOD_DARK: 8,
  SICK_DARK: 9,
  GREY: 10,
  PAPER: 11,
  INK: 12,
} as const;

export const ATLAS_COLORS: readonly string[] = [
  PALETTE.bg,          // 0
  PALETTE.bone,        // 1
  PALETTE.blood,       // 2
  PALETTE.bloodBright, // 3
  PALETTE.green,       // 4
  PALETTE.amber,       // 5
  PALETTE.dim,         // 6
  PALETTE.white,       // 7
  PALETTE.bloodDry,    // 8
  PALETTE.sickDark,    // 9
  PALETTE.grey,        // 10
  PALETTE.paper,       // 11
  PALETTE.ink,         // 12
];

// --- gib chunk tones ---------------------------------------------------------
export const T = {
  FLESH: 0,
  BLOOD_DARK: 1,
  BLOOD: 2,
  BLOOD_BRIGHT: 3,
  GREY: 4,
  CLOTH: 5,
  BONE: 6,
} as const;

export const CHUNK_TONES: readonly string[] = [
  PALETTE.flesh,       // 0
  PALETTE.bloodDry,    // 1
  PALETTE.blood,       // 2
  PALETTE.bloodBright, // 3
  PALETTE.grey,        // 4
  PALETTE.zCloth,      // 5
  PALETTE.bone,        // 6  shards of skull and rib
];

/** Pre-baked rgba() strings. Nothing in a hot path may build one. */
export const RGBA = {
  scrim: 'rgba(13, 17, 23, 0.70)',
  scrimSoft: 'rgba(13, 17, 23, 0.30)',
  scrimBloater: 'rgba(13, 17, 23, 0.80)',
  laneLight: 'rgba(210, 224, 214, 0.030)',
  laneDark: 'rgba(0, 0, 0, 0.055)',
  /** every other lane, across the walkable field: dark enough to count by */
  laneBand: 'rgba(0, 0, 0, 0.16)',
  laneBandEdge: 'rgba(210, 224, 214, 0.045)',
  laneCursor: 'rgba(224, 160, 32, 0.055)',
  /** the cursor's lane when something is standing in it: warmer, and brighter */
  laneCursorHot: 'rgba(232, 120, 40, 0.16)',
  laneCursorEdge: 'rgba(232, 140, 48, 0.40)',
  errorWash: 'rgba(138, 15, 15, 0.30)',
  errorWashSafe: 'rgba(224, 160, 32, 0.22)',
  hudBed: 'rgba(13, 17, 23, 0.34)',
  hudWhite: 'rgba(232, 232, 224, 0.80)',
  hudWhiteDim: 'rgba(232, 232, 224, 0.45)',
  hudTrack: 'rgba(13, 17, 23, 0.55)',
  hudCrack: 'rgba(0, 0, 0, 0.45)',
  showcmdBed: 'rgba(13, 17, 23, 0.46)',
  figureShadow: 'rgba(0, 0, 0, 0.34)',
  pauseWash: 'rgba(43, 52, 70, 0.52)',
  pauseInk: 'rgba(13, 17, 23, 0.30)',
  tracer: 'rgba(255, 230, 160, 0.90)',
  tracerSoft: 'rgba(255, 144, 32, 0.35)',
  panelShadow: 'rgba(0, 0, 0, 0.45)',
  wireGlint: 'rgba(200, 206, 210, 0.35)',
  breachGlow: 'rgba(209, 26, 26, 0.16)',
} as const;

// --- figure shading ramps ----------------------------------------------------
// The floodlight is the only light source. Figures pick a step from these by
// `lightAt[col]` (see renderer.ts) — 6 steps, index 0 is the unlit west edge.
// Baked at load so the draw loop never mixes a colour.
export const SHADE_STEPS = 6;

function hex(c: string): [number, number, number] {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a); const [br, bg, bb] = hex(b);
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
function ramp(dark: string, lit: string, gamma = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < SHADE_STEPS; i++) out.push(mix(dark, lit, Math.pow(i / (SHADE_STEPS - 1), gamma)));
  return out;
}

/** cloth, lit face: near-black in the dark, a dull grey-blue in the light */
export const FIG_BODY: readonly string[] = ramp('#111419', '#3d454e', 1.2);
/** cloth, shadow face (west side, away from the lamp) */
export const FIG_BODY_DK: readonly string[] = ramp('#090b0f', '#222830', 1.2);
/** the east rim, where the lamp catches the crown and the shoulder */
export const FIG_RIM: readonly string[] = ramp('#6d6650', '#f0dcaa', 1.0);
/** exposed skin, lit face — the lightest thing on a figure; it is what reads */
export const FIG_SKIN: readonly string[] = ramp('#5f6b5a', '#a7b29a', 1.0);
/** exposed skin, shadow face */
export const FIG_SKIN_DK: readonly string[] = ramp('#3e483b', '#6f7a68', 1.0);
/** eye sockets, mouth, the dark under the brow */
export const FIG_HOLLOW: readonly string[] = ramp('#05070a', '#151a1f', 1.0);
/** blood on the figure */
export const FIG_BLOOD: readonly string[] = ramp('#1a0606', PALETTE.zBlood, 1.0);
/** bright arterial blood — the one saturated thing */
export const FIG_BLOOD_HI: readonly string[] = ramp('#3a0808', PALETTE.bloodBright, 1.0);
/** the armoured plate and helmet; stays recognisably the bracket green */
export const FIG_PLATE: readonly string[] = ramp('#1a2818', '#4f7443', 0.8);
export const FIG_PLATE_DK: readonly string[] = ramp('#0f180e', '#2e4728', 0.8);
/** the bloater's distended gut, paler than the skin */
export const FIG_BELLY: readonly string[] = ramp('#6a7262', '#c3c8b0', 1.0);
export const FIG_BELLY_DK: readonly string[] = ramp('#464d40', '#858c78', 1.0);
