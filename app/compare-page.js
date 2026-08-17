/**
 * SurveyAll — how a question has gone, run over run.
 *
 * A session archive tells you what each class answered. It does not tell
 * you the thing an instructor actually wants to know, which is whether
 * the second section did better than the first, and whether this term's
 * cohort is stuck where last term's was. That question spans sessions,
 * so nothing in a single results page can answer it.
 *
 * Runs are matched by PROMPT TEXT, not by question id (see promptKey in
 * logic.js). Decks get copied for a new term — imported from text, given
 * new ids all the way down — and matching on ids would report that you
 * had asked each question exactly once, forever. Matching on the prompt
 * means "Is it ever right to break a promise?" is one question with six
 * askings behind it, which is what it is. Editing a prompt breaks the
 * link, and that is both acceptable and visible: the run simply stops
 * appearing in the row.
 *
 * What this deliberately cannot do is follow a person. Pseudonyms are
 * per-session by design, so every comparison here is room-to-room.
 */

import {
  configured, currentUser, getDeck, listDecks, listQuestions,
  listSessions, fetchResponses,
} from './db.js';
import {
  aggregate, sortedQuestions, computeDelta, promptKey, correctIndices,
  TYPE_LABELS, isContentSlide,
} from './logic.js';
import { applyTheme, resolveTheme } from './themes.js';
import { renderAggregate, renderDelta } from './charts.js';

const $ = (id) => document.getElementById(id);

/**
 * Runs drawn at once. Each run costs one response fetch and one small
 * chart per question, so an instructor three years into a course is a
 * real cost. The most recent are the ones being asked about.
 */
const MAX_RUNS = 8;

let deck = null;
let questions = [];

boot().catch(showFatal);

async function boot() {
  if (!configured) { window.location.replace('login'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }

  const deckId = new URLSearchParams(window.location.search).get('deck');
  if (!deckId) { window.location.replace('dashboard.html'); return; }

  deck = await getDeck(deckId);
  applyTheme(document.documentElement, resolveTheme(deck.theme, deck));
  $('crumb').textContent = `${deck.title} · run history`;

  const [allDecks, allSessions, own] = await Promise.all([
    listDecks(), listSessions(), listQuestions(deckId),
  ]);

  // Content slides have nothing to compare — a title card is not an answer.
  questions = sortedQuestions(own).filter((q) => !isContentSlide(q.type));
  const keys = new Map();
  questions.forEach((q) => {
    const k = promptKey(q.prompt);
    if (k) keys.set(k, q);
  });

  if (!keys.size) {
    renderHead([], 0);
    showEmpty('Nothing to compare yet',
      'This deck has no questions with prompts in it, so there is nothing to '
      + 'follow between runs.');
    return;
  }

  // Every deck's questions, so a copy of this deck made for a new term
  // lines up with the original by prompt.
  const byDeck = new Map([[deckId, questions]]);
  const others = allDecks.filter((d) => d.id !== deckId);
  const fetched = await Promise.all(
    others.map((d) => listQuestions(d.id).catch(() => [])));
  others.forEach((d, i) => byDeck.set(d.id, sortedQuestions(fetched[i] || [])));

  // A run is any session that produced answers to at least one of these
  // prompts. Oldest first, so the row reads left to right as time.
  const runs = allSessions
    .filter((s) => (s.response_count || 0) > 0)
    .filter((s) => (byDeck.get(s.deck_id) || []).some((q) => keys.has(promptKey(q.prompt))))
    .sort((a, b) => (Number(a.created_at) || 0) - (Number(b.created_at) || 0));

  const shown = runs.slice(-MAX_RUNS);
  renderHead(runs, shown.length);

  if (shown.length < 2) {
    showEmpty('Only one run so far',
      'Comparison needs at least two sessions that produced answers. Run this '
      + 'deck with another section, or in another term, and this page fills in.');
    return;
  }

  const responses = new Map();
  await Promise.all(shown.map(async (s) => {
    try { responses.set(s.id, await fetchResponses(s.id)); }
    catch { responses.set(s.id, []); }
  }));

  renderBlocks({ shown, byDeck, responses, deckTitles: new Map(allDecks.map((d) => [d.id, d.title])) });
}

// =====================================================================

function renderHead(runs, showing) {
  const host = $('head');
  host.textContent = '';

  const wrap = el('div', 'cmp-head');
  wrap.append(el('h1', 'cmp-title', `How “${deck.title}” has gone`));

  if (!runs.length) {
    wrap.append(el('p', 'cmp-sub', 'No runs with answers yet.'));
    host.append(wrap);
    return;
  }

  const first = new Date(Number(runs[0].created_at) || 0);
  const last = new Date(Number(runs[runs.length - 1].created_at) || 0);
  const total = runs.reduce((n, s) => n + (s.response_count || 0), 0);
  const span = sameMonth(first, last)
    ? monthYear(first)
    : `${monthYear(first)} – ${monthYear(last)}`;

  const bits = [
    `${runs.length} run${runs.length === 1 ? '' : 's'} with answers`,
    `${total.toLocaleString()} answers`,
    span,
  ];
  if (showing < runs.length) bits.push(`showing the ${showing} most recent`);
  wrap.append(el('p', 'cmp-sub', bits.join(' · ')));

  host.append(wrap);
}

function renderBlocks({ shown, byDeck, responses, deckTitles }) {
  const host = $('blocks');
  host.textContent = '';
  let drawn = 0;

  for (const q of questions) {
    const key = promptKey(q.prompt);

    // One column per run that asked this same prompt, as the same type.
    // A prompt reused with a different type is a different question.
    const cols = shown.map((s) => {
      const match = (byDeck.get(s.deck_id) || [])
        .find((x) => promptKey(x.prompt) === key && x.type === q.type);
      if (!match) return null;
      const rows = (responses.get(s.id) || []).filter((r) => r.question_id === match.id);
      if (!rows.length) return null;
      return {
        session: s,
        rows,
        agg: aggregate(q.type, match.config, rows),
        config: match.config,
        foreign: s.deck_id !== deck.id ? deckTitles.get(s.deck_id) : null,
      };
    }).filter(Boolean);

    if (cols.length < 2) continue;
    host.append(questionBlock(q, cols));
    drawn += 1;
  }

  if (!drawn) {
    showEmpty('No question has been asked twice yet',
      'Every run so far answered a different set of questions. Once the same '
      + 'prompt has been answered in two sessions, its runs line up here.');
  }
}

function questionBlock(q, cols) {
  const block = el('section', 'cmp-block');

  const head = el('div', 'cmp-block-head');
  head.append(el('h2', 'cmp-prompt', q.prompt || 'Untitled question'));
  const askedIn = cols.length;
  const foreign = new Set(cols.map((c) => c.foreign).filter(Boolean));
  const meta = [
    TYPE_LABELS[q.type] || q.type,
    `asked in ${askedIn} run${askedIn === 1 ? '' : 's'}`,
  ];
  if (foreign.size) meta.push(`including ${[...foreign].join(', ')}`);
  head.append(el('p', 'cmp-block-meta', meta.join(' · ')));
  block.append(head);

  // A quiz has a right answer, so the only summary worth leading with is
  // whether the room got it — over time, in one glance.
  if (q.type === 'quiz') {
    const trend = scoreTrend(q, cols);
    if (trend) block.append(trend);
  }

  block.append(runGrid(q, cols));

  // What moved between the earliest and latest run of this prompt.
  // renderDelta was built for asking the same room twice in one session,
  // so every phrase that assumes one room gets replaced here: these are
  // two different cohorts, and the difference between them is not anybody
  // changing their mind.
  const first = cols[0];
  const last = cols[cols.length - 1];
  const delta = computeDelta(first.agg, last.agg);
  if (delta) {
    delta.beforeLabel = runLabel(first.session);
    delta.afterLabel = runLabel(last.session);
    delta.movedLabel = 'of answers landed differently between these two runs.';
    delta.unchangedLabel = 'Both runs answered exactly the same way.';

    const wrap = el('div', 'cmp-delta');
    wrap.append(el('p', 'eyebrow', 'Earliest run compared with the latest'));
    const chart = el('div', 'chart');
    wrap.append(chart);
    block.append(wrap);
    renderDelta(chart, delta);
  }

  return block;
}

/** One row per run: the share of the room that got the quiz right. */
function scoreTrend(q, cols) {
  const rows = cols.map((c) => {
    const correct = correctIndices(c.config);
    if (!correct.length || !c.agg.total) return null;
    const got = correct.reduce((n, i) => n + (c.agg.options[i]?.count || 0), 0);
    return { session: c.session, pct: (got / c.agg.total) * 100, total: c.agg.total };
  });
  if (rows.some((r) => r === null)) return null;

  const wrap = el('div', 'cmp-trend');
  wrap.append(el('p', 'eyebrow', 'Share of the room that got it right'));

  // Deliberately one colour for every bar. Green means "correct" across
  // this whole product (see docs/visual-craft.md); spending it here on
  // "the best run" would give it a second meaning on a page where the
  // bars already say which run did best by being longer.
  rows.forEach((r) => {
    const row = el('div', 'cmp-trend-row');
    row.append(el('span', 'cmp-trend-label', runLabel(r.session)));
    const track = el('span', 'cmp-trend-track');
    const fill = el('span', 'cmp-trend-fill');
    fill.style.width = `${Math.max(1.5, r.pct)}%`;
    track.append(fill);
    row.append(track);
    const value = el('span', 'cmp-trend-value', `${Math.round(r.pct)}%`);
    value.title = `${r.total} answered`;
    row.append(value);
    wrap.append(row);
  });
  return wrap;
}

/** The small multiples: the same chart, once per run, in time order. */
function runGrid(q, cols) {
  const grid = el('div', 'cmp-runs');
  // Any borrowed run means every header in this block is three lines, so
  // the charts still line up along one baseline.
  if (cols.some((c) => c.foreign)) grid.classList.add('has-foreign');
  cols.forEach((c) => {
    const cell = el('div', 'cmp-run');

    const head = el('div', 'cmp-run-head');
    head.append(el('span', 'cmp-run-name', runLabel(c.session)));
    const people = new Set(c.rows.map((r) => r.pseudonym)).size;
    head.append(el('span', 'cmp-run-count',
      `${people} ${people === 1 ? 'person' : 'people'}`));
    if (c.foreign) head.append(el('span', 'cmp-run-deck', c.foreign));
    cell.append(head);

    const chart = el('div', 'chart cmp-chart');
    cell.append(chart);
    grid.append(cell);

    renderAggregate(chart, q.type, c.agg, {
      awaiting: false,          // archived data: zero is a fact, not a wait
      style: c.config?.chart || 'bars',
      revealCorrect: true,      // the session is over; every key is safe
    });
  });
  return grid;
}

// =====================================================================
// Bits
// =====================================================================

function runLabel(s) {
  const when = new Date(Number(s.created_at) || 0);
  const date = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return s.label ? `${s.label} · ${date}` : date;
}

function monthYear(d) {
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function sameMonth(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function showEmpty(title, text) {
  const host = $('blocks');
  host.textContent = '';
  const wrap = el('div', 'empty-state');
  wrap.append(el('h3', null, title), el('p', null, text));
  const back = document.createElement('a');
  back.className = 'btn';
  back.href = 'dashboard.html';
  back.textContent = 'Back to dashboard';
  wrap.append(back);
  host.append(wrap);
}

function showFatal(err) {
  console.error(err);
  const host = $('blocks');
  if (!host) return;
  host.textContent = '';
  host.append(el('div', 'alert alert-error', err.message || String(err)));
}
