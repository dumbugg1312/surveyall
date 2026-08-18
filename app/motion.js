/**
 * SurveyAll — motion engine.
 *
 * Why this exists: CSS transitions are the reason cheap charts look
 * cheap. A `transition: width .6s ease` moves every bar for exactly the
 * same duration regardless of how far it travels, so a bar nudging 2%
 * and a bar leaping 60% arrive together, and everything stops dead on a
 * fixed curve. Physical motion doesn't work like that.
 *
 * Everything animated here runs on a critically-ish damped spring:
 *
 *     F      = -k · (x - target)        (Hooke's law — pull to target)
 *     Fdamp  = -c · v                   (viscous damping)
 *     a      = (F + Fdamp) / m
 *     v     += a · dt
 *     x     += v · dt
 *
 * integrated with a fixed sub-step so it stays stable when a frame is
 * late (a dropped frame with variable dt can make a stiff spring
 * explode). Springs retarget mid-flight without restarting: when a new
 * vote lands, the bar keeps its current velocity and curves toward the
 * new value. That continuity is most of the "expensive" feel.
 *
 * One shared requestAnimationFrame ticker drives every spring on the
 * page, so 60 simultaneously-animating elements cost one rAF callback,
 * not sixty.
 */

const FIXED_STEP = 1 / 240;   // seconds — sub-step for integrator stability
const MAX_CATCHUP = 0.064;    // never simulate more than ~4 frames at once

/**
 * Presets mirror react-spring's, because that is what Mentimeter itself
 * ships (their production bundle contains react-spring's verbatim preset
 * table: default 170/26, gentle 120/14, wobbly 180/12, stiff 210/20).
 * Matching them means motion here reads with the same physical character
 * as the tool being replaced.
 *
 * ζ (damping ratio) = c / (2·√(k·m)); ζ = 1 is critical damping — the
 * fastest approach with NO overshoot.
 *
 * THE RULE THAT MATTERS: anything encoding a quantity (bar length, a
 * counter, an average) must use ζ ≈ 1. A bar that overshoots 62% on its
 * way to 58% has, for three frames, drawn a number that is not true.
 * Overshoot is for position and entrance only — where nothing is being
 * measured and the bounce just reads as life.
 */
export const PRESETS = {
  /** ζ≈1.00 — react-spring `default`. Quantitative: bar lengths, widths. */
  smooth:  { stiffness: 170, damping: 26, mass: 1 },
  /** ζ≈1.03 — react-spring `stiff`-ish, slightly overdamped. Small moves. */
  snappy:  { stiffness: 210, damping: 30, mass: 1 },
  /** ζ≈0.47 — react-spring `gentle`. POSITION AND ENTRANCE ONLY. */
  bouncy:  { stiffness: 120, damping: 14, mass: 1 },
  /** ζ≈1.10 — slower, no overshoot. Word-cloud reflow, big type. */
  gentle:  { stiffness: 120, damping: 24, mass: 1 },
  /** ζ≈1.03 — counters and averages, where overshoot reads as a bug. */
  precise: { stiffness: 210, damping: 30, mass: 1 },
};

/**
 * Force every spring, counter and delay to land instantly, regardless of
 * what the operating system asked for.
 *
 * The export does this while it draws (see export-print.js). A printed
 * page has no frames: a chart caught mid-flight prints a bar at whatever
 * length it had reached, which is a number that was never true. The same
 * rule the PRESETS comment states — never draw a quantity you are still
 * travelling toward — applies hardest to paper, because paper cannot
 * correct itself a frame later.
 *
 * Scoped and restored by the caller. Groups read this at construction, so
 * charts already on screen keep the physics they were built with.
 */
let forcedStill = false;

export function setMotionStill(on) {
  forcedStill = !!on;
}

export function prefersReducedMotion() {
  return forcedStill
    || (typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// =====================================================================
// Spring
// =====================================================================

export class Spring {
  constructor(value = 0, opts = {}) {
    const p = { ...PRESETS.smooth, ...opts };
    this.stiffness = p.stiffness;
    this.damping = p.damping;
    this.mass = p.mass || 1;
    this.fixedPrecision = p.precision ?? null;
    this.precision = this.fixedPrecision ?? 0.001;
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.settled = true;
  }

  /**
   * How close counts as "arrived".
   *
   * This MUST scale with how far the spring is travelling. The same
   * engine drives bar fractions (0–1), pixel positions (0–800) and vote
   * counts (0–60); a single absolute epsilon is either so tight that a
   * pixel move spends a second creeping the last hundredth of a pixel,
   * or so loose that a 0–1 fraction snaps visibly short of its target.
   * Same rule react-spring uses: ~0.1% of the distance travelled.
   */
  resolvePrecision(distance) {
    if (this.fixedPrecision != null) return this.fixedPrecision;
    return Math.max(1e-4, Math.min(1, Math.abs(distance) * 0.001));
  }

  /** Retarget without losing momentum. */
  to(target) {
    if (target === this.target) return this;
    this.precision = this.resolvePrecision(target - this.value);
    this.target = target;
    this.settled = false;
    return this;
  }

  /** Jump immediately — used on first paint and for reduced motion. */
  snap(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.settled = true;
    return this;
  }

  step(dt) {
    if (this.settled) return false;

    let remaining = Math.min(dt, MAX_CATCHUP);
    while (remaining > 0) {
      const h = Math.min(FIXED_STEP, remaining);
      remaining -= h;

      const displacement = this.value - this.target;
      const springForce = -this.stiffness * displacement;
      const dampingForce = -this.damping * this.velocity;
      const accel = (springForce + dampingForce) / this.mass;

      this.velocity += accel * h;
      this.value += this.velocity * h;
    }

    // Settle only when both the offset AND the motion are negligible;
    // checking position alone leaves springs jittering at the target,
    // and checking velocity alone lets one stop mid-travel at the apex.
    // Velocity is in units/second, so its threshold is scaled up from the
    // positional one rather than reusing it directly.
    if (Math.abs(this.value - this.target) < this.precision
        && Math.abs(this.velocity) < this.precision * 20) {
      this.value = this.target;
      this.velocity = 0;
      this.settled = true;
    }
    return true;
  }
}

// =====================================================================
// Shared ticker — one rAF for the whole page
// =====================================================================

const subscribers = new Set();
let rafId = null;
let lastTime = 0;

function frame(now) {
  const dt = lastTime ? Math.min((now - lastTime) / 1000, MAX_CATCHUP) : FIXED_STEP;
  lastTime = now;

  // Snapshot: a callback may subscribe or unsubscribe others (a render can
  // start a new animation), and mutating the live Set mid-iteration is how
  // a subscriber ends up orphaned — still registered, never called again.
  for (const sub of [...subscribers]) {
    try {
      if (sub(dt) === false) subscribers.delete(sub);
    } catch (err) {
      console.error(err);
      subscribers.delete(sub);
    }
  }

  // Keep going purely on whether anyone is still subscribed. An earlier
  // version also required at least one callback to report "still moving",
  // which meant a callback added *during* this loop — not yet counted —
  // could leave the loop shutting down with work outstanding.
  if (subscribers.size) {
    rafId = requestAnimationFrame(frame);
  } else {
    rafId = null;
    lastTime = 0;
  }
}

/**
 * Register a per-frame callback. Return false from it to unsubscribe.
 * Safe to call repeatedly with the same function: the Set de-duplicates,
 * and a repeat call restarts the loop if it had wound down. That property
 * is what makes SpringGroup.kick() self-healing.
 */
export function onFrame(fn) {
  subscribers.add(fn);
  if (rafId == null) {
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }
  return () => subscribers.delete(fn);
}

/** Number of live per-frame subscribers (used by tests). */
export function frameSubscriberCount() { return subscribers.size; }

// =====================================================================
// SpringGroup — the API the charts actually use
// =====================================================================

/**
 * A named bag of springs plus one render callback.
 *
 * Charts call `group.set('bar:2', 64)` whenever data changes and never
 * think about animation again: the group drives its render callback each
 * frame until everything settles, then stops burning frames.
 */
export class SpringGroup {
  constructor(render, opts = {}) {
    this.render = render;
    this.opts = opts;
    this.springs = new Map();
    this.reduced = prefersReducedMotion();
    this.idleFrames = 0;
    // A stable bound reference, so re-registering is a no-op in the Set
    // rather than stacking duplicate subscriptions.
    this.tick = this.tick.bind(this);
  }

  /**
   * Advance every spring by `dt` and repaint.
   * Split out from the ticker so it can be driven manually in tests.
   * @returns true while anything is still moving.
   */
  stepAll(dt) {
    let moving = false;
    for (const s of this.springs.values()) {
      if (s.step(dt)) moving = true;
    }
    // A throwing render must not silently kill the animation loop — that
    // is how a chart freezes half-drawn with no error anyone notices.
    try {
      this.render(this);
    } catch (err) {
      console.error(err);
    }
    return moving;
  }

  tick(dt) {
    if (this.stepAll(dt)) {
      this.idleFrames = 0;
      return true;
    }
    // Paint one extra settled frame so the exact final value lands, then
    // release the rAF rather than spinning at 60fps forever.
    this.idleFrames += 1;
    return this.idleFrames <= 1;
  }

  /** Current animated value for a key (creates it on first use). */
  get(key, initial = 0) {
    let s = this.springs.get(key);
    if (!s) {
      s = new Spring(initial, this.opts);
      this.springs.set(key, s);
    }
    return s.value;
  }

  /**
   * Point a key at a new value.
   * @param {object} [opts] {from} to start a brand-new spring somewhere
   *   specific (entrance animations), {preset} to override the physics.
   */
  set(key, target, opts = {}) {
    let s = this.springs.get(key);
    if (!s) {
      const physics = opts.preset ? PRESETS[opts.preset] : this.opts;
      s = new Spring(opts.from ?? target, { ...physics });
      this.springs.set(key, s);
      // A spring created at its target has nothing to animate; one
      // created with `from` should travel.
      if (opts.from == null) { s.snap(target); this.kick(); return this; }
    }
    if (this.reduced) { s.snap(target); this.kick(); return this; }
    s.to(target);
    this.kick();
    return this;
  }

  /** Set without animating — for first paint or a hard reset. */
  snap(key, value) {
    let s = this.springs.get(key);
    if (!s) {
      s = new Spring(value, this.opts);
      this.springs.set(key, s);
    }
    s.snap(value);
    this.kick();
    return this;
  }

  has(key) { return this.springs.has(key); }

  forget(key) { this.springs.delete(key); }

  /** Drop every spring whose key isn't in `keep` (removed chart rows). */
  prune(keep) {
    for (const key of [...this.springs.keys()]) {
      if (!keep.has(key)) this.springs.delete(key);
    }
  }

  get settled() {
    for (const s of this.springs.values()) if (!s.settled) return false;
    return true;
  }

  /**
   * Ensure this group is being driven.
   *
   * Deliberately unconditional. An earlier version guarded with a
   * "already subscribed" flag, which desynchronised the moment the ticker
   * dropped the callback for any reason the group didn't know about — the
   * group believed it was animating, never re-subscribed, and the chart
   * froze part-way with springs still holding velocity. Re-registering a
   * stable function reference is cheap and cannot double-subscribe, so
   * the safe thing is simply to always ask.
   */
  kick() {
    this.idleFrames = 0;
    onFrame(this.tick);
  }

  destroy() {
    subscribers.delete(this.tick);
    this.springs.clear();
  }
}

// =====================================================================
// Tweens — for the few things a spring is wrong for
// =====================================================================

/** Standard "expressive" ease-out. Fast start, long graceful tail. */
export function easeOutExpo(t) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Odometer-style number roll.
 * Counters use a tween rather than a spring because a spring overshoots,
 * and a vote count that flicks to 24 before settling on 23 reads as a bug.
 */
export function countTo(from, to, duration, onUpdate, ease = easeOutExpo) {
  if (prefersReducedMotion() || from === to) {
    onUpdate(to);
    return () => {};
  }
  const start = performance.now();
  return onFrame(() => {
    const t = Math.min(1, (performance.now() - start) / (duration * 1000));
    onUpdate(from + (to - from) * ease(t));
    if (t >= 1) { onUpdate(to); return false; }
    return true;
  });
}

/**
 * Entrance stagger. Returns the delay in seconds for item `i`.
 * Caps the total so a 40-option poll doesn't take 4 seconds to appear.
 */
export function stagger(i, step = 0.045, max = 0.3) {
  // 40–60ms per item is the design-system consensus (Carbon uses 20ms for
  // dense tables, Motion defaults to 100ms). Above ~80ms reads sluggish,
  // below ~25ms reads simultaneous. The cap keeps a 40-option poll from
  // taking two seconds to finish appearing.
  return Math.min(i * step, max);
}

/** Run `fn` after `delay` seconds, cancellable, frame-aligned. */
export function delay(seconds, fn) {
  if (prefersReducedMotion() || seconds <= 0) { fn(); return () => {}; }
  const start = performance.now();
  return onFrame(() => {
    if (performance.now() - start >= seconds * 1000) { fn(); return false; }
    return true;
  });
}

// =====================================================================
// Colour helpers used by the renderers
// =====================================================================

/** Parse #rgb, #rrggbb, rgb() or rgba() into [r,g,b]. */
export function toRGB(color) {
  const s = String(color || '').trim();
  const fn = s.match(/^rgba?\(([^)]+)\)/i);
  if (fn) {
    const p = fn[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  }
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(color, alpha) {
  const [r, g, b] = toRGB(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function mixColor(a, b, t) {
  const A = toRGB(a); const B = toRGB(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)}, ${
    Math.round(A[1] + (B[1] - A[1]) * t)}, ${
    Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

/** Relative luminance (WCAG) — used to pick readable label colours. */
export function luminance(color) {
  const [r, g, b] = toRGB(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever is readable on `bg`. */
export function readableOn(bg, dark = '#0b1220', light = '#ffffff') {
  return luminance(bg) > 0.42 ? dark : light;
}

/**
 * Convert an sRGB hex to OKLCH-ish polar form and back.
 * Categorical palettes generated by rotating hue at *constant perceptual
 * lightness* look designed; rotating hue in raw HSL does not, because HSL
 * lightness lies (pure yellow and pure blue at L=50% differ by ~4x in
 * perceived brightness, which is what makes naive rainbow palettes look
 * cheap and read unevenly on a projector).
 */
export function srgbToOklab(color) {
  let [r, g, b] = toRGB(color).map((v) => v / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  r = lin(r); g = lin(g); b = lin(b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToSrgb([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const gam = (c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  return `rgb(${gam(r)}, ${gam(g)}, ${gam(b)})`;
}

/**
 * Build a categorical palette by walking hue in OKLab between two anchor
 * colours, holding perceptual lightness steady. Every swatch reads with
 * the same visual weight on a projector.
 *
 * Holding lightness steady is what makes the set read as one family, and
 * it is also how the walk used to produce illegal swatches: on a theme
 * whose accents are both light (citrus-studio's tangerine → lime), every
 * colour on the ramp inherited that lightness and landed under 3:1
 * against the page. So each swatch is nudged in OKLab lightness — up on
 * a dark ground, down on a light one — until it clears the floor. The
 * nudge is per-swatch and as small as possible, so the family holds
 * together and only the offending members move. Same contract as
 * hueWheel(), which has always done this.
 *
 * @param {string} bg   the background these sit on (theme `--ground`)
 * @param {number} minContrast  WCAG 1.4.11 floor for graphical objects
 */
export function harmonicSeries(from, to, count, bg = null, minContrast = 3.05) {
  if (count <= 1) return [legible(from, bg, minContrast)];
  const A = srgbToOklab(from);
  const B = srgbToOklab(to);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    // ease the hue walk so the first colours stay closest to the accent
    const e = easeInOutCubic(t) * 0.86;
    out.push(legible([
      A[0] + (B[0] - A[0]) * e * 0.5,   // keep lightness nearly constant
      A[1] + (B[1] - A[1]) * e,
      A[2] + (B[2] - A[2]) * e,
    ], bg, minContrast));
  }
  return out;
}

/**
 * Push an OKLab colour along lightness until it clears `minContrast`
 * against `bg`, keeping its hue and as much chroma as the new lightness
 * can hold. Accepts an sRGB string too, so callers with a single colour
 * can use it directly. Passing no background disables the clamp.
 */
function legible(lab, bg, minContrast) {
  const L = Array.isArray(lab) ? lab : srgbToOklab(lab);
  // hand a passing colour straight back: a caller that gave us '#1d4ed8'
  // should not get 'rgb(29, 78, 216)' for its trouble
  if (!bg) return Array.isArray(lab) ? oklabToSrgb(L) : lab;
  const col = oklabToSrgb(L);
  if (contrastRatio(col, bg) >= minContrast) return Array.isArray(lab) ? col : lab;

  const h = Math.atan2(L[2], L[1]);
  // Toward whichever pole actually buys contrast. Compared, not
  // thresholded: the crossover is at ~0.18 relative luminance, so a
  // hand-picked "is it dark?" cutoff walks mid-tone grounds the wrong
  // way and the swatch gets less legible, not more.
  const dir = contrastRatio('#000000', bg) >= contrastRatio('#ffffff', bg) ? -1 : 1;
  let best = col;
  let bestRatio = contrastRatio(col, bg);
  for (let step = 0.02; step <= 0.6; step += 0.02) {
    const nl = Math.min(0.98, Math.max(0.06, L[0] + dir * step));
    const C = Math.min(Math.hypot(L[1], L[2]), maxChromaAt(nl, h) * 0.92);
    const c = oklabToSrgb([nl, C * Math.cos(h), C * Math.sin(h)]);
    const r = contrastRatio(c, bg);
    if (r >= minContrast) return c;
    if (r > bestRatio) { bestRatio = r; best = c; }
  }
  return best;
}

/**
 * Is an OKLab colour representable in sRGB without a channel clamping?
 * Mirrors the linear-RGB stage of oklabToSrgb and tests it *before* the
 * gamma+clamp, so we can tell a colour that fits from one that would be
 * flattened into a corner of the cube (which is what makes naive wide
 * palettes read as muddy — several distinct hues collapse to the same
 * clipped value).
 */
function oklabInGamut([L, A, B]) {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const eps = 0.001;
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps
    && b >= -eps && b <= 1 + eps;
}

/** WCAG contrast ratio between two colours. */
function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** The most chroma a hue can hold at a given lightness without clipping. */
function maxChromaAt(L, h) {
  let C = 0.03;
  let best = 0.03;
  while (C < 0.4) {
    if (oklabInGamut([L, C * Math.cos(h), C * Math.sin(h)])) best = C;
    else break;
    C += 0.004;
  }
  return best;
}

/**
 * A wide categorical palette — many distinct hues that POP, the way a word
 * cloud or a poll wants them, not a two-anchor gradient. It rotates hue
 * around the full wheel starting at the anchor (so the first swatch still
 * reads as the accent) and, for each hue, chooses the punchiest colour that
 * still reads on the background:
 *
 *  • For every hue it walks lightness and, at each stop, pushes chroma to
 *    the gamut edge — then keeps the lightness that yields the MOST chroma
 *    while still clearing `minContrast` against `bg`. Letting lightness
 *    float per hue is the whole point: pinning it (as a sequential ramp
 *    must) is what turns yellows into mud and leaves everything flat.
 *  • Because the target is contrast against the actual background, the same
 *    call yields deep vivid jewel tones on a light theme and bright ones on
 *    a dark theme, each as saturated as it can be and still be legible.
 *
 * @param {string} bg   the background these sit on (theme `--ground`)
 * @param {number} minContrast  WCAG floor; large chart text/shapes want ~3+
 */
export function hueWheel(anchor, count, bg = '#ffffff', minContrast = 3.3, toward = null) {
  if (count <= 1) return [anchor];
  const [, A0, B0] = srgbToOklab(anchor);
  const H0 = Math.atan2(B0, A0);
  const out = [];
  // A SECTOR, not the whole circle. Walking the full 360° gave four poll
  // bars in olive, teal, purple and orange on a theme whose entire palette
  // is olive and rust — the largest coloured surface in the room ignoring
  // the theme it was supposed to be wearing. The sector keeps what the
  // wheel is for (each option owns a hue, and holds it across the reveal)
  // while keeping the whole set inside one region of the wheel, so the
  // bars read as this theme rather than as a default chart library.
  // Step size grows with the option count and the total span caps at
  // ~198°, so two options sit a comfortable 36° apart and eight still
  // clear 28° — past that, more separation buys no legibility, it just
  // walks back out to the rainbow.
  // `toward` is the theme's second accent. It sets which WAY the sector
  // sweeps, so the series walks the ground the theme already covers —
  // olive through amber to rust — instead of walking off into whatever
  // hue happens to sit counter-clockwise of the accent. Without it a warm
  // theme's third bar is teal. Direction only: the arc is still spaced by
  // STEP, so two accents that sit almost on top of each other still yield
  // options that can be told apart.
  const STEP = 0.62;                 // ~36° between neighbours
  const MAX_ARC = Math.PI * 1.1;     // ~198° end to end
  const arc = Math.min(MAX_ARC, (count - 1) * STEP);
  let dir = 1;
  if (toward) {
    const [, A1, B1] = srgbToOklab(toward);
    // shortest signed way round from the accent to the second accent
    let d = Math.atan2(B1, A1) - H0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (d < 0) dir = -1;
  }
  for (let i = 0; i < count; i += 1) {
    const h = H0 + dir * (i / (count - 1)) * arc;
    let best = null;
    let bestChroma = -1;
    let fallback = null;
    let fallbackContrast = -1;
    for (let L = 0.30; L <= 0.86; L += 0.02) {
      const C = maxChromaAt(L, h) * 0.92; // ease off the very edge
      const col = oklabToSrgb([L, C * Math.cos(h), C * Math.sin(h)]);
      const ct = contrastRatio(col, bg);
      if (ct >= minContrast && C > bestChroma) { bestChroma = C; best = col; }
      // if no lightness clears the bar, keep the most-contrasting we saw
      if (ct > fallbackContrast) { fallbackContrast = ct; fallback = col; }
    }
    out.push(best || fallback);
  }
  return out;
}
