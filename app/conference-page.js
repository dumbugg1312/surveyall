/**
 * SurveyAll — a student's side of a conference board.
 *
 * Opened once at the start of class (the join page sends a board's code
 * here) and left open. The phone keeps no state that matters: the card
 * lives on the server, so a locked screen, a closed tab or a dead battery
 * costs nothing — reopen the page and it picks up where it was.
 *
 * What the phone keeps locally, on this device only:
 *   • its signed seat for this board, so a reload is the same student;
 *   • its last next step, so it survives the board being erased.
 * Nothing carries over to the next board — not even the name — because
 * the device may be a shared lab computer.
 *
 * The phone never tells a student they have been called, or where they
 * are in line: the instructor calls names aloud, and a student who has
 * asked should be writing, not watching their phone.
 */

import {
  getSessionByCode, claimSeat, seatAction, watchSeat, reconnectSockets,
} from './db.js';
import { MOODS, LIMITS } from './conference-logic.js';

const $ = (id) => document.getElementById(id);

const code = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim().toUpperCase();

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } },
  drop(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};
const SEAT_KEY = `surveyall:seat:${code}`;
const STEP_KEY = `surveyall:step:${code}`;

let seat = null;          // { seat, token }
let view = null;          // { board, card }
let unwatch = null;
let asking = false;       // the "what do you want to talk about" panel is open
let editingStep = false;
let lastStatus = '';
let editingName = false;  // the setup form reopened from "Change name"
let resetOnce = false;

// ------------------------------------------------------------------ boot

init();

async function init() {
  if (!code) { window.location.replace('join'); return; }
  show('loading');
  try {
    const found = await getSessionByCode(code);
    if (!found) return problem(`No board found for “${code}”. Check the code on the screen.`);
    if (found.kind !== 'conference') { window.location.replace(`join#${encodeURIComponent(code)}`); return; }
    $('title').textContent = found.title || 'Conferences';
    if (found.state !== 'live') return ended();

    seat = store.get(SEAT_KEY);
    if (!seat?.seat || !seat?.token) {
      seat = await claimSeat(code);
      store.set(SEAT_KEY, seat);
    }
    apply(await seatAction(code, seat, 'me'));
    unwatch = watchSeat(code, seat, apply, ended);
  } catch (err) {
    if (err.status === 410) return ended();
    if (err.status === 403 && !resetOnce) {
      // A seat this server no longer recognises (its secret was rotated).
      // Start fresh, once.
      resetOnce = true;
      store.drop(SEAT_KEY);
      return init();
    }
    problem(err.message || 'Something went wrong.');
  }
}

async function refresh() {
  try {
    apply(await seatAction(code, seat, 'me'));
  } catch (err) {
    if (err.status === 410) ended();
  }
}

// A phone that was locked or backgrounded wakes with a socket the OS may
// have torn down. Reconnect now, and ask for the card directly in case
// anything changed while it slept.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !seat || !unwatch) return;
  reconnectSockets();
  refresh();
});
// A slow backstop for a socket that is quietly dead.
setInterval(() => {
  if (document.visibilityState === 'visible' && seat && unwatch) refresh();
}, 90_000);

$('retry').addEventListener('click', () => init());

// ---------------------------------------------------------------- screens

function show(id) {
  for (const s of ['loading', 'problem', 'ended', 'setup', 'main']) $(s).hidden = s !== id;
}

function problem(text) {
  $('problemText').textContent = text;
  show('problem');
}

function ended() {
  unwatch?.();
  unwatch = null;
  store.drop(SEAT_KEY);
  const step = store.get(STEP_KEY);
  $('endedStep').hidden = !step;
  $('endedStepText').textContent = step || '';
  document.title = 'Conferences · SurveyAll';
  show('ended');
}

// ------------------------------------------------------------------ apply

function apply(next) {
  if (!next?.board) { ended(); return; }
  view = next;
  const { board, card } = view;
  $('title').textContent = board.title || 'Conferences';

  if (!card || editingName) { renderSetup(); return; }
  if (card.step) store.set(STEP_KEY, card.step);
  renderMain();
}

function stageButtons(host, current, onPick) {
  host.replaceChildren();
  view.board.stages.forEach((label, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-stage';
    b.setAttribute('aria-pressed', String(i === current));
    if (i < current) b.classList.add('is-past');
    const n = document.createElement('span');
    n.className = 'cf-stage-n';
    n.textContent = String(i + 1);
    const t = document.createElement('span');
    t.textContent = label;
    b.append(n, t);
    b.addEventListener('click', () => onPick(i));
    host.append(b);
  });
}

// ------------------------------------------------------------------ setup

let setupStage = -1;

function renderSetup() {
  if ($('setup').hidden) {
    // Deliberately no "remember me" from a previous board: on a shared lab
    // computer that would hand one student's name to the next.
    const existing = view.card;
    $('setupName').value = existing?.name || '';
    $('setupTopic').value = existing?.topic || '';
    setupStage = existing ? existing.stage : -1;
  }
  const paint = () => stageButtons($('setupStages'), setupStage, (i) => { setupStage = i; paint(); });
  paint();
  $('setupError').hidden = true;
  $('setupCancel').hidden = !view.card;
  show('setup');
  if (!$('setupName').value) $('setupName').focus();
}

$('setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('setupName').value.trim();
  const err = (msg) => { $('setupError').textContent = msg; $('setupError').hidden = false; };
  if (!name) return err('Add your first name and last initial.');
  if (setupStage < 0) return err('Tap where you are in the process.');
  $('setupSave').disabled = true;
  try {
    const next = await seatAction(code, seat, 'save', {
      name, topic: $('setupTopic').value, stage: setupStage,
    });
    editingName = false;
    apply(next);
  } catch (ex) {
    err(ex.message);
  } finally {
    $('setupSave').disabled = false;
  }
});

$('editName').addEventListener('click', () => {
  editingName = true;
  $('setup').hidden = true; // so renderSetup refills from the card
  renderSetup();
});

// Someone else's card on this device — a shared or borrowed computer.
// Forget the seat and start over as a new student; the old card stays on
// the board for its owner (and the instructor can remove a stray one).
$('notMe').addEventListener('click', async () => {
  unwatch?.();
  unwatch = null;
  store.drop(SEAT_KEY);
  store.drop(STEP_KEY);
  seat = null;
  view = null;
  lastStatus = '';
  editingName = false;
  asking = false;
  editingStep = false;
  $('setup').hidden = true;
  await init();
});

$('setupCancel').addEventListener('click', () => {
  editingName = false;
  apply(view);
});

// ------------------------------------------------------------------- main

/**
 * The phone never announces anything. No "you're up", no place in line,
 * no buzz: a student who has asked should go back to their essay, not
 * watch a counter, and the instructor calls names aloud. So once a
 * request is in, this says only that it is in, and gets out of the way.
 */
function statusKey(card) {
  if (card.ask) return `waiting:${card.ask.about}:${card.ask.note}`;
  // Right after a conference the next-step prompt is the only thing asked
  // of the student; the button to ask again waits until it's answered.
  if (card.stepPending) return 'reflecting';
  return 'idle';
}

function renderMain() {
  const { card } = view;
  show('main');

  // ---- status: only rebuilt when it actually changes ----------------------
  const key = statusKey(card);
  if (key !== lastStatus) {
    lastStatus = key;
    const host = $('status');
    host.replaceChildren();
    host.className = 'cf-status';

    const heading = (text) => { const h = document.createElement('p'); h.className = 'cf-status-head'; h.textContent = text; return h; };
    const para = (text, cls = 'cf-status-text') => { const p = document.createElement('p'); p.className = cls; p.textContent = text; return p; };

    if (card.ask) {
      host.classList.add('is-waiting');
      host.append(
        heading('You’re on the list.'),
        para('Keep working. Your instructor will call your name.'),
        para(`To talk about: ${card.ask.about}${card.ask.note ? ` · “${card.ask.note}”` : ''}`, 'cf-status-text muted'),
      );
      const row = document.createElement('div');
      row.className = 'row';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'btn btn-sm';
      edit.textContent = 'Change what to talk about';
      edit.addEventListener('click', () => openAsk());
      const leave = document.createElement('button');
      leave.type = 'button';
      leave.className = 'btn btn-sm btn-ghost';
      leave.textContent = 'I figured it out: take me off';
      leave.addEventListener('click', () => act('unask'));
      row.append(edit, leave);
      host.append(row);
    } else if (key !== 'reflecting') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-primary btn-lg cf-wide cf-ask-btn';
      b.textContent = card.conferences?.length ? 'I’d like another conference' : 'I’d like a conference';
      b.addEventListener('click', () => openAsk());
      host.append(b);
    }
  }
  $('askPanel').hidden = !asking;
  const bigAsk = $('status').querySelector('.cf-ask-btn');
  if (bigAsk) bigAsk.hidden = asking;

  // ---- next step ------------------------------------------------------------
  const wantStep = card.stepPending || editingStep;
  if (wantStep && $('stepForm').hidden) {
    $('stepInput').value = card.step || '';
    $('stepForm').hidden = false;
    if (card.stepPending) $('stepInput').focus();
  }
  if (!wantStep) $('stepForm').hidden = true;
  $('stepCard').hidden = !card.step || wantStep;
  $('stepText').textContent = card.step || '';

  // ---- card -----------------------------------------------------------------
  $('whoName').textContent = card.name;
  $('notMeName').textContent = card.name;
  if (document.activeElement !== $('topic')) $('topic').value = card.topic || '';
  stageButtons($('stages'), card.stage, (i) => act('save', { stage: i }));

  const moods = $('moods');
  moods.replaceChildren();
  for (const m of MOODS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cf-mood cf-mood-${m.id}`;
    b.setAttribute('aria-pressed', String(card.mood === m.id));
    b.textContent = m.label;
    b.addEventListener('click', () => act('save', { mood: card.mood === m.id ? '' : m.id }));
    moods.append(b);
  }
}


async function act(op, data) {
  try {
    apply(await seatAction(code, seat, op, data));
    return true;
  } catch (err) {
    if (err.status === 410) { ended(); return false; }
    flash(err.message);
    return false;
  }
}

function flash(message) {
  const host = $('status');
  let p = host.querySelector('.cf-flash');
  if (!p) { p = document.createElement('p'); p.className = 'cf-flash alert alert-error'; host.append(p); }
  p.textContent = message;
  setTimeout(() => p.remove(), 4000);
}

// ---------------------------------------------------------------- topic

let topicTimer = null;
function saveTopic() {
  clearTimeout(topicTimer);
  const value = $('topic').value.trim().slice(0, LIMITS.topic);
  if (!view?.card || value === (view.card.topic || '')) return;
  act('save', { topic: value }).then((ok) => {
    if (!ok) return;
    $('topicSaved').textContent = 'Saved';
    setTimeout(() => { $('topicSaved').textContent = ''; }, 1600);
  });
}
$('topic').addEventListener('input', () => {
  clearTimeout(topicTimer);
  topicTimer = setTimeout(saveTopic, 1200);
});
$('topic').addEventListener('blur', saveTopic);
$('topic').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('topic').blur(); } });

// ------------------------------------------------------------------ ask

let askAbout = '';

function openAsk() {
  const { board, card } = view;
  asking = true;
  askAbout = card.ask?.about || '';
  $('askNote').value = card.ask?.note || '';
  $('askError').hidden = true;
  const host = $('askTopics');
  host.replaceChildren();
  const paint = () => host.querySelectorAll('button').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.value === askAbout));
  });
  for (const t of board.topics) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cf-choice';
    b.setAttribute('role', 'radio');
    b.dataset.value = t;
    b.textContent = t;
    b.addEventListener('click', () => { askAbout = t; paint(); });
    host.append(b);
  }
  paint();
  $('askSubmit').textContent = card.ask ? 'Update' : 'Add me to the list';
  $('askPanel').hidden = false;
  const bigAsk = $('status').querySelector('.cf-ask-btn');
  if (bigAsk) bigAsk.hidden = true;
  $('askPanel').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  host.querySelector('button')?.focus();
}

$('askCancel').addEventListener('click', () => {
  asking = false;
  $('askPanel').hidden = true;
  const bigAsk = $('status').querySelector('.cf-ask-btn');
  if (bigAsk) bigAsk.hidden = false;
});

$('askPanel').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!askAbout) {
    $('askError').textContent = 'Pick what you want to talk about, so you’re ready when you’re called.';
    $('askError').hidden = false;
    return;
  }
  $('askSubmit').disabled = true;
  asking = false;
  const ok = await act('ask', { about: askAbout, note: $('askNote').value });
  $('askSubmit').disabled = false;
  if (!ok) { asking = true; $('askPanel').hidden = false; }
});

// ---------------------------------------------------------------- step

$('stepForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('stepInput').value.trim();
  if (!text) { $('stepInput').focus(); return; }
  editingStep = false;
  $('stepForm').hidden = true;
  await act('step', { text });
});

$('stepEdit').addEventListener('click', () => {
  editingStep = true;
  $('stepForm').hidden = true; // renderMain refills it
  renderMain();
  $('stepInput').focus();
});
