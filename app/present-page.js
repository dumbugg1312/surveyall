/**
 * SurveyAll — presenter / projector controller.
 *
 * Runs on the instructor's laptop, projected. Advancing a question is a
 * single UPDATE to the session row; every phone in the room reacts to
 * that one write. Results stream in over a realtime subscription and the
 * charts animate in place.
 */

import {
  currentUser, getSession, getDeck, listQuestions,
  updateSession, fetchResponses, subscribeToResponses, subscribeToSession,
  clearResponses, maxRound, deleteResponse,
  listAudienceQuestions, moderateAudienceQuestion, subscribeToAudienceQuestions,
} from './db.js';
import {
  aggregate, computeDelta, quizLeaderboard, sortedQuestions,
  neighbourQuestion, joinURL, TYPE_LABELS,
} from './logic.js';
import { applyTheme, backgroundStyles, scrimOpacity } from './themes.js';
import { renderAggregate, renderDelta, renderLeaderboard, celebrate } from './charts.js';
import { renderQR } from './qr.js';
import { joinBase } from './config.js';

const $ = (id) => document.getElementById(id);

const ui = {
  stage: $('stage'), backdrop: $('backdrop'), scrim: $('scrim'),
  lobby: $('lobby'), lobbyTitle: $('lobbyTitle'), lobbyKicker: $('lobbyKicker'),
  lobbyQR: $('lobbyQR'), lobbyURL: $('lobbyURL'), lobbyCode: $('lobbyCode'),
  head: $('head'), kicker: $('kicker'), prompt: $('prompt'), timerHost: $('timerHost'),
  body: $('body'), chart: $('chart'),
  foot: $('foot'), countText: $('countText'), stateNote: $('stateNote'), dots: $('dots'),
  joinCorner: $('joinCorner'), cornerQR: $('cornerQR'),
  cornerURL: $('cornerURL'), cornerCode: $('cornerCode'),
  qaPanel: $('qaPanel'), qaBody: $('qaBody'), qaClose: $('qaClose'),
  flash: $('flash'), controls: $('controls'),
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
};

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

  applyTheme(document.documentElement, state.session.theme || state.deck.theme);
  paintBackground();
  paintJoin();
  wireControls();
  wireKeyboard();

  state.unsubs.push(subscribeToResponses(state.session.id, onResponseEvent));
  state.unsubs.push(subscribeToSession(state.session.id, (row) => {
    state.session = { ...state.session, ...row };
    queueRepaint();
  }));
  state.unsubs.push(subscribeToAudienceQuestions(state.session.id, loadQA));

  // Backstop poll: if realtime drops, the count still creeps up.
  setInterval(() => { if (state.question) loadRows(); }, 10000);

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
  const themeId = state.session.theme || state.deck.theme;
  const styles = backgroundStyles(state.deck.background, themeId);
  Object.assign(ui.backdrop.style, styles);
  ui.scrim.style.opacity = String(scrimOpacity(state.deck.background));
}

async function paintJoin() {
  const url = joinURL(joinBase(), state.session.join_code);
  const pretty = url.replace(/^https?:\/\//, '').replace(/\/join\.html#.*$/, '');

  ui.lobbyCode.textContent = state.session.join_code;
  ui.cornerCode.textContent = state.session.join_code;
  ui.lobbyURL.textContent = pretty;
  ui.cornerURL.textContent = pretty;

  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000';
  await renderQR(ui.lobbyQR, url, { dark: ink, light: '#ffffff' });
  await renderQR(ui.cornerQR, url, { dark: ink, light: '#ffffff' });
}

// =====================================================================
// Render
// =====================================================================

function queueRepaint() {
  if (state.repaintQueued) return;
  state.repaintQueued = true;
  requestAnimationFrame(() => { state.repaintQueued = false; render(); });
}

async function render() {
  const s = state.session;

  if (s.state !== 'live' || !s.current_question_id) {
    ui.lobby.hidden = false;
    ui.head.hidden = ui.body.hidden = ui.foot.hidden = true;
    ui.joinCorner.hidden = true;
    ui.lobbyTitle.textContent = s.state === 'ended'
      ? 'Session ended'
      : (state.deck.title || 'Ready when you are');
    ui.lobbyKicker.textContent = s.state === 'ended' ? 'Thanks' : 'Join now';
    return;
  }

  ui.lobby.hidden = true;
  ui.head.hidden = ui.body.hidden = ui.foot.hidden = false;
  ui.joinCorner.hidden = !state.showCorner;

  const q = state.questions.find((x) => x.id === s.current_question_id);
  const changed = state.question?.id !== q?.id || state.question?.__round !== s.current_round;
  state.question = q ? { ...q, __round: s.current_round } : null;
  if (!q) return;

  ui.kicker.textContent =
    `${TYPE_LABELS[q.type] || q.type} · Question ${(q.position ?? 0) + 1} of ${state.questions.length}`
    + (s.current_round > 1 ? ` · Round ${s.current_round}` : '');
  ui.prompt.textContent = q.prompt || '';

  paintDots();
  paintControlStates();

  if (changed) {
    state.view = 'results';
    state.rows = [];
    ui.chart.textContent = '';
    stopTimer();
  }

  await loadRows();
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

function paintControlStates() {
  const s = state.session;
  $('btnHide').textContent = s.reveal ? 'Hide' : 'Show';
  $('btnHide').classList.toggle('is-active', !s.reveal);
  $('btnClose').textContent = s.accepting ? 'Close voting' : 'Open voting';
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
  paintChart();
}

function paintChart() {
  const q = state.question;
  if (!q) return;

  const respondents = new Set(state.rows.map((r) => r.pseudonym)).size;
  ui.countText.textContent = q.type === 'open_ended' || q.type === 'word_cloud'
    ? `${state.rows.length} ${state.rows.length === 1 ? 'response' : 'responses'} · ${respondents} people`
    : `${respondents} ${respondents === 1 ? 'response' : 'responses'}`;

  if (state.view === 'leaderboard') return paintLeaderboard();
  if (state.view === 'delta') return paintDelta();

  const agg = aggregate(q.type, q.config, state.rows);
  renderAggregate(ui.chart, q.type, agg, {
    style: q.config?.chart || 'bars',
    hidden: !state.session.reveal,
    revealCorrect: q.type === 'quiz' && !state.session.accepting && state.session.reveal,
    showPercent: q.config?.show_counts !== true,
  });

  // let the instructor bin an inappropriate open response on the spot
  if (q.type === 'open_ended') wireCardDeletes(agg);
}

function wireCardDeletes(agg) {
  ui.chart.querySelectorAll('.answer-delete').forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', async (e) => {
      const card = e.target.closest('.answer-card');
      const idx = Number(card?.dataset.index);
      const text = agg.entries?.[idx]?.text;
      const row = state.rows.find((r) => (r.payload?.text || '').trim() === (text || '').trim());
      if (!row) return;
      await deleteResponse(row.id);
      state.rows = state.rows.filter((r) => r.id !== row.id);
      paintChart();
    });
  });
}

async function paintDelta() {
  const q = state.question;
  const round = state.session.current_round;
  if (round < 2) {
    renderDelta(ui.chart, null);
    return;
  }
  const [before, after] = await Promise.all([
    fetchResponses(state.session.id, q.id, round - 1),
    fetchResponses(state.session.id, q.id, round),
  ]);
  const delta = computeDelta(
    aggregate(q.type, q.config, before),
    aggregate(q.type, q.config, after));
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

async function toggleReveal() { await patch({ reveal: !state.session.reveal }); }

async function toggleAccepting() {
  const closing = state.session.accepting;
  await patch({ accepting: !closing });
  if (closing && state.question?.type === 'quiz' && state.session.reveal) {
    celebrate(ui.stage);
  }
}

/** Proposal P1: ask the same question again, keeping round 1 intact. */
async function reask() {
  const q = state.question;
  if (!q) return;
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
  if (!q) return;
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
    }
  };
  tick();
  state.timer = setInterval(tick, 250);
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

  ui.qaBody.textContent = '';
  const pending = rows.filter((r) => !r.approved).length;
  $('btnQA').textContent = pending ? `Q&A (${pending})` : 'Q&A';

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

function wireControls() {
  $('btnPrev').addEventListener('click', () => go(-1));
  $('btnNext').addEventListener('click', () => go(1));
  $('btnHide').addEventListener('click', toggleReveal);
  $('btnClose').addEventListener('click', toggleAccepting);
  $('btnTimer').addEventListener('click', toggleTimer);
  $('btnReask').addEventListener('click', reask);
  $('btnEnd').addEventListener('click', endSession);

  $('btnDelta').addEventListener('click', () => {
    state.view = state.view === 'delta' ? 'results' : 'delta';
    paintControlStates(); paintChart();
  });
  $('btnBoard').addEventListener('click', () => {
    state.view = state.view === 'leaderboard' ? 'results' : 'leaderboard';
    paintControlStates(); paintChart();
  });
  $('btnShare').addEventListener('click', async () => {
    await patch({ show_on_devices: !state.session.show_on_devices });
    flash(state.session.show_on_devices ? 'Results on phones' : 'Results on screen only');
  });
  $('btnQA').addEventListener('click', () => {
    ui.qaPanel.classList.toggle('is-open');
    if (ui.qaPanel.classList.contains('is-open')) loadQA();
  });
  ui.qaClose.addEventListener('click', () => ui.qaPanel.classList.remove('is-open'));
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    const k = e.key.toLowerCase();

    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (k === 'h') toggleReveal();
    else if (k === 'c') toggleAccepting();
    else if (k === 'r') reask();
    else if (k === 't') toggleTimer();
    else if (k === 'd') $('btnDelta').click();
    else if (k === 'l') $('btnBoard').click();
    else if (k === 'q') $('btnQA').click();
    else if (k === 'j') {
      state.showCorner = !state.showCorner;
      ui.joinCorner.classList.toggle('is-hidden', !state.showCorner);
    }
    else if (k === 'f') toggleFullscreen();
    else if (k === 'x') resetQuestion();
    else if (e.key === 'Escape') ui.qaPanel.classList.remove('is-open');
    else if (/^[1-9]$/.test(e.key)) startTimer(Number(e.key) * 10);
  });
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
