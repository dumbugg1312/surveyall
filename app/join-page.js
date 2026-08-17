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
import {
  validateResponse, aggregate, optionLabels, MULTI_SUBMIT_TYPES,
  isContentSlide, fillJoinPlaceholders, DEFAULT_JOIN_STEPS,
} from './logic.js';
import { applyTheme } from './themes.js';
import { renderAggregate } from './charts.js';
import { prefersReducedMotion } from './motion.js';
import {
  ensurePseudonym, rememberAnswer, recallAnswer,
  codeFromLocation, upvotedIds, markUpvoted,
} from './participant-state.js';

const app = document.getElementById('app');

const state = {
  session: null,
  question: null,
  pseudonym: null,
  // The server's signature over `pseudonym`. Sent with every answer so the
  // server can refuse a label it did not issue. See worker/auth.js.
  pseudonymToken: null,
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

/** Rehearsal mode — see the same note in present-page.js. */
if (new URLSearchParams(window.location.search).has('preview')) {
  await import('./preview-net.js');
}

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
  // an instructor-built theme arrives as tokens on the join payload;
  // built-in themes are just an id
  applyTheme(document.documentElement, session.custom_theme?.tokens
    ? { id: 'custom', dark: !!session.custom_theme.dark, tokens: session.custom_theme.tokens }
    : session.theme);
  syncThemeColor();

  // The label is no longer a nicety: it is the row key for this device's
  // answers, and the server now only accepts labels it signed. Minting a
  // local "Guest 4821" here (as this used to on failure) would produce a
  // label the server never issued, so every submit would 403 and the
  // student would be told their answer failed with no way to recover.
  // Retry instead, and let a genuine failure surface at submit time.
  try {
    const claimed = await ensurePseudonym(session.id, claimPseudonym);
    state.pseudonym = claimed.pseudonym;
    state.pseudonymToken = claimed.token;
  } catch {
    try {
      const retry = await ensurePseudonym(session.id, claimPseudonym);
      state.pseudonym = retry.pseudonym;
      state.pseudonymToken = retry.token;
    } catch {
      state.pseudonym = null;
      state.pseudonymToken = null;
    }
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
    state.volunteered = false;
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

  if (isContentSlide(q.type)) return renderContentSlide(q);
  if (q.type === 'qa') return renderQAPage(q);
  renderQuestion(q, changed);
}

/**
 * An instructions slide, on the phone of someone who already followed it.
 *
 * They are holding the proof that step one worked, so this is not a call
 * to action — it is confirmation plus the same words the projector is
 * showing, for anyone who can't read the screen from where they sit. No
 * QR: you cannot scan the phone you are holding.
 */
function renderContentSlide(q) {
  teardownShared();
  app.textContent = '';
  app.append(header(q));
  app.append(div('q-prompt', q.prompt || 'How this works'));

  const steps = (Array.isArray(q.config?.steps) && q.config.steps.length
    ? q.config.steps : DEFAULT_JOIN_STEPS)
    .map((s) => fillJoinPlaceholders(s, { code: state.session.join_code || '' }))
    .filter((s) => s.trim());

  const wrap = div('instr-card');
  wrap.append(div('instr-badge', '✓ You\'re in'));

  if (steps.length) {
    const list = document.createElement('ol');
    list.className = 'instr-list';
    steps.forEach((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      list.append(li);
    });
    wrap.append(list);
  }

  if (q.config?.note) wrap.append(div('instr-smallprint', q.config.note));
  wrap.append(div('state-text', 'Nothing to answer here — keep this page open '
    + 'and the first question will appear by itself.'));

  app.append(wrap);
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

  // confidence rider (anonymous, optional, off unless the question asks)
  let conf = null;
  const cfg = q.config || {};
  if (cfg.confidence && ['multiple_choice', 'quiz', 'sample_vote', 'spectrum'].includes(q.type)) {
    const row = div('conf-row');
    row.append(div('conf-label', 'How sure are you?'));
    const group = div('conf-btns');
    ['Guessing', 'Fairly sure', 'Certain'].forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'conf-btn';
      b.textContent = label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        conf = conf === i + 1 ? null : i + 1;
        [...group.children].forEach((c, k) => {
          c.classList.toggle('is-selected', conf === k + 1);
          c.setAttribute('aria-pressed', conf === k + 1 ? 'true' : 'false');
        });
      });
      group.append(b);
    });
    row.append(group);
    actions.append(row);
  }

  // hand-raise: revealed after a successful answer; re-sends the same
  // payload with the volunteer flag (same slot, so it's an update)
  const hand = document.createElement('button');
  hand.type = 'button';
  hand.className = 'hand-btn';
  hand.textContent = '🖐 I’d say more about mine aloud';
  hand.hidden = true;

  btn.addEventListener('click', async () => {
    error.textContent = '';
    const raw = control.value();
    if (conf) raw.conf = conf;
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
        pseudonymToken: state.pseudonymToken,
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
      // one small physical beat on success — the green text alone is
      // easy to miss mid-lecture with the phone at arm's length
      if (!prefersReducedMotion()) {
        btn.animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
          { duration: 380, easing: 'cubic-bezier(.34, 1.56, .64, 1)' },
        );
      }
      setTimeout(() => {
        btn.classList.remove('is-sent');
        btn.disabled = !state.session.accepting;
        btn.textContent = submitLabel(q, state.submitted);
      }, 1400);

      if (!multi && !state.volunteered) {
        hand.hidden = false;
        hand.__payload = check.payload;
      }

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

  hand.addEventListener('click', async () => {
    if (!hand.__payload) return;
    hand.disabled = true;
    try {
      await submitResponse({
        sessionId: s.id,
        questionId: q.id,
        round: q.round,
        pseudonym: state.pseudonym,
        pseudonymToken: state.pseudonymToken,
        payload: { ...hand.__payload, volunteer: true },
        slot: 0,
      });
      state.volunteered = true;
      hand.textContent = 'Hand raised ✓';
      hand.classList.add('is-raised');
    } catch {
      hand.disabled = false;
    }
  });

  actions.append(error, btn, hand);
  app.append(actions);

  if (isNew && !prefersReducedMotion()) prompt.animate?.(
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
    case 'spectrum':
      return 'Slide to where you stand — there\'s no wrong position';
    case 'sample_vote':
      return 'Read all of them, then pick the strongest';
    case 'heatmap':
      return cfg.mode === 'classify'
        ? 'Label the parts you can identify'
        : '';
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

  // "Q1" on a slide with nothing to answer is a promise the slide doesn't
  // keep, and once a deck can open with an instructions slide, `position`
  // stops being the question number — slide 2 is question 1. The server
  // counts it (see questionOrdinal); older payloads without it fall back.
  if (q && !isContentSlide(q.type)) {
    const n = Number.isInteger(q.number) && q.number > 0
      ? q.number
      : (Number.isInteger(q.position) ? q.position + 1 : null);
    if (n) head.append(div('join-progress', q.total ? `Q${n}/${q.total}` : `Q${n}`));
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
    case 'spectrum': return spectrumControl(q, prior);
    case 'sample_vote': return showdownControl(q, prior);
    case 'heatmap': return heatmapControl(q, prior);
    default: {
      const el = div('state-text', 'This question type isn\'t supported on your device.');
      return { el, value: () => ({}) };
    }
  }
}

// Where do you stand? A single big slider; the answer is the position.
function spectrumControl(q, prior) {
  const cfg = q.config || {};
  const wrap = div('spectrum-control');
  let moved = prior?.pos != null;

  const ends = div('spectrum-control-ends');
  ends.append(
    div('spectrum-control-end', cfg.left_label || 'Disagree'),
    div('spectrum-control-end', cfg.right_label || 'Agree'),
  );

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(prior?.pos ?? 50);
  slider.className = 'spectrum-slider';
  slider.setAttribute('aria-label',
    `${cfg.left_label || 'Disagree'} to ${cfg.right_label || 'Agree'}`);
  slider.addEventListener('input', () => { moved = true; });

  wrap.append(ends, slider);
  return {
    el: wrap,
    value: () => ({ pos: moved ? Number(slider.value) : NaN }),
  };
}

// Anonymous samples as tappable quotation cards + an optional one-liner.
function showdownControl(q, prior) {
  const cfg = q.config || {};
  const samples = Array.isArray(cfg.samples) ? cfg.samples : [];
  const wrap = div('stack-sm');
  let choice = Number.isInteger(prior?.choice) ? prior.choice : null;

  const cards = samples.map((text, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sample-pick' + (choice === i ? ' is-selected' : '');
    card.setAttribute('aria-pressed', choice === i ? 'true' : 'false');
    card.append(div('sample-pick-tag', String.fromCharCode(65 + i)));
    card.append(div('sample-pick-text', text));
    card.addEventListener('click', () => {
      choice = i;
      cards.forEach((c, k) => {
        c.classList.toggle('is-selected', k === i);
        c.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
    });
    wrap.append(card);
    return card;
  });

  let rationale = null;
  if (cfg.allow_rationale !== false) {
    rationale = document.createElement('input');
    rationale.type = 'text';
    rationale.maxLength = 140;
    rationale.placeholder = 'One line: why? (optional)';
    rationale.className = 'rationale-input';
    rationale.value = prior?.rationale || '';
    wrap.append(rationale);
  }

  return {
    el: wrap,
    value: () => ({
      choice: choice ?? -1,
      rationale: rationale ? rationale.value : '',
    }),
  };
}

// The passage, sentence by sentence: tap to highlight, or tap a label
// chip under a sentence in classify mode.
function heatmapControl(q, prior) {
  const cfg = q.config || {};
  const segs = Array.isArray(cfg.segments) ? cfg.segments : [];
  const labels = cfg.mode === 'classify' && Array.isArray(cfg.labels) ? cfg.labels : null;
  const maxPicks = Math.max(1, Math.min(5, Number(cfg.max_picks) || 1));
  const wrap = div('stack-sm heatmap-control');

  const picks = new Set(Array.isArray(prior?.picks) ? prior.picks : []);
  const tags = new Map(prior?.tags
    ? Object.entries(prior.tags).map(([k, v]) => [Number(k), Number(v)]) : []);

  if (!labels) {
    const note = div('q-hint',
      maxPicks > 1 ? `Tap up to ${maxPicks} sentences` : 'Tap one sentence');
    wrap.append(note);
  }

  segs.forEach((text, si) => {
    const row = div('seg-row' + (picks.has(si) ? ' is-picked' : ''));
    const body = document.createElement(labels ? 'div' : 'button');
    if (!labels) {
      body.type = 'button';
      body.setAttribute('aria-pressed', picks.has(si) ? 'true' : 'false');
      body.addEventListener('click', () => {
        if (picks.has(si)) picks.delete(si);
        else {
          if (picks.size >= maxPicks && maxPicks === 1) picks.clear();
          if (picks.size < maxPicks) picks.add(si);
        }
        row.classList.toggle('is-picked', picks.has(si));
        body.setAttribute('aria-pressed', picks.has(si) ? 'true' : 'false');
      });
    }
    body.className = 'seg-body';
    body.textContent = text;
    row.append(body);

    if (labels) {
      const chips = div('seg-chips');
      labels.forEach((label, li) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'seg-chip' + (tags.get(si) === li ? ' is-selected' : '');
        chip.textContent = label;
        chip.setAttribute('aria-pressed', tags.get(si) === li ? 'true' : 'false');
        chip.addEventListener('click', () => {
          if (tags.get(si) === li) tags.delete(si); else tags.set(si, li);
          [...chips.children].forEach((c, k) => {
            c.classList.toggle('is-selected', tags.get(si) === k);
            c.setAttribute('aria-pressed', tags.get(si) === k ? 'true' : 'false');
          });
        });
        chips.append(chip);
      });
      row.append(chips);
    }
    wrap.append(row);
  });

  return {
    el: wrap,
    value: () => (labels
      ? { tags: Object.fromEntries(tags) }
      : { picks: [...picks] }),
  };
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
    // FLIP: the list is rebuilt wholesale, so remember where each item
    // sat and animate the survivors from their old position — reordering
    // reads as movement instead of a teleport.
    const prevTop = new Map();
    [...wrap.children].forEach((child) => {
      if (child.dataset && child.dataset.i) {
        prevTop.set(child.dataset.i, child.getBoundingClientRect().top);
      }
    });

    wrap.textContent = '';
    // ranked items first, in order; then the unranked pool
    const ranked = order.map((i) => ({ i, rank: order.indexOf(i) + 1 }));
    const unranked = items.map((_, i) => i).filter((i) => !order.includes(i));

    ranked.forEach(({ i, rank }, pos) => {
      const row = div('rank-item is-ranked');
      row.dataset.i = String(i);
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
      row.dataset.i = String(i);
      row.append(div('rank-badge', '+'), div('rank-text', label(items[i])));
      row.addEventListener('click', () => { order.push(i); draw(); });
      wrap.append(row);
    });

    if (prevTop.size && !prefersReducedMotion()) {
      [...wrap.children].forEach((child) => {
        const old = child.dataset && prevTop.get(child.dataset.i);
        if (old == null) return;
        const dy = old - child.getBoundingClientRect().top;
        if (Math.abs(dy) > 2) {
          child.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
            { duration: 280, easing: 'cubic-bezier(.2, 0, 0, 1)' },
          );
        }
      });
    }
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
