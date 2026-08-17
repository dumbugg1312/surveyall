/**
 * SurveyAll — presenter / projector controller.
 *
 * Runs on the instructor's laptop, projected. Advancing a question is a
 * single UPDATE to the session row; every phone in the room reacts to
 * that one write. Results stream in over a realtime subscription and the
 * charts animate in place.
 */

import {
  currentUser, getSession, getDeck, listQuestions, listSessions,
  updateSession, updateQuestion, fetchResponses, subscribeToResponses,
  subscribeToSession, clearResponses, maxRound, deleteResponse,
  listAudienceQuestions, moderateAudienceQuestion, subscribeToAudienceQuestions,
  subscribeToPresence,
} from './db.js';
import {
  aggregate, computeDelta, quizLeaderboard, sortedQuestions,
  neighbourQuestion, joinURL, TYPE_LABELS, correctIndices, optionLabels,
  promptKey, isContentSlide, fillJoinPlaceholders, DEFAULT_JOIN_STEPS,
  questionNumber, promptScale, showSlideLabel,
} from './logic.js';
import {
  applyTheme, backgroundStyles, scrimOpacity, resolveTheme,
} from './themes.js';
import { ambiencePlan, applyAmbience } from './ambience.js';
import {
  renderAggregate, renderDelta, renderLeaderboard, renderInstructions,
  celebrate, pulseCount,
} from './charts.js';
import { countTo, delay } from './motion.js';
import { renderQR, qrSVG, qrInk } from './qr.js';
import { joinBase } from './config.js';
import { renderDecor } from './elements.js';

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $('stage'), backdrop: $('backdrop'), scrim: $('scrim'),
  lobby: $('lobby'), lobbyTitle: $('lobbyTitle'), lobbyKicker: $('lobbyKicker'),
  lobbyQR: $('lobbyQR'), lobbyURL: $('lobbyURL'), lobbyCode: $('lobbyCode'),
  lobbyPresence: $('lobbyPresence'), lobbyPresenceText: $('lobbyPresenceText'),
  head: $('head'), kicker: $('kicker'), prompt: $('prompt'), timerHost: $('timerHost'),
  body: $('body'), chart: $('chart'),
  foot: $('foot'), countText: $('countText'), stateNote: $('stateNote'), dots: $('dots'),
  joinCorner: $('joinCorner'), cornerQR: $('cornerQR'),
  cornerURL: $('cornerURL'), cornerCode: $('cornerCode'),
  qaPanel: $('qaPanel'), qaBody: $('qaBody'), qaClose: $('qaClose'),
  flash: $('flash'), controls: $('controls'),
  decor: { back: $('decorBack'), front: $('decorFront') },
};

const state = {
  session: null,
  deck: null,
  questions: [],
  question: null,
  rows: [],
  view: 'results',       // 'results' | 'delta' | 'leaderboard'
  showCorner: true,
  timer: null,
  timerEnds: 0,
  unsubs: [],
  repaintQueued: false,
  chartPaintQueued: false,
  // live headcount from the Durable Object; null until the first event, so
  // the lobby can stay silent rather than flash a stale zero
  presence: null,
  // footer odometer state: what the count pill currently displays
  shownRows: null,
  shownPeople: null,
  lastPeople: null,
  countTween: null,
};

/**
 * Rehearsal mode. The editor opens this page in an iframe with `?preview=1`
 * and no session behind it; the shim answers the API from an invented room
 * in the parent tab, so everything below this line runs unchanged. Loaded
 * before boot() and after the imports on purpose — db.js reads
 * `window.fetch` when it calls, not when it loads.
 */
if (new URLSearchParams(window.location.search).has('preview')) {
  await import('./preview-net.js');
}

boot().catch((err) => {
  console.error(err);
  fatal(err.message || String(err));
});

// =====================================================================
// Boot
// =====================================================================

async function boot() {
  const user = await currentUser();
  if (!user) {
    window.location.href = `index.html?next=${encodeURIComponent(window.location.href)}`;
    return;
  }

  const sessionId = new URLSearchParams(window.location.search).get('session');
  if (!sessionId) return fatal('No session specified. Start one from the dashboard.');

  state.session = await getSession(sessionId);
  state.deck = await getDeck(state.session.deck_id);
  state.questions = sortedQuestions(await listQuestions(state.deck.id));

  applyTheme(document.documentElement,
    resolveTheme(state.session.theme || state.deck.theme, state.deck));
  // Deck-wide slide settings, applied once: the question's size, and
  // whether the room is told which slide it is looking at.
  document.documentElement.style.setProperty('--prompt-scale',
    String(promptScale(state.deck)));
  paintBackground();
  // awaited: an instructions slide stamps the encoded QR straight into the
  // slide, so it has to exist before the first render, not one frame later
  await paintJoin();
  wireControls();
  wireKeyboard();

  state.unsubs.push(subscribeToResponses(state.session.id, onResponseEvent));
  state.unsubs.push(subscribeToSession(state.session.id, (row) => {
    state.session = { ...state.session, ...row };
    queueRepaint();
  }));
  state.unsubs.push(subscribeToAudienceQuestions(state.session.id, loadQA));
  state.unsubs.push(subscribeToPresence(state.session.id, (n) => {
    state.presence = n;
    renderPresence();
  }));

  // Backstop poll: if realtime drops, the count still creeps up.
  setInterval(() => {
    if (state.question && !isContentSlide(state.question.type)) loadRows();
  }, 10000);

  await render();
}

function fatal(msg) {
  ui.lobby.hidden = false;
  ui.lobbyTitle.textContent = 'Can\'t start';
  ui.lobbyKicker.textContent = 'SurveyAll';
  ui.lobby.querySelector('.lobby-sub').textContent = msg;
  ui.lobby.querySelector('#lobbyJoin').hidden = true;
}

// =====================================================================
// Look
// =====================================================================

function paintBackground() {
  const theme = resolveTheme(state.session.theme || state.deck.theme, state.deck);
  const styles = backgroundStyles(state.deck.background, theme);
  Object.assign(ui.backdrop.style, styles);
  ui.scrim.style.opacity = String(scrimOpacity(state.deck.background));
  // Purely decorative drift, on the compositor, below the scrim. Safe to
  // re-apply on every repaint: it reuses its layers rather than
  // restarting them, so a theme change re-tints mid-cycle instead of
  // snapping the whole backdrop back to frame zero.
  applyAmbience(ui.backdrop, ambiencePlan(state.deck.background, theme));
}

async function paintJoin() {
  // The deck's permanent code is what the instructions slide showed while
  // this deck was being written, and what any handout printed. Prefer it,
  // and fall back to the session's own code for sessions started before
  // decks had codes — those still resolve server-side.
  const code = state.deck.join_code || state.session.join_code;
  const url = joinURL(joinBase(), code);
  const pretty = url.replace(/^https?:\/\//, '').replace(/\/join\.html#.*$/, '');

  state.joinURL = url;
  state.joinPretty = pretty;

  state.joinCode = code;
  ui.lobbyCode.textContent = code;
  ui.cornerCode.textContent = code;
  ui.lobbyURL.textContent = pretty;
  ui.cornerURL.textContent = pretty;

  // qrInk keeps the code readable on its white plate even when the theme's
  // ink is near-white — on a dark theme, tinting it would produce a QR no
  // phone in the room can decode.
  const ink = qrInk(
    getComputedStyle(document.documentElement).getPropertyValue('--ink').trim());
  await renderQR(ui.lobbyQR, url, { dark: ink, light: '#ffffff' });
  await renderQR(ui.cornerQR, url, { dark: ink, light: '#ffffff' });
  // kept as markup so an instructions slide can stamp it without a second
  // encode on every repaint
  state.joinQRSVG = await qrSVG(url, { dark: ink, light: '#ffffff' });
}

// =====================================================================
// Render
// =====================================================================

function queueRepaint() {
  if (state.repaintQueued) return;
  state.repaintQueued = true;
  requestAnimationFrame(() => { state.repaintQueued = false; render(); });
}

/**
 * Narrate the room for screen-reader users. Every competitor's documented
 * accessibility failure is exactly this: state changes (votes arriving,
 * voting closing, the reveal) happen silently. One polite live region,
 * plain sentences, no per-student anything.
 */
function announce(text) {
  const el = $('srStatus');
  if (el) el.textContent = text;
}

/**
 * The live "N here" pill. Shown only in the lobby — once a question is up,
 * the response count is the number that matters. Ended sessions say nothing
 * about who is still connected. Hidden until the first count arrives so it
 * never flashes a stale zero, and reads as words at the extremes so a
 * projected room never sees a bare "0".
 */
function renderPresence() {
  const el = ui.lobbyPresence;
  if (!el) return;
  const s = state.session;
  const inLobby = s && s.state !== 'live' && s.state !== 'ended';
  if (!inLobby || state.presence == null) { el.hidden = true; return; }
  const n = state.presence;
  ui.lobbyPresenceText.textContent =
    n <= 0 ? 'Waiting for the room…' : `${n} here`;
  el.hidden = false;
}

async function render() {
  const s = state.session;

  if (s.state !== 'live' || !s.current_question_id) {
    ui.lobby.hidden = false;
    ui.head.hidden = ui.body.hidden = ui.foot.hidden = true;
    ui.joinCorner.hidden = true;
    ui.stage.classList.remove('is-awaiting');
    // The lobby is the deck's front door, not a slide — it carries the
    // title and the code and nothing else. Decor belongs to slides.
    renderDecor(ui.decor, null);
    ui.lobbyTitle.textContent = s.state === 'ended'
      ? 'Session ended'
      : (state.deck.title || 'Ready when you are');
    ui.lobbyKicker.textContent = s.state === 'ended' ? 'Thanks' : 'Join now';
    renderPresence();
    return;
  }

  ui.lobby.hidden = true;
  renderPresence();
  ui.head.hidden = ui.body.hidden = ui.foot.hidden = false;
  // The `hidden` attribute answers only "is a question on screen"; whether
  // the instructor tucked the corner away (J) is the class, one source of
  // truth, so the J toggle survives re-renders instead of being overwritten.
  ui.joinCorner.hidden = false;
  ui.joinCorner.classList.toggle('is-hidden', !state.showCorner);

  const q = state.questions.find((x) => x.id === s.current_question_id);
  const changed = state.question?.id !== q?.id || state.question?.__round !== s.current_round;
  state.question = q ? { ...q, __round: s.current_round } : null;
  if (!q) return;

  // A content slide has no question number and no round — calling it
  // "Question 3 of 9" would be a lie the room can see.
  const content = isContentSlide(q.type);
  const n = questionNumber(state.questions, q.id);
  ui.stage.classList.toggle('is-content-slide', content);
  ui.kicker.hidden = !showSlideLabel(state.deck);
  ui.kicker.textContent = content
    ? `Slide ${(q.position ?? 0) + 1} of ${state.questions.length}`
    : `${TYPE_LABELS[q.type] || q.type} · Question ${n.number} of ${n.total}`
      + (s.current_round > 1 ? ` · Round ${s.current_round}` : '');
  ui.prompt.textContent = q.prompt || '';

  // The instructions slide already shows a QR the size of a dinner plate;
  // the corner copy on top of it is just clutter.
  if (content && q.config?.show_join !== false) ui.joinCorner.hidden = true;

  paintDots();
  paintControlStates();

  if (changed) {
    // Only on a real slide change. render() also runs on every arriving
    // vote, and repainting the decor each time would restart its
    // entrance animation under the room every few seconds.
    renderDecor(ui.decor, q.config);

    state.view = 'results';
    state.rows = [];
    resetChart();
    stopTimer();
    endPairPhase(false);
    state.compareWith = null;
    curateSelection = null;
    clearCurateMenu();
    document.getElementById('compareBar')?.remove();
    setCtrlLabel('btnDiscuss', 'Discuss');
    // a fresh question starts its count from scratch, no count-down tween
    state.countTween?.();
    state.countTween = null;
    state.shownRows = state.shownPeople = state.lastPeople = null;
    state.srCount = null;
    state.srCountAt = 0;
    announce(content
      ? `${q.prompt || 'Instructions'}. ${joinSteps(q).join(' ')}`
      : `Question ${n.number}: ${q.prompt || ''}. `
        + (s.accepting ? 'Voting is open.' : 'Voting is closed.'));
  }

  // Nothing is submitted against a content slide, so there is nothing to
  // fetch, count, or subscribe to — draw it and stop.
  if (content) { paintContentSlide(q); return; }

  await loadRows();
}

/** An instructions slide's steps, with %CODE% / %URL% filled in. */
function joinSteps(q) {
  const raw = Array.isArray(q.config?.steps) && q.config.steps.length
    ? q.config.steps : DEFAULT_JOIN_STEPS;
  return raw
    .map((s) => fillJoinPlaceholders(s, {
      code: state.joinCode || state.session.join_code,
      url: state.joinPretty || '',
    }))
    .filter((s) => s.trim());
}

function paintContentSlide(q) {
  // paintChart owns is-awaiting and is not running here, so clear it
  // ourselves rather than inheriting it from the question we just left.
  ui.stage.classList.remove('is-awaiting');
  resetChart();
  renderInstructions(ui.chart, {
    steps: joinSteps(q),
    note: q.config?.note || '',
    showJoin: q.config?.show_join !== false,
    url: state.joinPretty || '',
    code: state.joinCode || state.session.join_code,
    qrSVGText: state.joinQRSVG,
  });
}

function paintDots() {
  const cur = state.questions.findIndex((x) => x.id === state.session.current_question_id);
  ui.dots.textContent = '';
  state.questions.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'progress-dot'
      + (i < cur ? ' is-done' : '')
      + (i === cur ? ' is-current' : '');
    ui.dots.append(dot);
  });
}

/** Write a control's caption without disturbing the <kbd> key printed on it. */
function setCtrlLabel(id, text) {
  const el = $(id).querySelector('.ctrl-label') || $(id);
  el.textContent = text;
}

function paintControlStates() {
  const s = state.session;
  setCtrlLabel('btnHide', s.reveal ? 'Hide' : 'Show');
  $('btnHide').classList.toggle('is-active', !s.reveal);
  setCtrlLabel('btnClose', s.accepting ? 'Close voting' : 'Open voting');
  $('btnClose').classList.toggle('is-active', !s.accepting);
  $('btnShare').classList.toggle('is-active', s.show_on_devices);
  $('btnDelta').classList.toggle('is-active', state.view === 'delta');
  $('btnBoard').classList.toggle('is-active', state.view === 'leaderboard');

  ui.stateNote.textContent = !s.accepting
    ? 'Voting closed'
    : (!s.reveal ? 'Results hidden from the room' : '');
}

async function loadRows() {
  const q = state.question;
  if (!q) return;
  try {
    state.rows = await fetchResponses(state.session.id, q.id, state.session.current_round);
  } catch (err) {
    console.error(err);
    return;
  }
  paintChart();
}

function onResponseEvent(row, eventType) {
  const q = state.question;
  if (eventType === 'CLEARED') { loadRows(); return; }
  if (!q || !row) return;
  if (row.question_id !== q.id || row.round !== state.session.current_round) return;

  if (eventType === 'DELETE') {
    state.rows = state.rows.filter((r) => r.id !== row.id);
  } else {
    const i = state.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) state.rows[i] = row; else state.rows.push(row);
  }
  queuePaintChart();
}

/**
 * Coalesce response events into one repaint per frame. Sixty phones
 * answering inside a second used to mean sixty synchronous renders; the
 * springs are built to retarget mid-flight, so one paint per frame gives
 * the same motion for a fraction of the work.
 */
function queuePaintChart() {
  if (state.chartPaintQueued) return;
  state.chartPaintQueued = true;
  requestAnimationFrame(() => {
    state.chartPaintQueued = false;
    paintChart();
  });
}

/**
 * Full chart teardown. Emptying textContent alone is a trap: useChart's
 * per-container state survives, still holding references to the now
 * detached rows, and the next render updates nodes nobody can see. Any
 * wipe of #chart must also drop that state.
 */
function resetChart() {
  ui.chart.__chart?.group?.destroy();
  delete ui.chart.__chart;
  delete ui.chart.dataset.chart;
  ui.chart.removeAttribute('data-awaiting');
  ui.chart.textContent = '';
}

/**
 * Types that carry an answer key. Their charts hold it back until voting
 * is closed AND results are revealed, so a slide left on screen while
 * people are still answering never prints the answer.
 */
const KEYED_TYPES = new Set(['quiz', 'cloze', 'matching', 'timeline']);

function formatCount(q, nRows, nPeople) {
  return q.type === 'open_ended' || q.type === 'word_cloud'
    ? `${nRows} ${nRows === 1 ? 'response' : 'responses'} · ${nPeople} people`
    : `${nPeople} ${nPeople === 1 ? 'response' : 'responses'}`;
}

function paintChart() {
  const q = state.question;
  if (!q) return;

  const respondents = new Set(state.rows.map((r) => r.pseudonym)).size;
  const nRows = state.rows.length;

  // The count pill is peripheral vision's chart: the number rolls to its
  // new value (a tween, not a spring — counters must never overshoot) and
  // the pill physically pulses when another person's first answer lands.
  if (respondents > (state.lastPeople ?? respondents)) pulseCount($('countPill'));
  state.lastPeople = respondents;

  // rate-limited so a screen reader hears the room filling without
  // being machine-gunned by sixty arrivals
  if (respondents !== state.srCount
      && performance.now() - (state.srCountAt || 0) > 8000) {
    state.srCount = respondents;
    state.srCountAt = performance.now();
    if (respondents > 0) {
      announce(`${respondents} ${respondents === 1 ? 'response' : 'responses'} so far.`);
    }
  }

  if (state.shownRows == null || (nRows === state.shownRows && respondents === state.shownPeople)) {
    state.shownRows = nRows;
    state.shownPeople = respondents;
    ui.countText.textContent = formatCount(q, nRows, respondents);
  } else {
    const fromRows = state.shownRows;
    const fromPeople = state.shownPeople;
    state.countTween?.();
    state.countTween = countTo(0, 1, 0.5, (t) => {
      state.shownRows = Math.round(fromRows + (nRows - fromRows) * t);
      state.shownPeople = Math.round(fromPeople + (respondents - fromPeople) * t);
      ui.countText.textContent = formatCount(q, state.shownRows, state.shownPeople);
    });
  }

  // Nobody has answered yet and answers are possible: the join corner
  // steps forward (see .stage.is-awaiting in present.css) and steps back
  // the moment the first vote lands.
  ui.stage.classList.toggle('is-awaiting',
    state.view === 'results' && respondents === 0
    && !!state.session.accepting && !!state.session.reveal);

  paintHands();
  paintPIHint();

  if (state.view === 'leaderboard') return paintLeaderboard();
  if (state.view === 'delta') return paintDelta();
  document.getElementById('compareBar')?.remove();

  // hold-for-review (roadmap feature 8): unapproved open text stays off
  // the projector until the presenter waves it through
  const rows = holdActive(q)
    ? state.rows.filter((r) => holdApprovals(q).has(String(r.id)))
    : state.rows;
  paintHoldStrip(q);

  const s = state.session;
  const revealKey = (KEYED_TYPES.has(q.type) || q.config?.mode === 'best')
    && !s.accepting && s.reveal;
  const agg = aggregate(q.type, q.config, rows);
  renderAggregate(ui.chart, q.type, agg, {
    style: q.config?.chart || 'bars',
    hidden: !s.reveal,
    revealCorrect: revealKey,
    revealStyle: q.type === 'quiz' ? 'correct' : 'best',
    showPercent: q.config?.show_counts !== true,
    // voting closed on zero answers is "no responses", not "waiting"
    awaiting: !!s.accepting,
    leftLabel: q.config?.left_label,
    rightLabel: q.config?.right_label,
    corners: !!q.config?.corners,
    showRationales: !s.accepting && s.reveal,
    anchors: q.config?.anchors,
    showAnchors: !s.accepting && s.reveal,
  });

  paintCloudCuration(q, agg);

  // let the instructor bin an inappropriate open response on the spot
  if (q.type === 'open_ended') wireCardDeletes(agg);
}

function wireCardDeletes(agg) {
  ui.chart.querySelectorAll('.answer-delete').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', ctrl(async (e) => {
      const card = e.target.closest('.answer-card');
      const idx = Number(card?.dataset.index);
      const text = agg.entries?.[idx]?.text;
      const row = state.rows.find((r) => (r.payload?.text || '').trim() === (text || '').trim());
      if (!row) return;
      await deleteResponse(row.id);
      state.rows = state.rows.filter((r) => r.id !== row.id);
      paintChart();
    }));
  });
}

// ---------------------------------------------------------- volunteers

function paintHands() {
  const hands = new Set(
    state.rows.filter((r) => r.payload?.volunteer).map((r) => r.pseudonym)).size;
  $('handsPill').hidden = hands === 0;
  if (hands > 0) $('handsText').textContent = String(hands);
}

// ------------------------------------------------- decision hint (PI)
// Mazur's band, from ten years of Peer Instruction data: under ~35%
// correct, reteach; 35–70%, discuss and re-ask (the sweet spot); over
// 70%, confirm and move on. Shown only in the transient ⋯ tray, and only
// while results are hidden — it IS the round-one number.

function paintPIHint() {
  const q = state.question;
  const hint = $('piHint');
  const marks = q ? correctIndices(q.config || {}) : [];
  const eligible = q && marks.length
    && (q.type === 'quiz' || q.type === 'multiple_choice')
    && !state.session.reveal;
  if (!eligible) { hint.hidden = true; return; }

  const byPerson = new Map();
  for (const r of state.rows) {
    const p = r.payload || {};
    const picks = Number.isInteger(p.choice) ? [p.choice]
      : (Array.isArray(p.choices) ? p.choices : []);
    if (picks.length) byPerson.set(r.pseudonym, picks.every((i) => marks.includes(i)));
  }
  if (!byPerson.size) { hint.hidden = true; return; }

  const right = [...byPerson.values()].filter(Boolean).length;
  const pct = Math.round((right / byPerson.size) * 100);
  const band = pct < 35 ? 'reteach' : pct <= 70 ? 'discuss & re-ask' : 'move on';
  hint.textContent = `${pct}% · ${band}`;
  hint.dataset.band = pct < 35 ? 'low' : pct <= 70 ? 'mid' : 'high';
  hint.hidden = false;
}

// ------------------------------------------------------ hold for review

function holdActive(q) {
  return !!q.config?.hold && (q.type === 'word_cloud' || q.type === 'open_ended');
}

function holdKey(q) {
  return `sa:hold:${state.session.id}:${q.id}:${state.session.current_round}`;
}

function holdApprovals(q) {
  try { return new Set(JSON.parse(localStorage.getItem(holdKey(q))) || []); } catch { return new Set(); }
}

function approveRows(q, ids) {
  const set = holdApprovals(q);
  ids.forEach((id) => set.add(String(id)));
  try { localStorage.setItem(holdKey(q), JSON.stringify([...set])); } catch { /* full */ }
  paintChart();
}

function paintHoldStrip(q) {
  let strip = $('holdStrip');
  if (!holdActive(q)) { if (strip) strip.remove(); return; }
  const approved = holdApprovals(q);
  const pending = state.rows.filter((r) => !approved.has(String(r.id)));

  if (!strip) {
    strip = document.createElement('div');
    strip.id = 'holdStrip';
    strip.className = 'hold-strip';
    ui.body.append(strip);
  }
  strip.textContent = '';
  if (!pending.length) {
    strip.append(Object.assign(document.createElement('span'),
      { className: 'hold-note', textContent: 'Hold is on — new answers wait here.' }));
    return;
  }
  const note = document.createElement('span');
  note.className = 'hold-note';
  note.textContent = `${pending.length} waiting:`;
  strip.append(note);
  pending.slice(0, 12).forEach((r) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'hold-chip';
    const text = (r.payload?.words || []).join(', ') || r.payload?.text || '…';
    chip.textContent = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    chip.title = 'Show this answer';
    chip.addEventListener('click', () => approveRows(q, [r.id]));
    strip.append(chip);
  });
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'hold-chip hold-all';
  all.textContent = 'Show all';
  all.addEventListener('click', () => approveRows(q, pending.map((r) => r.id)));
  strip.append(all);
}

// --------------------------------------------------- cloud curation
// Tap a word → hide it or merge it into another word. Every act of
// curation is counted on-screen ("2 merged · 1 hidden"): the instructor
// shapes the aggregate, never silently rewrites it.

function paintCloudCuration(q, agg) {
  let chip = $('curateChip');
  if (q.type !== 'word_cloud') {
    if (chip) chip.remove();
    return;
  }
  const merged = agg.merged || 0;
  const hidden = agg.hidden || 0;
  if (!chip) {
    chip = document.createElement('button');
    chip.type = 'button';
    chip.id = 'curateChip';
    chip.className = 'curate-chip';
    chip.title = 'Curation is visible: click to undo all merges and hides';
    chip.addEventListener('click', ctrl(async () => {
      if (!window.confirm('Undo all merges and un-hide all words?')) return;
      const config = { ...state.question.config };
      delete config.word_merges;
      delete config.word_hidden;
      await saveQuestionConfig(config);
    }));
    ui.foot.append(chip);
  }
  chip.hidden = !(merged || hidden);
  if (merged || hidden) {
    chip.textContent = [
      merged ? `${merged} merged` : '',
      hidden ? `${hidden} hidden` : '',
    ].filter(Boolean).join(' · ');
  }
  wireCloudWordTaps(q);
}

let curateSelection = null; // the word awaiting a merge target

function wireCloudWordTaps(q) {
  ui.chart.querySelectorAll('.cloud-word').forEach((node) => {
    if (node.dataset.curateWired) return;
    node.dataset.curateWired = '1';
    node.style.cursor = 'pointer';
    node.addEventListener('click', () => onCloudWordTap(node.dataset.word));
  });
}

async function onCloudWordTap(word) {
  if (!word) return;
  if (curateSelection && curateSelection !== word) {
    // second tap = merge target
    const from = curateSelection;
    curateSelection = null;
    clearCurateMenu();
    const config = { ...state.question.config };
    config.word_merges = { ...(config.word_merges || {}), [from]: word };
    await saveQuestionConfig(config);
    flash(`“${from}” → “${word}”`);
    return;
  }
  curateSelection = word;
  showCurateMenu(word);
}

function showCurateMenu(word) {
  clearCurateMenu();
  const menu = document.createElement('div');
  menu.id = 'curateMenu';
  menu.className = 'curate-menu';
  const label = document.createElement('span');
  label.className = 'curate-word';
  label.textContent = `“${word}”`;
  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.className = 'hold-chip';
  hideBtn.textContent = 'Hide';
  hideBtn.addEventListener('click', ctrl(async () => {
    curateSelection = null;
    clearCurateMenu();
    const config = { ...state.question.config };
    config.word_hidden = [...new Set([...(config.word_hidden || []), word])];
    await saveQuestionConfig(config);
  }));
  const mergeNote = document.createElement('span');
  mergeNote.className = 'hold-note';
  mergeNote.textContent = 'or tap another word to merge into it';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'hold-chip';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => { curateSelection = null; clearCurateMenu(); });
  menu.append(label, hideBtn, mergeNote, cancel);
  ui.foot.append(menu);
}

function clearCurateMenu() {
  document.getElementById('curateMenu')?.remove();
}

async function saveQuestionConfig(config) {
  state.question.config = config;
  const idx = state.questions.findIndex((x) => x.id === state.question.id);
  if (idx >= 0) state.questions[idx].config = config;
  await updateQuestion(state.question.id, { config });
  paintChart();
}

// ------------------------------------------- discussion engine (PI)
// One button, three beats: close & discuss → vote again → reveal the
// change. Every beat is also reachable through the existing single keys;
// this only sequences them and never auto-advances — the instructor
// always fires the next step.

async function discussStep() {
  const q = state.question;
  if (!q || q.type === 'qa' || isContentSlide(q.type)) {
    flash('Pick a question first');
    return;
  }

  if (state.pairUntil) { await endPairPhase(true); return; }

  const s = state.session;
  if (s.accepting && s.current_round >= 2) {
    // final beat: close round two and reveal what moved
    await patch({ accepting: false, reveal: true });
    state.view = 'delta';
    paintControlStates();
    paintChart();
    announce('Both rounds revealed.');
    return;
  }
  if (s.accepting) {
    // first beat: commit answers, hide the histogram, talk
    await patch({ accepting: false, reveal: false });
    startPairPhase(q.config?.discuss_time || 180);
    return;
  }
  // voting closed: open a hidden-results round to start the cycle
  await patch({ accepting: true, reveal: false });
  flash('Voting open');
  announce('Voting open. Results are hidden until the reveal.');
}

function ensurePairOverlay() {
  let ov = $('pairOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'pairOverlay';
    ov.className = 'pair-overlay';
    ov.innerHTML = '<p class="pair-kicker">Discuss</p>'
      + '<p class="pair-line">Convince your neighbor.</p>'
      + '<p class="pair-clock" id="pairClock"></p>'
      + '<p class="pair-sub">Then we vote again.</p>';
    ui.body.append(ov);
  }
  return ov;
}

function startPairPhase(seconds) {
  const ov = ensurePairOverlay();
  ov.hidden = false;
  // The pair overlay lives inside .stage-body, so it cannot stack above
  // the decor layer on .stage. The discussion phase is a full takeover —
  // one instruction and one clock — so the decoration steps back for it.
  ui.stage.classList.add('is-pairing');
  state.pairUntil = Date.now() + seconds * 1000;
  const clock = $('pairClock');
  const tick = () => {
    const left = Math.max(0, Math.ceil((state.pairUntil - Date.now()) / 1000));
    clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    clock.classList.toggle('is-done', left <= 0);
  };
  tick();
  state.pairTimer = setInterval(tick, 250);
  setCtrlLabel('btnDiscuss', 'Vote again');
  flash('Discuss');
  announce(`Discussion time: ${Math.round(seconds / 60)} minutes. Convince your neighbor.`);
}

async function endPairPhase(advance) {
  if (state.pairTimer) clearInterval(state.pairTimer);
  state.pairTimer = null;
  state.pairUntil = null;
  const ov = $('pairOverlay');
  if (ov) ov.hidden = true;
  ui.stage.classList.remove('is-pairing');
  setCtrlLabel('btnDiscuss', 'Discuss');
  if (!advance) return;
  const q = state.question;
  const highest = await maxRound(state.session.id, q.id);
  const next = Math.max(state.session.current_round, highest) + 1;
  await patch({ current_round: next, accepting: true, reveal: false });
  setCtrlLabel('btnDiscuss', 'Reveal');
  flash('Vote again');
  announce('Round two. Vote again — did the discussion move you?');
}

// -------------------------------------- compare picker (time travel)

async function ensureCompareBar() {
  let bar = $('compareBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'compareBar';
  bar.className = 'compare-bar';
  const label = document.createElement('span');
  label.textContent = 'Compare with';
  const sel = document.createElement('select');
  sel.id = 'compareSel';
  sel.append(new Option('Previous round (this session)', ''));
  try {
    const sessions = await listSessions();
    state.compareSessions = (sessions || [])
      .filter((s2) => s2.id !== state.session.id);
    state.compareSessions.forEach((s2) => {
      const when = s2.created_at ? new Date(s2.created_at).toLocaleDateString() : '';
      sel.append(new Option(
        `${s2.label || s2.join_code} · ${when}${s2.deck_id !== state.deck.id ? ' (other deck)' : ''}`,
        s2.id));
    });
  } catch { /* list is a bonus */ }
  sel.addEventListener('change', () => {
    state.compareWith = sel.value || null;
    paintChart();
  });
  bar.append(label, sel);
  ui.body.prepend(bar);
  return bar;
}

/** Rows from the compared session for this question (matched by prompt
 *  when the deck differs), or null when there is nothing to compare. */
async function compareBeforeRows(q) {
  const other = (state.compareSessions || []).find((s2) => s2.id === state.compareWith);
  if (!other) return null;
  let qid = q.id;
  if (other.deck_id !== state.deck.id) {
    const qs = await listQuestions(other.deck_id);
    const match = qs.find((x) => promptKey(x.prompt) === promptKey(q.prompt));
    if (!match) { toastOnce('No matching question in that session\'s deck.'); return null; }
    qid = match.id;
  }
  const r = await maxRound(other.id, qid);
  return fetchResponses(other.id, qid, r || 1);
}

let toastShown = new Set();
function toastOnce(msg) {
  if (toastShown.has(msg)) return;
  toastShown.add(msg);
  flash(msg);
}

async function paintDelta() {
  const q = state.question;
  const round = state.session.current_round;
  await ensureCompareBar();

  let before = null;
  if (state.compareWith) {
    before = await compareBeforeRows(q);
  } else if (round >= 2) {
    before = await fetchResponses(state.session.id, q.id, round - 1);
  }
  if (!before) {
    renderDelta(ui.chart, null);
    return;
  }
  const after = await fetchResponses(state.session.id, q.id, round);
  const beforeAgg = aggregate(q.type, q.config, before);
  const afterAgg = aggregate(q.type, q.config, after);

  // clouds morph rather than ghost: paint the old counts, then let the
  // springs carry every word to its new size and place. The fresh
  // teardown is what makes the replay possible — otherwise the current
  // round is already on screen and there is nothing to travel from.
  if (q.type === 'word_cloud') {
    resetChart();
    renderAggregate(ui.chart, q.type, beforeAgg, { awaiting: false });
    delay(0.9, () => {
      if (state.view !== 'delta') return;
      renderAggregate(ui.chart, q.type, afterAgg, { awaiting: false });
    });
    return;
  }
  // spectra migrate: same dots, old position to new
  if (q.type === 'spectrum') {
    resetChart();
    renderAggregate(ui.chart, q.type, afterAgg, {
      awaiting: false,
      beforePoints: beforeAgg.points,
      leftLabel: q.config?.left_label,
      rightLabel: q.config?.right_label,
      corners: !!q.config?.corners,
    });
    return;
  }
  const delta = computeDelta(beforeAgg, afterAgg);
  if (delta && state.compareWith) {
    const other = (state.compareSessions || []).find((s2) => s2.id === state.compareWith);
    delta.beforeLabel = other?.label || other?.join_code || 'Then';
    delta.afterLabel = 'This session';
  }
  renderDelta(ui.chart, delta);
}

async function paintLeaderboard() {
  const quizzes = state.questions.filter((q) => q.type === 'quiz');
  const perQuestion = await Promise.all(quizzes.map(async (question) => ({
    question,
    rows: await fetchResponses(state.session.id, question.id),
  })));
  renderLeaderboard(ui.chart, quizLeaderboard(perQuestion));
}

// =====================================================================
// Actions
// =====================================================================

async function go(step) {
  const s = state.session;
  if (s.state !== 'live') {
    const first = state.questions[0];
    if (!first) return;
    await patch({ state: 'live', current_question_id: first.id, current_round: 1,
                  accepting: true, started_at: new Date().toISOString() });
    return;
  }
  const next = neighbourQuestion(state.questions, s.current_question_id, step);
  if (!next) {
    if (step > 0) flash('End of deck');
    return;
  }
  await patch({ current_question_id: next.id, current_round: 1, accepting: true });
}

async function patch(fields) {
  state.session = await updateSession(state.session.id, fields);
  await render();
}

async function toggleReveal() {
  await patch({ reveal: !state.session.reveal });
  announce(state.session.reveal ? 'Results are showing.' : 'Results are hidden.');
}

async function toggleAccepting() {
  const closing = state.session.accepting;
  await patch({ accepting: !closing });
  const q = state.question;
  if (closing && q?.type === 'quiz' && state.session.reveal) {
    // third beat of the reveal: breath (0ms) → verdict (450ms) → confetti
    delay(0.7, () => celebrate(ui.stage));
    const labels = optionLabels(q.config || {});
    const right = correctIndices(q.config || {}).map((i) => labels[i]).filter(Boolean);
    const correctSet = new Set(correctIndices(q.config || {}));
    const respondents = new Set(state.rows.map((r) => r.pseudonym)).size;
    const gotIt = state.rows.filter((r) => correctSet.has(r.payload?.choice)).length;
    announce(`Voting closed. Correct answer: ${right.join(', ')}. `
      + `${gotIt} of ${respondents} answered correctly.`);
  } else {
    announce(closing ? 'Voting closed.' : 'Voting open.');
  }
}

/** Proposal P1: ask the same question again, keeping round 1 intact. */
async function reask() {
  const q = state.question;
  if (!q || isContentSlide(q.type)) return;
  const highest = await maxRound(state.session.id, q.id);
  const next = Math.max(state.session.current_round, highest) + 1;
  await patch({ current_round: next, accepting: true, reveal: true });
  state.view = 'results';
  flash('Ask it again');
}

async function endSession() {
  if (!window.confirm('End this session? Students will see a thank-you screen. Results are kept.')) return;
  await patch({ state: 'ended', accepting: false, ended_at: new Date().toISOString() });
}

async function resetQuestion() {
  const q = state.question;
  if (!q || isContentSlide(q.type)) return;
  if (!window.confirm('Delete every response to this question for this round?')) return;
  await clearResponses(state.session.id, q.id, state.session.current_round);
  state.rows = [];
  paintChart();
}

// ------------------------------------------------------------- timer

function startTimer(seconds) {
  stopTimer();
  state.timerEnds = Date.now() + seconds * 1000;

  const pill = document.createElement('span');
  pill.className = 'timer';
  ui.timerHost.append(pill);

  const tick = () => {
    const left = Math.max(0, Math.ceil((state.timerEnds - Date.now()) / 1000));
    pill.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    pill.classList.toggle('is-urgent', left <= 10);
    if (left <= 0) {
      stopTimer();
      patch({ accepting: false });
      flash('Time');
      announce("Time's up. Voting closed.");
    }
  };
  tick();
  state.timer = setInterval(tick, 250);
  announce(`Timer started: ${seconds} seconds.`);
}

function stopTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  ui.timerHost.textContent = '';
}

function toggleTimer() {
  if (state.timer) { stopTimer(); return; }
  const secs = Number(state.question?.config?.time) > 0
    ? Number(state.question.config.time) : 30;
  startTimer(secs);
}

// ------------------------------------------------------------- Q&A

async function loadQA() {
  let rows = [];
  try { rows = await listAudienceQuestions(state.session.id); } catch { return; }

  // the body is rebuilt wholesale; keep the instructor's place in a
  // long question list across live refreshes
  const scrollTop = ui.qaBody.scrollTop;
  ui.qaBody.textContent = '';
  const pending = rows.filter((r) => !r.approved).length;
  setCtrlLabel('btnQA', pending ? `Q&A (${pending})` : 'Q&A');

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = 'No questions yet.';
    ui.qaBody.append(p);
    return;
  }

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'aq-item'
      + (row.approved ? '' : ' is-pending')
      + (row.answered ? ' is-answered' : '');

    const text = document.createElement('p');
    text.className = 'aq-text';
    text.textContent = row.body;
    item.append(text);

    const actions = document.createElement('div');
    actions.className = 'aq-actions';

    const votes = document.createElement('span');
    votes.className = 'aq-votes';
    votes.textContent = `▲ ${row.upvotes}`;
    actions.append(votes);

    if (!row.approved) {
      actions.append(btn('Show', 'btn-primary', async () => {
        await moderateAudienceQuestion(row.id, { approved: true });
        loadQA();
      }));
    } else {
      actions.append(btn(row.answered ? 'Reopen' : 'Answered', '', async () => {
        await moderateAudienceQuestion(row.id, { answered: !row.answered });
        loadQA();
      }));
    }
    actions.append(btn('Delete', 'btn-danger', async () => {
      await moderateAudienceQuestion(row.id, { approved: false, answered: true });
      loadQA();
    }));

    item.append(actions);
    ui.qaBody.append(item);
  });
  ui.qaBody.scrollTop = scrollTop;
}

function btn(label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn-sm ${cls}`;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// =====================================================================
// Wiring
// =====================================================================

/**
 * Wrap a presenter control so a failure reaches the front of the room.
 *
 * go(), patch() and every teaching control are async, and an `async`
 * listener returns a promise nobody awaits — so a dropped connection or a
 * rejected write became an unhandled rejection and the button just stopped
 * working. Mid-lecture that reads as "the projector is broken", with
 * nothing on screen to say otherwise and no reason to suspect the network.
 * flash() is already the presenter's transient-message channel; use it.
 */
function ctrl(fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.then === 'function') {
        out.catch((e) => {
          console.error(e);
          flash(e?.message || 'That didn\'t go through — check your connection');
        });
      }
      return out;
    } catch (e) {
      console.error(e);
      flash(e?.message || 'That didn\'t go through — check your connection');
      return undefined;
    }
  };
}

function wireControls() {
  $('btnPrev').addEventListener('click', ctrl(() => go(-1)));
  $('btnNext').addEventListener('click', ctrl(() => go(1)));

  // Only Previous and Next are on the projector by default. The rest of
  // the teaching controls, and the keyboard crib sheet, open on a click
  // and stay open until dismissed. Every one of them also has a keyboard
  // shortcut, so this hides buttons, never capability.
  $('btnMore').addEventListener('click', () => {
    const open = ui.stage.classList.toggle('is-controls-open');
    $('btnMore').setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('btnHide').addEventListener('click', ctrl(toggleReveal));
  $('btnClose').addEventListener('click', ctrl(toggleAccepting));
  $('btnTimer').addEventListener('click', ctrl(toggleTimer));
  $('btnDiscuss').addEventListener('click', ctrl(discussStep));
  $('btnReask').addEventListener('click', ctrl(reask));
  $('btnFull').addEventListener('click', toggleFullscreen);
  $('btnEnd').addEventListener('click', ctrl(endSession));

  $('btnDelta').addEventListener('click', () => {
    state.view = state.view === 'delta' ? 'results' : 'delta';
    paintControlStates(); paintChart();
  });
  $('btnBoard').addEventListener('click', () => {
    state.view = state.view === 'leaderboard' ? 'results' : 'leaderboard';
    paintControlStates(); paintChart();
  });
  $('btnShare').addEventListener('click', ctrl(async () => {
    await patch({ show_on_devices: !state.session.show_on_devices });
    flash(state.session.show_on_devices ? 'Results on phones' : 'Results on screen only');
  }));
  $('btnQA').addEventListener('click', () => {
    const open = ui.qaPanel.classList.toggle('is-open');
    $('btnQA').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      loadQA();
      ui.qaClose.focus();
    } else {
      $('btnQA').focus();
    }
  });
  ui.qaClose.addEventListener('click', closeQAPanel);
}

function closeQAPanel() {
  if (!ui.qaPanel.classList.contains('is-open')) return;
  ui.qaPanel.classList.remove('is-open');
  $('btnQA').setAttribute('aria-expanded', 'false');
  // hand focus back to where the drawer came from. btnQA lives in the
  // collapsible ⋯ tray; a display:none element silently refuses focus,
  // which would strand it on the now-hidden close button.
  const back = $('btnQA').offsetParent ? $('btnQA') : $('btnMore');
  back.focus();
}

function wireKeyboard() {
  // The keys, not the buttons, are how a class actually gets advanced —
  // so they go through ctrl() too. Without it, arrowing forward on a flaky
  // lecture-hall connection fails silently, which is the single worst
  // place in this app for something to fail silently.
  window.addEventListener('keydown', ctrl((e) => {
    if (e.target.matches('input, textarea')) return undefined;
    const k = e.key.toLowerCase();

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); return go(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); return go(-1); }
    if (k === 'h') return toggleReveal();
    if (k === 'c') return toggleAccepting();
    if (k === 'p') return discussStep();
    if (k === 'r') return reask();
    if (k === 'x') return resetQuestion();

    if (k === 't') toggleTimer();
    else if (k === 'd') $('btnDelta').click();
    else if (k === 'l') $('btnBoard').click();
    else if (k === 'q') $('btnQA').click();
    else if (k === 'j') {
      state.showCorner = !state.showCorner;
      ui.joinCorner.classList.toggle('is-hidden', !state.showCorner);
    }
    else if (k === 'f') toggleFullscreen();
    else if (e.key === '?') $('btnMore').click(); // the crib sheet IS the buttons
    else if (e.key === 'Escape') closeQAPanel();
    else if (/^[1-9]$/.test(e.key)) startTimer(Number(e.key) * 10);
    return undefined;
  }));
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

let flashTimer = null;
function flash(text) {
  ui.flash.textContent = text;
  ui.flash.classList.add('is-visible');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => ui.flash.classList.remove('is-visible'), 900);
}

window.addEventListener('beforeunload', () => {
  state.unsubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
});
