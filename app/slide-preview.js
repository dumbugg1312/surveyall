/**
 * SurveyAll — miniature slides.
 *
 * One renderer, three sizes. The editor's left rail, the big canvas in the
 * middle, and the "new slide" gallery all draw the same thing: a 16:9
 * slide in the deck's own theme, showing a sketch of what that question
 * type actually looks like on the projector — with the instructor's real
 * options, statements and steps in it wherever they've typed them.
 *
 * That is the whole point of the rail. A list of prompts tells you what
 * you asked; a strip of slides tells you what the room will see, which is
 * the thing you are actually arranging.
 *
 * Everything inside a slide is sized in `em` and the slide's font-size is
 * a percentage of its own width (`cqw`), so one set of markup renders
 * identically at 9rem wide and at 40rem wide. Same trick present.css uses
 * to scale the projector.
 */

import {
  TYPE_LABELS, optionLabels, DEFAULT_JOIN_STEPS, fillJoinPlaceholders,
  trafficLabels, moodIcons, pairList, clozeParts, exitPrompts, timelineItems,
} from './logic.js';
import { getTheme, applyTheme, backgroundStyles, scrimOpacity } from './themes.js';
import { ambiencePlan, applyAmbience } from './ambience.js';
import { renderDecor, decorLayers } from './elements.js';

/** Deterministic bar lengths — a sketch must not jitter on every repaint. */
const BAR_WIDTHS = [88, 61, 44, 30, 22, 16];
const CLOUD_SIZES = [1.5, 1.05, 1.25, 0.8, 0.95, 0.7, 1.1, 0.75];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Trim a label so a thumbnail never tries to render an essay. */
function short(s, max = 34) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Draw one slide into `host` (which is emptied first).
 *
 * @param {HTMLElement} host
 * @param {object} q            question row (may be a bare {type} for the gallery)
 * @param {object} deck         the deck, for background + custom theme
 * @param {string|object} themeRef  resolved theme reference
 * @param {{kicker?: string, placeholder?: boolean, ambience?: boolean,
 *          join?: {code?: string, url?: string, qrSVG?: string}}} opts
 *        `join` carries the deck's real code, the address a person types,
 *        and an encoded QR. A deck owns its code from creation, so the
 *        editor draws the same scannable thing the room will see — no
 *        placeholder, no "it'll be real later".
 *        `ambience` opts this preview into the deck's backdrop motion.
 */
export function renderSlide(host, q, deck, themeRef, opts = {}) {
  host.textContent = '';

  const theme = getTheme(themeRef);
  const frame = el('div', 'sp-frame');
  const slide = el('div', 'sp-slide');
  // Which question this drawing is of. The same slide is drawn in several
  // places at once — rail thumbnail, big canvas, an open preview — and a
  // live in-place repaint has to be able to find *this* question's copies
  // rather than whatever happens to sit at the same index on another slide.
  if (q?.id != null) slide.dataset.qid = String(q.id);
  applyTheme(slide, themeRef);
  slide.style.backgroundColor = theme.tokens['--ground'];

  const backdrop = el('div', 'sp-backdrop');
  Object.assign(backdrop.style, backgroundStyles(deck?.background, themeRef));
  // Only the one big preview animates. The rail draws a thumbnail per
  // slide and the gallery a tile per type, and forty drifting miniatures
  // would be both a distraction and a real GPU bill for no information.
  if (opts.ambience) applyAmbience(backdrop, ambiencePlan(deck?.background, themeRef));
  const scrim = el('div', 'sp-scrim');
  scrim.style.background = theme.tokens['--ground'];
  scrim.style.opacity = String(scrimOpacity(deck?.background));

  const content = el('div', 'sp-content');
  if (opts.kicker) content.append(el('p', 'sp-kicker', opts.kicker));

  const prompt = el('h3', 'sp-prompt');
  prompt.textContent = q?.prompt?.trim()
    || (opts.placeholder ? TYPE_LABELS[q?.type] || 'Slide' : 'Untitled slide');
  if (!q?.prompt?.trim() && !opts.placeholder) prompt.classList.add('is-empty');
  content.append(prompt);

  const body = el('div', 'sp-body');
  body.append(sketch(q || {}, opts));
  content.append(body);

  // Placed elements, in two layers so an element can sit either side of
  // the content — a mark that points at a bar has to be on top of it, a
  // watermark has to be under it. The rail gets these too: a thumbnail
  // that omitted the decoration would be a worse map of the deck than one
  // that showed it, and arranging slides is what the rail is for.
  const decor = decorLayers();
  renderDecor(decor, q?.config);

  slide.append(backdrop, scrim, decor.back, content, decor.front);
  frame.append(slide);
  host.append(frame);
  return slide;
}

/** The per-type body sketch. */
function sketch(q, opts) {
  const cfg = q.config || {};
  switch (q.type) {
    case 'instructions': return instructionsSketch(cfg, opts);
    case 'multiple_choice':
    case 'quiz': return barsSketch(optionLabels(cfg), cfg, q.type === 'quiz');
    case 'word_cloud': return cloudSketch();
    case 'open_ended': return cardsSketch();
    case 'scales': return scalesSketch(cfg);
    case 'ranking': return rankingSketch(cfg);
    case 'spectrum': return spectrumSketch(cfg);
    case 'sample_vote': return showdownSketch(cfg);
    case 'heatmap': return heatmapSketch(cfg);
    case 'traffic': return trafficSketch(cfg);
    case 'mood': return moodSketch(cfg);
    case 'this_or_that': return tugSketch(cfg);
    case 'budget': return budgetSketch(cfg);
    case 'probability': return probabilitySketch(cfg);
    case 'cloze': return clozeSketch(cfg);
    case 'matching': return matchingSketch(cfg);
    case 'timeline': return timelineSketch(cfg);
    case 'exit_ticket': return exitSketch(cfg);
    case 'qa': return qaSketch();
    default: return el('div', 'sp-blank', opts.placeholder ? '' : 'Slide');
  }
}

// ---------------------------------------------------------- instructions

function instructionsSketch(cfg, opts = {}) {
  const wrap = el('div', 'sp-instructions');
  const code = opts.join?.code || '';
  // %URL% too, not just %CODE%. This file exists so the editor's preview
  // and the projector cannot drift apart, and a step that read as an empty
  // gap here and as a real address in class was exactly that drift.
  const url = opts.join?.url || '';

  const steps = (Array.isArray(cfg.steps) && cfg.steps.length ? cfg.steps : DEFAULT_JOIN_STEPS)
    .map((s) => fillJoinPlaceholders(s, { code, url }))
    .slice(0, 4);
  const list = el('ol', 'sp-steps');
  steps.forEach((s, i) => {
    const li = el('li', 'sp-step');
    li.append(el('span', 'sp-step-num', String(i + 1)));
    li.append(el('span', 'sp-step-text', short(s, 62)));
    list.append(li);
  });
  wrap.append(list);

  if (cfg.show_join !== false) {
    const card = el('div', 'sp-joincard');
    // A deck owns its code from creation, so this is the real, scannable
    // QR — the same image the projector will show. qrGlyph() survives only
    // for the type gallery, which has no deck behind it.
    if (opts.join?.qrSVG) {
      const qr = el('div', 'sp-qr sp-qr-real');
      qr.innerHTML = opts.join.qrSVG;
      card.append(qr);
    } else {
      card.append(qrGlyph());
    }
    const meta = el('div', 'sp-join-meta');
    meta.append(el('span', 'sp-join-label', 'Code'));
    meta.append(el('span', 'sp-join-code', code || '••••••'));
    card.append(meta);
    wrap.append(card);
  }
  return wrap;
}

/**
 * A stand-in QR, for the new-slide gallery only.
 *
 * Real decks have a real code and get a real encoded QR (see above); this
 * is for the type-picker tiles, which are drawn before any deck exists.
 * It carries the three finder squares because that is what makes a square
 * of noise legible as "a QR goes here" at thumbnail size; the middle is
 * fixed nonsense and encodes nothing.
 */
const QR_PATTERN = [
  '1110111',
  '1010101',
  '1110111',
  '0011010',
  '1110101',
  '1010011',
  '1110100',
].join('');

function qrGlyph() {
  const grid = el('div', 'sp-qr');
  grid.setAttribute('aria-hidden', 'true');
  for (const bit of QR_PATTERN) {
    const cell = el('span', bit === '1' ? 'sp-qr-on' : null);
    grid.append(cell);
  }
  return grid;
}

// ------------------------------------------------------------ questions

function barsSketch(labels, cfg, isQuiz) {
  const wrap = el('div', 'sp-bars');
  const correct = new Set(Array.isArray(cfg.correct) ? cfg.correct
    : (typeof cfg.correct === 'number' ? [cfg.correct] : []));
  const rows = labels.length ? labels.slice(0, 6) : ['', '', ''];

  if ((cfg.chart === 'donut' || cfg.chart === 'pie') && labels.length) {
    return donutSketch(rows.length);
  }

  rows.forEach((label, i) => {
    const row = el('div', 'sp-bar-row');
    const track = el('div', 'sp-bar-track');
    const fill = el('div', 'sp-bar-fill');
    fill.style.width = `${BAR_WIDTHS[i] ?? 14}%`;
    if ((isQuiz || cfg.mode === 'best') && correct.has(i)) fill.classList.add('is-key');
    else if (i % 2) fill.classList.add('is-alt');
    track.append(fill);
    row.append(track);
    if (label) row.append(el('span', 'sp-bar-label', short(label, 26)));
    wrap.append(row);
  });
  return wrap;
}

function donutSketch(slices) {
  const wrap = el('div', 'sp-donut-wrap');
  const ring = el('div', 'sp-donut');
  // deterministic wedges out of the two accents
  const stops = [];
  let at = 0;
  for (let i = 0; i < Math.max(2, slices); i += 1) {
    const step = 100 / Math.max(2, slices);
    stops.push(`var(${i % 2 ? '--accent-2' : '--accent'}) ${at}% ${at + step}%`);
    at += step;
  }
  ring.style.background = `conic-gradient(${stops.join(',')})`;
  wrap.append(ring);
  return wrap;
}

function cloudSketch() {
  const wrap = el('div', 'sp-cloud');
  const words = ['curious', 'tired', 'ready', 'unsure', 'keen', 'lost', 'hopeful', 'ok'];
  words.forEach((w, i) => {
    const s = el('span', 'sp-cloud-word', w);
    s.style.fontSize = `${CLOUD_SIZES[i]}em`;
    if (i % 3 === 0) s.classList.add('is-alt');
    wrap.append(s);
  });
  return wrap;
}

function cardsSketch() {
  const wrap = el('div', 'sp-cards');
  [3, 2, 3].forEach((lines) => {
    const card = el('div', 'sp-card');
    for (let i = 0; i < lines; i += 1) {
      const line = el('div', 'sp-line');
      line.style.width = `${[96, 82, 58][i] ?? 70}%`;
      card.append(line);
    }
    wrap.append(card);
  });
  return wrap;
}

function scalesSketch(cfg) {
  const wrap = el('div', 'sp-scales');
  const statements = (Array.isArray(cfg.statements) ? cfg.statements : []).slice(0, 4);
  const rows = statements.length ? statements : ['', '', ''];
  rows.forEach((label, i) => {
    const row = el('div', 'sp-scale-row');
    row.append(el('span', 'sp-scale-label', short(label, 22)));
    const track = el('div', 'sp-scale-track');
    const dot = el('span', 'sp-scale-dot');
    dot.style.left = `${[68, 40, 82, 55][i] ?? 50}%`;
    track.append(dot);
    row.append(track);
    wrap.append(row);
  });
  return wrap;
}

function rankingSketch(cfg) {
  const wrap = el('div', 'sp-rank');
  const items = (Array.isArray(cfg.items) ? cfg.items : []).slice(0, 4);
  const rows = items.length ? items : ['', '', ''];
  rows.forEach((label, i) => {
    const row = el('div', 'sp-rank-row');
    row.append(el('span', 'sp-rank-num', String(i + 1)));
    const bar = el('div', 'sp-rank-bar');
    bar.style.width = `${BAR_WIDTHS[i] ?? 20}%`;
    row.append(bar);
    if (label) row.append(el('span', 'sp-bar-label', short(label, 20)));
    wrap.append(row);
  });
  return wrap;
}

function spectrumSketch(cfg) {
  const wrap = el('div', 'sp-spectrum');
  const ends = el('div', 'sp-spectrum-ends');
  ends.append(el('span', null, short(cfg.left_label || 'Disagree', 16)));
  ends.append(el('span', null, short(cfg.right_label || 'Agree', 16)));
  const axis = el('div', 'sp-spectrum-axis');
  [12, 26, 33, 47, 52, 58, 61, 74, 81, 88].forEach((pos, i) => {
    const dot = el('span', 'sp-spectrum-dot');
    dot.style.left = `${pos}%`;
    dot.style.top = `${[20, 62, 34, 70, 18, 50, 80, 30, 66, 44][i]}%`;
    axis.append(dot);
  });
  wrap.append(ends, axis);
  return wrap;
}

function showdownSketch(cfg) {
  const wrap = el('div', 'sp-showdown');
  const samples = (Array.isArray(cfg.samples) ? cfg.samples : []).slice(0, 2);
  const rows = samples.length ? samples : ['', ''];
  rows.forEach((text, i) => {
    const panel = el('div', 'sp-sample');
    if (text) panel.append(el('span', 'sp-sample-text', short(text, 70)));
    else for (let k = 0; k < 3; k += 1) panel.append(el('div', 'sp-line'));
    const bar = el('div', 'sp-sample-bar');
    bar.style.width = `${i === 0 ? 64 : 36}%`;
    panel.append(bar);
    wrap.append(panel);
  });
  return wrap;
}

function heatmapSketch(cfg) {
  const wrap = el('div', 'sp-heat');
  const segs = (Array.isArray(cfg.segments) ? cfg.segments : []).slice(0, 4);
  const rows = segs.length ? segs : ['', '', '', ''];
  const blankWidths = ['62%', '38%', '80%', '46%'];
  rows.forEach((text, i) => {
    const seg = el('span', 'sp-heat-seg', text ? short(text, 54) : '');
    seg.style.setProperty('--heat', String([0.85, 0.25, 0.6, 0.15][i] ?? 0.3));
    if (!text) {
      seg.classList.add('is-blank');
      seg.style.width = blankWidths[i] ?? '50%';
    }
    wrap.append(seg);
  });
  return wrap;
}

// ------------------------------------------------ second-wave sketches
//
// Same contract as the ones above: deterministic, no randomness, and the
// instructor's own words wherever they have typed any — a thumbnail that
// invents plausible data is a thumbnail you learn to distrust.

function trafficSketch(cfg) {
  const wrap = el('div', 'sp-traffic');
  trafficLabels(cfg).forEach((text, i) => {
    const row = el('div', 'sp-traffic-row');
    const dot = el('span', 'sp-traffic-dot');
    dot.style.setProperty('--lamp-i', String(i));
    const bar = el('span', 'sp-traffic-bar');
    bar.style.width = `${[74, 42, 18][i] ?? 20}%`;
    bar.style.setProperty('--lamp-i', String(i));
    row.append(dot, bar, el('span', 'sp-traffic-label', short(text, 22)));
    wrap.append(row);
  });
  return wrap;
}

function moodSketch(cfg) {
  const wrap = el('div', 'sp-mood');
  moodIcons(cfg).slice(0, 5).forEach((m, i) => {
    const cell = el('div', 'sp-mood-cell');
    const glyph = el('span', 'sp-mood-glyph', m.emoji);
    glyph.style.setProperty('--mood-scale', String([0.72, 1, 0.86, 0.62, 0.78][i] ?? 0.7));
    cell.append(glyph);
    wrap.append(cell);
  });
  return wrap;
}

function tugSketch(cfg) {
  const wrap = el('div', 'sp-tug');
  const pairs = pairList(cfg);
  const rows = pairs.length ? pairs.slice(0, 3) : [{ left: '', right: '' }, { left: '', right: '' }];
  rows.forEach((pair, i) => {
    const row = el('div', 'sp-tug-row');
    row.append(el('span', 'sp-tug-name', short(pair.left, 12)));
    const rope = el('div', 'sp-tug-rope');
    const knot = el('span', 'sp-tug-knot');
    knot.style.left = `${[68, 34, 52][i] ?? 50}%`;
    rope.append(knot);
    row.append(rope, el('span', 'sp-tug-name', short(pair.right, 12)));
    wrap.append(row);
  });
  return wrap;
}

function budgetSketch(cfg) {
  const wrap = el('div', 'sp-budget');
  const labels = optionLabels(cfg);
  const rows = labels.length ? labels.slice(0, 4) : ['', '', ''];
  rows.forEach((text, i) => {
    const row = el('div', 'sp-budget-row');
    if (text) row.append(el('span', 'sp-bar-label', short(text, 18)));
    const track = el('div', 'sp-budget-track');
    const fill = el('div', 'sp-budget-fill');
    fill.style.width = `${[58, 74, 28, 12][i] ?? 20}%`;
    track.append(fill);
    row.append(track);
    wrap.append(row);
  });
  return wrap;
}

function probabilitySketch() {
  const wrap = el('div', 'sp-prob');
  [8, 16, 34, 62, 96, 78, 44, 26, 14, 6].forEach((h) => {
    const bar = el('span', 'sp-prob-bar');
    bar.style.height = `${h}%`;
    wrap.append(bar);
  });
  return wrap;
}

function clozeSketch(cfg) {
  const wrap = el('div', 'sp-cloze');
  const parts = clozeParts(cfg.text);
  if (!parts.length) {
    // nothing typed yet: show the shape a cloze makes, not a blank slide
    [['', 42], [null, 0], ['', 26], [null, 0], ['', 34]].forEach(([, w], i) => {
      if (i % 2) wrap.append(el('span', 'sp-cloze-blank'));
      else {
        const line = el('span', 'sp-cloze-run');
        line.style.width = `${w}%`;
        wrap.append(line);
      }
    });
    return wrap;
  }
  parts.slice(0, 7).forEach((p) => {
    if (p.kind === 'text') wrap.append(el('span', 'sp-cloze-text', short(p.text, 40)));
    else wrap.append(el('span', 'sp-cloze-blank'));
  });
  return wrap;
}

function matchingSketch(cfg) {
  const wrap = el('div', 'sp-match');
  const pairs = pairList(cfg);
  const rows = pairs.length ? pairs.slice(0, 4) : [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }];
  rows.forEach((pair, i) => {
    const row = el('div', 'sp-match-row');
    row.append(el('span', 'sp-match-side', short(pair.left, 14)));
    const track = el('div', 'sp-match-track');
    const key = el('span', 'sp-match-seg is-key');
    key.style.width = `${[72, 55, 88, 40][i] ?? 60}%`;
    const rest = el('span', 'sp-match-seg');
    rest.style.width = `${100 - ([72, 55, 88, 40][i] ?? 60)}%`;
    track.append(key, rest);
    row.append(track, el('span', 'sp-match-side', short(pair.right, 14)));
    wrap.append(row);
  });
  return wrap;
}

function timelineSketch(cfg) {
  const wrap = el('div', 'sp-timeline');
  const items = timelineItems(cfg).filter(Boolean);
  const rows = items.length ? items.slice(0, 4) : ['', '', ''];
  const n = rows.length;
  rows.forEach((text, i) => {
    const row = el('div', 'sp-timeline-row');
    row.append(el('span', 'sp-timeline-label', text ? short(text, 18) : ''));
    const cells = el('div', 'sp-timeline-cells');
    for (let k = 0; k < n; k += 1) {
      const cell = el('span', 'sp-timeline-cell');
      // a mostly-right room: the diagonal lit, one pair swapped
      const heat = k === i ? 0.85 : (Math.abs(k - i) === 1 ? 0.22 : 0.05);
      cell.style.setProperty('--heat', String(heat));
      if (k === i) cell.classList.add('is-key');
      cells.append(cell);
    }
    row.append(cells);
    wrap.append(row);
  });
  return wrap;
}

function exitSketch(cfg) {
  const wrap = el('div', 'sp-exit');
  exitPrompts(cfg).slice(0, 3).forEach((text, i) => {
    const col = el('div', 'sp-exit-col');
    col.append(el('span', 'sp-exit-head', short(text, 16)));
    for (let k = 0; k < [3, 2, 2][i]; k += 1) {
      const card = el('span', 'sp-exit-card');
      card.style.height = `${[1.5, 1.1, 1.3][k] ?? 1.2}em`;
      col.append(card);
    }
    wrap.append(col);
  });
  return wrap;
}

function qaSketch() {
  const wrap = el('div', 'sp-qa');
  [72, 88, 60].forEach((w, i) => {
    const bubble = el('div', 'sp-bubble');
    bubble.style.width = `${w}%`;
    if (i === 1) bubble.classList.add('is-alt');
    // the upvote pip is what separates a question from the room from a
    // plain answer card at thumbnail size
    bubble.append(el('span', 'sp-bubble-vote', '▲'));
    wrap.append(bubble);
  });
  return wrap;
}
