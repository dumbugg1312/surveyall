/**
 * SurveyAll — instructor dashboard.
 * Decks on top, recent sessions below. Start a session here; present it
 * from the projector; review it afterwards.
 */

import {
  configured, currentUser, signOut, listDecks, createDeck, deleteDeck,
  listSessions, createSession, deleteSession, listQuestions, replaceQuestions,
} from './db.js';
import { getTheme, resolveTheme } from './themes.js';
import { parseDeck, SAMPLE_DECK } from './deck-format.js';

const $ = (id) => document.getElementById(id);
let decks = [];

boot().catch(showFatal);

async function boot() {
  if (!configured) {
    window.location.replace('index.html');
    return;
  }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`index.html?next=${encodeURIComponent(window.location.href)}`);
    return;
  }
  // There is no email address in this system; a username is the whole
  // identity. Admins are marked because only they can reset a colleague's
  // password, and it is worth knowing which account you are in.
  $('who').textContent = user.is_admin ? `${user.username} · admin` : (user.username || '');

  $('signOut').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'index.html?stay=1';
  });
  $('newDeck').addEventListener('click', onNewDeck);
  $('importDeck').addEventListener('click', onImport);

  await Promise.all([loadDecks(), loadSessions()]);
}

// =====================================================================
// Decks
// =====================================================================

async function loadDecks() {
  decks = await listDecks();
  const area = $('deckArea');
  area.textContent = '';

  if (!decks.length) {
    area.append(emptyState(
      'No decks yet',
      'A deck is a set of questions you run in class. Start one from scratch, ' +
      'or paste in the sample to see how it works.',
      [
        button('New deck', 'btn-primary', onNewDeck),
        button('Start from the sample', '', () => onImport(SAMPLE_DECK)),
      ]));
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'deck-grid';

  for (const deck of decks) {
    const theme = getTheme(resolveTheme(deck.theme, deck));
    const card = document.createElement('div');
    card.className = 'deck-card';

    const swatch = document.createElement('div');
    swatch.className = 'deck-swatch';
    swatch.dataset.themeName = theme.name;
    swatch.style.background = theme.tokens['--ground'];
    swatch.style.backgroundImage =
      `linear-gradient(120deg, ${theme.tokens['--accent']}44, transparent 60%)`;
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;gap:.25rem;padding:.5rem;height:100%;align-items:flex-end';
    ['--accent', '--accent-2', '--ink'].forEach((tok, i) => {
      const bar = document.createElement('span');
      bar.style.cssText =
        `flex:1;border-radius:2px;background:${theme.tokens[tok]};height:${[60, 100, 38][i]}%`;
      chips.append(bar);
    });
    swatch.append(chips);

    const title = document.createElement('div');
    title.className = 'deck-title';
    title.textContent = deck.title;

    const meta = document.createElement('div');
    meta.className = 'deck-meta';
    meta.textContent = 'Loading…';
    listQuestions(deck.id).then((qs) => {
      // slides, not questions: a deck's instructions slide is part of it
      meta.textContent = `${qs.length} slide${qs.length === 1 ? '' : 's'} · ${theme.name}`;
    }).catch(() => { meta.textContent = theme.name; });

    const actions = document.createElement('div');
    actions.className = 'deck-actions';
    actions.append(
      button('Edit', '', () => { window.location.href = `edit.html?deck=${deck.id}`; }),
      button('Start session', 'btn-primary', () => onStart(deck)),
      button('Delete', 'btn-ghost btn-sm', async () => {
        if (!confirm(`Delete “${deck.title}” and all its sessions and results?`)) return;
        await deleteDeck(deck.id);
        toast('Deck deleted');
        await Promise.all([loadDecks(), loadSessions()]);
      }),
    );

    card.append(swatch, title, meta, actions);
    grid.append(card);
  }

  area.append(grid);
}

async function onNewDeck() {
  const title = prompt('Name this deck', 'Untitled deck');
  if (title == null) return;
  const deck = await createDeck({ title: title.trim() || 'Untitled deck' });
  window.location.href = `edit.html?deck=${deck.id}`;
}

function onImport(preset) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const h = document.createElement('h2');
  h.textContent = 'Import a deck from text';

  const p = document.createElement('p');
  p.className = 'muted';
  p.style.fontSize = '.86rem';
  p.textContent = 'Paste a deck in SurveyAll\'s plain-text format. This is also how you '
    + 'copy a deck between sections or keep it in version control.';

  const area = document.createElement('textarea');
  area.className = 'text-editor';
  area.value = typeof preset === 'string' ? preset : SAMPLE_DECK;

  const errors = document.createElement('div');
  errors.className = 'parse-errors';

  const row = document.createElement('div');
  row.className = 'row';
  row.style.justifyContent = 'flex-end';
  row.append(
    button('Cancel', '', () => backdrop.remove()),
    button('Import', 'btn-primary', async () => {
      const parsed = parseDeck(area.value);
      errors.textContent = '';
      if (parsed.errors.length) {
        parsed.errors.forEach((e) => {
          const a = document.createElement('div');
          a.className = 'alert alert-error';
          a.textContent = e;
          errors.append(a);
        });
        if (!parsed.questions.length) return;
      }
      const deck = await createDeck({
        title: parsed.title,
        theme: parsed.theme,
        background: parsed.background,
      });
      await replaceQuestions(deck.id, parsed.questions);
      window.location.href = `edit.html?deck=${deck.id}`;
    }),
  );

  modal.append(h, p, area, errors, row);
  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

async function onStart(deck) {
  const questions = await listQuestions(deck.id);
  if (!questions.length) {
    toast('Add a question first');
    window.location.href = `edit.html?deck=${deck.id}`;
    return;
  }
  const label = prompt('Label this session (e.g. "Tue 9am section")',
    new Date().toLocaleDateString());
  if (label == null) return;
  const session = await createSession(deck.id, label.trim(), deck.theme);
  window.location.href = `present.html?session=${session.id}`;
}

// =====================================================================
// Sessions
// =====================================================================

async function loadSessions() {
  const sessions = await listSessions();
  const area = $('sessionArea');
  area.textContent = '';

  if (!sessions.length) {
    area.append(emptyState('No sessions yet',
      'Starting a session creates a join code and QR for your students.', []));
    return;
  }

  const byDeck = new Map(decks.map((d) => [d.id, d]));

  sessions.slice(0, 25).forEach((s) => {
    const row = document.createElement('div');
    row.className = 'session-row';

    const code = document.createElement('span');
    code.className = 'session-code';
    code.textContent = s.join_code;

    const info = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = s.label || byDeck.get(s.deck_id)?.title || 'Session';
    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = `${byDeck.get(s.deck_id)?.title || 'Deck'} · ${
      new Date(s.created_at).toLocaleString()}`;
    info.append(name, meta);

    const chip = document.createElement('span');
    chip.className = `chip ${s.state === 'live' ? 'chip-live' : s.state === 'ended' ? 'chip-ended' : ''}`;
    chip.textContent = s.state;

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.append(
      button('Present', 'btn-sm', () => { window.location.href = `present.html?session=${s.id}`; }),
      button('Results', 'btn-sm', () => { window.location.href = `results.html?session=${s.id}`; }),
      button('×', 'btn-sm btn-ghost', async () => {
        if (!confirm(`Delete session ${s.join_code} and its responses?`)) return;
        await deleteSession(s.id);
        toast('Session deleted');
        loadSessions();
      }),
    );

    row.append(code, info, chip, actions);
    area.append(row);
  });
}

// =====================================================================
// Bits
// =====================================================================

function button(label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls || ''}`.trim();
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function emptyState(title, text, actions) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';
  const h = document.createElement('h3');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  wrap.append(h, p);
  if (actions?.length) {
    const row = document.createElement('div');
    row.className = 'row';
    actions.forEach((a) => row.append(a));
    wrap.append(row);
  }
  return wrap;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200);
}

function showFatal(err) {
  console.error(err);
  const area = $('deckArea');
  if (area) {
    area.textContent = '';
    const a = document.createElement('div');
    a.className = 'alert alert-error';
    a.textContent = err.message || String(err);
    area.append(a);
  }
}
