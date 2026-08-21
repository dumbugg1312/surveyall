/**
 * SurveyAll — one slide, drawn the way the projector draws it.
 *
 * The editor's left rail, the big canvas in the middle, the new-slide
 * gallery and the dashboard's deck cards all call renderSlide(). What
 * they get back is not a picture of the projector: it is the projector,
 * at 1280×720, scaled down to whatever box it was asked to sit in.
 *
 * WHY IT WORKS THIS WAY. This file used to draw its own sketch — its own
 * markup, its own stylesheet, its own idea of how big a heading is. It
 * was tuned to look right in a 650px editor box, so measured against the
 * real slide it drew the heading 1.86× too large, indented it 2.3× too
 * far, started the chart 21 points of slide height too low, and left off
 * the footer and the join card entirely. Every one of those was correct
 * the day it was written and wrong by the next change to present.css,
 * because nothing connected the two. An instructor arranging a deck was
 * arranging a picture of a slide that did not exist.
 *
 * So there is no sketch any more. The markup below is present.html's,
 * class for class; the stylesheet is present.css; the body is drawn by
 * charts.js from a deterministic invented class (app/sample-class.js) —
 * the same room the Preview button rehearses with. Nothing here can
 * disagree with the projector, because there is nothing here that draws.
 *
 * THE ONE NUMBER THAT MATTERS. present.css sizes the stage from the
 * viewport (`clamp(16px, 1.3vw + 9.5px, 33px)`), so the projector's own
 * composition is not scale-invariant: a heading is 3.2% of slide width at
 * 720p and 1.3% at 4K. "The same as the projector" therefore has to name
 * a projector. This one is 1280×720 — the reference the Preview panel
 * already scales its iframes to, and a fair likeness of a classroom.
 *
 * Everything else in here is arithmetic-free: the stage lays itself out
 * at full size and a single transform shrinks it, so every padding,
 * hairline, shadow and border-radius in present.css and charts.css comes
 * along at exactly its own proportion.
 */

import {
  TYPE_LABELS, isContentSlide, aggregate, slideKicker, showSlideLabel,
  promptScale, resolvePromptAlign, chartStyleFor, showPercentFor, KEYED_TYPES,
  DEFAULT_JOIN_STEPS, fillJoinPlaceholders, sortedQuestions,
} from './logic.js';
import { getTheme, applyTheme, backgroundStyles, scrimOpacity } from './themes.js';
import { ambiencePlan, applyAmbience } from './ambience.js';
import { renderDecor, decorLayers } from './elements.js';
import { renderAggregate, renderInstructions } from './charts.js';
import { setMotionStill } from './motion.js';
import { sampleRows, sampleQuestions } from './sample-class.js';

/**
 * The projector every preview is a scale model of.
 *
 * Change these and every preview in the app changes together — which is
 * the point. They are the same numbers styles/preview.css scales the
 * Preview panel's present.html iframe to.
 */
export const STAGE_W = 1280;
export const STAGE_H = 720;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// =====================================================================
// Fitting a 1280×720 stage into whatever box it was given
// =====================================================================

/**
 * One observer for every preview on the page.
 *
 * There is no CSS way to divide a length by a length, so the scale factor
 * has to be written from script — the same conclusion styles/preview.css
 * reached for the Preview panel. One shared ResizeObserver rather than one
 * each: a deck of forty slides means forty frames in the rail, and forty
 * observers is forty callbacks for one window resize.
 */
const fitObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver((entries) => {
    for (const e of entries) applyFit(e.target, e.contentRect.width);
  })
  : null;

function applyFit(frame, width) {
  // A frame inside a collapsed or hidden pane measures zero. Leaving the
  // last good scale in place means reopening the pane shows the slide
  // rather than a speck in the corner while the observer catches up.
  if (!(width > 0)) return;
  frame.style.setProperty('--slide-fit', String(width / STAGE_W));
}

function watchFit(frame) {
  // Measured here and not left to the observer, even though reading the
  // box forces a layout. A ResizeObserver only delivers as part of the
  // rendering steps, and a document that is not being rendered — a
  // background tab, a collapsed pane, a page built before it is shown —
  // does not run them. Left to the observer alone, every slide on such a
  // page sits at scale 1: a 1280px stage in a 170px thumbnail, showing
  // the top-left sixth of the slide until something makes the browser
  // paint. The observer below still owns every LATER size change.
  applyFit(frame, frame.getBoundingClientRect().width);
  fitObserver?.observe(frame);
}

// =====================================================================
// The slide
// =====================================================================

/**
 * Draw one slide into `host` (which is emptied first).
 *
 * @param {HTMLElement} host
 * @param {object} q question row (may be a bare {type} for the gallery)
 * @param {object} deck the deck, for theme, background and settings
 * @param {string|object} themeRef resolved theme reference
 * @param {object} [opts]
 * @param {object[]} [opts.slides] the deck's slide list, for the kicker
 *        and the progress dots. Omit it and the slide draws without
 *        either — which is what the type gallery wants, since a tile
 *        there belongs to no deck.
 * @param {boolean} [opts.placeholder] label an untyped slide by its type
 *        rather than calling it "Untitled slide"
 * @param {boolean} [opts.ambience] opt this preview into the deck's
 *        backdrop motion. Only the big canvas does: forty drifting
 *        miniatures in the rail are a distraction and a real GPU bill.
 * @param {{code?: string, url?: string, qrSVG?: string}} [opts.join]
 *        the deck's real code, the address a person types, and an encoded
 *        QR. A deck owns its code from creation, so the editor draws the
 *        same scannable thing the room will see.
 * @param {object[]} [opts.rows] responses to draw instead of the invented
 *        class — for a preview of results that actually happened.
 * @returns {HTMLElement} the `.stage`, at its full 1280×720 layout size
 */
export function renderSlide(host, q, deck, themeRef, opts = {}) {
  host.textContent = '';

  const theme = getTheme(themeRef);
  const frame = el('div', 'slide-fit');
  const stage = el('div', 'stage is-preview');

  // Which question this drawing is of. The same slide is drawn in several
  // places at once — rail thumbnail, big canvas, an open preview — and a
  // live in-place repaint has to be able to find *this* question's copies
  // rather than whatever happens to sit at the same index on another slide.
  if (q?.id != null) stage.dataset.qid = String(q.id);

  applyTheme(stage, themeRef);
  stage.style.backgroundColor = theme.tokens['--ground'];
  // Both are inherited by everything present.css sizes, and both are
  // per-slide on the projector too: a title slide can sit its heading
  // somewhere other than the rest of the deck.
  stage.style.setProperty('--prompt-align', resolvePromptAlign(q, deck));
  stage.style.setProperty('--prompt-scale', String(promptScale(deck)));

  const content = isContentSlide(q?.type);
  stage.classList.toggle('is-content-slide', content);

  // ---- backdrop + scrim ------------------------------------------------
  const backdrop = el('div', 'stage-backdrop');
  Object.assign(backdrop.style, backgroundStyles(deck?.background, themeRef));
  if (opts.ambience) applyAmbience(backdrop, ambiencePlan(deck?.background, themeRef));

  const scrim = el('div', 'stage-scrim');
  scrim.style.background = theme.tokens['--ground'];
  scrim.style.opacity = String(scrimOpacity(deck?.background));

  // ---- head ------------------------------------------------------------
  const head = el('div', 'stage-head');
  const heading = el('div', 'stage-heading');
  const kickerText = opts.slides && showSlideLabel(deck) && q?.type
    ? slideKicker(q, opts.slides) : '';
  const kicker = el('p', 'stage-kicker', kickerText);
  kicker.hidden = !kickerText;
  const prompt = el('h1', 'stage-prompt');
  prompt.textContent = q?.prompt?.trim()
    || (opts.placeholder ? TYPE_LABELS[q?.type] || 'Slide' : 'Untitled slide');
  if (!q?.prompt?.trim() && !opts.placeholder) prompt.classList.add('is-empty');
  heading.append(kicker, prompt);
  head.append(heading);
  // The timer's slot, empty. present.html keeps a second child in the head
  // whether or not a timer is running, and .stage-head's 1.2em gap applies
  // the moment there are two of them — so a head with only the heading in
  // it hands the question 2.45% of the slide's width that the room will
  // not have. A long question wraps a word later here than it does there,
  // which is the whole class of bug this file exists to end.
  head.append(el('div', 'stage-timer-slot'));

  // ---- body ------------------------------------------------------------
  const body = el('div', 'stage-body');
  const chart = el('div', 'chart');
  body.append(chart);

  // ---- the room -------------------------------------------------------
  // Drawn once and shared by the chart and the count pill. Both need it,
  // and inventing a class twice per repaint is the same answer computed
  // twice — on a rail of forty thumbnails, forty times over.
  const room = inventedRoom(q, opts);

  // ---- foot ------------------------------------------------------------
  const foot = buildFoot(q, opts, room);

  // ---- placed elements -------------------------------------------------
  // Two layers so an element can sit either side of the content: a mark
  // that points at a bar has to be on top of it, a watermark under it.
  // The rail gets these too — a thumbnail that omitted the decoration
  // would be a worse map of the deck than one that showed it, and
  // arranging slides is what the rail is for.
  const decor = decorLayers();
  renderDecor(decor, q?.config);

  // DOM order is the stacking order. present.html's, exactly: the back
  // decor layer ties with the scrim at z-index 1 and has to come after it
  // to paint above it, and the join corner has to come before the front
  // layer for the same reason it does there.
  stage.append(backdrop, scrim, decor.back, head, body, foot);
  const corner = buildJoinCorner(q, opts);
  if (corner) stage.append(corner);
  stage.append(decor.front);

  frame.append(stage);
  host.append(frame);
  watchFit(frame);

  paintBody(chart, q, deck, opts, room);
  return stage;
}

// =====================================================================
// The furniture the room sees on every slide
// =====================================================================

/**
 * The footer: how many answered, and where in the deck this is.
 *
 * Content slides hide the count on the projector (present.css's
 * `.stage.is-content-slide .count-pill`), so it is built either way and
 * left to the stylesheet — one rule, not two opinions.
 */
function buildFoot(q, opts, room) {
  const foot = el('div', 'stage-foot');

  const pill = el('span', 'count-pill');
  pill.append(el('span', 'dot-live'));
  pill.append(el('span', null, countText(q, room)));
  foot.append(pill);
  foot.append(el('span', 'spacer'));

  const slides = sortedQuestions(opts.slides || []);
  if (slides.length) {
    const dots = el('div', 'progress-dots');
    const cur = slides.findIndex((x) => x.id === q?.id);
    slides.forEach((_, i) => {
      dots.append(el('span', `progress-dot${i < cur ? ' is-done' : ''}${i === cur ? ' is-current' : ''}`));
    });
    // .5em dot + .3em gap = .8em per step, +.25em to reach the dot's
    // centre — the same arithmetic present-page.js's paintDots() does.
    dots.style.setProperty('--rail-width', cur < 0 ? '0px' : `${cur * 0.8 + 0.25}em`);
    foot.append(dots);
  }
  return foot;
}

/**
 * The class this slide pretends answered it.
 *
 * `opts.rows` overrides the invented one, for a preview of results that
 * actually happened. Q&A collects questions rather than answers, so it
 * gets its own queue and no rows at all — the same split the aggregate
 * makes.
 */
function inventedRoom(q, opts) {
  if (!q?.type || isContentSlide(q.type)) return { rows: [], questions: null };
  if (q.type === 'qa') return { rows: [], questions: sampleQuestions(q) };
  return { rows: opts.rows ?? sampleRows(q), questions: null };
}

/** What the count pill says about it. KEEP IN STEP with formatCount(). */
function countText(q, room) {
  if (!q?.type || isContentSlide(q.type)) return '0 responses';
  const { rows } = room;
  const people = new Set(rows.map((r) => r.pseudonym)).size;
  if (q.type === 'qa') {
    const n = room.questions.length;
    return `${n} ${n === 1 ? 'question' : 'questions'}`;
  }
  return q.type === 'open_ended' || q.type === 'word_cloud'
    ? `${rows.length} ${rows.length === 1 ? 'response' : 'responses'}`
      + ` · ${people} ${people === 1 ? 'person' : 'people'}`
    : `${people} ${people === 1 ? 'response' : 'responses'}`;
}

/**
 * The always-on join card.
 *
 * Left off exactly where the projector leaves it off: an instructions
 * slide already shows a QR the size of a dinner plate, and the corner
 * copy on top of it is clutter. Left off too when the deck has no code
 * yet, rather than drawing an empty plate.
 */
function buildJoinCorner(q, opts) {
  const join = opts.join;
  if (!join?.code) return null;
  if (isContentSlide(q?.type) && q?.config?.show_join !== false) return null;

  const corner = el('div', 'join-corner');
  const qr = el('div', 'join-qr');
  if (join.qrSVG) qr.innerHTML = join.qrSVG;
  else qr.dataset.qrFailed = '1';
  const meta = el('div', 'join-meta');
  meta.append(el('span', 'join-label', 'Join anytime'));
  meta.append(el('span', 'join-url', join.url || ''));
  meta.append(el('span', 'join-code', join.code));
  corner.append(qr, meta);
  return corner;
}

// =====================================================================
// The body
// =====================================================================

/**
 * Draw the slide's results — the real chart, from an invented class.
 *
 * The state drawn is "voting closed, results up": the fullest a slide
 * ever gets, and the one an instructor is judging when they ask whether
 * six options fit or whether that question is too long. A chart mid-vote
 * is a picture of a moment; this is a picture of the slide.
 */
function paintBody(chart, q, deck, opts, room) {
  if (!q?.type) return;

  // Drawn still, the way the PDF export draws (see app/export-print.js).
  // Every chart in this app arrives: springs travel to their values and
  // a first cloud blooms word by word over 450ms. In front of a class
  // that is the point; in a preview it is forty thumbnails animating
  // bars nobody is watching grow, and a canvas repainted on every
  // keystroke that never finishes arriving. setMotionStill makes both
  // the springs and the delay() beats land at once, so a preview is the
  // slide at rest — which is the state an instructor is judging.
  setMotionStill(true);
  try {
    if (isContentSlide(q.type)) {
      renderInstructions(chart, {
        steps: joinSteps(q, opts.join),
        note: q.config?.note || '',
        showJoin: q.config?.show_join !== false,
        url: opts.join?.url || '',
        code: opts.join?.code || '',
        qrSVGText: opts.join?.qrSVG || null,
      });
      return;
    }
    renderAggregate(chart, q.type, aggregate(q.type, q.config, room.rows),
      chartOpts(q, deck, room));
  } finally {
    setMotionStill(false);
  }
}

/** An instructions slide's steps, with %CODE% / %URL% filled in. */
function joinSteps(q, join) {
  const raw = Array.isArray(q.config?.steps) && q.config.steps.length
    ? q.config.steps : DEFAULT_JOIN_STEPS;
  return raw
    .map((s) => fillJoinPlaceholders(s, { code: join?.code || '', url: join?.url || '' }))
    .filter((s) => s.trim());
}

/**
 * What present-page.js's paintChart() passes, for a slide whose voting
 * has closed and whose results are up.
 *
 * KEEP THIS IN STEP with paintChart(). The two lists are the same
 * decisions read from the same helpers; where this one differs it is
 * because a still preview has no live state — nothing is being voted on,
 * nothing has been sorted by hand, nothing can be binned from here.
 */
function chartOpts(q, deck, room) {
  const cfg = q.config || {};
  return {
    style: chartStyleFor(q, deck),
    hidden: false,
    revealCorrect: KEYED_TYPES.has(q.type) || cfg.mode === 'best',
    revealStyle: q.type === 'quiz' ? 'correct' : 'best',
    showPercent: showPercentFor(q, deck),
    // Voting has closed, so a full track means "share of the room" — see
    // the long note in renderChoice.
    roomScale: true,
    sorted: false,
    explain: cfg.explain,
    // the bin control is presenter-only; no other surface can act on it
    allowDelete: false,
    questions: room.questions ?? undefined,
    // an empty slide here means "this question drew nothing", not "wait"
    awaiting: false,
    leftLabel: cfg.left_label,
    rightLabel: cfg.right_label,
    corners: !!cfg.corners,
    showRationales: true,
    anchors: cfg.anchors,
    showAnchors: true,
    axes: q.type === 'quadrant' ? {
      xLeft: cfg.x_left, xRight: cfg.x_right,
      yLow: cfg.y_low, yHigh: cfg.y_high,
    } : undefined,
    verdict: q.type === 'consensus',
  };
}
