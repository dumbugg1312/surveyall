/**
 * SurveyAll — result rendering.
 *
 * Design rules this file follows, in priority order:
 *
 * 1. NOTHING JUMPS. Every number, width, position and font size is a
 *    spring (see motion.js). When a vote lands mid-flight the bar keeps
 *    its velocity and curves to the new value — it never restarts.
 * 2. DOM IS REUSED, NEVER REBUILT. Rows are keyed by index and updated in
 *    place. Rebuilding is what makes live charts flicker.
 * 3. ONE FRAME, ONE WRITE. Renderers set spring targets; a single shared
 *    rAF applies styles. Reading layout (offsetWidth) is batched away
 *    from writing, so 60 arriving responses don't thrash layout.
 * 4. COLOUR COMES FROM THE THEME, IN OKLAB. Series colours walk hue at
 *    constant perceptual lightness so no swatch is visually louder than
 *    its neighbours on a projector.
 * 5. TYPE IS DATA. Tabular numerals everywhere digits change, so numbers
 *    don't shimmy as they count.
 */

import {
  SpringGroup, PRESETS, stagger, delay, prefersReducedMotion,
  rgba, mixColor, harmonicSeries, readableOn, luminance,
} from './motion.js';

const NUM = new Intl.NumberFormat();

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function token(root, name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Per-container chart state. Switching chart kind tears the old one down
 * (including its springs) so stale nodes can never be reinterpreted.
 */
function useChart(container, kind) {
  if (container.__chart && container.__chart.kind === kind) return container.__chart;
  container.__chart?.group?.destroy();
  container.textContent = '';
  container.dataset.chart = kind;
  container.__chart = { kind, group: null, rows: [], meta: {} };
  return container.__chart;
}

/**
 * Colour policy.
 *
 * `categorical` — a perceptually even walk from accent to accent-2, used
 *   ONLY where marks touch and must be told apart: donut segments and
 *   word-cloud words.
 *
 * `uniform` — every bar the same accent. Deliberate: in a poll, bar
 *   LENGTH already encodes the answer, so giving each option its own hue
 *   implies a meaning that doesn't exist and drags the middle of the
 *   ramp through muddy blue-brown mixtures. One colour, varying length,
 *   reads as designed rather than decorated — and it keeps the quiz
 *   reveal legible, where green/dimmed has to be the only colour signal.
 */
const paletteCache = new Map();

function palette(root, count, mode = 'categorical') {
  const a = token(root, '--accent', '#1d4ed8');
  const b = token(root, '--accent-2', '#b45309');
  const key = `${mode}|${a}|${b}|${count}`;
  let p = paletteCache.get(key);
  if (!p) {
    p = mode === 'uniform'
      ? new Array(Math.max(1, count)).fill(a)
      : harmonicSeries(a, b, Math.max(1, count));
    paletteCache.set(key, p);
  }
  return p;
}

// =====================================================================
// Multiple choice / quiz — bars, columns, donut
// =====================================================================

export function renderChoice(container, agg, opts = {}) {
  const style = opts.style === 'donut' ? 'donut'
    : opts.style === 'columns' ? 'columns' : 'bars';
  if (style === 'donut') return renderDonut(container, agg, opts);

  const state = useChart(container, style);
  const root = container;
  const n = agg.options.length;
  const colors = palette(root, n, 'uniform');
  const correct = new Set(opts.revealCorrect ? (agg.correct || []) : []);
  const max = Math.max(1, ...agg.options.map((o) => o.count));
  const isNew = !state.group;

  if (isNew) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
  }

  // ---- structure (built once, then reused) --------------------------
  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'chart-row');

    const label = el('div', 'chart-label');
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    const sheen = el('div', 'chart-sheen');
    fill.append(sheen);
    track.append(fill);

    const value = el('div', 'chart-value');
    const pct = el('span', 'chart-pct');
    const count = el('span', 'chart-count');
    value.append(pct, count);

    row.append(label, track, value);
    container.append(row);
    state.rows.push({ row, label, track, fill, value, pct, count });

    // entrance: rise and grow, staggered down the list
    if (isNew) {
      state.group.set(`in:${i}`, 1, { from: 0, preset: 'smooth' });
    } else {
      state.group.snap(`in:${i}`, 1);
    }
  }
  while (state.rows.length > n) {
    const dead = state.rows.pop();
    dead.row.remove();
  }

  // ---- targets ------------------------------------------------------
  agg.options.forEach((opt, i) => {
    const r = state.rows[i];
    if (r.label.textContent !== (opt.label || `Option ${i + 1}`)) {
      r.label.textContent = opt.label || `Option ${i + 1}`;
    }

    const fraction = opts.hidden ? 0 : (max ? opt.count / max : 0);
    state.group.set(`w:${i}`, fraction);
    state.group.set(`c:${i}`, opts.hidden ? 0 : opt.count, { preset: 'precise' });
    state.group.set(`p:${i}`, opts.hidden ? 0 : opt.pct, { preset: 'precise' });

    // dim the wrong answers once the key is revealed
    const dim = correct.size && !correct.has(i);
    state.group.set(`dim:${i}`, dim ? 1 : 0);
    r.row.classList.toggle('is-correct', correct.has(i));
  });

  state.meta = { colors, correct, showPercent: opts.showPercent !== false, hidden: opts.hidden, root };
  state.group.prune(new Set([
    ...agg.options.flatMap((_, i) => [`w:${i}`, `c:${i}`, `p:${i}`, `dim:${i}`, `in:${i}`]),
  ]));

  // ---- one write per frame ------------------------------------------
  function paint() {
    const g = state.group;
    const good = token(root, '--good', '#15803d');
    const ink = token(root, '--ink', '#111');

    state.rows.forEach((r, i) => {
      const enter = g.get(`in:${i}`, 1);
      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      const dim = g.get(`dim:${i}`);

      r.row.style.opacity = String(enter);
      r.row.style.transform = enter < 0.999
        ? `translateY(${(1 - enter) * 10}px)` : '';

      // clamped: `enter` must never inflate the encoded length
      r.fill.style.setProperty('--bar-size', `${w * Math.min(1, enter)}%`);

      const base = state.meta.correct.size && state.meta.correct.has(i)
        ? good
        : state.meta.colors[i] || state.meta.colors[0];
      const shown = dim > 0 ? mixColor(base, rgba(ink, 1), dim * 0.72) : base;

      // A flat fill reads as a placeholder; the gradient plus the sheen
      // strip along the top edge is what gives the bar a lit surface.
      r.fill.style.background =
        `linear-gradient(180deg, ${mixColor(shown, '#ffffff', 0.10)} 0%, ${shown} 52%, ${mixColor(shown, '#000000', 0.06)} 100%)`;
      r.fill.style.opacity = String(1 - dim * 0.35);
      r.fill.style.boxShadow = w > 0.5
        ? `0 1px 2px ${rgba(ink, 0.10)}, 0 6px 16px ${rgba(shown, 0.26)}`
        : 'none';

      const pctVal = g.get(`p:${i}`);
      const cntVal = g.get(`c:${i}`);
      const pctText = state.meta.hidden ? '—' : `${Math.round(pctVal)}%`;
      const cntText = state.meta.hidden ? '' : NUM.format(Math.round(cntVal));
      if (r.pct.textContent !== pctText) r.pct.textContent = pctText;
      if (r.count.textContent !== cntText) r.count.textContent = cntText;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// ---------------------------------------------------------------- donut

function renderDonut(container, agg, opts = {}) {
  const state = useChart(container, 'donut');
  const root = container;
  const n = agg.options.length;
  const colors = palette(root, n);
  const total = agg.total || 0;
  const R = 15.9155; // circumference = 100 → dasharray in percent units

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.gentle);

    const wrap = el('div', 'donut-wrap');
    const s = svg('svg', { class: 'donut', viewBox: '0 0 42 42', role: 'img' });
    const track = svg('circle', {
      cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 5.4,
    });
    s.append(track);
    const arcs = [];
    const center = el('div', 'donut-center');
    const cnum = el('div', 'donut-total');
    const clabel = el('div', 'donut-total-label', 'responses');
    center.append(cnum, clabel);
    wrap.append(s, center);

    const legend = el('div', 'donut-legend');
    container.append(wrap, legend);
    state.meta = { s, track, arcs, legend, cnum, items: [] };
  }

  const { s, track, arcs, legend } = state.meta;

  while (arcs.length < n) {
    const arc = svg('circle', {
      cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 5.4,
      'stroke-linecap': 'round',
    });
    s.append(arc);
    arcs.push(arc);

    const item = el('div', 'donut-item');
    const dot = el('span', 'donut-dot');
    const name = el('span', 'donut-name');
    const num = el('span', 'donut-num');
    item.append(dot, name, num);
    legend.append(item);
    state.meta.items.push({ item, dot, name, num });
  }
  while (arcs.length > n) { arcs.pop().remove(); state.meta.items.pop().item.remove(); }

  agg.options.forEach((opt, i) => {
    state.meta.items[i].name.textContent = opt.label || `Option ${i + 1}`;
    state.group.set(`a:${i}`, opts.hidden || !total ? 0 : (opt.count / total) * 100);
    state.group.set(`p:${i}`, opts.hidden ? 0 : opt.pct, { preset: 'precise' });
  });
  state.group.set('total', opts.hidden ? 0 : total, { preset: 'precise' });

  function paint() {
    const g = state.group;
    const ink = token(root, '--ink', '#111');
    track.setAttribute('stroke', rgba(ink, 0.08));

    let offset = 25; // start the first arc at 12 o'clock
    arcs.forEach((arc, i) => {
      const pct = Math.max(0, g.get(`a:${i}`));
      arc.setAttribute('stroke', colors[i] || colors[0]);
      arc.setAttribute('stroke-dasharray', `${pct} ${Math.max(0, 100 - pct)}`);
      arc.setAttribute('stroke-dashoffset', String(offset));
      arc.style.opacity = pct > 0.01 ? '1' : '0';
      offset -= pct;

      const v = g.get(`p:${i}`);
      const txt = opts.hidden ? '—' : `${Math.round(v)}%`;
      const it = state.meta.items[i];
      if (it.num.textContent !== txt) it.num.textContent = txt;
      it.dot.style.background = colors[i] || colors[0];
    });

    const t = Math.round(g.get('total'));
    if (state.meta.cnum.textContent !== String(t)) state.meta.cnum.textContent = String(t);
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Word cloud
//
// Archimedean-spiral placement with axis-aligned bounding-box collision,
// the same family of algorithm as d3-cloud. Two things matter for looks:
//
//  • Area, not height, should encode frequency. Scaling font-size
//    linearly with count makes the top word tower absurdly over the rest,
//    so the scale is sqrt-based and clamped to a ratio.
//  • The cloud must FIT. Earlier this stacked words on a fallback
//    position when the spiral ran out of room. Now it searches for a
//    scale that fits (arithmetically, from one measurement pass) and only
//    drops the least frequent words if even the minimum scale fails.
// =====================================================================

export function renderWordCloud(container, agg, opts = {}) {
  const state = useChart(container, 'cloud');
  const root = container;

  const words = (agg.words || []).slice(0, 80);
  if (opts.hidden || !words.length) {
    if (!state.meta.empty) {
      container.textContent = '';
      state.meta.empty = el('p', 'chart-empty',
        opts.hidden ? 'Responses hidden' : 'Waiting for the first word…');
      container.append(state.meta.empty);
      state.nodes = new Map();
    }
    return;
  }
  if (state.meta.empty) { state.meta.empty.remove(); state.meta.empty = null; }

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.gentle);
    state.nodes = new Map();
  }

  const rect = container.getBoundingClientRect();
  const W = Math.max(280, rect.width || 900);
  const H = Math.max(200, rect.height || 500);

  const maxCount = words[0].count;
  const minCount = words[words.length - 1].count;
  const family = token(root, '--display', 'serif');
  const colors = palette(root, 6);

  // Ratio-clamped sqrt scale: the biggest word is at most 3.4x the
  // smallest, which keeps a runaway first answer from eating the canvas.
  const bigSize = Math.min(H * 0.30, W * 0.19, 150);
  const smallSize = Math.max(14, bigSize / 3.4);
  const sizeFor = (count) => {
    if (maxCount === minCount) return bigSize * 0.66;
    const t = Math.sqrt((count - minCount) / (maxCount - minCount));
    return smallSize + (bigSize - smallSize) * t;
  };

  // ---- pass 1: ensure a node per word; type only, no sizing yet -------
  const seen = new Set();
  const entries = words.map((entry, i) => {
    let node = state.nodes.get(entry.word);
    const size = sizeFor(entry.count);
    const weight = entry.count === maxCount ? 700 : (size > bigSize * 0.55 ? 650 : 550);

    if (!node) {
      node = el('span', 'cloud-word', entry.word);
      node.dataset.word = entry.word;
      container.append(node);
      state.nodes.set(entry.word, node);
      // new words fly in from nothing at the centre
      state.group.set(`s:${entry.word}`, 1, { from: 0, preset: 'bouncy' });
      state.group.snap(`x:${entry.word}`, W / 2);
      state.group.snap(`y:${entry.word}`, H / 2);
    } else {
      state.group.set(`s:${entry.word}`, 1);
    }

    node.style.fontFamily = family;
    node.style.fontWeight = String(weight);
    node.style.color = colors[i % colors.length];
    node.title = `${entry.word} — ${entry.count}`;
    node.setAttribute('aria-label',
      `${entry.word}, ${entry.count} ${entry.count === 1 ? 'mention' : 'mentions'}`);
    seen.add(entry.word);
    return { entry, node, size };
  });

  /**
   * Relayout policy.
   *
   * Re-running the spiral on every incoming vote makes the cloud twitch
   * continuously: a single answer nudges one size, which cascades into
   * new positions for everything. So the layout only re-runs when it has
   * a reason to, and never more than a few times a second. Between runs,
   * sizes stay pinned to the last laid-out values so type and position
   * always agree — a word is never drawn at a size the layout didn't
   * account for, which is what would cause overlap.
   */
  const layoutKey = words.map((w) => `${w.word}:${sizeFor(w.count).toFixed(0)}`).join('');
  const now = performance.now();
  const sinceLast = now - (state.meta.lastLayoutAt || -1e9);
  const resized = W !== state.meta.W || H !== state.meta.H;
  const changed = layoutKey !== state.meta.layoutKey;

  // A word with no position yet is parked at the centre, on top of
  // everything else. That must never wait for the throttle window — a
  // brand-new answer appearing is exactly when the room is watching the
  // screen. Only pure re-scaling (existing words changing size as counts
  // shift) is worth deferring, because that's the jittery part.
  const unplaced = words.some((w) => !state.meta.positioned?.has(w.word));

  const RELAYOUT_MS = 400;
  const shouldLayout = resized || unplaced || !state.meta.layoutKey
    || (changed && sinceLast >= RELAYOUT_MS);

  if (shouldLayout) {
    runLayout();
  } else if (changed) {
    // Something moved but we're inside the throttle window — make sure a
    // final layout still happens once the votes stop arriving, otherwise
    // the cloud would freeze mid-update.
    clearTimeout(state.meta.trailing);
    state.meta.trailing = setTimeout(() => {
      if (container.__chart === state && state.nodes.size) {
        renderWordCloud(container, agg, opts);
      }
    }, RELAYOUT_MS);
  }

  function runLayout() {
    clearTimeout(state.meta.trailing);
    state.meta.lastLayoutAt = now;
    state.meta.layoutKey = layoutKey;
    state.meta.W = W;
    state.meta.H = H;

    /**
     * Measure the words at the size they will actually be drawn at.
     *
     * Scaling a measurement taken at some other size is not safe: glyph
     * advance widths do not scale perfectly linearly with font-size once
     * hinting and kerning are involved, and the few pixels of error that
     * introduces are enough for two words to clip each other. Measuring
     * at the real size costs one forced layout per attempt, which is fine
     * because relayout is throttled to a few times a second.
     */
    const measureAt = (s) => {
      entries.forEach((e) => { e.node.style.fontSize = `${e.size * s}px`; });
      return entries.map((e) => ({
        entry: e.entry,
        node: e.node,
        size: e.size,
        w: e.node.offsetWidth + 14,
        h: e.node.offsetHeight + 6,
      }));
    };

    // Shrink until the whole cloud fits. d3-cloud silently DROPS words it
    // can't place and never rescales; in a classroom that means someone's
    // answer vanishing with no explanation, so rescale first and only
    // drop as a genuine last resort.
    let scale = 1;
    let measured = measureAt(scale);
    let layout = tryLayout(measured, 1, W, H, false);
    for (let attempt = 0; attempt < 10 && !layout; attempt += 1) {
      const next = scale * 0.88;
      if (smallSize * next < 11) break;
      scale = next;
      measured = measureAt(scale);
      layout = tryLayout(measured, 1, W, H, false);
    }
    if (!layout) layout = tryLayout(measured, 1, W, H, true);

    state.meta.scale = scale;
    const positioned = new Set();

    measured.forEach((m, i) => {
      const pos = layout[i];
      if (!pos) {
        state.group.set(`s:${m.entry.word}`, 0);
        seen.delete(m.entry.word);
        return;
      }
      // font-size is already applied by measureAt() at exactly this scale
      state.group.set(`x:${m.entry.word}`, pos.x);
      state.group.set(`y:${m.entry.word}`, pos.y);
      positioned.add(m.entry.word);
    });

    state.meta.positioned = positioned;
  }

  // Words no longer in the cloud shrink away, then are removed.
  state.nodes.forEach((node, word) => {
    if (seen.has(word)) return;
    state.group.set(`s:${word}`, 0);
    delay(0.4, () => {
      // Re-check on arrival rather than trusting the decision made 400ms
      // ago: in a live session a word can drop out of the top 80 and be
      // voted straight back in before this fires. The spring's target is
      // the authority — if something has since asked for it to be
      // visible again, leave it alone.
      const s = state.group.springs.get(`s:${word}`);
      if (s && s.target > 0) return;
      if (state.nodes.get(word) !== node) return;

      node.remove();
      state.nodes.delete(word);
      // Drop the springs too. A 90-minute class can cycle through a lot
      // of one-off answers, and keeping a spring per word forever is a
      // slow leak.
      state.group.forget(`s:${word}`);
      state.group.forget(`x:${word}`);
      state.group.forget(`y:${word}`);
      state.meta.positioned?.delete(word);
    });
  });

  function paint() {
    const g = state.group;
    state.nodes.forEach((node, word) => {
      const s = Math.max(0, g.get(`s:${word}`, 1));
      const x = g.get(`x:${word}`);
      const y = g.get(`y:${word}`);
      node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
      node.style.opacity = String(Math.min(1, s * 1.35));
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

function tryLayout(measured, scale, W, H, allowDrop) {
  const placed = [];
  const out = [];
  for (const m of measured) {
    const w = m.w * scale;
    const h = m.h * scale;
    const pos = spiralPlace(placed, W, H, w, h);
    if (!pos) {
      if (!allowDrop) return null;
      out.push(null);
      continue;
    }
    placed.push({ x: pos.x, y: pos.y, w, h });
    out.push(pos);
  }
  return out;
}

/**
 * Walk an Archimedean spiral outward from the centre, returning the first
 * position where this box touches nothing already placed.
 * The 1.75 x-stretch matches the aspect of a projector slide, so the
 * cloud fills a wide box instead of forming a circle in the middle.
 * @returns {{x:number,y:number}|null}
 */
function spiralPlace(placed, W, H, w, h) {
  if (w > W - 8 || h > H - 8) return null;
  const cx = W / 2 - w / 2;
  const cy = H / 2 - h / 2;
  for (let t = 0; t < 3200; t += 1) {
    const angle = t * 0.30;
    const radius = angle * 0.95;
    const x = cx + radius * Math.cos(angle) * 1.75;
    const y = cy + radius * Math.sin(angle);
    if (x < 4 || y < 4 || x + w > W - 4 || y + h > H - 4) continue;
    let hit = false;
    for (const p of placed) {
      if (x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y) { hit = true; break; }
    }
    if (!hit) return { x, y };
  }
  return null;
}

// =====================================================================
// Open ended — cards
// =====================================================================

export function renderOpenEnded(container, agg, opts = {}) {
  const state = useChart(container, 'cards');
  const entries = opts.hidden ? [] : (agg.entries || []);

  if (!entries.length) {
    container.textContent = '';
    container.append(el('p', 'chart-empty',
      opts.hidden ? 'Responses hidden' : 'Waiting for responses…'));
    state.rows = [];
    return;
  }
  container.querySelectorAll('.chart-empty').forEach((n) => n.remove());

  const root = container;
  const colors = palette(root, 5);

  while (state.rows.length < entries.length) {
    const i = state.rows.length;
    const card = el('div', 'answer-card');
    const rail = el('span', 'answer-rail');
    const text = el('p', 'answer-text');
    const actions = el('div', 'answer-actions');
    const del = el('button', 'answer-delete', '×');
    del.type = 'button';
    del.title = 'Remove this response';
    del.setAttribute('aria-label', 'Remove this response');
    actions.append(del);
    card.append(rail, text, actions);
    container.append(card);
    state.rows.push({ card, rail, text });

    // newest card arrives with a lift; older ones stay put
    if (!prefersReducedMotion()) {
      card.animate(
        [
          { opacity: 0, transform: 'translateY(14px) scale(.97)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 460, easing: 'cubic-bezier(.22,.9,.28,1)', delay: stagger(i, 0.03, 0.3) * 1000, fill: 'backwards' },
      );
    }
  }
  while (state.rows.length > entries.length) state.rows.pop().card.remove();

  entries.forEach((entry, i) => {
    const r = state.rows[i];
    if (r.text.textContent !== entry.text) r.text.textContent = entry.text;
    r.card.dataset.index = String(i);
    // long answers step down a size so a wall of text still fits the slide
    const len = entry.text.length;
    r.card.style.setProperty('--card-scale',
      len > 220 ? '0.74' : len > 140 ? '0.84' : len > 70 ? '0.94' : '1');
    r.rail.style.background = colors[i % colors.length];
  });
}

// =====================================================================
// Scales
// =====================================================================

export function renderScales(container, agg, opts = {}) {
  const state = useChart(container, 'scales');
  const root = container;
  const { min, max } = agg;
  const span = Math.max(1, max - min);
  const steps = Math.round(span) + 1;
  const n = agg.statements.length;
  const isNew = !state.group;

  if (isNew) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'scale-row');
    const label = el('div', 'scale-label');
    const track = el('div', 'scale-track');
    const dist = el('div', 'scale-dist');
    const marker = el('div', 'scale-marker');
    const halo = el('span', 'scale-halo');
    marker.append(halo);
    track.append(dist, marker);
    const avg = el('div', 'scale-avg');
    row.append(label, track, avg);
    container.append(row);

    const ticks = [];
    for (let v = 0; v < steps; v += 1) {
      const tick = el('span', 'scale-tick');
      dist.append(tick);
      ticks.push(tick);
    }
    state.rows.push({ row, label, dist, marker, avg, ticks });
    state.group.set(`in:${i}`, 1, isNew ? { from: 0, preset: 'smooth' } : {});
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  agg.statements.forEach((st, i) => {
    const r = state.rows[i];
    if (r.label.textContent !== st.label) r.label.textContent = st.label;
    const peak = Math.max(1, ...Object.values(st.dist || {}));
    for (let k = 0; k < steps; k += 1) {
      const c = (st.dist || {})[min + k] || 0;
      state.group.set(`t:${i}:${k}`, opts.hidden ? 0 : c / peak);
    }
    const hasAvg = st.avg != null && !opts.hidden;
    state.group.set(`m:${i}`, hasAvg ? (st.avg - min) / span : 0);
    state.group.set(`o:${i}`, hasAvg ? 1 : 0);
    state.group.set(`v:${i}`, hasAvg ? st.avg : 0, { preset: 'precise' });
  });

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    state.rows.forEach((r, i) => {
      const enter = g.get(`in:${i}`, 1);
      r.row.style.opacity = String(enter);

      r.ticks.forEach((tick, k) => {
        const hgt = Math.max(0, g.get(`t:${i}:${k}`)) * 100;
        tick.style.left = `${(k / Math.max(1, steps - 1)) * 100}%`;
        tick.style.height = `${hgt * enter}%`;
        tick.style.background = `linear-gradient(180deg, ${rgba(accent, 0.62)}, ${rgba(accent, 0.30)})`;
      });

      const pos = g.get(`m:${i}`) * 100;
      const op = g.get(`o:${i}`);
      r.marker.style.left = `${pos}%`;
      r.marker.style.opacity = String(op);
      r.marker.style.background = accent;
      r.marker.style.boxShadow = `0 0 0 .28em ${rgba(accent, 0.20)}, 0 2px 8px ${rgba(accent, 0.45)}`;

      const v = g.get(`v:${i}`);
      const txt = op > 0.5 ? v.toFixed(1) : '—';
      if (r.avg.textContent !== txt) r.avg.textContent = txt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Ranking — rows physically swap places as the order changes
// =====================================================================

export function renderRanking(container, agg, opts = {}) {
  const state = useChart(container, 'ranking');
  const root = container;
  const n = agg.items.length;
  const colors = palette(root, n, 'uniform');
  const maxPts = Math.max(1, ...agg.items.map((i) => i.points));
  const isNew = !state.group;

  if (isNew) state.group = new SpringGroup(() => state.paint?.(), PRESETS.bouncy);

  const ROW_H = 3.0; // em — must match .rank-row height in charts.css

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'rank-row');
    const place = el('div', 'rank-place');
    const label = el('div', 'rank-label');
    const track = el('div', 'rank-track');
    const fill = el('div', 'rank-fill');
    track.append(fill);
    const points = el('div', 'rank-points');
    row.append(place, label, track, points);
    container.append(row);
    state.rows.push({ row, place, label, track, fill, points });
    state.group.set(`y:${i}`, i, isNew ? { from: i } : {});
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  container.style.height = `${n * ROW_H}em`;

  agg.items.forEach((item, displayIndex) => {
    const r = state.rows[item.index];
    if (!r) return;
    if (r.label.textContent !== item.label) r.label.textContent = item.label;
    state.group.set(`y:${item.index}`, displayIndex);
    // group default is bouncy for row POSITION; the bar length is a
    // quantity, so it gets a critically-damped spring instead.
    state.group.set(`w:${item.index}`, opts.hidden ? 0 : item.points / maxPts, { preset: 'smooth' });
    state.group.set(`p:${item.index}`, opts.hidden ? 0 : item.points, { preset: 'precise' });
    state.group.set(`rank:${item.index}`, item.rank, { preset: 'precise' });
    r.__color = colors[displayIndex] || colors[0];
  });

  function paint() {
    const g = state.group;
    const ink = token(root, '--ink', '#111');
    state.rows.forEach((r, i) => {
      const y = g.get(`y:${i}`, i);
      r.row.style.transform = `translateY(${(y * ROW_H).toFixed(3)}em)`;

      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      const c = r.__color || token(root, '--accent', '#1d4ed8');
      r.fill.style.setProperty('--bar-size', `${w}%`);
      r.fill.style.background =
        `linear-gradient(180deg, ${mixColor(c, '#ffffff', 0.10)}, ${c} 58%, ${mixColor(c, '#000000', 0.05)})`;
      r.fill.style.boxShadow = w > 0.5 ? `0 4px 14px ${rgba(c, 0.28)}` : 'none';

      const rank = Math.round(g.get(`rank:${i}`, 1));
      const rankTxt = opts.hidden ? '–' : String(rank);
      if (r.place.textContent !== rankTxt) r.place.textContent = rankTxt;
      r.place.style.color = rank === 1 ? c : rgba(ink, 0.55);

      const pts = Math.round(g.get(`p:${i}`));
      const ptsTxt = opts.hidden ? '—' : NUM.format(pts);
      if (r.points.textContent !== ptsTxt) r.points.textContent = ptsTxt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Delta view (proposal P1)
// =====================================================================

export function renderDelta(container, delta) {
  const state = useChart(container, 'delta');

  if (!delta) {
    container.textContent = '';
    container.append(el('p', 'chart-empty',
      'Ask this question a second time to see what changed.'));
    state.rows = [];
    state.group?.destroy();
    state.group = null;
    state.meta = {};
    return;
  }

  const root = container;
  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const head = el('div', 'delta-head');
    head.append(
      el('span', 'delta-key delta-key-before', `First ask · ${delta.beforeTotal ?? 0}`),
      el('span', 'delta-key delta-key-after', `After discussion · ${delta.afterTotal ?? 0}`),
    );
    container.append(head);
    state.meta.head = head;
    state.meta.body = el('div', 'delta-body');
    container.append(state.meta.body);
  }

  const isScales = delta.type === 'scales';
  const items = isScales ? delta.statements : delta.options;
  const n = items.length;

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'delta-row');
    const label = el('div', 'chart-label');
    const track = el('div', 'delta-track');
    const before = el('div', isScales ? 'delta-dot delta-dot-before' : 'delta-bar delta-bar-before');
    const after = el('div', isScales ? 'delta-dot delta-dot-after' : 'delta-bar delta-bar-after');
    const link = el('div', 'delta-link');
    track.append(link, before, after);
    const num = el('div', 'delta-num');
    row.append(label, track, num);
    state.meta.body.append(row);
    state.rows.push({ row, label, track, before, after, link, num });
    state.group.set(`in:${i}`, 1, { from: 0, preset: 'smooth' });
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  const colors = palette(root, n, isScales ? 'categorical' : 'uniform');

  items.forEach((item, i) => {
    const r = state.rows[i];
    r.label.textContent = item.label || `Option ${i + 1}`;
    r.__color = colors[i] || colors[0];

    if (isScales) {
      const span = Math.max(1, delta.max - delta.min);
      state.group.set(`b:${i}`, item.beforeAvg == null ? 0 : (item.beforeAvg - delta.min) / span);
      state.group.set(`a:${i}`, item.afterAvg == null ? 0 : (item.afterAvg - delta.min) / span);
      state.group.set(`d:${i}`, item.deltaAvg ?? 0, { preset: 'precise' });
      r.__digits = 1;
      r.__suffix = '';
    } else {
      state.group.set(`b:${i}`, item.beforePct / 100);
      state.group.set(`a:${i}`, item.afterPct / 100);
      state.group.set(`d:${i}`, item.deltaPct, { preset: 'precise' });
      r.__digits = 0;
      r.__suffix = '%';
    }
  });

  if (state.meta.head) {
    state.meta.head.children[0].textContent = `First ask · ${delta.beforeTotal ?? 0}`;
    state.meta.head.children[1].textContent = `After discussion · ${delta.afterTotal ?? 0}`;
  }

  // "42% of the room changed their mind" — the sentence that makes the
  // whole re-ask feature land with a lecture theatre.
  if (Number.isFinite(delta.moved)) {
    if (!state.meta.summary) {
      state.meta.summary = el('p', 'delta-summary');
      container.append(state.meta.summary);
    }
    const pct = Math.round(delta.moved);
    state.meta.summary.textContent = pct > 0
      ? `${pct}% of the room changed their answer.`
      : 'Nobody changed their answer.';
  }

  function paint() {
    const g = state.group;
    const ink = token(root, '--ink', '#111');
    state.rows.forEach((r, i) => {
      const enter = g.get(`in:${i}`, 1);
      r.row.style.opacity = String(enter);
      r.row.style.transform = enter < 0.999 ? `translateY(${(1 - enter) * 8}px)` : '';

      const b = Math.max(0, g.get(`b:${i}`)) * 100;
      const a = Math.max(0, g.get(`a:${i}`)) * 100;
      const c = r.__color;

      if (isScales) {
        r.before.style.left = `${b}%`;
        r.after.style.left = `${a}%`;
        r.after.style.background = c;
        r.after.style.boxShadow = `0 0 0 .22em ${rgba(c, 0.22)}`;
        r.link.style.left = `${Math.min(a, b)}%`;
        r.link.style.width = `${Math.abs(a - b)}%`;
        r.link.style.background = rgba(c, 0.35);
      } else {
        r.before.style.width = `${b}%`;
        r.before.style.background = rgba(ink, 0.16);
        r.after.style.width = `${a}%`;
        r.after.style.background =
          `linear-gradient(180deg, ${mixColor(c, '#ffffff', 0.14)}, ${c})`;
        r.after.style.boxShadow = a > 0.5 ? `0 3px 12px ${rgba(c, 0.30)}` : 'none';
        r.link.style.display = 'none';
      }

      const d = g.get(`d:${i}`);
      const txt = formatDelta(d, r.__digits, r.__suffix);
      if (r.num.textContent !== txt) r.num.textContent = txt;
      r.num.className = `delta-num ${d > 0.5 ? 'is-up' : d < -0.5 ? 'is-down' : 'is-flat'}`;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

function formatDelta(v, digits = 0, suffix = '') {
  if (v == null) return '—';
  const r = Number(v.toFixed(digits));
  if (Math.abs(r) < (digits ? 0.05 : 0.5)) return `±0${suffix}`;
  return `${r > 0 ? '↑ ' : '↓ '}${Math.abs(r).toFixed(digits)}${suffix}`;
}

// =====================================================================
// Leaderboard (pseudonymous — proposal P2)
// =====================================================================

export function renderLeaderboard(container, entries, opts = {}) {
  const state = useChart(container, 'leaderboard');
  const top = (entries || []).slice(0, opts.limit || 10);

  if (!top.length) {
    container.textContent = '';
    container.append(el('p', 'chart-empty', 'No quiz answers yet.'));
    state.rows = [];
    state.group?.destroy();
    state.group = null;
    state.meta = {};
    return;
  }

  const root = container;
  const isNew = !state.group;
  if (isNew) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.bouncy);
    state.meta.note = el('p', 'leaderboard-note',
      'Nicknames are assigned at random. No names are collected.');
    container.append(state.meta.note);
    state.meta.body = el('div', 'lb-body');
    container.append(state.meta.body);
    state.meta.byName = new Map();
  }

  const ROW_H = 2.6; // em — matches .lb-row in charts.css
  const best = Math.max(1, top[0].score);
  const seen = new Set();

  top.forEach((entry, i) => {
    let r = state.meta.byName.get(entry.pseudonym);
    if (!r) {
      const row = el('div', 'lb-row');
      const rank = el('div', 'lb-rank');
      const name = el('div', 'lb-name');
      const track = el('div', 'lb-track');
      const fill = el('div', 'lb-fill');
      track.append(fill);
      const score = el('div', 'lb-score');
      row.append(rank, name, track, score);
      state.meta.body.append(row);
      r = { row, rank, name, track, fill, score };
      state.meta.byName.set(entry.pseudonym, r);
      state.group.set(`y:${entry.pseudonym}`, i, { from: i + 1.2 });
      state.group.set(`in:${entry.pseudonym}`, 1, { from: 0, preset: 'smooth' });
    }
    r.name.textContent = entry.pseudonym;
    state.group.set(`y:${entry.pseudonym}`, i);
    state.group.set(`w:${entry.pseudonym}`, entry.score / best, { preset: 'smooth' });
    state.group.set(`s:${entry.pseudonym}`, entry.score, { preset: 'precise' });
    r.__rank = entry.rank;
    r.row.className = `lb-row${entry.rank <= 3 ? ` is-top${entry.rank}` : ''}`;
    seen.add(entry.pseudonym);
  });

  state.meta.byName.forEach((r, name) => {
    if (seen.has(name)) return;
    r.row.remove();
    state.meta.byName.delete(name);
    state.group.forget(`y:${name}`);
    state.group.forget(`w:${name}`);
    state.group.forget(`s:${name}`);
  });

  state.meta.body.style.height = `${seen.size * ROW_H}em`;

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    const accent2 = token(root, '--accent-2', '#b45309');
    state.meta.byName.forEach((r, name) => {
      const y = g.get(`y:${name}`, 0);
      const enter = g.get(`in:${name}`, 1);
      r.row.style.transform = `translateY(${(y * ROW_H).toFixed(3)}em)`;
      r.row.style.opacity = String(enter);

      const w = Math.max(0, g.get(`w:${name}`)) * 100;
      r.fill.style.setProperty('--bar-size', `${w}%`);
      r.fill.style.background = r.__rank === 1
        ? `linear-gradient(90deg, ${accent}, ${accent2})`
        : `linear-gradient(180deg, ${mixColor(accent, '#ffffff', 0.12)}, ${accent})`;
      r.fill.style.boxShadow = r.__rank === 1
        ? `0 4px 18px ${rgba(accent2, 0.38)}`
        : `0 2px 10px ${rgba(accent, 0.22)}`;

      r.rank.textContent = String(r.__rank ?? '');
      const s = Math.round(g.get(`s:${name}`));
      const txt = NUM.format(s);
      if (r.score.textContent !== txt) r.score.textContent = txt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================

export function renderAggregate(container, type, agg, opts = {}) {
  if (!agg) return undefined;
  switch (type) {
    case 'multiple_choice':
    case 'quiz':
      return renderChoice(container, agg, opts);
    case 'word_cloud':
      return renderWordCloud(container, agg, opts);
    case 'open_ended':
      return renderOpenEnded(container, agg, opts);
    case 'scales':
      return renderScales(container, agg, opts);
    case 'ranking':
      return renderRanking(container, agg, opts);
    default:
      container.textContent = '';
      return undefined;
  }
}

/** Quiz reveal celebration. Respects prefers-reduced-motion. */
export function celebrate(host) {
  if (prefersReducedMotion()) return;
  const layer = el('div', 'confetti-layer');
  const tokens = ['--accent', '--accent-2', '--good'];
  const colors = tokens.map((t) => token(host, t, '#888'));

  for (let i = 0; i < 54; i += 1) {
    const bit = el('span', 'confetti-bit');
    const c = colors[i % colors.length];
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.background = c;
    bit.style.width = `${5 + Math.random() * 7}px`;
    bit.style.height = `${9 + Math.random() * 9}px`;
    bit.style.animationDelay = `${Math.random() * 0.5}s`;
    bit.style.animationDuration = `${1.9 + Math.random() * 1.4}s`;
    bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 300}px`);
    bit.style.setProperty('--spin', `${540 + Math.random() * 900}deg`);
    layer.append(bit);
  }
  host.append(layer);
  setTimeout(() => layer.remove(), 3400);
}

/** Ripple pulse when a response lands — peripheral feedback, not a chart. */
export function pulseCount(node) {
  if (!node || prefersReducedMotion()) return;
  node.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.13)' }, { transform: 'scale(1)' }],
    { duration: 420, easing: 'cubic-bezier(.3,1.4,.5,1)' },
  );
}

export { luminance, readableOn };
