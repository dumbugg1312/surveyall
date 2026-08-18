/**
 * SurveyAll — the admin page.
 *
 * Three things the person running this site needs and nobody else does:
 * what people have told you, who has an account, and how much room is
 * left in the database. Everything here is admin-only at the API, so a
 * colleague who guesses the URL gets 403s, not a filled-in page.
 *
 * Note what is deliberately NOT here: any way into another instructor's
 * decks, sessions, or results. Being the admin means you can reset a
 * password and read the feedback. It does not mean you can read a
 * colleague's class — see rule 5 in worker/index.js.
 */

import {
  configured, currentUser,
  listFeedback, markFeedback, deleteFeedback,
  listUsers, adminSummary, resetUserPassword,
} from './db.js';

const $ = (id) => document.getElementById(id);

let notes = [];
let users = [];

boot().catch(showFatal);

async function boot() {
  if (!configured) { window.location.replace('login'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }
  // The Worker refuses non-admins outright; this only spares them a page
  // that would render three errors and nothing else.
  if (!user.is_admin) { window.location.replace('dashboard.html'); return; }

  $('showHandled').addEventListener('change', renderFeedback);

  // Three independent reads, so one slow query doesn't hold up the rest
  // of the page and one failure doesn't blank the other two sections.
  await Promise.all([loadSummary(), loadFeedback(), loadUsers()]);
}

// ------------------------------------------------------------ summary

async function loadSummary() {
  const s = await adminSummary();
  $('statUsers').textContent = num(s.users);
  $('statDecks').textContent = num(s.decks);
  $('statSessions').textContent = num(s.sessions);
  $('statResponses').textContent = num(s.responses);
  $('statUnread').textContent = num(s.unread_feedback);

  // D1's free tier stops at 500 MB, and backdrops are the only thing here
  // that approaches it: they are stored inline rather than in object
  // storage, because R2 wants a card on file.
  const mb = s.background_bytes / 1_000_000;
  $('statStorage').textContent = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(s.background_bytes / 1000)} KB`;
  // The label carries the two facts the number needs to mean anything:
  // how many images that is, and what the ceiling is.
  $('statStorageNote').textContent =
    `${num(s.backgrounds)} backdrop${s.backgrounds === 1 ? '' : 's'} · of 500 MB`;
}

// ----------------------------------------------------------- feedback

async function loadFeedback() {
  notes = await listFeedback();
  renderFeedback();
}

function renderFeedback() {
  const area = $('fbArea');
  const showHandled = $('showHandled').checked;
  const visible = notes.filter((n) => showHandled || !n.handled);

  $('fbCount').textContent = String(visible.length);
  $('fbCount').hidden = visible.length === 0;

  area.textContent = '';
  if (!visible.length) {
    area.append(empty(
      notes.length ? 'Nothing left to read' : 'No feedback yet',
      notes.length
        ? 'Everything here is marked handled. Tick “Show handled” to read it again.'
        : 'Notes left through the quill button in the corner of the app land here.',
    ));
    return;
  }

  for (const note of visible) area.append(noteCard(note));
}

function noteCard(note) {
  const wrap = el('article', 'card stack');
  if (note.handled) wrap.style.opacity = '.62';

  const head = el('div', 'row row-wrap');
  const when = el('span', 'muted', new Date(note.created_at).toLocaleString());
  when.style.fontSize = '.8rem';
  head.append(when);
  head.append(note.from_user ? chip(note.from_user) : chip('signed out', 'chip-ended'));
  if (note.page) head.append(chip(note.page, 'chip-ended'));

  const body = el('p', null, note.body);
  body.style.whiteSpace = 'pre-wrap';

  const actions = el('div', 'row');
  const handled = button(note.handled ? 'Mark unhandled' : 'Mark handled', 'btn btn-sm', async () => {
    await markFeedback(note.id, !note.handled);
    note.handled = !note.handled;
    renderFeedback();
    loadSummary();
  });
  const remove = button('Delete', 'btn btn-sm btn-danger', async () => {
    // The only irreversible thing on this page, and the note is the only
    // copy — nothing was emailed anywhere.
    if (!window.confirm('Delete this note? There is no other copy of it.')) return;
    await deleteFeedback(note.id);
    notes = notes.filter((n) => n.id !== note.id);
    renderFeedback();
    loadSummary();
  });

  actions.append(handled, remove);
  wrap.append(head, body, actions);
  return wrap;
}

// ----------------------------------------------------------- accounts

async function loadUsers() {
  users = await listUsers();
  renderUsers();
}

function renderUsers() {
  const area = $('userArea');
  $('userCount').textContent = String(users.length);
  $('userCount').hidden = users.length === 0;

  area.textContent = '';
  if (!users.length) {
    area.append(empty('No accounts yet', 'The first account created becomes the admin.'));
    return;
  }
  for (const u of users) area.append(userCard(u));
}

function userCard(u) {
  const wrap = el('article', 'card stack');

  const head = el('div', 'row row-wrap');
  const name = el('strong', null, u.username);
  head.append(name);
  if (u.is_admin) head.append(chip('admin'));
  head.append(el('span', 'spacer'));

  const meta = el('span', 'muted',
    `${u.deck_count} deck${u.deck_count === 1 ? '' : 's'} · `
    + `${u.session_count} session${u.session_count === 1 ? '' : 's'} · `
    + `joined ${new Date(u.created_at).toLocaleDateString()} · `
    + (u.last_seen_at ? `last seen ${new Date(u.last_seen_at).toLocaleDateString()}` : 'never signed in'));
  meta.style.fontSize = '.8rem';
  head.append(meta);

  const actions = el('div', 'row row-wrap');
  actions.append(button('Set a new password', 'btn btn-sm', () => resetFlow(u)));
  wrap.append(head, actions);
  return wrap;
}

/**
 * Reset a colleague's password.
 *
 * A prompt() rather than a designed form, deliberately: this runs a
 * handful of times a year, it must not be the thing that goes wrong, and
 * the value is typed once and then spoken out loud to the person
 * standing there. The server enforces the length rule; this only avoids
 * a pointless round trip on an empty box.
 */
async function resetFlow(u) {
  const next = window.prompt(
    `New password for ${u.username}.\n\n`
    + 'Tell it to them in person — it is not emailed anywhere, and you '
    + 'cannot read it back off this page afterwards.',
  );
  if (next == null) return;
  if (!next.trim()) { toast('No password entered — nothing changed.'); return; }

  try {
    await resetUserPassword(u.username, next);
    toast(`${u.username} can sign in with that password now.`);
  } catch (err) {
    toast(err.message || 'That did not work.');
  }
}

// ------------------------------------------------------------- pieces

function empty(title, text) {
  const wrap = el('div', 'empty-state');
  wrap.append(el('h3', null, title), el('p', null, text));
  return wrap;
}

function button(label, cls, fn) {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(); } finally { b.disabled = false; }
  });
  return b;
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

const num = (n) => Number(n || 0).toLocaleString();

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 3200);
}

function showFatal(err) {
  console.error(err);
  const area = $('fbArea');
  area.textContent = '';
  area.append(el('div', 'alert alert-error', err.message || String(err)));
}
