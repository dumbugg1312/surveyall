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
 * WHAT MOVES: LIGHT, NOT THE TEXTURE
 *
 * The first version of this drifted each background's own artwork — the
 * dot grid slid a few pixels, the graph paper slid a few pixels. On a
 * lattice that is *provably invisible*, and it is worth writing down
 * why, because it is an easy thing to build twice: a uniform repeating
 * pattern is translation-invariant. A dot grid offset by 7px is a dot
 * grid. There is no amplitude at which that becomes visible, because at
 * every instant the translated pattern is pixel-identical to the one it
 * started as. The only parts of a "lattice" preset that a drift can move
 * are the parts that DON'T repeat — grid-glow's bottom glow, topo's
 * contour origin, confetti's scatter — and three of the six presets have
 * no such part at all.
 *
 * So the drift is no longer the effect; it is a garnish. Every
 * background, whatever its kind, now carries the same thing on top:
 *
 *   blooms    two or three enormous, soft, low-alpha colour fields that
 *             rotate, swell and fade on co-prime cycles. They are what
 *             you actually see. Over a wash they move the hue; over a
 *             lattice they pass across the lines like light crossing a
 *             room, brightening one region as another dims; over a flat
 *             ground they are the whole picture.
 *
 * Rotation does most of that work. Sliding a blob reads as a thing
 * sliding, which is cheap; rotating a big off-centre blob about the
 * frame's middle sweeps it through a long arc while nothing ever appears
 * to travel in a direction. That is the difference between "animated"
 * and "alive".
 *
 * On top of the blooms, two backgrounds keep a motion of their own:
 *
 *   lattices  the base still drifts a few pixels, which moves whatever
 *             is non-periodic in it and costs nothing where there is
 *             nothing to move.
 *   images    a Ken Burns crawl, two minutes end to end, and no blooms —
 *             coloured light over a photograph reads as a smudge.
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
  lively: { travel: 1.7, speed: 0.6, alpha: 1.3 },
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

  // A photograph is already a picture. Blooms over it read as a smudge,
  // so an image gets the crawl and nothing else.
  if (bg.kind === 'image') {
    return { level: lvl, kind: 'image', base: kenBurns(bg, L), layers: [] };
  }

  // Everything else gets the blooms. Lattices additionally drift, which
  // moves their non-periodic parts; see the note at the top of this file
  // for why that drift can never carry the effect on its own.
  const lattice = bg.kind === 'preset' && LATTICE.has(bg.id);
  return {
    level: lvl,
    kind: lattice ? 'lattice' : 'bloom',
    base: lattice ? latticeDrift(bg.id, L) : null,
    layers: blooms(theme, L),
  };
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
  // A fraction of one cell — enough to move the preset's non-periodic
  // parts, far too little to read as scrolling.
  //
  // The ceiling is applied AFTER the level multiplier, not before, and
  // that ordering is the whole point of it: it is what makes the
  // overhang on .stage-backdrop.is-drifting a guarantee rather than a
  // hope. Clamping first let confetti's 340px cell reach 16px at subtle
  // and 27px at lively, walking straight through a 24px margin and
  // dragging a bare strip of --ground into the frame.
  const travel = clamp(pitch * 0.16 * L.travel, 3, MAX_BASE_TRAVEL);
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
 * The blooms — three enormous, soft, low-alpha colour fields.
 *
 * These carry the whole effect, so they have to be big enough and travel
 * far enough to change the picture. The first cut of this used ±2.6%
 * translation and an opacity floor of 0.62; comparing the two extremes of
 * a full cycle side by side, the frames were near enough identical to
 * call it static. The numbers below were set by that comparison — jump
 * the animation to phase 0 and phase 1 and the two must obviously differ.
 *
 * Three things move together, and the mix matters more than any one:
 *
 *   rotate   the main event. A big off-centre field swung about the
 *            frame's centre sweeps a long arc without ever reading as a
 *            thing sliding across the screen.
 *   scale    swelling and receding changes how far the field reaches,
 *            so the edge of the colour moves even where the centre
 *            barely does.
 *   opacity  a wide floor-to-ceiling range, because a bloom fading up
 *            from a quarter strength is a hue appearing, which the eye
 *            catches at far lower amplitudes than movement.
 *
 * Alphas stay inside the range the static presets already use (0.04–0.14)
 * so a bloom reads as part of the backdrop rather than laid over it —
 * and, more practically, so the projected text on top of it never has to
 * compete. Dark themes get a white bloom where light themes get an ink
 * one: on a near-black ground a darker patch is a hole, a lighter one is
 * depth.
 */
function blooms(theme, L) {
  const t = theme.tokens;
  const a = (n) => Math.min(0.34, n * L.alpha);
  const spec = theme.dark
    ? [
      { color: t['--accent'], alpha: a(0.15), at: ['18%', '12%'], size: ['82%', '66%'] },
      { color: t['--accent-2'], alpha: a(0.13), at: ['84%', '74%'], size: ['74%', '62%'] },
      { color: '#ffffff', alpha: a(0.07), at: ['52%', '104%'], size: ['88%', '50%'] },
    ]
    : [
      { color: t['--accent'], alpha: a(0.13), at: ['14%', '8%'], size: ['80%', '64%'] },
      { color: t['--accent-2'], alpha: a(0.11), at: ['88%', '78%'], size: ['72%', '60%'] },
      { color: t['--ink'], alpha: a(0.05), at: ['46%', '106%'], size: ['92%', '52%'] },
    ];

  // Co-prime seconds, and drift ≠ breathe on the same layer, so no layer
  // ever returns to a state it has been in and the set as a whole takes
  // hours to repeat. Amplitude and heading vary per layer as well —
  // three layers sharing one path read as a single sheet sliding, which
  // is the one thing this must never look like.
  const path = [
    { x: 2.6, y: 1.9, rot: 9, grow: 0.20, drift: 67, breathe: 29 },
    { x: -3.2, y: -1.4, rot: -7, grow: 0.15, drift: 53, breathe: 37 },
    { x: 1.8, y: 2.8, rot: 6, grow: 0.24, drift: 41, breathe: 23 },
  ];

  return spec.map((s, i) => ({
    image: `radial-gradient(ellipse ${s.size[0]} ${s.size[1]} at ${s.at[0]} ${s.at[1]}, `
      + `${hexA(s.color, s.alpha)}, transparent 68%)`,
    x: `${(path[i].x * L.travel).toFixed(2)}%`,
    y: `${(path[i].y * L.travel).toFixed(2)}%`,
    // Clamped for looks rather than for safety — past about 12° the
    // sweep stops reading as light moving through a room and starts
    // reading as a thing spinning, which is the tell of a cheap effect.
    rotate: `${clamp(path[i].rot * L.travel, -MAX_ROTATION, MAX_ROTATION).toFixed(2)}deg`,
    scale: [1, 1 + path[i].grow * L.travel],
    opacity: [0.28, 1],
    driftDuration: round1(path[i].drift * L.speed),
    breatheDuration: round1(path[i].breathe * L.speed),
  }));
}

const MAX_ROTATION = 12;

/**
 * Hard ceiling on how far the backdrop itself may travel, in px.
 * Must stay comfortably under the `inset` on .stage-backdrop.is-drifting
 * in styles/ambience.css — that overhang is the only thing keeping bare
 * --ground out of the frame, so the two are changed together or not at
 * all. `y` travels 0.62× this, so the binding constraint is `x`.
 */
const MAX_BASE_TRAVEL = 16;

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

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
    for (const v of ['--amb-x', '--amb-y', '--amb-r', '--amb-s0', '--amb-s1', '--amb-drift-dur']) {
      host.style.removeProperty(v);
    }
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
  el.style.setProperty('--amb-r', spec.rotate || '0deg');
  el.style.setProperty('--amb-s0', String(spec.scale[0]));
  el.style.setProperty('--amb-s1', String(spec.scale[1]));
  el.style.setProperty('--amb-drift-dur', `${spec.driftDuration ?? spec.duration}s`);
}
