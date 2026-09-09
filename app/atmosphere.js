/**
 * SurveyAll — atmosphere: the phone as a canvas.
 *
 * A student's screen used to be a form on a flat colour. This makes it a
 * place: the theme's own backdrop, the projector's slow blooms of light,
 * a weather of particles the palette implies (chalk dust, stars, embers,
 * petals, snow), and — the part that matters — a surface that answers
 * back. Every answer leaves a mark:
 *
 *   ripple(x, y, colour)   a tap on an option sends a ring out from the
 *                          thumb in THAT OPTION'S wall colour, and the
 *                          whole sky leans toward the same hue — so the
 *                          colour a student chooses is the colour they
 *                          will find themselves in on the projector.
 *   lean(t, colour)        a slider drags the light left or right with
 *                          it; where you stand is where the light is.
 *   send(colour, y, word)  on submit the answer LEAVES: one mote of
 *                          light rises off the button, and a word answer
 *                          rises as the word itself before it dissolves
 *                          into the cloud. No trail, no flash — a first
 *                          cut had both, and it looked like a game.
 *   arrive()               the room's results landing on the phone: a
 *                          wash of light from above.
 *   finale()               the wrap: a slow fall of everything at once.
 *
 * Nothing here encodes a quantity — every mark is a memory of a gesture,
 * never a measurement — which is why it does not run on motion.js's
 * springs (see the doctrine at the top of that file). It does share that
 * file's ONE requestAnimationFrame ticker, so the shared-results chart
 * and this layer never fight over frames, and it steps aside entirely
 * for prefers-reduced-motion: no particles, no comets, no ripples. The
 * backdrop and blooms then hold still, exactly as the projector's do.
 *
 * Cost, because a phone is not a lectern laptop: the canvas draws at
 * device pixels capped at 2×, holds at most a few dozen particles, skips
 * every other frame while nothing but weather is moving, and stops
 * painting the moment the tab is hidden. The blooms are the projector's
 * own compositor-only layers (styles/ambience.css) and cost the main
 * thread nothing.
 */

import {
  getTheme, resolveBackground, backgroundStyles, themeMotif, hexA,
} from './themes.js';
import { ambiencePlan, applyAmbience } from './ambience.js';
import { onFrame, prefersReducedMotion, toRGB, mixColor } from './motion.js';

const MAX_DPR = 2;
const MAX_PARTICLES = 90;

let host = null;       // .atmo
let backdrop = null;   // .atmo-backdrop (preset + blooms)
let mood = null;       // .atmo-mood (the answer's hue, as light)
let canvas = null;
let ctx = null;
let theme = null;
let motif = { motes: 'none' };
let tokens = {};
let W = 0;
let H = 0;
let dpr = 1;

const motes = [];      // ambient weather
const marks = [];      // ripples, comets, rising words, finale rain
let leanTo = null;     // {t, color, alpha}
let leanNow = null;
let running = false;
let frameNo = 0;
let lastT = 0;
let moodTimer = null;

// =====================================================================
// Mount
// =====================================================================

/**
 * Mount (or re-theme) the atmosphere behind the page. Idempotent: called
 * again on a theme change it re-tints in place rather than restarting,
 * so the blooms keep their phase and the weather keeps falling.
 *
 * @param {string|object} themeRef  a built-in id or a resolved custom theme
 */
export function mountAtmosphere(themeRef) {
  theme = getTheme(themeRef);
  tokens = theme.tokens;
  motif = themeMotif(themeRef);

  if (!host) {
    host = document.createElement('div');
    host.className = 'atmo';
    host.setAttribute('aria-hidden', 'true');

    backdrop = document.createElement('div');
    backdrop.className = 'atmo-backdrop';

    mood = document.createElement('div');
    mood.className = 'atmo-mood';

    canvas = document.createElement('canvas');
    canvas.className = 'atmo-canvas';

    host.append(backdrop, mood, canvas);
    document.body.prepend(host);

    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') start();
    });
  }

  // The high-contrast theme is an accessibility theme; it gets a still,
  // bare ground and nothing else. Same rule the projector's ambience keeps.
  host.classList.toggle('is-off', !!theme.highContrast);

  // The theme's own backdrop — the same preset the projector draws, at
  // the same alphas, so the phone and the wall are visibly one deck.
  // Custom themes carry no preset on the join payload, so they get the
  // blooms over their ground, which is what a bare ground looks like on
  // the projector too.
  const background = { kind: 'theme' };
  Object.assign(backdrop.style, backgroundStyles(background, themeRef));
  applyAmbience(backdrop, ambiencePlan(background, themeRef, 'lively'));

  mood.style.setProperty('--mood', tokens['--accent']);
  mood.classList.remove('is-lit');

  seedMotes();
  resize();
  start();
}

function resize() {
  if (!canvas) return;
  const vv = window.visualViewport;
  W = Math.round(vv ? vv.width : window.innerWidth) || window.innerWidth;
  H = Math.round(window.innerHeight);
  dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// =====================================================================
// Weather — the ambient motes
// =====================================================================

/**
 * Each kind is a way of moving as much as a shape. Dust hangs and turns,
 * embers rise and flicker, petals fall and sway, snow falls straight and
 * slow, stars do not move at all but breathe, fireflies blink, sparks
 * are short vertical ticks that slide up a grid, pixels are squares that
 * step, rings rise like breath under water, ink blooms once and fades.
 */
function seedMotes() {
  motes.length = 0;
  if (motif.motes === 'none' || prefersReducedMotion()) return;
  const n = Math.min(60, motif.n || 12);
  for (let i = 0; i < n; i += 1) motes.push(makeMote(true));
}

function makeMote(anywhere = false) {
  const kind = motif.motes;
  const r = Math.random;
  const m = {
    kind,
    x: r() * (W || 400),
    y: anywhere ? r() * (H || 800) : -20,
    life: r(),               // phase for twinkle / blink
    size: 1 + r() * 2.2,
    vx: 0,
    vy: 0,
    color: tokens['--accent'],
    alpha: 0.5,
    sway: r() * Math.PI * 2,
    spin: r() * Math.PI * 2,
  };
  switch (kind) {
    case 'dust':
      m.size = 1.2 + r() * 2.4;
      m.vx = (r() - 0.5) * 6;
      m.vy = -3 - r() * 6;
      m.color = theme.dark ? '#ffffff' : tokens['--ink'];
      m.alpha = theme.dark ? 0.28 : 0.16;
      m.y = anywhere ? r() * H : H + 20;
      break;
    case 'stars':
      m.size = 0.6 + r() * 1.5;
      m.color = r() < 0.25 ? tokens['--accent'] : '#ffffff';
      m.alpha = 0.35 + r() * 0.5;
      m.vx = 0;
      m.vy = -0.6;
      break;
    case 'embers':
      m.size = 1 + r() * 2;
      m.vx = (r() - 0.5) * 10;
      m.vy = -14 - r() * 20;
      m.color = r() < 0.6 ? tokens['--accent'] : tokens['--accent-2'];
      m.alpha = 0.6;
      m.y = anywhere ? r() * H : H + 10;
      break;
    case 'petals':
      m.size = 3 + r() * 4;
      m.vx = 6 + r() * 8;
      m.vy = 9 + r() * 10;
      m.color = r() < 0.55 ? tokens['--accent'] : tokens['--accent-2'];
      m.alpha = 0.22;
      break;
    case 'snow':
      m.size = 1 + r() * 2.4;
      m.vx = (r() - 0.5) * 5;
      m.vy = 9 + r() * 12;
      m.color = theme.dark ? '#ffffff' : tokens['--ink-soft'];
      m.alpha = theme.dark ? 0.6 : 0.3;
      break;
    case 'fireflies':
      m.size = 1.4 + r() * 1.6;
      m.vx = (r() - 0.5) * 8;
      m.vy = (r() - 0.5) * 6;
      m.color = tokens['--accent'];
      m.alpha = 0.8;
      m.y = anywhere ? r() * H : r() * H;
      break;
    case 'sparks':
      m.size = 6 + r() * 12;      // tick length
      m.vx = 0;
      m.vy = -18 - r() * 26;
      m.color = r() < 0.7 ? tokens['--accent'] : tokens['--accent-2'];
      m.alpha = 0.32;
      m.x = Math.round(m.x / 44) * 44;   // on the glow-grid's own pitch
      m.y = anywhere ? r() * H : H + 20;
      break;
    case 'pixels':
      m.size = 3 + Math.round(r() * 2) * 2;
      m.vx = 0;
      m.vy = -10 - r() * 14;
      m.color = r() < 0.6 ? tokens['--accent'] : tokens['--accent-2'];
      m.alpha = 0.3;
      m.y = anywhere ? r() * H : H + 20;
      break;
    case 'rings':
      m.size = 3 + r() * 8;
      m.vx = (r() - 0.5) * 4;
      m.vy = -8 - r() * 10;
      m.color = r() < 0.6 ? tokens['--accent'] : tokens['--accent-2'];
      m.alpha = 0.22;
      m.y = anywhere ? r() * H : H + 20;
      break;
    case 'ink':
      m.size = 10 + r() * 30;
      m.vx = 0;
      m.vy = 0;
      m.color = r() < 0.7 ? tokens['--accent-2'] : tokens['--accent'];
      m.alpha = 0.07;
      m.life = anywhere ? r() : 0;
      break;
    default:
      break;
  }
  return m;
}

function stepMote(m, dt, t) {
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.life += dt * 0.25;
  switch (m.kind) {
    case 'petals':
      m.x += Math.sin(t * 0.9 + m.sway) * 12 * dt;
      m.spin += dt * 0.8;
      break;
    case 'snow':
      m.x += Math.sin(t * 0.6 + m.sway) * 8 * dt;
      break;
    case 'dust':
      m.x += Math.sin(t * 0.4 + m.sway) * 4 * dt;
      break;
    case 'fireflies':
      m.vx += (Math.random() - 0.5) * 30 * dt;
      m.vy += (Math.random() - 0.5) * 30 * dt;
      m.vx *= 0.98; m.vy *= 0.98;
      break;
    case 'ink':
      if (m.life > 1.6) Object.assign(m, makeMote(false), { y: Math.random() * H, life: 0 });
      break;
    default:
      break;
  }
  // wrap: a mote that leaves comes back in from the other side, so the
  // weather never thins out
  if (m.y < -40) { m.y = H + 20; m.x = Math.random() * W; }
  if (m.y > H + 40) { m.y = -20; m.x = Math.random() * W; }
  if (m.x < -40) m.x = W + 20;
  if (m.x > W + 40) m.x = -20;
}

function drawMote(m, t, lift) {
  const c = ctx;
  let a = m.alpha * lift;
  switch (m.kind) {
    case 'stars': {
      const tw = 0.55 + 0.45 * Math.sin(t * (0.7 + m.life) + m.sway * 5);
      a *= tw;
      c.fillStyle = hexA(m.color, a);
      c.beginPath(); c.arc(m.x, m.y, m.size, 0, Math.PI * 2); c.fill();
      if (m.size > 1.6) {
        // four-point sparkle on the bigger ones
        c.strokeStyle = hexA(m.color, a * 0.5);
        c.lineWidth = 0.6;
        const s = m.size * 3.2;
        c.beginPath();
        c.moveTo(m.x - s, m.y); c.lineTo(m.x + s, m.y);
        c.moveTo(m.x, m.y - s); c.lineTo(m.x, m.y + s);
        c.stroke();
      }
      return;
    }
    case 'fireflies': {
      const bl = Math.max(0, Math.sin(t * 1.7 + m.sway * 3));
      a *= bl * bl;
      if (a < 0.01) return;
      const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 5);
      g.addColorStop(0, hexA(m.color, a));
      g.addColorStop(0.35, hexA(m.color, a * 0.35));
      g.addColorStop(1, hexA(m.color, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(m.x, m.y, m.size * 5, 0, Math.PI * 2); c.fill();
      return;
    }
    case 'embers': {
      a *= 0.6 + 0.4 * Math.sin(t * 6 + m.sway * 4);
      const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.size * 3);
      g.addColorStop(0, hexA(m.color, a));
      g.addColorStop(1, hexA(m.color, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(m.x, m.y, m.size * 3, 0, Math.PI * 2); c.fill();
      return;
    }
    case 'petals': {
      c.save();
      c.translate(m.x, m.y);
      c.rotate(m.spin);
      c.fillStyle = hexA(m.color, a);
      c.beginPath();
      c.ellipse(0, 0, m.size, m.size * 0.55, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      return;
    }
    case 'sparks': {
      c.strokeStyle = hexA(m.color, a);
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(m.x, m.y); c.lineTo(m.x, m.y + m.size); c.stroke();
      return;
    }
    case 'pixels': {
      c.fillStyle = hexA(m.color, a);
      c.fillRect(Math.round(m.x), Math.round(m.y), m.size, m.size);
      return;
    }
    case 'rings': {
      c.strokeStyle = hexA(m.color, a);
      c.lineWidth = 1;
      c.beginPath(); c.arc(m.x, m.y, m.size, 0, Math.PI * 2); c.stroke();
      return;
    }
    case 'ink': {
      const p = Math.min(1, m.life / 1.6);
      const r = m.size * (0.4 + p * 0.6);
      const g = c.createRadialGradient(m.x, m.y, 0, m.x, m.y, r);
      g.addColorStop(0, hexA(m.color, a * (1 - p) * 1.4));
      g.addColorStop(0.6, hexA(m.color, a * (1 - p)));
      g.addColorStop(1, hexA(m.color, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(m.x, m.y, r, 0, Math.PI * 2); c.fill();
      return;
    }
    default: { // dust, snow
      c.fillStyle = hexA(m.color, a);
      c.beginPath(); c.arc(m.x, m.y, m.size, 0, Math.PI * 2); c.fill();
    }
  }
}

// =====================================================================
// Marks — what an answer leaves behind
// =====================================================================

/**
 * A ring and a bloom from the point of the tap, in the option's colour.
 * The ring is the gesture; the bloom is the sky taking the colour on.
 */
export function ripple(x, y, color) {
  if (!ready()) return;
  const c = color || tokens['--accent'];
  // one soft ring and one soft bloom — the tap, and the sky taking the
  // colour on. Nothing scatters: a burst of sparks is a slot machine.
  marks.push({ kind: 'ring', x, y, color: c, age: 0, ttl: 1.0, r0: 8, r1: Math.max(W, H) * 0.5 });
  marks.push({ kind: 'bloom', x, y, color: c, age: 0, ttl: 1.6, r: Math.max(W, H) * 0.45 });
  trim();
  start();
}

/**
 * The sky leans toward a colour — the hue of the answer currently chosen.
 * Held as CSS so it composites; the canvas only ever paints the transients.
 */
export function tint(color) {
  if (!mood) return;
  mood.style.setProperty('--mood', color || tokens['--accent']);
  mood.classList.add('is-lit');
  clearTimeout(moodTimer);
}

/** Let the sky settle back to the theme's own light. */
export function untint(after = 0) {
  if (!mood) return;
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => mood.classList.remove('is-lit'), after);
}

/**
 * A slider's position as light. `t` is 0..1 across the screen; the glow
 * follows the thumb and carries the colour the position means (a scale's
 * low end is accent-2, its high end accent — the same ramp the projector
 * paints the distribution in).
 */
export function lean(t, color, y) {
  if (!ready()) return;
  const k = Math.min(1, Math.max(0, Number(t) || 0));
  leanTo = {
    t: k,
    color: color || mixColor(tokens['--accent-2'], tokens['--accent'], k),
    y: y ?? H * 0.55,
    alpha: 1,
  };
  if (!leanNow) leanNow = { ...leanTo, alpha: 0 };
  start();
}

/** The slider was let go — the light stays where it was left, then fades. */
export function unlean() {
  if (leanTo) leanTo = { ...leanTo, alpha: 0 };
}

/**
 * The answer leaves the phone. A comet rises from the button and out of
 * the top of the screen; a short word answer rises as the word itself.
 */
export function send(color, fromY, word) {
  if (!ready()) return;
  const c = color || tokens['--accent'];
  const x = W / 2;
  const y = fromY ?? H * 0.8;
  // one mote of light rises off the button and is gone — no trail, no
  // flash. A word answer rises as the word, which is the one thing here
  // worth the room's eye: it is about to join the cloud on the wall.
  marks.push({ kind: 'mote', x, y, color: c, age: 0, ttl: 1.3 });
  if (word) {
    marks.push({
      kind: 'word', x, y: y - 24, color: c, age: 0, ttl: 1.7, text: String(word).slice(0, 28),
    });
  }
  trim();
  start();
}

/** The room's results have arrived on this phone: light from above. */
export function arrive(color) {
  if (!ready()) return;
  marks.push({ kind: 'dawn', color: color || tokens['--accent'], age: 0, ttl: 1.6 });
  start();
}

/** The wrap. Everything that was drifting up now falls, slowly, in colour. */
export function finale() {
  if (!ready()) return;
  const cols = [tokens['--accent'], tokens['--accent-2'], tokens['--good']];
  for (let i = 0; i < 46; i += 1) {
    marks.push({
      kind: 'confetti',
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.6,
      vx: (Math.random() - 0.5) * 30,
      vy: 40 + Math.random() * 60,
      color: cols[i % cols.length],
      size: 3 + Math.random() * 4,
      spin: Math.random() * Math.PI * 2,
      age: 0,
      ttl: 6 + Math.random() * 4,
    });
  }
  tint(tokens['--accent']);
  start();
}

/** True while there is a canvas to draw on and the OS allows motion. */
function ready() {
  return !!(ctx && host && !host.classList.contains('is-off') && !prefersReducedMotion());
}

function trim() {
  while (marks.length > MAX_PARTICLES) marks.shift();
}

// =====================================================================
// The loop
// =====================================================================

function start() {
  if (running || !ctx || prefersReducedMotion()) return;
  if (host?.classList.contains('is-off')) return;
  running = true;
  lastT = 0;
  onFrame(tick);
}

function tick(dt) {
  frameNo += 1;
  const t = performance.now() / 1000;
  const busy = marks.length > 0 || (leanTo && (leanNow?.alpha > 0.01 || leanTo.alpha > 0));

  // weather alone runs at half rate — it is slow by design and nobody
  // can see the difference, but a phone's battery can
  if (!busy && frameNo % 2) return true;
  const step = busy ? dt : dt * 2;

  if (document.visibilityState === 'hidden') { running = false; return false; }

  ctx.clearRect(0, 0, W, H);

  // ---- lean light
  if (leanTo) {
    if (!leanNow) leanNow = { ...leanTo, alpha: 0 };
    const k = 1 - Math.exp(-step * 7);
    leanNow.t += (leanTo.t - leanNow.t) * k;
    leanNow.alpha += (leanTo.alpha - leanNow.alpha) * (leanTo.alpha ? k : 1 - Math.exp(-step * 1.6));
    leanNow.color = leanTo.color;
    leanNow.y = leanTo.y;
    if (leanNow.alpha > 0.005) {
      const x = leanNow.t * W;
      const r = Math.max(W, H) * 0.42;
      const g = ctx.createRadialGradient(x, leanNow.y, 0, x, leanNow.y, r);
      const a = (theme.dark ? 0.26 : 0.18) * leanNow.alpha;
      g.addColorStop(0, hexA(toHex(leanNow.color), a));
      g.addColorStop(0.5, hexA(toHex(leanNow.color), a * 0.35));
      g.addColorStop(1, hexA(toHex(leanNow.color), 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (!leanTo.alpha) {
      leanTo = null; leanNow = null;
    }
  }

  // ---- weather
  const lift = 1;
  for (const m of motes) {
    stepMote(m, step, t);
    drawMote(m, t, lift);
  }

  // ---- marks
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const k = marks[i];
    k.age += step;
    if (k.age >= k.ttl) { marks.splice(i, 1); continue; }
    drawMark(k, step);
  }

  const still = marks.length === 0 && !leanTo;
  if (still && motes.length === 0) { running = false; return false; }
  return true;
}

function drawMark(k, dt) {
  const c = ctx;
  const p = k.age / k.ttl;
  const eo = 1 - Math.pow(1 - p, 3);          // ease-out
  const col = toHex(k.color);
  const dark = theme.dark;

  switch (k.kind) {
    case 'ring': {
      const r = k.r0 + (k.r1 - k.r0) * eo;
      c.strokeStyle = hexA(col, (dark ? 0.32 : 0.22) * (1 - p));
      c.lineWidth = 1.4 * (1 - p) + 0.5;
      c.beginPath(); c.arc(k.x, k.y, r, 0, Math.PI * 2); c.stroke();
      return;
    }
    case 'bloom': {
      const a = (dark ? 0.22 : 0.14) * Math.sin(Math.PI * Math.min(1, p * 1.05));
      const g = c.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.r * (0.5 + eo * 0.5));
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(0.45, hexA(col, a * 0.4));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      return;
    }
    case 'spark': {
      k.vy += 90 * dt;                     // a little gravity
      k.x += k.vx * dt; k.y += k.vy * dt;
      c.fillStyle = hexA(col, 0.9 * (1 - p));
      c.beginPath(); c.arc(k.x, k.y, k.size * (1 - p * 0.5), 0, Math.PI * 2); c.fill();
      return;
    }
    case 'mote': {
      // rises with an ease-in — leaves slowly, then is simply gone
      const ei = p * p * (3 - 2 * p);
      const y = k.y - (k.y + 60) * ei;
      const a = (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8) * 0.7;
      const g = c.createRadialGradient(k.x, y, 0, k.x, y, 22);
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(0.4, hexA(col, a * 0.4));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.beginPath(); c.arc(k.x, y, 22, 0, Math.PI * 2); c.fill();
      return;
    }
    case 'word': {
      const y = k.y - 160 * eo;
      const a = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
      c.save();
      c.font = `600 ${Math.round(Math.min(34, 20 + 14 * (1 - p)))}px ${tokens['--display'] || 'serif'}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = hexA(toHex(dark ? '#ffffff' : tokens['--ink']), a * 0.95);
      c.shadowColor = hexA(col, a * 0.5);
      c.shadowBlur = 12;
      c.fillText(k.text, k.x, y);
      c.restore();
      return;
    }
    case 'wash': {
      const a = (dark ? 0.16 : 0.12) * Math.sin(Math.PI * p);
      const g = c.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      return;
    }
    case 'dawn': {
      const a = (dark ? 0.22 : 0.16) * Math.sin(Math.PI * p);
      const g = c.createLinearGradient(0, 0, 0, H * 0.8);
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(1, hexA(col, 0));
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      return;
    }
    case 'confetti': {
      k.x += k.vx * dt + Math.sin(k.age * 2 + k.spin) * 20 * dt;
      k.y += k.vy * dt;
      k.spin += dt * 2.4;
      if (k.y > H + 20) { k.age = k.ttl; return; }
      c.save();
      c.translate(k.x, k.y);
      c.rotate(k.spin);
      c.fillStyle = hexA(col, 0.85 * Math.min(1, (1 - p) * 3));
      c.fillRect(-k.size / 2, -k.size / 4, k.size, k.size / 2);
      c.restore();
      return;
    }
    default:
      break;
  }
}

/** rgb()/#rgb → #rrggbb, because hexA() reads hex only. */
function toHex(color) {
  const s = String(color || '').trim();
  if (s.startsWith('#') && s.length === 7) return s;
  const [r, g, b] = toRGB(s);
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}
