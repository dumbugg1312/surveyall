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
      '--accent': '#1d4ed8',
      '--accent-soft': '#dbe4fb',
      '--accent-2': '#b45309',
      '--good': '#15803d',
      '--bad': '#b91c1c',
      '--display': "'Iowan Old Style','Palatino Linotype','Book Antiqua',Palatino,Georgia,serif",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '6px',
    },
    background: { kind: 'preset', id: 'paper-warm' },
  },

  chalkboard: {
    name: 'Chalkboard',
    blurb: 'Deep slate green with chalk-white type. Reads well in a dim room.',
    dark: true,
    tokens: {
      '--ink': '#f2f5ef',
      '--ink-soft': '#b9c6b4',
      '--ground': '#1e2a24',
      '--surface': '#26332c',
      '--edge': '#3b4c42',
      '--accent': '#ffd76e',
      '--accent-soft': '#4a4326',
      '--accent-2': '#7fd1a3',
      '--good': '#7fd1a3',
      '--bad': '#ff9b8a',
      '--display': "'Bradley Hand','Segoe Print','Comic Sans MS',cursive",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '4px',
    },
    background: { kind: 'preset', id: 'slate' },
  },

  'clean-slate': {
    name: 'Clean Slate',
    blurb: 'Crisp white, single blue accent. Maximum clarity, zero personality.',
    dark: false,
    tokens: {
      '--ink': '#0f172a',
      '--ink-soft': '#64748b',
      '--ground': '#ffffff',
      '--surface': '#f8fafc',
      '--edge': '#e2e8f0',
      '--accent': '#0284c7',
      '--accent-soft': '#e0f2fe',
      '--accent-2': '#7c3aed',
      '--good': '#059669',
      '--bad': '#dc2626',
      '--display': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '4px',
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
      '--accent-2': '#f472b6',
      '--good': '#4ade80',
      '--bad': '#fb7185',
      '--display': "'Avenir Next Condensed','Helvetica Neue',Impact,sans-serif",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '2px',
    },
    background: { kind: 'preset', id: 'grid-glow' },
  },

  botanical: {
    name: 'Botanical',
    blurb: 'Forest green and cream, generous spacing. Calm discussion prompts.',
    dark: false,
    tokens: {
      '--ink': '#1a2b21',
      '--ink-soft': '#526b5c',
      '--ground': '#f2f6ee',
      '--surface': '#ffffff',
      '--edge': '#d5e0cf',
      '--accent': '#2f6d4f',
      '--accent-soft': '#d9ebdf',
      '--accent-2': '#a8632c',
      '--good': '#2f6d4f',
      '--bad': '#b4472e',
      '--display': "'Optima','Gill Sans','Gill Sans MT',Candara,sans-serif",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '999px',
    },
    background: { kind: 'preset', id: 'topo' },
  },

  letterpress: {
    name: 'Letterpress',
    blurb: 'Cream stock, oxblood accent, hairline rules. Humanities seminar.',
    dark: false,
    tokens: {
      '--ink': '#241f1c',
      '--ink-soft': '#6b5f57',
      '--ground': '#efe9dd',
      '--surface': '#f9f5ec',
      '--edge': '#d6cabb',
      '--accent': '#8c2f28',
      '--accent-soft': '#efd9d5',
      '--accent-2': '#2f5d7c',
      '--good': '#3f6b3a',
      '--bad': '#8c2f28',
      '--display': "'Hoefler Text','Baskerville','Times New Roman',serif",
      '--body': "'Charter','Georgia',serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'paper-cream' },
  },

  midnight: {
    name: 'Midnight',
    blurb: 'Deep indigo, amber accent. Evening classes and dark rooms.',
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
      '--display': "'Futura','Century Gothic','Avenir Next',sans-serif",
      '--body': "'Inter var',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      '--bar-radius': '8px',
    },
    background: { kind: 'preset', id: 'aurora' },
  },

  'high-contrast': {
    name: 'High Contrast',
    blurb: 'Pure black on white, yellow accent, heavy weights. Back-row legibility.',
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
      '--display': "'Inter var',Arial,Helvetica,sans-serif",
      '--body': "'Inter var',Arial,Helvetica,sans-serif",
      '--bar-radius': '0px',
    },
    background: { kind: 'preset', id: 'none' },
  },
};

export const DEFAULT_THEME = 'lecture-hall';

/**
 * Background presets. `css` is applied to the projector's backdrop layer.
 * Each is designed to sit *behind* a translucent panel, so nothing here
 * needs to be subtle enough to read text directly on.
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
    css: (t) => `linear-gradient(180deg, ${hexA(t['--accent-2'], 0.18)} 0%, transparent 40%),
                 radial-gradient(circle at 80% 10%, ${hexA(t['--accent'], 0.15)}, transparent 45%)`,
  },
  aurora: {
    name: 'Aurora',
    css: (t) => `radial-gradient(ellipse 80% 50% at 20% 0%, ${hexA(t['--accent-2'], 0.22)}, transparent 60%),
                 radial-gradient(ellipse 70% 60% at 85% 30%, ${hexA(t['--accent'], 0.16)}, transparent 60%)`,
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
    css: (t) => `linear-gradient(${hexA(t['--accent'], 0.10)} 1px, transparent 1px),
                 linear-gradient(90deg, ${hexA(t['--accent'], 0.10)} 1px, transparent 1px),
                 radial-gradient(ellipse at 50% 120%, ${hexA(t['--accent'], 0.18)}, transparent 60%)`,
    size: '44px 44px, 44px 44px, 100% 100%',
  },
  topo: {
    name: 'Contour',
    css: (t) => `repeating-radial-gradient(circle at 15% 85%, transparent 0 28px, ${hexA(t['--accent'], 0.06)} 28px 29px)`,
  },
  stripes: {
    name: 'Diagonal',
    css: (t) => `repeating-linear-gradient(45deg, ${hexA(t['--ink'], 0.035)} 0 14px, transparent 14px 28px)`,
  },
  confetti: {
    name: 'Confetti',
    css: (t) => `radial-gradient(circle at 12% 20%, ${hexA(t['--accent'], 0.5)} 0 4px, transparent 4px),
                 radial-gradient(circle at 78% 12%, ${hexA(t['--accent-2'], 0.45)} 0 5px, transparent 5px),
                 radial-gradient(circle at 35% 78%, ${hexA(t['--good'], 0.4)} 0 3px, transparent 3px),
                 radial-gradient(circle at 88% 66%, ${hexA(t['--accent'], 0.4)} 0 4px, transparent 4px)`,
    size: '340px 340px',
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

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}

export function themeList() {
  return Object.entries(THEMES).map(([id, t]) => ({ id, ...t }));
}

/**
 * Apply a theme's tokens to an element (usually documentElement).
 * Also stamps data-theme-dark so components can branch on luminance.
 */
export function applyTheme(el, themeId) {
  const theme = getTheme(themeId);
  for (const [k, v] of Object.entries(theme.tokens)) el.style.setProperty(k, v);
  el.dataset.themeDark = theme.dark ? 'true' : 'false';
  el.dataset.themeId = THEMES[themeId] ? themeId : DEFAULT_THEME;
  return theme;
}

/**
 * Build inline styles for the projector backdrop layer.
 * @param {object} background {kind: 'theme'|'none'|'solid'|'preset'|'image', ...}
 */
export function backgroundStyles(background, themeId) {
  const theme = getTheme(themeId);
  const t = theme.tokens;
  let bg = background;

  if (!bg || bg.kind === 'theme') bg = theme.background || { kind: 'none' };

  switch (bg.kind) {
    case 'solid':
      return { backgroundColor: bg.color || t['--ground'], backgroundImage: 'none', filter: 'none', opacity: '1' };

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
      };
    }

    case 'none':
    default:
      return { backgroundImage: 'none', filter: 'none', opacity: '1' };
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
