/**
 * SurveyAll — the instructor's conference board.
 *
 * Built for the laptop on the desk, not the projector: it shows names.
 * Five lanes, in the order an instructor works them —
 *
 *   With you        at the front now, with a timer against the target
 *   Asked           the line: first visits ahead of return visits
 *   Might need you  hasn't asked, but something says look
 *   Working         everyone else, one dense row each
 *   Talked to       done, with the next step the student wrote
 *
 * The lane rules live in app/conference-logic.js, shared with the Durable
 * Object, so the order here and a phone's "you're 3rd in line" can never
 * disagree.
 *
 * Ending the board downloads the log to this computer FIRST and then
 * erases every student from the server. That download is the only copy
 * that outlives the board, by design.
 */

import {
  currentUser, getBoard, boardAction, endBoard, watchBoard, reconnectSockets,
} from './db.js';
import {
  lanes, coverage, logRows, LOG_HEADERS, MOODS, hasBeenSeen,
} from './conference-logic.js';
import { buildCSV, joinURL, joinURLPretty } from './logic.js';
import { joinBase } from './config.js';
import { qrSVG } from './qr.js';
import { el, button, toast, askConfirm } from './ui.js';

const $ = (id) => document.getElementById(id);
const boardId = new URLSearchParams(window.location.search).get('id');

let row = null;            // the D1 board: code, title, settings, state
let state = null;          // { meta, cards } from the room
let unwatch = null;
let lastLog = null;        // kept after end, so "download again" works
const seenAsks = new Set(); // ask timestamps already drawn, to mark arrivals
let firstPaint = true;
let queueHead = '';

boot().catch((err) => {
  console.error(err);
  $('title').textContent = 'Could not open this board';
  $('endedNote').textContent = err.message || String(err);
  $('endedNote').hidden = false;
});

async function boot() {
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }
  if (!boardId) { window.location.replace('dashboard.html'); return; }

  const res = await getBoard(boardId);
  row = res;
  $('title').textContent = row.title;
  $('code').textContent = row.join_code;
  document.title = `${row.title} · Conferences`;

  if (row.state !== 'live' || !res.view) { showEnded(null); return; }
  state = res.view;
  render();
  unwatch = watchBoard(boardId, (next) => { state = next; render(); }, () => showEnded(null));

  const erase = new Date(row.expires_at);
  $('eraseNote').textContent = `Student names erase automatically at ${erase.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} if you don’t end the board first.`;

  // Timers tick every second; "waiting 4 min" and the quiet-sign lane only
  // need a fresh look every so often.
  setInterval(tickTimers, 1000);
  setInterval(() => { if (state) render(); }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectSockets();
  });
}

// ---------------------------------------------------------------- helpers

const board = () => ({ ...(state?.meta || {}), stages: state?.meta?.stages || row?.settings?.stages });
const stageName = (c) => board().stages?.[c.stage] || '';
const moodLabel = Object.fromEntries(MOODS.map((m) => [m.id, m.label]));

function minutesSince(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : `${m} min`;
}

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tag(text, cls = '') {
  return el('span', `bd-tag ${cls}`.trim(), text);
}

async function act(op, card) {
  try {
    await boardAction(boardId, op, card.seat);
  } catch (err) {
    toast(err.message);
  }
}

// ----------------------------------------------------------------- render

function render() {
  if (!state) return;
  const focusKey = document.activeElement?.dataset?.focusKey;
  const l = lanes(state.cards);
  const cov = coverage(state.cards);

  $('statJoined').textContent = cov.joined;
  $('statTalked').textContent = cov.talked;
  $('statWaiting').textContent = cov.waiting;
  document.title = cov.waiting ? `(${cov.waiting}) ${row.title} · Conferences` : `${row.title} · Conferences`;

  queueHead = l.asked[0]?.seat || '';
  fill('withList', 'nWith', l.withYou, (c) => card(c, 'with'), 'Nobody at the front.');
  fill('askedList', 'nAsked', l.asked, (c) => card(c, 'asked'), 'Nobody in line.');
  fill('flagList', 'nFlag', l.flagged, (f) => card(f.card, 'flagged', f.reason), 'Nothing stands out.');
  fill('workList', 'nWork', l.working, rosterRow, cov.joined ? 'Everyone else is accounted for above.' : 'Nobody has joined yet. Press “Show join code”.');
  fill('seenList', 'nSeen', l.seen, (c) => card(c, 'seen'), 'No conferences yet.');


  for (const c of state.cards) if (c.ask) seenAsks.add(`${c.seat}:${c.ask.at}`);
  firstPaint = false;

  if (focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
  tickTimers();
}

function fill(listId, countId, items, draw, emptyText) {
  const list = $(listId);
  list.replaceChildren(...(items.length ? items.map(draw) : [el('li', 'bd-empty', emptyText)]));
  $(countId).textContent = items.length ? String(items.length) : '';
}

function actionButton(label, cls, op, c) {
  const b = button(label, `btn-sm ${cls}`, () => act(op, c));
  b.dataset.focusKey = `${op}:${c.seat}`;
  return b;
}

/** One student, as a card. `kind` is the lane it is drawn in. */
function card(c, kind, reason = '') {
  const li = el('li', 'bd-card');
  if (kind === 'with') li.classList.add('is-with');
  if (kind === 'flagged') li.classList.add('is-flagged');
  if (kind === 'asked' && !firstPaint && !seenAsks.has(`${c.seat}:${c.ask.at}`)) li.classList.add('is-new');

  const name = el('div', 'bd-name', c.name);
  if (kind === 'with') {
    const t = el('span', 'bd-timer');
    t.dataset.since = String(c.callAt);
    name.append(t);
  }
  if (kind === 'asked' && hasBeenSeen(c)) name.append(tag('Return visit'));
  if (kind === 'asked') name.append(tag(`waiting ${minutesSince(c.ask.at)}`));
  if (kind === 'flagged') name.append(tag(reason, 'bd-tag-warn'));
  li.append(name);

  const topic = el('div', `bd-topic${c.topic ? '' : ' is-missing'}`, c.topic || 'No topic yet');
  li.append(topic);

  const meta = el('div', 'bd-meta');
  if (stageName(c)) meta.append(tag(`${c.stage + 1}. ${stageName(c)}`));
  // A flag that already says "stuck" doesn't need the chip repeating it.
  if (c.mood && !(kind === 'flagged' && c.mood === 'stuck')) {
    meta.append(tag(moodLabel[c.mood], c.mood === 'stuck' ? 'bd-tag-stuck' : ''));
  }
  if (kind === 'seen') {
    const last = c.conferences[c.conferences.length - 1];
    meta.append(tag(`${Math.max(1, Math.round((last.end - last.start) / 60000))} min`));
  }
  if (meta.childNodes.length) li.append(meta);

  if (c.ask && kind !== 'seen') {
    const ask = el('p', 'bd-ask');
    ask.append(el('strong', null, c.ask.about));
    if (c.ask.note) { ask.append(' '); ask.append(el('q', null, c.ask.note)); }
    li.append(ask);
  }

  if (kind === 'seen') {
    const step = el('p', 'bd-step');
    if (c.step) step.append(el('span', 'muted', 'Next step: '), c.step);
    else if (c.stepPending) step.append(el('span', 'muted', 'Writing their next step…'));
    if (step.childNodes.length) li.append(step);
  }

  const actions = el('div', 'bd-actions');
  if (kind === 'with') {
    actions.append(actionButton('Done', 'btn-primary', 'done', c), actionButton('Back in line', 'btn-ghost', 'back', c));
    if (!c.ask) actions.lastChild.remove();
  } else if (kind === 'asked') {
    // One loud button per screen: the student at the head of the line.
    const head = queueHead === c.seat;
    actions.append(actionButton('Call up', head ? 'btn-primary' : '', 'call', c));
    const clear = actionButton('Handled', 'btn-ghost', 'clear', c);
    clear.title = 'Answered without a conference: take them out of the line';
    actions.append(clear);
  } else if (kind === 'flagged') {
    actions.append(actionButton('Call up', '', 'call', c));
    const talked = actionButton('Talked', 'btn-ghost', 'done', c);
    talked.title = 'You checked in at their desk: record it as a conference';
    actions.append(talked);
  } else if (kind === 'seen') {
    actions.append(actionButton('Call up', 'btn-ghost', 'call', c));
  }
  li.append(actions);
  return li;
}

/** The rest of the room: one dense row each. */
function rosterRow(c) {
  const li = el('li', 'bd-row');
  const who = el('div', 'bd-row-who');
  const head = el('div', 'bd-row-head');
  head.append(el('span', 'bd-row-name', c.name));
  if (stageName(c)) head.append(tag(`${c.stage + 1}. ${stageName(c)}`));
  if (c.mood) head.append(tag(moodLabel[c.mood]));
  const topic = el('div', `bd-row-topic${c.topic ? '' : ' is-missing'}`, c.topic || 'No topic yet');
  topic.title = c.topic || '';
  who.append(head, topic);
  li.append(who);
  const actions = el('span', 'row');
  const talked = actionButton('Talked', 'btn-ghost', 'done', c);
  talked.title = 'You checked in at their desk: record it as a conference';
  actions.append(actionButton('Call up', 'btn-ghost', 'call', c), talked);
  const remove = button('×', 'btn-sm btn-ghost', async () => {
    const yes = await askConfirm({
      title: `Remove ${c.name}?`,
      blurb: 'Use this for a duplicate or someone who left. If their phone is still open it will ask for their name again.',
      confirmLabel: 'Remove',
    });
    if (yes) act('remove', c);
  });
  remove.setAttribute('aria-label', `Remove ${c.name} from the board`);
  actions.append(remove);
  li.append(actions);
  return li;
}

function tickTimers() {
  const target = (state?.meta?.target || row?.settings?.target || 5) * 60000;
  document.querySelectorAll('.bd-timer').forEach((t) => {
    const ms = Date.now() - Number(t.dataset.since);
    t.textContent = clock(ms);
    t.classList.toggle('is-over', ms > target);
  });
}

// -------------------------------------------------------------------- log

function downloadLog(snapshot) {
  const rows = logRows(snapshot.cards, snapshot.meta || board());
  const csv = buildCSV(rows, LOG_HEADERS);
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const slug = (row.title || 'conferences').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const date = new Date(snapshot.meta?.createdAt || row.created_at).toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `conferences-${slug || 'board'}-${date}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('downloadLog').addEventListener('click', () => {
  const snap = lastLog || state;
  if (!snap) { toast('There is no log to download.'); return; }
  downloadLog(snap);
});

$('endBoard').addEventListener('click', async () => {
  if (!state) return;
  const cov = coverage(state.cards);
  const yes = await askConfirm({
    title: 'End conferences?',
    blurb: `The log (${cov.joined} student${cov.joined === 1 ? '' : 's'}, ${cov.talked} talked to) downloads to this computer, and then every name and topic is erased from the server. Students’ phones will say conferences are over.`,
    confirmLabel: 'End and download log',
    danger: false,
  });
  if (!yes) return;
  try {
    const res = await endBoard(boardId);
    showEnded(res.log || state);
  } catch (err) {
    toast(err.message);
  }
});

function showEnded(log) {
  unwatch?.();
  unwatch = null;
  if (log?.cards) {
    lastLog = log;
    downloadLog(log);
  }
  state = null;
  $('lanes').hidden = true;
  $('showJoin').hidden = true;
  $('endBoard').hidden = true;
  $('eraseNote').textContent = '';
  $('downloadLog').hidden = !lastLog;
  $('downloadLog').textContent = 'Download the log again';
  const note = $('endedNote');
  note.replaceChildren(
    lastLog
      ? 'This board has ended. The log was saved to your downloads, and every student has been erased from the server. '
      : 'This board has ended, and every student on it has been erased from the server. ',
    Object.assign(document.createElement('a'), { href: 'dashboard.html', textContent: 'Back to your dashboard' }),
  );
  note.hidden = false;
  document.title = `${row?.title || 'Board'} · ended`;
}

// ------------------------------------------------------------ join screen

$('showJoin').addEventListener('click', async () => {
  const url = joinURL(joinBase(), row.join_code);
  $('projectorTitle').textContent = row.title;
  $('projectorURL').textContent = joinURLPretty(joinBase(), row.join_code);
  $('projectorCode').textContent = row.join_code;
  $('projectorQR').innerHTML = await qrSVG(url, { margin: 1 });
  $('projector').hidden = false;
  $('closeJoin').focus();
  try { await document.documentElement.requestFullscreen?.(); } catch { /* not allowed */ }
});

function closeJoin() {
  $('projector').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  $('showJoin').focus();
}
$('closeJoin').addEventListener('click', closeJoin);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('projector').hidden) closeJoin();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !$('projector').hidden) $('projector').hidden = true;
});
