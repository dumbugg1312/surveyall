/**
 * SurveyAll — instructor dashboard.
 *
 * Two jobs, in this order. Get you back in front of a live room, and make
 * a term's worth of finished sessions worth having kept.
 *
 * The decks at the top are how you start. The archive underneath is what
 * you accumulate, and it is the half that gets more valuable every week
 * instead of less — provided you can still find anything in it. A flat
 * list of join codes and dates cannot tell the class you actually taught
 * from the session nobody joined, so every row here carries what came of
 * it, and the list can be searched, narrowed to one deck, and split by
 * whether anyone answered at all.
 */

import {
  configured, currentUser, signOut, listDecks, createDeck, deleteDeck,
  listSessions, createSession, deleteSession, listQuestions, replaceQuestions,
  adminSummary, changePassword,
} from './db.js';
import { resolveTheme } from './themes.js';
import { parseDeck, SAMPLE_DECK } from './deck-format.js';
import { renderSlide } from './slide-preview.js';
import { icon } from './icons.js';
import { joinBase } from './config.js';
import { joinURL, joinURLPretty } from './logic.js';
import {
  el, button, linkBtn, emptyState, toast, openModal, askText, askConfirm, fmt,
} from './ui.js';

const $ = (id) => document.getElementById(id);

let decks = [];
let sessions = [];

/**
 * Bumped on every reload. A deck's slides are fetched per card, and a
 * reply that lands after a delete would otherwise paint a miniature into
 * a card that no longer exists.
 */
let generation = 0;

/** Archive view state. Never persisted: a filter is not a preference. */
const filters = { text: '', deck: '', yield: 'all' };

/** Sessions listed at once before the tail is folded away. */
const ARCHIVE_PAGE = 40;
let archiveLimit = ARCHIVE_PAGE;

boot().catch(showFatal);

async function boot() {
  if (!configured) {
    window.location.replace('login');
    return;
  }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }
  // There is no email address in this system; a username is the whole
  // identity. Admins are marked because only they can reset a colleague's
  // password, and it is worth knowing which account you are in.
  $('who').textContent = user.is_admin ? `${user.username} · admin` : (user.username || '');
  $('who').addEventListener('click', () => openAccount(user));

  // Only the admin can read the feedback or reset a colleague's
  // password, so only the admin is offered the link. The unread count
  // rides along on the label — the whole point of collecting notes is
  // noticing that they arrived.
  if (user.is_admin) {
    $('adminLink').hidden = false;
    adminSummary()
      .then((s) => {
        if (s.unread_feedback > 0) $('adminLink').textContent = `Admin · ${s.unread_feedback}`;
      })
      // A failed count is not worth a visible error: the link still works.
      .catch(() => {});
  }

  $('signOut').addEventListener('click', async () => {
    await signOut();
    window.location.href = './?stay=1';
  });
  $('newDeck').addEventListener('click', onNewDeck);
  $('importDeck').addEventListener('click', () => onImport());

  wireArchiveControls();
  await refresh();
}

/**
 * Reload both lists together.
 *
 * Decks and sessions are fetched in parallel but rendered after both have
 * landed: a session row names its deck, and rendering it first is how the
 * old dashboard ended up printing the literal word "Deck" for every row.
 */
async function refresh() {
  const gen = ++generation;
  showDeckSkeleton();
  showArchiveSkeleton();

  const [nextDecks, nextSessions] = await Promise.all([listDecks(), listSessions()]);
  if (gen !== generation) return;

  decks = nextDecks || [];
  sessions = nextSessions || [];
  archiveLimit = ARCHIVE_PAGE;

  renderLive();
  renderDecks(gen);
  buildDeckFilter();
  renderArchive();
}

// =====================================================================
// Live now
// =====================================================================

/**
 * A live session is not an archive row. You are standing in front of a
 * room with this deck on the wall behind you, and the only thing you can
 * want from this page is to get back to it.
 */
function renderLive() {
  const area = $('liveArea');
  area.textContent = '';
  area.className = 'live-area';

  const live = sessions.filter((s) => s.state === 'live');
  area.hidden = !live.length;
  if (!live.length) return;

  live.forEach((s) => {
    const deck = deckById(s.deck_id);
    const wrap = el('div', 'live-banner');

    const flag = el('span', 'live-flag');
    flag.append(el('span', 'dot-live'), document.createTextNode('Live now'));

    const code = el('span', 'live-code', s.join_code);
    code.title = 'Join code for this session';

    const info = el('div', 'live-info');
    info.append(
      el('div', 'live-title', s.label || deck?.title || 'Session'),
      el('div', 'live-meta', [
        deck?.title || 'Deck',
        `started ${relTime(s.started_at || s.created_at, { joined: true })}`,
        answerSummary(s) || 'no answers yet',
      ].join(' · ')),
    );

    const actions = el('div', 'live-actions');
    actions.append(
      linkBtn('Resume presenting', 'btn-primary', `present.html?session=${s.id}`),
      linkBtn('Results', '', `results.html?session=${s.id}`),
    );

    wrap.append(flag, code, info, actions);
    area.append(wrap);
  });
}

// =====================================================================
// Decks
// =====================================================================

function showDeckSkeleton() {
  const area = $('deckArea');
  area.textContent = '';
  const grid = el('div', 'deck-grid');
  for (let i = 0; i < 3; i += 1) {
    const card = el('div', 'deck-card');
    card.append(el('div', 'skel skel-preview'));
    const body = el('div', 'deck-body');
    body.append(el('div', 'skel skel-line is-title'), el('div', 'skel skel-line is-meta'));
    card.append(body);
    grid.append(card);
  }
  area.append(grid);
}

function renderDecks(gen) {
  const area = $('deckArea');
  area.textContent = '';
  setCount($('deckCount'), decks.length, 'deck');

  if (!decks.length) {
    area.append(emptyState(
      'No decks yet',
      'A deck is a set of questions you run in class. Every time you run one it '
      + 'is kept here permanently, with its answers, and exports to CSV for free.',
      [
        button('New deck', 'btn-primary', onNewDeck),
        button('Start from the sample', '', () => onImport(SAMPLE_DECK)),
      ]));
    return;
  }

  const grid = el('div', 'deck-grid');
  decks.forEach((deck) => grid.append(deckCard(deck, gen)));
  area.append(grid);
}

function deckCard(deck, gen) {
  const themeRef = resolveTheme(deck.theme, deck);
  const href = `edit.html?deck=${deck.id}`;
  const stats = deckStats(deck.id);

  const card = el('article', 'deck-card');

  // The miniature is drawn by the same renderer as the editor rail and
  // the projector preview, in the deck's own theme — which makes it the
  // fastest way to recognise a deck, and the reason the card leads with
  // a picture rather than a title.
  const shot = el('div', 'deck-shot');
  const preview = document.createElement('a');
  preview.className = 'deck-preview';
  preview.href = href;
  preview.tabIndex = -1;                    // the title link is the real stop
  preview.setAttribute('aria-hidden', 'true');
  shot.append(preview);

  // The code was a label with pointer-events:none — the one string the
  // whole room needs, and it could not be clicked, selected or copied.
  if (deck.join_code) shot.append(joinCodeButton(deck));

  const body = el('div', 'deck-body');
  const title = el('h3', 'deck-title');
  const link = document.createElement('a');
  link.href = href;
  link.textContent = deck.title;
  title.append(link);

  const meta = el('div', 'deck-meta', 'Counting slides…');
  const yieldLine = el('div', 'deck-yield');
  paintDeckYield(yieldLine, deck, stats);
  body.append(title, meta, yieldLine);

  const actions = el('div', 'deck-actions');
  actions.append(
    linkBtn('Edit', 'btn-sm', href),
    button('Start session', 'btn-sm btn-primary', () => onStart(deck)),
    el('span', 'spacer'),
    iconBtn(TRASH_ICON, `Delete ${deck.title}`, 'btn-sm btn-ghost deck-del',
      () => onDeleteDeck(deck)),
  );

  card.append(shot, body, actions);
  paintDeckPreview({ deck, themeRef, preview, meta, stats, gen });
  return card;
}

/**
 * Your own account, in a dialog.
 *
 * Everything this app knows about an instructor is on this one screen:
 * a username, whether they are the admin, and a password. There is no
 * email to change and no profile to fill in, which is the whole point.
 */
async function openAccount(user) {
  let current;
  let next;
  let confirmField;
  let problem;

  const result = await openModal({
    title: 'Your account',
    blurb: `Signed in as ${user.username}${user.is_admin ? ', the admin for this site' : ''}. `
      + 'This app stores your username and a hashed password, and nothing else — '
      + 'no email address, which is also why a forgotten password has to be reset '
      + 'by an admin rather than mailed to you.',
    confirmLabel: 'Change password',
    build(form) {
      const mk = (id, label, hint) => {
        const wrap = el('div', 'field');
        const lab = document.createElement('label');
        lab.htmlFor = id;
        lab.textContent = label;
        const input = document.createElement('input');
        input.type = 'password';
        input.id = id;
        input.autocomplete = id === 'acCurrent' ? 'current-password' : 'new-password';
        wrap.append(lab, input);
        if (hint) wrap.append(el('p', 'field-hint', hint));
        form.append(wrap);
        return input;
      };
      current = mk('acCurrent', 'Current password');
      next = mk('acNext', 'New password',
        'Four characters is enough. A short PIN is fine here: what makes it safe '
        + 'is the sign-in lockout, which slows a guesser down to nothing.');
      confirmField = mk('acConfirm', 'New password again');
      problem = el('p', 'field-error');
      problem.setAttribute('role', 'alert');
      form.append(problem);
      return () => ({ current: current.value, next: next.value, again: confirmField.value });
    },
  });
  if (result == null) return;

  if (!result.next || result.next.length < 4) {
    toast('A new password needs at least four characters');
    return;
  }
  if (result.next !== result.again) {
    // Typed twice precisely because it is masked and short — there is no
    // reset email to fall back on if a typo gets saved.
    toast('The two new passwords do not match');
    return;
  }
  try {
    await changePassword(result.current, result.next);
    toast('Password changed');
  } catch (err) {
    toast(err.message || 'That did not work');
  }
}

/**
 * The join code, as something you can actually use.
 *
 * One click copies the full join link — which is what somebody posting it
 * to a course page or a chat window wants — and the code itself stays
 * selectable for anyone who just wants to read it out.
 */
function joinCodeButton(deck) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'deck-code';
  b.textContent = deck.join_code;
  b.title = `Copy the join link for “${deck.title}”`;
  b.setAttribute('aria-label',
    `Join code ${deck.join_code.split('').join(' ')}. Copy the join link.`);
  b.addEventListener('click', async (e) => {
    e.preventDefault();
    const url = joinURL(joinBase(), deck.join_code);
    try {
      await navigator.clipboard.writeText(url);
      toast('Join link copied');
    } catch {
      // Clipboard access can be refused outright (insecure context, or a
      // policy). Showing the link beats a silent no-op.
      toast(joinURLPretty(joinBase(), deck.join_code));
    }
  });
  return b;
}

/**
 * The line that says whether this deck has ever earned its keep.
 *
 * Answers are summed across runs; people are not. A pseudonym is issued
 * per session and deliberately cannot be traced between them, so "89
 * people" across six runs is a number this system does not know and must
 * not print. Per run it is exact, and that is where it appears.
 */
function paintDeckYield(host, deck, stats) {
  host.textContent = '';
  if (!stats.runs) {
    host.append(el('span', 'muted', 'Never run'));
    return;
  }

  const parts = [`${stats.runs} ${stats.runs === 1 ? 'run' : 'runs'}`];
  parts.push(stats.responses
    ? `${fmt(stats.responses)} ${stats.responses === 1 ? 'answer' : 'answers'}`
    : 'no answers yet');
  parts.push(`last run ${relTime(stats.last, { joined: true })}`);
  host.append(document.createTextNode(parts.join(' · ')));

  // Comparing runs needs at least two runs that produced something.
  if (stats.used >= 2) {
    host.append(document.createTextNode(' · '));
    const cmp = document.createElement('a');
    cmp.className = 'deck-compare';
    cmp.href = `compare.html?deck=${deck.id}`;
    cmp.textContent = 'Compare runs';
    host.append(cmp);
  }
}

/**
 * Fill in the parts of a card that need the deck's slides.
 *
 * The card is already on screen by the time this runs, so the grid never
 * reflows — only the miniature and the slide count arrive late.
 */
async function paintDeckPreview({ deck, themeRef, preview, meta, stats, gen }) {
  preview.append(el('div', 'skel skel-preview'));

  let questions = [];
  let failed = false;
  try {
    questions = await listQuestions(deck.id) || [];
  } catch {
    failed = true;      // a deck we cannot count is still a deck
  }
  if (gen !== generation) return;

  preview.textContent = '';
  renderSlide(preview, questions[0] || { type: null, prompt: deck.title, config: {} },
    deck, themeRef, {
      placeholder: !questions.length,
      join: { code: deck.join_code || '' },
    });

  if (failed) { meta.textContent = ''; return; }
  const n = questions.length;
  meta.textContent = n
    ? `${n} slide${n === 1 ? '' : 's'}`
    : 'Empty. No slides yet';
  if (!n && stats.runs === 0) meta.textContent = 'Empty. Add a question to run it';
}

/** Everything this deck has produced, drawn from the session list. */
function deckStats(deckId) {
  const runs = sessions.filter((s) => s.deck_id === deckId);
  return {
    runs: runs.length,
    used: runs.filter((s) => (s.response_count || 0) > 0).length,
    responses: runs.reduce((n, s) => n + (s.response_count || 0), 0),
    last: runs.reduce((t, s) => Math.max(t, Number(s.created_at) || 0), 0),
  };
}

async function onNewDeck() {
  const title = await askText({
    title: 'New deck',
    blurb: 'You can rename it any time from the editor.',
    label: 'Deck name',
    value: 'Untitled deck',
    confirmLabel: 'Create deck',
  });
  if (title == null) return;
  const deck = await createDeck({ title: title || 'Untitled deck' });
  window.location.href = `edit.html?deck=${deck.id}`;
}

async function onDeleteDeck(deck) {
  const stats = deckStats(deck.id);
  const ok = await askConfirm({
    title: `Delete “${deck.title}”?`,
    blurb: stats.runs
      ? `This also deletes ${stats.runs} session${stats.runs === 1 ? '' : 's'} and `
        + `${fmt(stats.responses)} recorded answer${stats.responses === 1 ? '' : 's'}. `
        + 'Export anything you need first, because this cannot be undone.'
      : 'This deck has never been run, so no results are lost. This cannot be undone.',
    confirmLabel: 'Delete deck',
  });
  if (!ok) return;
  await deleteDeck(deck.id);
  toast('Deck deleted');
  await refresh();
}

/**
 * Import now runs through the shared dialog, so it has the role, the
 * labelling, the focus trap and the Escape key that the hand-rolled
 * backdrop never had.
 */
async function onImport(preset) {
  let area;
  let errors;
  const text = await openModal({
    title: 'Import a deck from text',
    blurb: 'Paste a deck in SurveyAll\'s plain-text format. This is also how you '
      + 'copy a deck between sections or keep it in version control.',
    confirmLabel: 'Import',
    build(form) {
      area = document.createElement('textarea');
      area.className = 'text-editor';
      area.setAttribute('aria-label', 'Deck text');
      area.value = typeof preset === 'string' ? preset : SAMPLE_DECK;
      errors = el('div', 'parse-errors');
      form.append(area, errors);
      return () => area.value;
    },
  });
  if (text == null) return;

  const parsed = parseDeck(text);
  if (parsed.errors.length && !parsed.questions.length) {
    // Nothing usable came out, so say what was wrong and hand the text
    // back rather than dropping it on the floor.
    toast(parsed.errors[0]);
    onImport(text);
    return;
  }
  const deck = await createDeck({
    title: parsed.title,
    theme: parsed.theme,
    background: parsed.background,
  });
  await replaceQuestions(deck.id, parsed.questions);
  window.location.href = `edit.html?deck=${deck.id}`;
}

async function onStart(deck) {
  const questions = await listQuestions(deck.id);
  if (!questions.length) {
    toast('Add a question first');
    window.location.href = `edit.html?deck=${deck.id}`;
    return;
  }
  const label = await askText({
    title: `Start a session of “${deck.title}”`,
    blurb: 'The label is how you will find this session in the archive later, so '
      + 'name the class, not the date. The date is recorded anyway.',
    label: 'Session label',
    value: '',
    placeholder: 'e.g. Tue 9am section',
    confirmLabel: 'Start session',
  });
  if (label == null) return;
  const session = await createSession(deck.id, label, deck.theme);
  window.location.href = `present.html?session=${session.id}`;
}

// =====================================================================
// The archive
// =====================================================================

function wireArchiveControls() {
  const search = $('sessionSearch');
  search.addEventListener('input', () => {
    filters.text = search.value;
    archiveLimit = ARCHIVE_PAGE;
    renderArchive();
  });

  $('deckFilter').addEventListener('change', (e) => {
    filters.deck = e.target.value;
    archiveLimit = ARCHIVE_PAGE;
    renderArchive();
  });

  $('yieldFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    filters.yield = btn.dataset.yield;
    archiveLimit = ARCHIVE_PAGE;
    $('yieldFilter').querySelectorAll('.seg-btn').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    renderArchive();
  });
}

function buildDeckFilter() {
  const sel = $('deckFilter');
  const previous = filters.deck;
  sel.textContent = '';
  sel.append(new Option('All decks', ''));
  // Only decks that were actually run can narrow this list.
  const ran = new Set(sessions.map((s) => s.deck_id));
  decks.filter((d) => ran.has(d.id)).forEach((d) => sel.append(new Option(d.title, d.id)));
  // A deck can disappear under us (deleted in another tab); don't hold a
  // filter that would silently show nothing.
  filters.deck = [...sel.options].some((o) => o.value === previous) ? previous : '';
  sel.value = filters.deck;
}

function showArchiveSkeleton() {
  const area = $('sessionArea');
  area.textContent = '';
  const list = el('div', 'session-list');
  for (let i = 0; i < 3; i += 1) {
    const row = el('div', 'session-row');
    row.append(el('div', 'skel skel-line', ''));
    row.firstChild.style.cssText = 'width:100%;height:1.4rem';
    list.append(row);
  }
  area.append(list);
}

function visibleSessions() {
  const q = filters.text.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filters.deck && s.deck_id !== filters.deck) return false;
    const n = s.response_count || 0;
    if (filters.yield === 'answered' && n === 0) return false;
    if (filters.yield === 'empty' && n > 0) return false;
    if (!q) return true;
    const deck = deckById(s.deck_id);
    return `${s.label || ''} ${s.join_code || ''} ${deck?.title || ''}`
      .toLowerCase().includes(q);
  });
}

function renderArchive() {
  const area = $('sessionArea');
  area.textContent = '';
  setCount($('sessionCount'), sessions.length, 'session');

  // The controls are furniture until there is a pile to work through.
  $('archiveBar').hidden = sessions.length < 5;

  if (!sessions.length) {
    area.append(emptyState('Nothing run yet',
      'Starting a session on a deck creates a join code and a QR for your students. '
      + 'Every run is kept here permanently: the answers, the charts, and a free '
      + 'CSV export, so this list is your record of the term.', []));
    return;
  }

  const shown = visibleSessions();
  if (!shown.length) {
    area.append(emptyState('No sessions match',
      'Nothing here fits the search and filters you have set.',
      [button('Clear filters', '', clearFilters)]));
    return;
  }

  const list = el('div', 'session-list');
  let bucket = null;
  shown.slice(0, archiveLimit).forEach((s) => {
    const next = timeBucket(Number(s.created_at) || 0);
    if (next !== bucket) {
      bucket = next;
      list.append(el('h3', 'archive-group', bucket));
    }
    list.append(sessionRow(s));
  });
  area.append(list);

  if (shown.length > archiveLimit) {
    const more = shown.length - archiveLimit;
    area.append(button(`Show ${more} older session${more === 1 ? '' : 's'}`, 'btn-sm', () => {
      archiveLimit += ARCHIVE_PAGE;
      renderArchive();
    }));
  }

  if (shown.length !== sessions.length) {
    announce(`${shown.length} of ${sessions.length} sessions shown`);
  }
}

function clearFilters() {
  filters.text = '';
  filters.deck = '';
  filters.yield = 'all';
  archiveLimit = ARCHIVE_PAGE;
  $('sessionSearch').value = '';
  $('deckFilter').value = '';
  $('yieldFilter').querySelectorAll('.seg-btn').forEach((b) => {
    const on = b.dataset.yield === 'all';
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  renderArchive();
}

function sessionRow(s) {
  const deck = deckById(s.deck_id);
  const live = s.state === 'live';
  const answers = s.response_count || 0;

  const row = el('article', 'session-row');
  if (live) row.classList.add('is-live');
  if (!answers && !live) row.classList.add('is-empty');

  const code = el('span', 'session-code', s.join_code);

  const info = el('div', 'session-info');
  const name = el('div', 'session-name', s.label || deck?.title || 'Session');
  const when = new Date(Number(s.created_at) || 0);
  const meta = el('div', 'session-meta', [
    deck?.title || 'Deck',
    relTime(s.created_at),
    s.answered_count ? `${s.answered_count} question${s.answered_count === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · '));
  meta.title = when.toLocaleString();
  info.append(name, meta);

  // The numbers are the reason this row is worth keeping. An empty run
  // says so in words rather than printing two zeros, which read as data.
  const stats = el('div', 'session-stats');
  if (answers) {
    stats.append(
      stat(s.participant_count || 0, (s.participant_count === 1) ? 'nickname' : 'nicknames'),
      stat(answers, answers === 1 ? 'answer' : 'answers'),
    );
  } else {
    stats.append(el('span', 'session-none', live ? 'waiting' : 'no answers'));
  }

  const chip = el('span',
    `chip ${live ? 'chip-live' : s.state === 'ended' ? 'chip-ended' : ''}`, stateLabel(s.state));

  const actions = el('div', 'session-actions');
  if (live) actions.append(linkBtn('Present', 'btn-sm btn-primary', `present.html?session=${s.id}`));
  actions.append(linkBtn('Results', 'btn-sm', `results.html?session=${s.id}`));
  actions.append(iconBtn(TRASH_ICON, `Delete session ${s.join_code}`,
    'btn-sm btn-ghost session-del', () => onDeleteSession(s, deck)));

  row.append(code, info, stats, chip, actions);
  return row;
}

/**
 * The chip beside a session says what it is doing, in words a person uses.
 *
 * The stored values are `lobby`, `live` and `ended` — internal names that
 * happen to be readable, which is exactly why they leaked onto the screen.
 * "lobby" in particular appears nowhere else in the product, so a reader
 * meets it once, here, with nothing to attach it to.
 */
const STATE_LABELS = { lobby: 'Not started', live: 'Live', ended: 'Ended' };

function stateLabel(state) {
  return STATE_LABELS[state] || 'Not started';
}

function stat(value, label) {
  const wrap = el('span', 'sstat');
  wrap.append(el('b', null, fmt(value)), document.createTextNode(` ${label}`));
  return wrap;
}

async function onDeleteSession(s, deck) {
  const answers = s.response_count || 0;
  const ok = await askConfirm({
    title: `Delete session ${s.join_code}?`,
    blurb: answers
      ? `${fmt(answers)} recorded answer${answers === 1 ? '' : 's'} from `
        + `${fmt(s.participant_count || 0)} ${s.participant_count === 1 ? 'person' : 'people'} `
        + `will be deleted with it. Export the results first if you need them, `
        + 'this cannot be undone.'
      : 'Nobody answered in this session, so no results are lost.',
    confirmLabel: 'Delete session',
  });
  if (!ok) return;
  await deleteSession(s.id);
  toast('Session deleted');
  await refresh();
}

/** "24 people · 96 answers", or '' when nobody has answered. */
function answerSummary(s) {
  const answers = s.response_count || 0;
  if (!answers) return '';
  const people = s.participant_count || 0;
  return `${fmt(people)} ${people === 1 ? 'person' : 'people'} · `
    + `${fmt(answers)} ${answers === 1 ? 'answer' : 'answers'}`;
}

// =====================================================================
// Time
// =====================================================================

/**
 * Two formatters, because English cares where the phrase lands.
 *
 * Standing alone, "yesterday" and "last month" are what a person says.
 * Inside a longer phrase they collide with the words around them —
 * "last run last month" — so anything composed uses the always-numeric
 * form and reads "last run 1 month ago".
 */
const RTF_ALONE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const RTF_JOINED = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });
const UNITS = [
  ['year', 31536e6], ['month', 2592e6], ['week', 6048e5],
  ['day', 864e5], ['hour', 36e5], ['minute', 6e4],
];

function relTime(ts, { joined = false } = {}) {
  // Two shapes reach this. created_at is an epoch number; started_at and
  // ended_at are ISO strings, which Number() turns into NaN — so a
  // session that was very much running reported "started never" in the
  // live banner, the one place on this page that is about right now.
  const n = typeof ts === 'string' && !/^\d+$/.test(ts)
    ? Date.parse(ts) : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return 'never';
  const rtf = joined ? RTF_JOINED : RTF_ALONE;
  const diff = n - Date.now();
  const abs = Math.abs(diff);
  if (abs < 45e3) return 'just now';
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / 6e4), 'minute');
}

/**
 * The heading a session files itself under.
 *
 * Recent work is grouped by how it is remembered — today, yesterday, this
 * week — and everything older by month, which is how a term reads back.
 */
function timeBucket(ts) {
  const d = new Date(ts);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 864e5;
  if (ts >= midnight) return 'Today';
  if (ts >= midnight - day) return 'Yesterday';
  if (ts >= midnight - 6 * day) return 'Earlier this week';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
    return 'Earlier this month';
  }
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// =====================================================================
// Bits
// =====================================================================

/** A trash can, drawn to match app/icons.js: filled, on a 24×24 grid. */
const TRASH_ICON =
  '<path d="M9.4 2.4h5.2a1.5 1.5 0 0 1 1.5 1.5v.9h4a1.1 1.1 0 1 1 0 2.2H3.9a1.1 1.1 0 1 1 0-2.2h4v-.9a1.5 1.5 0 0 1 1.5-1.5zm.7 2.4h3.8v-.4h-3.8z"/>'
  + '<path d="M5.9 8.8h12.2l-.85 11.4a2.3 2.3 0 0 1-2.29 2.15H9.04a2.3 2.3 0 0 1-2.29-2.15L5.9 8.8z"/>'
  + '<rect x="9.3" y="11.4" width="1.7" height="7.6" rx=".85" fill="var(--surface,#fff)"/>'
  + '<rect x="13" y="11.4" width="1.7" height="7.6" rx=".85" fill="var(--surface,#fff)"/>';

function deckById(id) {
  return decks.find((d) => d.id === id) || null;
}

/**
 * The count pill beside a section heading. The noun matters: on its own
 * the pill announced a bare "7", which is a number with no subject.
 */
function setCount(node, n, noun) {
  if (!node) return;
  node.hidden = !n;
  node.textContent = fmt(n);
  node.setAttribute('aria-label', `${fmt(n)} ${noun}${n === 1 ? '' : 's'}`);
}

function iconBtn(markup, label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls || ''}`.trim();
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(icon(markup));
  b.addEventListener('click', fn);
  return b;
}

function announce(msg) {
  const node = $('srStatus');
  if (node) node.textContent = msg;
}

function showFatal(err) {
  console.error(err);
  const area = $('deckArea');
  if (area) {
    area.textContent = '';
    area.append(el('div', 'alert alert-error', err.message || String(err)));
  }
}
