/**
 * SurveyAll — ambience: slow, decorative motion in the backdrop.
 *
 * WHY THIS IS NOT PART OF motion.js
 * The spring engine exists because *data* moves: a bar length, a counter,
 * an average. Its whole doctrine — critical damping, no overshoot on a
 * quantity — is about not drawing a number that isn't true. Nothing here
 * encodes anything. These layers live behind the scrim, behind the
 * content, and carry no information at all. So they get the opposite
 * treatment: no springs, no requestAnimationFrame, no JavaScript per
 * frame. Pure CSS keyframes on `transform` and `opacity` only.
 *
 * That choice is the whole design. A projector runs for fifty minutes off
 * whatever laptop is on the lectern, and the one rAF ticker on the page
 * belongs to the charts. If ambience took frames from the main thread,
 * every bar in the room would judder each time a vote landed — the exact
 * cheapness motion.js was written to avoid. Compositor-only properties
 * cost the main thread nothing, so the decoration can run forever and the
 * springs never feel it.
 *
 * WHAT MOVES, PER BACKGROUND
 * The character is chosen from the background rather than asked for,
 * because the motion that reads as expensive is the motion that suits the
 * texture:
 *
 *   washes    two or three huge, soft colour blooms drift and breathe
 *             across the base gradient. Nothing "slides"; what you see is
 *             the hue in one corner slowly becoming a different hue.
 *   lattices  the pattern itself drifts a few pixels — dots, graph paper,
 *             contours, confetti. Parallax without a direction.
 *   images    a Ken Burns crawl, two minutes end to end.
 *   solids    a single whisper of accent light, wandering.
 *
 * Every cycle length is a prime number of seconds (53, 71, 89 …) so no
 * two layers ever line back up. A loop you can catch is a loop that looks
 * cheap; with co-prime periods the composite takes hours to repeat and
 * the room reads it as "alive" rather than "animated".
 *
 * THE RULES
 *   · prefers-reduced-motion turns everything off, in JS and again in CSS.
 *   · The high-contrast theme never gets ambience. It is an accessibility
 *     theme; drifting light across it is the opposite of what it is for.
 *   · Amplitudes are sub-perceptual per glance. Subtle moves a lattice
 *     ~6px over a minute. You are not supposed to notice it happening,
 *     only to notice that the screen isn't dead.
 *   · Student phones never render this. They take the theme colours only.
 */

import { getTheme, resolveBackground, hexA, BACKGROUND_PRESETS } from './themes.js';
import { prefersReducedMotion } from './motion.js';

export const AMBIENCE_LEVELS = {
  off: { name: 'Off', blurb: 'The backdrop holds still.' },
  subtle: { name: 'Subtle', blurb: 'A drift you feel more than see.' },
  lively: { name: 'Lively', blurb: 'Twice the travel, and faster.' },
};

export const DEFAULT_AMBIENCE = 'off';

/** Read a level off a deck background, defaulting safely. */
export function ambienceLevel(background) {
  const v = background && background.motion;
  return AMBIENCE_LEVELS[v] ? v : DEFAULT_AMBIENCE;
}

/**
 * Presets whose dominant feature is a repeating figure — the pattern is
 * the picture, so the pattern is what should move.
 *
 * `paper-cream` is deliberately NOT here despite being a repeating
 * gradient: its pitch is 3px, and drifting a 3px scanline across a
 * projector's own pixel grid produces a crawling moiré. It rides with the
 * washes instead, which is its dominant look anyway.
 */
const LATTICE = new Set(['dots', 'grid', 'grid-glow', 'stripes', 'topo', 'confetti']);

/** Per-level physics. Durations are seconds. */
const LEVELS = {
  subtle: { travel: 1, speed: 1, alpha: 1 },
  lively: { travel: 2.1, speed: 0.58, alpha: 1.35 },
};

/**
 * Describe — as plain data, no DOM — what should animate.
 *
 * Returns `{ level, kind, base, layers }` where `base` (or null) animates
 * the existing backdrop element itself and `layers` are extra elements to
 * stack inside it. Kept pure so it can be unit-tested in node and reused
 * by the editor preview without a second implementation.
 *
 * @param {object} background  the deck's background record
 * @param {string|object} themeRef  theme id or resolved custom theme
 * @param {string} [level]  override; defaults to background.motion
 */
export function ambiencePlan(background, themeRef, level) {
  const lvl = AMBIENCE_LEVELS[level] ? level : ambienceLevel(background);
  const theme = getTheme(themeRef);
  const empty = { level: 'off', kind: 'none', base: null, layers: [] };

  if (lvl === 'off') return empty;
  // High Contrast is an accessibility theme. Whatever the deck asks for,
  // it does not get moving light across it.
  if (theme.highContrast) return empty;

  const L = LEVELS[lvl] || LEVELS.subtle;
  const bg = resolveBackground(background, themeRef);

  if (bg.kind === 'image') {
    return { level: lvl, kind: 'image', base: kenBurns(bg, L), layers: [] };
  }

  if (bg.kind === 'preset' && LATTICE.has(bg.id)) {
    return { level: lvl, kind: 'lattice', base: latticeDrift(bg.id, L), layers: [] };
  }

  // washes, solids, and "none" — bloom layers over whatever is there
  return { level: lvl, kind: 'bloom', base: null, layers: blooms(theme, L) };
}

/**
 * Ken Burns. One very slow push-in that ping-pongs, so there is no cut
 * back to the start — a hard loop on a photograph is the single most
 * obvious tell that a background is a background.
 *
 * A blurred image is already scaled up 6% by backgroundStyles() to keep
 * the smeared edge off screen; start from at least that or the blur
 * feathers into view at the far end of the travel.
 */
function kenBurns(bg, L) {
  const floor = bg.blur ? 1.06 : 1;
  return {
    animation: 'drift',
    x: `${(1.6 * L.travel).toFixed(2)}%`,
    y: `${(1.1 * L.travel).toFixed(2)}%`,
    scale: [floor, floor * (1 + 0.075 * L.travel)],
    duration: round1(127 * L.speed),
  };
}

/**
 * Move the pattern itself, in pixels rather than percent: a lattice reads
 * against its own pitch, and 1% of a 4K stage would shove a 26px dot grid
 * most of a cell sideways. Ping-pong rather than scroll — a repeating
 * figure travelling in one direction eventually reveals its period, and
 * an alternating ease has no seam to reveal at any amplitude.
 */
function latticeDrift(id, L) {
  const pitch = latticePitch(id);
  // A fraction of one cell. Enough that the composite is never quite the
  // same picture twice; far too little to read as scrolling.
  const travel = Math.max(3, Math.min(16, pitch * 0.16)) * L.travel;
  return {
    animation: 'drift',
    x: `${travel.toFixed(1)}px`,
    y: `${(travel * 0.62).toFixed(1)}px`,
    scale: [1, 1],
    duration: round1(73 * L.speed),
  };
}

/** Cell size of a tiled preset, in px — read off its own background-size. */
function latticePitch(id) {
  const size = BACKGROUND_PRESETS[id] && BACKGROUND_PRESETS[id].size;
  const px = /(\d+(?:\.\d+)?)px/.exec(String(size || ''));
  return px ? Number(px[1]) : 30;
}

/**
 * Soft colour blooms for washes, solids and bare grounds.
 *
 * Three layers, each an enormous low-alpha radial, drifting and breathing
 * on co-prime periods. The point is not that any one of them is visible —
 * at these alphas none is. It is that where two of them overlap the hue
 * is a third colour, and that overlap wanders. Over a minute the top-left
 * of the slide genuinely changes colour, without anything ever appearing
 * to move.
 *
 * Alphas track the existing presets' range (0.06–0.22) so a bloom reads
 * as part of the same backdrop rather than something laid on top. Dark
 * themes get a white bloom in place of the light themes' ink one: on a
 * near-black ground a darker patch is a hole, but a lighter one is depth.
 */
function blooms(theme, L) {
  const t = theme.tokens;
  const a = (n) => Math.min(0.34, n * L.alpha);
  const spec = theme.dark
    ? [
      { color: t['--accent'], alpha: a(0.10), at: ['18%', '12%'], size: ['78%', '62%'] },
      { color: t['--accent-2'], alpha: a(0.085), at: ['84%', '74%'], size: ['70%', '58%'] },
      { color: '#ffffff', alpha: a(0.045), at: ['52%', '104%'], size: ['84%', '46%'] },
    ]
    : [
      { color: t['--accent'], alpha: a(0.085), at: ['14%', '8%'], size: ['76%', '60%'] },
      { color: t['--accent-2'], alpha: a(0.07), at: ['88%', '78%'], size: ['68%', '56%'] },
      { color: t['--ink'], alpha: a(0.03), at: ['46%', '106%'], size: ['88%', '48%'] },
    ];

  // Co-prime seconds. Drift and breathe are deliberately unequal on the
  // same layer too, so a layer never returns to a state it has been in.
  // Amplitude and heading vary as well: three layers sharing one travel
  // read as a single sheet sliding, which is the one thing this must
  // never look like.
  const path = [
    { x: 2.6, y: 1.9, grow: 0.11, drift: 89, breathe: 37 },
    { x: -3.4, y: -1.2, grow: 0.08, drift: 71, breathe: 59 },
    { x: 1.7, y: 2.8, grow: 0.14, drift: 53, breathe: 43 },
  ];

  return spec.map((s, i) => ({
    image: `radial-gradient(ellipse ${s.size[0]} ${s.size[1]} at ${s.at[0]} ${s.at[1]}, `
      + `${hexA(s.color, s.alpha)}, transparent 68%)`,
    x: `${(path[i].x * L.travel).toFixed(2)}%`,
    y: `${(path[i].y * L.travel).toFixed(2)}%`,
    scale: [1, 1 + path[i].grow * L.travel],
    opacity: [0.62, 1],
    driftDuration: round1(path[i].drift * L.speed),
    breatheDuration: round1(path[i].breathe * L.speed),
  }));
}

function round1(n) { return Math.round(n * 10) / 10; }

// =====================================================================
// DOM
// =====================================================================

/**
 * Mount (or update, or tear down) a plan on a backdrop element.
 *
 * Idempotent: call it on every repaint. It reuses the layer elements it
 * already made, so a theme change re-tints the blooms without restarting
 * their animations — which matters, because a restart is a visible jump
 * back to frame zero on something the room is looking at.
 *
 * @param {HTMLElement} host  the .stage-backdrop / .sp-backdrop element
 * @param {object} plan  from ambiencePlan()
 */
export function applyAmbience(host, plan) {
  if (!host) return;
  const on = plan && plan.level !== 'off' && !prefersReducedMotion();

  if (!on) {
    host.classList.remove('is-drifting');
    host.style.removeProperty('--amb-x');
    host.style.removeProperty('--amb-y');
    host.style.removeProperty('--amb-s0');
    host.style.removeProperty('--amb-s1');
    host.style.removeProperty('--amb-drift-dur');
    const stale = host.querySelector(':scope > .amb-stack');
    if (stale) stale.remove();
    return;
  }

  // base ----------------------------------------------------------------
  if (plan.base) {
    setVars(host, plan.base);
    host.classList.add('is-drifting');
  } else {
    host.classList.remove('is-drifting');
  }

  // layers --------------------------------------------------------------
  let stack = host.querySelector(':scope > .amb-stack');
  if (!plan.layers.length) {
    if (stack) stack.remove();
    return;
  }
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'amb-stack';
    stack.setAttribute('aria-hidden', 'true');
    host.append(stack);
  }

  // Match the child count first, then paint — reusing an existing element
  // keeps its animation running from wherever it currently is.
  while (stack.children.length > plan.layers.length) stack.lastElementChild.remove();
  while (stack.children.length < plan.layers.length) {
    const el = document.createElement('div');
    el.className = 'amb-layer';
    stack.append(el);
  }

  plan.layers.forEach((layer, i) => {
    const el = stack.children[i];
    el.style.backgroundImage = layer.image;
    setVars(el, layer);
    el.style.setProperty('--amb-o0', String(layer.opacity[0]));
    el.style.setProperty('--amb-o1', String(layer.opacity[1]));
    el.style.setProperty('--amb-breathe-dur', `${layer.breatheDuration}s`);
  });
}

function setVars(el, spec) {
  el.style.setProperty('--amb-x', spec.x);
  el.style.setProperty('--amb-y', spec.y);
  el.style.setProperty('--amb-s0', String(spec.scale[0]));
  el.style.setProperty('--amb-s1', String(spec.scale[1]));
  el.style.setProperty('--amb-drift-dur', `${spec.driftDuration ?? spec.duration}s`);
}
