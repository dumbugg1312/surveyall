/**
 * SurveyAll — the feedback inbox (admin only).
 *
 * Everything the quill button collected, newest first. Two actions per
 * note: mark it handled (it drops out of the default view) or delete it.
 *
 * There is no reply button, and there cannot be: nothing here records a
 * way to reach the sender unless they were signed in, in which case you
 * have a username and can find them the way you would anyway.
 */

import { configured, currentUser, listFeedback, markFeedback, deleteFeedback } from './db.js';

const $ = (id) => document.getElementById(id);

let notes = [];

boot().catch(showFatal);

async function boot() {
  if (!configured) { window.location.replace('login'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }
  // The Worker refuses non-admins outright; this only spares them a page
  // that would render one error and nothing else.
  if (!user.is_admin) { window.location.replace('dashboard.html'); return; }

  $('showHandled').addEventListener('change', render);
  await refresh();
}

async function refresh() {
  notes = await listFeedback();
  render();
}

function render() {
  const area = $('fbArea');
  const showHandled = $('showHandled').checked;
  const visible = notes.filter((n) => showHandled || !n.handled);

  $('fbCount').textContent = String(visible.length);
  $('fbCount').hidden = visible.length === 0;

  area.textContent = '';
  if (!visible.length) {
    const empty = el('div', 'empty-state');
    empty.append(
      el('h3', null, notes.length ? 'Nothing left to read' : 'No feedback yet'),
      el('p', null, notes.length
        ? 'Everything here is marked handled. Tick “Show handled” to read it again.'
        : 'Notes left through the quill button in the corner of the app land here.'),
    );
    area.append(empty);
    return;
  }

  for (const note of visible) area.append(card(note));
}

function card(note) {
  const wrap = el('article', 'card stack');
  if (note.handled) wrap.style.opacity = '.62';

  const head = el('div', 'row row-wrap');
  const when = new Date(note.created_at);
  const meta = el('span', 'muted', when.toLocaleString());
  meta.style.fontSize = '.8rem';
  head.append(meta);

  if (note.from_user) head.append(chip(note.from_user));
  else head.append(chip('signed out', 'chip-ended'));
  if (note.page) head.append(chip(note.page, 'chip-ended'));

  const body = el('p', null, note.body);
  body.style.whiteSpace = 'pre-wrap';

  const actions = el('div', 'row');
  const handled = el('button', 'btn btn-sm', note.handled ? 'Mark unhandled' : 'Mark handled');
  handled.type = 'button';
  handled.addEventListener('click', async () => {
    handled.disabled = true;
    await markFeedback(note.id, !note.handled);
    note.handled = !note.handled;
    render();
  });

  const remove = el('button', 'btn btn-sm btn-danger', 'Delete');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    // Deleting is the one irreversible thing on this page, and the note
    // is the only copy — nothing was emailed anywhere.
    if (!window.confirm('Delete this note? There is no other copy of it.')) return;
    remove.disabled = true;
    await deleteFeedback(note.id);
    notes = notes.filter((n) => n.id !== note.id);
    render();
  });

  actions.append(handled, remove);
  wrap.append(head, body, actions);
  return wrap;
}

function chip(text, cls = '') {
  return el('span', `chip ${cls}`.trim(), text);
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function showFatal(err) {
  console.error(err);
  const area = $('fbArea');
  area.textContent = '';
  area.append(el('div', 'alert alert-error', err.message || String(err)));
}
