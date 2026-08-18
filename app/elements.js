/**
 * SurveyAll — slide elements ("decor").
 *
 * The Canva-shaped feature, built the way this app builds things.
 *
 * WHY EVERYTHING HERE IS A PERCENTAGE
 *
 * Placement is free — drag it anywhere — but it is stored as a percentage
 * of the slide, never as a pixel. present.css scales the whole slide from
 * one root font-size onto whatever projector it lands on, and the same
 * deck is also drawn into a 9rem rail thumbnail and onto a phone. A pixel
 * coordinate is only true at the resolution it was authored on; at 720p
 * an element authored on a 4K laptop lands somewhere else entirely, and
 * what it lands on might be the QR the room is trying to scan.
 *
 * Sizes are percentages for the same reason. See SIZES below — that one
 * is genuinely surprising and cost a bug to find.
 *
 * WHY COLOUR DEFAULTS TO A TOKEN
 *
 * Every icon here is one weight on one 24x24 grid, and its colours default
 * to the theme's own tokens, so a microscope dropped on a chalkboard slide
 * comes out chalk-white and the same slide in Neon Night comes out neon.
 * That is the actual promise people like about Canva — whatever you drag in
 * looks like it belongs — and it is the part a sticker library can't keep.
 * Custom hex is available for when an instructor genuinely wants their
 * department's blue; it just isn't the default, because the default should
 * be the thing that always looks right.
 *
 * The art is Lucide (ISC) — see app/elements-data.js and the licence in
 * app/vendor/lucide-LICENSE.txt. The annotation marks below are ours,
 * drawn to the same grid and weight, because circling a thing and pointing
 * at it are the two most useful classroom gestures and no icon set ships
 * them.
 */

import { ICON_PATHS, ICON_INDEX } from './elements-data.js';

const NS = 'http://www.w3.org/2000/svg';

// =====================================================================
// Annotation marks — hand-drawn, ours
//
// Deliberately imperfect: overshooting corners, loops that don't close,
// baselines that aren't level. A ruler-straight box around a word reads
// as a UI element; a slightly wonky one reads as someone marking up the
// slide, which is the whole point of a mark.
// =====================================================================

export const MARK_PATHS = {
  // circling a thing — one loop that overshoots its own start, which is
  // the detail that makes it read as a pen rather than as an ellipse
  'mark-ring': '<path d="M16.8 4.3A9.7 8 0 1 0 21.5 10c-.6-2.6-3-4.8-6.3-5.9"/>',
  // twice round, for when once wasn't enough
  'mark-ring-2': '<path d="M16.8 4.3A9.7 8 0 1 0 21.5 10c-.6-2.6-3-4.8-6.3-5.9"/>'
    + '<path d="M15.1 6.8A7.9 6.3 0 1 0 19.8 12"/>',
  // a box around it, corners overshot
  'mark-box': '<path d="M4.1 5.4c5.6-.8 11.3-1.1 16.9-.7"/><path d="M20.6 4.5c.6 4.3.7 8.6.2 12.9"/>'
    + '<path d="M21.3 17c-5.8.9-11.7 1.1-17.6.5"/><path d="M4.4 18.4c-.8-4.3-.9-8.7-.2-13l1.9 2.3"/>',
  // underline — nearly level, with the small lift a hand gives the end of
  // the stroke. Curve it any harder and it reads as a smile.
  'mark-underline': '<path d="M2.5 15.2c6.2 1.5 12.6 1.6 19-.5"/>',
  'mark-underline-2': '<path d="M2.5 13.4c6.2 1.5 12.6 1.6 19-.5"/><path d="M3.3 17.6c5.8 1.3 11.8 1.4 17.8-.4"/>',
  // struck through
  'mark-strike': '<path d="M2.6 13c6.4-1.5 13-2.1 19.2-1.7"/>',
  // a highlighter swipe. Its own weight and opacity because a highlighter
  // is a wide soft mark, not a line — the editor's width control still
  // scales it, this is just where it starts.
  'mark-highlight': '<path d="M3.2 13.3c5.9-.9 11.9-1.2 17.8-.8" stroke-width="9" stroke-linecap="round" opacity=".32"/>',
  // emphasis scribble — an actual zigzag. Two smooth passes read as a
  // swoosh, and a swoosh is already what mark-underline is for.
  'mark-scribble': '<path d="M2.6 17.8 6.9 11l1.4 5.8 4-6.4 1.3 5.9 4.2-6.5 1.2 5.7 2.4-3.7"/>',
  // curved arrows — "this leads to that", drawn not stamped
  'mark-arc-right': '<path d="M2.6 17.9C5.4 10.1 11.9 6.1 20.4 7.6"/><path d="m15.9 3.4 5 4.3-4.4 4.8"/>',
  'mark-arc-left': '<path d="M21.4 17.9C18.6 10.1 12.1 6.1 3.6 7.6"/><path d="m8.1 3.4-5 4.3 4.4 4.8"/>',
  'mark-arc-up': '<path d="M4.6 21.2C3.3 13.4 6.6 6.5 13.9 3.6"/><path d="m9.4 2.7 5.4 1.2-1.7 5.3"/>',
  // grouping braces — "all of these, together"
  'mark-brace-left': '<path d="M15.4 2.4c-3.2 0-3.9 1.5-3.9 4.5v2.2c0 2.1-1 3.1-3.1 3.4 2.1.3 3.1 1.3 3.1 3.4v2.2c0 3 .7 4.5 3.9 4.5"/>',
  'mark-brace-right': '<path d="M8.6 2.4c3.2 0 3.9 1.5 3.9 4.5v2.2c0 2.1 1 3.1 3.1 3.4-2.1.3-3.1 1.3-3.1 3.4v2.2c0 3-.7 4.5-3.9 4.5"/>',
  // a tick and a cross with a wrist behind them
  'mark-check': '<path d="M3.2 12.4c2.4 1.6 4.4 3.6 6 6.1C11.6 12.9 15.3 8 20.6 3.9"/>',
  'mark-cross': '<path d="M4.6 4.4c5.1 4.6 10 9.6 14.8 14.9"/><path d="M19.4 4.6C14.3 9.2 9.4 14.2 4.6 19.5"/>',
  // a solid pointing wedge — this one is meant to be filled
  'mark-caret': '<path d="M4.5 4.8 20 12 4.5 19.2Z"/>',
  // a burst, for "look here"
  'mark-burst': '<path d="M12 2.4v4.2"/><path d="M12 17.4v4.2"/><path d="M2.4 12h4.2"/><path d="M17.4 12h4.2"/>'
    + '<path d="m5.2 5.2 3 3"/><path d="m15.8 15.8 3 3"/><path d="m18.8 5.2-3 3"/><path d="m8.2 15.8-3 3"/>',
  // a hand-drawn star, for what matters
  'mark-star': '<path d="M12 2.8 14.9 9l6.7.9-4.9 4.6 1.3 6.7-6-3.3-6 3.3 1.3-6.7L2.4 9.9 9.1 9Z"/>',
};

/**
 * Numbered step badges 1..6.
 *
 * "Look at step 2" is a thing said out loud in every classroom, and no
 * icon set ships numerals — they assume you'll set type. Type would drag
 * a font dependency and a text-vs-stroke mismatch into an SVG that is
 * otherwise pure geometry, so these are drawn as strokes like everything
 * else, on the same ring.
 */
const NUMERALS = {
  1: '<path d="M10.3 9.6 12.4 8v8.2"/>',
  2: '<path d="M9.6 9.7a2.5 2.5 0 1 1 4.5 2L9.5 16.4h5"/>',
  3: '<path d="M9.7 8.6a2.4 2.4 0 1 1 1.9 3.9 2.4 2.4 0 1 1-1.9 3.9"/>',
  4: '<path d="M13.6 16.4V7.8l-4.3 6.3h6"/>',
  5: '<path d="M14 8H10.4l-.6 3.6a2.7 2.7 0 1 1-.2 4.5"/>',
  6: '<path d="M13.9 8.3a2.9 2.9 0 0 0-4.4 2.5v2.7a2.5 2.5 0 1 0 5-.2 2.5 2.5 0 0 0-5-.5"/>',
};
for (const [n, numeral] of Object.entries(NUMERALS)) {
  MARK_PATHS[`mark-step-${n}`] = `<circle cx="12" cy="12" r="9.4"/>${numeral}`;
}

/** [id, label, tags, flags] — flags mirror ICON_INDEX's shape plus paint hints. */
const MARK_INDEX = [
  ['mark-ring', 'Circle it', 'ring loop emphasis annotate', {}],
  ['mark-ring-2', 'Circle it twice', 'ring loop emphasis annotate', {}],
  ['mark-box', 'Box it', 'rectangle frame annotate', {}],
  ['mark-underline', 'Underline', 'emphasis annotate', { nofill: true }],
  ['mark-underline-2', 'Double underline', 'emphasis annotate', { nofill: true }],
  ['mark-strike', 'Strike through', 'delete wrong annotate', { nofill: true }],
  ['mark-highlight', 'Highlighter', 'marker emphasis annotate', { nofill: true }],
  ['mark-scribble', 'Scribble', 'emphasis squiggle annotate', { nofill: true }],
  ['mark-arc-right', 'Curved arrow right', 'point leads to annotate', { nofill: true }],
  ['mark-arc-left', 'Curved arrow left', 'point back annotate', { nofill: true }],
  ['mark-arc-up', 'Curved arrow up', 'point rise annotate', { nofill: true }],
  ['mark-brace-left', 'Brace, left', 'group bracket all of these', { nofill: true }],
  ['mark-brace-right', 'Brace, right', 'group bracket all of these', { nofill: true }],
  ['mark-check', 'Hand tick', 'correct yes right annotate', { nofill: true }],
  ['mark-cross', 'Hand cross', 'wrong no incorrect annotate', { nofill: true }],
  ['mark-caret', 'Pointer', 'wedge triangle point', {}],
  ['mark-burst', 'Burst', 'attention look here shine', { nofill: true }],
  ['mark-star', 'Hand star', 'important favourite key', {}],
  ...Object.keys(NUMERALS).map((n) => [
    `mark-step-${n}`, `Step ${n}`, `number numeral ${n} order badge`, {},
  ]),
];

// =====================================================================
// Named spots
//
// Placement is free (see Position, below) — these names survive only as
// a convenience at the two edges of the system. A deck file can say
// `@ top-right` instead of `@ 94,10`, and an element that sits exactly on
// one is written back out by name, so ordinary decks stay readable.
// Nothing in the editor is constrained to them.
// =====================================================================

/** Column token -> x, as a percentage of slide width. */
const COLS = {
  left: 6,
  'left-in': 17,
  midleft: 28,
  'center-left': 39,
  center: 50,
  'center-right': 61,
  midright: 72,
  'right-in': 83,
  right: 94,
};

/** Row token -> y, as a percentage of slide height. */
const ROWS = { top: 10, upper: 30, mid: 50, lower: 70, bottom: 90 };

export const ANCHOR_ROWS = Object.keys(ROWS);
export const ANCHOR_COLS = Object.keys(COLS);

/** All 45, in reading order — the editor's grid iterates this. */
export const ANCHORS = ANCHOR_ROWS.flatMap((r) => ANCHOR_COLS.map((c) => `${r}-${c}`));

/**
 * Short names, so `@ center` and `@ left` mean what a person expects.
 *
 * Any bare column name is the middle row of that column, and the four
 * spellings of the middle everyone tries all land in the same place.
 */
const ANCHOR_ALIASES = {
  centre: 'mid-center', middle: 'mid-center',
  top: 'top-center', bottom: 'bottom-center',
  'top-middle': 'top-center', 'bottom-middle': 'bottom-center',
  ...Object.fromEntries(ANCHOR_COLS.map((c) => [c, `mid-${c}`])),
};

/**
 * Row and column out of an anchor token.
 *
 * Split on the FIRST dash only: four of the nine columns have a dash in
 * their own name, so `mid-center-left` is the mid row of the center-left
 * column, not a row called "mid" and a column called "center".
 */
function splitAnchor(id) {
  const i = id.indexOf('-');
  return [id.slice(0, i), id.slice(i + 1)];
}

export const DEFAULT_ANCHOR = 'top-right';

/** Normalise an anchor token, or null if it isn't one. */
export function anchorId(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!key) return null;
  const resolved = ANCHOR_ALIASES[key] || key;
  return ANCHORS.includes(resolved) ? resolved : null;
}

// =====================================================================
// Position
//
// Placement is free: an element carries an x and a y, each a percentage
// of the slide, and can sit anywhere.
//
// PERCENTAGES, NOT PIXELS — this is the whole reason for the shape of
// this module. The same deck is drawn at four wildly different sizes: a
// 9rem rail thumbnail, the editor canvas, a phone, and whatever the
// lecture hall's projector happens to be, which is often a dim 1280x720.
// A pixel coordinate is only true at the resolution it was authored on;
// at 720p an element authored on a 4K laptop lands somewhere else
// entirely, and what it lands on might be the QR code the room is trying
// to scan. A percentage is true everywhere, which is why every other
// measurement on the projector side is relative too.
//
// It also happens to round-trip cleanly through the plain-text deck
// format, which is a convenience rather than a constraint — that format
// predates this feature and elements simply had to not break it.
//
// The nine corner and edge names still parse (`@ top-right`), and are
// written back out whenever an element sits exactly on one, so ordinary
// decks stay readable.
//
// Snapping lives in the editor as guides you can also ignore, rather
// than in the storage format, where it would be a wall.
//
// The QR guarantee is structural, not positional: decor is z-index 3
// against the join card's 6 and the control bar's 7, so nothing placed
// anywhere can cover the code. Free placement does not touch it.
// =====================================================================

/** Round to 0.1% — finer than any eye, and keeps the text format tidy. */
function roundPos(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Clamp a coordinate to the slide.
 *
 * 0 and 100 are allowed: an element is drawn centred on its point, so a
 * mark at x=0 hangs half off the left edge, which is a legitimate thing
 * to want for a bracket or an arrow entering from off-slide.
 */
export function coord(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return roundPos(Math.max(0, Math.min(100, n)));
}

/**
 * Read a position from anything: `{x, y}`, `"83.5,17.2"`, or a name.
 * Returns null if it is none of those.
 */
export function readPos(value) {
  if (value && typeof value === 'object') {
    const x = coord(value.x);
    const y = coord(value.y);
    return x == null || y == null ? null : { x, y };
  }
  const text = String(value ?? '').trim();
  if (!text) return null;

  const pair = text.match(/^(-?[\d.]+)\s*[,\s]\s*(-?[\d.]+)$/);
  if (pair) {
    const x = coord(pair[1]);
    const y = coord(pair[2]);
    return x == null || y == null ? null : { x, y };
  }

  const named = anchorId(text);
  return named ? anchorPos(named) : null;
}

/**
 * The name of the spot, if the position is exactly one of them.
 *
 * Used only when writing a deck back out, so a slide placed in a corner
 * still reads `@ top-right` instead of `@ 94,10`. Anything moved even
 * slightly off a named spot writes its numbers.
 */
export function posName(x, y) {
  for (const at of ANCHORS) {
    const p = anchorPos(at);
    if (p.x === x && p.y === y) return at;
  }
  return null;
}

/** A position as a person would say it — for tooltips and screen readers. */
export function posLabel(x, y) {
  const named = posName(x, y);
  if (named) return anchorLabel(named);
  const across = x < 33 ? 'left' : x > 67 ? 'right' : 'centre';
  const down = y < 33 ? 'top' : y > 67 ? 'bottom' : 'middle';
  return `${down} ${across}, ${Math.round(x)}% across and ${Math.round(y)}% down`;
}

/**
 * Where the join card and the control bar sit, as rectangles.
 *
 * Decor is drawn under both, so this is a warning rather than a rule —
 * it exists so the editor can shade the area and say so before an
 * instructor discovers it from the back of a lecture hall.
 */
export const RESERVED_ZONES = [
  { id: 'join', label: 'the join code', x1: 74, y1: 78, x2: 100, y2: 100 },
  { id: 'controls', label: 'the control bar', x1: 33, y1: 88, x2: 67, y2: 100 },
];

export function reservedAt(x, y) {
  return RESERVED_ZONES.find((z) => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) || null;
}

/**
 * An anchor as a person would say it.
 *
 * The stored tokens are terse because they live in a text file that gets
 * diffed — but "mid-midleft" read out by a screen reader, or sat in a
 * tooltip, is not a place anyone can picture.
 */
const ROW_WORDS = {
  top: 'top', upper: 'upper', mid: 'middle', lower: 'lower', bottom: 'bottom',
};
const COL_WORDS = {
  left: 'left',
  'left-in': 'inner left',
  midleft: 'mid-left',
  'center-left': 'left of centre',
  center: 'centre',
  'center-right': 'right of centre',
  midright: 'mid-right',
  'right-in': 'inner right',
  right: 'right',
};

export function anchorLabel(at) {
  const id = anchorId(at) || DEFAULT_ANCHOR;
  const [row, col] = splitAnchor(id);
  if (row === 'mid' && col === 'center') return 'centre';
  if (row === 'mid') return COL_WORDS[col];
  // "top, left of centre" rather than "top left of centre", which reads
  // as a corner it is nowhere near
  const sep = COL_WORDS[col].includes(' ') ? ', ' : ' ';
  return `${ROW_WORDS[row]}${sep}${COL_WORDS[col]}`;
}

/** Anchor -> {x, y} in percent, measured to the element's centre. */
export function anchorPos(at) {
  const id = anchorId(at) || DEFAULT_ANCHOR;
  const [row, col] = splitAnchor(id);
  return { x: COLS[col], y: ROWS[row] };
}

// =====================================================================
// Layer — which side of the slide's content an element sits on
//
// Both directions are useful, for opposite things. A mark is an
// annotation: an arrow that points at a bar has to be ON TOP of the bar
// or it is pointing at nothing, so `front` is the default. A subject icon
// is usually scene-setting, and a big faint microscope reads far better
// as a watermark BEHIND the question than as a sticker over it — which
// is the only way to use one large without burying the text.
//
// Behind still means above the backdrop and its scrim, so a watermark
// sits on the slide rather than in the wallpaper.
// =====================================================================

export const LAYERS = [
  ['front', 'In front', 'Over the question and the results, for marks that point at something'],
  ['back', 'Behind', 'Under the question and the results, for watermarks and scene-setting'],
];
export const DEFAULT_LAYER = 'front';

export function layerId(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'back' || v === 'behind') return 'back';
  if (v === 'front') return 'front';
  return null;
}

// =====================================================================
// Paint — size, colour, weight
// =====================================================================

/**
 * Sizes as a percentage of the slide's HEIGHT, not in em.
 *
 * em is what the rest of this app measures in, and it is wrong here. The
 * projector sizes its em from the viewport (`clamp(16px, 1.3vw + 9.5px,
 * 33px)`) while a preview sizes its own from its width (`5.6cqw`), and
 * those two curves do not agree — a `md` icon tuned to look right on the
 * projector came out at 42% of the height of a rail thumbnail.
 *
 * A percentage of the slide is the thing that actually has to stay
 * constant, so that is what gets stored. The decor layer declares itself
 * a size container and these land as `cqh`, which makes one number mean
 * the same fraction of the slide in a 9rem thumbnail and on a 4K panel.
 */
export const SIZES = {
  xs: 5, sm: 8, md: 12.5, lg: 19, xl: 29,
};
export const SIZE_LABELS = {
  xs: 'Tiny', sm: 'Small', md: 'Medium', lg: 'Large', xl: 'Huge',
};
export const DEFAULT_SIZE = 'md';

export function sizeId(value) {
  const key = String(value || '').trim().toLowerCase();
  return SIZES[key] ? key : null;
}

/**
 * The colour tokens, in picker order.
 *
 * These are theme tokens, not colours — which is the point. `accent` is
 * classroom blue in Lecture Hall and warm yellow on the Chalkboard, and
 * the deck carries the word, not the hex, so the same element re-themes
 * with everything else.
 */
export const COLOR_TOKENS = [
  ['accent', 'Accent', '--accent'],
  ['accent-2', 'Second accent', '--accent-2'],
  ['accent-soft', 'Accent, soft', '--accent-soft'],
  ['ink', 'Text', '--ink'],
  ['ink-soft', 'Text, soft', '--ink-soft'],
  ['edge', 'Edge', '--edge'],
  ['surface', 'Surface', '--surface'],
  ['ground', 'Background', '--ground'],
  ['good', 'Good', '--good'],
  ['bad', 'Bad', '--bad'],
];

const TOKEN_VAR = new Map(COLOR_TOKENS.map(([id, , cssVar]) => [id, cssVar]));

export const DEFAULT_STROKE = 'accent';
export const DEFAULT_FILL = 'none';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise a colour: a known token, a #hex, or 'none'. */
export function colorId(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'none' || v === 'transparent') return 'none';
  if (TOKEN_VAR.has(v)) return v;
  if (HEX.test(v)) return v;
  return null;
}

/** Colour token or hex -> a CSS value an SVG attribute will accept. */
export function colorValue(value) {
  const id = colorId(value);
  if (!id || id === 'none') return 'none';
  return TOKEN_VAR.has(id) ? `var(${TOKEN_VAR.get(id)})` : id;
}

/**
 * Stroke weights, on the 24-unit grid Lucide draws to.
 *
 * The stroke is inside the viewBox, so it scales with the icon and a
 * `2` reads identically at `xs` and at `xl` — weight is a look, not a
 * pixel measurement.
 */
export const WEIGHTS = [
  [0, 'None'], [1, 'Hairline'], [1.5, 'Light'], [2, 'Regular'],
  [2.5, 'Medium'], [3, 'Bold'], [4, 'Heavy'],
];
export const DEFAULT_WEIGHT = 2;
const WEIGHT_VALUES = new Set(WEIGHTS.map(([w]) => w));

export function weightValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // snap to the offered set rather than accepting 2.37 from a hand-edited file
  if (WEIGHT_VALUES.has(n)) return n;
  let best = DEFAULT_WEIGHT;
  let gap = Infinity;
  for (const [w] of WEIGHTS) {
    const d = Math.abs(w - n);
    if (d < gap) { gap = d; best = w; }
  }
  return best;
}

/** Rotation snaps to 15 degrees — free rotation is how a slide gets wonky. */
export const ROT_STEP = 15;
export function rotValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const snapped = Math.round(n / ROT_STEP) * ROT_STEP;
  return ((snapped % 360) + 360) % 360;
}

export function opacityValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(5, Math.min(100, Math.round(n)));
}

// =====================================================================
// The catalog
// =====================================================================

export const CATEGORY_LABELS = {
  marks: 'Marks & annotation',
  arrows: 'Arrows',
  signals: 'Signals & status',
  classroom: 'Classroom',
  people: 'People & feelings',
  science: 'Science & nature',
  maths: 'Maths & shapes',
  charts: 'Charts & data',
  humanities: 'Humanities',
  arts: 'Music, art & media',
  computing: 'Computing',
  health: 'Health, body & sport',
  money: 'Money & work',
  world: 'Places & travel',
  everyday: 'Everyday things',
};

/**
 * One word per tab where one word will do.
 *
 * The tab strip wraps, and at fifteen categories the full names cost it
 * three rows out of a popover that is only so tall — the grid underneath
 * is what people came for. The long name stays as the tab's title.
 */
export const CATEGORY_TABS = {
  marks: 'Marks',
  arrows: 'Arrows',
  signals: 'Signals',
  classroom: 'Classroom',
  people: 'People',
  science: 'Science',
  maths: 'Maths',
  charts: 'Charts',
  humanities: 'Humanities',
  arts: 'Arts',
  computing: 'Computing',
  health: 'Health',
  money: 'Money',
  world: 'Places',
  everyday: 'Everyday',
};

/**
 * Marks first: they are the ones that do teaching work.
 *
 * Must stay in step with the CATALOG in tools/build-elements.mjs — a
 * category that exists there and not here has its icons built into
 * elements-data.js and then dropped by ELEMENT_LIST, which is a silent
 * loss rather than an error. checkCatalog() below is the guard.
 */
export const CATEGORY_ORDER = [
  'marks', 'arrows', 'signals', 'classroom', 'people', 'science',
  'maths', 'charts', 'humanities', 'arts', 'computing', 'health',
  'money', 'world', 'everyday',
];

const ELEMENTS = new Map();

MARK_INDEX.forEach(([id, label, tags, flags]) => {
  ELEMENTS.set(id, {
    id, label, tags, category: 'marks', markup: MARK_PATHS[id], ...flags,
  });
});

ICON_INDEX.forEach(([id, label, category, tags]) => {
  ELEMENTS.set(id, { id, label, tags, category, markup: ICON_PATHS[id] });
});

/**
 * Every element, in category order — the picker's source of truth.
 *
 * Sorted rather than filtered by category, so an element whose category
 * isn't in CATEGORY_ORDER lands at the end instead of disappearing. A
 * missing picker tab is a bug someone will notice; an element that exists
 * in a deck file and cannot be found in the picker is one they won't.
 */
const catRank = (cat) => {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

export const ELEMENT_LIST = [...ELEMENTS.values()]
  .sort((a, b) => catRank(a.category) - catRank(b.category));

/** Categories present in the data but missing from CATEGORY_ORDER. Tests assert this is empty. */
export function orphanCategories() {
  return [...new Set([...ELEMENTS.values()].map((e) => e.category))]
    .filter((cat) => !CATEGORY_ORDER.includes(cat))
    .sort();
}

export function getElement(id) {
  return ELEMENTS.get(String(id || '').trim().toLowerCase()) || null;
}

export function hasElement(id) { return ELEMENTS.has(String(id || '').trim().toLowerCase()); }

/**
 * Search by id, label and tags.
 *
 * Whole-word-prefix scoring, so typing "arc" surfaces the curved arrows
 * ahead of "search" — a substring match on 700-odd items ranks by accident
 * otherwise, and the picker is only useful if the first row is right.
 */
export function searchElements(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return ELEMENT_LIST;
  const terms = q.split(/\s+/).filter(Boolean);

  const scored = [];
  for (const e of ELEMENT_LIST) {
    const hay = `${e.id} ${e.label} ${e.tags}`.toLowerCase();
    const words = hay.split(/[\s-]+/);
    let score = 0;
    let matchedAll = true;
    for (const t of terms) {
      if (e.label.toLowerCase() === t) score += 100;
      else if (words.some((w) => w === t)) score += 40;
      else if (words.some((w) => w.startsWith(t))) score += 20;
      else if (hay.includes(t)) score += 5;
      else { matchedAll = false; break; }
    }
    if (matchedAll) scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map(([, e]) => e);
}

// =====================================================================
// Drawing
// =====================================================================

/**
 * Build the <svg> for an element.
 *
 * innerHTML is safe here for the same reason it is in icons.js: every
 * `d` in ICON_PATHS and MARK_PATHS is a literal in a file in this repo,
 * and nothing is ever assembled out of anything an instructor typed. The
 * only user-supplied values are colours and numbers, and those go in as
 * attributes through normalised setters, never as markup.
 */
export function elementSvg(id, opts = {}) {
  const e = getElement(id);
  if (!e) return null;

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // A filled Lucide path is a stack of subpaths; even-odd punches the
  // inner ones out as holes instead of flooding the whole glyph solid.
  svg.setAttribute('fill-rule', 'evenodd');
  if (opts.cls) svg.setAttribute('class', opts.cls);

  const stroke = colorValue(opts.stroke ?? DEFAULT_STROKE);
  const weight = weightValue(opts.w ?? DEFAULT_WEIGHT);
  svg.setAttribute('stroke', weight > 0 ? stroke : 'none');
  svg.setAttribute('stroke-width', String(weight));
  svg.setAttribute('fill', e.nofill ? 'none' : colorValue(opts.fill ?? DEFAULT_FILL));

  svg.innerHTML = e.markup;
  return svg;
}

// =====================================================================
// Decor records — what a slide stores
// =====================================================================

/**
 * Clean one decor record.
 *
 * Everything that reaches a slide passes through here: the parser, the
 * editor and the renderers. An unknown id returns null and the item is
 * dropped rather than drawn as a hole, so a deck written against a newer
 * catalog degrades to a missing sticker instead of a broken slide.
 */
export function normaliseDecor(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim().toLowerCase();
  if (!hasElement(id)) return null;
  const e = getElement(id);

  // x/y is the stored truth. `at` is still read, so a deck written when
  // placement was a grid of named slots keeps working untouched.
  const pos = readPos(raw) || readPos(raw.at) || anchorPos(DEFAULT_ANCHOR);

  const item = {
    id,
    x: pos.x,
    y: pos.y,
    layer: layerId(raw.layer) || DEFAULT_LAYER,
    size: sizeId(raw.size) || DEFAULT_SIZE,
    stroke: colorId(raw.stroke) || DEFAULT_STROKE,
    fill: e.nofill ? 'none' : (colorId(raw.fill) || DEFAULT_FILL),
    w: weightValue(raw.w ?? DEFAULT_WEIGHT),
    rot: rotValue(raw.rot),
    flip: raw.flip === true,
    op: opacityValue(raw.op ?? 100),
  };
  // A weightless element with nothing to fill would render as an empty
  // box the instructor cannot see or select. One of the two has to hold.
  if (item.w === 0 && item.fill === 'none') item.w = DEFAULT_WEIGHT;
  return item;
}

/** A slide's decor list, cleaned and capped. */
export const MAX_DECOR = 12;

export function decorOf(config) {
  const raw = Array.isArray(config?.decor) ? config.decor : [];
  return raw.map(normaliseDecor).filter(Boolean).slice(0, MAX_DECOR);
}

/**
 * Draw a slide's decor into its two layers.
 *
 * `hosts` is `{ front, back }`. Two layers rather than one because an
 * element can sit either side of the slide's content, and CSS decides
 * that by which box it lives in — the alternative, one layer with
 * per-item z-index, cannot go BELOW the content at all, since the layer
 * itself would still be above it.
 *
 * Used by the projector, the editor canvas and the rail thumbnails, so
 * all three agree by construction. Neither layer takes pointer events —
 * on the projector there is nothing to click, and in the editor the
 * placement overlay handles hits itself.
 */
export function renderDecor(hosts, config) {
  // one element is still accepted, and means "front" — the rail and the
  // gallery had no reason to grow a second box
  const front = hosts?.front || hosts;
  const back = hosts?.back || null;

  if (front) { front.textContent = ''; front.hidden = true; }
  if (back) { back.textContent = ''; back.hidden = true; }

  const items = decorOf(config);

  items.forEach((item, i) => {
    const host = (item.layer === 'back' && back) ? back : front;
    if (!host) return;
    const node = decorNode(item);
    // the index is into the WHOLE list, not into this layer, so the
    // editor's handles and the entrance stagger stay in step across both
    node.dataset.decorIndex = String(i);
    node.style.setProperty('--decor-i', String(i));
    host.append(node);
    host.hidden = false;
  });
  return items;
}

/**
 * Build the pair of layers for a host that draws slides itself.
 *
 * The projector declares them in present.html; every preview makes its
 * own here, so the two can never drift apart.
 */
export function decorLayers() {
  const back = document.createElement('div');
  back.className = 'decor-layer decor-layer-back';
  const front = document.createElement('div');
  front.className = 'decor-layer decor-layer-front';
  return { back, front };
}

/** One positioned element, ready to drop into a decor layer. */
export function decorNode(item) {
  const wrap = document.createElement('div');
  wrap.className = 'decor-item';
  wrap.dataset.decorId = item.id;

  wrap.style.left = `${item.x}%`;
  wrap.style.top = `${item.y}%`;
  wrap.style.setProperty('--decor-size', `${SIZES[item.size]}cqh`);
  wrap.style.setProperty('--decor-rot', `${item.rot}deg`);
  wrap.style.setProperty('--decor-flip', item.flip ? '-1' : '1');
  wrap.style.opacity = String(item.op / 100);

  const svg = elementSvg(item.id, {
    stroke: item.stroke, fill: item.fill, w: item.w, cls: 'decor-svg',
  });
  if (svg) wrap.append(svg);
  return wrap;
}
