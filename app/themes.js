/**
 * SurveyAll — theme + background system.
 *
 * A deck carries its whole look: a theme (palette, type pairing, chart
 * personality) and a background (theme default, solid, gradient, pattern,
 * or an uploaded image with dim/blur controls).
 *
 * Themes apply as CSS custom properties on a root element, so every
 * surface — projector, phone, editor preview — reads the same tokens.
 * Phones deliberately take the *colours* but not heavy background images:
 * better legibility on a small screen, and it keeps 60 devices from each
 * downloading a 2 MB photo.
 */

/**
 * House rules for the palettes below. They exist because the first pass
 * authored each theme on its own and the set read like twenty different
 * products: complementary accents at full chroma, a novelty face here and
 * there, and nine different corner radii.
 *
 * ONE ACCENT PER THEME. `--accent-2` is an analogous neighbour or a
 *   desaturated counterpoint (chroma at most ~60% of the accent), never a
 *   second saturated colour arguing with the first. This is not only
 *   taste: charts.js walks accent → accent-2 in OKLab, so a tonal pair
 *   yields a clean series ramp while a complementary pair crosses grey.
 * NEUTRALS CARRY THE ACCENT'S HUE. Grounds, surfaces and edges are tinted
 *   a few per cent toward the accent rather than sitting on pure grey.
 * THREE RADII, NOT NINE. 0px for the editorial themes, 6px for the
 *   product ones, 999px for the soft ones. Nothing in between.
 * TYPE PERSONALITY COMES FROM CSS, NOT FROM A NOVELTY FACE. Weight,
 *   tracking and optical size per theme live in styles/present.css under
 *   [data-theme-id]; the faces themselves stay within the eight we ship.
 * BLURBS state what the room looks like in one sentence. No jokes.
 */
export const THEMES = {
  'lecture-hall': {
    name: 'Lecture Hall',
    blurb: 'Warm paper, ink navy, a quiet serif. The default.',
    dark: false,
    tokens: {
      '--ink': '#1c2434',
      '--ink-soft': '#4a5568',
      '--ground': '#f7f4ee',
      '--surface': '#fffdf8',
      '--edge': '#e2dbcd',
      '--accent': '#4a5d23',
      '--accent-soft': '#e6e7d5',
      '--accent-2': '#b45309',
      '--good': '#15803d',
      '--bad': '#b91c1c',
      '--display': "'Fraunces','Iowan Old Style','Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'paper-warm' },
  },

  chalkboard: {
    name: 'Chalkboard',
    blurb: 'Deep slate green, chalk gold, a warm serif.',
    dark: true,
    tokens: {
      '--ink': '#f1f4ee',
      '--ink-soft': '#b6c3b1',
      '--ground': '#1b2620',
      '--surface': '#243029',
      '--edge': '#38473e',
      '--accent': '#f2cd80',
      '--accent-soft': '#453f28',
      '--accent-2': '#8ec9a8',
      '--good': '#7fd1a3',
      '--bad': '#ff9b8a',
      '--display': "'Fraunces','Hoefler Text','Baskerville',Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'slate' },
  },

  'clean-slate': {
    name: 'Clean Slate',
    blurb: 'White, one blue, nothing else.',
    dark: false,
    tokens: {
      '--ink': '#0f172a',
      '--ink-soft': '#64748b',
      '--ground': '#ffffff',
      '--surface': '#f8fafc',
      '--edge': '#e2e8f0',
      '--accent': '#0284c7',
      '--accent-soft': '#e0f2fe',
      '--accent-2': '#5265d4',
      '--good': '#059669',
      '--bad': '#dc2626',
      '--display': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'none' },
  },

  'neon-night': {
    name: 'Neon Night',
    blurb: 'Near-black with electric cyan. Built for quiz rounds.',
    dark: true,
    tokens: {
      '--ink': '#e9f6ff',
      '--ink-soft': '#8aa4b8',
      '--ground': '#080d16',
      '--surface': '#111b2b',
      '--edge': '#1e3048',
      '--accent': '#22d3ee',
      '--accent-soft': '#0e3b47',
      '--accent-2': '#a78bfa',
      '--good': '#4ade80',
      '--bad': '#fb7185',
      '--display': "'Oswald','Avenir Next Condensed','Helvetica Neue',Impact,sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'grid-glow' },
  },

  botanical: {
    name: 'Botanical',
    blurb: 'Forest green on cream, set with room to breathe.',
    dark: false,
    tokens: {
      '--ink': '#1a2b21',
      '--ink-soft': '#526b5c',
      '--ground': '#f2f6ee',
      '--surface': '#ffffff',
      '--edge': '#d3ded0',
      '--accent': '#2f6d4f',
      '--accent-soft': '#d9ebdf',
      '--accent-2': '#8a6a2f',
      '--good': '#2f6d4f',
      '--bad': '#b4472e',
      '--display': "'Faustina','Optima','Gill Sans MT',Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '999px',
    },
    background: { kind: 'preset', id: 'topo' },
  },

  letterpress: {
    name: 'Letterpress',
    blurb: 'Cream stock, oxblood accent, hairline rules.',
    dark: false,
    tokens: {
      '--ink': '#241f1c',
      '--ink-soft': '#6b5f57',
      '--ground': '#efe9dd',
      '--surface': '#f9f5ec',
      '--edge': '#d6cabb',
      '--accent': '#8c2f28',
      '--accent-soft': '#efd9d5',
      '--accent-2': '#44586c',
      '--good': '#3f6b3a',
      '--bad': '#8c2f28',
      '--display': "'Fraunces','Hoefler Text','Baskerville','Times New Roman',serif",
      '--body': "'Source Serif 4','Charter',Georgia,serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'paper-cream' },
  },

  midnight: {
    name: 'Midnight',
    blurb: 'Deep indigo with an amber accent. Built for dark rooms.',
    dark: true,
    tokens: {
      '--ink': '#eceafd',
      '--ink-soft': '#a29fc4',
      '--ground': '#15132b',
      '--surface': '#1f1c3d',
      '--edge': '#332e5c',
      '--accent': '#fbbf24',
      '--accent-soft': '#42351a',
      '--accent-2': '#818cf8',
      '--good': '#34d399',
      '--bad': '#fb7185',
      '--display': "'Inter','Inter var','Avenir Next','Helvetica Neue',sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'aurora' },
  },

  'high-contrast': {
    name: 'High Contrast',
    blurb: 'Pure black on white, heavy weights. Back-row legibility.',
    dark: false,
    highContrast: true,
    tokens: {
      '--ink': '#000000',
      '--ink-soft': '#333333',
      '--ground': '#ffffff',
      '--surface': '#ffffff',
      '--edge': '#000000',
      '--accent': '#0000cc',
      '--accent-soft': '#ffe600',
      '--accent-2': '#7a0000',
      '--good': '#006600',
      '--bad': '#a30000',
      '--display': "'Inter','Inter var',Arial,Helvetica,sans-serif",
      '--body': "'Inter','Inter var',Arial,Helvetica,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'none' },
  },

  'citrus-studio': {
    name: 'Citrus Studio',
    blurb: 'Persimmon and amber on warm white. Morning energy.',
    dark: false,
    tokens: {
      '--ink': '#2b2118',
      '--ink-soft': '#6f5f4e',
      '--ground': '#fff8ef',
      '--surface': '#ffffff',
      '--edge': '#f0e2cd',
      '--accent': '#d9480f',
      '--accent-soft': '#ffe3d3',
      '--accent-2': '#b0762a',
      '--good': '#2f9e44',
      '--bad': '#c92a2a',
      '--display': "'Fraunces','Iowan Old Style',Palatino,Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'gradient-sunrise' },
  },

  riviera: {
    name: 'Riviera',
    blurb: 'Sea teal and muted coral under a warm serif.',
    dark: false,
    tokens: {
      '--ink': '#0f3433',
      '--ink-soft': '#4e7472',
      '--ground': '#eef7f6',
      '--surface': '#ffffff',
      '--edge': '#d3e7e4',
      '--accent': '#0c8599',
      '--accent-soft': '#d2f0f2',
      '--accent-2': '#c25e3f',
      '--good': '#2f9e44',
      '--bad': '#e03131',
      '--display': "'Fraunces','Iowan Old Style',Palatino,Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'gradient-dusk' },
  },

  sorbet: {
    name: 'Sorbet',
    blurb: 'Rose and raspberry, softly rounded.',
    dark: false,
    tokens: {
      '--ink': '#3d1f33',
      '--ink-soft': '#7d5570',
      '--ground': '#fdf2f6',
      '--surface': '#ffffff',
      '--edge': '#f3d9e5',
      '--accent': '#c2255c',
      '--accent-soft': '#ffdeeb',
      '--accent-2': '#a8557f',
      '--good': '#099268',
      '--bad': '#c92a2a',
      '--display': "'Fraunces','Iowan Old Style',Palatino,Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '999px',
    },
    background: { kind: 'preset', id: 'paper-warm' },
  },

  arcade: {
    name: 'Arcade',
    blurb: 'Violet dark, magenta pulse. Quiz night.',
    dark: true,
    tokens: {
      '--ink': '#f2eeff',
      '--ink-soft': '#a79fc9',
      '--ground': '#12101f',
      '--surface': '#1c1930',
      '--edge': '#322c52',
      '--accent': '#f06595',
      '--accent-soft': '#3d1b2c',
      '--accent-2': '#9775fa',
      '--good': '#51cf66',
      '--bad': '#ff6b6b',
      '--display': "'Inter','Inter var','Avenir Next','Helvetica Neue',sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'grid-glow' },
  },
  observatory: {
    name: 'Observatory',
    blurb: 'Ink-black sky, brass instruments, a scatter of stars.',
    dark: true,
    tokens: {
      '--ink': '#f4f1e8',
      '--ink-soft': '#9d9a8e',
      '--ground': '#0b0e14',
      '--surface': '#151a24',
      '--edge': '#2a3140',
      '--accent': '#d4a94e',
      '--accent-soft': '#3a3222',
      '--accent-2': '#8fb8d8',
      '--good': '#79c98f',
      '--bad': '#e08a7a',
      '--display': "'Fraunces','Hoefler Text','Baskerville',Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '999px',
    },
    background: { kind: 'preset', id: 'starfield' },
  },

  kiln: {
    name: 'Kiln',
    blurb: 'Terracotta and sand under a cool glaze.',
    dark: false,
    tokens: {
      '--ink': '#3a241a',
      '--ink-soft': '#7d6152',
      '--ground': '#f4e9dc',
      '--surface': '#fbf4ea',
      '--edge': '#e0cdb8',
      '--accent': '#b8502e',
      '--accent-soft': '#f2d9cd',
      '--accent-2': '#4c6b7d',
      '--good': '#5a7d3f',
      '--bad': '#a33a2a',
      '--display': "'Fraunces','Iowan Old Style',Palatino,Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '999px',
    },
    background: { kind: 'preset', id: 'arches' },
  },

  blueprint: {
    name: 'Blueprint',
    blurb: 'Engineer blue and white line-work. Drafting table.',
    dark: true,
    tokens: {
      '--ink': '#eef5fb',
      '--ink-soft': '#98b2c9',
      '--ground': '#12365c',
      '--surface': '#1a4270',
      '--edge': '#2f5b8c',
      '--accent': '#ffd166',
      '--accent-soft': '#4a4226',
      '--accent-2': '#c9dff0',
      '--good': '#7fd8a8',
      '--bad': '#ff9d8a',
      '--display': "'Inter','Inter var','Avenir Next','Helvetica Neue',sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'drafting' },
  },

  gallery: {
    name: 'Gallery',
    blurb: 'Museum white, near-black ink, one vermilion stroke.',
    dark: false,
    tokens: {
      '--ink': '#161513',
      '--ink-soft': '#6e6a63',
      '--ground': '#f5f3ef',
      '--surface': '#fdfcfa',
      '--edge': '#dcd8d0',
      '--accent': '#d43d2a',
      '--accent-soft': '#f7ddd8',
      '--accent-2': '#8a8377',
      '--good': '#4a7c59',
      '--bad': '#b0342a',
      '--display': "'Fraunces','Hoefler Text','Baskerville',Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'plinth' },
  },

  broadsheet: {
    name: 'Broadsheet',
    blurb: 'Newsprint grey, headline black, one red stamp.',
    dark: false,
    tokens: {
      '--ink': '#191817',
      '--ink-soft': '#5c5a56',
      '--ground': '#eceae4',
      '--surface': '#f6f4ef',
      '--edge': '#c9c6bd',
      '--accent': '#c0201e',
      '--accent-soft': '#f0d6d3',
      '--accent-2': '#33475c',
      '--good': '#2e6b45',
      '--bad': '#c0201e',
      '--display': "'Oswald','Avenir Next Condensed','Franklin Gothic Medium','Helvetica Neue',sans-serif",
      '--body': "'Source Serif 4','Charter',Georgia,serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'halftone' },
  },

  velvet: {
    name: 'Velvet',
    blurb: 'Theatre burgundy and champagne gold.',
    dark: true,
    tokens: {
      '--ink': '#f7ecdf',
      '--ink-soft': '#bfa294',
      '--ground': '#241014',
      '--surface': '#341920',
      '--edge': '#563036',
      '--accent': '#e4bb6f',
      '--accent-soft': '#4a3626',
      '--accent-2': '#d98a9e',
      '--good': '#8fca9a',
      '--bad': '#f08f7d',
      '--display': "'Playfair Display','Didot','Bodoni MT',Georgia,serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'vignette' },
  },

  fjord: {
    name: 'Fjord',
    blurb: 'Glacier blue and cold granite. Nordic quiet.',
    dark: false,
    tokens: {
      '--ink': '#1d2b33',
      '--ink-soft': '#576d7b',
      '--ground': '#e9f0f2',
      '--surface': '#f7fafb',
      '--edge': '#cddade',
      '--accent': '#1f6f8b',
      '--accent-soft': '#d5e8ee',
      '--accent-2': '#b56a4e',
      '--good': '#3d8168',
      '--bad': '#bb4430',
      '--display': "'Inter','Inter var','Avenir Next','Helvetica Neue',sans-serif",
      '--body': "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'ridgeline' },
  },

  'rice-paper': {
    name: 'Rice Paper',
    blurb: 'Sumi ink on washi, one vermilion seal.',
    dark: false,
    tokens: {
      '--ink': '#26221e',
      '--ink-soft': '#6d6357',
      '--ground': '#f6f1e7',
      '--surface': '#fcf9f2',
      '--edge': '#ded4c2',
      '--accent': '#c93a2f',
      '--accent-soft': '#f4dbd6',
      '--accent-2': '#3f6c6a',
      '--good': '#4f7d52',
      '--bad': '#b03427',
      '--display': "'Fraunces','Hiragino Mincho ProN','Yu Mincho',Georgia,serif",
      '--body': "'Inter','Inter var','Hiragino Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'seigaiha' },
  },
};

export const DEFAULT_THEME = 'lecture-hall';

/**
 * Background presets. `css` is applied to the projector's backdrop layer.
 * Each is designed to sit *behind* a translucent panel, so nothing here
 * needs to be subtle enough to read text directly on.
 *
 * A backdrop is architecture, not decoration: texture alphas stay at or
 * under ~0.08 and gradient washes under ~0.14, because anything you
 * NOTICE in the first two seconds is competing with the question. The
 * vignette is the one deliberate exception — being seen is its whole job.
 *
 * `hidden: true` retires a preset from the picker without deleting it.
 * The key has to stay: decks store a background by id, and a missing key
 * silently falls back to a bare ground, so an old deck would quietly lose
 * its look. Hidden presets still render exactly as they always did.
 */
export const BACKGROUND_PRESETS = {
  none: { name: 'None', css: () => 'none' },

  'paper-warm': {
    name: 'Warm paper',
    css: (t) => `radial-gradient(ellipse at 20% 0%, ${hexA(t['--accent'], 0.07)}, transparent 55%),
                 radial-gradient(ellipse at 90% 100%, ${hexA(t['--accent-2'], 0.07)}, transparent 50%)`,
  },
  'paper-cream': {
    name: 'Cream stock',
    css: (t) => `repeating-linear-gradient(0deg, ${hexA(t['--ink'], 0.02)} 0 1px, transparent 1px 3px),
                 radial-gradient(ellipse at 50% -10%, ${hexA(t['--accent'], 0.06)}, transparent 60%)`,
  },
  slate: {
    name: 'Slate wash',
    css: (t) => `radial-gradient(ellipse at 30% 20%, ${hexA('#ffffff', 0.05)}, transparent 60%),
                 radial-gradient(ellipse at 75% 80%, ${hexA(t['--accent'], 0.06)}, transparent 55%)`,
  },
  'gradient-dusk': {
    name: 'Dusk',
    css: (t) => `linear-gradient(160deg, ${hexA(t['--accent'], 0.16)} 0%, transparent 45%),
                 linear-gradient(20deg, ${hexA(t['--accent-2'], 0.14)} 0%, transparent 50%)`,
  },
  'gradient-sunrise': {
    name: 'Sunrise',
    css: (t) => `linear-gradient(180deg, ${hexA(t['--accent-2'], 0.12)} 0%, transparent 40%),
                 radial-gradient(circle at 80% 10%, ${hexA(t['--accent'], 0.10)}, transparent 45%)`,
  },
  aurora: {
    name: 'Aurora',
    css: (t) => `radial-gradient(ellipse 80% 50% at 20% 0%, ${hexA(t['--accent-2'], 0.14)}, transparent 60%),
                 radial-gradient(ellipse 70% 60% at 85% 30%, ${hexA(t['--accent'], 0.11)}, transparent 60%),
                 radial-gradient(ellipse 60% 45% at 55% 105%, ${hexA(t['--good'], 0.07)}, transparent 65%)`,
  },
  dots: {
    name: 'Dot grid',
    css: (t) => `radial-gradient(${hexA(t['--ink'], 0.10)} 1.5px, transparent 1.5px)`,
    size: '26px 26px',
  },
  grid: {
    name: 'Graph paper',
    css: (t) => `linear-gradient(${hexA(t['--ink'], 0.07)} 1px, transparent 1px),
                 linear-gradient(90deg, ${hexA(t['--ink'], 0.07)} 1px, transparent 1px)`,
    size: '38px 38px',
  },
  'grid-glow': {
    name: 'Glow grid',
    css: (t) => `linear-gradient(${hexA(t['--accent'], 0.07)} 1px, transparent 1px),
                 linear-gradient(90deg, ${hexA(t['--accent'], 0.07)} 1px, transparent 1px),
                 linear-gradient(180deg, transparent 55%, ${hexA(t['--accent'], 0.04)} 100%),
                 radial-gradient(ellipse at 50% 120%, ${hexA(t['--accent'], 0.12)}, transparent 60%)`,
    size: '44px 44px, 44px 44px, 100% 100%, 100% 100%',
  },
  topo: {
    // wider rings than the first pass: at 28px the contours read as a
    // pattern swatch, at 44px they read as terrain seen from a long way up
    name: 'Contour',
    css: (t) => `repeating-radial-gradient(circle at 15% 85%, transparent 0 44px, ${hexA(t['--accent'], 0.045)} 44px 45px)`,
  },
  stripes: {
    name: 'Diagonal',
    hidden: true,
    css: (t) => `repeating-linear-gradient(45deg, ${hexA(t['--ink'], 0.035)} 0 14px, transparent 14px 28px)`,
  },
  confetti: {
    // Retired: 4px dots at half opacity are the one backdrop that reads as
    // clipart from the back row. Kept renderable for decks that chose it.
    name: 'Confetti',
    hidden: true,
    css: (t) => `radial-gradient(circle at 12% 20%, ${hexA(t['--accent'], 0.5)} 0 4px, transparent 4px),
                 radial-gradient(circle at 78% 12%, ${hexA(t['--accent-2'], 0.45)} 0 5px, transparent 5px),
                 radial-gradient(circle at 35% 78%, ${hexA(t['--good'], 0.4)} 0 3px, transparent 3px),
                 radial-gradient(circle at 88% 66%, ${hexA(t['--accent'], 0.4)} 0 4px, transparent 4px)`,
    size: '340px 340px',
  },

  starfield: {
    name: 'Starfield',
    css: (t) => `radial-gradient(circle at 18% 22%, ${hexA('#ffffff', 0.7)} 0 1px, transparent 1.5px),
                 radial-gradient(circle at 62% 8%, ${hexA('#ffffff', 0.45)} 0 1px, transparent 1.5px),
                 radial-gradient(circle at 84% 46%, ${hexA('#ffffff', 0.58)} 0 1.5px, transparent 2px),
                 radial-gradient(circle at 38% 64%, ${hexA(t['--accent'], 0.6)} 0 1px, transparent 1.5px),
                 radial-gradient(circle at 72% 88%, ${hexA(t['--accent-2'], 0.5)} 0 1px, transparent 1.5px),
                 radial-gradient(ellipse 90% 60% at 50% -20%, ${hexA(t['--accent-2'], 0.09)}, transparent 60%)`,
    size: '260px 260px, 260px 260px, 260px 260px, 260px 260px, 260px 260px, 100% 100%',
  },
  arches: {
    name: 'Adobe arches',
    css: (t) => `radial-gradient(ellipse 60% 45% at 50% 108%, ${hexA(t['--accent'], 0.14)}, transparent 70%),
                 radial-gradient(ellipse 70% 52% at 50% 116%, ${hexA(t['--accent-2'], 0.10)}, transparent 72%),
                 linear-gradient(180deg, ${hexA(t['--accent-2'], 0.05)} 0%, transparent 30%)`,
  },
  drafting: {
    name: 'Drafting grid',
    css: (t) => `linear-gradient(${hexA('#ffffff', 0.08)} 1px, transparent 1px),
                 linear-gradient(90deg, ${hexA('#ffffff', 0.08)} 1px, transparent 1px),
                 linear-gradient(${hexA('#ffffff', 0.04)} 1px, transparent 1px),
                 linear-gradient(90deg, ${hexA('#ffffff', 0.04)} 1px, transparent 1px)`,
    size: '120px 120px, 120px 120px, 24px 24px, 24px 24px',
  },
  plinth: {
    name: 'Plinth',
    css: (t) => `linear-gradient(180deg, transparent 78%, ${hexA(t['--ink'], 0.05)} 78%, ${hexA(t['--ink'], 0.05)} 100%),
                 radial-gradient(ellipse 70% 40% at 50% 0%, ${hexA(t['--ink'], 0.03)}, transparent 60%)`,
  },
  halftone: {
    // Newsprint tooth, not comic-book dots: a 4px cell at 4% reads as the
    // grain of cheap paper, which is what a broadsheet actually looks like.
    name: 'Newsprint grain',
    css: (t) => `radial-gradient(${hexA(t['--ink'], 0.04)} 0.5px, transparent 1px),
                 radial-gradient(${hexA(t['--ink'], 0.03)} 0.5px, transparent 1px)`,
    size: '4px 4px, 7px 7px',
  },
  vignette: {
    name: 'Vignette',
    css: (t) => `radial-gradient(ellipse 120% 90% at 50% 40%, transparent 45%, ${hexA('#000000', 0.35)} 100%),
                 radial-gradient(ellipse 80% 50% at 50% -10%, ${hexA(t['--accent'], 0.12)}, transparent 60%)`,
  },
  ridgeline: {
    name: 'Ridgeline',
    css: (t) => `linear-gradient(172deg, transparent 62%, ${hexA(t['--accent'], 0.08)} 62%, ${hexA(t['--accent'], 0.08)} 100%),
                 linear-gradient(188deg, transparent 74%, ${hexA(t['--ink'], 0.06)} 74%, ${hexA(t['--ink'], 0.06)} 100%),
                 radial-gradient(ellipse 80% 45% at 50% -15%, ${hexA(t['--accent-2'], 0.07)}, transparent 60%)`,
  },
  seigaiha: {
    name: 'Wave crests',
    css: (t) => `radial-gradient(circle at 50% 130%, transparent 0 36px, ${hexA(t['--accent-2'], 0.075)} 36px 38px, transparent 38px 52px, ${hexA(t['--accent-2'], 0.06)} 52px 54px, transparent 54px 68px, ${hexA(t['--accent-2'], 0.045)} 68px 70px, transparent 70px),
                 radial-gradient(circle at 0% 130%, transparent 0 36px, ${hexA(t['--accent-2'], 0.06)} 36px 38px, transparent 38px 52px, ${hexA(t['--accent-2'], 0.045)} 52px 54px, transparent 54px),
                 radial-gradient(circle at 100% 130%, transparent 0 36px, ${hexA(t['--accent-2'], 0.06)} 36px 38px, transparent 38px 52px, ${hexA(t['--accent-2'], 0.045)} 52px 54px, transparent 54px)`,
    size: '160px 80px',
  },
};

/** #rrggbb + alpha → rgba(). Accepts #rgb too. */
export function hexA(hex, alpha) {
  let h = String(hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return `rgba(0,0,0,${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Themes come back with their derived contrast tokens already filled in,
 * so no consumer has to remember to ask for them — a projector, a phone,
 * a preview tile and a saved custom theme all see the same complete set.
 * Cached because this runs on every render and the derivation walks a
 * colour ramp looking for a contrast floor.
 */
// keyed on the raw token bag rather than the theme wrapper: resolveTheme()
// hands back a fresh wrapper for custom themes on every call, but the
// tokens it wraps are the stable object living on the deck
const derivedCache = new WeakMap();

function withDerived(theme) {
  if (!theme || !theme.tokens) return theme;
  let tokens = derivedCache.get(theme.tokens);
  if (!tokens) {
    tokens = deriveTokens(theme.tokens);
    derivedCache.set(theme.tokens, tokens);
  }
  return tokens === theme.tokens ? theme : { ...theme, tokens };
}

export function getTheme(id) {
  // a resolved custom theme object passes straight through, so every
  // consumer (applyTheme, backgroundStyles, previews) works unchanged
  if (id && typeof id === 'object' && id.tokens) return withDerived(id);
  return withDerived(THEMES[id] || THEMES[DEFAULT_THEME]);
}

/**
 * Resolve a deck's theme reference into something getTheme understands.
 * 'custom' means "the theme saved on this deck" (deck.settings.customTheme,
 * created by the My Themes builder); anything else is a built-in id.
 * Falls back to the default theme if a deck says 'custom' but carries no
 * usable tokens (e.g. hand-edited data).
 */
export function resolveTheme(themeId, deck) {
  if (themeId === 'custom') {
    const c = deck?.settings?.customTheme;
    if (c && c.tokens && typeof c.tokens === 'object') {
      return { id: 'custom', name: c.name || 'My theme', dark: !!c.dark, tokens: c.tokens, background: c.background || { kind: 'none' } };
    }
    return THEMES[DEFAULT_THEME];
  }
  return themeId;
}

export function themeList() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, ...withDerived(t) }));
}

/**
 * Apply a theme's tokens to an element (usually documentElement).
 * Also stamps data-theme-dark so components can branch on luminance.
 * Accepts a built-in id or a resolved custom theme object.
 */
export function applyTheme(el, themeId) {
  const theme = getTheme(themeId);
  for (const [k, v] of Object.entries(theme.tokens)) el.style.setProperty(k, v);
  el.dataset.themeDark = theme.dark ? 'true' : 'false';
  el.dataset.themeId = THEMES[themeId] ? themeId : (theme.id === 'custom' ? 'custom' : DEFAULT_THEME);
  return theme;
}

/**
 * What a deck's background record actually resolves to.
 *
 * `{kind:'theme'}` means "whatever this theme ships with", so anything
 * that needs to know the real shape of the backdrop — the styles below,
 * and the ambience planner, which picks its motion from the texture —
 * has to go through here rather than reading `background.kind` directly.
 */
export function resolveBackground(background, themeId) {
  if (!background || background.kind === 'theme') {
    return getTheme(themeId).background || { kind: 'none' };
  }
  return background;
}

/**
 * Build inline styles for the projector backdrop layer.
 * @param {object} background {kind: 'theme'|'none'|'solid'|'preset'|'image', ...}
 */
export function backgroundStyles(background, themeId) {
  const theme = getTheme(themeId);
  const t = theme.tokens;
  const bg = resolveBackground(background, themeId);

  switch (bg.kind) {
    case 'solid':
      return {
        backgroundColor: bg.color || t['--ground'],
        backgroundImage: 'none',
        filter: 'none',
        opacity: '1',
        transform: 'none',
      };

    case 'image':
      return {
        backgroundImage: bg.url ? `url("${cssURL(bg.url)}")` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: bg.position || 'center',
        filter: bg.blur ? `blur(${clamp(bg.blur, 0, 24)}px)` : 'none',
        // dim is applied by a sibling scrim so blur doesn't smear the overlay
        opacity: '1',
        transform: bg.blur ? 'scale(1.06)' : 'none',
      };

    case 'preset': {
      const preset = BACKGROUND_PRESETS[bg.id] || BACKGROUND_PRESETS.none;
      const image = typeof preset.css === 'function' ? preset.css(t) : 'none';
      return {
        backgroundImage: image,
        backgroundSize: preset.size || 'auto',
        backgroundRepeat: preset.size ? 'repeat' : 'no-repeat',
        filter: 'none',
        opacity: '1',
        // reset explicitly: these objects are Object.assign'd onto a live
        // element that may have been showing an image a moment ago, and
        // that branch leaves a scale() behind
        transform: 'none',
      };
    }

    case 'none':
    default:
      return { backgroundImage: 'none', filter: 'none', opacity: '1', transform: 'none' };
  }
}

/** Opacity for the scrim that sits between backdrop and content. */
export function scrimOpacity(background) {
  if (background && background.kind === 'image') return clamp(background.dim ?? 0.45, 0, 0.95);
  return 0;
}

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function cssURL(u) {
  return String(u).replace(/["\\]/g, '\\$&').replace(/\n/g, '');
}

export const CHART_STYLES = {
  bars: 'Bars',
  columns: 'Columns',
  donut: 'Donut',
  dots: 'Dot plot',
};

/**
 * The word cloud's two shapes.
 *
 * A cloud encodes frequency as area, which sits near the bottom of the
 * accuracy ranking for magnitude judgments; a bar's length on a common
 * baseline sits at the top. Both are right, for different questions —
 * the cloud for "what did the room say", the list for "which of these
 * did it say more" — so the instructor picks, and the presenter can flip
 * between them live.
 */
export const CLOUD_STYLES = {
  cloud: 'Cloud',
  list: 'Ranked list',
};

/**
 * Who the deck is for.
 *
 * Not a learning style — those do not survive contact with the evidence
 * (Pashler et al. 2008). This is about prior knowledge and development,
 * which do: proportional reasoning is still forming through middle
 * school, so a younger room is defaulted to counts rather than
 * percentages, and to the dot plot, where one mark is one classmate and
 * nobody has to trust the arithmetic. Every default it sets is still
 * overridable per slide.
 */
export const AUDIENCES = {
  standard: 'Standard',
  younger: 'Younger — counts first, one dot per person',
};

// =====================================================================
// My Themes — the custom theme builder (proposal: Mentimeter parity).
//
// The instructor picks four colours, a headline face, a corner shape and
// a backdrop; everything else is DERIVED so the result is always a
// coherent 13-token theme — surfaces, edges, soft tints and status
// colours are computed from the picks rather than asked for. The result
// is stored on the deck (settings.customTheme), so the projector, the
// results archive and every student phone render it from any machine.
// =====================================================================

import { mixColor, luminance } from './motion.js';

/** Headline face choices — every option ships in fonts/, so a custom
 *  theme looks identical on the lectern and the laptop. */
export const CUSTOM_FONTS = {
  fraunces: { name: 'Bookish serif', css: "'Fraunces','Iowan Old Style',Palatino,Georgia,serif" },
  oswald: { name: 'Bold condensed', css: "'Oswald','Avenir Next Condensed','Helvetica Neue',sans-serif" },
  caveat: { name: 'Hand-written', css: "'Caveat','Bradley Hand','Segoe Print',cursive" },
  inter: { name: 'Clean sans', css: "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" },
  playfair: { name: 'Elegant Didone', css: "'Playfair Display','Didot','Bodoni MT',Georgia,serif" },
  cinzel: { name: 'Inscribed caps', css: "'Cinzel','Optima','Gill Sans MT',Georgia,serif" },
  faustina: { name: 'Warm humanist', css: "'Faustina','Optima','Gill Sans MT',Georgia,serif" },
  sourceserif: { name: 'Text serif', css: "'Source Serif 4','Charter',Georgia,serif" },
};

export const CUSTOM_RADII = {
  square: { name: 'Square', css: '0px' },
  soft: { name: 'Soft', css: '6px' },
  round: { name: 'Round', css: '12px' },
  pill: { name: 'Pill', css: '999px' },
};

const BODY_STACK = "'Inter','Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif";

/** 'rgb(12, 34, 56)' or '#abc' → '#0c2238' (hexA() only reads hex). */
function toHex(color) {
  const s = String(color).trim();
  if (s.startsWith('#')) {
    return s.length === 4 ? `#${[...s.slice(1)].map((c) => c + c).join('')}` : s;
  }
  const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return '#888888';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

const mixHex = (a, b, t) => toHex(mixColor(a, b, t));

/** WCAG contrast ratio between two colours. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// =====================================================================
// Contrast-safe derived tokens.
//
// A palette above is authored for character. These five are COMPUTED
// from it so that no theme — built-in, or one an instructor assembles in
// the builder — can ship a combination that fails WCAG 2.1 AA:
//
//   --on-accent / --on-good / --on-bad  text drawn ON that fill  (4.5:1)
//   --edge-strong                       borders that are the only thing
//                                       identifying a control     (3:1)
//   --accent-2-text                     accent-2 where it carries
//                                       small text                (4.5:1)
//
// Deriving rather than authoring is the point: adding a 21st theme, or
// nudging an accent, cannot silently reintroduce the failure.
// =====================================================================

/** AA floor for normal text. A hair over 4.5 so rounding can't sink it. */
const AA_TEXT = 4.55;
/** 1.4.11 floor for control boundaries and graphical objects. */
const AA_NONTEXT = 3.05;
/**
 * The strongest `color-mix(TOKEN n%, transparent)` wash that has type of
 * that same colour drawn on it — .sp-rank-num, .lb-row.is-top3 .lb-rank,
 * .chip-live, .timer.is-urgent, .chip-ended respectively. Heavier washes
 * exist (a 45% accent border-mix, a 26% ink scrim) but carry no matching
 * type, so they set no floor. Raise a number here if a new chip does.
 */
const CHIP_TINT = {
  '--accent': 0.20,
  '--accent-2': 0.18,
  '--good': 0.18,
  '--bad': 0.16,
  '--ink': 0.10,
};

/**
 * Text colour for a filled surface. Prefers a colour the theme already
 * uses — ground first, then ink — so a button reads as part of the
 * palette rather than a white sticker; falls back to hard black/white
 * only when neither theme colour clears AA.
 */
function onFill(fill, ground, ink) {
  let best = '#ffffff';
  let bestRatio = 0;
  for (const c of [ground, ink, '#ffffff', '#0b0b0d']) {
    const r = contrastRatio(c, fill);
    if (r >= AA_TEXT) return toHex(c);
    if (r > bestRatio) { bestRatio = r; best = c; }
  }
  return toHex(best);
}

/**
 * Walk `color` toward `anchor` until it clears `need` against every
 * background it has to sit on. Returns the FIRST passing step, so the
 * result keeps as much of the original colour as the floor allows.
 */
function liftContrast(color, anchor, need, ...backgrounds) {
  const ok = (c) => backgrounds.every((bg) => contrastRatio(c, bg) >= need);
  if (ok(color)) return toHex(color);
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = mixHex(color, anchor, t);
    if (ok(c)) return c;
  }
  return toHex(anchor);
}

/**
 * Whichever pole a colour has to be pushed toward to gain contrast.
 * Compared rather than thresholded: the black/white crossover sits at a
 * relative luminance of ~0.18, so any "is it dark?" threshold picked by
 * eye sends mid-tone grounds the wrong way — on #888888, white tops out
 * at 3.5:1 while black reaches 5.9:1.
 */
const poleFor = (bg) => (contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg)
  ? '#000000' : '#ffffff');

/**
 * Fill in the derived tokens. Idempotent. A theme that states one of them
 * explicitly keeps its value — `--on-accent` and friends are suggestions,
 * not impositions. The one exception is `--ink-soft`, which is clamped
 * unconditionally: it is authored by every theme, and the clamp only ever
 * moves it TOWARD `--ink`, so the result is never less legible than what
 * the author wrote.
 */
export function deriveTokens(tokens) {
  const ground = tokens['--ground'];
  const ink = tokens['--ink'];
  const surface = tokens['--surface'] || ground;
  const out = { ...tokens };

  if (!out['--on-accent']) out['--on-accent'] = onFill(tokens['--accent'], ground, ink);
  if (!out['--on-good']) out['--on-good'] = onFill(tokens['--good'], ground, ink);
  if (!out['--on-bad']) out['--on-bad'] = onFill(tokens['--bad'], ground, ink);

  // The control border carries the whole affordance: --surface sits at
  // 1.0–1.2:1 against --ground in every theme, so if the hairline is
  // faint the input has no visible boundary at all.
  if (!out['--edge-strong']) {
    out['--edge-strong'] = liftContrast(tokens['--edge'], ink, AA_NONTEXT, surface, ground);
  }

  // Text siblings. The palette colours stay exactly as authored where
  // they are FILLS — a bar, a chip, a chart segment, a backdrop, where
  // 3:1 is the bar and vividness is the point. These are the versions
  // used where the same colour sets type, and they carry the 4.5:1 floor
  // against every ground that colour's type actually lands on, including
  // its own tinted chip. Splitting fill from type is what lets a theme
  // stay loud and still be legible.
  //
  // "Its own tinted chip" is not a detail. The status chips, alerts and
  // hint pills all paint `color-mix(TOKEN N%, transparent)` behind type
  // in that same colour, which drags the background AWAY from the plain
  // surface the token was tuned against — the exact gap that left
  // `.chip-ended` under AA on six themes while a surface-only audit
  // reported clean. CHIP_TINT is the strongest wash any of them uses.
  const pole = poleFor(ground);
  const tint = (key) => mixHex(tokens[key], surface, 1 - CHIP_TINT[key]);
  if (!out['--accent-text']) {
    out['--accent-text'] = liftContrast(
      tokens['--accent'], pole, AA_TEXT,
      ground, surface, tokens['--accent-soft'], tint('--accent'),
    );
  }
  if (!out['--accent-2-text']) {
    out['--accent-2-text'] = liftContrast(
      tokens['--accent-2'], pole, AA_TEXT, ground, surface, tint('--accent-2'),
    );
  }
  if (!out['--good-text']) {
    out['--good-text'] = liftContrast(
      tokens['--good'], pole, AA_TEXT, ground, surface, tint('--good'),
    );
  }
  if (!out['--bad-text']) {
    out['--bad-text'] = liftContrast(
      tokens['--bad'], pole, AA_TEXT, ground, surface, tint('--bad'),
    );
  }
  // --ink-soft is authored, not derived, but it sits on ink-washed chips
  // too (.chip-ended, .conf-chip, .ctrl kbd), so it gets the same clamp.
  // It only ever moves TOWARD --ink, i.e. more legible, never less.
  out['--ink-soft'] = liftContrast(
    out['--ink-soft'], ink, AA_TEXT, ground, surface, tint('--ink'),
  );

  return out;
}

/**
 * Every AA violation left in a theme, as plain sentences. The builder
 * shows these before an instructor can save; the test suite asserts the
 * list is empty for every built-in.
 */
export function auditTheme(theme) {
  const t = deriveTokens(theme.tokens || {});
  const bad = [];
  const text = (fg, bg, what) => {
    const r = contrastRatio(t[fg], t[bg]);
    if (r < 4.5) bad.push({ ratio: r, need: 4.5, what, pair: [t[fg], t[bg]] });
  };
  const nontext = (fg, bg, what) => {
    const r = contrastRatio(t[fg], t[bg]);
    if (r < 3) bad.push({ ratio: r, need: 3, what, pair: [t[fg], t[bg]] });
  };

  text('--ink', '--ground', 'Body text on the background');
  text('--ink', '--surface', 'Body text on panels');
  text('--ink-soft', '--ground', 'Secondary text on the background');
  text('--ink-soft', '--surface', 'Secondary text on panels');
  text('--on-accent', '--accent', 'Button text on the accent');
  text('--on-good', '--good', 'Text on the “correct” colour');
  text('--on-bad', '--bad', 'Text on the “wrong” colour');
  text('--accent-text', '--ground', 'Links and accent type');
  text('--accent-text', '--accent-soft', 'Accent type on its own chip');
  text('--accent-2-text', '--ground', 'Second accent as text');
  text('--good-text', '--surface', 'The “correct” colour as text');
  text('--bad-text', '--surface', 'The “wrong” colour as text');

  // ...and each of those on the tinted chip it is actually drawn on. A
  // surface-only matrix reports clean while the chips fail.
  const onTint = (fg, base, what) => {
    const bg = mixHex(t[base], t['--surface'], 1 - CHIP_TINT[base]);
    const r = contrastRatio(t[fg], bg);
    if (r < 4.5) bad.push({ ratio: r, need: 4.5, what, pair: [t[fg], bg] });
  };
  onTint('--accent-text', '--accent', 'Accent type on an accent wash');
  onTint('--accent-2-text', '--accent-2', 'Second accent on its own wash');
  onTint('--good-text', '--good', 'Status text on a “correct” wash');
  onTint('--bad-text', '--bad', 'Status text on a “wrong” wash');
  onTint('--ink-soft', '--ink', 'Secondary text on an ink wash');
  nontext('--edge-strong', '--surface', 'Input and button borders');
  nontext('--accent', '--ground', 'Accent bars and the focus ring');

  return bad.sort((a, b) => a.ratio - b.ratio);
}

/**
 * Derive a full theme from the builder's picks.
 * @param {object} p {name, ground, ink, accent, accent2, font, radius, backdrop}
 *   ground/ink/accent/accent2 are hex strings; font is a CUSTOM_FONTS key;
 *   radius a CUSTOM_RADII key; backdrop a BACKGROUND_PRESETS key or 'none'.
 */
export function buildCustomTheme(p) {
  const ground = toHex(p.ground || '#f7f4ee');
  const ink = toHex(p.ink || '#1c2434');
  const accent = toHex(p.accent || '#4a5d23');
  const accent2 = toHex(p.accent2 || '#b45309');
  const dark = luminance(ground) < 0.4;
  const surface = mixHex(ground, '#ffffff', dark ? 0.05 : 0.6);

  // A 35% walk toward the background is the look we want for secondary
  // text, but on a low-contrast pair it lands under AA — so take the
  // walk, then pull back toward the ink until it clears the floor on
  // both the page and a panel. Most picks never hit the clamp.
  const inkSoft = liftContrast(mixHex(ink, ground, 0.35), ink, AA_TEXT, ground, surface);

  return {
    id: p.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name: (p.name || 'My theme').slice(0, 40),
    dark,
    tokens: deriveTokens({
      '--ink': ink,
      '--ink-soft': inkSoft,
      '--ground': ground,
      '--surface': surface,
      '--edge': dark ? mixHex(ground, '#ffffff', 0.12) : mixHex(ground, ink, 0.12),
      '--accent': accent,
      '--accent-soft': mixHex(accent, ground, dark ? 0.72 : 0.82),
      '--accent-2': accent2,
      '--good': dark ? '#51cf66' : '#15803d',
      '--bad': dark ? '#ff6b6b' : '#b91c1c',
      '--display': (CUSTOM_FONTS[p.font] || CUSTOM_FONTS.inter).css,
      '--body': BODY_STACK,
      '--bar-radius': (CUSTOM_RADII[p.radius] || CUSTOM_RADII.soft).css,
    }),
    background: p.backdrop && p.backdrop !== 'none'
      ? { kind: 'preset', id: p.backdrop }
      : { kind: 'none' },
    // remember the picks so "edit" reopens the builder where it left off
    picks: { ground, ink, accent, accent2, font: p.font || 'inter', radius: p.radius || 'soft', backdrop: p.backdrop || 'none' },
  };
}
