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
  // --- barricade ------------------------------------------------------------
  timber: string; timberShadow: string; timberHi: string;
  wire: string; sandbag: string; void_: string;
  // --- actors ---------------------------------------------------------------
  jacket: string; jacketHi: string; trouser: string; skin: string;
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

  skyTop: '#2b3446',
  skyHorizon: '#4a5568',
  fog: '#5b6470',
  tree: '#161b26',
  fieldFar: '#3a4a44',
  fieldNear: '#2d3a35',
  fieldDeep: '#222c28',
  bloodDry: '#5a1a18',
  paving: '#3a3d42',

  timber: '#4a4034',
  timberShadow: '#2a241d',
  timberHi: '#6b5d4a',
  wire: '#7a7d80',
  sandbag: '#5b5642',
  void_: '#12161d',

  jacket: '#3d6b39',
  jacketHi: '#54874b',
  trouser: '#232833',
  skin: '#b08d6f',

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
} as const;

export const CHUNK_TONES: readonly string[] = [
  PALETTE.flesh,       // 0
  PALETTE.bloodDry,    // 1
  PALETTE.blood,       // 2
  PALETTE.bloodBright, // 3
  PALETTE.grey,        // 4
  PALETTE.zCloth,      // 5
];

/** Pre-baked rgba() strings. Nothing in a hot path may build one. */
export const RGBA = {
  scrim: 'rgba(13, 17, 23, 0.62)',
  scrimSoft: 'rgba(13, 17, 23, 0.30)',
  scrimBloater: 'rgba(13, 17, 23, 0.76)',
  laneLight: 'rgba(210, 224, 214, 0.030)',
  laneDark: 'rgba(0, 0, 0, 0.055)',
  laneCursor: 'rgba(224, 160, 32, 0.055)',
  errorWash: 'rgba(138, 15, 15, 0.30)',
  errorWashSafe: 'rgba(224, 160, 32, 0.22)',
  hudBed: 'rgba(13, 17, 23, 0.34)',
  hudWhite: 'rgba(232, 232, 224, 0.80)',
  hudWhiteDim: 'rgba(232, 232, 224, 0.45)',
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
