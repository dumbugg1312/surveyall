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
  SpringGroup, PRESETS, stagger, delay, countTo, prefersReducedMotion,
  rgba, mixColor, harmonicSeries, hueWheel, readableOn, luminance,
} from './motion.js';
import { splitIcon } from './logic.js';

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

/**
 * Read a theme token off the chart's own container.
 *
 * The container is the source because a theme can be scoped to a subtree
 * — a deck miniature in the dashboard wears its own colours next to
 * eleven others. But getComputedStyle on an element that is NOT in the
 * document returns empty strings for everything, and a caller that
 * builds its chart before appending it therefore silently got the
 * hardcoded fallbacks: results.html and compare.html drew every archived
 * chart in the default blue instead of the deck's palette, for every
 * deck and every theme.
 *
 * Falling back to the document element keeps a detached render on the
 * page's own theme, which is right far more often than #1d4ed8 is.
 */
function token(root, name, fallback) {
  const v = getComputedStyle(root).getPropertyValue(name).trim();
  if (v) return v;
  if (root !== document.documentElement && !root.isConnected) {
    const onDoc = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    if (onDoc) return onDoc;
  }
  return fallback;
}

/** FNV-1a — a stable colour identity per word, not per rank. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
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
 * "Waiting for the first answer…" — the line under a chart that is live
 * with zero responses. Every question spends its opening seconds in this
 * state in front of the whole room, so it gets a real treatment (see the
 * [data-awaiting] block in charts.css) instead of a rack of dead zeros.
 * One note per container, kept across renders so the dots don't restart.
 */
function awaitNote(container, state, on, text = 'Waiting for the first answer…') {
  // While a chart is waiting, its values are faded out by CSS but still
  // sit in the accessibility tree — so the chart read as a rack of "0%"
  // with the explanation somewhere after it. aria-busy says the thing
  // the fade is saying: these numbers are not results yet.
  container.setAttribute('aria-busy', on ? 'true' : 'false');
  if (on && !state.meta.awaitNote) {
    const note = el('p', 'chart-await-note');
    const dots = el('span', 'await-dots');
    dots.append(el('span'), el('span'), el('span'));
    note.append(dots, el('span', 'await-text', text));
    container.append(note);
    state.meta.awaitNote = note;
  } else if (on && container.lastChild !== state.meta.awaitNote) {
    container.append(state.meta.awaitNote);
  } else if (!on && state.meta.awaitNote) {
    state.meta.awaitNote.remove();
    state.meta.awaitNote = null;
  }
}

/**
 * Shared empty-state card for the views that have nothing to draw at all
 * (cloud, open ended). Keyed by kind so flipping between "hidden" and
 * "waiting" swaps the copy, while repeated renders of the same kind reuse
 * the node and never restart the dots.
 */
function emptyCard(container, state, kind, text) {
  if (state.meta.emptyKind === kind && state.meta.empty) return;
  state.meta.empty?.remove();
  const card = el('p', 'chart-empty');
  if (kind === 'waiting') {
    const dots = el('span', 'await-dots');
    dots.append(el('span'), el('span'), el('span'));
    card.append(dots);
  }
  card.append(el('span', null, text));
  container.append(card);
  state.meta.empty = card;
  state.meta.emptyKind = kind;
}

function clearEmptyCard(state) {
  if (state.meta.empty) {
    state.meta.empty.remove();
    state.meta.empty = null;
    state.meta.emptyKind = null;
  }
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

/**
 * Write an option's label into a two-part label node.
 *
 * Dual coding (Paivio; the picture-superiority effect): a congruent
 * picture beside the word gives the room a second way to hold the option,
 * and on a projector it is what lets a student re-find their own answer
 * without reading four labels. The icon is always an addition — the text
 * is never replaced by it — because an unlabelled icon is a guess.
 *
 * Nothing here decides WHETHER there is an icon; splitIcon() does, off
 * the label text itself, so the projector, the phone and the editor
 * preview cannot disagree about it.
 */
function setLabel(node, text) {
  const { icon, text: rest } = splitIcon(text);
  if (node.__icon !== icon) {
    node.__icon = icon;
    node.firstChild.textContent = icon;
  }
  if (node.lastChild.textContent !== rest) node.lastChild.textContent = rest;
  // the title carries the whole thing, icon included: it is what the
  // three-line clamp is hiding
  node.title = text || '';
}

/** The two-span label node setLabel() writes into. */
function labelNode(cls = 'chart-label') {
  const node = el('div', cls);
  node.append(el('span', 'chart-icon'), el('span', 'chart-text'));
  return node;
}

/**
 * Mark a node as something the presenter can point at.
 *
 * Signalling is the best-evidenced lever in the multimedia literature
 * (three meta-analyses, g≈0.38–0.50, strongest for the students with the
 * least prior knowledge), and until now the only signal this app could
 * produce was "this one is correct" — there was no way to say "look at
 * these two" during a discussion. Renderers tag their marks; the
 * presenter toggles `is-spotlit` on them and `data-spotting` on the
 * container, and one CSS block does the rest for every chart at once.
 *
 * Deliberately not spring-driven: what changes is opacity and saturation,
 * never an encoded length, so CSS may own it.
 */
function spot(node, key) {
  if (node.dataset.spot !== String(key)) node.dataset.spot = String(key);
  return node;
}

/**
 * Re-order rows without teleporting them.
 *
 * Sorting by frequency turns "which won" from an arithmetic comparison
 * into a shape the eye reads for free — but only if the room can see the
 * rows travel, which is what makes it the same data rather than a new
 * chart. Rows keep their identity (index-keyed, as everywhere in this
 * file); only the flex `order` changes, and a FLIP animates the gap.
 *
 * offsetTop, not getBoundingClientRect(): the archive scrolls, and a
 * viewport-relative measurement taken either side of a reflow folds the
 * scroll change into the delta — which is how a FLIP flings rows across
 * the screen.
 */
function flipOrder(rows, order) {
  const nodes = rows.map((r) => r.row);
  const before = nodes.map((n) => n.offsetTop);
  let changed = false;
  order.forEach((idx, place) => {
    const n = nodes[idx];
    if (!n) return;
    const want = String(place);
    if (n.style.order !== want) { n.style.order = want; changed = true; }
  });
  if (!changed || prefersReducedMotion()) return;
  const after = nodes.map((n) => n.offsetTop);
  nodes.forEach((n, i) => {
    const dy = before[i] - after[i];
    if (!dy) return;
    n.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
      { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  });
}

/**
 * The text equivalent of a chart, for the surfaces where the chart is the
 * content rather than something a presenter is narrating.
 *
 * docs/accessibility.md has called this the largest remaining gap since
 * the charts were written: three aria-labels across the whole file and no
 * table anywhere. On the projector it matters least (the instructor is
 * the narration); on the student's phone and in the results archive the
 * chart is all there is, so those callers ask for it.
 *
 * The visual chart is marked aria-hidden when this is on, or a reader
 * hears every number twice — once as a rack of divs and once as the
 * table. Prepended, not appended: awaitNote() and emptyCard() both work
 * off the end of the container, and sr-only is out of flow anyway.
 */
function srSummary(container, rows, caption) {
  let table = container.__srTable;
  if (!table) {
    table = el('table', 'sr-only');
    table.dataset.srSummary = '';
    container.prepend(table);
    container.__srTable = table;
  } else if (table.parentNode !== container) {
    container.prepend(table);
  }
  const key = `${caption}|${rows.map((r) => r.join('')).join('')}`;
  if (table.__key === key) return;
  table.__key = key;
  table.textContent = '';
  const cap = el('caption', null, caption);
  const head = el('tr');
  head.append(el('th', null, 'Answer'), el('th', null, 'Responses'), el('th', null, 'Share'));
  const body = el('tbody');
  body.append(head);
  rows.forEach(([label, count, pct]) => {
    const tr = el('tr');
    tr.append(el('th', null, label), el('td', null, count), el('td', null, pct));
    body.append(tr);
  });
  table.append(cap, body);
}

function clearSrSummary(container) {
  container.__srTable?.remove();
  container.__srTable = null;
}

/** 1.4.11 — a shape carrying meaning. Bars, segments, dots. */
const MARK_CONTRAST = 3.05;
/** 1.4.3 — the same palette when the mark IS a word. Cloud words, headings. */
const TYPE_CONTRAST = 4.55;

function palette(root, count, mode = 'categorical', minContrast = MARK_CONTRAST) {
  const a = token(root, '--accent', '#1d4ed8');
  const b = token(root, '--accent-2', '#b45309');
  // the wheel picks each hue for pop against the actual page background, so
  // the ground colour is part of what identifies a cached palette
  const bg = token(root, '--ground', '#ffffff');
  const key = `${mode}|${a}|${b}|${bg}|${count}|${minContrast}`;
  let p = paletteCache.get(key);
  if (!p) {
    p = mode === 'uniform'
      ? new Array(Math.max(1, count)).fill(a)
      : mode === 'wheel'
        ? hueWheel(a, Math.max(1, count), bg, minContrast, b)
        : harmonicSeries(a, b, Math.max(1, count), bg, minContrast);
    paletteCache.set(key, p);
  }
  return p;
}

// =====================================================================
// Multiple choice / quiz — bars, columns, donut
// =====================================================================

export function renderChoice(container, agg, opts = {}) {
  const style = opts.style === 'donut' ? 'donut'
    : opts.style === 'dots' ? 'dots'
      : opts.style === 'columns' ? 'columns' : 'bars';
  if (style === 'donut') return renderDonut(container, agg, opts);
  if (style === 'dots') return renderDotPlot(container, agg, opts);

  const state = useChart(container, style);
  const root = container;
  const n = agg.options.length;
  // Poll bars carry a distinct hue per option — livelier than a wall of
  // one accent, and each option keeps its colour across the reveal. The
  // wheel is anchored on the accent, so option 1 still reads as the theme
  // accent. A quiz verdict still overrides the correct row to green in
  // paint(); colour here is decoration, never the answer signal.
  const colors = palette(root, n, 'wheel');
  const correct = new Set(opts.revealCorrect ? (agg.correct || []) : []);
  const max = Math.max(1, ...agg.options.map((o) => o.count));
  const isNew = !state.group;

  /**
   * What a full track means.
   *
   * While the votes are still landing, a bar is a share of the LEADER:
   * that is the scale with the most resolution, it makes every arrival
   * visible, and nobody is drawing conclusions yet. The moment voting
   * closes it becomes a share of the ROOM — because the conclusion the
   * room is about to draw is a room-share judgment ("half of us said B"),
   * and share-of-leader draws a 20/19/18 split as three nearly-full bars,
   * which is a landslide in a picture and a divided room in the numbers.
   * Students read the picture (Shah & Hoeffner: they do not compute from
   * the labels), so the picture has to be the one that is true at the
   * moment it is read.
   *
   * The change rides the springs already on `w:` — the bars visibly
   * relax rather than cutting.
   *
   * Multi-select breaks the arithmetic (six people may cast eighteen
   * votes, so a count can exceed the respondent total); there, share of
   * the leader is the only honest full track, so the switch is off.
   */
  const totals = agg.total || 0;
  const roomScale = opts.roomScale && totals > 0 && max <= totals;
  const denom = roomScale ? totals : max;

  // Live question, zero responses: the state every question opens in,
  // in front of the whole room. Callers that show archived data pass
  // `awaiting: false` so a question nobody answered doesn't claim to wait.
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (isNew) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
  }

  // ---- structure (built once, then reused) --------------------------
  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'chart-row');
    spot(row, i);

    const label = labelNode();
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    // Conviction washes (confidence rider): two right-anchored veils over
    // the fill's tip. The solid base is the certain vote; the veils are
    // the fairly-sures and, palest of all at the very tip, the guesses.
    // Saturation is already this chart's "conviction" channel (the quiz
    // verdict drains it from the losers), so the same channel now says,
    // pre-reveal, whether a tall bar is held or merely hoped. Children of
    // the fill, like the glint, so they ride the spring for free and can
    // never alter the encoded length.
    const wash1 = el('span', 'chart-conv');
    const wash2 = el('span', 'chart-conv is-tip');
    const sheen = el('div', 'chart-sheen');
    const glint = el('span', 'chart-glint');
    fill.append(wash1, wash2, sheen, glint);
    track.append(fill);

    const value = el('div', 'chart-value');
    const pct = el('span', 'chart-pct');
    const count = el('span', 'chart-count');
    value.append(pct, count);

    row.append(label, track, value);
    row.style.setProperty('--row-i', String(i)); // phases the awaiting sweep
    container.append(row);
    state.rows.push({ row, label, track, fill, glint, value, pct, count, wash1, wash2 });

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
  const prevCounts = state.meta.lastCounts || null;
  agg.options.forEach((opt, i) => {
    const r = state.rows[i];
    // The label is clamped to three lines in CSS; setLabel puts the rest
    // on the title, so it is reachable rather than merely gone.
    setLabel(r.label, opt.label || `Option ${i + 1}`);

    const fraction = opts.hidden ? 0
      : (denom ? Math.min(1, opt.count / denom) : 0);
    state.group.set(`w:${i}`, fraction);
    state.group.set(`c:${i}`, opts.hidden ? 0 : opt.count, { preset: 'precise' });
    state.group.set(`p:${i}`, opts.hidden ? 0 : opt.pct, { preset: 'precise' });

    // A vote landing on this row fires a glint off the bar's tip — the
    // arrival is legible from the back row as an event on the bar that
    // grew, not just a number ticking. The glint is a child of the fill,
    // so it rides the spring for free and never touches the encoded length.
    if (!opts.hidden && prevCounts && opt.count > prevCounts[i]
        && !prefersReducedMotion()) {
      r.glint.animate(
        [{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0 }],
        { duration: 520, easing: 'cubic-bezier(0, 0, .2, 1)' },
      );
    }

    // Conviction targets. `conf` is [guessing, fairly sure, certain] for
    // this option's votes; absent unless the rider is on and someone
    // reported. The veils cover everything that ISN'T a certain vote —
    // a voter who skipped the rider rides under the lighter veil, which
    // slightly understates conviction rather than ever overstating it.
    const conv = opt.conf || null;
    const reported = conv ? conv[0] + conv[1] + conv[2] : 0;
    const veil = conv && reported && opt.count ? (opt.count - conv[2]) / opt.count : 0;
    const tip = conv && reported && opt.count ? conv[0] / opt.count : 0;
    state.group.set(`cw1:${i}`, opts.hidden ? 0 : veil);
    state.group.set(`cw2:${i}`, opts.hidden ? 0 : tip);
  });
  state.meta.lastCounts = agg.options.map((o) => o.count);

  // ---- confidence strip (pedagogy roadmap, feature 2) --------------
  // The quadrant that matters is "certain and wrong" — the misconception
  // signal. Plain text, updated in place; hidden while results are.
  if (agg.confidence && !opts.hidden) {
    if (!state.meta.confStrip) {
      const strip = el('p', 'conf-strip');
      state.meta.confStrip = strip;
      container.append(strip);
    }
    const c = agg.confidence;
    const parts = [];
    if (c.quad && correct.size) {
      const q4 = c.quad;
      parts.push(
        [`${q4.sureWrong} certain & wrong`, 'is-alarm'],
        [`${q4.sureRight} certain & right`, ''],
        [`${q4.unsureRight} unsure & right`, ''],
        [`${q4.unsureWrong} unsure & wrong`, ''],
      );
    } else {
      parts.push(
        [`${c.counts[2]} certain`, ''],
        [`${c.counts[1]} fairly sure`, ''],
        [`${c.counts[0]} guessing`, ''],
      );
    }
    // note: the quadrant branch keys off `correct`, which is only
    // populated when the reveal is on — before that, only the harmless
    // certain/fairly-sure/guessing counts are shown (no key leak)
    //
    // Built as elements rather than an innerHTML string. The values are
    // all numbers today, so nothing is injectable — but this was the one
    // place in the file where data reached the DOM as markup, and the
    // rule is worth more than the exception.
    const key = parts.map((p) => p.join(' ')).join('|');
    if (state.meta.confStrip.__key !== key) {
      state.meta.confStrip.textContent = '';
      parts.forEach(([text, cls], i) => {
        if (i) state.meta.confStrip.append(document.createTextNode(' '));
        state.meta.confStrip.append(el('span', `conf-chip ${cls}`.trim(), text));
      });
      state.meta.confStrip.__key = key;
    }

    // The calibration sentence — the one line the whole rider exists to
    // produce, set large enough to be the discussion prompt it is. "Of
    // the 12 who felt certain, 5 were right" says what no bar can: how
    // good this room currently is at knowing when it knows.
    const q4 = c.quad && correct.size ? c.quad : null;
    const certain = q4 ? q4.sureRight + q4.sureWrong : 0;
    if (q4 && certain > 0) {
      if (!state.meta.confVerdict) {
        const line = el('p', 'conf-verdict');
        state.meta.confVerdict = line;
        state.meta.confStrip.before(line);
      }
      const vkey = `${certain}|${q4.sureRight}`;
      if (state.meta.confVerdict.__key !== vkey) {
        const first = !state.meta.confVerdict.__key;
        state.meta.confVerdict.__key = vkey;
        const line = state.meta.confVerdict;
        line.textContent = '';
        line.append(
          document.createTextNode(`Of the ${NUM.format(certain)} who felt certain, `),
          el('strong', 'conf-verdict-n', String(first ? 0 : q4.sureRight)),
          document.createTextNode(` ${q4.sureRight === 1 ? 'was' : 'were'} right.`),
        );
        if (first) {
          const strong = line.querySelector('.conf-verdict-n');
          countTo(0, q4.sureRight, 0.9, (v) => {
            strong.textContent = NUM.format(Math.round(v));
          });
        }
      }
    } else if (state.meta.confVerdict) {
      state.meta.confVerdict.remove();
      state.meta.confVerdict = null;
    }
  } else if (state.meta.confStrip) {
    state.meta.confStrip.remove();
    state.meta.confStrip = null;
    state.meta.confVerdict?.remove();
    state.meta.confVerdict = null;
  }

  // ---- sort on close ------------------------------------------------
  // Ranking by eye is a comparison the room should not have to compute:
  // sorted bars make "which won" a shape rather than an arithmetic
  // problem. But only once voting has closed — while the room is still
  // answering, students are tracking their OWN option, and a chart whose
  // rows swap under them mid-vote is the transient-information effect
  // wearing a helpful face. Never on a keyed question either: A/B/C is
  // load-bearing there, and the answer being discussed is named by
  // position.
  const sortable = opts.sorted && !opts.hidden && !correct.size && totals > 0;
  const order = sortable
    ? agg.options.map((o, i) => i).sort((a, b) => (
      agg.options[b].count - agg.options[a].count || a - b))
    : agg.options.map((_, i) => i);
  if (state.meta.orderKey !== order.join(',')) {
    state.meta.orderKey = order.join(',');
    flipOrder(state.rows, order);
  }

  // ---- quiz reveal: breath, then verdict ---------------------------
  // Closing a quiz used to dim, highlight and ✓ in the same frame. Now
  // it breathes: every bar eases back a touch (the room's "…and?"), and
  // 450ms later the verdict lands — wrong rows fall away, the correct
  // row ignites and gets its ✓. Confetti follows on its own beat from
  // the presenter (see toggleAccepting). Under reduced motion delay()
  // fires immediately, collapsing this back to an instant reveal.
  // 'best' mode (humanities Peer Instruction): the reveal is a quiet
  // acknowledgement — a ring and a marker, wrong-ness only half-dimmed,
  // because the other options were defensible too. 'correct' mode keeps
  // the full quiz verdict.
  const soft = opts.revealStyle === 'best';
  const markClass = soft ? 'is-best' : 'is-correct';
  const dimTo = soft ? 0.45 : 1;

  const revealOn = correct.size > 0;
  if (revealOn && !state.meta.revealed) {
    state.meta.revealed = true;
    state.meta.verdictPending = true;
    agg.options.forEach((_, i) => state.group.set(`dim:${i}`, 0.35));
    delay(0.45, () => {
      if (container.__chart !== state || !state.meta.revealed) return;
      state.meta.verdictPending = false;
      state.rows.forEach((r, i) => {
        state.group.set(`dim:${i}`, correct.has(i) ? 0 : dimTo);
        r.row.classList.toggle(markClass, correct.has(i));
        // One beat of extra light on the answer, at the instant it is
        // named. The spring-driven ring underneath (see paint()) already
        // blooms as `dim` settles, but a ring grows in over ~400ms and
        // the room needs something that happens ON the beat, not around
        // it. Brightness, deliberately: it composes with the ring rather
        // than competing with it, it is the same filter channel the dim
        // is already using so nothing else has to change, and it cannot
        // move or resize a bar whose length is a number.
        if (correct.has(i) && !prefersReducedMotion()) {
          r.fill.animate(
            [
              { filter: 'brightness(1) saturate(1)' },
              { filter: 'brightness(1.42) saturate(1.15)', offset: 0.18 },
              { filter: 'brightness(1) saturate(1)' },
            ],
            { duration: 780, easing: 'cubic-bezier(0, 0, .2, 1)' },
          );
        }
      });
    });
  } else if (revealOn) {
    // Already revealed. If the verdict beat is still pending (the socket
    // echoes the session update ~50ms after the click), keep holding the
    // breath — the scheduled beat will land it. Otherwise (the 10s poll
    // re-rendering a settled reveal) just hold the verdict.
    if (state.meta.verdictPending) {
      agg.options.forEach((_, i) => state.group.set(`dim:${i}`, 0.35));
    } else {
      state.rows.forEach((r, i) => {
        state.group.set(`dim:${i}`, correct.has(i) ? 0 : dimTo);
        r.row.classList.toggle(markClass, correct.has(i));
      });
    }
  } else {
    state.meta.revealed = false;
    state.meta.verdictPending = false;
    state.rows.forEach((r, i) => {
      state.group.set(`dim:${i}`, 0);
      r.row.classList.remove('is-correct', 'is-best');
    });
  }

  // ---- the "because" ------------------------------------------------
  // Smith et al. 2011: peer discussion PLUS the instructor's explanation
  // beats either alone — and Mayer's temporal contiguity principle says
  // the words and the graphic have to arrive together, not a slide apart.
  // So the reasoning is part of the verdict beat rather than the next
  // thing the instructor has to remember to click to.
  //
  // Written on the question, and stripped from the phone payload in the
  // worker, because it is the answer key in sentences.
  const explain = revealOn ? String(opts.explain || '').trim() : '';
  if (explain) {
    if (!state.meta.explainLine) {
      const p = el('p', 'chart-explain');
      state.meta.explainLine = p;
      container.append(p);
    }
    const line = state.meta.explainLine;
    if (line.textContent !== explain) line.textContent = explain;
    // On the same 450ms beat as the verdict, and only the first time —
    // the backstop poll re-rendering a settled reveal must not replay it.
    if (!state.meta.explainShown) {
      state.meta.explainShown = true;
      line.classList.remove('is-in');
      delay(0.45, () => {
        if (container.__chart !== state) return;
        line.classList.add('is-in');
      });
    }
  } else if (state.meta.explainLine) {
    state.meta.explainLine.remove();
    state.meta.explainLine = null;
    state.meta.explainShown = false;
  }

  // Object.assign, not reassignment: meta also carries the await note.
  Object.assign(state.meta, {
    colors, correct, showPercent: opts.showPercent !== false, hidden: opts.hidden, root,
    revealStyle: opts.revealStyle || 'correct',
  });
  awaitNote(container, state, awaiting);
  state.group.prune(new Set([
    ...agg.options.flatMap((_, i) => [
      `w:${i}`, `c:${i}`, `p:${i}`, `dim:${i}`, `in:${i}`, `cw1:${i}`, `cw2:${i}`,
    ]),
  ]));

  // ---- one write per frame ------------------------------------------
  const theme = {
    good: token(root, '--good', '#15803d'),
    ink: token(root, '--ink', '#111'),
    ground: token(root, '--ground', '#ffffff'),
  };

  function paint() {
    const g = state.group;
    // Read the theme ONCE per render, not once per frame.
    //
    // token() is getComputedStyle(), and a getComputedStyle() issued after
    // the previous frame's style writes forces a synchronous style recalc.
    // Three of them, sixty times a second, for values that cannot change
    // between two frames of the same animation — the theme only moves when
    // the deck is re-rendered, which is exactly when this cache is rebuilt.
    const { good, ink, ground } = theme;

    state.rows.forEach((r, i) => {
      const enter = g.get(`in:${i}`, 1);
      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      const dim = g.get(`dim:${i}`);

      r.row.style.opacity = String(enter);
      r.row.style.transform = enter < 0.999
        ? `translateY(${(1 - enter) * 10}px)` : '';

      // clamped: `enter` must never inflate the encoded length
      r.fill.style.setProperty('--bar-size', `${w * Math.min(1, enter)}%`);

      const marked = state.meta.correct.size && state.meta.correct.has(i);
      const bestMode = state.meta.revealStyle === 'best';
      // 'best' keeps the accent (the other answers were defensible too);
      // only a true quiz verdict turns the winner green
      const base = marked && !bestMode
        ? good
        : state.meta.colors[i] || state.meta.colors[0];
      const shown = dim > 0 ? mixColor(base, rgba(ink, 1), dim * 0.72) : base;

      // A flat fill reads as a placeholder; the gradient plus the sheen
      // strip along the top edge is what gives the bar a lit surface.
      // The gradient only depends on `shown`, and `shown` only moves while
      // the reveal's dim spring is travelling — for the whole of a live
      // vote it is a constant. Rebuilding the same string every frame cost
      // three colour mixes per bar per frame and handed the compositor a
      // fresh gradient to rasterise on an element that was already
      // resizing. Write it when it changes, which is what it looks like.
      if (r.__shown !== shown) {
        r.__shown = shown;
        r.fill.style.background =
          `linear-gradient(180deg, ${mixColor(shown, '#ffffff', 0.10)} 0%, ${shown} 52%, ${mixColor(shown, '#000000', 0.06)} 100%)`;
      }
      r.fill.style.opacity = String(1 - dim * 0.35);

      // Dimming alone was not enough separation at the verdict. A bar
      // that is only darker still reads as a bar that is still in the
      // running; a bar that has lost its COLOUR has visibly stopped
      // competing, which is what the moment is trying to say. Saturation
      // is the one channel here that can carry "this is no longer the
      // answer" without touching the encoded length — scale, width and
      // height are all off limits on something that represents a count.
      // Driven straight off the same dim spring, so it costs no new
      // state and arrives on the same critically damped curve.
      const sat = dim > 0.01 ? `saturate(${(1 - dim * 0.55).toFixed(3)})` : '';
      if (r.__sat !== sat) { r.__sat = sat; r.fill.style.filter = sat; }

      // the verdict glow blooms as the correct row's dim spring settles
      // back to zero — tied to the spring, so it fades in, never pops
      // Same reasoning as the gradient, and it matters more here: a blurred
      // box-shadow is re-rasterised whenever it changes, on a box whose
      // width is changing anyway. Outside the reveal this string is
      // constant, so the shadow is rasterised once and then simply
      // stretched by the compositor.
      let shadow;
      if (marked) {
        const glow = Math.max(0, 1 - dim * 3);
        const ringColor = bestMode ? base : good;
        const ringAlpha = bestMode ? 0.26 : 0.18;
        const castAlpha = bestMode ? 0.32 : 0.5;
        shadow = `0 0 0 .14em ${rgba(ringColor, ringAlpha * glow)}, 0 6px 22px ${rgba(ringColor, castAlpha * glow)}, 0 1px 2px ${rgba(ink, 0.10)}`;
      } else {
        shadow = w > 0.5
          ? `0 1px 2px ${rgba(ink, 0.10)}, 0 6px 16px ${rgba(shown, 0.26)}`
          : 'none';
      }
      if (r.__shadow !== shadow) { r.__shadow = shadow; r.fill.style.boxShadow = shadow; }

      // Conviction veils: widths ride the same frame as the fill, pushed
      // toward the page ground so the tip visibly pales without a second
      // hue entering the chart.
      const veil = Math.max(0, g.get(`cw1:${i}`, 0));
      const tip = Math.max(0, g.get(`cw2:${i}`, 0));
      r.wash1.style.width = `${(veil * 100).toFixed(2)}%`;
      r.wash2.style.width = `${(tip * 100).toFixed(2)}%`;
      if (r.__ground !== ground) {
        r.__ground = ground;
        r.wash1.style.background = rgba(ground, 0.34);
        r.wash2.style.background = rgba(ground, 0.30);
      }

      const pctVal = g.get(`p:${i}`);
      const cntVal = g.get(`c:${i}`);
      const count = NUM.format(Math.round(cntVal));
      // "Show counts" in the editor means the raw number is the headline
      // and the percentage steps aside — not that both appear regardless.
      const pctText = state.meta.hidden
        ? '—'
        : state.meta.showPercent ? `${Math.round(pctVal)}%` : count;
      const cntText = state.meta.hidden || !state.meta.showPercent ? '' : count;
      if (r.pct.textContent !== pctText) r.pct.textContent = pctText;
      if (r.count.textContent !== cntText) r.count.textContent = cntText;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// ------------------------------------------------------------- dot plot

/**
 * One mark per person.
 *
 * The other three styles draw a magnitude — a length, an angle — and the
 * room reads a proportion off it. This one draws the people. Thirty dots
 * beside an option is thirty classmates, countable, and in a class of
 * thirty that lands differently from "43%": nobody has to trust the
 * arithmetic, and a lone dissenting dot is visibly one person rather than
 * a sliver of bar. It is the best of the four for a seminar and the worst
 * for a lecture hall, which is exactly why it is a choice and not the
 * default.
 *
 * Above the cap the unit quietly stops being a person — say so in the
 * row rather than drawing 400 dots nobody can count and letting the room
 * believe each one is someone.
 */
const DOT_CAP = 120;

/**
 * Most dots a single repaint may animate in. Above this the change is a
 * bulk one — a reveal, an archive load, a style switch — not people
 * answering, and it appears without ceremony.
 */
const POP_BURST = 8;

function renderDotPlot(container, agg, opts = {}) {
  const state = useChart(container, 'dots');
  const root = container;
  const n = agg.options.length;
  const colors = palette(root, n, 'uniform');
  const correct = new Set(opts.revealCorrect ? (agg.correct || []) : []);
  const total = agg.total || 0;
  const awaiting = !opts.hidden && total === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  // How many responses one dot stands for. 1 until the biggest option
  // would overflow the cap, then the smallest whole number that fits.
  const peak = Math.max(0, ...agg.options.map((o) => o.count));
  const per = opts.hidden ? 1 : Math.max(1, Math.ceil(peak / DOT_CAP));

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = el('div', 'dotp-row');
    spot(row, i);
    const label = labelNode();
    const field = el('div', 'dotp-field');
    const value = el('div', 'chart-value');
    const pct = el('span', 'chart-pct');
    const count = el('span', 'chart-count');
    value.append(pct, count);
    row.append(label, field, value);
    row.style.setProperty('--row-i', String(i));
    container.append(row);
    state.rows.push({ row, label, field, value, pct, count, dots: [] });
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  awaitNote(container, state, awaiting);

  // Decide whether this repaint is "votes arriving" ONCE, for the whole
  // chart, before drawing any of it. Per row, a reveal that fills every
  // cluster at once would still pop the one option that only got five
  // answers — the small row flashing while the big ones appear flat,
  // inside what the room sees as a single event.
  const target = agg.options.map((o) => (opts.hidden ? 0 : Math.round(o.count / per)));
  const totalAdded = target.reduce(
    (sum, want, i) => sum + Math.max(0, want - (state.rows[i]?.dots.length || 0)), 0);
  const arriving = state.meta.painted && totalAdded > 0 && totalAdded <= POP_BURST
    && !prefersReducedMotion();

  agg.options.forEach((opt, i) => {
    const r = state.rows[i];
    const shown = target[i];
    setLabel(r.label, opt.label || `Option ${i + 1}`);
    r.row.classList.toggle('is-correct', correct.has(i));
    r.row.style.setProperty('--dot-color', colors[i]);

    // Grow and shrink the cluster in place. Only the dots that are
    // genuinely new get the entrance class, so an arriving vote pops and
    // the two hundred already on screen sit still.
    //
    // ...and only when the chart as a whole is taking arrivals rather
    // than being refilled — see `arriving` above.
    const added = shown - r.dots.length;

    for (let k = r.dots.length; k < shown; k += 1) {
      const d = el('span', 'dotp-dot');
      if (arriving) {
        d.classList.add('is-new');
        // stagger within THIS burst, not by position in the row — dot
        // 103 of a cluster should not wait three seconds to appear
        d.style.setProperty('--dot-i', String(k - (shown - added)));
      }
      r.field.append(d);
      r.dots.push(d);
    }
    while (r.dots.length > shown) r.dots.pop().remove();

    r.pct.textContent = opts.hidden ? '' : `${Math.round(opt.pct)}%`;
    r.count.textContent = opts.hidden ? '·'
      : `${opt.count}${per > 1 ? ` · 1 dot = ${per}` : ''}`;
  });

  state.meta.painted = true;
  return state;
}

// ---------------------------------------------------------------- donut

function renderDonut(container, agg, opts = {}) {
  const state = useChart(container, 'donut');
  const root = container;
  const n = agg.options.length;
  const colors = palette(root, n);
  const total = agg.total || 0;
  const awaiting = !opts.hidden && total === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);
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
    Object.assign(state.meta, { s, track, arcs, legend, cnum, clabel, items: [] });
  }

  state.meta.awaiting = awaiting;
  state.meta.clabel.textContent = awaiting ? 'waiting' : 'responses';
  awaitNote(container, state, awaiting, 'Waiting for the first answer…');

  const { s, track, arcs, legend } = state.meta;

  while (arcs.length < n) {
    const arc = svg('circle', {
      cx: 21, cy: 21, r: R, fill: 'none', 'stroke-width': 5.4,
      'stroke-linecap': 'round',
    });
    s.append(arc);
    arcs.push(arc);

    // The percentage, written on the slice it belongs to.
    //
    // Spatial contiguity is the largest single effect in the multimedia
    // literature (d≈1.1): a number beside its mark is read, a number in a
    // legend is a lookup — find the swatch, match the colour, carry the
    // value back. The legend stays, because a slice too thin to hold its
    // own label still needs a name, but the room no longer has to use it
    // for the figures it will actually talk about.
    const tag = svg('text', {
      class: 'donut-tag', 'text-anchor': 'middle', 'dominant-baseline': 'central',
    });
    s.append(tag);

    const item = el('div', 'donut-item');
    spot(item, arcs.length - 1);
    const dot = el('span', 'donut-dot');
    const name = labelNode('donut-name');
    const num = el('span', 'donut-num');
    item.append(dot, name, num);
    legend.append(item);
    state.meta.items.push({ item, dot, name, num, tag });
  }
  while (arcs.length > n) {
    arcs.pop().remove();
    const dead = state.meta.items.pop();
    dead.item.remove();
    dead.tag.remove();
  }

  agg.options.forEach((opt, i) => {
    setLabel(state.meta.items[i].name, opt.label || `Option ${i + 1}`);
    state.group.set(`a:${i}`, opts.hidden || !total ? 0 : (opt.count / total) * 100);
    state.group.set(`p:${i}`, opts.hidden ? 0 : opt.pct, { preset: 'precise' });
  });

  // role="img" with no accessible name announces as an unlabelled graphic.
  // The legend beside it carries the same numbers in text, so the ring
  // itself gets the summary and the reader is not made to assemble one.
  s.setAttribute('aria-label', opts.hidden
    ? 'Results chart, hidden'
    : awaiting
      ? 'Results chart, no responses yet'
      : `Results, ${NUM.format(total)} ${total === 1 ? 'response' : 'responses'}: `
        + agg.options
          .map((o) => `${o.label || 'Unlabelled'} ${Math.round(o.pct)}%`)
          .join(', '));
  state.group.set('total', opts.hidden ? 0 : total, { preset: 'precise' });

  function paint() {
    const g = state.group;
    const ink = token(root, '--ink', '#111');
    track.setAttribute('stroke', rgba(ink, 0.08));

    let offset = 25; // start the first arc at 12 o'clock
    let sweep = 0;   // percent of the ring consumed so far, for label angles
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

      // The slice's own label, parked at the middle of its arc. Below
      // ~9% of the ring the band is thinner than the digits are tall, so
      // the tag would sit half on its neighbour — that slice keeps the
      // legend and nothing else. Drawn in the ink that is readable ON the
      // slice, since it sits inside the stroke.
      const mid = sweep + pct / 2;
      sweep += pct;
      const show = !opts.hidden && !state.meta.awaiting && pct >= 9;
      it.tag.style.opacity = show ? '1' : '0';
      if (show) {
        const a = (mid / 100) * Math.PI * 2 - Math.PI / 2;
        it.tag.setAttribute('x', (21 + Math.cos(a) * R).toFixed(2));
        it.tag.setAttribute('y', (21 + Math.sin(a) * R).toFixed(2));
        it.tag.setAttribute('fill', readableOn(colors[i] || colors[0]));
        if (it.tag.textContent !== txt) it.tag.textContent = txt;
      }
    });

    const t = state.meta.awaiting ? '—' : String(Math.round(g.get('total')));
    if (state.meta.cnum.textContent !== t) state.meta.cnum.textContent = t;
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

/**
 * How many words the projector will actually draw. Anything past this is
 * not rendered, so whoever paints the cloud has to say so out loud —
 * see the "someone's answer vanishing with no explanation" note in
 * runLayout(); a word cut off by this ceiling is the same failure.
 */
export const CLOUD_MAX_WORDS = 80;

/**
 * How many words the list mode ranks. A cloud is a picture of the whole
 * room; a ranked list is an argument about the top of it, and past ten
 * rows the projector is a spreadsheet.
 */
const WORD_LIST_ROWS = 10;

/**
 * The same answers, ranked.
 *
 * A cloud encodes frequency as AREA, which is near the bottom of
 * Cleveland & McGill's accuracy ranking — fine for "what did the room
 * say", useless for "was 'warrant' really said twice as often as
 * 'claim'". Length on a common baseline is the top of that ranking, so
 * the same data gets a second view and the instructor picks the one that
 * matches the question being asked: cloud for the arrival, list for the
 * argument.
 *
 * Colour is carried over from the cloud unchanged — same hash, same
 * accent for the leader — so a word keeps its identity across the toggle
 * and the room can see it is the same data in a different shape.
 */
function renderWordList(container, agg, opts = {}) {
  const state = useChart(container, 'wordlist');
  const root = container;
  const words = (agg.words || []).slice(0, WORD_LIST_ROWS);

  if (opts.hidden || !words.length) {
    const waiting = !opts.hidden && opts.awaiting !== false;
    emptyCard(container, state,
      opts.hidden ? 'hidden' : waiting ? 'waiting' : 'none',
      opts.hidden ? 'Responses hidden'
        : waiting ? 'Waiting for the first word…' : 'No responses.');
    return;
  }
  clearEmptyCard(state);

  const colors = palette(root, 12, 'wheel', TYPE_CONTRAST);
  const top = words[0].count || 1;
  const spoken = agg.total || words.reduce((s, w) => s + w.count, 0);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
  }

  while (state.rows.length < words.length) {
    const i = state.rows.length;
    const row = el('div', 'chart-row');
    spot(row, i);
    const label = labelNode();
    const track = el('div', 'chart-track');
    const fill = el('div', 'chart-fill');
    fill.append(el('div', 'chart-sheen'));
    track.append(fill);
    const value = el('div', 'chart-value');
    const pct = el('span', 'chart-pct');
    value.append(pct);
    row.append(label, track, value);
    row.style.setProperty('--row-i', String(i));
    container.append(row);
    state.rows.push({ row, label, fill, pct });
  }
  while (state.rows.length > words.length) state.rows.pop().row.remove();

  words.forEach((w, i) => {
    const r = state.rows[i];
    setLabel(r.label, w.word);
    state.group.set(`w:${i}`, w.count / top);
    state.group.set(`c:${i}`, w.count, { preset: 'precise' });
    // the cloud's rule, unchanged: leader wears the accent, everyone else
    // keeps the hue their own letters hash to
    r.fill.style.background = i === 0 ? colors[0] : colors[hashStr(w.word) % colors.length];
  });

  state.group.prune(new Set(words.flatMap((_, i) => [`w:${i}`, `c:${i}`])));

  state.paint = () => {
    const g = state.group;
    state.rows.forEach((r, i) => {
      r.fill.style.setProperty('--bar-size', `${Math.max(0, g.get(`w:${i}`)) * 100}%`);
      const c = Math.round(g.get(`c:${i}`));
      const txt = `${NUM.format(c)}`;
      if (r.pct.textContent !== txt) r.pct.textContent = txt;
    });
  };

  if (opts.srSummary) {
    srSummary(container, words.map((w) => [
      w.word, String(w.count),
      spoken ? `${Math.round((w.count / spoken) * 100)}%` : '—',
    ]), `Most frequent answers, ${NUM.format(words.length)} shown`);
  }

  state.group.kick();
  state.paint();
}

export function renderWordCloud(container, agg, opts = {}) {
  if (opts.style === 'list') return renderWordList(container, agg, opts);
  const state = useChart(container, 'cloud');
  const root = container;

  const words = (agg.words || []).slice(0, CLOUD_MAX_WORDS);
  if (opts.hidden || !words.length) {
    if (!state.meta.empty) {
      container.textContent = '';
      state.nodes = new Map();
      // The nodes are gone, so every word will be a cache miss on the
      // next visible render — but the layout cache would still claim
      // they are all positioned and unchanged, and runLayout() is the
      // only thing that ever writes font-size. Left behind, it makes
      // shouldLayout false on all four terms and the cloud comes back as
      // an unsized pile at the centre, with no vote left to shake it
      // loose. The cache must die with the nodes it describes.
      clearTimeout(state.meta.trailing);
      state.meta.trailing = null;
      state.meta.positioned = null;
      state.meta.layoutKey = null;
      state.meta.W = null;
      state.meta.H = null;
      // a wiped container is a first fill again: let it assemble rather
      // than detonate when it comes back
      state.meta.hadWords = false;
    }
    const waiting = !opts.hidden && opts.awaiting !== false;
    emptyCard(container, state,
      opts.hidden ? 'hidden' : waiting ? 'waiting' : 'none',
      opts.hidden ? 'Responses hidden'
        : waiting ? 'Waiting for the first word…' : 'No responses.');
    return;
  }
  clearEmptyCard(state);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.gentle);
    state.nodes = new Map();
    // spatial layout is meaningless to a screen reader; DOM order (kept
    // in frequency order by runLayout) is what gets read
    container.setAttribute('aria-label', 'Word cloud, most frequent words first');
  }

  const rect = container.getBoundingClientRect();
  const W = Math.max(280, rect.width || 900);
  const H = Math.max(200, rect.height || 500);

  const maxCount = words[0].count;
  const minCount = words[words.length - 1].count;
  const family = token(root, '--display', 'serif');
  // A word cloud wants MANY colours (like Mentimeter), not the two-anchor
  // gradient the bars use — a full spread of distinct hues, each word
  // keeping its own for the session. The wheel is anchored on the accent,
  // so the top word (which always wears colours[0]) still reads as the
  // accent while everything else fans across the spectrum.
  // words, not shapes: this palette has to clear the TEXT floor, because a
  // cloud on a phone draws its smallest entries at ~14px
  const colors = palette(root, 12, 'wheel', TYPE_CONTRAST);

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
  // On the very first full cloud, words are born biggest-first over
  // ~450ms instead of all at once — the cloud assembles rather than
  // detonates. Later arrivals still pop immediately.
  const firstFill = !state.meta.hadWords && words.length > 3;
  state.meta.hadWords = true;
  const inkSoft = token(root, '--ink-soft', '#667');

  const seen = new Set();
  const entries = words.map((entry, i) => {
    let node = state.nodes.get(entry.word);
    const size = sizeFor(entry.count);
    const weight = entry.count === maxCount ? 750 : (size > bigSize * 0.55 ? 650 : 550);

    if (!node) {
      node = el('span', 'cloud-word', entry.word);
      node.dataset.word = entry.word;
      container.append(node);
      state.nodes.set(entry.word, node);
      state.group.snap(`x:${entry.word}`, W / 2);
      state.group.snap(`y:${entry.word}`, H / 2);
      if (firstFill) {
        // create the spring with bouncy physics, parked at 0…
        state.group.set(`s:${entry.word}`, 0, { from: 0, preset: 'bouncy' });
        // …then release it on this word's beat. Position springs are
        // already gliding, so words bloom outward from the centre.
        delay(stagger(i, 0.05, 0.45), () => {
          if (container.__chart !== state) return;
          if (state.nodes.get(entry.word) !== node) return;
          state.group.set(`s:${entry.word}`, 1);
          focusIn(node);
        });
      } else {
        // new words fly in from nothing at the centre
        state.group.set(`s:${entry.word}`, 1, { from: 0, preset: 'bouncy' });
        focusIn(node);
      }
    } else {
      state.group.set(`s:${entry.word}`, 1);
    }

    node.style.fontFamily = family;
    node.style.fontWeight = String(weight);
    // Colour is identity: a word keeps its hue for the whole session
    // (hash, not rank index), so growing or shrinking never recolours
    // it. The one exception is the room's top answer, which always
    // wears the accent — when leadership changes, the CSS colour
    // transition hands the accent over smoothly. The smallest words
    // recede a step toward the soft ink so the cloud reads in layers.
    const base = i === 0
      ? colors[0]
      : colors[hashStr(entry.word) % colors.length];
    node.style.color = size < smallSize * 1.3 && i !== 0
      ? mixColor(base, inkSoft, 0.22) : base;
    node.style.letterSpacing = i === 0 ? '-.03em' : '';
    node.title = `${entry.word}: ${entry.count}`;
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
      entries.forEach((e) => {
        // Only write when it actually changes. A vote that nudges one
        // word's count leaves the other seventy-nine at exactly the size
        // they already have, and re-writing the same px value still
        // dirties the node's style — which is the difference between
        // re-laying-out one word and re-laying-out the whole cloud.
        const px = `${e.size * s}px`;
        if (e.node.style.fontSize !== px) e.node.style.fontSize = px;
      });
      return entries.map((e) => ({
        entry: e.entry,
        node: e.node,
        size: e.size,
        w: e.node.offsetWidth + 14,
        h: e.node.offsetHeight + 6,
      }));
    };

    /**
     * Shrink until the whole cloud fits. d3-cloud silently DROPS words it
     * can't place and never rescales; in a classroom that means someone's
     * answer vanishing with no explanation, so rescale first and only
     * drop as a genuine last resort.
     *
     * WHY THE SEARCH RUNS ON PAPER AND ONLY LANDS ON THE DOM TWICE.
     *
     * This used to walk down in 12% steps, re-measuring at every rung —
     * and a full class fills the canvas, so it reliably walked five or six
     * rungs. Each rung is a forced synchronous layout of every word in the
     * cloud, and the whole loop is a single blocking call on the frame
     * that a new word arrived on. Measured at 80 words it cost ~30ms: two
     * dropped frames on a fast laptop, five or six on the machine actually
     * wired to the projector, every time the cloud changed.
     *
     * The fix is to stop asking the browser questions it can answer once.
     * Word boxes scale close enough to linearly to SEARCH with — so the
     * search bisects on scaled copies of a single measurement, which is
     * pure arithmetic, and finds a finer-grained scale than the old ladder
     * ever could. What is not safe is DRAWING at a scaled estimate: glyph
     * advances do not scale perfectly once hinting and kerning are
     * involved, and a few pixels of error is two words clipping. So the
     * chosen scale is always re-measured for real before it is committed,
     * and the layout that ships is computed from those real numbers.
     */
    let scale = 1;
    let measured = measureAt(scale);
    let layout = tryLayout(measured, 1, W, H, false);

    if (!layout) {
      // Never shrink type below legibility — the same floor the old ladder
      // stopped at, stated as a scale rather than walked into.
      const floor = Math.min(1, Math.max(0.15, 11 / smallSize));
      // How much of the canvas this spiral actually manages to cover when
      // it is packed full: measured at 0.55–0.65 across word counts, so a
      // guess drawn from total ink area lands within a few percent of the
      // largest scale that fits, in one step instead of six. Deliberately
      // a shade under what the spiral can achieve: the guess is checked
      // against SCALED boxes, and real glyph metrics come back a hair
      // wider, so aiming at the ceiling means the re-measure fails and
      // costs another forced layout to climb back down.
      const ink = measured.reduce((sum, m) => sum + m.w * m.h, 0);
      let guess = Math.min(0.97, Math.sqrt((W * H * 0.58) / ink));
      let best = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (guess < floor) break;
        if (tryLayout(measured, guess, W, H, false)) { best = guess; break; }
        guess *= 0.92;
      }
      if (best) {
        scale = best;
        measured = measureAt(scale);
        layout = tryLayout(measured, 1, W, H, false);
        // Real glyph metrics came back a hair wider than the scaled
        // estimate. Give back a few percent rather than dropping
        // somebody's answer.
        for (let i = 0; i < 3 && !layout; i += 1) {
          const next = scale * 0.94;
          if (smallSize * next < 11) break;
          scale = next;
          measured = measureAt(scale);
          layout = tryLayout(measured, 1, W, H, false);
        }
      }
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

    // Screen readers read DOM order, and the spiral appends in arrival
    // order — re-append biggest-first. Every word is absolutely
    // positioned with inline transforms, so this is visually inert
    // (competitors' word clouds read in random order; it's in their
    // accessibility statements).
    entries.forEach((e) => container.append(e.node));
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

  /**
   * A word arrives slightly out of focus and resolves.
   *
   * `filter` is the one visual channel on a cloud word that paint() does
   * NOT write every frame — transform and opacity are both spring-owned
   * and would be stomped on the very next tick — so a one-shot lives
   * here without any coordination with the springs at all.
   *
   * It reads as the word coming into focus rather than simply being
   * scaled up, which matters because scale on this chart already means
   * something: it encodes how many people said it. The blur adds the
   * arrival WITHOUT adding a second thing that looks like magnitude.
   * Kept to 2px and 420ms — roughly how long the scale spring takes to
   * arrive — so the two land together.
   */
  function focusIn(node) {
    if (prefersReducedMotion()) return;
    node.animate(
      [{ filter: 'blur(2px)' }, { filter: 'blur(0px)' }],
      { duration: 420, easing: 'cubic-bezier(0, 0, .2, 1)' },
    );
  }

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
  const placed = new PlacedGrid(W, H);
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
    placed.add(pos.x, pos.y, w, h);
    out.push(pos);
  }
  return out;
}

/**
 * The spiral, walked once at module load instead of once per candidate.
 *
 * Every placement attempt used to recompute the same 3200 sin/cos pairs;
 * a full relayout of an 80-word cloud walks the spiral for every word, on
 * every scale it tries, so the same few thousand angles were being
 * evaluated millions of times per relayout. The curve does not depend on
 * the word, the box or the canvas — only the centre it is offset from
 * does — so it is a constant, and constants belong in a table.
 */
const SPIRAL_STEPS = 3200;
const SPIRAL = (() => {
  const pts = new Float64Array(SPIRAL_STEPS * 2);
  for (let t = 0; t < SPIRAL_STEPS; t += 1) {
    const angle = t * 0.30;
    const radius = angle * 0.95;
    // The 1.75 x-stretch matches the aspect of a projector slide, so the
    // cloud fills a wide box instead of forming a circle in the middle.
    pts[t * 2] = radius * Math.cos(angle) * 1.75;
    pts[t * 2 + 1] = radius * Math.sin(angle);
  }
  return pts;
})();

/**
 * The words placed so far, bucketed into a coarse grid.
 *
 * The collision test is the inner loop of the whole cloud: for each of
 * ~3200 spiral steps, a candidate box is tested against everything
 * already down. Scanning that list linearly makes a relayout quadratic in
 * word count — the 80th word tests 79 rectangles at every step it tries —
 * and an 80-word cloud is exactly what a full class produces.
 *
 * A word can only collide with something in a cell it overlaps, so each
 * rectangle is filed into the cells it covers and a candidate only tests
 * those. Same answer, a fraction of the comparisons. A rectangle spanning
 * several cells is tested more than once in the worst case, which is
 * cheaper than the bookkeeping to avoid it.
 */
const GRID_COLS = 32;
const GRID_ROWS = 20;

class PlacedGrid {
  constructor(W, H) {
    this.cw = W / GRID_COLS;
    this.ch = H / GRID_ROWS;
    this.cells = new Array(GRID_COLS * GRID_ROWS);
    // The cluster's own bounding box. Every candidate is tested against
    // this one rectangle first, and a spiral step that has walked clear of
    // the cluster is accepted without touching a single word — which is
    // most steps, because the spiral's whole job is to walk outward.
    this.x0 = Infinity; this.y0 = Infinity;
    this.x1 = -Infinity; this.y1 = -Infinity;
  }

  hits(x, y, w, h) {
    if (x >= this.x1 || x + w <= this.x0 || y >= this.y1 || y + h <= this.y0) return false;
    const { cw, ch, cells } = this;
    // Truncation, not Math.floor: spiralPlace has already clamped the
    // candidate inside the canvas, so these can never go negative.
    const c0 = (x / cw) | 0, c1 = ((x + w) / cw) | 0;
    const r0 = (y / ch) | 0, r1 = ((y + h) / ch) | 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const b = cells[r * GRID_COLS + c];
        if (!b) continue;
        for (let i = 0; i < b.length; i += 4) {
          if (x < b[i] + b[i + 2] && x + w > b[i]
              && y < b[i + 1] + b[i + 3] && y + h > b[i + 1]) return true;
        }
      }
    }
    return false;
  }

  add(x, y, w, h) {
    if (x < this.x0) this.x0 = x;
    if (y < this.y0) this.y0 = y;
    if (x + w > this.x1) this.x1 = x + w;
    if (y + h > this.y1) this.y1 = y + h;
    const { cw, ch, cells } = this;
    const c0 = (x / cw) | 0, c1 = ((x + w) / cw) | 0;
    const r0 = (y / ch) | 0, r1 = ((y + h) / ch) | 0;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        const k = r * GRID_COLS + c;
        (cells[k] || (cells[k] = [])).push(x, y, w, h);
      }
    }
  }
}

/**
 * Walk an Archimedean spiral outward from the centre, returning the first
 * position where this box touches nothing already placed.
 * @returns {{x:number,y:number}|null}
 */
function spiralPlace(placed, W, H, w, h) {
  if (w > W - 8 || h > H - 8) return null;
  const cx = W / 2 - w / 2;
  const cy = H / 2 - h / 2;
  const maxX = W - 4 - w;
  const maxY = H - 4 - h;
  for (let t = 0; t < SPIRAL_STEPS; t += 1) {
    const x = cx + SPIRAL[t * 2];
    const y = cy + SPIRAL[t * 2 + 1];
    if (x < 4 || y < 4 || x > maxX || y > maxY) continue;
    if (!placed.hits(x, y, w, h)) return { x, y };
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
    if (state.rows.length) container.textContent = '';
    state.rows = [];
    const waiting = !opts.hidden && opts.awaiting !== false;
    emptyCard(container, state,
      opts.hidden ? 'hidden' : waiting ? 'waiting' : 'none',
      opts.hidden ? 'Responses hidden'
        : waiting ? 'Waiting for responses…' : 'No responses.');
    return;
  }
  clearEmptyCard(state);

  const root = container;
  const colors = palette(root, 5);

  // Only the presenter can bin a response. Everywhere else — the archive,
  // the comparison view, the shared-results panel on a student's phone —
  // the button did nothing but still took a tab stop and announced itself,
  // so a keyboard user walked thirty phantom "Remove this response".
  const allowDelete = opts.allowDelete === true;
  if (state.allowDelete !== allowDelete && state.rows.length) {
    container.textContent = '';
    state.rows = [];
  }
  state.allowDelete = allowDelete;

  while (state.rows.length < entries.length) {
    const i = state.rows.length;
    const card = el('div', 'answer-card');
    const rail = el('span', 'answer-rail');
    const text = el('p', 'answer-text');
    card.append(rail, text);
    if (allowDelete) {
      const actions = el('div', 'answer-actions');
      const del = el('button', 'answer-delete', '×');
      del.type = 'button';
      del.title = 'Remove this response';
      del.setAttribute('aria-label', 'Remove this response');
      actions.append(del);
      card.append(actions);
    }
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
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (isNew) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = spot(el('div', 'scale-row'), i);
    const label = el('div', 'scale-label');
    const track = el('div', 'scale-track');
    const dist = el('div', 'scale-dist');
    const marker = el('div', 'scale-marker');
    const halo = el('span', 'scale-halo');
    marker.append(halo);
    // calibration anchor (roadmap feature 5): the instructor's own rating,
    // revealed against the class distribution for rubric norming
    const anchor = el('span', 'scale-anchor');
    track.append(dist, anchor, marker);
    const avg = el('div', 'scale-avg');
    row.append(label, track, avg);
    row.style.setProperty('--row-i', String(i));
    container.append(row);

    const ticks = [];
    for (let v = 0; v < steps; v += 1) {
      const tick = el('span', 'scale-tick');
      dist.append(tick);
      ticks.push(tick);
    }
    state.rows.push({ row, label, dist, marker, halo, anchor, avg, ticks });
    state.group.set(`in:${i}`, 1, isNew ? { from: 0, preset: 'smooth' } : {});
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  // anchors show only when the presenter reveals them (post-rating), so
  // the instructor's number can't bias the ratings it will be compared to
  const anchors = Array.isArray(opts.anchors) ? opts.anchors : null;
  let anyAnchor = false;
  state.rows.forEach((r, i) => {
    const aVal = anchors ? anchors[i] : null;
    const show = aVal != null && Number.isFinite(Number(aVal))
      && opts.showAnchors && !opts.hidden;
    if (aVal != null && Number.isFinite(Number(aVal))) {
      r.anchor.style.left = `${((Number(aVal) - min) / span) * 100}%`;
    }
    r.anchor.classList.toggle('is-visible', !!show);
    if (show) anyAnchor = true;
  });
  if (anyAnchor && !state.meta.anchorNote) {
    state.meta.anchorNote = el('p', 'anchor-note', "◆ the instructor's rating");
    container.append(state.meta.anchorNote);
  } else if (!anyAnchor && state.meta.anchorNote) {
    state.meta.anchorNote.remove();
    state.meta.anchorNote = null;
  }

  const prevTotals = state.meta.lastTotals || null;
  const newTotals = [];
  agg.statements.forEach((st, i) => {
    const r = state.rows[i];
    if (r.label.textContent !== st.label) r.label.textContent = st.label;
    const peak = Math.max(1, ...Object.values(st.dist || {}));

    // an answer landing on this statement ripples a ring off the marker
    const stTotal = Object.values(st.dist || {}).reduce((a, b) => a + b, 0);
    newTotals.push(stTotal);
    if (!opts.hidden && prevTotals && stTotal > prevTotals[i]
        && !prefersReducedMotion()) {
      r.halo.animate(
        [{ opacity: 0.8, transform: 'scale(.5)' }, { opacity: 0, transform: 'scale(1.6)' }],
        { duration: 650, easing: 'cubic-bezier(0, 0, .2, 1)' },
      );
    }
    for (let k = 0; k < steps; k += 1) {
      const c = (st.dist || {})[min + k] || 0;
      state.group.set(`t:${i}:${k}`, opts.hidden ? 0 : c / peak);
    }
    const hasAvg = st.avg != null && !opts.hidden;
    state.group.set(`m:${i}`, hasAvg ? (st.avg - min) / span : 0);
    state.group.set(`o:${i}`, hasAvg ? 1 : 0);
    state.group.set(`v:${i}`, hasAvg ? st.avg : 0, { preset: 'precise' });
  });
  state.meta.lastTotals = newTotals;

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    const accent2 = token(root, '--accent-2', '#b45309');
    // Colour encodes WHERE on the scale a bar sits: the low end wears one
    // accent, the high end the other, and the neutral middle desaturates
    // (RGB interpolation dips through a muted midtone — here that is a
    // feature). Now the histogram reads as "mass is low" or "mass is high"
    // at a glance, instead of a row of identical blue the eye can't parse.
    const rampAt = (t) => mixColor(accent2, accent, Math.min(1, Math.max(0, t)));
    state.rows.forEach((r, i) => {
      const enter = g.get(`in:${i}`, 1);
      r.row.style.opacity = String(enter);

      r.ticks.forEach((tick, k) => {
        const t = steps > 1 ? k / (steps - 1) : 0.5;
        const hgt = Math.max(0, g.get(`t:${i}:${k}`)) * 100;
        const c = rampAt(t);
        tick.style.left = `${t * 100}%`;
        tick.style.height = `${hgt * enter}%`;
        tick.style.background = `linear-gradient(180deg, ${rgba(c, 0.9)}, ${rgba(c, 0.5)})`;
      });

      const m = g.get(`m:${i}`);
      const op = g.get(`o:${i}`);
      // the mean dot takes the colour of the point it rests on, so its
      // hue reinforces the number beside it
      const mc = rampAt(m);
      r.marker.style.left = `${m * 100}%`;
      r.marker.style.opacity = String(op);
      r.marker.style.background = mc;
      r.marker.style.boxShadow = `0 0 0 .28em ${rgba(mc, 0.20)}, 0 2px 8px ${rgba(mc, 0.45)}`;

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
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);
  state.meta.awaiting = awaiting;

  if (isNew) state.group = new SpringGroup(() => state.paint?.(), PRESETS.bouncy);

  // Rows are absolutely stacked and translated by index, so this height
  // and .rank-row's have to agree exactly. They used to be two literals
  // in two files with a comment asking the next person to keep them in
  // step; now JS owns the number and the stylesheet reads it back.
  const ROW_H = 3.0; // em
  container.style.setProperty('--rank-row-h', `${ROW_H}em`);

  while (state.rows.length < n) {
    const i = state.rows.length;
    const row = spot(el('div', 'rank-row'), i);
    const place = el('div', 'rank-place');
    const label = el('div', 'rank-label');
    const track = el('div', 'rank-track');
    const fill = el('div', 'rank-fill');
    track.append(fill);
    const points = el('div', 'rank-points');
    row.append(place, label, track, points);
    row.style.setProperty('--row-i', String(i));
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

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const inkSoft = token(root, '--ink-soft', '#667');
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
      // While awaiting, a printed rank would imply an order nobody chose.
      const rankTxt = opts.hidden || state.meta.awaiting ? '–' : String(rank);
      if (r.place.textContent !== rankTxt) r.place.textContent = rankTxt;
      // --ink-soft, not a 55% wash of --ink: the token carries a guaranteed
      // 4.5:1 floor in every theme, an alpha wash carries whatever it lands on
      r.place.style.color = rank === 1 && !state.meta.awaiting ? c : inkSoft;

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
    // clear the "ask it a second time" card if it was showing
    container.querySelectorAll(':scope > .chart-empty').forEach((p) => p.remove());
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
  // lets the projector stylesheet size the view from its row count so
  // the summary sentence can never fall off the bottom of a 720p screen
  container.style.setProperty('--delta-rows', String(n));

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

  // First showing of a comparison: the ghosts (round one) land at once,
  // then each row's "after" mark sets off FROM its ghost a beat later,
  // its ± number rolling with it — the eye reads "the room was here,
  // and then it moved". Later repaints (votes still arriving in round
  // two) retarget everything directly.
  const firstShow = !state.meta.aShown;
  state.meta.aShown = true;

  items.forEach((item, i) => {
    const r = state.rows[i];
    r.label.textContent = item.label || `Option ${i + 1}`;
    r.__color = colors[i] || colors[0];

    let bT; let aT; let dT;
    if (isScales) {
      const span = Math.max(1, delta.max - delta.min);
      bT = item.beforeAvg == null ? 0 : (item.beforeAvg - delta.min) / span;
      aT = item.afterAvg == null ? 0 : (item.afterAvg - delta.min) / span;
      dT = item.deltaAvg ?? 0;
      r.__digits = 1;
      r.__suffix = '';
    } else {
      bT = item.beforePct / 100;
      aT = item.afterPct / 100;
      dT = item.deltaPct;
      r.__digits = 0;
      r.__suffix = '%';
    }

    state.group.set(`b:${i}`, bT);
    if (firstShow) {
      state.group.set(`a:${i}`, bT, { from: bT });
      state.group.set(`d:${i}`, 0, { preset: 'precise' });
      delay(0.24 + stagger(i, 0.05, 0.3), () => {
        if (container.__chart !== state) return;
        state.group.set(`a:${i}`, aT);
        state.group.set(`d:${i}`, dT);
      });
    } else {
      state.group.set(`a:${i}`, aT);
      state.group.set(`d:${i}`, dT);
    }
  });

  if (state.meta.head) {
    state.meta.head.children[0].textContent =
      `${delta.beforeLabel || 'First ask'} · ${delta.beforeTotal ?? 0}`;
    state.meta.head.children[1].textContent =
      `${delta.afterLabel || 'After discussion'} · ${delta.afterTotal ?? 0}`;
  }

  // "42% of the room changed their answer" — the sentence that makes
  // the whole re-ask feature land with a lecture theatre. The number is
  // the headline of the slide: display type at chart scale, counting up
  // as the bars move (a tween, not a spring — counters never overshoot).
  if (Number.isFinite(delta.moved)) {
    if (!state.meta.summary) {
      state.meta.summary = el('p', 'delta-summary');
      state.meta.summaryNum = el('span', 'delta-summary-num');
      state.meta.summaryRest = el('span', 'delta-summary-rest');
      state.meta.summary.append(state.meta.summaryNum, state.meta.summaryRest);
      container.append(state.meta.summary);
      state.meta.shownMoved = null;
    }
    const pct = Math.round(delta.moved);
    if (pct > 0) {
      // Overridable for the same reason beforeLabel/afterLabel are. Asked
      // twice in one session it is one room changing its mind; compared
      // across two sessions it is two different rooms, and saying "the
      // room changed their answer" there would be a plain falsehood.
      state.meta.summaryRest.textContent =
        delta.movedLabel || 'of the room changed their answer.';
      if (state.meta.shownMoved !== pct) {
        const from = state.meta.shownMoved ?? 0;
        state.meta.movedTween?.();
        state.meta.movedTween = countTo(from, pct, 0.9, (v) => {
          state.meta.summaryNum.textContent = `${Math.round(v)}%`;
        });
        state.meta.shownMoved = pct;
      }
    } else {
      state.meta.movedTween?.();
      state.meta.movedTween = null;
      state.meta.shownMoved = 0;
      state.meta.summaryNum.textContent = '';
      state.meta.summaryRest.textContent =
        delta.unchangedLabel || 'Nobody changed their answer.';
    }
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
    // the board may have shown "No quiz answers yet." moments ago
    container.querySelectorAll(':scope > .chart-empty').forEach((p) => p.remove());
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.bouncy);
    // No "nicknames are random, no names are collected" note. It was
    // projected to the whole room, and telling a class its answers cannot
    // be traced reads as permission rather than reassurance.
    state.meta.body = el('div', 'lb-body');
    container.append(state.meta.body);
    state.meta.byName = new Map();
  }

  const ROW_H = 2.6; // em — see the note in the ranking chart
  state.meta.body.style.setProperty('--lb-row-h', `${ROW_H}em`);
  const best = Math.max(1, top[0].score);
  const seen = new Set();

  // First showing: the board builds top-down, one row per beat, instead
  // of the whole table dropping in at once. Names arriving later still
  // slide in immediately.
  const firstFill = isNew && top.length > 1;
  if (!state.meta.pendingEnter) state.meta.pendingEnter = new Set();

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
      if (firstFill) {
        state.group.set(`y:${entry.pseudonym}`, i + 1.2, { from: i + 1.2 });
        state.group.set(`in:${entry.pseudonym}`, 0, { from: 0, preset: 'smooth' });
        state.meta.pendingEnter.add(entry.pseudonym);
        delay(stagger(i, 0.07, 0.5), () => {
          if (container.__chart !== state) return;
          state.meta.pendingEnter.delete(entry.pseudonym);
          state.group.set(`y:${entry.pseudonym}`, i);
          state.group.set(`in:${entry.pseudonym}`, 1);
        });
      } else {
        state.group.set(`y:${entry.pseudonym}`, i, { from: i + 1.2 });
        state.group.set(`in:${entry.pseudonym}`, 1, { from: 0, preset: 'smooth' });
      }
    }
    r.name.textContent = entry.pseudonym;

    // A place changing hands washes the row — rows have no CSS
    // background of their own, so a one-shot WAAPI animation conflicts
    // with nothing (transform stays spring-owned, and the className
    // rebuild below cannot clobber an animation).
    //
    // Both directions, and they are deliberately not symmetrical. A
    // climb washes the accent and holds; a fall washes neutral and
    // clears faster. Without the second half the board only ever told
    // half the story — someone overtaking was lit up while the person
    // they overtook simply slid down in silence, which reads as a
    // rendering artefact rather than as the thing that just happened.
    // Intensity scales with the size of the move (capped), so gaining
    // four places is visibly bigger news than gaining one.
    if (r.__rank != null && entry.rank !== r.__rank && !prefersReducedMotion()) {
      const climbed = entry.rank < r.__rank;
      const places = Math.min(4, Math.abs(entry.rank - r.__rank));
      const weight = 0.55 + (places / 4) * 0.45;
      const tint = climbed
        ? rgba(token(root, '--accent', '#1d4ed8'), 0.16 * weight)
        : rgba(token(root, '--ink', '#0b1220'), 0.07 * weight);
      r.row.animate(
        [{ background: tint }, { background: 'transparent' }],
        {
          duration: climbed ? 900 : 520,
          easing: 'cubic-bezier(0, 0, .2, 1)',
        },
      );
    }

    if (!state.meta.pendingEnter.has(entry.pseudonym)) {
      state.group.set(`y:${entry.pseudonym}`, i);
    }
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
// Opinion spectrum (pedagogy roadmap, feature 10)
//
// One statement, one axis, every answer an anonymous dot. Deliberately
// no average marker — the SHAPE is the content. Dots are keyed by
// pseudonym so the same dot migrates when the question is re-asked
// (position is a quantity: critically damped, never bouncy).
// =====================================================================

export function renderSpectrum(container, agg, opts = {}) {
  const state = useChart(container, 'spectrum');
  const root = container;
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const wrap = el('div', 'spectrum-wrap');
    const ends = el('div', 'spectrum-ends');
    const left = el('span', 'spectrum-end', opts.leftLabel || 'Disagree');
    const right = el('span', 'spectrum-end', opts.rightLabel || 'Agree');
    ends.append(left, right);
    const field = el('div', 'spectrum-field');
    const axis = el('div', 'spectrum-axis');
    field.append(axis);
    wrap.append(ends, field);
    container.append(wrap);
    Object.assign(state.meta, { field, left, right, dots: new Map(), cornerEls: null });
  }

  if (opts.leftLabel && state.meta.left.textContent !== opts.leftLabel) {
    state.meta.left.textContent = opts.leftLabel;
  }
  if (opts.rightLabel && state.meta.right.textContent !== opts.rightLabel) {
    state.meta.right.textContent = opts.rightLabel;
  }

  // four-corners variant: bin counts along the axis
  if (opts.corners) {
    if (!state.meta.cornerEls) {
      const row = el('div', 'spectrum-corners');
      state.meta.cornerEls = [0, 1, 2, 3].map((i) => {
        const chip = el('span', 'spectrum-corner');
        chip.style.left = `${12.5 + i * 25}%`;
        row.append(chip);
        return chip;
      });
      state.meta.field.append(row);
    }
    (agg.corners || [0, 0, 0, 0]).forEach((n, i) => {
      const txt = opts.hidden ? '—' : String(n);
      if (state.meta.cornerEls[i].textContent !== txt) state.meta.cornerEls[i].textContent = txt;
    });
  }

  const seen = new Set();
  const beforeByKey = new Map(
    (opts.beforePoints || []).map((p, i) => [p.pseudonym || `i:${i}`, p.pos]));

  (agg.points || []).forEach((pt, i) => {
    const key = pt.pseudonym || `i:${i}`;
    seen.add(key);
    let dot = state.meta.dots.get(key);
    if (!dot) {
      dot = el('span', 'spectrum-dot');
      // stable vertical lane per dot: identity without identification
      dot.style.top = `${16 + (hashStr(key) % 68)}%`;
      state.meta.field.append(dot);
      state.meta.dots.set(key, dot);
      const from = beforeByKey.has(key) ? beforeByKey.get(key) : pt.pos;
      state.group.set(`x:${key}`, from, { from });
      state.group.set(`s:${key}`, 1, { from: 0, preset: 'bouncy' });
      if (beforeByKey.has(key)) {
        // migration: land on the old position, then set off for the new
        delay(0.5 + stagger(i, 0.02, 0.4), () => {
          if (container.__chart !== state) return;
          state.group.set(`x:${key}`, pt.pos);
        });
      }
    } else {
      state.group.set(`x:${key}`, pt.pos);
    }
    state.group.set(`s:${key}`, opts.hidden ? 0 : 1);
  });

  state.meta.dots.forEach((dot, key) => {
    if (seen.has(key)) return;
    state.group.set(`s:${key}`, 0);
    delay(0.4, () => {
      const s = state.group.springs.get(`s:${key}`);
      if (s && s.target > 0) return;
      if (state.meta.dots.get(key) !== dot) return;
      dot.remove();
      state.meta.dots.delete(key);
      state.group.forget(`x:${key}`);
      state.group.forget(`s:${key}`);
    });
  });

  awaitNote(container, state, awaiting, 'Waiting for the first position…');

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    state.meta.dots.forEach((dot, key) => {
      const x = g.get(`x:${key}`, 50);
      const s = Math.max(0, g.get(`s:${key}`, 1));
      // 0 and 100 sit fully inside the field instead of clipping its edge
      dot.style.left = `${3 + x * 0.94}%`;
      dot.style.transform = `translate(-50%, -50%) scale(${s.toFixed(3)})`;
      dot.style.opacity = String(Math.min(1, s * 1.2));
      dot.style.background = accent;
      dot.style.boxShadow = `0 2px 8px ${rgba(accent, 0.35)}`;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Writing showdown (pedagogy roadmap, feature 4)
//
// Two or three anonymous samples set as typography, voted on. The reveal
// is deliberately quiet — no confetti, no winner banner: samples come
// from the room, and the discussion of the rationales is the point.
// =====================================================================

export function renderShowdown(container, agg, opts = {}) {
  const state = useChart(container, 'showdown');
  const root = container;
  const n = (agg.samples || []).length;
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    state.meta.grid = el('div', 'sample-grid');
    container.append(state.meta.grid);
  }

  while (state.rows.length < n) {
    const i = state.rows.length;
    const card = spot(el('div', 'sample-card'), i);
    const tag = el('span', 'sample-tag', String.fromCharCode(65 + i));
    const quote = el('blockquote', 'sample-quote');
    const track = el('div', 'sample-track');
    const fill = el('div', 'sample-fill');
    track.append(fill);
    const meta = el('div', 'sample-meta');
    const pct = el('span', 'sample-pct');
    const count = el('span', 'sample-count');
    meta.append(pct, count);
    card.append(tag, quote, track, meta);
    state.meta.grid.append(card);
    state.rows.push({ card, quote, fill, pct, count });
    state.group.set(`in:${i}`, 1, { from: 0, preset: 'smooth' });
  }
  while (state.rows.length > n) state.rows.pop().card.remove();

  const max = Math.max(1, ...(agg.samples || []).map((s) => s.count));
  (agg.samples || []).forEach((s, i) => {
    const r = state.rows[i];
    if (r.quote.textContent !== s.text) r.quote.textContent = s.text;
    state.group.set(`w:${i}`, opts.hidden ? 0 : s.count / max);
    state.group.set(`p:${i}`, opts.hidden ? 0 : s.pct, { preset: 'precise' });
    state.group.set(`c:${i}`, opts.hidden ? 0 : s.count, { preset: 'precise' });
  });

  // rationale stream: one line per approved rationale, shown on reveal
  const rationales = (!opts.hidden && opts.showRationales)
    ? (agg.rationales || []) : [];
  if (rationales.length) {
    if (!state.meta.stream) {
      state.meta.stream = el('div', 'rationale-stream');
      container.append(state.meta.stream);
      state.meta.streamRows = [];
    }
    while (state.meta.streamRows.length < rationales.length) {
      const row = el('p', 'rationale-line');
      state.meta.stream.append(row);
      state.meta.streamRows.push(row);
      if (!prefersReducedMotion()) {
        row.animate(
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
          { duration: 360, easing: 'cubic-bezier(.22,.9,.28,1)' },
        );
      }
    }
    while (state.meta.streamRows.length > rationales.length) {
      state.meta.streamRows.pop().remove();
    }
    rationales.forEach((r, i) => {
      const txt = `${String.fromCharCode(65 + r.choice)}: ${r.text}`;
      if (state.meta.streamRows[i].textContent !== txt) {
        state.meta.streamRows[i].textContent = txt;
      }
    });
  } else if (state.meta.stream) {
    state.meta.stream.remove();
    state.meta.stream = null;
    state.meta.streamRows = [];
  }

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    state.rows.forEach((r, i) => {
      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      r.fill.style.width = `${w}%`;
      r.fill.style.background = accent;
      const pctTxt = opts.hidden ? '—' : `${Math.round(g.get(`p:${i}`))}%`;
      const cntTxt = opts.hidden ? '' : NUM.format(Math.round(g.get(`c:${i}`)));
      if (r.pct.textContent !== pctTxt) r.pct.textContent = pctTxt;
      if (r.count.textContent !== cntTxt) r.count.textContent = cntTxt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Passage heatmap (pedagogy roadmap, feature 3)
//
// The passage itself is the chart: each segment's background carries the
// room's attention as heat. In classify mode each segment also shows how
// the room labelled it (claim / evidence / warrant…), and the
// disagreement is the lesson.
// =====================================================================

export function renderHeatmap(container, agg, opts = {}) {
  const state = useChart(container, 'heatmap');
  const root = container;
  const segs = agg.segments || [];
  const isClassify = agg.mode === 'classify';
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    state.meta.passage = el('p', 'passage');
    container.append(state.meta.passage);
    if (isClassify && agg.labels.length) {
      state.meta.legend = el('div', 'heat-legend');
      const colors = palette(root, Math.max(2, agg.labels.length));
      agg.labels.forEach((label, li) => {
        const chip = el('span', 'heat-legend-chip', label);
        chip.style.setProperty('--chip-color', colors[li % colors.length]);
        state.meta.legend.append(chip);
      });
      container.append(state.meta.legend);
    }
  }

  while (state.rows.length < segs.length) {
    const i = state.rows.length;
    const seg = el('span', 'passage-seg');
    spot(seg, i);
    const text = el('span', 'passage-seg-text');
    const chip = el('sup', 'seg-count');
    seg.append(text, chip);
    state.meta.passage.append(seg, document.createTextNode(' '));
    state.rows.push({ seg, text, chip });
    state.group.set(`in:${i}`, 1, { from: 0, preset: 'smooth' });
  }
  while (state.rows.length > segs.length) {
    const dead = state.rows.pop();
    dead.seg.nextSibling?.remove();
    dead.seg.remove();
  }

  const labelColors = isClassify && agg.labels.length
    ? palette(root, Math.max(2, agg.labels.length)) : null;

  segs.forEach((s, i) => {
    const r = state.rows[i];
    if (r.text.textContent !== s.text) r.text.textContent = s.text;
    state.group.set(`h:${i}`, opts.hidden ? 0 : s.heat);
    state.group.set(`c:${i}`, opts.hidden ? 0 : s.count, { preset: 'precise' });
    // classify: tint each segment toward its winning label's colour
    if (labelColors && s.tags) {
      let top = -1;
      let topCount = 0;
      s.tags.forEach((c, li) => { if (c > topCount) { topCount = c; top = li; } });
      r.__labelColor = top >= 0 ? labelColors[top % labelColors.length] : null;
      const title = top >= 0 && !opts.hidden
        ? `${agg.labels[top]} × ${topCount}` : '';
      if (r.seg.title !== title) r.seg.title = title;
      // The winning label, written on the segment.
      //
      // A colour that means "warrant" is a lookup: find the chip in the
      // legend, match the hue, carry the word back to the sentence — and
      // the tooltip that carried the answer before is unreachable on a
      // projector, where there is no pointer to hover with. Three letters
      // beside the count is the whole trip, in place.
      r.__labelTag = top >= 0 && !opts.hidden
        ? String(agg.labels[top] || '').slice(0, 3).toLowerCase() : '';
    } else {
      r.__labelColor = null;
      r.__labelTag = '';
    }
  });

  awaitNote(container, state, awaiting, 'Waiting for the first tap…');

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    state.rows.forEach((r, i) => {
      const h = Math.max(0, g.get(`h:${i}`));
      const c = Math.round(g.get(`c:${i}`));
      const color = r.__labelColor || accent;
      r.seg.style.background = h > 0.01 ? rgba(color, 0.14 + h * 0.34) : 'transparent';
      r.seg.style.boxShadow = h > 0.6 ? `inset 0 -2px 0 ${rgba(color, 0.75)}` : 'none';
      const chipTxt = c > 0 ? `${r.__labelTag ? `${r.__labelTag} ` : ''}${c}` : '';
      if (r.chip.textContent !== chipTxt) r.chip.textContent = chipTxt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Instructions — the one slide that isn't a chart
//
// This is what the room sees while sixty phones are still finding the
// page: numbered steps on the left, the QR and the code as big as they
// will go on the right. Everything is rebuilt on paint rather than
// spring-updated, because nothing here is live data — no counts arrive,
// nothing moves, and that stillness is the point while people read it.
// =====================================================================

export function renderInstructions(container, opts = {}) {
  const { steps = [], note = '', showJoin = true, url = '', code = '', qrSVGText = null } = opts;

  container.textContent = '';
  container.dataset.chart = 'instructions';

  const wrap = el('div', 'instructions-slide');
  if (!showJoin) wrap.classList.add('is-textonly');

  const list = el('ol', 'instr-steps');
  steps.filter((s) => String(s || '').trim()).forEach((step, i) => {
    const li = el('li', 'instr-step');
    li.append(el('span', 'instr-step-num', String(i + 1)));
    li.append(el('span', 'instr-step-text', step));
    list.append(li);
  });
  if (list.children.length) wrap.append(list);

  if (showJoin) {
    const card = el('div', 'instr-join');
    const qr = el('div', 'instr-qr');
    if (qrSVGText) qr.innerHTML = qrSVGText;
    else qr.dataset.qrFailed = '1';
    card.append(qr);

    const meta = el('div', 'instr-join-meta');
    meta.append(el('span', 'instr-join-label', 'Go to'));
    meta.append(el('span', 'instr-join-url', url));
    meta.append(el('span', 'instr-join-label', 'Code'));
    meta.append(el('span', 'instr-join-code', code));
    card.append(meta);
    wrap.append(card);
  }

  if (note) wrap.append(el('p', 'instr-note', note));

  container.append(wrap);
  return undefined;
}

// =====================================================================
// Traffic light
//
// The one chart in here that is allowed a fixed three-colour scale,
// because the colours ARE the question: a room answering "green / amber
// / red" has already agreed what the colours mean, and recolouring them
// to the deck accent would throw that away.
// =====================================================================

export function renderTrafficLight(container, agg, opts = {}) {
  const state = useChart(container, 'traffic');
  const root = container;
  const rows = agg.options || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < rows.length) {
    const lamp = el('div', 'traffic-lamp');
    const dot = el('span', 'traffic-dot');
    const body = el('div', 'traffic-body');
    const label = el('div', 'traffic-label');
    const track = el('div', 'traffic-track');
    const fill = el('div', 'traffic-fill');
    track.append(fill);
    body.append(label, track);
    const num = el('div', 'traffic-num');
    lamp.append(dot, body, num);
    container.append(lamp);
    state.rows.push({ lamp, dot, label, fill, num });
  }
  while (state.rows.length > rows.length) state.rows.pop().lamp.remove();

  rows.forEach((o, i) => {
    const r = state.rows[i];
    if (r.label.textContent !== o.label) r.label.textContent = o.label;
    state.group.set(`w:${i}`, opts.hidden ? 0 : o.pct / 100);
    state.group.set(`c:${i}`, opts.hidden ? 0 : o.count, { preset: 'precise' });
  });

  awaitNote(container, state, awaiting, 'Waiting for the first hand…');

  function paint() {
    const g = state.group;
    const good = token(root, '--good', '#15803d');
    const warn = token(root, '--accent-2', '#b45309');
    const bad = token(root, '--bad', '#b91c1c');
    const lamps = [good, warn, bad];
    state.rows.forEach((r, i) => {
      const c = lamps[i] || lamps[2];
      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      r.fill.style.width = `${w.toFixed(2)}%`;
      r.fill.style.background = `linear-gradient(180deg, ${mixColor(c, '#ffffff', 0.12)}, ${c})`;
      r.fill.style.boxShadow = w > 0.5 ? `0 4px 16px ${rgba(c, 0.3)}` : 'none';
      r.dot.style.background = c;
      // the lamp brightens with its share, the way a real one would
      r.dot.style.opacity = String(0.25 + 0.75 * Math.min(1, w / 55));
      r.dot.style.boxShadow = `0 0 ${(4 + w * 0.22).toFixed(1)}px ${rgba(c, 0.55)}`;
      const n = Math.round(g.get(`c:${i}`));
      const txt = opts.hidden ? '—' : NUM.format(n);
      if (r.num.textContent !== txt) r.num.textContent = txt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Mood check — the icons themselves, sized by how many chose them
// =====================================================================

export function renderMood(container, agg, opts = {}) {
  const state = useChart(container, 'mood');
  const root = container;
  const rows = agg.options || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.bouncy);
    state.meta.row = el('div', 'mood-row');
    container.append(state.meta.row);
  }

  while (state.rows.length < rows.length) {
    const i = state.rows.length;
    const cell = spot(el('div', 'mood-cell'), i);
    const glyph = el('div', 'mood-glyph');
    const label = el('div', 'mood-label');
    const num = el('div', 'mood-num');
    cell.append(glyph, label, num);
    state.meta.row.append(cell);
    state.rows.push({ cell, glyph, label, num });
    state.group.set(`s:${i}`, 1, { from: 0.4 });
  }
  while (state.rows.length > rows.length) state.rows.pop().cell.remove();

  const max = Math.max(1, ...rows.map((o) => o.count));
  rows.forEach((o, i) => {
    const r = state.rows[i];
    if (r.glyph.textContent !== o.emoji) r.glyph.textContent = o.emoji || '•';
    if (r.label.textContent !== (o.label || '')) r.label.textContent = o.label || '';
    // Size is share of the WINNER, not of the room: with five icons and a
    // flat split nothing would grow at all, and a flat split is itself a
    // result worth being able to see.
    state.group.set(`s:${i}`, opts.hidden ? 0.55 : 0.55 + 0.45 * (o.count / max));
    state.group.set(`c:${i}`, opts.hidden ? 0 : o.count, { preset: 'precise' });
  });

  awaitNote(container, state, awaiting, 'Waiting for the first answer…');

  function paint() {
    const g = state.group;
    const inkSoft = token(root, '--ink-soft', '#667');
    state.rows.forEach((r, i) => {
      const s = Math.max(0.2, g.get(`s:${i}`, 1));
      r.glyph.style.transform = `scale(${s.toFixed(3)})`;
      r.cell.style.opacity = String(0.45 + 0.55 * Math.min(1, s));
      const n = Math.round(g.get(`c:${i}`));
      const txt = opts.hidden ? '—' : NUM.format(n);
      if (r.num.textContent !== txt) r.num.textContent = txt;
      r.num.style.color = inkSoft;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// This or That — a rope per pair, with a knot where the room is pulling
// =====================================================================

export function renderTugOfWar(container, agg, opts = {}) {
  const state = useChart(container, 'tug');
  const root = container;
  const pairs = agg.pairs || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < pairs.length) {
    const i = state.rows.length;
    const row = spot(el('div', 'tug-row'), i);
    const left = el('div', 'tug-side tug-left');
    const leftName = el('span', 'tug-name');
    const leftNum = el('span', 'tug-num');
    left.append(leftName, leftNum);
    const rope = el('div', 'tug-rope');
    const fill = el('div', 'tug-fill');
    const knot = el('span', 'tug-knot');
    rope.append(fill, knot);
    const right = el('div', 'tug-side tug-right');
    const rightNum = el('span', 'tug-num');
    const rightName = el('span', 'tug-name');
    right.append(rightNum, rightName);
    row.append(left, rope, right);
    container.append(row);
    state.rows.push({ row, leftName, leftNum, rightName, rightNum, fill, knot });
    state.group.set(`x:${i}`, 50, { from: 50 });
  }
  while (state.rows.length > pairs.length) state.rows.pop().row.remove();

  pairs.forEach((p, i) => {
    const r = state.rows[i];
    if (r.leftName.textContent !== p.left) r.leftName.textContent = p.left;
    if (r.rightName.textContent !== p.right) r.rightName.textContent = p.right;
    state.group.set(`x:${i}`, opts.hidden ? 50 : p.leftPct);
    state.group.set(`l:${i}`, opts.hidden ? 0 : p.leftCount, { preset: 'precise' });
    state.group.set(`r:${i}`, opts.hidden ? 0 : p.rightCount, { preset: 'precise' });
  });

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const a = token(root, '--accent', '#1d4ed8');
    const b = token(root, '--accent-2', '#b45309');
    state.rows.forEach((r, i) => {
      const x = g.get(`x:${i}`, 50);
      r.fill.style.width = `${x.toFixed(2)}%`;
      r.fill.style.background = a;
      r.knot.style.left = `${x.toFixed(2)}%`;
      // the knot takes the colour of whichever side is winning, and sits
      // neutral while the room is genuinely split
      const lead = Math.abs(x - 50);
      r.knot.style.background = lead < 2 ? token(root, '--ink', '#111') : (x > 50 ? a : b);
      r.knot.style.transform = `translate(-50%, -50%) scale(${(1 + lead / 140).toFixed(3)})`;
      r.row.style.setProperty('--tug-right', b);
      const ln = Math.round(g.get(`l:${i}`));
      const rn = Math.round(g.get(`r:${i}`));
      const lt = opts.hidden ? '—' : NUM.format(ln);
      const rt = opts.hidden ? '—' : NUM.format(rn);
      if (r.leftNum.textContent !== lt) r.leftNum.textContent = lt;
      if (r.rightNum.textContent !== rt) r.rightNum.textContent = rt;
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Budget split
//
// The bar is the room's money; the ticks under it are the individual
// wallets. Both, always — an average of 25 points is six people funding
// nothing and two funding everything just as easily as it is eight
// people agreeing, and those are opposite classroom situations.
// =====================================================================

export function renderBudget(container, agg, opts = {}) {
  const state = useChart(container, 'budget');
  const root = container;
  const rows = agg.options || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < rows.length) {
    const row = spot(el('div', 'budget-row'), state.rows.length);
    const label = el('div', 'budget-label');
    const track = el('div', 'budget-track');
    const fill = el('div', 'budget-fill');
    const spread = el('div', 'budget-spread');
    track.append(fill, spread);
    const share = el('div', 'budget-share');
    row.append(label, track, share);
    container.append(row);
    state.rows.push({ row, label, fill, spread, share, ticks: [] });
  }
  while (state.rows.length > rows.length) state.rows.pop().row.remove();

  const pot = agg.pot || 100;
  rows.forEach((o, i) => {
    const r = state.rows[i];
    if (r.label.textContent !== o.label) r.label.textContent = o.label;
    state.group.set(`w:${i}`, opts.hidden ? 0 : o.share / 100);
    state.group.set(`s:${i}`, opts.hidden ? 0 : o.share, { preset: 'precise' });

    // individual allocations, as ticks along the same axis the bar uses.
    // Capped: past a hundred the strip is a solid block and says less.
    const values = opts.hidden ? [] : (o.values || []).slice(-120);
    while (r.ticks.length < values.length) {
      const tick = el('span', 'budget-tick');
      r.spread.append(tick);
      r.ticks.push(tick);
    }
    while (r.ticks.length > values.length) r.ticks.pop().remove();
    values.forEach((v, k) => {
      const pctOfPot = Math.max(0, Math.min(1, v / pot));
      r.ticks[k].style.left = `${(pctOfPot * 100).toFixed(2)}%`;
      r.ticks[k].style.opacity = v === 0 ? '0.22' : '0.62';
    });
  });

  awaitNote(container, state, awaiting, 'Waiting for the first budget…');

  function paint() {
    const g = state.group;
    const c = token(root, '--accent', '#1d4ed8');
    state.rows.forEach((r, i) => {
      const w = Math.max(0, g.get(`w:${i}`)) * 100;
      r.fill.style.width = `${w.toFixed(2)}%`;
      r.fill.style.background =
        `linear-gradient(180deg, ${mixColor(c, '#ffffff', 0.12)}, ${c} 60%, ${mixColor(c, '#000000', 0.05)})`;
      r.fill.style.boxShadow = w > 0.5 ? `0 4px 14px ${rgba(c, 0.26)}` : 'none';
      const s = g.get(`s:${i}`, 0);
      const txt = opts.hidden ? '—' : `${Math.round(s)}%`;
      if (r.share.textContent !== txt) r.share.textContent = txt;
      r.ticks.forEach((t) => { t.style.background = token(root, '--ink', '#111'); });
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Probability slider — the room's belief as a distribution
//
// The median is printed, never the mean: one student typing 0 because
// they misread the question drags a mean across the whole scale, and the
// number the room is about to argue about should be robust to that.
// =====================================================================

export function renderProbability(container, agg, opts = {}) {
  const state = useChart(container, 'probability');
  const root = container;
  const bins = agg.bins || new Array(10).fill(0);
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const wrap = el('div', 'prob-wrap');
    const plot = el('div', 'prob-plot');
    const median = el('div', 'prob-marker prob-median');
    median.append(el('span', 'prob-marker-label', 'median'));
    const truth = el('div', 'prob-marker prob-truth');
    truth.append(el('span', 'prob-marker-label', 'actual'));
    plot.append(median, truth);
    const axis = el('div', 'prob-axis');
    ['0%', '50%', '100%'].forEach((t) => axis.append(el('span', 'prob-tick', t)));
    wrap.append(plot, axis);
    container.append(wrap);
    Object.assign(state.meta, { plot, median, truth });
  }

  while (state.rows.length < bins.length) {
    const i = state.rows.length;
    const col = el('div', 'prob-col');
    const bar = el('div', 'prob-bar');
    col.append(bar);
    state.meta.plot.append(col);
    state.rows.push({ col, bar });
    state.group.set(`h:${i}`, 0, { from: 0 });
  }
  while (state.rows.length > bins.length) state.rows.pop().col.remove();

  const max = Math.max(1, ...bins);
  bins.forEach((n, i) => {
    state.group.set(`h:${i}`, opts.hidden ? 0 : n / max);
  });
  state.group.set('median', agg.median == null ? 50 : agg.median);

  const showMedian = !opts.hidden && agg.median != null;
  state.meta.median.hidden = !showMedian;
  // The answer, if there is one, appears only once the room's guesses are
  // showing — revealing the truth beside hidden votes gives it away.
  const showTruth = !opts.hidden && agg.truth != null;
  state.meta.truth.hidden = !showTruth;
  if (showTruth) state.meta.truth.style.left = `${agg.truth}%`;

  awaitNote(container, state, awaiting, 'Waiting for the first estimate…');

  function paint() {
    const g = state.group;
    const c = token(root, '--accent', '#1d4ed8');
    state.rows.forEach((r, i) => {
      const h = Math.max(0, g.get(`h:${i}`)) * 100;
      r.bar.style.height = `${h.toFixed(2)}%`;
      r.bar.style.background =
        `linear-gradient(180deg, ${mixColor(c, '#ffffff', 0.14)}, ${c})`;
      r.bar.style.boxShadow = h > 1 ? `0 -2px 12px ${rgba(c, 0.22)}` : 'none';
    });
    if (showMedian) state.meta.median.style.left = `${g.get('median', 50).toFixed(2)}%`;
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Fill in the blank
//
// The sentence stays a sentence. Each blank grows into a small stack of
// what the room actually wrote, commonest on top — so the slide reads as
// "the class filled this in" rather than as a bar chart that happens to
// have words on it.
// =====================================================================

export function renderCloze(container, agg, opts = {}) {
  const state = useChart(container, 'cloze');
  const root = container;
  const parts = agg.parts || [];
  const blanks = agg.blanks || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  // The sentence itself is structure, not data: rebuild only when the
  // instructor's text actually changes.
  const shape = parts.map((p) => (p.kind === 'text' ? `t:${p.text}` : 'b')).join('|');
  if (!state.group || state.meta.shape !== shape) {
    state.group?.destroy();
    container.textContent = '';
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    state.rows = [];
    state.meta = { shape, awaitNote: null };
    const line = el('p', 'cloze-line');
    let blankIndex = 0;
    parts.forEach((p) => {
      if (p.kind === 'text') {
        line.append(el('span', 'cloze-text', p.text));
        return;
      }
      const slot = el('span', 'cloze-slot');
      slot.dataset.blank = String(blankIndex);
      line.append(slot);
      state.rows.push({ slot, chips: [] });
      blankIndex += 1;
    });
    container.append(line);
  }

  // The key rings only once the presenter has closed and revealed — see
  // paintChart in present-page.js. A ringed chip beside a still-open
  // question is the answer, printed on the wall.
  const reveal = !opts.hidden && opts.revealCorrect !== false;

  state.rows.forEach((r, i) => {
    const b = blanks[i];
    const answers = (opts.hidden || !b) ? [] : (b.answers || []).slice(0, 3);
    while (r.chips.length < answers.length) {
      const chip = el('span', 'cloze-chip');
      const word = el('span', 'cloze-word');
      const count = el('span', 'cloze-count');
      chip.append(word, count);
      r.slot.append(chip);
      r.chips.push({ chip, word, count });
      if (!prefersReducedMotion()) {
        chip.animate(
          [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 320, easing: 'cubic-bezier(.22,.9,.28,1)' },
        );
      }
    }
    while (r.chips.length > answers.length) r.chips.pop().chip.remove();

    const top = Math.max(1, answers[0]?.count || 1);
    answers.forEach((a, k) => {
      const c = r.chips[k];
      if (c.word.textContent !== a.text) c.word.textContent = a.text;
      const cnt = NUM.format(a.count);
      if (c.count.textContent !== cnt) c.count.textContent = cnt;
      // commonest answer sets the size; the runners-up shrink behind it
      c.chip.style.setProperty('--chip-scale', (0.72 + 0.28 * (a.count / top)).toFixed(3));
      c.chip.classList.toggle('is-key', reveal && a.correct === true);
      c.chip.classList.toggle('is-off', reveal && a.correct === false);
    });
    r.slot.classList.toggle('is-empty', answers.length === 0);
  });

  awaitNote(container, state, awaiting, 'Waiting for the first answer…');

  state.paint = () => {};
  state.group.kick();
}

// =====================================================================
// Matching pairs
//
// One row per term, split into where the room sent it. The correct
// segment is ringed rather than coloured green: the interesting part of
// this chart is the size of the WRONG segments, and a green bar pulls
// the eye away from exactly that.
// =====================================================================

export function renderMatching(container, agg, opts = {}) {
  const state = useChart(container, 'matching');
  const root = container;
  const rows = agg.rows || [];
  const rights = agg.rights || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);

  while (state.rows.length < rows.length) {
    const row = spot(el('div', 'match-row'), state.rows.length);
    const label = el('div', 'match-label');
    const track = el('div', 'match-track');
    const note = el('div', 'match-note');
    row.append(label, track, note);
    container.append(row);
    state.rows.push({ row, label, track, note, segs: [] });
  }
  while (state.rows.length > rows.length) state.rows.pop().row.remove();

  const colors = palette(root, Math.max(1, rights.length), 'wheel');
  const showKey = !opts.hidden && opts.revealCorrect !== false;

  rows.forEach((r, i) => {
    const st = state.rows[i];
    if (st.label.textContent !== r.left) st.label.textContent = r.left;

    while (st.segs.length < rights.length) {
      const k = st.segs.length;
      const seg = el('span', 'match-seg');
      st.track.append(seg);
      st.segs.push(seg);
      state.group.set(`w:${i}:${k}`, 0, { from: 0 });
    }
    while (st.segs.length > rights.length) st.segs.pop().remove();

    const answered = Math.max(1, r.count);
    (r.counts || []).forEach((c, k) => {
      state.group.set(`w:${i}:${k}`, opts.hidden ? 0 : c / answered);
    });

    st.segs.forEach((seg, k) => {
      seg.classList.toggle('is-key', showKey && k === i);
      seg.title = rights[k] || '';
      // On reveal the right answer slides to the front of every bar, so
      // the rows can be compared down the column at a glance instead of
      // hunting for where the green bit is in each one.
      seg.style.order = showKey ? (k === i ? '-1' : '0') : String(k);
    });

    const note = opts.hidden ? '—'
      : r.count === 0 ? ''
        : !showKey ? ''
          : r.confusedWith
            ? `${Math.round(r.pct)}% · mixed up with “${r.confusedWith.label}”`
            : `${Math.round(r.pct)}%`;
    if (st.note.textContent !== note) st.note.textContent = note;
    st.row.classList.toggle('is-clean', !opts.hidden && r.count > 0 && r.pct >= 90);
  });

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const ink = token(root, '--ink', '#111');
    const good = token(root, '--good', '#15803d');
    state.rows.forEach((st, i) => {
      st.segs.forEach((seg, k) => {
        const w = Math.max(0, g.get(`w:${i}:${k}`)) * 100;
        seg.style.width = `${w.toFixed(2)}%`;
        // Before the key: a plain distribution, one hue per partner, so
        // the same colour means the same answer down the whole chart.
        // After it: right is green and every wrong answer is a neutral
        // wash, because past the reveal the question is no longer "who
        // went where" but "how much of this row was wrong" — and the
        // note beside it already names what they went for instead.
        seg.style.background = showKey
          ? (k === i ? good : rgba(ink, 0.13 + 0.07 * (k % 3)))
          : colors[k % colors.length];
        seg.style.opacity = w < 0.4 ? '0' : '1';
      });
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Timeline order
//
// A grid of where the room put each event: rows are the events in their
// true order, columns are the positions 1..n, so a class that has it
// right lights up the diagonal and a class that has two events swapped
// shows you exactly which two.
// =====================================================================

/** 1st, 2nd, 3rd… — the column heads of the timeline grid. */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function renderTimeline(container, agg, opts = {}) {
  const state = useChart(container, 'timeline');
  const root = container;
  const items = agg.items || [];
  const n = items.length;
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    state.meta.head = el('div', 'timeline-head');
    state.meta.head.append(el('span', 'timeline-corner', 'The room put it…'));
    state.meta.heads = el('div', 'timeline-colheads');
    state.meta.head.append(state.meta.heads);
    container.append(state.meta.head);
  }

  // Column headings are the positions themselves — without them the grid
  // is four anonymous boxes per row and the reader has to guess the axis.
  while (state.meta.heads.children.length < n) {
    state.meta.heads.append(el('span', 'timeline-colhead',
      ordinal(state.meta.heads.children.length + 1)));
  }
  while (state.meta.heads.children.length > n) state.meta.heads.lastChild.remove();

  while (state.rows.length < n) {
    const row = el('div', 'timeline-row');
    const label = el('div', 'timeline-label');
    const cells = el('div', 'timeline-cells');
    row.append(label, cells);
    container.append(row);
    state.rows.push({ row, label, cells, boxes: [] });
  }
  while (state.rows.length > n) state.rows.pop().row.remove();

  const showKey = !opts.hidden && opts.revealCorrect !== false;

  items.forEach((item, i) => {
    const st = state.rows[i];
    // the row number IS the correct position, so it only goes up with
    // the key — until then these are just the events, unnumbered
    const label = showKey ? `${i + 1}. ${item.label}` : item.label;
    if (st.label.textContent !== label) st.label.textContent = label;

    while (st.boxes.length < n) {
      const k = st.boxes.length;
      const box = el('span', 'timeline-cell');
      st.cells.append(box);
      st.boxes.push(box);
      state.group.set(`h:${i}:${k}`, 0, { from: 0 });
    }
    while (st.boxes.length > n) st.boxes.pop().remove();

    const answered = Math.max(1, item.count);
    (item.places || []).forEach((c, k) => {
      state.group.set(`h:${i}:${k}`, opts.hidden ? 0 : c / answered);
    });
    st.boxes.forEach((box, k) => box.classList.toggle('is-key', showKey && k === i));
  });

  awaitNote(container, state, awaiting);

  function paint() {
    const g = state.group;
    const c = token(root, '--accent', '#1d4ed8');
    const good = token(root, '--good', '#15803d');
    state.rows.forEach((st, i) => {
      st.boxes.forEach((box, k) => {
        const v = Math.max(0, Math.min(1, g.get(`h:${i}:${k}`)));
        // on the diagonal the heat is the good colour, off it the accent:
        // right answers and interesting wrong answers read differently
        box.style.background = v < 0.005
          ? 'transparent'
          : rgba(showKey && k === i ? good : c, 0.14 + 0.72 * v);
      });
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Exit ticket — three columns, because it was three questions
// =====================================================================

export function renderExitTicket(container, agg, opts = {}) {
  const state = useChart(container, 'exit');
  const root = container;
  const columns = agg.columns || [];
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => {}, PRESETS.smooth);
    state.meta.board = el('div', 'exit-board');
    container.append(state.meta.board);
  }

  while (state.rows.length < columns.length) {
    const col = el('div', 'exit-col');
    const head = el('h4', 'exit-colhead');
    const stack = el('div', 'exit-stack');
    col.append(head, stack);
    state.meta.board.append(col);
    state.rows.push({ col, head, stack, cards: [] });
  }
  while (state.rows.length > columns.length) state.rows.pop().col.remove();

  // these colour a heading, not a swatch — text floor
  const colors = palette(root, Math.max(1, columns.length), 'categorical', TYPE_CONTRAST);

  columns.forEach((c, i) => {
    const st = state.rows[i];
    if (st.head.textContent !== c.label) st.head.textContent = c.label;
    st.head.style.color = colors[i % colors.length];
    const entries = opts.hidden ? [] : (c.entries || []);

    while (st.cards.length < entries.length) {
      const k = st.cards.length;
      const card = el('p', 'exit-card');
      card.style.setProperty('--rail', colors[i % colors.length]);
      st.stack.append(card);
      st.cards.push(card);
      if (!prefersReducedMotion()) {
        card.animate(
          [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, easing: 'cubic-bezier(.22,.9,.28,1)', delay: stagger(k, 0.03, 0.25) * 1000, fill: 'backwards' },
        );
      }
    }
    while (st.cards.length > entries.length) st.cards.pop().remove();

    entries.forEach((e, k) => {
      if (st.cards[k].textContent !== e.text) st.cards[k].textContent = e.text;
      const len = e.text.length;
      st.cards[k].style.setProperty('--card-scale',
        len > 180 ? '0.8' : len > 100 ? '0.9' : '1');
    });
    st.col.classList.toggle('is-empty', entries.length === 0);
  });

  awaitNote(container, state, awaiting);
}

// =====================================================================
// Q&A — the questions themselves are the slide
// =====================================================================

/**
 * A Q&A slide used to render nothing at all: the room saw a prompt, an
 * empty stage and "0 responses", while the questions people had actually
 * typed sat behind a keyboard shortcut. The approved questions ARE the
 * content of this slide, so they go on the wall, most-upvoted first.
 */
export function renderQA(container, agg, opts = {}) {
  const state = useChart(container, 'qa');
  const items = (opts.hidden ? [] : (opts.questions || []))
    .filter((r) => r.approved)
    .slice()
    .sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));

  if (!items.length) {
    if (state.rows.length) { container.textContent = ''; state.rows = []; }
    const waiting = !opts.hidden && opts.awaiting !== false;
    emptyCard(container, state,
      opts.hidden ? 'hidden' : waiting ? 'waiting' : 'none',
      opts.hidden ? 'Questions hidden'
        : waiting ? 'Waiting for the first question…'
          : 'No questions were asked.');
    return;
  }
  clearEmptyCard(state);

  const colors = palette(container, 5);

  while (state.rows.length < items.length) {
    const i = state.rows.length;
    const card = el('div', 'answer-card qa-slide-card');
    const rail = el('span', 'answer-rail');
    const text = el('p', 'answer-text');
    const votes = el('span', 'qa-slide-votes');
    card.append(rail, text, votes);
    container.append(card);
    state.rows.push({ card, rail, text, votes });
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
  while (state.rows.length > items.length) state.rows.pop().card.remove();

  items.forEach((row, i) => {
    const r = state.rows[i];
    if (r.text.textContent !== row.body) r.text.textContent = row.body;
    const len = (row.body || '').length;
    r.card.style.setProperty('--card-scale',
      len > 220 ? '0.74' : len > 140 ? '0.84' : len > 70 ? '0.94' : '1');
    r.card.classList.toggle('is-answered', !!row.answered);
    r.rail.style.background = colors[i % colors.length];
    const n = Number(row.upvotes) || 0;
    const votes = n > 0 ? `▲ ${NUM.format(n)}` : '';
    if (r.votes.textContent !== votes) r.votes.textContent = votes;
  });
}

// =====================================================================

/**
 * The opts an ARCHIVED question is drawn with.
 *
 * Several renderers take their labels from opts rather than from the
 * aggregate — the spectrum's two poles, the heatmap's anchors, whether
 * bars show percentages or counts. The projector assembles all of that
 * from q.config (see present-page.js); the archive and its exports were
 * assembling a three-key subset, so a spectrum whose poles an instructor
 * had written as "Purely structural / Purely individual" came back after
 * class labelled "Disagree / Agree".
 *
 * Everything here is config, not session state: nothing is hidden, the
 * voting is over, and every answer key is safe to show.
 */
export function archiveOpts(question) {
  const cfg = question?.config || {};
  return {
    style: cfg.chart || (question?.type === 'word_cloud' ? 'cloud' : 'bars'),
    // Archived data: zero responses is a fact, not a wait.
    awaiting: false,
    // In the archive the chart IS the content — there is no instructor
    // narrating it — so it carries its own text equivalent. On the
    // projector this stays off: the room has a person reading it out.
    srSummary: true,
    // and the reasoning is part of the record, not just of the moment
    explain: cfg.explain,
    revealCorrect: true,
    revealStyle: question?.type === 'quiz' ? 'correct' : 'best',
    showPercent: cfg.show_counts !== true,
    leftLabel: cfg.left_label,
    rightLabel: cfg.right_label,
    corners: !!cfg.corners,
    anchors: cfg.anchors,
    showAnchors: true,
    showRationales: true,
    // quadrant poles ride opts like the spectrum's, and for the same
    // reason; the consensus archive opens straight on the verdict —
    // after class, the sentences ARE the result
    axes: question?.type === 'quadrant' ? {
      xLeft: cfg.x_left, xRight: cfg.x_right,
      yLow: cfg.y_low, yHigh: cfg.y_high,
    } : undefined,
    verdict: question?.type === 'consensus',
  };
}

// =====================================================================
// Card sort — ambiguity as position
//
// Columns are the buckets; each card is a chip that sits where the room
// filed it. A card everyone agrees on sits square under its column
// header, saturated. A contested card slides toward its runner-up column
// in proportion to the split — a 50/50 card sits exactly ON the fence,
// which is the sentence the chart exists to say. On reveal (keyed sorts
// only), misfiled cards travel home leaving a ghost at the crowd's
// position: the room was here, the truth is there — the same grammar the
// re-ask delta already taught this projector.
// =====================================================================

const BUCKET_ROW_H = 3.1; // em per card row

export function renderBuckets(container, agg, opts = {}) {
  const state = useChart(container, 'buckets');
  const root = container;
  const buckets = agg.buckets || [];
  const cards = agg.cards || [];
  const nB = Math.max(1, buckets.length);
  const colW = 100 / nB;
  const cx = (b) => (b + 0.5) * colW;
  const colors = palette(root, nB, 'wheel');
  const key = opts.revealCorrect && Array.isArray(agg.correct) ? agg.correct : null;
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const wrap = el('div', 'buckets-wrap');
    const head = el('div', 'buckets-head');
    const field = el('div', 'buckets-field');
    wrap.append(head, field);
    container.append(wrap);
    Object.assign(state.meta, {
      wrap, head, field, heads: [], rules: [], cardEls: [], data: [],
      ghosts: [], revealed: false, verdictLanded: false,
    });
  }

  // ---- column headers and the fences between them --------------------
  while (state.meta.heads.length < buckets.length) {
    const h = el('div', 'buckets-col-head');
    state.meta.head.append(h);
    state.meta.heads.push(h);
  }
  while (state.meta.heads.length > buckets.length) state.meta.heads.pop().remove();
  buckets.forEach((b, i) => {
    const h = state.meta.heads[i];
    const text = b || `Bucket ${i + 1}`;
    if (h.textContent !== text) h.textContent = text;
    h.style.borderBottomColor = colors[i];
  });

  while (state.meta.rules.length < nB - 1) {
    const rule = el('div', 'buckets-rule');
    rule.style.left = `${(state.meta.rules.length + 1) * colW}%`;
    state.meta.field.append(rule);
    state.meta.rules.push(rule);
  }
  while (state.meta.rules.length > nB - 1) state.meta.rules.pop().remove();
  state.meta.rules.forEach((rule, i) => { rule.style.left = `${(i + 1) * colW}%`; });

  // ---- one chip per card, reused ------------------------------------
  while (state.meta.cardEls.length < cards.length) {
    const i = state.meta.cardEls.length;
    const node = el('div', 'bcard');
    const mark = el('span', 'bcard-mark', '✓');
    const label = el('div', 'bcard-label');
    const split = el('div', 'bcard-split');
    node.append(mark, label, split);
    node.style.top = `${i * BUCKET_ROW_H}em`;
    state.meta.field.append(node);
    state.meta.cardEls.push({ node, label, split, segs: [], mark });
    state.group.set(`in:${i}`, 1, { from: 0 });
  }
  while (state.meta.cardEls.length > cards.length) {
    state.meta.cardEls.pop().node.remove();
  }
  state.meta.field.style.height = `${cards.length * BUCKET_ROW_H}em`;

  // ---- targets --------------------------------------------------------
  state.meta.data = cards.map((d, i) => {
    const c = state.meta.cardEls[i];
    const text = d.label || `Card ${i + 1}`;
    if (c.label.textContent !== text) { c.label.textContent = text; c.label.title = text; }

    while (c.segs.length < nB) {
      const seg = el('span', 'bcard-seg');
      c.split.append(seg);
      c.segs.push(seg);
    }
    while (c.segs.length > nB) c.segs.pop().remove();
    c.segs.forEach((seg, b) => {
      seg.style.background = colors[b];
      state.group.set(`sp:${i}:${b}`, opts.hidden || !d.n ? 0 : d.counts[b] / d.n);
    });

    let hue = null;
    let x = 50;
    if (!opts.hidden && d.n && d.top != null) {
      hue = colors[d.top];
      x = cx(d.top);
      // The lean: the runner-up column pulls the card off its plinth in
      // proportion to the split, capped at the halfway line — a dead
      // heat sits the card exactly on the fence, never past it.
      if (d.runnerUp != null) x += (cx(d.runnerUp) - cx(d.top)) * 0.5 * d.lean;
      if (state.meta.verdictLanded && key && key[i] != null) {
        x = cx(key[i]);
        hue = colors[key[i]];
      }
    }
    state.group.set(`x:${i}`, x);
    state.group.set(`con:${i}`, opts.hidden || !d.n ? 0 : d.consensus);
    return { hue, n: d.n, top: d.top };
  });

  // ---- reveal: breath, then cards travel home ------------------------
  const clearVerdict = () => {
    state.meta.verdictLanded = false;
    state.meta.ghosts.forEach((g) => g.remove());
    state.meta.ghosts = [];
    state.meta.cardEls.forEach((c) => c.node.classList.remove('is-right', 'is-moved'));
  };

  if (key && !state.meta.revealed) {
    state.meta.revealed = true;
    delay(0.45, () => {
      if (container.__chart !== state || !state.meta.revealed) return;
      state.meta.verdictLanded = true;
      cards.forEach((d, i) => {
        if (key[i] == null) return;
        const c = state.meta.cardEls[i];
        const wasRight = d && d.n > 0 && d.top === key[i];
        c.node.classList.toggle('is-right', !!wasRight);
        if (!wasRight && d && d.n > 0) {
          c.node.classList.add('is-moved');
          // the ghost stays where the room put it — the correction is
          // the journey between the two
          const ghost = el('div', 'bcard-ghost', d.label || `Card ${i + 1}`);
          ghost.style.top = `${i * BUCKET_ROW_H}em`;
          ghost.style.left = `${state.group.get(`x:${i}`, 50)}%`;
          state.meta.field.append(ghost);
          state.meta.ghosts.push(ghost);
          state.group.set(`x:${i}`, cx(key[i]));
        }
      });
    });
  } else if (!key && state.meta.revealed) {
    state.meta.revealed = false;
    clearVerdict();
  }

  awaitNote(container, state, awaiting, 'Waiting for the first sort…');
  state.group.prune(new Set(cards.flatMap((_, i) => [
    `x:${i}`, `in:${i}`, `con:${i}`,
    ...buckets.map((_, b) => `sp:${i}:${b}`),
  ])));

  function paint() {
    const g = state.group;
    const surface = token(root, '--surface', '#ffffff');
    const edge = token(root, '--edge-strong', '#94a3b8');
    state.meta.cardEls.forEach((c, i) => {
      const d = state.meta.data[i];
      if (!d) return;
      const x = g.get(`x:${i}`, 50);
      const enter = g.get(`in:${i}`, 1);
      const con = Math.max(0, Math.min(1, g.get(`con:${i}`, 0)));
      c.node.style.left = `${x.toFixed(3)}%`;
      c.node.style.opacity = String(enter);
      c.node.style.maxWidth = `${colW - 3}%`;
      if (d.hue) {
        // saturation is consensus: a card the room agrees on wears its
        // column's colour with conviction; a contested one goes pale
        c.node.style.borderColor = mixColor(edge, d.hue, 0.25 + 0.75 * con);
        c.node.style.background = mixColor(surface, d.hue, 0.05 + 0.2 * con);
      } else {
        c.node.style.borderColor = edge;
        c.node.style.background = surface;
      }
      c.segs.forEach((seg, b) => {
        seg.style.width = `${(Math.max(0, g.get(`sp:${i}:${b}`, 0)) * 100).toFixed(2)}%`;
      });
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Quadrant — the spectrum's doctrine, one dimension up
//
// Every placement is drawn; nothing is averaged. Each item's placements
// render as a cloud of soft ink in the item's hue: consensus reads as a
// tight blob, a split room as two lobes, confusion as a smear — the
// SHAPE of the disagreement is the finding, and it is exactly the thing
// a mean point cannot show. The item's label sits at the densest
// placement (the mode), never at the centroid, because the centroid of
// two camps is the empty middle nobody voted for.
// =====================================================================

let quadFilterSeq = 0;

export function renderQuadrant(container, agg, opts = {}) {
  const state = useChart(container, 'quadrant');
  const root = container;
  const items = agg.items || [];
  const self = !!agg.self;
  const colors = self
    ? [token(root, '--accent', '#1d4ed8')]
    : palette(root, Math.max(1, items.length), 'wheel');
  const axes = opts.axes || {};
  const awaiting = !opts.hidden && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const wrap = el('div', 'quad-wrap');
    const stage = el('div', 'quad-stage');
    const svgEl = svg('svg', {
      viewBox: '0 0 100 100', preserveAspectRatio: 'none', role: 'img',
    });
    svgEl.classList.add('quad-svg');
    const filterId = `quad-blur-${quadFilterSeq += 1}`;
    const defs = svg('defs');
    const filter = svg('filter', {
      id: filterId, x: '-60%', y: '-60%', width: '220%', height: '220%',
    });
    filter.append(svg('feGaussianBlur', { stdDeviation: 2.4 }));
    defs.append(filter);
    svgEl.append(
      defs,
      svg('line', { x1: 0, y1: 50, x2: 100, y2: 50, class: 'quad-rule' }),
      svg('line', { x1: 50, y1: 0, x2: 50, y2: 100, class: 'quad-rule' }),
    );
    stage.append(svgEl);
    const poles = {
      top: el('div', 'quad-pole is-top'),
      bottom: el('div', 'quad-pole is-bottom'),
      left: el('div', 'quad-pole is-left'),
      right: el('div', 'quad-pole is-right'),
    };
    Object.values(poles).forEach((p) => stage.append(p));
    const legend = el('div', 'quad-legend');
    wrap.append(stage, legend);
    container.append(wrap);
    Object.assign(state.meta, {
      stage, svgEl, filterId, legend, poles, series: [], focus: null,
    });
  }

  const poleText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  poleText(state.meta.poles.top, axes.yHigh || 'High');
  poleText(state.meta.poles.bottom, axes.yLow || 'Low');
  poleText(state.meta.poles.left, axes.xLeft || 'Left');
  poleText(state.meta.poles.right, axes.xRight || 'Right');

  const nSeries = Math.max(1, self ? 1 : items.length);

  // ---- per-item structure: a blurred halo layer, a core layer, an
  // anchor chip at the mode, and a legend button that isolates it ------
  while (state.meta.series.length < nSeries) {
    const i = state.meta.series.length;
    const halos = svg('g', { filter: `url(#${state.meta.filterId})` });
    const cores = svg('g');
    state.meta.svgEl.append(halos, cores);
    const anchor = el('span', 'quad-anchor');
    state.meta.stage.append(anchor);
    let legendBtn = null;
    if (!self) {
      legendBtn = el('button', 'quad-key');
      legendBtn.type = 'button';
      legendBtn.setAttribute('aria-pressed', 'false');
      legendBtn.append(el('span', 'quad-key-swatch'), el('span', 'quad-key-label'),
        el('span', 'quad-key-count'));
      // tap to isolate one cloud — stepping through items one at a time
      // is the discussion choreography this chart is built for
      legendBtn.addEventListener('click', () => {
        state.meta.focus = state.meta.focus === i ? null : i;
        state.meta.series.forEach((s, k) => {
          s.legendBtn?.classList.toggle('is-focus', state.meta.focus === k);
          s.legendBtn?.setAttribute('aria-pressed', state.meta.focus === k ? 'true' : 'false');
        });
        state.paint?.();
      });
      state.meta.legend.append(legendBtn);
    }
    state.meta.series.push({ halos, cores, anchor, legendBtn, dots: new Map() });
  }
  while (state.meta.series.length > nSeries) {
    const s = state.meta.series.pop();
    s.halos.remove(); s.cores.remove(); s.anchor.remove(); s.legendBtn?.remove();
  }
  state.meta.legend.hidden = self;

  // ---- dots, keyed so a re-ask migrates the same anonymous mark ------
  (agg.items || []).forEach((item, i) => {
    if (i >= nSeries) return;
    const s = state.meta.series[i];
    const hue = colors[i];
    const beforeByKey = new Map(
      ((opts.beforeItems || [])[i]?.points || []).map((p, k) => [p.pseudonym || `i:${k}`, p]));

    if (s.legendBtn) {
      const labelEl = s.legendBtn.querySelector('.quad-key-label');
      const countEl = s.legendBtn.querySelector('.quad-key-count');
      const text = item.label || `Item ${i + 1}`;
      if (labelEl.textContent !== text) labelEl.textContent = text;
      const cnt = opts.hidden ? '—' : String(item.points.length);
      if (countEl.textContent !== cnt) countEl.textContent = cnt;
      s.legendBtn.querySelector('.quad-key-swatch').style.background = hue;
    }

    const seen = new Set();
    item.points.forEach((pt, k) => {
      const dotKey = pt.pseudonym || `i:${k}`;
      seen.add(dotKey);
      let dot = s.dots.get(dotKey);
      if (!dot) {
        const halo = svg('circle', { r: 0, fill: hue, 'fill-opacity': 0.2 });
        const core = svg('circle', { r: 0, fill: hue, 'fill-opacity': 0.9 });
        s.halos.append(halo);
        s.cores.append(core);
        dot = { halo, core };
        s.dots.set(dotKey, dot);
        const from = beforeByKey.get(dotKey);
        state.group.set(`x:${i}:${dotKey}`, from ? from.x : pt.x, { from: from ? from.x : pt.x });
        state.group.set(`y:${i}:${dotKey}`, from ? from.y : pt.y, { from: from ? from.y : pt.y });
        state.group.set(`s:${i}:${dotKey}`, 1, { from: 0, preset: 'bouncy' });
        if (from) {
          delay(0.5 + stagger(k, 0.02, 0.4), () => {
            if (container.__chart !== state) return;
            state.group.set(`x:${i}:${dotKey}`, pt.x);
            state.group.set(`y:${i}:${dotKey}`, pt.y);
          });
        }
      } else {
        state.group.set(`x:${i}:${dotKey}`, pt.x);
        state.group.set(`y:${i}:${dotKey}`, pt.y);
      }
      state.group.set(`s:${i}:${dotKey}`, opts.hidden ? 0 : 1);
    });

    s.dots.forEach((dot, dotKey) => {
      if (seen.has(dotKey)) return;
      state.group.set(`s:${i}:${dotKey}`, 0);
      delay(0.4, () => {
        const sp = state.group.springs.get(`s:${i}:${dotKey}`);
        if (sp && sp.target > 0) return;
        if (s.dots.get(dotKey) !== dot) return;
        dot.halo.remove();
        dot.core.remove();
        s.dots.delete(dotKey);
        state.group.forget(`x:${i}:${dotKey}`);
        state.group.forget(`y:${i}:${dotKey}`);
        state.group.forget(`s:${i}:${dotKey}`);
      });
    });

    // the label rides the mode, never the mean
    const a = item.anchor;
    if (a && !opts.hidden) {
      const hasA = state.group.springs?.has?.(`ax:${i}`);
      state.group.set(`ax:${i}`, a.x, hasA ? undefined : { from: a.x });
      state.group.set(`ay:${i}`, a.y, hasA ? undefined : { from: a.y });
    }
    s.anchor.textContent = self ? '' : (item.label || `Item ${i + 1}`);
    s.anchor.style.borderColor = hue;
    s.anchor.hidden = self || opts.hidden || !a || !item.points.length;
  });

  awaitNote(container, state, awaiting, 'Waiting for the first placement…');

  function paint() {
    const g = state.group;
    state.meta.series.forEach((s, i) => {
      const dimmed = state.meta.focus != null && state.meta.focus !== i;
      s.halos.setAttribute('opacity', dimmed ? '0.06' : '1');
      s.cores.setAttribute('opacity', dimmed ? '0.08' : '1');
      s.anchor.style.opacity = dimmed ? '0' : '';
      s.dots.forEach((dot, dotKey) => {
        const x = g.get(`x:${i}:${dotKey}`, 50);
        const y = 100 - g.get(`y:${i}:${dotKey}`, 50);
        const sc = Math.max(0, g.get(`s:${i}:${dotKey}`, 1));
        dot.halo.setAttribute('cx', x.toFixed(2));
        dot.halo.setAttribute('cy', y.toFixed(2));
        dot.halo.setAttribute('r', (5.2 * sc).toFixed(2));
        dot.core.setAttribute('cx', x.toFixed(2));
        dot.core.setAttribute('cy', y.toFixed(2));
        dot.core.setAttribute('r', ((self ? 1.4 : 1.1) * sc).toFixed(2));
      });
      if (!s.anchor.hidden) {
        s.anchor.style.left = `${g.get(`ax:${i}`, 50).toFixed(2)}%`;
        s.anchor.style.top = `${(100 - g.get(`ay:${i}`, 50)).toFixed(2)}%`;
      }
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

// =====================================================================
// Common ground — claims that migrate
//
// Each approved claim is a card on one axis: room disagrees ← → room
// agrees. Position is the balance among those who took a side;
// saturation is how much of the room has weighed in, so an unheard claim
// sits pale at the centre and cannot masquerade as a genuinely contested
// one. The verdict view turns the field into sentences — "the room
// agrees:" over the claims that earned it — because the sentence is the
// slide (the re-ask delta's pattern, borrowed on purpose).
// =====================================================================

const CLAIM_ROW_H = 2.8; // em

export function renderConsensus(container, agg, opts = {}) {
  const state = useChart(container, 'consensus');
  const root = container;
  const claims = agg.claims || [];
  const awaiting = !opts.hidden && claims.length > 0
    && (agg.total || 0) === 0 && opts.awaiting !== false;
  container.toggleAttribute('data-awaiting', awaiting);

  if (!state.group) {
    state.group = new SpringGroup(() => state.paint?.(), PRESETS.smooth);
    const wrap = el('div', 'consensus-wrap');
    const ends = el('div', 'consensus-ends');
    ends.append(
      el('span', 'consensus-end', 'Room disagrees'),
      el('span', 'consensus-end is-mid', 'contested'),
      el('span', 'consensus-end', 'Room agrees'),
    );
    const field = el('div', 'consensus-field');
    wrap.append(ends, field);
    container.append(wrap);
    Object.assign(state.meta, {
      wrap, field, nodes: new Map(), rowOf: new Map(), verdict: null, verdictKey: '',
    });
  }

  if (!claims.length) {
    state.meta.wrap.hidden = true;
    emptyCard(container, state, 'waiting', 'Waiting for the room’s first claim…');
  } else {
    state.meta.wrap.hidden = false;
    clearEmptyCard(state);
  }

  // stable rows: a claim keeps its lane for the whole session, and a
  // freshly approved one takes the next lane down
  claims.forEach((c) => {
    if (!state.meta.rowOf.has(c.key)) state.meta.rowOf.set(c.key, state.meta.rowOf.size);
  });
  state.meta.field.style.height = `${Math.max(1, state.meta.rowOf.size) * CLAIM_ROW_H}em`;

  const seen = new Set();
  claims.forEach((c) => {
    seen.add(c.key);
    let entry = state.meta.nodes.get(c.key);
    if (!entry) {
      const node = el('div', 'claim-node');
      const text = el('span', 'claim-node-text', c.text);
      const votes = el('span', 'claim-node-votes');
      node.append(text, votes);
      node.style.top = `${state.meta.rowOf.get(c.key) * CLAIM_ROW_H}em`;
      state.meta.field.append(node);
      entry = { node, text, votes };
      state.meta.nodes.set(c.key, entry);
      state.group.set(`x:${c.key}`, 50, { from: 50 });
      state.group.set(`s:${c.key}`, 1, { from: 0, preset: 'bouncy' });
      state.group.set(`h:${c.key}`, 0, { from: 0 });
    }
    if (entry.text.textContent !== c.text) {
      entry.text.textContent = c.text;
      entry.text.title = c.text;
    }
    state.group.set(`x:${c.key}`, opts.hidden ? 50 : 50 + c.balance * 42);
    state.group.set(`h:${c.key}`,
      opts.hidden ? 0 : (agg.total ? Math.min(1, c.votes / agg.total) : 0));
    state.group.set(`s:${c.key}`, opts.hidden ? 0 : 1);
    const vtxt = opts.hidden || !c.votes ? '' : NUM.format(c.votes);
    if (entry.votes.textContent !== vtxt) entry.votes.textContent = vtxt;
  });

  state.meta.nodes.forEach((entry, ckey) => {
    if (seen.has(ckey)) return;
    state.group.set(`s:${ckey}`, 0);
    delay(0.4, () => {
      const sp = state.group.springs.get(`s:${ckey}`);
      if (sp && sp.target > 0) return;
      if (state.meta.nodes.get(ckey) !== entry) return;
      entry.node.remove();
      state.meta.nodes.delete(ckey);
      state.group.forget(`x:${ckey}`);
      state.group.forget(`s:${ckey}`);
      state.group.forget(`h:${ckey}`);
    });
  });

  // ---- the verdict: the field becomes sentences -----------------------
  const wantVerdict = !!opts.verdict && !opts.hidden && (agg.total || 0) > 0;
  if (wantVerdict) {
    const minVotes = Math.max(2, Math.ceil((agg.total || 0) / 3));
    const heard = claims.filter((c) => c.votes > 0);
    const agreed = heard.filter((c) => c.votes >= minVotes && c.balance >= 0.6)
      .sort((a, b) => b.balance - a.balance || b.votes - a.votes).slice(0, 3);
    const split = heard.filter((c) => c.votes >= minVotes && Math.abs(c.balance) <= 0.3)
      .sort((a, b) => b.votes - a.votes).slice(0, 2);
    const vkey = [...agreed, ...split].map((c) => `${c.key}:${c.agree}:${c.disagree}`).join('|');
    if (state.meta.verdictKey !== vkey) {
      state.meta.verdictKey = vkey;
      state.meta.verdict?.remove();
      const v = el('div', 'consensus-verdict');
      const section = (title, list, cls) => {
        if (!list.length) return;
        v.append(el('p', 'consensus-verdict-title', title));
        list.forEach((c, i) => {
          const card = el('blockquote', `consensus-quote ${cls}`.trim());
          card.append(
            el('span', 'consensus-quote-text', c.text),
            el('span', 'consensus-quote-tally',
              `${Math.round((c.agree / Math.max(1, c.votes)) * 100)}% agree · ${NUM.format(c.votes)} voted`),
          );
          card.style.setProperty('--q-i', String(i));
          v.append(card);
        });
      };
      section('The room agrees', agreed, 'is-agreed');
      section('Still contested', split, 'is-split');
      if (!v.childNodes.length) {
        v.append(el('p', 'consensus-verdict-title', 'No claim has enough votes to call yet'));
      }
      state.meta.wrap.append(v);
      state.meta.verdict = v;
    }
    state.meta.field.classList.add('is-backdrop');
    state.meta.wrap.classList.add('is-verdict');
  } else {
    state.meta.verdict?.remove();
    state.meta.verdict = null;
    state.meta.verdictKey = '';
    state.meta.field.classList.remove('is-backdrop');
    state.meta.wrap.classList.remove('is-verdict');
  }

  awaitNote(container, state, awaiting, 'Waiting for the first vote…');
  state.group.prune(new Set([...state.meta.nodes.keys()]
    .flatMap((k) => [`x:${k}`, `s:${k}`, `h:${k}`])));

  function paint() {
    const g = state.group;
    const accent = token(root, '--accent', '#1d4ed8');
    const surface = token(root, '--surface', '#ffffff');
    const edge = token(root, '--edge-strong', '#94a3b8');
    state.meta.nodes.forEach((entry, ckey) => {
      const x = g.get(`x:${ckey}`, 50);
      const s = Math.max(0, g.get(`s:${ckey}`, 1));
      const h = Math.max(0, Math.min(1, g.get(`h:${ckey}`, 0)));
      entry.node.style.left = `${x.toFixed(3)}%`;
      // The chip's own anchor slides with it: centred in the middle of
      // the field, right-aligned at the agree pole, left-aligned at the
      // disagree pole. A fixed -50% put half of every outlying chip
      // outside the field — and the claims that travel furthest are
      // exactly the ones the room most agreed or disagreed about, so
      // clipping them would hide the finding.
      entry.node.style.transform =
        `translate(${(-x).toFixed(3)}%, 0) scale(${(0.6 + 0.4 * s).toFixed(3)})`;
      entry.node.style.opacity = String(Math.min(1, s * 1.2));
      // heard-ness is saturation: pale at the centre means "not enough
      // votes yet", which must never look like "genuinely contested"
      entry.node.style.borderColor = mixColor(edge, accent, 0.15 + 0.85 * h);
      entry.node.style.background = mixColor(surface, accent, 0.04 + 0.14 * h);
    });
  }

  state.paint = paint;
  state.group.kick();
  paint();
}

/**
 * Types whose aggregate is a list of labelled magnitudes, and so has a
 * table as its honest text equivalent. Everything else — a passage of
 * heat, a field of dots, three columns of sentences — is either already
 * text in the DOM or is not a table at all, and inventing one would say
 * less than the marks do.
 */
const TABULAR_TYPES = new Set([
  'multiple_choice', 'quiz', 'word_cloud', 'traffic', 'mood', 'budget',
]);

/** The rows of that table, per type. */
function summaryRows(type, agg) {
  const pct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '—');
  switch (type) {
    case 'multiple_choice':
    case 'quiz':
    case 'traffic':
    case 'mood':
      return (agg.options || []).map((o) => [
        o.label || 'Unlabelled', NUM.format(o.count || 0), pct(o.pct)]);
    case 'budget':
      return (agg.options || []).map((o) => [
        o.label || 'Unlabelled', NUM.format(Math.round(o.avg ?? 0)), pct(o.share)]);
    case 'word_cloud':
      return (agg.words || []).slice(0, 25).map((w) => [
        w.word, NUM.format(w.count),
        agg.total ? pct((w.count / agg.total) * 100) : '—']);
    default:
      return [];
  }
}

export function renderAggregate(container, type, agg, opts = {}) {
  if (!agg) return undefined;

  const out = renderAggregateInner(container, type, agg, opts);

  // The text equivalent, for callers whose reader has nothing else: the
  // student's phone and the results archive. Built AFTER the render, not
  // before: useChart() empties the container whenever the chart kind
  // changes, so a table prepended first is torn out on the very paint
  // that was supposed to install it. renderWordList builds its own (it
  // needs the totals from before the top-ten slice), so the cloud is
  // skipped here when it is drawing as a list.
  const wantsTable = opts.srSummary && TABULAR_TYPES.has(type)
    && !(type === 'word_cloud' && opts.style === 'list');
  if (wantsTable) {
    const rows = summaryRows(type, agg);
    if (rows.length) {
      // Small multiples hand in their own caption: eight cells that all
      // announce "Results, 24 responses" tell a reader which chart they
      // are in exactly as well as no caption at all.
      const stem = opts.srCaption ? `${opts.srCaption} — ` : '';
      srSummary(container, rows, opts.hidden
        ? `${stem}results hidden`
        : `${stem}${NUM.format(agg.total || 0)} ${(agg.total || 0) === 1 ? 'response' : 'responses'}`);
    } else {
      clearSrSummary(container);
    }
  } else if (!opts.srSummary) {
    clearSrSummary(container);
  }

  // The visual chart repeats every number the table just gave, so a
  // reader that hears both hears the whole result twice. Applied after
  // the render, because renderers append and rebuild their own children.
  if (container.__srTable) {
    for (const child of container.children) {
      if (child !== container.__srTable) child.setAttribute('aria-hidden', 'true');
    }
  }
  return out;
}

function renderAggregateInner(container, type, agg, opts = {}) {
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
    case 'spectrum':
      return renderSpectrum(container, agg, opts);
    case 'sample_vote':
      return renderShowdown(container, agg, opts);
    case 'heatmap':
      return renderHeatmap(container, agg, opts);
    case 'traffic':
      return renderTrafficLight(container, agg, opts);
    case 'mood':
      return renderMood(container, agg, opts);
    case 'this_or_that':
      return renderTugOfWar(container, agg, opts);
    case 'budget':
      return renderBudget(container, agg, opts);
    case 'probability':
      return renderProbability(container, agg, opts);
    case 'cloze':
      return renderCloze(container, agg, opts);
    case 'matching':
      return renderMatching(container, agg, opts);
    case 'timeline':
      return renderTimeline(container, agg, opts);
    case 'exit_ticket':
      return renderExitTicket(container, agg, opts);
    case 'qa':
      return renderQA(container, agg, opts);
    case 'buckets':
      return renderBuckets(container, agg, opts);
    case 'quadrant':
      return renderQuadrant(container, agg, opts);
    case 'consensus':
      return renderConsensus(container, agg, opts);
    default:
      container.textContent = '';
      return undefined;
  }
}

/** Quiz reveal celebration. Respects prefers-reduced-motion. */
export function celebrate(host) {
  if (prefersReducedMotion()) return;
  const layer = el('div', 'confetti-layer');
  // half the pieces wear the verdict's green — this is the quiz's
  // sanctioned exception to the one-accent rule
  const tokens = ['--good', '--accent', '--good', '--accent-2'];
  const colors = tokens.map((t) => token(host, t, '#888'));

  // Three shapes in a fixed ratio rather than per-piece randomness, so
  // every celebration has the same mix — a run that happened to roll
  // eight streamers would read as a different effect.
  const SHAPES = ['', '', 'is-round', '', 'is-streamer'];

  let slowest = 0;
  for (let i = 0; i < 54; i += 1) {
    const shape = SHAPES[i % SHAPES.length];
    const bit = el('span', `confetti-bit ${shape}`.trim());
    const c = colors[i % colors.length];
    const wait = Math.random() * 0.5;
    const dur = 1.9 + Math.random() * 1.4;
    slowest = Math.max(slowest, wait + dur);

    const streamer = shape === 'is-streamer';
    bit.style.left = `${Math.random() * 100}%`;
    bit.style.setProperty('--flake', c);
    // Streamers are long and thin; the rest stay roughly card-shaped.
    bit.style.width = `${streamer ? 2 + Math.random() * 2 : 5 + Math.random() * 7}px`;
    bit.style.height = `${streamer ? 16 + Math.random() * 12 : 9 + Math.random() * 9}px`;
    bit.style.animationDelay = `${wait}s`;
    bit.style.animationDuration = `${dur}s`;
    bit.style.setProperty('--drift', `${(Math.random() - 0.5) * 300}px`);

    // The tumble runs on its OWN clock, deliberately unrelated to the
    // fall: a piece that completed exactly one rotation per descent
    // would land the same way up every time, which is the tell that
    // nothing is really spinning. Streamers tumble slower — a long thin
    // piece whipping round reads as a glitch rather than as paper.
    const turns = streamer ? 0.9 + Math.random() * 0.6 : 1.5 + Math.random() * 2.5;
    bit.style.setProperty('--spin', `${360 * (Math.random() < 0.5 ? -1 : 1)}deg`);
    bit.style.setProperty('--spin-half', `${180 * (Math.random() < 0.5 ? -1 : 1)}deg`);
    bit.style.setProperty('--sway', `${(Math.random() - 0.5) * 18}px`);

    const flake = el('span', 'confetti-flake');
    flake.style.animationDuration = `${dur / turns}s`;
    // Negative delay starts each piece part-way through its tumble, so
    // the field does not begin in lockstep with every flake face-on.
    flake.style.animationDelay = `${-Math.random() * dur}s`;
    bit.append(flake);
    layer.append(bit);
  }
  host.append(layer);
  // outlive the slowest piece — a flat timeout beheaded stragglers mid-fall
  setTimeout(() => layer.remove(), slowest * 1000 + 150);
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
