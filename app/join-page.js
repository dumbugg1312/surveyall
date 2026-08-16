/**
 * SurveyAll — participant page controller.
 *
 * The entire student experience: scan a QR, land on the live question,
 * answer, follow along. No account, no app, no name, ever.
 *
 * State machine
 *   config   → app not set up yet (instructor-facing message)
 *   code     → no code in the URL, ask for one
 *   notfound → code doesn't match a session
 *   lobby    → session exists but hasn't started
 *   waiting  → session live, presenter between questions
 *   question → answer this
 *   ended    → thanks
 */

import {
  getSessionByCode, fetchLiveQuestion, claimPseudonym,
  submitResponse, subscribeToSession, fetchSharedResults,
  askAudienceQuestion, listAudienceQuestions, upvoteAudienceQuestion,
  subscribeToAudienceQuestions,
} from './db.js';
import { validateResponse, aggregate, optionLabels, MULTI_SUBMIT_TYPES } from './logic.js';
import { applyTheme } from './themes.js';
import { renderAggregate } from './charts.js';
import {
  ensurePseudonym, rememberAnswer, recallAnswer,
  codeFromLocation, upvotedIds, markUpvoted,
} from './participant-state.js';

const app = document.getElementById('app');

const state = {
  session: null,
  question: null,
  pseudonym: null,
  unsubSession: null,
  unsubAQ: null,
  submitted: false,
  slot: 0,
  questionShownAt: 0,
  sharedTimer: null,
  pollTimer: null,
};

// =====================================================================
// Boot
// =====================================================================

init().catch((err) => {
  console.error(err);
  showState('⚠️', 'Something went wrong', err.message || String(err));
});

async function init() {
  const code = codeFromLocation();
  if (!code) return showCodeEntry();
  await joinByCode(code);
}

async function joinByCode(code) {
  showState('', 'Joining…', '', true);

  let session;
  try {
    session = await getSessionByCode(code);
  } catch (err) {
    return showState('⚠️', 'Could not connect', err.message);
  }

  if (!session) {
    return showCodeEntry(`No session found for “${code}”. Check the code on the screen.`);
  }

  state.session = session;
  applyTheme(document.documentElement, session.theme);
  syncThemeColor();

  try {
    state.pseudonym = await ensurePseudonym(session.id, claimPseudonym);
  } catch {
    // A leaderboard label is a nicety, not a requirement — never block
    // a student from answering because of it.
    state.pseudonym = `Guest ${Math.floor(Math.random() * 9000) + 1000}`;
  }

  if (state.unsubSession) state.unsubSession();
  state.unsubSession = subscribeToSession(session.id, onSessionChange);

  // Belt and braces: realtime can drop on flaky campus wifi, so poll
  // slowly as a backstop. This is the difference between "the app broke"
  // and "it caught up a few seconds later".
  // Cleared first so re-joining (a new code in the hash) doesn't stack
  // a second timer on top of the old one.
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const fresh = await getSessionByCode(state.session.join_code);
      if (fresh && hasMoved(state.session, fresh)) onSessionChange(fresh);
    } catch { /* offline; try again next tick */ }
  }, 8000);

  await refresh();
}

/**
 * Should this student be shown their nickname?
 *
 * Only on a deck that scores someone, where the label is how they find
 * themselves on the projected leaderboard. Everywhere else it is noise at
 * best. Defaults to hiding it when the server has not said either way.
 */
function showNickname() {
  return !!(state.session && state.session.has_quiz);
}

function hasMoved(a, b) {
  return a.state !== b.state
    || a.current_question_id !== b.current_question_id
    || a.current_round !== b.current_round
    || a.accepting !== b.accepting
    || a.reveal !== b.reveal
    || a.show_on_devices !== b.show_on_devices
    // An instructor can turn a poll into a quiz on a live deck, which is
    // what makes a nickname worth showing. Repaint when that flips.
    || a.has_quiz !== b.has_quiz;
}

function onSessionChange(next) {
  const prev = state.session;
  state.session = { ...prev, ...next };

  const movedOn = prev.current_question_id !== state.session.current_question_id
    || prev.current_round !== state.session.current_round;

  if (movedOn) {
    state.submitted = false;
    state.slot = 0;
  }
  refresh();
}

// =====================================================================
// Render
// =====================================================================

async function refresh() {
  const s = state.session;
  if (!s) return;

  if (s.state === 'ended') {
    teardownShared();
    // Previously: "nothing about you was saved", which was not true. The
    // answers are kept permanently — the instructor's own end-session
    // confirmation says "Results are kept", and they are downloadable as
    // CSV afterwards. What is true is that nothing identifying you was
    // saved, and that is a claim this screen should not be making at all.
    return showState('✓', 'That\'s a wrap',
      'Thanks for taking part. You can close this page.');
  }

  if (s.state === 'lobby') {
    teardownShared();
    return showState('', 'You\'re in',
      'Waiting for your instructor to start. Keep this page open.', true);
  }

  let q = null;
  try {
    q = await fetchLiveQuestion(s.id);
  } catch (err) {
    return showState('⚠️', 'Could not load the question', err.message);
  }

  if (!q) {
    teardownShared();
    return showState('', 'Hang tight',
      'Your instructor is between questions.', true);
  }

  const changed = !state.question
    || state.question.id !== q.id
    || state.question.round !== q.round;

  state.question = q;
  if (changed) {
    state.questionShownAt = performance.now();
    const prior = recallAnswer(s.id, q.id, q.round);
    state.submitted = !!prior && !MULTI_SUBMIT_TYPES.has(q.type);
  }

  if (q.type === 'qa') return renderQAPage(q);
  renderQuestion(q, changed);
}

function renderQuestion(q, isNew) {
  const s = state.session;
  const prior = recallAnswer(s.id, q.id, q.round);

  app.textContent = '';
  app.append(header(q));

  const prompt = div('q-prompt', q.prompt || 'Your answer');
  app.append(prompt);

  const hint = hintFor(q);
  if (hint) app.append(div('q-hint', hint));

  const body = div('q-body');
  const control = buildControl(q, prior);
  body.append(control.el);
  app.append(body);

  const actions = div('join-actions');
  const error = div('field-error');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'submit-btn';
  btn.textContent = submitLabel(q, state.submitted);

  if (!s.accepting) {
    btn.disabled = true;
    btn.textContent = 'Voting is closed';
  }

  btn.addEventListener('click', async () => {
    error.textContent = '';
    const raw = control.value();
    const check = validateResponse(q.type, q.config, raw);
    if (!check.ok) {
      error.textContent = check.error;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const multi = MULTI_SUBMIT_TYPES.has(q.type);
      const slot = multi ? state.slot : 0;
      await submitResponse({
        sessionId: s.id,
        questionId: q.id,
        round: q.round,
        pseudonym: state.pseudonym,
        payload: check.payload,
        slot,
      });

      rememberAnswer(s.id, q.id, q.round, check.payload);
      state.submitted = true;
      if (multi) {
        state.slot += 1;
        control.reset?.();
      }

      btn.classList.add('is-sent');
      btn.textContent = multi ? 'Sent — add another' : 'Answer sent ✓';
      setTimeout(() => {
        btn.classList.remove('is-sent');
        btn.disabled = !state.session.accepting;
        btn.textContent = submitLabel(q, state.submitted);
      }, 1400);

      maybeShowSharedResults();
    } catch (err) {
      // The database rejects late votes; say so in human terms.
      const closed = String(err?.message || '').includes('row-level security');
      error.textContent = closed
        ? 'Voting just closed for this question.'
        : (err.message || 'Could not send. Check your connection.');
      btn.disabled = false;
      btn.textContent = submitLabel(q, state.submitted);
    }
  });

  actions.append(error, btn);
  app.append(actions);

  if (isNew) prompt.animate?.(
    [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'cubic-bezier(.22,.8,.3,1)' });

  maybeShowSharedResults();
}

function submitLabel(q, submitted) {
  if (MULTI_SUBMIT_TYPES.has(q.type)) return submitted ? 'Send another' : 'Send';
  return submitted ? 'Change my answer' : 'Send answer';
}

function hintFor(q) {
  const cfg = q.config || {};
  switch (q.type) {
    case 'multiple_choice':
      return cfg.multiple
        ? `Choose up to ${cfg.max_choices || optionLabels(cfg).length}`
        : 'Choose one';
    case 'word_cloud': {
      const n = cfg.max_words || 1;
      return n > 1 ? `Up to ${n} words` : 'One word';
    }
    case 'scales':
      return cfg.allow_skip ? 'Rate each one — skip any you\'d rather not answer' : 'Rate each one';
    case 'ranking':
      return 'Tap to add to your ranking, then reorder';
    case 'quiz':
      return 'Answer fast — quicker correct answers score more';
    default:
      return '';
  }
}

function header(q) {
  const head = div('join-head');

  // The nickname is shown ONLY when the deck contains a quiz, because that
  // is the only time a student needs it: to find their own row on the
  // projected leaderboard. On an ordinary poll nobody needs a name, and
  // handing one out invites a persona.
  //
  // This hides the label, it does not stop claiming one. The label is the
  // conflict target of the /respond upsert, so it is what makes "change my
  // answer" replace a vote instead of adding one, and what stops two phones
  // colliding onto a single row. See worker/schema.sql, responses.
  if (showNickname()) {
    const tag = document.createElement('span');
    tag.className = 'join-pseudonym';
    tag.textContent = state.pseudonym || '…';
    head.append(tag);
  }

  if (q && Number.isInteger(q.position)) {
    const prog = div('join-progress', `Q${q.position + 1}`);
    head.append(prog);
  }
  return head;
}

// =====================================================================
// Per-type controls
// =====================================================================

function buildControl(q, prior) {
  switch (q.type) {
    case 'multiple_choice': return choiceControl(q, prior, false);
    case 'quiz': return choiceControl(q, prior, true);
    case 'word_cloud': return wordControl(q);
    case 'open_ended': return textControl(q, prior);
    case 'scales': return scalesControl(q, prior);
    case 'ranking': return rankingControl(q, prior);
    default: {
      const el = div('state-text', 'This question type isn\'t supported on your device.');
      return { el, value: () => ({}) };
    }
  }
}

function choiceControl(q, prior, isQuiz) {
  const cfg = q.config || {};
  const labels = optionLabels(cfg);
  const multiple = !isQuiz && !!cfg.multiple;
  const selected = new Set(
    isQuiz
      ? (Number.isInteger(prior?.choice) ? [prior.choice] : [])
      : (prior?.choices || []));

  const wrap = div('stack-sm');

  labels.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'opt';
    btn.setAttribute('aria-pressed', String(selected.has(i)));

    const marker = div(`opt-marker${multiple ? ' is-square' : ''}`);
    marker.textContent = selected.has(i) ? '✓' : '';
    btn.append(marker, div('opt-text', label));

    if (selected.has(i)) btn.classList.add('is-selected');

    btn.addEventListener('click', () => {
      if (multiple) {
        if (selected.has(i)) selected.delete(i); else selected.add(i);
      } else {
        selected.clear();
        selected.add(i);
      }
      [...wrap.children].forEach((child, idx) => {
        const on = selected.has(idx);
        child.classList.toggle('is-selected', on);
        child.setAttribute('aria-pressed', String(on));
        child.querySelector('.opt-marker').textContent = on ? '✓' : '';
      });
    });

    wrap.append(btn);
  });

  return {
    el: wrap,
    value: () => (isQuiz
      ? { choice: [...selected][0], ms: Math.round(performance.now() - state.questionShownAt) }
      : { choices: [...selected] }),
  };
}

function wordControl(q) {
  const cfg = q.config || {};
  const count = Math.max(1, Math.min(10, cfg.max_words || 1));
  const wrap = div('stack-sm');
  const inputs = [];

  for (let i = 0; i < count; i += 1) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'word-input';
    input.maxLength = cfg.max_length || 25;
    input.placeholder = count > 1 ? `Word ${i + 1}` : 'Type a word';
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    inputs.push(input);
    wrap.append(input);
  }

  setTimeout(() => inputs[0]?.focus(), 120);

  return {
    el: wrap,
    value: () => ({ words: inputs.map((i) => i.value).filter(Boolean) }),
    reset: () => { inputs.forEach((i) => { i.value = ''; }); inputs[0]?.focus(); },
  };
}

function textControl(q, prior) {
  const cfg = q.config || {};
  const limit = cfg.max_length || 200;
  const wrap = div('stack-sm');

  const area = document.createElement('textarea');
  area.className = 'text-input';
  area.maxLength = limit;
  // The placeholder actively discourages the one FERPA risk we cannot
  // structurally prevent: a student typing their own name.
  area.placeholder = 'Your answer — no need to include your name';
  area.value = prior?.text || '';

  const counter = div('char-count');
  const sync = () => {
    const left = limit - area.value.length;
    counter.textContent = `${left} left`;
    counter.classList.toggle('is-near', left < 25);
  };
  area.addEventListener('input', sync);
  sync();

  wrap.append(area, counter);
  return {
    el: wrap,
    value: () => ({ text: area.value }),
    reset: () => { area.value = ''; sync(); },
  };
}

function scalesControl(q, prior) {
  const cfg = q.config || {};
  const statements = Array.isArray(cfg.statements) ? cfg.statements : [];
  const min = Number.isFinite(cfg.min) ? cfg.min : 1;
  const max = Number.isFinite(cfg.max) ? cfg.max : 5;
  const values = statements.map((_, i) => prior?.values?.[i] ?? null);

  const wrap = div('stack-sm');

  statements.forEach((stmt, si) => {
    const item = div('scale-item');
    item.append(div('scale-statement', typeof stmt === 'string' ? stmt : String(stmt?.label ?? '')));

    const row = div('scale-buttons');
    for (let v = min; v <= max; v += 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scale-btn';
      b.textContent = String(v);
      b.setAttribute('aria-label', `${v} out of ${max}`);
      if (values[si] === v) b.classList.add('is-selected');
      b.addEventListener('click', () => {
        values[si] = v;
        [...row.children].forEach((c, idx) =>
          c.classList.toggle('is-selected', min + idx === v));
      });
      row.append(b);
    }
    item.append(row);

    if (cfg.low_label || cfg.high_label) {
      const ends = div('scale-ends');
      ends.append(div('', cfg.low_label || ''), div('', cfg.high_label || ''));
      item.append(ends);
    }

    if (cfg.allow_skip) {
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'scale-skip';
      skip.textContent = 'Skip this one';
      skip.addEventListener('click', () => {
        values[si] = null;
        [...row.children].forEach((c) => c.classList.remove('is-selected'));
      });
      item.append(skip);
    }

    wrap.append(item);
  });

  return { el: wrap, value: () => ({ values }) };
}

function rankingControl(q, prior) {
  const cfg = q.config || {};
  const items = Array.isArray(cfg.items) ? cfg.items : [];
  let order = Array.isArray(prior?.order) ? prior.order.filter((i) => i < items.length) : [];

  const wrap = div('stack-sm');

  const draw = () => {
    wrap.textContent = '';
    // ranked items first, in order; then the unranked pool
    const ranked = order.map((i) => ({ i, rank: order.indexOf(i) + 1 }));
    const unranked = items.map((_, i) => i).filter((i) => !order.includes(i));

    ranked.forEach(({ i, rank }, pos) => {
      const row = div('rank-item is-ranked');
      row.append(div('rank-badge', String(rank)));
      row.append(div('rank-text', label(items[i])));

      const moves = div('rank-moves');
      const up = moveBtn('▲', pos === 0, () => {
        [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]];
        draw();
      });
      const down = moveBtn('▼', pos === ranked.length - 1, () => {
        [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]];
        draw();
      });
      moves.append(up, down);
      row.append(moves);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'rank-move';
      remove.textContent = '×';
      remove.title = 'Remove from ranking';
      remove.addEventListener('click', () => {
        order = order.filter((x) => x !== i);
        draw();
      });
      row.append(remove);

      wrap.append(row);
    });

    if (unranked.length && ranked.length) {
      wrap.append(div('q-hint', 'Tap to add:'));
    }

    unranked.forEach((i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rank-item';
      row.append(div('rank-badge', '+'), div('rank-text', label(items[i])));
      row.addEventListener('click', () => { order.push(i); draw(); });
      wrap.append(row);
    });
  };

  const moveBtn = (glyph, disabled, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rank-move';
    b.textContent = glyph;
    b.disabled = disabled;
    b.addEventListener('click', fn);
    return b;
  };

  draw();
  return { el: wrap, value: () => ({ order }) };
}

function label(v) {
  return typeof v === 'string' ? v : String(v?.label ?? '');
}

// =====================================================================
// Results on the student's own device (a top-voted gap in the research)
// =====================================================================

function teardownShared() {
  if (state.sharedTimer) {
    clearInterval(state.sharedTimer);
    state.sharedTimer = null;
  }
}

function maybeShowSharedResults() {
  teardownShared();
  const s = state.session;
  const q = state.question;
  if (!s?.show_on_devices || !s.reveal || !q || q.type === 'qa') return;

  const paint = async () => {
    try {
      const res = await fetchSharedResults(s.id, q.id, q.round);
      if (!res) return;
      let host = app.querySelector('.shared-result');
      if (!host) {
        host = div('shared-result');
        host.append(div('eyebrow', 'The room so far'));
        const chart = div('chart');
        host.append(chart);
        app.querySelector('.q-body')?.append(host);
      }
      const agg = aggregate(q.type, q.config, (res.payloads || []).map((p) => ({ payload: p })));
      renderAggregate(host.querySelector('.chart'), q.type, agg, {
        style: q.config?.chart || 'bars',
      });
    } catch { /* results are a bonus; never break answering */ }
  };

  paint();
  state.sharedTimer = setInterval(paint, 4000);
}

// =====================================================================
// Q&A
// =====================================================================

async function renderQAPage(q) {
  const s = state.session;
  app.textContent = '';
  app.append(header(q));
  app.append(div('q-prompt', q.prompt || 'Ask a question'));
  // Deliberately no "questions are anonymous" here. Naming the moderation
  // step is kept, because that one is a deterrent rather than an invitation.
  app.append(div('q-hint', s.qa_moderated
    ? 'Your instructor reviews questions before they appear.'
    : 'Your question goes to the screen.'));

  const panel = div('qa-panel');

  const compose = div('qa-compose');
  const area = document.createElement('textarea');
  area.className = 'text-input';
  area.maxLength = 500;
  area.placeholder = 'Type your question — no need to include your name';
  const err = div('field-error');
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'submit-btn';
  send.textContent = 'Send question';

  send.addEventListener('click', async () => {
    const body = area.value.trim();
    if (!body) { err.textContent = 'Write a question first.'; return; }
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      await askAudienceQuestion(s.id, body, !s.qa_moderated);
      area.value = '';
      err.textContent = '';
      send.classList.add('is-sent');
      send.textContent = s.qa_moderated ? 'Sent — awaiting review ✓' : 'Sent ✓';
      setTimeout(() => {
        send.classList.remove('is-sent');
        send.textContent = 'Send question';
        send.disabled = false;
      }, 1800);
      loadQuestions();
    } catch (e) {
      err.textContent = e.message || 'Could not send.';
      send.disabled = false;
      send.textContent = 'Send question';
    }
  });

  compose.append(area, err, send);
  panel.append(compose);

  const list = div('qa-list');
  panel.append(div('eyebrow', 'From the room'), list);
  app.append(panel);

  const voted = upvotedIds(s.id);

  async function loadQuestions() {
    let rows = [];
    try {
      rows = await listAudienceQuestions(s.id);
    } catch { return; }

    list.textContent = '';
    if (!rows.length) {
      list.append(div('state-text', 'No questions yet. Be the first.'));
      return;
    }
    rows.forEach((row) => {
      const card = div('qa-card');
      card.append(div('qa-card-text', row.body));
      const vote = document.createElement('button');
      vote.type = 'button';
      vote.className = `qa-vote${voted.has(row.id) ? ' is-voted' : ''}`;
      vote.innerHTML = `<span aria-hidden="true">▲</span><span>${row.upvotes}</span>`;
      vote.disabled = voted.has(row.id);
      vote.setAttribute('aria-label', `Upvote. ${row.upvotes} votes.`);
      vote.addEventListener('click', async () => {
        vote.disabled = true;
        try {
          const n = await upvoteAudienceQuestion(s.id, row.id);
          markUpvoted(s.id, row.id);
          voted.add(row.id);
          vote.classList.add('is-voted');
          vote.innerHTML = `<span aria-hidden="true">▲</span><span>${n}</span>`;
        } catch { vote.disabled = false; }
      });
      card.append(vote);
      list.append(card);
    });
  }

  loadQuestions();
  if (state.unsubAQ) state.unsubAQ();
  state.unsubAQ = subscribeToAudienceQuestions(s.id, loadQuestions);
}

// =====================================================================
// Simple screens
// =====================================================================

function showState(icon, title, text, waiting = false) {
  app.textContent = '';
  const wrap = div('join-state');
  if (icon) wrap.append(div('state-icon', icon));
  if (waiting) {
    const dots = div('pulse-wait');
    dots.innerHTML = '<span></span><span></span><span></span>';
    wrap.append(dots);
  }
  if (title) wrap.append(div('state-title', title));
  if (text) wrap.append(div('state-text', text));
  if (state.pseudonym && state.session && showNickname()) {
    const tag = document.createElement('span');
    tag.className = 'join-pseudonym';
    tag.textContent = `You are ${state.pseudonym}`;
    wrap.append(tag);
  }
  app.append(wrap);
}

function showCodeEntry(message) {
  app.textContent = '';
  const wrap = div('join-state');
  wrap.append(div('state-title', 'Enter the code'));
  wrap.append(div('state-text', 'It\'s on the screen at the front of the room.'));
  if (message) {
    const warn = div('alert alert-error');
    warn.textContent = message;
    wrap.append(warn);
  }

  const form = document.createElement('form');
  form.className = 'code-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'code-input';
  input.placeholder = 'ABC123';
  input.maxLength = 8;
  input.autocomplete = 'off';
  input.autocapitalize = 'characters';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Session code');

  const go = document.createElement('button');
  go.type = 'submit';
  go.className = 'submit-btn';
  go.textContent = 'Join';

  form.append(input, go);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = input.value.trim().toUpperCase();
    if (code) {
      window.location.hash = encodeURIComponent(code);
      joinByCode(code);
    }
  });

  wrap.append(form);
  app.append(wrap);
  setTimeout(() => input.focus(), 150);
}

function div(cls, text) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const ground = getComputedStyle(document.documentElement)
    .getPropertyValue('--ground').trim();
  if (ground) meta.setAttribute('content', ground);
}

window.addEventListener('hashchange', () => {
  const code = codeFromLocation();
  if (code && code !== state.session?.join_code) joinByCode(code);
});
