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
  subscribeToAudienceQuestions, reconnectSockets,
} from './db.js';
import {
  validateResponse, aggregate, optionLabels, MULTI_SUBMIT_TYPES,
  isContentSlide, fillJoinPlaceholders, DEFAULT_JOIN_STEPS,
  trafficLabels, moodIcons, pairList, budgetTotal, clozeParts,
  exitPrompts, timelineItems,
} from './logic.js';
import { applyTheme } from './themes.js';
import { renderAggregate } from './charts.js';
import { prefersReducedMotion } from './motion.js';
import {
  ensurePseudonym, rememberAnswer, recallAnswer,
  codeFromLocation, upvotedIds, markUpvoted,
  rememberSlot, recallSlot,
} from './participant-state.js';

const app = document.getElementById('app');
const statusNode = document.getElementById('join-status');

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
  volunteered: false,
  slot: 0,
  questionShownAt: 0,
  sharedTimer: null,
  pollTimer: null,
  retryTimer: null,
  // The live question's DOM, held onto so a presenter toggling results does
  // not cost the room its half-typed answers. See renderQuestion.
  view: null,
  // The question fetch failed. Nothing in the session row has moved, so the
  // backstop poll would never retry unless it knew to look at this.
  needsQuestion: false,
  online: true,
};

/**
 * Say one short thing to a screen reader.
 *
 * The whole page used to be a live region, so a student using VoiceOver had
 * the entire screen re-read at them on every repaint — and, once results
 * were pushed, a chart re-read every four seconds. This is the replacement:
 * announcements happen because the controller decided something was worth
 * saying, not because the DOM moved.
 */
function announce(text) {
  if (!statusNode) return;
  // Re-setting the same string is a no-op to assistive tech, so clear first
  // when the message repeats (e.g. two dropped connections in a row).
  if (statusNode.textContent === text) statusNode.textContent = '';
  statusNode.textContent = text;
}

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

async function joinByCode(code, attempt = 0) {
  clearRetry();
  showState('', 'Joining…', '', true);

  let session;
  try {
    session = await getSessionByCode(code);
  } catch (err) {
    // This is the request that decides whether the phone works at all. It
    // runs at the exact moment sixty other phones are making the same call
    // off one lecture-theatre access point, so a single dropped request
    // here is ordinary — and it used to be terminal, because everything
    // that could have recovered (the socket, the backstop poll) is set up
    // further down this function and never got created. Retry on a timer
    // the student can see, with a button for anyone unwilling to wait.
    return showJoinRetry(code, err?.message, attempt);
  }

  if (!session) {
    // Keep what they typed. Six characters is not much to retype but it is
    // infuriating to retype when five of them were right, and a bad code in
    // the hash means a reload lands straight back on this same error.
    clearCodeFromURL();
    return showCodeEntry(
      `No session found for “${code}”. Check the code on the screen.`, code);
  }

  state.session = session;
  // A different session (or a re-join) means none of the per-question
  // bookkeeping below belongs to this device any more.
  state.question = null;
  state.submitted = false;
  state.volunteered = false;
  state.slot = 0;
  state.needsQuestion = false;
  state.view = null;
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
      setOnline(true);
      // `hasMoved` only ever looks at the session row. When it was the
      // QUESTION fetch that failed, nothing in that row has moved, so this
      // poll would spin harmlessly while the phone sat on an error screen
      // for the whole six minutes of a discussion question. The flag is how
      // the poll finds out there is something to heal.
      if (fresh && (hasMoved(state.session, fresh) || state.needsQuestion)) {
        onSessionChange(fresh);
      }
    } catch {
      // Not "offline" in the navigator sense necessarily — the request
      // failed, and that is the part worth telling the student about,
      // because the alternative is a screen that looks perfectly normal.
      setOnline(false);
    }
  }, 8000);

  await refresh();
}

// =====================================================================
// Staying in sync
//
// Three things conspire to leave a phone quietly out of date: iOS throttles
// and then freezes setInterval in a backgrounded tab, the OS usually kills
// the WebSocket on suspend without a close frame, and neither of those is
// visible on screen. So a student can unlock their phone on question 3
// while the room is on question 6, looking at a page that gives no hint
// anything is wrong. Every path back into the foreground goes through
// resync().
// =====================================================================

async function resync() {
  if (!state.session) return;
  reconnectSockets();
  try {
    const fresh = await getSessionByCode(state.session.join_code);
    setOnline(true);
    if (fresh) onSessionChange(fresh);
    else await refresh();
  } catch {
    setOnline(false);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resync();
});
window.addEventListener('online', () => { setOnline(true); resync(); });
window.addEventListener('offline', () => setOnline(false));
// Coming back through the back/forward cache: the page is restored whole,
// timers and all, from a moment that may be many minutes old.
window.addEventListener('pageshow', (e) => { if (e.persisted) resync(); });

/**
 * The offline strip.
 *
 * It hangs off <body> rather than #app because #app is emptied on every
 * render, and the one thing a student needs to keep being told is that what
 * they are looking at is not live. Fixed to the top so it is visible
 * whatever they have scrolled to, and styled from theme tokens inline —
 * it is a single element that only this controller knows about.
 */
let offlineStrip = null;

function setOnline(ok) {
  if (state.online === ok) return;
  state.online = ok;

  if (ok) {
    offlineStrip?.remove();
    offlineStrip = null;
    announce('Back online.');
    return;
  }

  if (!offlineStrip) {
    offlineStrip = div('offline-strip', 'Offline. This screen may be out of date');
    document.body.append(offlineStrip);
  }
  announce('Connection lost. This screen may be out of date.');
}

function clearRetry() {
  if (state.retryTimer) {
    clearInterval(state.retryTimer);
    state.retryTimer = null;
  }
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

/**
 * Which refresh is allowed to paint.
 *
 * `onSessionChange` fires refresh() without awaiting it, and a presenter
 * clicking twice inside one round trip therefore has two fetches in flight
 * at once. Without this, whichever one the network happened to finish last
 * won — routinely the OLDER question — and the phone would render question
 * 3 while `state.session.current_question_id` said 4. The student's answer
 * then went to a question the server had closed, and came back a 409 they
 * had no way to make sense of.
 */
let refreshGen = 0;

async function refresh() {
  const gen = (refreshGen += 1);
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
    if (gen !== refreshGen) return;
    state.question = null;
    state.view = null;
    state.needsQuestion = true;
    return showQuestionError(err?.message);
  }
  if (gen !== refreshGen) return;
  state.needsQuestion = false;

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
    // The slot is read back from storage rather than zeroed, because the
    // pseudonym half of the row key survives a reload and this half has to
    // as well — see rememberSlot in participant-state.js.
    state.slot = recallSlot(s.id, q.id, q.round);
    state.submitted = MULTI_SUBMIT_TYPES.has(q.type) ? state.slot > 0 : !!prior;
    // Likewise the raised hand: it is recorded on the answer itself, so a
    // reloaded phone can tell it is already on the instructor's list.
    state.volunteered = !!prior?.volunteer;
    if (!isContentSlide(q.type) && q.type !== 'qa') {
      announce(q.prompt ? `New question. ${q.prompt}` : 'New question.');
    }
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
  state.view = null;
  app.textContent = '';
  app.append(header(q));
  app.append(heading('h1', 'q-prompt', q.prompt || 'How this works'));

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
  wrap.append(div('state-text', 'Nothing to answer here. Keep this page open '
    + 'and the first question will appear by itself.'));

  app.append(wrap);
}

/**
 * Draw — or, far more often, DON'T redraw — the live question.
 *
 * This function used to empty #app and rebuild every control on every call,
 * and it is called from refresh(), which runs on any session change at all.
 * `hasMoved` counts `accepting`, `reveal` and `show_on_devices`, so the
 * instructor pressing H to hide results, or pushing them to phones, blanked
 * sixty half-written textareas at once. A student six items into ranking
 * eight lost the order, because that order lives in the control's closure
 * and `recallAnswer` only restores answers that were actually SENT. The
 * instructor had no idea they had done it.
 *
 * So the control is now sacred: while the question and round are unchanged
 * and it is still on screen, nothing touches it, and only the chrome around
 * it — heading, hint, button, results — is brought up to date.
 */
function renderQuestion(q, isNew) {
  const s = state.session;
  const live = state.view;
  if (!isNew && live && live.id === q.id && live.round === q.round
      && live.control && app.contains(live.control.el)) {
    repaintChrome(q);
    return;
  }

  const prior = recallAnswer(s.id, q.id, q.round);
  const multi = MULTI_SUBMIT_TYPES.has(q.type);

  app.textContent = '';
  const head = header(q);
  app.append(head);

  const prompt = heading('h1', 'q-prompt', q.prompt || 'Your answer');
  app.append(prompt);

  const hintText = hintFor(q);
  const hint = div('q-hint', hintText);
  hint.hidden = !hintText;
  app.append(hint);

  const body = div('q-body');
  const control = buildControl(q, prior);
  body.append(control.el);
  app.append(body);

  const actions = div('join-actions');
  const error = div('field-error');
  // Without this a failed validation is completely silent to a screen
  // reader: the message appears, the student hears nothing, and the only
  // feedback is a button that seems not to work.
  error.setAttribute('role', 'alert');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'submit-btn';

  // confidence rider (anonymous, optional, off unless the question asks)
  let conf = null;
  const cfg = q.config || {};
  if (cfg.confidence && ['multiple_choice', 'quiz', 'sample_vote', 'spectrum',
    'probability', 'budget'].includes(q.type)) {
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

  // A device that already answered this question — usually one that just
  // reloaded — gets the hand back rather than being told nothing happened.
  if (!multi && state.submitted && prior) {
    hand.__payload = prior;
    hand.hidden = false;
    if (state.volunteered) {
      hand.disabled = true;
      hand.textContent = 'Hand raised ✓';
      hand.classList.add('is-raised');
    }
  }

  // Everything the chrome-only repaint needs. Built before the handlers so
  // they can close over it and leave `state.view` free to move on.
  const view = {
    id: q.id, round: q.round, control, head, prompt, hint, btn, hand, error,
    busy: false, open: undefined,
  };

  btn.addEventListener('click', async () => {
    error.textContent = '';
    const raw = control.value();
    if (conf) raw.conf = conf;
    const check = validateResponse(q.type, q.config, raw);
    if (!check.ok) {
      error.textContent = check.error;
      return;
    }

    view.busy = true;
    btn.disabled = true;
    btn.textContent = 'Sending…';

    try {
      const slot = multi ? state.slot : 0;
      // Raising your hand is recorded ON the answer row — same slot, plus a
      // volunteer flag. So a later "Change my answer" that sent the bare
      // payload overwrote that row without the flag and quietly withdrew
      // the student from the instructor's list of who will speak. Nothing
      // told either of them, and because `state.volunteered` stayed true
      // the hand button never came back to offer a way in again. Carry it.
      const payload = (!multi && state.volunteered)
        ? { ...check.payload, volunteer: true }
        : check.payload;

      await submitResponse({
        sessionId: s.id,
        questionId: q.id,
        round: q.round,
        pseudonym: state.pseudonym,
        pseudonymToken: state.pseudonymToken,
        payload,
        slot,
      });

      rememberAnswer(s.id, q.id, q.round, payload);
      state.submitted = true;
      if (multi) {
        state.slot += 1;
        rememberSlot(s.id, q.id, q.round, state.slot);
        control.reset?.();
      }

      btn.classList.add('is-sent');
      btn.textContent = multi ? 'Sent. Add another' : 'Answer sent ✓';
      announce(multi ? 'Sent. You can add another.' : 'Answer sent.');
      // A haptic tick, where the phone has one. This is the only feedback
      // that survives the two things that actually happen in a lecture
      // hall: a phone held low under a desk, and a student who has
      // already looked back up at the screen.
      //
      // Deliberately NOT behind the reduced-motion gate. That preference
      // is about vestibular safety — motion the eye tracks — and a 10ms
      // tick moves nothing on screen. Someone who has asked for less
      // animation has, if anything, more need of a non-visual
      // confirmation. Optional-chained and wrapped because vibrate() is
      // absent on every iPhone and throws inside cross-origin iframes,
      // and a thrown error here would abandon the rest of the success
      // path — leaving the button stuck mid-send after the answer was
      // already accepted.
      try { navigator.vibrate?.(10); } catch { /* no haptics here */ }

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
        view.busy = false;
        syncSendButton(view, q);
      }, 1400);

      if (!multi) {
        hand.__payload = payload;
        if (!state.volunteered) hand.hidden = false;
      }

      maybeShowSharedResults();
    } catch (err) {
      // No special-casing of the message. There used to be a branch here
      // looking for 'row-level security' — a Supabase artefact that this
      // backend has never produced, and which only appeared to work
      // because the Worker's own wording happened to be right anyway.
      error.textContent = err.message || 'Could not send. Check your connection.';
      view.busy = false;
      syncSendButton(view, q);
    }
  });

  hand.addEventListener('click', async () => {
    if (!hand.__payload) return;
    hand.disabled = true;
    const payload = { ...hand.__payload, volunteer: true };
    try {
      await submitResponse({
        sessionId: s.id,
        questionId: q.id,
        round: q.round,
        pseudonym: state.pseudonym,
        pseudonymToken: state.pseudonymToken,
        payload,
        slot: 0,
      });
      state.volunteered = true;
      // Store the flagged payload, so a reload — and any later change of
      // answer — both know this device is on the list.
      rememberAnswer(s.id, q.id, q.round, payload);
      hand.__payload = payload;
      hand.textContent = 'Hand raised ✓';
      hand.classList.add('is-raised');
      announce('Hand raised.');
    } catch {
      hand.disabled = false;
    }
  });

  // The error sits BELOW the button. Above it, a validation message
  // arriving at the moment a thumb is on its way down moved the target.
  actions.append(btn, hand, error);
  app.append(actions);

  state.view = view;
  syncSendButton(view, q);

  if (isNew && !prefersReducedMotion()) prompt.animate?.(
    [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
    { duration: 260, easing: 'cubic-bezier(.22,.8,.3,1)' });

  maybeShowSharedResults();
}

/**
 * Everything around the answer control, brought up to date in place.
 *
 * Called instead of a rebuild whenever the session moved but the question
 * did not — which is most of the time, because hiding results, revealing
 * them, pushing them to phones and closing voting are all session changes.
 */
function repaintChrome(q) {
  const view = state.view;
  if (!view) return;

  const head = header(q);
  view.head.replaceWith(head);
  view.head = head;

  view.prompt.textContent = q.prompt || 'Your answer';

  const hintText = hintFor(q);
  view.hint.textContent = hintText;
  view.hint.hidden = !hintText;

  syncSendButton(view, q);
  maybeShowSharedResults();
}

/**
 * Make the Send button tell the truth about whether the room is voting.
 *
 * `accepting` used to be read in exactly two places, neither of them the
 * moment the button was built. So a student who joined late, or who was
 * looking at their phone when the instructor pressed C, saw a full-strength
 * accent-coloured "Send answer", tapped it, waited out a round trip, and
 * got a red error for their trouble. The session payload already carries
 * the answer; the button just has to say it.
 */
function syncSendButton(view, q) {
  if (!view || view.busy || !view.btn.isConnected) return;
  const open = !!state.session?.accepting;

  view.btn.disabled = !open;
  view.btn.textContent = open ? submitLabel(q, state.submitted) : 'Voting is closed';
  if (view.hand && !state.volunteered) view.hand.disabled = !open;

  // Only worth saying out loud when it CHANGES under them — announcing it
  // on first paint would just be noise on top of the question itself.
  if (view.open !== undefined && view.open !== open) {
    announce(open ? 'Voting is open again.' : 'Voting has closed for this question.');
  }
  view.open = open;
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
      return cfg.allow_skip ? 'Rate each one, or skip any you\'d rather not answer' : 'Rate each one';
    case 'ranking':
      return 'Tap to add to your ranking, then reorder';
    case 'quiz':
      return 'Answer fast: quicker correct answers score more';
    case 'spectrum':
      return 'Slide to where you stand. There\'s no wrong position';
    case 'sample_vote':
      return 'Read all of them, then pick the strongest';
    case 'heatmap':
      return cfg.mode === 'classify'
        ? 'Label the parts you can identify'
        : '';
    case 'traffic':
      return 'However you\'re doing is fine. Nobody sees who said what';
    case 'mood':
      return 'Pick the one that fits today';
    case 'this_or_that':
      return cfg.allow_skip ? 'Go with your gut, and skip any you can\'t call' : 'Go with your gut';
    case 'budget':
      return `Spend all ${budgetTotal(cfg)} points`;
    case 'probability':
      return 'Commit to a number. You can change it after we talk';
    case 'cloze':
      return 'Fill in what\'s missing';
    case 'matching':
      return 'Pair each one up';
    case 'timeline':
      return 'Tap them in the order they happened';
    case 'exit_ticket':
      return 'A sentence each is plenty. Any one of them is enough to send';
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
    case 'traffic': return lampControl(q, prior);
    case 'mood': return moodControl(q, prior);
    case 'this_or_that': return pairPickControl(q, prior);
    case 'budget': return budgetControl(q, prior);
    case 'probability': return probabilityControl(q, prior);
    case 'cloze': return clozeControl(q, prior);
    case 'matching': return matchingControl(q, prior);
    case 'timeline': return rankingControl(q, prior, {
      items: timelineItems(q.config),
      // The config lists the events in their true order, so showing them
      // in that order would hand the answer over. Shuffled by question id:
      // stable across re-renders, never the key.
      pool: shuffledBy(q.id, timelineItems(q.config).length),
    });
    case 'exit_ticket': return exitTicketControl(q, prior);
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
  area.placeholder = 'Your answer. No need to include your name';
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

/**
 * Tap-to-rank, shared by ranking and timeline.
 *
 * `opts.items` overrides where the labels come from, and `opts.pool` the
 * order the unranked ones are offered in — timeline needs both, because
 * its config IS the answer key and offering it unshuffled would give the
 * answer away.
 */
function rankingControl(q, prior, opts = {}) {
  const cfg = q.config || {};
  const items = opts.items || (Array.isArray(cfg.items) ? cfg.items : []);
  const pool = opts.pool || items.map((_, i) => i);
  let order = Array.isArray(prior?.order) ? prior.order.filter((i) => i < items.length) : [];

  const wrap = div('stack-sm');

  const draw = () => {
    // The list is rebuilt wholesale, which detaches whatever the keyboard
    // user just pressed — so remember which control had focus and put it
    // back on the equivalent one afterwards. Without this, ranking an
    // eight-item list by keyboard drops you to <body> on every press and
    // you have to tab back in seven times. (2.4.3)
    const active = document.activeElement;
    const focusKey = wrap.contains(active) ? active.dataset?.rankKey : null;

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
    const unranked = pool.filter((i) => !order.includes(i));

    ranked.forEach(({ i, rank }, pos) => {
      const row = div('rank-item is-ranked');
      row.dataset.i = String(i);
      row.append(div('rank-badge', String(rank)));
      row.append(div('rank-text', label(items[i])));

      // name the row in every control: heard on its own, "Move up" says
      // nothing about which of eight options is about to move
      const what = label(items[i]);
      const moves = div('rank-moves');
      // keys follow the ITEM, not the position, so focus lands on the same
      // button for the same option after it has moved
      const up = moveBtn('▲', `Move ${what} up`, pos === 0, () => {
        [order[pos - 1], order[pos]] = [order[pos], order[pos - 1]];
        draw();
      }, `up:${i}`);
      const down = moveBtn('▼', `Move ${what} down`, pos === ranked.length - 1, () => {
        [order[pos + 1], order[pos]] = [order[pos], order[pos + 1]];
        draw();
      }, `down:${i}`);
      moves.append(up, down);
      row.append(moves);

      const remove = moveBtn('×', `Remove ${what} from the ranking`, false, () => {
        order = order.filter((x) => x !== i);
        draw();
      }, `remove:${i}`);
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

    // Put the keyboard back where it was. The same button for the same
    // option, if it still exists; if the press removed the row or moved
    // the item to an end (disabling ▲ or ▼), fall back to a sibling
    // control on that row, then to the list itself — anything but <body>.
    if (focusKey) {
      const [what, item] = focusKey.split(':');
      const pick = wrap.querySelector(`[data-rank-key="${focusKey}"]:not(:disabled)`)
        || [...(what === 'up' ? ['down', 'remove'] : ['up', 'remove'])]
          .map((k) => wrap.querySelector(`[data-rank-key="${k}:${item}"]:not(:disabled)`))
          .find(Boolean);
      if (pick) pick.focus();
      else {
        // the row is gone entirely (removed from the ranking) — land on the
        // list so the next Tab continues from here rather than the top
        wrap.tabIndex = -1;
        wrap.focus();
      }
    }
  };

  const moveBtn = (glyph, label, disabled, fn, key) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rank-move';
    if (key) b.dataset.rankKey = key;
    // the glyph is decoration; a screen reader would otherwise announce
    // this as "black down-pointing triangle, button"
    const g = document.createElement('span');
    g.setAttribute('aria-hidden', 'true');
    g.textContent = glyph;
    b.append(g);
    b.setAttribute('aria-label', label);
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
// Second-wave controls
//
// Every one of these is built for a phone held at chest height in a room
// where something else is happening: targets you can hit without looking,
// no drag where a tap will do, and nothing that needs two hands.
// =====================================================================

/** A deterministic shuffle, seeded by a string. Same phone, same order. */
function shuffledBy(seed, n) {
  const out = Array.from({ length: n }, (_, i) => i);
  let h = 0x811c9dc5;
  for (const ch of String(seed || 'x')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  for (let i = out.length - 1; i > 0; i -= 1) {
    h = (Math.imul(h, 0x01000193) ^ (i + 0x9e3779b9)) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Traffic light: three targets, full width, coloured. The whole point is
// answering it without looking down for more than a second.
function lampControl(q, prior) {
  const labels = trafficLabels(q.config);
  const wrap = div('stack-sm lamp-control');
  let choice = Number.isInteger(prior?.choice) ? prior.choice : null;

  const btns = labels.map((text, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `lamp-btn lamp-${i}` + (choice === i ? ' is-selected' : '');
    b.setAttribute('aria-pressed', choice === i ? 'true' : 'false');
    b.append(div('lamp-dot'), div('lamp-text', text));
    b.addEventListener('click', () => {
      choice = i;
      btns.forEach((c, k) => {
        c.classList.toggle('is-selected', k === i);
        c.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
    });
    wrap.append(b);
    return b;
  });

  return { el: wrap, value: () => ({ choice: choice ?? -1 }) };
}

// Mood: the icons at thumb size, the words underneath them.
function moodControl(q, prior) {
  const icons = moodIcons(q.config);
  const wrap = div('mood-picker');
  let choice = Number.isInteger(prior?.choice) ? prior.choice : null;

  const btns = icons.map((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood-btn' + (choice === i ? ' is-selected' : '');
    b.setAttribute('aria-pressed', choice === i ? 'true' : 'false');
    b.setAttribute('aria-label', m.label || m.emoji);
    b.append(div('mood-btn-glyph', m.emoji), div('mood-btn-label', m.label || ''));
    b.addEventListener('click', () => {
      choice = i;
      btns.forEach((c, k) => {
        c.classList.toggle('is-selected', k === i);
        c.setAttribute('aria-pressed', k === i ? 'true' : 'false');
      });
    });
    wrap.append(b);
    return b;
  });

  return { el: wrap, value: () => ({ choice: choice ?? -1 }) };
}

// This or That: a stack of two-button rows, thumbed through in seconds.
function pairPickControl(q, prior) {
  const cfg = q.config || {};
  const pairs = pairList(cfg);
  const picks = pairs.map((_, i) => {
    const v = prior?.picks?.[i];
    return v === 0 || v === 1 ? v : null;
  });
  const wrap = div('stack-sm');

  pairs.forEach((pair, i) => {
    const row = div('tot-row');
    const sides = div('tot-sides');
    [pair.left, pair.right].forEach((text, side) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tot-btn' + (picks[i] === side ? ' is-selected' : '');
      b.textContent = text;
      b.setAttribute('aria-pressed', picks[i] === side ? 'true' : 'false');
      b.addEventListener('click', () => {
        // tapping the chosen side again clears it, which is the only way
        // back to "no opinion" on a question that allows skipping
        picks[i] = picks[i] === side && cfg.allow_skip ? null : side;
        [...sides.children].forEach((c, k) => {
          c.classList.toggle('is-selected', picks[i] === k);
          c.setAttribute('aria-pressed', picks[i] === k ? 'true' : 'false');
        });
      });
      sides.append(b);
    });
    row.append(sides);
    wrap.append(row);
  });

  return { el: wrap, value: () => ({ picks }) };
}

// Budget: steppers, not sliders. A slider cannot hit 25 exactly on a
// phone, and every one of these questions is about hitting a number.
function budgetControl(q, prior) {
  const cfg = q.config || {};
  const labels = optionLabels(cfg);
  const total = budgetTotal(cfg);
  const step = total % 10 === 0 ? Math.max(1, Math.round(total / 20)) : 1;
  const alloc = labels.map((_, i) => {
    const v = Number(prior?.alloc?.[i]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  });

  const wrap = div('stack-sm budget-control');
  const bank = div('budget-bank');
  wrap.append(bank);

  const rows = [];
  const spent = () => alloc.reduce((s, n) => s + n, 0);

  const syncBank = () => {
    const left = total - spent();
    bank.textContent = left === 0
      ? `All ${total} placed ✓`
      : left > 0 ? `${left} left to place` : `${-left} over`;
    bank.classList.toggle('is-done', left === 0);
    bank.classList.toggle('is-over', left < 0);
    rows.forEach((r, i) => {
      r.value.textContent = String(alloc[i]);
      r.row.classList.toggle('is-funded', alloc[i] > 0);
      r.plus.disabled = left <= 0;
      r.minus.disabled = alloc[i] <= 0;
    });
  };

  labels.forEach((text, i) => {
    const row = div('budget-line');
    row.append(div('budget-line-label', text));
    const stepper = div('budget-stepper');

    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'budget-step';
    minus.textContent = '−';
    minus.setAttribute('aria-label', `Take points off ${text}`);

    const value = div('budget-value', '0');
    value.setAttribute('aria-live', 'polite');

    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'budget-step';
    plus.textContent = '+';
    plus.setAttribute('aria-label', `Put points on ${text}`);

    minus.addEventListener('click', () => {
      alloc[i] = Math.max(0, alloc[i] - step);
      syncBank();
    });
    plus.addEventListener('click', () => {
      const left = total - spent();
      if (left <= 0) return;
      alloc[i] += Math.min(step, left);
      syncBank();
    });

    stepper.append(minus, value, plus);
    row.append(stepper);
    wrap.append(row);
    rows.push({ row, value, plus, minus });
  });

  syncBank();
  return { el: wrap, value: () => ({ alloc }) };
}

// Probability: one slider, and a percentage big enough to read at arm's
// length — the number is what they are committing to, so it gets the size.
function probabilityControl(q, prior) {
  const wrap = div('prob-control');
  let moved = prior?.pct != null;

  const readout = div('prob-readout', `${prior?.pct ?? 50}%`);
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(prior?.pct ?? 50);
  slider.className = 'spectrum-slider';
  slider.setAttribute('aria-label', 'How likely, as a percentage');
  slider.addEventListener('input', () => {
    moved = true;
    readout.textContent = `${slider.value}%`;
  });

  const ends = div('spectrum-control-ends');
  ends.append(div('spectrum-control-end', 'No chance'), div('spectrum-control-end', 'Certain'));

  wrap.append(readout, slider, ends);
  return { el: wrap, value: () => ({ pct: moved ? Number(slider.value) : NaN }) };
}

// Fill in the blank: the sentence itself, with inputs sized to sit in it.
function clozeControl(q, prior) {
  const cfg = q.config || {};
  const parts = clozeParts(cfg.text);
  const wrap = div('cloze-control');
  const inputs = [];

  parts.forEach((p) => {
    if (p.kind === 'text') {
      wrap.append(div('cloze-run', p.text));
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cloze-input';
    input.maxLength = 40;
    input.autocomplete = 'off';
    input.autocapitalize = 'none';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Blank ${inputs.length + 1}`);
    input.value = prior?.blanks?.[inputs.length] || '';
    // grows with what's typed, so a long answer isn't hidden inside a box
    const size = () => { input.style.width = `${Math.max(4, input.value.length + 2)}ch`; };
    input.addEventListener('input', size);
    size();
    inputs.push(input);
    wrap.append(input);
  });

  setTimeout(() => inputs[0]?.focus(), 120);
  return { el: wrap, value: () => ({ blanks: inputs.map((i) => i.value) }) };
}

// Matching: a native select per term. Dragging lines between two columns
// is a desktop gesture; a select is one tap, works with a screen reader,
// and cannot be lost mid-drag on a scrolling page.
function matchingControl(q, prior) {
  const cfg = q.config || {};
  const pairs = pairList(cfg);
  const matches = pairs.map((_, i) => {
    const v = prior?.matches?.[i];
    return Number.isInteger(v) ? v : null;
  });
  const view = shuffledBy(q.id, pairs.length);
  const wrap = div('stack-sm');

  pairs.forEach((pair, i) => {
    const row = div('match-line');
    row.append(div('match-line-label', pair.left));

    const sel = document.createElement('select');
    sel.className = 'match-select';
    sel.setAttribute('aria-label', `Match for ${pair.left}`);
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Choose…';
    sel.append(blank);
    view.forEach((k) => {
      const o = document.createElement('option');
      o.value = String(k);
      o.textContent = pairs[k].right;
      sel.append(o);
    });
    sel.value = matches[i] == null ? '' : String(matches[i]);
    sel.addEventListener('change', () => {
      matches[i] = sel.value === '' ? null : Number(sel.value);
      row.classList.toggle('is-set', matches[i] != null);
    });
    row.classList.toggle('is-set', matches[i] != null);
    row.append(sel);
    wrap.append(row);
  });

  return { el: wrap, value: () => ({ matches }) };
}

// Exit ticket: three boxes, labelled with the three questions.
function exitTicketControl(q, prior) {
  const cfg = q.config || {};
  const prompts = exitPrompts(cfg);
  const limit = Number(cfg.max_length) > 0 ? Number(cfg.max_length) : 200;
  const wrap = div('stack-sm');
  const areas = [];

  prompts.forEach((text, i) => {
    const field = div('exit-field');
    field.append(div('exit-field-label', text));
    const area = document.createElement('textarea');
    area.className = 'text-input';
    area.rows = 2;
    area.maxLength = limit;
    area.placeholder = i === 1 ? 'Anything still unclear?' : 'A sentence is plenty';
    area.value = prior?.answers?.[i] || '';
    areas.push(area);
    field.append(area);
    wrap.append(field);
  });

  return {
    el: wrap,
    value: () => ({ answers: areas.map((a) => a.value) }),
  };
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
  if (!s?.show_on_devices || !s.reveal || !q || q.type === 'qa') {
    // The chart used to be cleared as a side effect of the whole page
    // being rebuilt. Now that the question survives a repaint, taking
    // results back down has to be said out loud.
    app.querySelector('.shared-result')?.remove();
    return;
  }

  const paint = async () => {
    try {
      const res = await fetchSharedResults(s.id, q.id, q.round);
      if (!res) return;
      let host = app.querySelector('.shared-result');
      if (!host) {
        host = div('shared-result');
        host.append(heading('h2', 'eyebrow', 'The room so far'));
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
  state.view = null;
  app.textContent = '';
  app.append(header(q));
  app.append(heading('h1', 'q-prompt', q.prompt || 'Ask a question'));
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
  area.placeholder = 'Type your question. No need to include your name';
  const err = div('field-error');
  err.setAttribute('role', 'alert');
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
      send.textContent = s.qa_moderated ? 'Sent, awaiting review ✓' : 'Sent ✓';
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

  compose.append(area, send, err);
  panel.append(compose);

  const list = div('qa-list');
  panel.append(heading('h2', 'eyebrow', 'From the room'), list);
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
      // Elements, not an innerHTML string: the count is the only thing
      // that changes and it is the one value here that came off the wire.
      const arrow = document.createElement('span');
      arrow.textContent = '▲';
      arrow.setAttribute('aria-hidden', 'true');
      const tally = document.createElement('span');
      tally.textContent = String(row.upvotes);
      vote.append(arrow, tally);
      vote.disabled = voted.has(row.id);
      vote.setAttribute('aria-label', `Upvote. ${row.upvotes} votes.`);
      vote.addEventListener('click', async () => {
        vote.disabled = true;
        try {
          const n = await upvoteAudienceQuestion(s.id, row.id);
          markUpvoted(s.id, row.id);
          voted.add(row.id);
          vote.classList.add('is-voted');
          tally.textContent = String(n);
          vote.setAttribute('aria-label', `Upvoted. ${n} votes.`);
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

/** @returns {HTMLElement} the wrapper, so callers can hang a button off it. */
function showState(icon, title, text, waiting = false) {
  state.view = null;
  app.textContent = '';
  const wrap = div('join-state');
  if (icon) {
    // The glyph restates the heading it sits above; read aloud it becomes
    // "warning sign" before the sentence that says what is actually wrong.
    const node = div('state-icon', icon);
    node.setAttribute('aria-hidden', 'true');
    wrap.append(node);
  }
  if (waiting) {
    const dots = div('pulse-wait');
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = '<span></span><span></span><span></span>';
    wrap.append(dots);
  }
  // Every one of these screens IS the page while it is up, so its title is
  // the page's <h1>. Before this the join page emitted no heading at all,
  // which left a screen-reader user with no landmark to jump to and no way
  // to tell one screen from the next except by reading everything.
  if (title) wrap.append(heading('h1', 'state-title', title));
  if (text) wrap.append(div('state-text', text));
  if (state.pseudonym && state.session && showNickname()) {
    const tag = document.createElement('span');
    tag.className = 'join-pseudonym';
    tag.textContent = `You are ${state.pseudonym}`;
    wrap.append(tag);
  }
  app.append(wrap);
  return wrap;
}

/**
 * The join request failed. Show a countdown, retry on it, and offer a
 * button to anyone not willing to watch it tick.
 */
function showJoinRetry(code, message, attempt) {
  const wrap = showState('⚠️', 'Could not connect',
    message || 'The network dropped on the way in.');
  announce('Could not connect. Trying again.');

  const countdown = div('state-text');
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'submit-btn';
  again.textContent = 'Try again now';
  again.addEventListener('click', () => joinByCode(code, attempt + 1));
  wrap.append(countdown, again);

  // Backs off, but never past fifteen seconds: a class is happening.
  let left = Math.round(Math.min(2000 * 2 ** attempt, 15000) / 1000);
  const tick = () => {
    if (left <= 0) {
      clearRetry();
      joinByCode(code, attempt + 1);
      return;
    }
    countdown.textContent = `Trying again in ${left}s…`;
    left -= 1;
  };
  tick();
  state.retryTimer = setInterval(tick, 1000);
}

/**
 * The question fetch failed. The backstop poll heals this within 8s (it
 * watches `state.needsQuestion`), but a stuck screen with no explanation is
 * its own problem — say what is happening, and let them skip the wait.
 */
function showQuestionError(message) {
  const wrap = showState('⚠️', 'Could not load the question',
    message || 'That did not come through.');
  wrap.append(div('state-text', 'Trying again automatically…'));
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'submit-btn';
  again.textContent = 'Try again now';
  again.addEventListener('click', () => refresh());
  wrap.append(again);
  announce('Could not load the question. Trying again.');
}

function showCodeEntry(message, prefill = '') {
  state.view = null;
  app.textContent = '';
  const wrap = div('join-state');
  wrap.append(heading('h1', 'state-title', 'Enter the code'));
  wrap.append(div('state-text', 'It\'s on the screen at the front of the room.'));
  if (message) {
    const warn = div('alert alert-error');
    warn.setAttribute('role', 'alert');
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
  // Whatever they typed comes back, cursor at the end. One wrong character
  // should cost one keystroke to fix, not six to retype.
  input.value = prefill;

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

/**
 * Same as div(), but a real heading. The styles are all class-based and
 * base.css already flattens h1–h4 to margin 0, so this is purely a change
 * of semantics — nothing moves on screen.
 */
function heading(tag, cls, text) {
  const h = document.createElement(tag);
  if (cls) h.className = cls;
  if (text != null) h.textContent = text;
  return h;
}

/**
 * Drop the join code out of the address bar.
 *
 * Only called when the code turned out to be wrong. Leaving it in the hash
 * means a reload — the first thing anyone tries — reproduces the same error
 * instead of showing the empty box the student now needs. `replaceState`
 * does not fire `hashchange`, so the listener at the bottom of this file
 * stays out of it.
 */
function clearCodeFromURL() {
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete('code');
    url.searchParams.delete('c');
    window.history.replaceState(null, '', url.pathname + url.search);
  } catch { /* no history API; the prefilled field still saves the retype */ }
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
