/**
 * SurveyAll — the mural: what the room paints on the wall.
 *
 * A projected question used to be a chart on a backdrop. The chart is
 * still the truth — lengths on a common baseline, springs, no overshoot —
 * but the wall behind it is now made BY the room: every answer that lands
 * comes up as one soft seed of light in a phyllotaxis, the sunflower's
 * own spiral. Seed i sits at angle i·137.5° and radius ∝ √i, so no two seeds
 * ever overlap, the pattern is the same shape at 6 answers and at 600,
 * and the whole thing is a flower that only exists because people
 * answered. Sixty students, sixty seeds, in the sixty colours their
 * answers wear on the chart above — a picture of the distribution that
 * nobody drew and everybody made.
 *
 * WHAT A SEED MEANS
 *   one seed      one answer (one row), never a person's identity
 *   its colour    what the answer WAS, in the chart's own palette: the
 *                 option's wheel hue, a scale's place on the low→high
 *                 ramp, a lamp's light. While results are hidden every
 *                 seed is the accent, so the flower says how many
 *                 without saying what — and on reveal it blooms into
 *                 colour, which is the reveal happening on the wall.
 *   its position  order of arrival, nothing more. The spiral is not a
 *                 chart; it is a count you can feel.
 *
 * In the lobby the seeds are the phones connecting — the room gathering,
 * visible from the back row. On a new question the old flower lets go
 * (its seeds drift out and fade) and a new one grows.
 *
 * WHAT IT REFUSES TO DO
 *   No comets, no trails, no sparks, no highlights on the seeds. An
 *   earlier cut flew each answer in from the join corner on a lit arc,
 *   and sixty arcs a minute turned the wall into a screensaver. A seed
 *   arrives the way light does: it is simply, softly, there. The
 *   arrival is already told once — the bar's glint and the count's
 *   pulse — and a thing said twice is a thing said loudly.
 *
 * THE RULES IT KEEPS
 *   · Nothing here is a quantity. It never draws a bar, a number, or a
 *     length anyone could read as a measurement; the chart above does
 *     that, on springs (see motion.js).
 *   · It shares motion.js's one requestAnimationFrame and lets go of it
 *     the moment every seed is at rest, so a settled slide costs the main
 *     thread nothing — the frames belong to the bars.
 *   · prefers-reduced-motion: seeds appear where they belong, no flight,
 *     no drift, no glow-breath. The picture is kept; the motion is not.
 *   · The high-contrast theme gets no mural at all.
 *   · Alphas stay under what leaves body text at AA over a seed: the
 *     brightest core is .55 on a dark ground and .42 on a light one, in
 *     colours that already clear 3:1 against the ground.
 */

import { onFrame, prefersReducedMotion, toRGB } from './motion.js';
import { hexA } from './themes.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));   // 137.507…°

let canvas = null;
let ctx = null;
let stage = null;
let W = 0;
let H = 0;
let dpr = 1;
let dark = false;
let off = false;
let accent = '#4a5d23';

/** id → seed. Insertion order is arrival order, which is the spiral order. */
const seeds = new Map();
/** seeds that have been let go: dissolving in place */
const ghosts = [];
let scene = 'lobby';
let seq = 0;
let running = false;
let idleFrames = 0;

// =====================================================================
// Mount
// =====================================================================

/**
 * @param {HTMLElement} host   the .stage
 */
export function mountMural(host) {
  stage = host;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'stage-mural';
    canvas.setAttribute('aria-hidden', 'true');
    // after the scrim, before the back decor: paints over the backdrop
    // and under everything the instructor placed or the room can read
    const scrim = host.querySelector('.stage-scrim');
    if (scrim) scrim.after(canvas); else host.prepend(canvas);
    window.addEventListener('resize', resize);
  }
  resize();
}

/** Re-read the theme: called with applyTheme's result whenever it changes. */
export function muralTheme(theme) {
  dark = !!theme?.dark;
  off = !!theme?.highContrast;
  accent = theme?.tokens?.['--accent'] || accent;
  if (off && canvas) { canvas.hidden = true; clear(); } else if (canvas) canvas.hidden = false;
  kick();
}

function resize() {
  if (!canvas || !stage) return;
  const r = stage.getBoundingClientRect();
  W = Math.max(1, Math.round(r.width));
  H = Math.max(1, Math.round(r.height));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  relayout(true);
  kick();
}

// =====================================================================
// The spiral
// =====================================================================

/** Where the flower grows: around the chart, a little below centre. */
function centre() {
  return [W * 0.5, H * (scene === 'lobby' ? 0.5 : 0.53)];
}

/**
 * Seed slots — a sunflower, filled from the RIM inward.
 *
 * Seed i sits at angle i·137.5° and, in an ordinary phyllotaxis, radius
 * ∝ √i: the first seeds crowd the middle. On a projected slide the
 * middle is exactly where the bars are, so the first ten answers of
 * every question would land behind the chart and the room would see
 * nothing until it was half full. Inverting the radius — √(1 − i/ref) —
 * puts the first answers on the rim, where the wall is open, and fills
 * inward as the room fills. The flower is complete when the room is.
 *
 * The rim is an ellipse in the stage's own aspect, so it frames the
 * chart rather than cutting through it. The reference count grows in
 * steps of 24 so the ring holds still between arrivals instead of
 * re-spacing on every vote; when it does grow, every seed eases to its
 * new slot rather than jumping.
 */
function slot(i, n) {
  const ref = Math.max(36, Math.ceil((n + 6) / 24) * 24);
  const lobby = scene === 'lobby';
  const rx = W * (lobby ? 0.36 : 0.40);
  const ry = H * (lobby ? 0.42 : 0.42);
  const r = Math.sqrt(Math.max(0.04, 1 - i / ref));
  const a = i * GOLDEN;
  const [cx, cy] = centre();
  return [cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r];
}

function seedRadius() {
  return Math.max(4, Math.min(W, H) * 0.012);
}

function relayout(snap = false) {
  let i = 0;
  const n = seeds.size;
  for (const s of seeds.values()) {
    const [tx, ty] = slot(i, n);
    s.tx = tx; s.ty = ty;
    if (snap || s.x == null) { s.x = tx; s.y = ty; }
    i += 1;
  }
}

// =====================================================================
// API
// =====================================================================

/**
 * Bring the mural in line with the rows on screen.
 *
 * @param {Array<{id:any}>} rows        the rows the chart is drawing
 * @param {(row) => string|null} color  the seed colour; null = neutral
 * @param {object} opts  { animate } — new rows fly in when true; on a
 *        cold start (reload mid-class) they are placed in a quick cascade
 */
export function muralSync(rows, color, opts = {}) {
  if (off) return;
  scene = 'question';
  const keep = new Set();
  const wasEmpty = seeds.size === 0;
  // A question's first answers fly in like every later one; a wall that
  // is empty and suddenly holds thirty rows is a reload mid-class, and
  // those are placed in a cascade rather than thirty flights at once.
  const animate = opts.animate ?? (!wasEmpty || (rows || []).length <= 3);
  let arrivals = 0;

  for (const row of rows || []) {
    const id = `r:${row.id}`;
    keep.add(id);
    const c = color?.(row) || null;
    let s = seeds.get(id);
    if (!s) {
      s = makeSeed(c);
      seeds.set(id, s);
      if (!prefersReducedMotion()) {
        s.alpha = 0;
        // live: each seed comes up on its own; cold start: a quiet
        // cascade, so a reload mid-class does not switch thirty on at once
        s.wake = animate ? 0.001 : Math.min(1.2, arrivals * 0.025);
      }
      arrivals += 1;
    } else {
      retint(s, c);
    }
  }

  for (const [id, s] of [...seeds]) {
    if (!keep.has(id)) letGo(s, id);
  }
  relayout(wasEmpty);
  kick();
}

/**
 * The lobby: one neutral seed per phone connected. The room gathering.
 * @param {number} n
 */
export function muralPresence(n) {
  if (off) return;
  if (scene !== 'lobby') {
    // coming back to the lobby (a session ended): let the last flower go
    for (const [id, s] of [...seeds]) letGo(s, id);
    scene = 'lobby';
  }
  const want = Math.max(0, Math.min(400, Number(n) || 0));
  let i = 0;
  for (const [id, s] of [...seeds]) {
    if (!id.startsWith('p:')) continue;
    if (i >= want) letGo(s, id);
    i += 1;
  }
  for (let k = i; k < want; k += 1) {
    const s = makeSeed(null);
    seeds.set(`p:${k}:${Math.random().toString(36).slice(2, 7)}`, s);
    if (!prefersReducedMotion()) { s.alpha = 0; s.wake = 0.001; }
  }
  relayout(false);
  kick();
}

/** A new question: the old flower lets go, the next one starts empty. */
export function muralRelease() {
  for (const [id, s] of [...seeds]) letGo(s, id);
  kick();
}

/** Everything out, at once, no ceremony (theme switch, teardown). */
export function muralClear() {
  clear();
}

function clear() {
  seeds.clear();
  ghosts.length = 0;
  if (ctx) ctx.clearRect(0, 0, W, H);
}

// =====================================================================
// Seeds
// =====================================================================

function makeSeed(color) {
  seq += 1;
  return {
    x: null, y: null, tx: 0, ty: 0,
    color: color || accent,        // drawn colour (eases toward `to`)
    to: color || accent,
    neutral: !color,
    alpha: 1,                      // eases up from 0 on arrival
    wake: 0,                       // seconds until it begins to come up
    // a little variety in size, decided once and for good — a field of
    // identical dots reads as a pattern, a field of nearly identical
    // ones reads as light. Every fourth seed sits at a second depth:
    // larger and fainter, the way a light out of the lens's focal plane
    // is, so the field has a near and a far instead of one flat layer.
    size: (0.82 + ((seq * 7919) % 37) / 37 * 0.42) * (seq % 4 === 0 ? 1.7 : 1),
    far: seq % 4 === 0,
  };
}

function retint(s, color) {
  const next = color || accent;
  s.neutral = !color;
  if (next !== s.to) { s.to = next; s.mix = 0; s.from = s.color; }
}

/** A seed let go dissolves where it is, drifting a breath outward. */
function letGo(s, id) {
  seeds.delete(id);
  if (prefersReducedMotion() || s.x == null || s.alpha <= 0) return;
  const [cx, cy] = centre();
  const dx = s.x - cx;
  const dy = s.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  ghosts.push({
    x: s.x, y: s.y, size: s.size, far: s.far,
    vx: (dx / d) * 9, vy: (dy / d) * 9 - 4,
    color: s.color, alpha: s.alpha, age: 0, ttl: 1.6 + ((seq * 31) % 10) / 10 * 0.8,
  });
}

// =====================================================================
// The loop
// =====================================================================

function kick() {
  if (running || !ctx || off) return;
  running = true;
  idleFrames = 0;
  onFrame(tick);
}

function tick(dt) {
  if (!ctx) { running = false; return false; }
  const reduced = prefersReducedMotion();
  let moving = false;
  const step = Math.min(dt, 0.05);

  // ---- ease every seed toward its slot and its colour
  const k = reduced ? 1 : 1 - Math.exp(-step * 5);
  for (const s of seeds.values()) {
    if (s.x == null) { s.x = s.tx; s.y = s.ty; }
    const dx = s.tx - s.x; const dy = s.ty - s.y;
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) { s.x += dx * k; s.y += dy * k; moving = true; }
    else { s.x = s.tx; s.y = s.ty; }
    if (s.mix != null && s.mix < 1) {
      s.mix = reduced ? 1 : Math.min(1, s.mix + step * 1.4);
      s.color = mix(s.from, s.to, easeOut(s.mix));
      if (s.mix >= 1) { s.color = s.to; s.mix = null; }
      moving = true;
    }
    if (s.wake > 0) {
      s.wake -= step;
      moving = true;
    } else if (s.alpha < 1) {
      // comes up over about a second — the way a lamp warms, not a flash
      s.alpha = reduced ? 1 : Math.min(1, s.alpha + step * 0.9);
      moving = true;
    }
  }

  // ---- ghosts
  for (let i = ghosts.length - 1; i >= 0; i -= 1) {
    const g = ghosts[i];
    g.age += step;
    if (g.age >= g.ttl) { ghosts.splice(i, 1); continue; }
    g.x += g.vx * step; g.y += g.vy * step;
    moving = true;
  }

  draw();

  if (moving) { idleFrames = 0; return true; }
  // one settled frame, then release the loop to the charts
  idleFrames += 1;
  if (idleFrames > 1) { running = false; return false; }
  return true;
}

/**
 * One seed is one soft disc of light: a gaussian falloff with a slightly
 * denser centre, nothing hard-edged anywhere. On a dark ground that is
 * bokeh — light through a window behind the chart; on a light ground it
 * is a watercolour dab. The chart's ink stays legible over either: the
 * densest point is .38 on a light ground and .5 on a dark one, in a
 * colour that already clears 3:1 against that ground.
 */
function seedDisc(x, y, radius, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, hexA(color, alpha));
  g.addColorStop(0.35, hexA(color, alpha * 0.55));
  g.addColorStop(0.7, hexA(color, alpha * 0.16));
  g.addColorStop(1, hexA(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  // a light ground needs the dab a touch bigger and denser to read from
  // the back row; a dark ground needs it smaller, or bokeh becomes fog
  const r = seedRadius() * (dark ? 3.2 : 3.7);
  const peak = dark ? 0.5 : 0.44;

  for (const g of ghosts) {
    const p = g.age / g.ttl;
    const a = g.alpha * (1 - p) * peak * (g.far ? 0.55 : 1);
    if (a <= 0.005) continue;
    seedDisc(g.x, g.y, r * g.size * (1 + p * 0.3), toHex(g.color), a);
  }

  for (const s of seeds.values()) {
    if (s.alpha <= 0) continue;
    const a = easeOut(s.alpha) * peak * (s.neutral ? 0.8 : 1) * (s.far ? 0.55 : 1);
    // comes up slightly larger than it settles: a warm-up, not a pop
    const grow = 1 + (1 - easeOut(s.alpha)) * 0.25;
    seedDisc(s.x, s.y, r * s.size * grow, toHex(s.color), a);
  }
}

// =====================================================================
// Colour helpers
// =====================================================================

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function toHex(color) {
  const s = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  const [r, g, b] = toRGB(s);
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a, b, t) {
  const A = toRGB(a); const B = toRGB(b);
  return `#${[0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** Test hook: the seeds currently on the wall. */
export function muralSeeds() {
  return [...seeds.values()].map((s) => ({ x: s.x, y: s.y, color: s.color, alpha: s.alpha }));
}
