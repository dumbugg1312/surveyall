/**
 * SurveyAll — deck editor.
 *
 * Three panes, the shape every instructor already has muscle memory for:
 * the deck as a strip of slides on the left, the slide you're working on
 * in the middle (what the room sees on top, what you type underneath),
 * and how it all looks on the right — the elements on this slide, the
 * theme, the background. Each of those sections collapses, because four
 * of them do not fit on a laptop at once.
 *
 * The rail is not a list of prompts. Each item is a real miniature of the
 * projected slide, in the deck's own theme, with the instructor's own
 * options in it — because when you are arranging a class you are thinking
 * in slides, not in database rows. Drag to reorder, click to open.
 *
 * Everything saves as you go; the text view round-trips the whole deck
 * through the plain-text format so a deck is never trapped here.
 */

import {
  configured, currentUser, getDeck, updateDeck, listQuestions,
  createQuestion, updateQuestion, deleteQuestion, reorderQuestions,
  replaceQuestions, createSession,
  uploadBackground, listBackgrounds, deleteBackground, pinBackground, regenerateDeckCode,
} from './db.js';
import {
  TYPE_LABELS, TYPE_BLURBS, splitPassage, DEFAULT_JOIN_STEPS, isContentSlide,
  joinURL, joinURLPretty,
  PROMPT_SCALES, DEFAULT_PROMPT_SCALE, promptScale, showSlideLabel, questionNumber,
  PROMPT_ALIGNS, promptAlign,
  defaultConfig, retypeQuestion, clozeParts, claimKey,
} from './logic.js';
import { typeIcon, chartIcon, cloudIcon } from './icons.js';
import { TEMPLATES } from './templates.js';
import {
  THEMES, BACKGROUND_PRESETS, getTheme, applyTheme,
  backgroundStyles, scrimOpacity, CHART_STYLES, CLOUD_STYLES, AUDIENCES,
  resolveTheme, buildCustomTheme, CUSTOM_FONTS, CUSTOM_RADII, auditTheme,
} from './themes.js';
import { ambiencePlan, ambienceLevel } from './ambience.js';
import { prefersReducedMotion } from './motion.js';
import { parseDeck, serialiseDeck } from './deck-format.js';
import {
  SLIDE_TRANSITIONS, normalizeTransition, DEFAULT_TRANSITION,
} from './transitions.js';
import { renderSlide } from './slide-preview.js';
import { openPreview } from './preview-panel.js';
import {
  elementsEditor, mountDecorEditor, clearDecorSelection,
} from './elements-editor.js';
import { qrSVG, qrInk } from './qr.js';
import { joinBase } from './config.js';
import { toast, askConfirm, openModal } from './ui.js';

const $ = (id) => document.getElementById(id);

let deck = null;
let questions = [];
let selectedId = null;
let saveTimer = null;

/**
 * The deck's own join code, encoded once.
 *
 * A deck carries a permanent code, so the instructions slide can show the
 * real thing while you are still writing it — the same code and the same
 * scannable QR the room will see. Encoding is not free, so it happens on
 * load and after a rotation, never per keystroke.
 *
 * `url` is the typed address, in the same shortened form the projector
 * prints, so a step written with %URL% reads here exactly as it will read
 * on the wall.
 */
let joinArt = { code: '', url: '', qrSVG: null };

async function refreshJoinArt() {
  joinArt = {
    code: deck.join_code || '',
    url: deck.join_code ? joinURLPretty(joinBase(), deck.join_code) : '',
    qrSVG: null,
  };
  if (!deck.join_code) return;
  const ink = qrInk(getComputedStyle(document.documentElement)
    .getPropertyValue('--ink').trim());
  joinArt.qrSVG = await qrSVG(joinURL(joinBase(), deck.join_code),
    { dark: ink, light: '#ffffff' });
}

boot().catch((e) => { console.error(e); toast(e.message || String(e)); });

async function boot() {
  if (!configured) { window.location.replace('login'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`login?next=${encodeURIComponent(window.location.href)}`);
    return;
  }

  const deckId = new URLSearchParams(window.location.search).get('deck');
  if (!deckId) { window.location.replace('dashboard.html'); return; }

  deck = await getDeck(deckId);
  questions = await listQuestions(deckId);
  selectedId = questions[0]?.id || null;
  await retireLegacyCodeSteps();

  $('deckTitle').value = deck.title;
  $('deckTitle').addEventListener('input', () => {
    saveDeck({ title: $('deckTitle').value.trim() || 'Untitled deck' });
  });

  // Every appbar handler goes through guard(). "Start session" was the one
  // that didn't, and it is the worst one to lose: a createSession that
  // rejects left an unhandled rejection and a button that looked dead, in
  // front of a room.
  $('addSlide').addEventListener('click', guard(toggleSlideGallery));
  $('addTemplate').addEventListener('click', guard(openTemplatePicker));
  $('textView').addEventListener('click', guard(openTextView));
  $('btnPreview').addEventListener('click', guard(onPreview));
  $('startSession').addEventListener('click', guard(onStart));
  $('btnDesign').addEventListener('click', guard(() => toggleDesign()));
  $('deckCode')?.addEventListener('click', guard(rotateCode));
  wireDesignDrawer();

  await refreshJoinArt();
  paintCodeChip();

  wirePanels();
  wireSlideSettings();
  buildThemeGrid();
  buildMyThemesGrid();
  wireThemeBuilder();
  buildBackgroundGrid();
  wireBackgroundControls();
  await refreshUploads();

  renderRail();
  renderStage();
}

/**
 * The deck's code, in the appbar, always visible while authoring.
 *
 * Clicking it rotates the code. That is the escape hatch for a code that
 * has escaped into the wild — it takes effect immediately, and orphans
 * nothing: every past session keeps its own code and all of its results.
 */
function paintCodeChip() {
  const chip = $('deckCode');
  if (!chip) return;
  chip.hidden = !deck.join_code;
  chip.querySelector('.code-value').textContent = deck.join_code || '';
}

async function rotateCode() {
  const ok = await askConfirm({
    title: 'Give this deck a new join code?',
    blurb: 'Anyone holding the old code or QR — a printed handout, a slide in '
      + 'somebody else\'s deck, a student\'s bookmark — stops being able to '
      + 'join. Past sessions and their results are untouched.',
    confirmLabel: 'New code',
    danger: false,
  });
  if (!ok) return;
  const { join_code: code } = await regenerateDeckCode(deck.id);
  deck.join_code = code;
  await refreshJoinArt();
  paintCodeChip();
  renderRail();
  renderCanvas();
  toast('New code. Reprint anything showing the old one');
}

/**
 * Retire the old placeholder wording from slides written before decks
 * carried their own code.
 *
 * Back then a deck had no code to print, so the shipped default step read
 * "…type the code %CODE%" and the token was swapped in at present time.
 * A deck owns a real code now and the join card prints it, so the token is
 * just a piece of machinery showing through the paint.
 *
 * This only ever rewrites the exact sentence this app shipped — anything
 * the instructor typed themselves is left alone, %CODE% and all, because
 * it still resolves and it is not ours to edit.
 */
const LEGACY_CODE_STEP = 'Or go to the address on screen and type the code %CODE%.';
const LEGACY_CODE_STEP_REPLACEMENT = 'Or go to the address on screen and type in the code.';

async function retireLegacyCodeSteps() {
  const touched = [];
  for (const q of questions) {
    if (q.type !== 'instructions' || !Array.isArray(q.config?.steps)) continue;
    let changed = false;
    q.config.steps = q.config.steps.map((step) => {
      if (String(step).trim() !== LEGACY_CODE_STEP) return step;
      changed = true;
      return LEGACY_CODE_STEP_REPLACEMENT;
    });
    if (changed) touched.push(q);
  }
  for (const q of touched) {
    try { await updateQuestion(q.id, { config: q.config }); } catch { /* shown on next save */ }
  }
}

function selected() {
  return questions.find((q) => q.id === selectedId) || null;
}

function selectSlide(id) {
  if (selectedId === id) return;
  selectedId = id;
  // A selected element belongs to the slide it sits on. Carrying the
  // index across would point at whatever happens to be third on the next
  // slide, which is how you edit the wrong thing without noticing.
  clearDecorSelection();
  renderRail();
  renderStage();
  document.querySelector('.rail-item.is-selected')
    ?.scrollIntoView({ block: 'nearest' });
}

// =====================================================================
// The rail — the deck as slides
// =====================================================================

function renderRail() {
  const list = $('railList');

  // FLIP, keyed on slide id.
  //
  // The rail is rebuilt wholesale on every change, so a drag-reorder, an
  // insert or a delete used to TELEPORT every slide below the edit to its
  // new place. That is the single biggest reason the editor felt cheaper
  // than the projector it produces: the one gesture in the app that is
  // literally about moving something showed no movement at all.
  //
  // offsetTop/offsetLeft rather than getBoundingClientRect: the rail is a
  // scrolling container, and a viewport-relative measurement taken either
  // side of a rebuild silently folds any scroll change into the delta —
  // which is how a FLIP ends up flinging rows across the screen when the
  // list happens to scroll. Layout offsets are immune to that.
  //
  // Both axes are measured because the rail is vertical on a desktop and
  // a horizontal strip under 720px (styles/app.css), and this way neither
  // orientation needs to know about the other.
  const before = new Map();
  if (!prefersReducedMotion()) {
    for (const child of list.children) {
      if (child.dataset?.id) {
        before.set(child.dataset.id, { top: child.offsetTop, left: child.offsetLeft });
      }
    }
  }

  list.textContent = '';
  $('railCount').textContent = questions.length
    ? `${questions.length} slide${questions.length === 1 ? '' : 's'}` : '';

  if (!questions.length) {
    const empty = document.createElement('li');
    empty.className = 'rail-empty';
    empty.textContent = 'No slides yet.';
    list.append(empty);
    return;
  }

  questions.forEach((q, i) => list.append(railItem(q, i)));

  if (!before.size) return;
  for (const child of list.children) {
    const old = before.get(child.dataset?.id);
    if (!old) continue;                       // a slide that was just added
    const dx = old.left - child.offsetLeft;
    const dy = old.top - child.offsetTop;
    // Sub-pixel noise is not movement, and animating it costs a
    // compositor layer per thumbnail for nothing.
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
    child.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 300, easing: 'cubic-bezier(.2, 0, 0, 1)' },
    );
  }
}

function railItem(q, index) {
  const item = document.createElement('li');
  item.className = 'rail-item' + (q.id === selectedId ? ' is-selected' : '');
  item.dataset.id = q.id;
  item.draggable = true;

  const num = document.createElement('span');
  num.className = 'rail-num';
  num.textContent = String(index + 1);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rail-thumb';
  button.setAttribute('aria-current', q.id === selectedId ? 'true' : 'false');
  button.setAttribute('aria-label',
    `Slide ${index + 1}: ${q.prompt || 'untitled'}, ${TYPE_LABELS[q.type] || q.type}`);
  paintThumb(button, q);
  button.addEventListener('click', () => selectSlide(q.id));

  const caption = document.createElement('span');
  caption.className = 'rail-type';
  caption.textContent = TYPE_LABELS[q.type] || q.type;

  const col = document.createElement('div');
  col.className = 'rail-col';
  col.append(button, caption);

  item.append(num, col, railMenu(q, index));
  wireDrag(item, index);
  return item;
}

function paintThumb(host, q) {
  renderSlide(host, q, deck, resolveTheme(deck.theme, deck), { join: joinArt });
}

/** Re-draw only the open slide's thumbnail — called on every keystroke. */
function refreshSelectedThumb() {
  const item = $('railList').querySelector(`.rail-item[data-id="${selectedId}"]`);
  const q = selected();
  if (!item || !q) return;
  paintThumb(item.querySelector('.rail-thumb'), q);
  item.querySelector('.rail-type').textContent = TYPE_LABELS[q.type] || q.type;
}

/** The small ⋯ on a rail item: duplicate, delete, nudge up/down. */
function railMenu(q, index) {
  const wrap = document.createElement('div');
  wrap.className = 'rail-actions';

  const up = iconBtn('↑', 'Move up', async () => { await move(index, -1); }, index === 0);
  const down = iconBtn('↓', 'Move down', async () => { await move(index, 1); },
    index === questions.length - 1);
  const dup = iconBtn('⧉', 'Duplicate', () => duplicateSlide(q));
  const del = iconBtn('×', 'Delete', () => deleteSlide(q));
  del.classList.add('is-danger');

  wrap.append(up, down, dup, del);
  return wrap;
}

function iconBtn(glyph, title, fn, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rail-act';
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = !!disabled;
  b.addEventListener('click', guard((e) => { e.stopPropagation(); return fn(); }));
  return b;
}

/**
 * Wrap an async click handler so a rejection reaches the instructor.
 *
 * An `async` listener returns a promise nobody awaits, so anything that
 * throws inside one — a failed save, a rejected request — vanishes into an
 * unhandled rejection and the button simply appears dead. That is exactly
 * how a broken "add slide" spent an afternoon looking like a UI bug: the
 * server was answering, the answer was an error, and nothing said so.
 * Every handler that talks to the network goes through here.
 */
function guard(fn) {
  return (...args) => {
    try {
      const out = fn(...args);
      if (out && typeof out.then === 'function') {
        out.catch((e) => {
          console.error(e);
          toast(e?.message || 'Something went wrong. See the console.');
        });
      }
      return out;
    } catch (e) {
      console.error(e);
      toast(e?.message || 'Something went wrong. See the console.');
      return undefined;
    }
  };
}

// ------------------------------------------------------------- overlays

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep the keyboard inside an overlay, and give it back afterwards.
 *
 * A layer with a backdrop over it is a layer the mouse cannot leave, so
 * the keyboard must not be able to either — tabbing past the last control
 * of the slide gallery used to walk off into the page behind it, where
 * every click was being swallowed by the backdrop. And whatever opened the
 * overlay gets focus back when it closes, because otherwise focus falls to
 * the top of the document and the instructor has to tab in from the brand
 * link.
 *
 * Returns the release function; call it once, when the overlay closes.
 */
function trapFocus(container, { onEscape, restoreTo } = {}) {
  const previous = restoreTo || document.activeElement;

  const onKey = (e) => {
    if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...container.querySelectorAll(FOCUSABLE)]
      .filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !container.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKey);
  return function release({ restore = true } = {}) {
    container.removeEventListener('keydown', onKey);
    if (restore && previous && document.contains(previous)) previous.focus();
  };
}

let dialogSeq = 0;

/**
 * Ask for one line of text, in the page.
 *
 * Not window.prompt(). A browser offers "prevent this page from creating
 * additional dialogs" after a handful of native prompts, and once an
 * instructor has ticked it — probably during a rehearsal — starting a
 * session simply stops working, with nothing on screen to say why. This
 * also looks like the rest of the editor and can be styled, labelled and
 * trapped like every other overlay here.
 *
 * Resolves with the string, or null if it was dismissed.
 */
function askText({ title, note, label, value = '', placeholder = '', confirmLabel = 'OK' }) {
  return new Promise((resolve) => {
    dialogSeq += 1;
    const titleId = `askTitle${dialogSeq}`;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '28rem';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', titleId);

    const h = document.createElement('h2');
    h.id = titleId;
    h.textContent = title;
    modal.append(h);

    if (note) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.fontSize = '.86rem';
      p.textContent = note;
      modal.append(p);
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    modal.append(field(label, input));

    let done = false;
    let release = null;
    const finish = (out) => {
      if (done) return;
      done = true;
      if (release) release();
      backdrop.remove();
      resolve(out);
    };

    const row = document.createElement('div');
    row.className = 'row';
    row.append(
      spacer(),
      btn('Cancel', '', () => finish(null)),
      btn(confirmLabel, 'btn-primary', () => finish(input.value)),
    );
    modal.append(row);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
    });

    backdrop.append(modal);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) finish(null); });
    document.body.append(backdrop);

    release = trapFocus(modal, { onEscape: () => finish(null) });
    input.focus();
    input.select();
  });
}

// ------------------------------------------------------- drag to reorder

let dragFrom = null;

function wireDrag(item, index) {
  item.addEventListener('dragstart', (e) => {
    dragFrom = index;
    item.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without payload on the transfer.
    e.dataTransfer.setData('text/plain', String(index));
  });
  item.addEventListener('dragend', () => {
    dragFrom = null;
    $('railList').querySelectorAll('.rail-item')
      .forEach((n) => n.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
  });
  item.addEventListener('dragover', (e) => {
    if (dragFrom == null || dragFrom === index) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.classList.toggle('is-drop-before', index < dragFrom);
    item.classList.toggle('is-drop-after', index > dragFrom);
  });
  item.addEventListener('dragleave', () => {
    item.classList.remove('is-drop-before', 'is-drop-after');
  });
  item.addEventListener('drop', guard(async (e) => {
    e.preventDefault();
    const from = dragFrom;
    dragFrom = null;
    if (from == null || from === index) return;
    await moveTo(from, index);
  }));
}

async function moveTo(from, to) {
  // Reordering writes positions straight to the server, so anything still
  // queued against these rows has to land first — otherwise a patch built
  // before the move is applied after it.
  await flushNow();
  const [moved] = questions.splice(from, 1);
  questions.splice(to, 0, moved);
  questions.forEach((q, i) => { q.position = i; });
  await reorderQuestions(deck.id, questions.map((q) => q.id));
  renderRail();
  renderStage();
  touch();
}

async function move(index, step) {
  const target = index + step;
  if (target < 0 || target >= questions.length) return;
  await moveTo(index, target);
}

// =====================================================================
// Adding slides — a gallery of layouts, not a dropdown
// =====================================================================

/**
 * Every slide type, in the order an instructor meets them: the one that
 * gets the room onto their phones first, then the everyday polls, then
 * the specialist ones.
 */
const SLIDE_TYPES = [
  ['instructions', 'How to join, projected. Big QR, big code, your own steps.'],
  ['traffic', 'Green, amber, red. One tap, mid-lecture, as often as you like.'],
  ['mood', 'One icon each. A soft read on how the room walked in.'],
  ['this_or_that', 'Rapid either/ors, answered on instinct. Warms a room up fast.'],
  ['multiple_choice', 'The everyday poll. Bars, donut, opinion or best answer.'],
  ['word_cloud', 'One or two words each; the room writes the headline.'],
  ['open_ended', 'Sentences, shown as cards. Hold them for review if you like.'],
  ['scales', 'Rate several statements 1–5. Good for confidence checks.'],
  ['ranking', 'Put items in order. Counted by Borda points.'],
  ['budget', 'A hundred points to spend across your options. Real trade-offs.'],
  ['probability', 'How likely is it? Everyone commits to a number, then you reveal.'],
  ['spectrum', 'Where do you stand? A slider, drawn as a scatter, never averaged.'],
  ['quiz', 'Timed, scored, with a leaderboard.'],
  ['cloze', 'A sentence with the load-bearing words taken out.'],
  ['matching', 'Terms to their partners. Shows you exactly what gets mixed up.'],
  ['timeline', 'Put events in order. Marked against the real sequence.'],
  ['sample_vote', 'Two or more samples; the room picks the strongest and says why.'],
  ['heatmap', 'A short passage the room highlights or labels.'],
  ['buckets', 'Sort cards into columns. Contested cards sit visibly on the fence.'],
  ['quadrant', 'Two axes, free placement. Agreement is a tight cloud; a split room is two.'],
  ['consensus', 'The room writes claims and votes on them all. Common ground, surfaced.'],
  ['exit_ticket', 'Learned it, still wondering, muddiest point. The classic closer.'],
  ['qa', 'Open floor. Questions from the room, upvoted, moderated by you.'],
];

/**
 * Eleven tiles is one scroll too many when you know what you want. The
 * tabs group them the way an instructor asks for them out loud — not by
 * how the answers are stored, but by what the slide asks the room to do:
 * get on their phones, choose from what you wrote, say it themselves, or
 * show you whether it landed.
 */
const SLIDE_CATEGORIES = [
  ['all', 'All', null],
  ['start', 'Start here', ['instructions']],
  ['pulse', 'Quick pulse', ['traffic', 'mood', 'this_or_that']],
  ['ask', 'Ask the room', ['multiple_choice', 'scales', 'ranking', 'budget',
    'probability', 'spectrum', 'quadrant']],
  ['words', 'In their words', ['word_cloud', 'open_ended', 'consensus',
    'exit_ticket', 'qa']],
  ['check', 'Check understanding', ['quiz', 'cloze', 'matching', 'timeline',
    'sample_vote', 'heatmap', 'buckets']],
];

/** The tab you last used, so a deck built of quizzes stops costing a click. */
let galleryCat = 'all';

function toggleSlideGallery() {
  const open = document.getElementById('slideGallery');
  if (open) { closeSlideGallery(); return; }
  openSlideGallery();
}

/** Release the gallery's focus trap, set while it is open. */
let galleryRelease = null;

function closeSlideGallery() {
  const open = document.getElementById('slideGallery');
  document.getElementById('galleryBackdrop')?.remove();
  open?.remove();
  $('addSlide').setAttribute('aria-expanded', 'false');
  // Focus goes back to the button that opened it — always, and before
  // anything a tile click goes on to do, so a keyboard user is never left
  // standing at the top of the document wondering where they are.
  if (galleryRelease) {
    const release = galleryRelease;
    galleryRelease = null;
    release({ restore: !!open });
  }
}

function openSlideGallery() {
  const backdrop = document.createElement('div');
  backdrop.id = 'galleryBackdrop';
  backdrop.className = 'gallery-backdrop';
  backdrop.addEventListener('click', closeSlideGallery);

  const pop = document.createElement('div');
  pop.id = 'slideGallery';
  pop.className = 'slide-gallery';
  // A popup with a backdrop over the page is a modal, whatever it is
  // anchored to: say so, name it, and keep the keyboard inside it.
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'true');
  pop.setAttribute('aria-labelledby', 'galleryTitle');

  const head = document.createElement('div');
  head.className = 'gallery-head';
  head.append(Object.assign(document.createElement('h3'),
    { id: 'galleryTitle', textContent: 'New slide' }));
  pop.append(head);

  const grid = document.createElement('div');
  grid.className = 'gallery-grid';
  grid.id = 'galleryGrid';
  grid.setAttribute('role', 'tabpanel');

  head.append(buildGalleryTabs(pop, grid));

  SLIDE_TYPES.forEach(([type, blurb]) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'gallery-tile';
    tile.dataset.type = type;

    const thumb = document.createElement('span');
    thumb.className = 'gallery-thumb';
    renderSlide(thumb, { type, prompt: '', config: defaultConfig(type) },
      deck, resolveTheme(deck.theme, deck), { placeholder: true });

    const name = document.createElement('span');
    name.className = 'gallery-name';
    name.textContent = TYPE_LABELS[type] || type;
    const note = document.createElement('span');
    note.className = 'gallery-blurb';
    note.textContent = blurb;

    tile.append(thumb, name, note);
    tile.addEventListener('click', guard(async () => {
      closeSlideGallery();
      await addSlide(type);
    }));
    grid.append(tile);
  });

  pop.append(grid);
  document.body.append(backdrop, pop);
  applyGalleryFilter(pop);
  $('addSlide').setAttribute('aria-expanded', 'true');

  // Anchor to the button, kept inside the viewport. It opens upward — the
  // button lives at the foot of the rail — but on a short window there may
  // be more room below, and a gallery whose tabs have run off the top of
  // the screen is a gallery you cannot steer.
  const r = $('addSlide').getBoundingClientRect();
  const above = r.top - 20;
  const below = window.innerHeight - r.bottom - 20;
  const up = above >= 260 || above >= below;
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12))}px`;
  pop.style.maxHeight = `${Math.max(160, Math.min(480, up ? above : below))}px`;
  if (up) {
    pop.style.top = 'auto';
    pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  } else {
    pop.style.bottom = 'auto';
    pop.style.top = `${r.bottom + 8}px`;
  }
  galleryRelease = trapFocus(pop, {
    restoreTo: $('addSlide'),
    onEscape: closeSlideGallery,
  });
  pop.querySelector('.gallery-tile:not([hidden])')?.focus();
}

/**
 * The tab strip. A real tablist: arrows walk it, only the current tab is
 * a tab stop, and picking one hides tiles rather than rebuilding them —
 * every tile carries a rendered miniature of the slide, and re-rendering
 * eleven of those on a click is a stutter you can see.
 */
function buildGalleryTabs(pop, grid) {
  const bar = document.createElement('div');
  bar.className = 'gallery-tabs';
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Slide categories');

  const pick = (id) => {
    galleryCat = id;
    applyGalleryFilter(pop);
  };

  SLIDE_CATEGORIES.forEach(([id, label]) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'gallery-tab';
    tab.dataset.cat = id;
    tab.id = `galleryTab-${id}`;
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', grid.id);
    tab.addEventListener('click', () => pick(id));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const jump = e.key === 'Home' ? 0 : e.key === 'End' ? SLIDE_CATEGORIES.length - 1 : null;
      if (!step && jump == null) return;
      e.preventDefault();
      const i = SLIDE_CATEGORIES.findIndex(([c]) => c === galleryCat);
      const next = SLIDE_CATEGORIES[jump ?? (i + step + SLIDE_CATEGORIES.length) % SLIDE_CATEGORIES.length][0];
      pick(next);
      bar.querySelector(`[data-cat="${next}"]`).focus();
    });
    bar.append(tab);
  });

  return bar;
}

function applyGalleryFilter(pop) {
  const cat = SLIDE_CATEGORIES.find(([id]) => id === galleryCat) || SLIDE_CATEGORIES[0];
  const [id, , types] = cat;
  galleryCat = id;

  pop.querySelectorAll('.gallery-tab').forEach((tab) => {
    const on = tab.dataset.cat === id;
    tab.setAttribute('aria-selected', String(on));
    tab.classList.toggle('is-active', on);
    tab.tabIndex = on ? 0 : -1;
  });

  pop.querySelectorAll('.gallery-tile').forEach((tile) => {
    tile.hidden = !!types && !types.includes(tile.dataset.type);
  });

  pop.querySelector('.gallery-grid').setAttribute('aria-labelledby', `galleryTab-${id}`);
  pop.scrollTop = 0;
}

/** New slides land after the one you're on, the way a deck actually grows. */
async function addSlide(type) {
  const at = selectedId
    ? questions.findIndex((q) => q.id === selectedId) + 1
    : questions.length;
  const created = await createQuestion(deck.id, {
    type,
    prompt: type === 'instructions' ? 'Join in before we start' : '',
    config: defaultConfig(type),
  }, at);

  questions.splice(at, 0, created);
  questions.forEach((q, i) => { q.position = i; });
  if (at !== questions.length - 1) {
    await reorderQuestions(deck.id, questions.map((q) => q.id));
  }
  selectedId = created.id;
  renderRail();
  renderStage();
  touch();
  // straight into the heading — a new slide always needs one
  $('slideEditor').querySelector('textarea, input[type="text"]')?.focus();
}

async function duplicateSlide(q) {
  const at = questions.findIndex((x) => x.id === q.id) + 1;
  const copy = await createQuestion(deck.id,
    { type: q.type, prompt: q.prompt, config: JSON.parse(JSON.stringify(q.config)) }, at);
  questions.splice(at, 0, copy);
  questions.forEach((x, i) => { x.position = i; });
  await reorderQuestions(deck.id, questions.map((x) => x.id));
  selectedId = copy.id;
  renderRail();
  renderStage();
  touch();
}

async function deleteSlide(q) {
  const at = questions.findIndex((x) => x.id === q.id);
  // "Delete this slide?" told you nothing about which slide or what goes
  // with it. Name it, and say what happens to answers already collected —
  // the dashboard's delete has always been this specific.
  const name = (q.prompt || '').trim();
  const ok = await askConfirm({
    title: name ? `Delete “${truncate(name, 60)}”?` : `Delete slide ${at + 1}?`,
    blurb: `${TYPE_LABELS[q.type] || q.type}, slide ${at + 1} of ${questions.length}. `
      + (isContentSlide(q.type)
        ? 'Nothing was collected on this slide, so no results are lost.'
        : 'Any answers already collected for this question, in every session '
          + 'this deck has been run, are deleted with it. This cannot be undone.'),
    confirmLabel: 'Delete slide',
  });
  if (!ok) return;
  await deleteQuestion(q.id);
  questions = questions.filter((x) => x.id !== q.id);
  await reorderQuestions(deck.id, questions.map((x) => x.id));
  questions.forEach((x, i) => { x.position = i; });
  if (selectedId === q.id) {
    selectedId = (questions[at] || questions[at - 1] || null)?.id || null;
  }
  renderRail();
  renderStage();
  touch();
}

// =====================================================================
// The stage — canvas on top, the slide's own editor underneath
// =====================================================================

function renderStage() {
  renderCanvas();
  renderSlideEditor();
  renderElementsPanel();
  describeSlideLabel();
}

function renderCanvas() {
  const host = $('canvas');
  const q = selected();
  const note = $('canvasNote');

  if (!q) {
    host.textContent = '';
    renderSlide(host, { type: null, prompt: deck.title || 'Your deck', config: {} },
      deck, resolveTheme(deck.theme, deck), { placeholder: true, ambience: true });
    note.textContent = '';
    return;
  }

  const index = questions.findIndex((x) => x.id === q.id);
  // The canvas is a preview, so it obeys the same two deck settings the
  // projector does — including hiding the label, or you would be trusting
  // a picture that disagrees with the room.
  host.style.setProperty('--prompt-scale', String(promptScale(deck)));
  const slide = renderSlide(host, q, deck, resolveTheme(deck.theme, deck), {
    // Mirrors present-page.js's kicker exactly, content-slide branch and
    // all. It used to count every slide and say "Slide 3 of 9" where the
    // projector says "Question 3 of 8" — two different nouns and two
    // different denominators for the same slide, because the room is told
    // how many times it will be asked to answer and an instructions slide
    // is not one of those. An instructor could not predict from this
    // canvas what the room would read, which is the one job it has.
    kicker: showSlideLabel(deck) ? slideKicker(q, index) : '',
    join: joinArt,
    ambience: true,
  });
  // Only the big canvas is draggable. The rail draws the same decor and
  // stays a picture — you arrange slides there, not the things on them.
  mountDecorEditor(slide, q, decorCtx(q));
  note.textContent = isContentSlide(q.type)
    ? 'Nothing to answer. This slide just sits on the projector.'
    : 'A sketch of the projected slide. Real results appear when you run it.';
}

function renderSlideEditor() {
  const host = $('slideEditor');
  host.textContent = '';

  const q = selected();
  if (!q) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const h = document.createElement('h3');
    h.textContent = questions.length ? 'Pick a slide' : 'No slides yet';
    const p = document.createElement('p');
    p.textContent = questions.length
      ? 'Choose one on the left to edit it.'
      : 'Most decks open with an Instructions slide so the room can join, '
        + 'then a first question. Use “New slide”, the activity library, '
        + 'or paste a whole deck through the text view.';
    empty.append(h, p);
    if (!questions.length) {
      empty.append(btn('+ Add an instructions slide', 'btn-primary',
        guard(() => addSlide('instructions'))));
    }
    host.append(empty);
    return;
  }

  host.append(slideForm(q));
}

function slideForm(q) {
  const body = document.createElement('div');
  body.className = 'slide-form';

  const head = document.createElement('div');
  head.className = 'form-head';
  head.append(Object.assign(document.createElement('h2'),
    { textContent: TYPE_LABELS[q.type] || q.type }));
  head.append(spacer());
  head.append(btn('Duplicate', 'btn-sm', guard(() => duplicateSlide(q))));
  head.append(btn('Delete', 'btn-sm btn-danger', guard(() => deleteSlide(q))));
  body.append(head);

  // ---- what kind of slide this is ------------------------------------
  body.append(field('Slide type', typePicker(q)));

  // ---- heading / prompt ---------------------------------------------
  body.append(field(
    q.type === 'instructions' ? 'Heading' : 'Question',
    textarea(q.prompt, q.type === 'instructions' ? 'What should the slide say up top?'
      : 'What do you want to ask?', (v) => {
      q.prompt = v;
      save(q, { prompt: v });
    }),
  ));
  body.append(promptSizeField(q));
  body.append(promptAlignField(q));

  // ---- type-specific -------------------------------------------------
  if (q.type === 'instructions') body.append(stepsEditor(q));
  if (q.type === 'multiple_choice' || q.type === 'quiz') {
    body.append(optionsEditor(q, q.type === 'quiz'));
  }
  if (q.type === 'ranking') body.append(listEditor(q, 'items', 'Items to rank'));
  if (q.type === 'scales') {
    body.append(listEditor(q, 'statements', 'Statements'));
    body.append(anchorsEditor(q));
  }
  if (q.type === 'sample_vote') {
    body.append(listEditor(q, 'samples', 'Samples (anonymous, used with permission)'));
  }
  if (q.type === 'heatmap') body.append(passageEditor(q));
  if (q.type === 'traffic') body.append(listEditor(q, 'labels', 'What the three lights mean'));
  if (q.type === 'mood') body.append(moodEditor(q));
  if (q.type === 'this_or_that') body.append(pairsEditor(q, 'This', 'or that'));
  if (q.type === 'matching') body.append(pairsEditor(q, 'Term', 'Its partner'));
  if (q.type === 'budget') body.append(listEditor(q, 'options', 'Things they can fund'));
  if (q.type === 'timeline') body.append(listEditor(q, 'items', 'Events, in the CORRECT order'));
  if (q.type === 'exit_ticket') body.append(listEditor(q, 'prompts', 'The three prompts'));
  if (q.type === 'cloze') body.append(clozeEditor(q));
  if (q.type === 'buckets') body.append(bucketsEditor(q));
  if (q.type === 'quadrant') {
    body.append(listEditor(q, 'items',
      'Things to place (leave empty and everyone places themselves)'));
  }
  if (q.type === 'consensus') body.append(claimsEditor(q));

  // Elements are not here. They live in the design panel on the right,
  // beside the theme and the background — the other three things that
  // decide what the slide LOOKS like, as opposed to what it asks.
  body.append(settingsFor(q));
  return body;
}

/**
 * Question size, directly under the box you type the question into.
 *
 * It is a DECK setting, not a slide one — a room reading a different
 * size on every slide is worse than a room reading one size that is
 * slightly wrong — and it used to sit in the design panel with the
 * theme. But the judgement it asks for is "is THIS question too big",
 * which you can only make against the words, so it belongs next to them.
 * The hint carries the part the position no longer says.
 */
function promptSizeField(q) {
  const s = document.createElement('select');
  // The id the design panel used to own. One slide form exists at a
  // time, so it is still unique — and it lets the label and the hint be
  // attached rather than merely adjacent.
  s.id = 'promptSize';
  s.setAttribute('aria-describedby', 'promptSizeHint');
  Object.entries(PROMPT_SCALES).forEach(([id, scale]) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = scale.name;
    s.append(o);
  });
  s.value = deck.settings?.promptScale || DEFAULT_PROMPT_SCALE;
  // setDeckSetting repaints the rail and the canvas but NOT this form, so
  // the select the pointer is still on survives its own change event.
  s.addEventListener('change', guard(() => setDeckSetting('promptScale', s.value)));

  const wrap = field(q.type === 'instructions' ? 'Heading size' : 'Question size', s);
  wrap.classList.add('field-narrow');
  wrap.querySelector('label').htmlFor = s.id;
  const hint = document.createElement('p');
  hint.id = 'promptSizeHint';
  hint.className = 'field-hint';
  hint.textContent = 'One size for the whole deck — every heading and question in it.';
  wrap.append(hint);
  return wrap;
}

/**
 * Two columns of text, for the types whose content is a list of pairs.
 *
 * Matching's answer key is the row itself — left matches the right beside
 * it — so there is nothing extra to mark. The phone shuffles the right
 * column, which is what keeps the key from being the answer.
 */
function pairsEditor(q, leftLabel, rightLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const head = document.createElement('span');
  head.className = 'label';
  head.textContent = q.type === 'matching'
    ? 'Pairs: each row is a correct match'
    : 'Pairs: one either/or per row';
  wrap.append(head);

  const pairs = Array.isArray(q.config.pairs) ? q.config.pairs : [];

  pairs.forEach((pair, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line pair-line';

    const make = (key, placeholder) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(pair?.[key] ?? '');
      input.placeholder = `${placeholder} ${i + 1}`;
      input.addEventListener('input', () => {
        q.config.pairs[i] = { ...(q.config.pairs[i] || {}), [key]: input.value };
        save(q, { config: q.config });
      });
      return input;
    };

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      q.config.pairs.splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });

    line.append(make('left', leftLabel), make('right', rightLabel), remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add pair', 'btn-sm', () => {
    q.config.pairs = [...pairs, { left: '', right: '' }];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));

  return wrap;
}

/** An emoji and the word for it, so the projector can label the cluster. */
function moodEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const head = document.createElement('span');
  head.className = 'label';
  head.textContent = 'Icons';
  wrap.append(head);

  const icons = Array.isArray(q.config.icons) ? q.config.icons : [];

  icons.forEach((m, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';

    const emoji = document.createElement('input');
    emoji.type = 'text';
    emoji.className = 'emoji-input';
    emoji.value = String(m?.emoji ?? '');
    emoji.maxLength = 4;
    emoji.setAttribute('aria-label', `Icon ${i + 1}`);

    const label = document.createElement('input');
    label.type = 'text';
    label.value = String(m?.label ?? '');
    label.placeholder = 'What it means';

    const sync = () => {
      q.config.icons[i] = { emoji: emoji.value, label: label.value };
      save(q, { config: q.config });
    };
    emoji.addEventListener('input', () => { sync(); renderCanvas(); });
    label.addEventListener('input', sync);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      q.config.icons.splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });

    line.append(emoji, label, remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add icon', 'btn-sm', () => {
    q.config.icons = [...icons, { emoji: '', label: '' }];
    save(q, { config: q.config });
    renderStage();
  }));

  return wrap;
}

/**
 * The cloze sentence: one string, with the answers written inline in
 * [brackets]. The parsed blank count is echoed back live, because the
 * mistake this format invites is an unclosed bracket and the honest way
 * to surface that is to show what actually parsed.
 */
function clozeEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const head = document.createElement('span');
  head.className = 'label';
  head.textContent = 'The sentence';
  wrap.append(head);

  const area = document.createElement('textarea');
  area.className = 'passage-input';
  area.rows = 3;
  area.placeholder = 'The [mitochondrion|mitochondria] is the powerhouse of the [cell].';
  area.value = q.config.text || '';

  const note = document.createElement('p');
  note.className = 'muted';
  note.style.fontSize = '.74rem';

  const sync = () => {
    const blanks = clozeParts(area.value).filter((p) => p.kind === 'blank');
    const keyed = blanks.filter((b) => b.answers.length).length;
    note.textContent = blanks.length === 0
      ? 'Put the answer in [square brackets] to make a blank. Several accepted answers: [colour|color].'
      : `${blanks.length} blank${blanks.length === 1 ? '' : 's'}`
        + (keyed < blanks.length
          ? ` · ${blanks.length - keyed} with no answer inside, which are never marked wrong`
          : ' · all with an answer');
  };

  area.addEventListener('input', () => {
    q.config.text = area.value;
    save(q, { config: q.config });
    sync();
    renderCanvas();
  });
  sync();

  wrap.append(area, note);
  return wrap;
}

/**
 * The Elements section of the design panel.
 *
 * The one per-slide thing in that rail, so unlike Theme and Background it
 * is repainted on every stage render rather than wired once.
 */
function renderElementsPanel() {
  const host = $('elementsHost');
  if (!host) return;
  host.textContent = '';

  const q = selected();
  if (!q) {
    host.append(Object.assign(document.createElement('p'), {
      className: 'decor-empty',
      textContent: 'Open a slide to place something on it.',
    }));
    return;
  }
  host.append(elementsEditor(q, decorCtx(q)));
}

/**
 * Bring the Elements section into view.
 *
 * Called when an element is picked up ON THE CANVAS: its controls are in
 * the right-hand rail now, and clicking a thing whose controls are inside
 * a collapsed section reads as a click that did nothing.
 */
function revealElements() {
  const panel = $('panelElements');
  if (panel) panel.open = true;
  // Below 1080px the rail is a drawer over the stage, and a tap outside
  // it closes it again — including the very tap that selected the
  // element. Opening it there would flicker shut, so only the wide
  // layout pulls the whole panel back.
  if (window.matchMedia('(max-width: 1080px)').matches) return;
  if ($('editorShell').classList.contains('design-hidden')) toggleDesign(false);
}

/**
 * Which sections of the design panel are open, remembered.
 *
 * Per browser rather than per deck: it is a statement about how much of
 * the rail fits on THIS screen, not about the deck being edited.
 */
const PANELS_KEY = 'surveyall:panels';

function wirePanels() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem(PANELS_KEY)); } catch { /* blocked */ }
  // A hand-edited or half-written value is a number or a string as often
  // as it is nothing, and `5[key] = true` fails silently rather than
  // loudly — so anything that is not a plain object starts over.
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};

  document.querySelectorAll('#designPanel details.panel').forEach((panel) => {
    const key = panel.dataset.panel;
    if (!key) return;
    if (typeof state[key] === 'boolean') panel.open = state[key];
    panel.addEventListener('toggle', () => {
      state[key] = panel.open;
      try { localStorage.setItem(PANELS_KEY, JSON.stringify(state)); } catch { /* full */ }
    });
  });
}

/**
 * What the elements editor needs from the page: save the slide, redraw,
 * and — when the canvas is what did the selecting — show the controls.
 *
 * `quiet` is for changes that only move the selection — nothing about
 * the deck changed, so there is nothing to write and nothing to tell the
 * dashboard about; repainting is the whole job.
 */
function decorCtx(q) {
  return {
    onChange(opts = {}) {
      if (!opts.quiet) save(q, { config: q.config });
      renderStage();
      refreshSelectedThumb();
    },
    onReveal: revealElements,
  };
}

// =====================================================================
// Type picker
// =====================================================================

/**
 * The slide's type, as a control rather than as a heading.
 *
 * A real <select> under a painted surface, not a div pretending to be
 * one: it gets the platform's keyboard handling, its type-ahead and its
 * native menu on a phone for free, and the icon and chevron are drawn
 * behind it. The alternative — a custom listbox — is a lot of ARIA to
 * get wrong for no gain.
 */
function typePicker(q) {
  const wrap = document.createElement('div');
  wrap.className = 'type-picker';

  const glyph = typeIcon(q.type, 'type-picker-icon');
  const sel = document.createElement('select');
  sel.className = 'type-picker-select';
  sel.setAttribute('aria-label', 'Slide type');

  SLIDE_TYPES.forEach(([type]) => {
    const o = document.createElement('option');
    o.value = type;
    o.textContent = TYPE_LABELS[type] || type;
    sel.append(o);
  });
  sel.value = q.type;

  const chev = document.createElement('span');
  chev.className = 'type-picker-chevron';
  chev.setAttribute('aria-hidden', 'true');
  chev.textContent = '⌄';

  sel.addEventListener('change', guard(async () => {
    const to = sel.value;
    if (to === q.type) return;
    if (!(await changeType(q, to))) sel.value = q.type; // declined — put it back
  }));

  wrap.append(glyph, sel, chev);

  const blurb = document.createElement('p');
  blurb.className = 'type-picker-blurb';
  blurb.textContent = TYPE_BLURBS[q.type] || '';

  const holder = document.createElement('div');
  holder.append(wrap, blurb);
  return holder;
}

/**
 * Retype a slide, having said out loud what that costs.
 *
 * Two different costs, and they are worth separating in the prompt
 * because only one of them is recoverable:
 *
 *   content   options, statements, a passage the new type has no room
 *             for. Gone when this saves.
 *   meaning   answers already collected against this question. They are
 *             stored as payloads and read back through the question's
 *             CURRENT type, so retyping a slide that has been run makes
 *             the old results render as something nobody was asked.
 *
 * The second is why this asks even when nothing is dropped.
 */
async function changeType(q, to) {
  const { config, dropped } = retypeQuestion(q.type, to, q.config);

  const ok = await askConfirm({
    title: `Change this slide to ${TYPE_LABELS[to]}?`,
    blurb: (dropped.length ? `This discards ${listSentence(dropped)}. ` : '')
      + 'Any answers already collected for this slide stay in the database, '
      + 'but they were given to a different question, so results and exports '
      + 'will read them as the new type.',
    confirmLabel: `Change to ${TYPE_LABELS[to].toLowerCase()}`,
    danger: dropped.length > 0,
  });
  if (!ok) return false;

  // Get the debounce out of the way before writing directly.
  //
  // A pending patch holds a *reference* to the config object this is about
  // to replace, and window.confirm blocks straight past the 420ms debounce
  // — so retyping a slide you had just been typing in put two PATCHes in
  // the air at once and whichever landed second won. Losing that race left
  // a row carrying the new type and the old type's config, which no editor
  // branch renders and retypeQuestion cannot repair.
  if (!(await flushNow())) {
    toast('Your last edit has not saved yet. Try the retype again in a moment');
    return false;
  }

  q.type = to;
  q.config = config;
  await updateQuestion(q.id, { type: to, config });
  renderRail();
  renderStage();
  toast(`Now a ${TYPE_LABELS[to].toLowerCase()} slide`);
  return true;
}

/** ['a','b','c'] → 'a, b and c' */
function listSentence(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// =====================================================================
// Per-type editors
// =====================================================================

/**
 * The instructions slide's steps.
 *
 * %CODE% is substituted with the live join code when the slide is
 * projected, so the same deck can be run in every section without editing
 * a number that only exists once a session has started.
 */
function stepsEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = 'Steps';
  wrap.append(l);

  if (!Array.isArray(q.config.steps)) q.config.steps = [...DEFAULT_JOIN_STEPS];
  const steps = q.config.steps;

  steps.forEach((step, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = String(i + 1);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = step;
    input.placeholder = `Step ${i + 1}`;
    input.addEventListener('input', () => {
      q.config.steps[i] = input.value;
      save(q, { config: q.config });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.title = 'Remove step';
    remove.addEventListener('click', () => {
      q.config.steps.splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });
    line.append(num, input, remove);
    wrap.append(line);
  });

  const row = document.createElement('div');
  row.className = 'row row-wrap';
  row.append(btn('+ Add step', 'btn-sm', () => {
    q.config.steps = [...steps, ''];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));
  if (steps.length && steps.join('') !== DEFAULT_JOIN_STEPS.join('')) {
    row.append(btn('Reset to the standard steps', 'btn-sm', () => {
      q.config.steps = [...DEFAULT_JOIN_STEPS];
      save(q, { config: q.config });
      renderStage();
    }));
  }
  wrap.append(row);
  return wrap;
}

function optionsEditor(q, isQuiz) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = isQuiz ? 'Answers (tick the correct one)'
    : q.config.mode === 'best' ? 'Options (tick the most defensible)'
      : 'Options';
  wrap.append(label);

  const options = Array.isArray(q.config.options) ? q.config.options : [];
  const correct = new Set(
    Array.isArray(q.config.correct) ? q.config.correct
      : (typeof q.config.correct === 'number' ? [q.config.correct] : []));

  options.forEach((opt, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = typeof opt === 'string' ? opt : (opt?.label ?? '');
    input.placeholder = `Option ${i + 1}`;
    input.addEventListener('input', () => {
      q.config.options[i] = input.value;
      save(q, { config: q.config });
    });
    line.append(input);

    if (isQuiz || q.config.mark_correct || q.config.mode === 'best') {
      const wrapCheck = document.createElement('label');
      wrapCheck.className = 'opt-correct';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = correct.has(i);
      check.addEventListener('change', () => {
        if (check.checked) correct.add(i); else correct.delete(i);
        q.config.correct = [...correct].sort((a, b) => a - b);
        save(q, { config: q.config });
      });
      wrapCheck.append(check, document.createTextNode('correct'));
      line.append(wrapCheck);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.title = 'Remove option';
    remove.addEventListener('click', () => {
      q.config.options.splice(i, 1);
      q.config.correct = [...correct].filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
      save(q, { config: q.config });
      renderStage();
    });
    line.append(remove);

    wrap.append(line);
  });

  wrap.append(btn('+ Add option', 'btn-sm', () => {
    q.config.options = [...options, ''];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));

  return wrap;
}

function listEditor(q, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  wrap.append(l);

  const items = Array.isArray(q.config[key]) ? q.config[key] : [];

  items.forEach((item, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = typeof item === 'string' ? item : (item?.label ?? '');
    input.placeholder = `${label.replace(/s$/, '')} ${i + 1}`;
    input.addEventListener('input', () => {
      q.config[key][i] = input.value;
      save(q, { config: q.config });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      q.config[key].splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });
    line.append(input, remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add', 'btn-sm', () => {
    q.config[key] = [...items, ''];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));

  return wrap;
}

/** After a re-render, land the caret in the row that was just added. */
function focusLast(scope) {
  const inputs = (scope || $('slideEditor')).querySelectorAll('.opt-line input[type="text"]');
  inputs[inputs.length - 1]?.focus();
}

function settingsFor(q) {
  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  const cfg = q.config;

  const num = (key, label, min, max, dflt) => grid.append(field(label, (() => {
    const i = document.createElement('input');
    i.type = 'number';
    i.min = String(min); i.max = String(max);
    i.value = String(cfg[key] ?? dflt);
    i.addEventListener('input', () => {
      cfg[key] = Number(i.value);
      save(q, { config: cfg });
    });
    return i;
  })()));

  const bool = (key, label) => grid.append(checkline(label, !!cfg[key], (v) => {
    cfg[key] = v;
    save(q, { config: cfg });
    renderStage();
  }));

  const choose = (key, label, options, dflt) => grid.append(field(label, (() => {
    const s = document.createElement('select');
    Object.entries(options).forEach(([value, textLabel]) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = textLabel;
      s.append(o);
    });
    s.value = cfg[key] ?? dflt;
    s.addEventListener('change', () => {
      cfg[key] = s.value;
      save(q, { config: cfg });
      renderStage(); // mode switches show/hide dependent fields
    });
    return s;
  })()));

  const text = (key, label, placeholder) => grid.append(field(label, (() => {
    const i = document.createElement('input');
    i.type = 'text';
    i.placeholder = placeholder || '';
    i.value = cfg[key] ?? '';
    i.addEventListener('input', () => {
      cfg[key] = i.value;
      save(q, { config: cfg });
    });
    return i;
  })()));

  /**
   * A row of pictures instead of a dropdown of words.
   *
   * Worth the extra markup for exactly one control: chart style is a
   * choice between four SHAPES, and the words for them ("Bars",
   * "Columns", "Dot plot") are strictly worse at conveying a shape than
   * a drawing of the shape. Every option is on screen at once, so it is
   * one glance and one click rather than open-read-four-choose.
   *
   * Radio semantics, not buttons: this is one value with four states,
   * and a screen reader should hear it that way. Roving tabindex so the
   * group is one tab stop and the arrow keys move within it, which is
   * what the radiogroup pattern promises.
   */
  const iconRow = (key, label, options, dflt, icons) => {
    const group = document.createElement('div');
    group.className = 'icon-choice';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);

    const entries = Object.entries(options);
    const current = () => (options[cfg[key]] ? cfg[key] : dflt);

    const pick = (value) => {
      cfg[key] = value;
      save(q, { config: cfg });
      [...group.children].forEach((b) => {
        const on = b.dataset.value === value;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
      renderCanvas();
    };

    entries.forEach(([value, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-choice-btn';
      b.dataset.value = value;
      b.setAttribute('role', 'radio');
      const on = value === current();
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-active', on);
      b.tabIndex = on ? 0 : -1;
      b.title = text;
      b.append(icons(value, 'icon-choice-glyph'));
      const name = document.createElement('span');
      name.className = 'icon-choice-label';
      name.textContent = text;
      b.append(name);
      b.addEventListener('click', () => pick(value));
      b.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const i = entries.findIndex(([v]) => v === current());
        const next = entries[(i + step + entries.length) % entries.length][0];
        pick(next);
        group.querySelector(`[data-value="${next}"]`).focus();
      });
      group.append(b);
    });

    // Full width of the settings grid. Squeezed into one 9rem column the
    // glyphs shrink to about 14px, which is the size at which "donut" and
    // "dot plot" stop being distinguishable — and a picture you have to
    // squint at is worse than the word it replaced.
    const wrap = field(label, group);
    wrap.classList.add('field-wide');
    grid.append(wrap);
  };

  /**
   * A percentage that is allowed to be nothing at all.
   *
   * `num` coerces an emptied box to 0, and 0% is a real answer to "how
   * likely is this" — so a question with no known answer needs its own
   * control rather than a number field with a sentinel in it.
   */
  const optionalPct = (key, label) => grid.append(field(label, (() => {
    const i = document.createElement('input');
    i.type = 'number';
    i.min = '0'; i.max = '100';
    i.placeholder = 'no answer';
    i.value = cfg[key] == null || cfg[key] === '' ? '' : String(cfg[key]);
    i.addEventListener('input', () => {
      const raw = i.value.trim();
      cfg[key] = raw === '' ? null : Math.min(100, Math.max(0, Number(raw)));
      save(q, { config: cfg });
      renderCanvas();
    });
    return i;
  })()));

  // like bool, but the unset state reads as `dflt` rather than false
  const bool2 = (key, label, dflt) => grid.append(checkline(label, cfg[key] ?? dflt, (v) => {
    cfg[key] = v;
    save(q, { config: cfg });
    renderStage();
  }));

  /**
   * Headline the count or the percentage.
   *
   * The setting has existed since the charts were written and was
   * reachable only by hand-editing the deck text, which meant the
   * instructors most likely to want it — the ones teaching students whose
   * proportional reasoning is still forming, for whom "18 of us" is a
   * fact and "42%" is a conversion — were the ones least likely to find
   * it. Three states, because "follow the deck" has to be the absence of
   * the key rather than a value stored over it.
   */
  const countsField = () => {
    const s = document.createElement('select');
    const younger = deck.settings?.audience === 'younger';
    const opts = [
      ['', `Deck default — ${younger ? 'counts' : 'percentages'}`],
      ['pct', 'Percentages (42%)'],
      ['count', 'Counts (18)'],
    ];
    for (const [value, text] of opts) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = text;
      s.append(o);
    }
    s.id = 'slideCounts';
    s.value = cfg.show_counts == null ? '' : (cfg.show_counts ? 'count' : 'pct');
    s.addEventListener('change', () => {
      if (!s.value) delete cfg.show_counts;
      else cfg.show_counts = s.value === 'count';
      save(q, { config: cfg });
      renderCanvas();
    });
    const wrap = field('Numbers', s);
    wrap.classList.add('field-wide');
    wrap.querySelector('label').htmlFor = s.id;
    grid.append(wrap);
  };

  /**
   * The sentence that lands with the verdict.
   *
   * Peer discussion plus the instructor's explanation beats either alone
   * (Smith et al. 2011), and the words should arrive with the graphic
   * rather than a slide after it — so it is written here, on the
   * question, and appears under the bars the moment the answer is named.
   * The worker strips it from the phone payload: it is the answer key in
   * sentences.
   */
  const explainField = () => {
    const t = document.createElement('textarea');
    t.id = 'slideExplain';
    t.rows = 2;
    t.setAttribute('aria-describedby', 'slideExplainHint');
    t.placeholder = 'Because a thesis has to be arguable — B is the only one you could disagree with.';
    t.value = cfg.explain ?? '';
    t.addEventListener('input', () => {
      const v = t.value.trim();
      if (v) cfg.explain = t.value;
      else delete cfg.explain;
      save(q, { config: cfg });
    });
    const hint = document.createElement('p');
    hint.id = 'slideExplainHint';
    hint.className = 'field-hint';
    hint.textContent = 'Shown on the projector when you reveal the answer. Never sent to phones.';
    const wrap = field('Why (optional)', t);
    wrap.classList.add('field-wide');
    wrap.querySelector('label').htmlFor = t.id;
    wrap.append(hint);
    grid.append(wrap);
  };

  /**
   * A donut is a part-of-whole picture, and it stops being one somewhere
   * around five slices — past that the thin arcs are read by area, badly,
   * and the legend does all the work. A hint rather than a rule: a
   * six-option donut is the instructor's call, but it should be a call.
   */
  const donutHint = () => {
    const n = (cfg.options || []).length;
    if (cfg.chart !== 'donut' || n <= 5) return;
    // Appended bare rather than through field(): there is nothing here to
    // label, and an empty <label> is a promise to a screen reader that
    // this file does not keep anywhere else.
    const p = document.createElement('p');
    p.className = 'field-hint field-wide';
    p.textContent = `${n} options is a lot for a donut — thin slices are hard to compare. `
      + 'Bars read more accurately.';
    grid.append(p);
  };

  /**
   * How this slide arrives on the projector.
   *
   * The first setting in this file that applies to every slide type, so
   * it is built before the per-type switch rather than inside it.
   *
   * Deliberately NOT the `choose` helper above: `choose` calls
   * renderStage() on change, which tears down and rebuilds the whole
   * slide form — including this <select>, mid-interaction, dropping
   * focus to the body while the menu the instructor just used vanishes.
   * Chart style gets away with it because iconRow only repaints the
   * canvas. Nothing on this screen renders a transition, so this one
   * repaints nothing at all.
   */
  const transitionField = () => {
    const deckId = normalizeTransition(deck.settings?.transition) || DEFAULT_TRANSITION;
    const deckLabel = SLIDE_TRANSITIONS.find((t) => t.id === deckId)?.label || 'None';

    const s = document.createElement('select');
    s.id = 'slideTransition';
    s.setAttribute('aria-describedby', 'slideTransitionHint');
    const inherit = document.createElement('option');
    inherit.value = '';
    inherit.textContent = `Deck default — ${deckLabel}`;
    s.append(inherit);
    for (const t of SLIDE_TRANSITIONS) {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.label;
      s.append(o);
    }
    s.value = normalizeTransition(cfg.transition) || '';

    const hint = document.createElement('p');
    hint.id = 'slideTransitionHint';
    hint.className = 'field-hint';
    const describe = () => {
      const id = s.value || deckId;
      const spec = SLIDE_TRANSITIONS.find((t) => t.id === id);
      hint.textContent = s.value
        ? (spec?.hint || '')
        : `Follows the deck. ${spec?.hint || ''}`.trim();
    };
    describe();

    s.addEventListener('change', () => {
      // "Deck default" has to be the ABSENCE of the key, not an empty
      // string stored in its place: resolveTransition() falls back only
      // on a value it does not recognise, and leaving debris in config
      // means every deck ever opened in this build serialises a setting
      // nobody chose.
      if (s.value) cfg.transition = s.value;
      else delete cfg.transition;
      save(q, { config: cfg });
      describe();
    });

    const wrap = field('Transition', s);
    wrap.classList.add('field-wide');
    wrap.querySelector('label').htmlFor = s.id;
    wrap.append(hint);
    grid.append(wrap);
  };
  transitionField();

  switch (q.type) {
    case 'instructions':
      bool2('show_join', 'Show the QR code and join code', true);
      text('note', 'Small print (optional)', 'Phones on silent, please');
      break;
    case 'multiple_choice':
      choose('mode', 'Question mode', {
        opinion: 'Opinion: no key, the split is the point',
        best: 'Best answer: mark the most defensible below',
      }, 'opinion');
      bool('multiple', 'Allow several answers');
      if (cfg.multiple) num('max_choices', 'Max choices', 1, 20, (cfg.options || []).length);
      bool('confidence', 'Ask “how sure are you?”');
      iconRow('chart', 'Chart', CHART_STYLES, 'bars', chartIcon);
      donutHint();
      countsField();
      if (cfg.mode === 'best') explainField();
      break;
    case 'quiz':
      num('time', 'Seconds to answer', 5, 300, 20);
      choose('scoring', 'Scoring', { time: 'Faster = more points', fixed: 'Flat points' }, 'time');
      bool('confidence', 'Ask “how sure are you?”');
      // quiz results go through renderChoice too, so the same four
      // shapes are available — this was simply never wired up
      iconRow('chart', 'Chart', CHART_STYLES, 'bars', chartIcon);
      donutHint();
      countsField();
      explainField();
      break;
    case 'word_cloud':
      num('max_words', 'Words per person', 1, 10, 1);
      num('max_length', 'Max characters', 5, 60, 25);
      bool('hold', 'Hold answers for review before they show');
      iconRow('chart', 'Chart', CLOUD_STYLES, 'cloud', cloudIcon);
      break;
    case 'open_ended':
      num('max_length', 'Max characters', 20, 1000, 200);
      bool('hold', 'Hold answers for review before they show');
      break;
    case 'scales':
      num('min', 'Lowest', 0, 10, 1);
      num('max', 'Highest', 2, 100, 5);
      bool('allow_skip', 'Allow skipping');
      break;
    case 'ranking':
      bool('allow_partial', 'Allow ranking only some');
      break;
    case 'spectrum':
      text('left_label', 'Left end label', 'Disagree');
      text('right_label', 'Right end label', 'Agree');
      bool('corners', 'Show four-corners counts');
      bool('confidence', 'Ask “how sure are you?”');
      break;
    case 'sample_vote':
      bool2('allow_rationale', 'Ask for a one-line “why”', true);
      bool('confidence', 'Ask “how sure are you?”');
      break;
    case 'heatmap':
      choose('mode', 'Mode', {
        highlight: 'Highlight: tap the sentence(s)',
        classify: 'Classify: label the parts',
      }, 'highlight');
      if (cfg.mode === 'classify') {
        if (!Array.isArray(cfg.labels) || !cfg.labels.length) {
          cfg.labels = ['claim', 'evidence', 'warrant'];
        }
        grid.append(field('Labels (comma-separated)', (() => {
          const i = document.createElement('input');
          i.type = 'text';
          i.value = cfg.labels.join(', ');
          i.placeholder = 'claim, evidence, warrant';
          i.addEventListener('input', () => {
            cfg.labels = i.value.split(',').map((s) => s.trim()).filter(Boolean);
            save(q, { config: cfg });
          });
          return i;
        })()));
      } else {
        num('max_picks', 'Sentences each person may pick', 1, 5, 1);
      }
      break;
    case 'this_or_that':
      bool('allow_skip', 'Allow skipping any they can’t call');
      break;
    case 'budget':
      num('total', 'Points to spend', 10, 1000, 100);
      bool('confidence', 'Ask “how sure are you?”');
      break;
    case 'probability':
      optionalPct('truth', 'The actual answer (optional)');
      bool('confidence', 'Ask “how sure are you?”');
      break;
    case 'cloze':
      bool('case_sensitive', 'Capital letters have to match');
      break;
    case 'matching':
      bool('allow_partial', 'Allow leaving some unmatched');
      break;
    case 'timeline':
      bool('allow_partial', 'Allow placing only some');
      break;
    case 'exit_ticket':
      num('max_length', 'Max characters each', 20, 1000, 200);
      break;
    case 'quadrant':
      text('x_left', 'Left pole', 'Disagree');
      text('x_right', 'Right pole', 'Agree');
      text('y_low', 'Bottom pole', 'Matters less');
      text('y_high', 'Top pole', 'Matters a lot');
      break;
    case 'consensus':
      bool2('allow_submissions', 'Let the room add its own claims', true);
      num('max_claims', 'Most claims on screen', 2, 20, 12);
      break;
    default:
      break;
  }

  return grid;
}

/**
 * Card sort: the columns, then the cards — each card with an optional
 * home column. Pick homes and the sort becomes checkable (the reveal
 * flies misfiled cards to where they belong); leave every card on
 * "anywhere" and it is an opinion sort with no right answer on it.
 */
function bucketsEditor(q) {
  const frag = document.createDocumentFragment();
  frag.append(listEditor(q, 'buckets', 'Columns (2–4)'));

  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = 'Cards — give one a home column to make the sort checkable';
  wrap.append(l);

  const cards = Array.isArray(q.config.cards) ? q.config.cards : [];
  const buckets = (Array.isArray(q.config.buckets) ? q.config.buckets : [])
    .map((b) => String(b ?? ''));
  if (!Array.isArray(q.config.correct)) q.config.correct = [];

  cards.forEach((card, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line pair-line';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = typeof card === 'string' ? card : (card?.label ?? '');
    input.placeholder = `Card ${i + 1}`;
    input.addEventListener('input', () => {
      q.config.cards[i] = input.value;
      save(q, { config: q.config });
    });

    const home = document.createElement('select');
    const any = document.createElement('option');
    any.value = '';
    any.textContent = 'Anywhere';
    home.append(any);
    buckets.forEach((b, bi) => {
      const o = document.createElement('option');
      o.value = String(bi);
      o.textContent = b.trim() || `Column ${bi + 1}`;
      home.append(o);
    });
    const cur = q.config.correct[i];
    home.value = Number.isInteger(cur) && cur >= 0 && cur < buckets.length ? String(cur) : '';
    home.addEventListener('change', () => {
      q.config.correct[i] = home.value === '' ? null : Number(home.value);
      save(q, { config: q.config });
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      q.config.cards.splice(i, 1);
      q.config.correct.splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });

    line.append(input, home, remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add card', 'btn-sm', () => {
    q.config.cards = [...cards, ''];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));

  frag.append(wrap);
  return frag;
}

/**
 * Consensus seed claims. Optional — the slide's whole premise is that
 * the room writes them — but seeding one or two sets the register and
 * gives early phones something to vote on while the first student is
 * still typing.
 */
function claimsEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = 'Seed claims (optional — the room adds the rest live)';
  wrap.append(l);

  const claims = Array.isArray(q.config.claims) ? q.config.claims : [];

  claims.forEach((c, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 140;
    input.value = typeof c === 'string' ? c : (c?.text ?? '');
    input.placeholder = `Claim ${i + 1}`;
    input.addEventListener('input', () => {
      const text = input.value;
      q.config.claims[i] = { key: claimKey(text), text };
      save(q, { config: q.config });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'opt-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      q.config.claims.splice(i, 1);
      save(q, { config: q.config });
      renderStage();
    });
    line.append(input, remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add', 'btn-sm', () => {
    q.config.claims = [...claims, { key: claimKey(''), text: '' }];
    save(q, { config: q.config });
    renderStage();
    focusLast(wrap.parentElement);
  }));

  return wrap;
}

/**
 * Calibration anchors (roadmap feature 5): the instructor's own rating
 * per statement, revealed against the class distribution for rubric
 * norming. Stripped from the participant payload server-side.
 */
function anchorsEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = 'Your anchor ratings (optional, revealed after voting closes)';
  wrap.append(l);

  const statements = Array.isArray(q.config.statements) ? q.config.statements : [];
  if (!Array.isArray(q.config.anchors)) q.config.anchors = [];

  statements.forEach((st, i) => {
    const line = document.createElement('div');
    line.className = 'opt-line';
    const name = document.createElement('span');
    name.className = 'anchor-name';
    name.textContent = typeof st === 'string' ? st : String(st?.label ?? '');
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'anchor-input';
    input.min = String(q.config.min ?? 1);
    input.max = String(q.config.max ?? 5);
    input.placeholder = '—';
    input.value = q.config.anchors[i] ?? '';
    input.addEventListener('input', () => {
      const v = Number(input.value);
      q.config.anchors[i] = input.value === '' || !Number.isFinite(v) ? null : v;
      save(q, { config: q.config });
    });
    line.append(name, input);
    wrap.append(line);
  });
  return wrap;
}

/** Passage + live segmentation preview for heatmap questions. */
function passageEditor(q) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = 'Passage. Keep it short; use | to override the sentence splits';
  wrap.append(l);

  const area = document.createElement('textarea');
  area.className = 'passage-input';
  area.rows = 4;
  area.value = q.config.passage || '';
  const preview = document.createElement('div');
  preview.className = 'seg-preview';

  const renderSegs = () => {
    preview.textContent = '';
    const segs = Array.isArray(q.config.segments) ? q.config.segments : [];
    segs.forEach((s, i) => {
      const chip = document.createElement('span');
      chip.className = 'seg-preview-chip';
      chip.textContent = `${i + 1} · ${s.length > 36 ? `${s.slice(0, 36)}…` : s}`;
      preview.append(chip);
    });
    const words = (q.config.passage || '').split(/\s+/).filter(Boolean).length;
    if (words > 120) {
      const warn = document.createElement('span');
      warn.className = 'seg-preview-warn';
      warn.textContent = `${words} words. Close reading works best under ~120`;
      preview.append(warn);
    }
  };

  area.addEventListener('input', () => {
    q.config.passage = area.value;
    q.config.segments = splitPassage(area.value);
    save(q, { config: q.config });
    renderSegs();
  });

  wrap.append(area, preview);
  renderSegs();
  return wrap;
}

// ------------------------------------------------- the activity library

function openTemplatePicker() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal template-modal';

  const h = document.createElement('h3');
  h.textContent = 'Activity library';
  const sub = document.createElement('p');
  sub.className = 'muted';
  sub.style.fontSize = '.8rem';
  sub.textContent = 'Research-backed classroom moves, inserted as ordinary '
    + 'editable questions. Each names its source.';
  modal.append(h, sub);

  const list = document.createElement('div');
  list.className = 'template-list';
  TEMPLATES.forEach((t) => {
    const card = document.createElement('div');
    card.className = 'template-card';
    const name = document.createElement('strong');
    name.textContent = t.name;
    const blurb = document.createElement('p');
    blurb.textContent = t.blurb;
    const source = document.createElement('p');
    source.className = 'template-source';
    source.textContent = t.source;
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'btn btn-sm btn-primary';
    insert.textContent = `Insert ${t.questions.length === 1 ? '1 slide' : `${t.questions.length} slides`}`;
    insert.addEventListener('click', guard(async () => {
      insert.disabled = true;
      for (const tq of t.questions) {
        const created = await createQuestion(deck.id,
          { type: tq.type, prompt: tq.prompt, config: JSON.parse(JSON.stringify(tq.config)) },
          questions.length);
        questions.push(created);
        selectedId = created.id;
      }
      backdrop.remove();
      renderRail();
      renderStage();
      touch();
      toast(`${t.name} added`);
    }));
    card.append(name, blurb, source, insert);
    list.append(card);
  });
  modal.append(list);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.textContent = 'Close';
  close.addEventListener('click', () => backdrop.remove());
  modal.append(close);

  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

// =====================================================================
// Theme + background
// =====================================================================

function toggleDesign(force) {
  const shell = $('editorShell');
  const hidden = typeof force === 'boolean'
    ? (shell.classList.toggle('design-hidden', force), force)
    : shell.classList.toggle('design-hidden');
  $('btnDesign').setAttribute('aria-expanded', hidden ? 'false' : 'true');
  $('btnDesign').classList.toggle('is-active', !hidden);
  if (hidden) $('btnDesign').focus();
  return hidden;
}

/**
 * Below 1080px the design panel stops being a column and becomes a drawer
 * over the stage — and it had no way out: no backdrop, no close button,
 * and the toggle that opened it could be underneath it. Escape and a tap
 * outside now close it, the way every other overlay in the editor does.
 */
function wireDesignDrawer() {
  const shell = $('editorShell');
  const drawer = $('designPanel');
  if (!drawer.querySelector('.side-close')) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'side-close';
    close.textContent = '×';
    close.title = 'Close design panel';
    close.setAttribute('aria-label', 'Close design panel');
    close.addEventListener('click', () => toggleDesign(true));
    drawer.prepend(close);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (shell.classList.contains('design-hidden')) return;
    // Only while it is actually a drawer; on a wide screen it is a column
    // and Escape has nothing to do with it.
    if (!window.matchMedia('(max-width: 1080px)').matches) return;
    if (document.querySelector('.modal-backdrop')) return;   // a dialog is nearer
    e.preventDefault();
    toggleDesign(true);
  });
  shell.addEventListener('click', (e) => {
    if (shell.classList.contains('design-hidden')) return;
    if (!window.matchMedia('(max-width: 1080px)').matches) return;
    if (drawer.contains(e.target) || $('btnDesign').contains(e.target)) return;
    toggleDesign(true);
  });
}

/**
 * A miniature of the actual slide — the theme's own background, display
 * face and chart colours — so choosing a theme is choosing a look for
 * the room, not decoding a colour swatch. applyTheme scopes the tokens
 * onto the tile, so .theme-slide's CSS just uses var(--accent) etc.
 * @param {string|object} themeRef built-in id or resolved custom object
 */
function themeSlide(themeRef) {
  const theme = getTheme(themeRef);
  const slide = document.createElement('div');
  slide.className = 'theme-slide';
  applyTheme(slide, themeRef);
  Object.assign(slide.style, backgroundStyles({ kind: 'theme' }, themeRef));
  slide.style.backgroundColor = theme.tokens['--ground'];

  const name = document.createElement('span');
  name.className = 'theme-slide-name';
  name.textContent = theme.name;

  const bars = document.createElement('div');
  bars.className = 'theme-slide-bars';
  for (let i = 0; i < 4; i += 1) bars.append(document.createElement('span'));

  slide.append(name, bars);
  return slide;
}

/**
 * Write one deck-wide setting.
 *
 * deck.settings also carries the instructor's custom theme, so this
 * merges — replacing the object wholesale would silently drop a theme
 * they built.
 */
function wireSlideSettings() {
  // Question size used to be wired here. It is built per slide now, in
  // promptSizeField(), because it sits under the question it sizes.
  const label = $('showSlideLabel');
  label.checked = showSlideLabel(deck);
  label.addEventListener('change',
    guard(() => setDeckSetting('showSlideLabel', label.checked)));

  // The deck's own alignment. Every slide follows it unless its own
  // control says otherwise, so changing it here rebuilds the slide form
  // too — the override's hint prints the word this setting chose.
  const alignPaint = segBar(
    $('deckAlign'),
    alignOptions(),
    async (value) => {
      await setDeckSetting('promptAlign', value);
      alignPaint();
      renderStage();
    },
    () => promptAlign(deck),
  );

  const trans = $('deckTransition');
  const hint = $('deckTransitionHint');
  for (const t of SLIDE_TRANSITIONS) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.label;
    trans.append(o);
  }
  const describe = () => {
    hint.textContent = SLIDE_TRANSITIONS.find((t) => t.id === trans.value)?.hint || '';
  };
  trans.value = normalizeTransition(deck.settings?.transition) || DEFAULT_TRANSITION;
  describe();
  trans.addEventListener('change', guard(async () => {
    await setDeckSetting('transition', trans.value);
    describe();
    // The per-slide picker's first option reads "Deck default — Push", so
    // it is now printing the wrong word. It only exists on the open
    // slide, and rebuilding the form is safe here because the control the
    // pointer is on is this one, in the other pane.
    renderStage();
  }));

  const audience = $('deckAudience');
  for (const [id, name] of Object.entries(AUDIENCES)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = name;
    audience.append(o);
  }
  audience.value = AUDIENCES[deck.settings?.audience] ? deck.settings.audience : 'standard';
  audience.addEventListener('change', guard(async () => {
    await setDeckSetting('audience', audience.value);
    // The slide form's "Numbers" and "Chart" controls both print the word
    // this setting chose in their "deck default" option, so both are now
    // showing the wrong one. Safe to rebuild: the control under the
    // pointer is this one, in the other pane.
    renderStage();
  }));

  const pace = $('deckPace');
  pace.checked = deck.settings?.pace === true;
  pace.addEventListener('change', guard(() => setDeckSetting('pace', pace.checked)));
}

async function setDeckSetting(key, value) {
  deck.settings = { ...(deck.settings || {}), [key]: value };
  await updateDeck(deck.id, { settings: deck.settings });
  renderRail();
  renderCanvas();
  touch();
}

async function applyDeckTheme(themeId, customTheme) {
  deck.theme = themeId;
  if (customTheme) deck.settings = { ...(deck.settings || {}), customTheme };
  await updateDeck(deck.id, themeId === 'custom'
    ? { theme: 'custom', settings: deck.settings }
    : { theme: themeId });
  buildThemeGrid();
  buildMyThemesGrid();
  buildBackgroundGrid();
  // the new theme may resolve the backdrop differently, or refuse motion
  // outright the way High Contrast does
  describeAmbience();
  renderRail();
  renderCanvas();
  touch();
}

function buildThemeGrid() {
  const grid = $('themeGrid');
  grid.textContent = '';

  Object.entries(THEMES).forEach(([id, theme]) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'theme-tile' + (deck.theme === id ? ' is-active' : '');
    tile.title = theme.blurb;
    tile.append(themeSlide(id));
    tile.addEventListener('click', () => applyDeckTheme(id));
    grid.append(tile);
  });
}

// =====================================================================
// My themes — instructor-built themes. The applied theme travels on the
// deck itself (settings.customTheme → projector, results and phones from
// any machine); this browser additionally keeps a library for reuse
// across decks.
// =====================================================================

const MY_THEMES_KEY = 'surveyall:myThemes';

function loadMyThemes() {
  try { return JSON.parse(localStorage.getItem(MY_THEMES_KEY)) || []; } catch { return []; }
}
function saveMyThemes(list) {
  try { localStorage.setItem(MY_THEMES_KEY, JSON.stringify(list)); } catch { /* full/blocked */ }
}

function buildMyThemesGrid() {
  const grid = $('myThemeGrid');
  grid.textContent = '';
  const list = loadMyThemes();

  // a custom theme applied to this deck on another machine still shows
  const applied = deck.theme === 'custom' ? deck.settings?.customTheme : null;
  if (applied && applied.id && !list.some((t) => t.id === applied.id)) {
    list.unshift(applied);
  }

  $('myThemesEmpty').hidden = list.length > 0;

  list.forEach((t) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const active = deck.theme === 'custom' && deck.settings?.customTheme?.id === t.id;
    tile.className = 'theme-tile' + (active ? ' is-active' : '');
    const ref = { id: 'custom', name: t.name, dark: !!t.dark, tokens: t.tokens, background: t.background };
    const slide = themeSlide(ref);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'theme-edit';
    edit.textContent = '✎';
    edit.title = 'Edit this theme';
    edit.setAttribute('aria-label', `Edit theme ${t.name}`);
    edit.addEventListener('click', (e) => { e.stopPropagation(); openBuilder(t); });
    slide.append(edit);

    tile.append(slide);
    tile.addEventListener('click', () => applyDeckTheme('custom', t));
    grid.append(tile);
  });
}

let editingThemeId = null; // id of the library theme open in the builder

function builderPicks() {
  return {
    id: editingThemeId || undefined,
    name: $('ctName').value.trim() || 'My theme',
    ground: $('ctGround').value,
    ink: $('ctInk').value,
    accent: $('ctAccent').value,
    accent2: $('ctAccent2').value,
    font: $('ctFont').value,
    radius: $('ctRadius').value,
    backdrop: $('ctBackdrop').value,
  };
}

function refreshBuilderPreview() {
  const t = buildCustomTheme(builderPicks());
  const host = $('ctPreviewHost');
  host.textContent = '';
  host.append(themeSlide({ id: 'custom', ...t }));

  // Legibility gate. Most of the palette is derived with a contrast floor
  // already built in, so what survives to here is a pick the derivation
  // cannot rescue — an ink and a ground too close to tell apart. That is
  // not a matter of taste: a deck is projected to a room and archived for
  // students on their own phones, so a theme below AA cannot be saved.
  const problems = auditTheme(t);
  const warn = $('ctWarn');
  warn.hidden = problems.length === 0;
  if (problems.length) {
    const worst = problems[0];
    warn.textContent = `${worst.what} is only ${worst.ratio.toFixed(1)}:1. `
      + `needs ${worst.need}:1 so the back row can read it.`
      + (problems.length > 1 ? ` (${problems.length - 1} more to fix.)` : '');
  } else {
    // clear it, don't just hide it: this element is #ctSave's
    // aria-describedby, and a leftover sentence would keep describing a
    // now-valid theme as broken
    warn.textContent = '';
  }
  $('ctSave').disabled = problems.length > 0;
  return problems;
}

function openBuilder(existing) {
  editingThemeId = existing?.id || null;
  const p = existing?.picks || {};
  $('ctName').value = existing?.name || '';
  $('ctGround').value = p.ground || '#f7f4ee';
  $('ctInk').value = p.ink || '#1c2434';
  $('ctAccent').value = p.accent || '#4a5d23';
  $('ctAccent2').value = p.accent2 || '#b45309';
  $('ctFont').value = p.font || 'inter';
  $('ctRadius').value = p.radius || 'soft';
  $('ctBackdrop').value = p.backdrop || 'none';
  $('ctDelete').hidden = !editingThemeId;
  $('themeBuilder').hidden = false;
  refreshBuilderPreview();
  $('ctName').focus();
}

function closeBuilder() {
  $('themeBuilder').hidden = true;
  editingThemeId = null;
}

function wireThemeBuilder() {
  const fontSel = $('ctFont');
  Object.entries(CUSTOM_FONTS).forEach(([id, f]) => {
    const o = document.createElement('option');
    o.value = id; o.textContent = f.name;
    fontSel.append(o);
  });
  const radiusSel = $('ctRadius');
  Object.entries(CUSTOM_RADII).forEach(([id, r]) => {
    const o = document.createElement('option');
    o.value = id; o.textContent = r.name;
    radiusSel.append(o);
  });
  const backdropSel = $('ctBackdrop');
  const none = document.createElement('option');
  none.value = 'none'; none.textContent = 'None';
  backdropSel.append(none);
  Object.entries(BACKGROUND_PRESETS).forEach(([id, b]) => {
    if (id === 'none' || b.hidden) return;
    const o = document.createElement('option');
    o.value = id; o.textContent = b.name;
    backdropSel.append(o);
  });

  ['ctName', 'ctGround', 'ctInk', 'ctAccent', 'ctAccent2', 'ctFont', 'ctRadius', 'ctBackdrop']
    .forEach((id) => $(id).addEventListener('input', refreshBuilderPreview));

  $('btnNewTheme').addEventListener('click', () => openBuilder(null));
  $('ctCancel').addEventListener('click', closeBuilder);

  $('ctSave').addEventListener('click', async () => {
    // the button is disabled while the palette fails, but a stale click
    // or a scripted one must not slip past the gate either
    if (refreshBuilderPreview().length) return;
    const theme = buildCustomTheme(builderPicks());
    const list = loadMyThemes();
    const i = list.findIndex((t) => t.id === theme.id);
    if (i >= 0) list[i] = theme; else list.push(theme);
    saveMyThemes(list);
    closeBuilder();
    await applyDeckTheme('custom', theme);
  });

  $('ctDelete').addEventListener('click', async () => {
    if (!editingThemeId) return;
    const ok = await askConfirm({
      title: 'Delete this theme?',
      blurb: 'Themes are saved in this browser, not on the server, so this is '
        + 'the only copy. Any deck using it falls back to Lecture Hall.',
      confirmLabel: 'Delete theme',
    });
    if (!ok) return;
    saveMyThemes(loadMyThemes().filter((t) => t.id !== editingThemeId));
    const wasApplied = deck.theme === 'custom'
      && deck.settings?.customTheme?.id === editingThemeId;
    closeBuilder();
    if (wasApplied) await applyDeckTheme('lecture-hall');
    else buildMyThemesGrid();
  });
}

function buildBackgroundGrid() {
  const grid = $('bgGrid');
  grid.textContent = '';
  const theme = getTheme(resolveTheme(deck.theme, deck));

  // Retired presets stay renderable but drop out of the picker — except
  // for the one this deck is already using, which has to stay selectable
  // or the tile rack would show nothing as active.
  const current = deck.background?.kind === 'preset' ? deck.background.id : null;
  const tiles = [
    { kind: 'theme', label: 'Theme' },
    ...Object.keys(BACKGROUND_PRESETS)
      .filter((id) => !BACKGROUND_PRESETS[id].hidden || id === current)
      .map((id) => ({ kind: 'preset', id, label: BACKGROUND_PRESETS[id].name })),
  ];

  tiles.forEach((t) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const bg = t.kind === 'theme' ? { kind: 'theme' } : { kind: 'preset', id: t.id };
    const active = (deck.background?.kind || 'theme') === bg.kind
      && (bg.kind !== 'preset' || deck.background?.id === bg.id);
    tile.className = 'bg-tile' + (active ? ' is-active' : '');
    tile.style.background = theme.tokens['--ground'];

    const styles = backgroundStyles(bg, resolveTheme(deck.theme, deck));
    if (styles.backgroundImage && styles.backgroundImage !== 'none') {
      tile.style.backgroundImage = styles.backgroundImage;
      if (styles.backgroundSize) tile.style.backgroundSize = styles.backgroundSize;
    }

    const label = document.createElement('span');
    label.className = 'bg-tile-label';
    label.textContent = t.label;
    tile.append(label);

    tile.addEventListener('click', () => setBackground(bg));
    grid.append(tile);
  });
}

async function refreshUploads() {
  const grid = $('uploadGrid');
  grid.textContent = '';
  let files = [];
  let quota = null;
  try {
    const res = await listBackgrounds();
    files = res.images;
    quota = res.quota;
  } catch { return; }

  files.forEach((f, i) => {
    // Two controls, not one button with a hidden second meaning. This used
    // to be shift-click, advertised in a `title` — which never shows on a
    // phone or a tablet, is never read out, and cannot be produced from the
    // keyboard at all, since Space and Enter carry no shiftKey. Deleting
    // somebody's uploaded image is not a thing to hide behind a hover hint.
    const tile = document.createElement('div');
    const active = deck.background?.kind === 'image' && deck.background.url === f.url;
    tile.className = 'bg-tile' + (active ? ' is-active' : '');
    tile.style.backgroundImage = `url("${f.url}")`;

    const use = document.createElement('button');
    use.type = 'button';
    use.setAttribute('aria-label',
      `Use uploaded background ${i + 1}${active ? ' (in use)' : ''}`);
    use.title = 'Use this background';
    // .bg-tile's own rules style the frame; this is just the hit area
    // filling it. The styling lives here because styles/app.css belongs to
    // somebody else.
    // outline-offset pulls the focus ring inside the frame: .bg-tile clips
    // its overflow, and a ring drawn on the tile's own edge would be shaved
    // off by that.
    use.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'
      + 'border:0;background:none;padding:0;cursor:pointer;outline-offset:-3px;';
    use.addEventListener('click', () => setBackground({
      kind: 'image', url: f.url,
      dim: Number($('bgDim').value) / 100,
      blur: Number($('bgBlur').value),
    }));

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete uploaded background ${i + 1}`);
    del.title = 'Delete this uploaded image';
    // Always visible, 1.6rem square so it clears the 24px minimum, and on
    // its own light disc so it stays legible over any photograph.
    del.style.cssText = 'position:absolute;top:.2rem;right:.2rem;'
      + 'width:1.6rem;height:1.6rem;display:grid;place-items:center;padding:0;'
      + 'border:1px solid rgba(0,0,0,.28);border-radius:50%;'
      + 'background:rgba(255,255,255,.94);color:#8a1c1c;'
      + 'font-size:1rem;line-height:1;cursor:pointer;';
    del.addEventListener('click', guard(async () => {
      const inUse = deck.background?.kind === 'image' && deck.background?.url === f.url;
      const ok = await askConfirm({
        title: 'Delete this uploaded image?',
        blurb: inUse
          ? 'This deck is using it right now, so its backdrop goes back to the '
            + 'theme\'s own. Any other deck using it loses it too. This cannot '
            + 'be undone — the file is not kept anywhere else.'
          : 'Any deck using it loses its backdrop and falls back to the theme\'s '
            + 'own. This cannot be undone — the file is not kept anywhere else.',
        confirmLabel: 'Delete image',
      });
      if (!ok) return;
      await deleteBackground(f.path);
      await refreshUploads();
    }));

    // The pin, and the reason it exists: an unpinned upload is deleted
    // 30 days after it was uploaded, even if this deck is using it.
    const days = f.pinned ? null : daysLeft(f.expires_at);
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = f.pinned ? '📌' : String(days);
    keep.setAttribute('aria-label', f.pinned
      ? `Kept forever. Click to let this image expire again`
      : `Expires in ${days} day${days === 1 ? '' : 's'}. Click to keep it forever`);
    keep.title = f.pinned
      ? 'Kept. Click to put it back on the 30-day clock.'
      : `Deleted in ${days} day${days === 1 ? '' : 's'}. Click to keep it.`;
    keep.style.cssText = 'position:absolute;top:.2rem;left:.2rem;'
      + 'min-width:1.6rem;height:1.6rem;display:grid;place-items:center;padding:0 .3rem;'
      + 'border:1px solid rgba(0,0,0,.28);border-radius:999px;'
      + `background:${f.pinned ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.82)'};`
      + `color:${!f.pinned && days <= 7 ? '#8a1c1c' : '#1c2434'};`
      + 'font-size:.7rem;font-weight:600;line-height:1;cursor:pointer;';
    keep.addEventListener('click', guard(async () => {
      await pinBackground(f.path, !f.pinned);
      await refreshUploads();
    }));

    tile.append(use, keep, del);
    grid.append(tile);
  });

  warnIfBackgroundExpiring(files);
  showQuotaIfNear(quota);
}

/**
 * The upload quota, shown only when it is nearly reached.
 *
 * There is a 25 MB per-account cap (BACKGROUND_QUOTA_BYTES in the
 * Worker), and it is deliberately invisible until you are at 80% of it.
 * Announcing a limit to everybody makes a tool feel rationed; almost
 * nobody will ever approach this one, and the people who do are the only
 * ones the number helps.
 */
function showQuotaIfNear(quota) {
  const host = $('bgQuotaNote');
  if (!host) return;
  host.hidden = true;
  if (!quota || !Number.isFinite(quota.total)) return;

  const ratio = quota.used / quota.total;
  if (ratio < (quota.warn_at ?? 0.8)) return;

  const mb = (n) => (n / 1_000_000).toFixed(1);
  host.hidden = false;
  host.textContent = ratio >= 1
    ? `Image storage is full: ${mb(quota.used)} MB of ${mb(quota.total)} MB. `
      + 'Delete a backdrop, or unpin one and let it expire, before uploading another.'
    : `Image storage: ${mb(quota.used)} MB of ${mb(quota.total)} MB used.`;
}

/** Whole days until an epoch-ms deadline, never negative. */
function daysLeft(at) {
  return Math.max(0, Math.ceil((Number(at || 0) - Date.now()) / 86_400_000));
}

/**
 * The one case the retention rule can genuinely hurt: this deck's own
 * background is an upload that is about to be deleted.
 *
 * Shown from a week out, with the fix attached — one click pins it. The
 * alternative to warning here is a deck that silently loses its backdrop
 * between the term you built it and the term you teach it again.
 */
function warnIfBackgroundExpiring(files) {
  const host = $('bgExpiryWarn');
  if (!host) return;
  host.textContent = '';
  host.hidden = true;

  if (deck.background?.kind !== 'image') return;
  const mine = files.find((f) => f.url === deck.background.url);
  if (!mine || mine.pinned) return;

  const days = daysLeft(mine.expires_at);
  if (days > 7) return;

  host.hidden = false;
  const text = document.createElement('span');
  text.textContent = days === 0
    ? "This deck's background image is being deleted today."
    : `This deck's background image is deleted in ${days} day${days === 1 ? '' : 's'}.`;
  const fix = document.createElement('button');
  fix.type = 'button';
  fix.className = 'btn btn-sm';
  fix.textContent = 'Keep it';
  fix.addEventListener('click', guard(async () => {
    await pinBackground(mine.path, true);
    await refreshUploads();
  }));
  host.append(text, fix);
}

/**
 * The line above the prompt, exactly as the projector will print it.
 *
 * KEEP IN STEP with the kicker in app/present-page.js. `questionNumber()`
 * is the shared source of truth for the numbering; the two call sites
 * differ only in where they read the deck from.
 */
function slideKicker(q, index) {
  if (isContentSlide(q.type)) {
    return `Slide ${index + 1} of ${questions.length}`;
  }
  const n = questionNumber(questions, q.id);
  return `${TYPE_LABELS[q.type] || q.type} · Question ${n.number} of ${n.total}`;
}

/**
 * Quote the line the open slide will actually print in the Slides panel.
 *
 * The tick used to quote a fixed “Word cloud · Question 1 of 8”, which
 * belongs to no deck anyone has open — you could not read it and tell what
 * was about to leave your own slide. It reads the open slide through the
 * same slideKicker() the canvas does, so the two never disagree.
 */
function describeSlideLabel() {
  const host = $('showSlideLabelText');
  if (!host) return;
  const q = selected();
  if (!q) {
    host.textContent = 'Show the type-and-number line above each question';
    return;
  }
  const index = questions.findIndex((x) => x.id === q.id);
  host.textContent = `Show “${slideKicker(q, index)}” above each question`;
}

/**
 * A row of exclusive buttons. Returns a repaint, because the thing being
 * chosen can also change from somewhere else on the page.
 */
function segBar(host, options, onPick, current) {
  host.textContent = '';
  const buttons = options.map(([value, label, title]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'decor-seg-btn';
    b.textContent = label;
    b.dataset.value = value;
    if (title) b.title = title;
    b.addEventListener('click', guard(() => onPick(value)));
    host.append(b);
    return b;
  });
  const paint = () => {
    const now = current();
    for (const b of buttons) {
      const on = b.dataset.value === now;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  paint();
  return paint;
}

/** [value, label] pairs for the three alignments. */
function alignOptions() {
  return Object.entries(PROMPT_ALIGNS).map(([id, a]) => [id, a.name]);
}

/**
 * Where THIS slide's heading sits, under the box you type it into.
 *
 * Buttons rather than a dropdown: three positions you can see all of, one
 * click apart, which is what every other program that sets type does. The
 * first segment is the deck default and is where every slide starts —
 * absence of the key, not a value standing in for it, so a deck whose
 * default changes carries its untouched slides with it.
 *
 * Two tiers rather than one because the exception is real: a title slide
 * in the middle of a deck of questions usually wants the middle, and
 * making that choice deck-wide would move every question with it.
 */
function promptAlignField(q) {
  const cfg = q.config || (q.config = {});
  const bar = document.createElement('div');
  // Shared with the decor editor's control — see styles/app.css.
  bar.className = 'decor-seg';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-labelledby', 'promptAlignLabel');

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.id = 'promptAlignHint';
  bar.setAttribute('aria-describedby', hint.id);
  const describe = () => {
    hint.textContent = PROMPT_ALIGNS[cfg.align]
      ? 'This slide only.'
      : `Follows the deck — ${PROMPT_ALIGNS[promptAlign(deck)].name.toLowerCase()}. `
        + 'Change the deck’s own setting under Slides, on the right.';
  };

  const paint = segBar(
    bar,
    [['', 'Deck', 'Follow the deck’s alignment'], ...alignOptions()],
    (value) => {
      // "Deck" is the ABSENCE of the key, not an empty string stored in
      // its place — the same rule the per-slide transition follows, and
      // for the same reason: a stored '' would freeze this slide against
      // a later change to the deck default.
      if (value) cfg.align = value;
      else delete cfg.align;
      // save() repaints the canvas and this slide's thumbnail for us.
      save(q, { config: cfg });
      paint();
      describe();
    },
    () => (PROMPT_ALIGNS[cfg.align] ? cfg.align : ''),
  );
  describe();

  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('span');
  label.className = 'label';
  label.id = 'promptAlignLabel';
  label.textContent = q.type === 'instructions' ? 'Heading alignment' : 'Question alignment';
  wrap.append(label, bar, hint);
  return wrap;
}

function wireBackgroundControls() {
  const solid = $('bgSolid');
  solid.value = deck.background?.kind === 'solid' ? deck.background.color : '#1e2a24';
  solid.addEventListener('input', () => setBackground({ kind: 'solid', color: solid.value }));

  const motion = $('bgMotion');
  motion.value = ambienceLevel(deck.background);
  motion.addEventListener('change', () => {
    setBackground({ ...(deck.background || { kind: 'theme' }), motion: motion.value });
  });
  describeAmbience();

  const drop = $('uploadDrop');
  const file = $('bgFile');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    if (e.dataTransfer.files?.[0]) handleUpload(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => {
    if (file.files?.[0]) handleUpload(file.files[0]);
  });

  const dim = $('bgDim');
  const blur = $('bgBlur');
  const sync = () => {
    $('dimVal').textContent = `${dim.value}%`;
    $('blurVal').textContent = `${blur.value}px`;
    if (deck.background?.kind === 'image') {
      setBackground({
        ...deck.background,
        dim: Number(dim.value) / 100,
        blur: Number(blur.value),
      });
    }
  };
  dim.addEventListener('input', sync);
  blur.addEventListener('input', sync);

  if (deck.background?.kind === 'image') {
    dim.value = String(Math.round((deck.background.dim ?? 0.45) * 100));
    blur.value = String(deck.background.blur ?? 0);
    $('dimVal').textContent = `${dim.value}%`;
    $('blurVal').textContent = `${blur.value}px`;
    $('imageControls').hidden = false;
  }
}

async function handleUpload(file) {
  if (!file.type.startsWith('image/')) { toast('That is not an image'); return; }
  if (file.size > 6 * 1024 * 1024) {
    toast('Image is over 6 MB. Please shrink it first');
    return;
  }
  toast('Uploading…');
  try {
    const { url } = await uploadBackground(file);
    await refreshUploads();
    setBackground({ kind: 'image', url, dim: 0.45, blur: 0 });
    toast('Background set');
  } catch (e) {
    toast(e.message || 'Upload failed');
  }
}

/**
 * Say — in the panel, for the background actually chosen — what the
 * ambience setting will do.
 *
 * The *character* of the motion isn't a choice; it's picked from the
 * texture, because drifting blooms across a dot grid and panning a photo
 * are not interchangeable. That's the right default, but a control whose
 * effect you can't predict is worse than one more dropdown, so the panel
 * names what this particular deck will get.
 */
function describeAmbience() {
  const note = $('bgMotionNote');
  const plan = ambiencePlan(deck.background, resolveTheme(deck.theme, deck));

  if (prefersReducedMotion() && ambienceLevel(deck.background) !== 'off') {
    note.textContent = 'Your system asks for reduced motion, so nothing will '
      + 'move on this machine. The setting still travels with the deck.';
    return;
  }

  note.textContent = {
    none: getTheme(resolveTheme(deck.theme, deck)).highContrast
      ? 'High Contrast never animates; it is an accessibility theme.'
      : 'The backdrop holds still.',
    bloom: 'Wide washes of colour swing and breathe across the backdrop, '
      + 'so the hue in a corner is slowly not the hue it was.',
    lattice: 'Light passes across the pattern, brightening one region as '
      + 'another dims, while the pattern itself drifts a few pixels.',
    image: 'A slow push-in across the photograph, two minutes end to end.',
  }[plan.kind] || '';
}

async function setBackground(bg) {
  // Ambience rides on the background record, so picking a new backdrop
  // must not silently switch the motion off — carry the current level
  // across unless the caller is the one setting it.
  const next = { ...bg };
  if (next.motion === undefined) next.motion = ambienceLevel(deck.background);
  if (next.motion === 'off') delete next.motion;

  // Same reference-capture hazard as changeType: a queued deck patch is
  // about to be overtaken by a direct write to the same row. flushNow()
  // does nothing at all when the queue is empty, so dragging the dim
  // slider still costs one request per change, not two.
  await flushNow();

  deck.background = next;
  await updateDeck(deck.id, { background: next });
  $('imageControls').hidden = next.kind !== 'image';
  buildBackgroundGrid();
  describeAmbience();
  await refreshUploads();
  renderRail();
  renderCanvas();
  touch();
}

// =====================================================================
// Text view (import / export)
// =====================================================================

/**
 * The deck as plain text, and the single most destructive control in the
 * app: applying replaces every question row, and every answer ever
 * recorded against one goes with it.
 *
 * It used to ask with a one-line window.confirm and no numbers in it. Now
 * it runs through the shared dialog — role, labelling, focus trap, Escape
 * — and the confirm says what is being replaced and with what.
 */
async function openTextView() {
  let area;
  let errors;
  const text = await openModal({
    title: 'Text view',
    blurb: 'This is your whole deck as plain text. Copy it to keep a backup, '
      + 'paste it into another deck, or edit here and apply.',
    confirmLabel: 'Apply changes',
    cancelLabel: 'Close',
    build(form) {
      area = document.createElement('textarea');
      area.className = 'text-editor';
      area.setAttribute('aria-label', 'Deck text');
      area.value = serialiseDeck(deck, questions);
      errors = document.createElement('div');
      errors.className = 'parse-errors';

      const tools = document.createElement('div');
      tools.className = 'row';
      tools.append(
        btn('Copy', 'btn-sm', async () => {
          try {
            await navigator.clipboard.writeText(area.value);
            toast('Copied');
          } catch { area.select(); }
        }),
        btn('Download', 'btn-sm', () => {
          const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${slug(deck.title)}.txt`;
          a.click();
          URL.revokeObjectURL(a.href);
        }),
      );
      form.append(area, tools, errors);
      return () => area.value;
    },
  });
  if (text == null) return;

  const parsed = parseDeck(text);
  if (parsed.errors.length && !parsed.questions.length) {
    toast(parsed.errors[0]);
    return;
  }

  const ok = await askConfirm({
    title: 'Replace every slide in this deck?',
    blurb: `The ${questions.length} slide${questions.length === 1 ? '' : 's'} in this `
      + `deck ${questions.length === 1 ? 'is' : 'are'} deleted and replaced with the `
      + `${parsed.questions.length} in the text. Every answer ever collected against `
      + 'them, in every session this deck has been run, is deleted too. Export '
      + 'anything you need first — this cannot be undone.',
    confirmLabel: 'Replace slides',
  });
  if (!ok) return;

  await updateDeck(deck.id, {
    title: parsed.title, theme: parsed.theme, background: parsed.background,
    // Merged, not replaced: deck.settings also holds the custom theme the
    // instructor built and the question-size choice, and neither of those
    // is expressible in the text format. Assigning parsed.settings here
    // would delete a theme by way of editing a prompt.
    settings: { ...(deck.settings || {}), ...(parsed.settings || {}) },
  });
  questions = await replaceQuestions(deck.id, parsed.questions);
  deck = await getDeck(deck.id);
  selectedId = questions[0]?.id || null;
  $('deckTitle').value = deck.title;
  buildThemeGrid(); buildBackgroundGrid();
  $('bgMotion').value = ambienceLevel(deck.background);
  describeAmbience();
  renderRail(); renderStage();
  toast('Deck updated');
}

/**
 * Rehearse the deck.
 *
 * The in-memory deck and slides go straight in — including whatever you
 * typed a second ago and the debounce hasn't flushed yet — because the
 * question a preview answers is "what does this look like now", not "what
 * did it look like at the last save".
 */
function onPreview() {
  if (!questions.length) { toast('Add a question first'); return; }
  openPreview(deck, questions);
}

/**
 * The pre-flight check.
 *
 * A slide with no prompt, a multiple choice with one option, a quiz with
 * nothing marked correct — each of these saves happily and then goes up
 * on the wall in front of the room, where there is nothing to be done
 * about it. Nothing here blocks a start: half-finished is a legitimate
 * state to teach from, and the instructor is the one who knows. It just
 * refuses to let the projector be the first place they find out.
 *
 * @returns {string[]} one plain sentence per problem, slide order.
 */
function deckIssues() {
  const issues = [];
  const at = (i) => `Slide ${i + 1}`;

  questions.forEach((q, i) => {
    const c = q.config || {};
    if (!isContentSlide(q.type) && !String(q.prompt || '').trim()) {
      issues.push(`${at(i)} has no question written on it.`);
    }

    const opts = (c.options || []).filter((o) => String(o?.text ?? o ?? '').trim());
    if ((q.type === 'multiple_choice' || q.type === 'quiz') && opts.length < 2) {
      issues.push(`${at(i)} is a ${TYPE_LABELS[q.type].toLowerCase()} with `
        + `${opts.length === 1 ? 'only one answer' : 'no answers'} to choose from.`);
    }
    if (q.type === 'quiz' && opts.length >= 2 && !(c.correct || []).length) {
      issues.push(`${at(i)} is a quiz with no correct answer marked, so it cannot be scored.`);
    }

    const listed = (key) => (c[key] || []).filter((s) => String(s?.text ?? s ?? '').trim());
    if (q.type === 'ranking' && listed('items').length < 2) {
      issues.push(`${at(i)} has fewer than two things to rank.`);
    }
    if (q.type === 'scales' && listed('statements').length < 1) {
      issues.push(`${at(i)} has no statements to rate.`);
    }
    if (q.type === 'timeline' && listed('items').length < 2) {
      issues.push(`${at(i)} has fewer than two events to put in order.`);
    }
    if (q.type === 'sample_vote' && listed('samples').length < 2) {
      issues.push(`${at(i)} has fewer than two samples to vote between.`);
    }
    if (q.type === 'budget' && listed('options').length < 2) {
      issues.push(`${at(i)} has fewer than two things to split a budget across.`);
    }
    if (q.type === 'matching' && !(c.pairs || []).filter((p) => p?.left && p?.right).length) {
      issues.push(`${at(i)} has no complete pairs to match.`);
    }
    if (q.type === 'this_or_that' && !(c.pairs || []).filter((p) => p?.left && p?.right).length) {
      issues.push(`${at(i)} has no pairs to choose between.`);
    }
    if (q.type === 'cloze' && !/\[[^\]]+\]/.test(String(c.text || ''))) {
      issues.push(`${at(i)} has no blanks marked with [brackets].`);
    }
    if (q.type === 'heatmap' && !String(c.passage || '').trim()) {
      issues.push(`${at(i)} has no passage for the room to mark up.`);
    }
    if (q.type === 'mood' && !(c.icons || []).filter((m) => String(m?.emoji || '').trim()).length) {
      issues.push(`${at(i)} has no moods to pick from.`);
    }
    if (q.type === 'buckets') {
      if (listed('buckets').length < 2) {
        issues.push(`${at(i)} is a card sort with fewer than two columns.`);
      }
      if (listed('cards').length < 1) {
        issues.push(`${at(i)} is a card sort with nothing to sort.`);
      }
    }
    if (q.type === 'consensus' && c.allow_submissions === false
        && !(c.claims || []).filter((cl) => String(cl?.text ?? cl ?? '').trim()).length) {
      issues.push(`${at(i)} has no claims and the room isn't allowed to add any — nothing to vote on.`);
    }
  });
  return issues;
}

async function onStart() {
  if (!questions.length) { toast('Add a question first'); return; }

  const issues = deckIssues();
  if (issues.length) {
    const shown = issues.slice(0, 6);
    const more = issues.length - shown.length;
    const ok = await askConfirm({
      title: issues.length === 1 ? 'One slide looks unfinished' : `${issues.length} slides look unfinished`,
      blurb: `${shown.join(' ')}${more > 0 ? ` And ${more} more.` : ''} `
        + 'You can start anyway — nothing here stops a session, and a slide you '
        + 'are about to talk over does not need to be finished.',
      confirmLabel: 'Start anyway',
      danger: false,
    });
    if (!ok) return;
  }

  const label = await askText({
    title: 'Start a session',
    note: 'A session holds one run of this deck and its results. Name it for '
      + 'the class you are about to teach, because you will be picking it out of a '
      + 'list weeks from now.',
    label: 'Session label',
    value: new Date().toLocaleDateString(),
    placeholder: 'Tue 9am section',
    confirmLabel: 'Start session',
  });
  // Escape used to abort with no sign at all, which reads as a dead button.
  if (label == null) { toast('Session not started'); return; }

  // The presenter reads the slides back from the server, so an edit still
  // sitting in the debounce would be projected as it was before the
  // correction — in front of the class. Nothing starts until it has landed.
  if (!(await flushNow())) {
    toast('Your last edit has not saved yet. The session would run the old version');
    return;
  }

  const session = await createSession(deck.id, label.trim(), deck.theme);
  window.location.href = `present.html?session=${session.id}`;
}

// =====================================================================
// Helpers
// =====================================================================

/**
 * Saves are debounced so typing doesn't fire a request per keystroke —
 * but they accumulate rather than replace. Editing a prompt and then
 * immediately editing an option must not drop the prompt: patches merge
 * per target and every pending target is flushed together.
 *
 * A patch leaves this queue only once the server has taken it. The queue
 * used to be cleared before the first request went out, so one dropped
 * PATCH — a wifi blip, an expired token, a 500 — took that edit and every
 * edit queued behind it with it, permanently. One more keystroke then
 * started a fresh queue that succeeded, and the status read "Saved" while
 * the rewritten prompt existed nowhere but on screen. Reloading the tab
 * was the first anyone heard about it.
 */
const pendingPatches = new Map();

/** The flush currently talking to the server, if any. */
let inFlight = null;
/** A flush asked for while one was already running. */
let flushQueued = false;
/** Set once a flush has failed; cleared only by a flush that succeeds. */
let saveFailed = false;
let retryTimer = null;
let retryDelay = 0;
let savedClearTimer = null;

function patchKey(job) { return job.kind === 'deck' ? 'deck' : `q:${job.id}`; }

function save(q, patch) {
  const key = `q:${q.id}`;
  const prev = pendingPatches.get(key)?.patch || {};
  pendingPatches.set(key, { kind: 'question', id: q.id, patch: { ...prev, ...patch } });
  scheduleFlush();
}

function saveDeck(patch) {
  const prev = pendingPatches.get('deck')?.patch || {};
  pendingPatches.set('deck', { kind: 'deck', patch: { ...prev, ...patch } });
  scheduleFlush();
}

/**
 * Put a job that never reached the server back at the front of the queue.
 *
 * Anything typed since the failed request went out is newer and wins; the
 * fields only the failed patch carried are restored underneath it, so a
 * retry can't resurrect a prompt the instructor has since rewritten.
 */
function requeue(job) {
  const key = patchKey(job);
  const newer = pendingPatches.get(key)?.patch || {};
  pendingPatches.set(key, { ...job, patch: { ...job.patch, ...newer } });
}

function scheduleFlush() {
  if (!saveFailed) setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flushSaves().catch(() => {}); }, 420);
  // The canvas and the open thumbnail follow every keystroke; the rest of
  // the rail is untouched, so nothing you are not looking at repaints.
  renderCanvas();
  refreshSelectedThumb();
}

/** Is there an edit that the server has not confirmed? */
function hasUnsavedWork() {
  return pendingPatches.size > 0 || inFlight != null || saveFailed;
}

async function flushSaves() {
  // A retry timer and a keystroke can both arrive mid-request. Let the
  // running pass finish and take another one after it rather than firing
  // two overlapping streams of PATCHes at the same rows.
  if (inFlight) { flushQueued = true; return inFlight; }

  clearTimeout(retryTimer);
  retryTimer = null;
  inFlight = runFlush();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
  if (flushQueued) {
    flushQueued = false;
    if (pendingPatches.size && !saveFailed) await flushSaves();
  }
  return undefined;
}

async function runFlush() {
  const jobs = [...pendingPatches.values()];
  pendingPatches.clear();
  try {
    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      try {
        if (job.kind === 'question') await updateQuestion(job.id, job.patch);
        else if (job.kind === 'deck') await updateDeck(deck.id, job.patch);
      } catch (e) {
        // This one and everything still behind it goes back on the queue.
        // The loop stops here on purpose: the patches are ordered, and
        // running the rest against a server that just refused would land
        // later edits without the earlier ones.
        jobs.slice(i).forEach(requeue);
        throw e;
      }
    }
    // Bump updated_at so the dashboard sorts right. Its own failure is not
    // worth alarming anyone about — no edit rides on it.
    try { await updateDeck(deck.id, {}); } catch { /* sort order only */ }
    saveFailed = false;
    retryDelay = 0;
    setSaveState('Saved');
    clearTimeout(savedClearTimer);
    savedClearTimer = setTimeout(() => {
      if (!hasUnsavedWork()) setSaveState('');
    }, 1600);
  } catch (e) {
    markSaveFailed(e);
  }
}

/**
 * Say so, and keep saying so.
 *
 * The old behaviour put "Not saved" in a small grey span that wiped itself
 * after a second and a half — a message you could miss by looking at the
 * keyboard. An edit that is not on the server is a state the instructor has
 * to know they are in, so this one stays up until a save actually lands,
 * and it keeps retrying on its own in the meantime.
 */
function markSaveFailed(e) {
  saveFailed = true;
  setSaveState('Not saved. Retrying');
  toast(e?.message || 'Could not save. Still trying');
  retryDelay = Math.min(retryDelay ? retryDelay * 2 : 2000, 15000);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { flushSaves().catch(() => {}); }, retryDelay);
}

/**
 * Get everything on the server now, and say whether that worked.
 *
 * For the handful of places that must not run against a stale row: leaving
 * the page, and any direct write that would race the debounce.
 */
async function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  clearTimeout(retryTimer);
  retryTimer = null;
  retryDelay = 0;
  // A flush already in the air does not carry a patch queued a moment ago,
  // so a couple of passes drain what it left behind. A pass that fails
  // stops the rest — the backoff retry has it from there, and nobody
  // waiting on this wants three round trips to the same dead server.
  for (let i = 0; i < 3 && hasUnsavedWork(); i += 1) {
    await flushSaves();
    if (saveFailed) break;
  }
  return !hasUnsavedWork();
}

function touch() { scheduleFlush(); }

/**
 * The save indicator.
 *
 * "Not saved" is the one state that has to survive being glanced past, and
 * the rule that draws it lives in styles/app.css, which this editor does not
 * own — so the emphasis is applied here, and the tab title carries it too
 * for the case where the instructor has switched away to look something up.
 */
function setSaveState(text) {
  const node = $('saveState');
  if (!node) return;
  node.textContent = text;
  const bad = saveFailed;
  node.classList.toggle('muted', !bad);
  node.style.color = bad ? 'var(--bad-text, #b42318)' : '';
  node.style.fontWeight = bad ? '700' : '';
  node.style.fontSize = bad ? '.82rem' : '';
  node.title = bad
    ? 'This deck has changes the server has not taken yet. Keep this tab open.'
    : '';
  const base = document.title.replace(/^• Unsaved · /, '');
  document.title = bad ? `• Unsaved · ${base}` : base;
}

function field(label, control) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  wrap.append(l, control);
  return wrap;
}

function checkline(label, checked, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'checkline';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function textarea(value, placeholder, onInput) {
  const t = document.createElement('textarea');
  t.value = value || '';
  t.rows = 2;
  t.placeholder = placeholder;
  t.addEventListener('input', () => onInput(t.value));
  return t;
}

function btn(label, cls, fn, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls || ''}`.trim();
  b.textContent = label;
  b.disabled = !!disabled;
  b.addEventListener('click', fn);
  return b;
}

function spacer() {
  const s = document.createElement('span');
  s.className = 'spacer';
  return s;
}

/** A prompt in a dialog title: enough to recognise, never a paragraph. */
function truncate(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function slug(s) {
  return String(s || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
}

// ------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSlideGallery(); return; }
  // Slide-to-slide with the keyboard, but only when the caret isn't in a
  // field — otherwise arrowing through your own prompt would jump slides.
  if (e.target.matches('input, textarea, select')) return;
  // …and only when nothing nearer the key has already claimed it. The
  // element handles on the canvas take arrow keys for a nudge, and they are
  // buttons, not fields, so the test above waves them straight through.
  if (e.defaultPrevented) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const i = questions.findIndex((q) => q.id === selectedId);
  const next = questions[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  selectSlide(next.id);
});

/**
 * Don't let an edit leave with the tab.
 *
 * Saves are debounced by 420ms, so closing the tab, hitting Back or
 * clicking anything in the appbar within that window used to drop the last
 * thing typed without a word. The browser's own "leave site?" prompt is the
 * only thing that can interrupt a navigation, and it only appears when
 * there is genuinely something outstanding.
 */
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsavedWork()) return;
  // A last-ditch attempt to get it out of the door: some browsers still run
  // this while the confirmation sits on screen, and if it lands the second
  // attempt to leave goes through silently.
  flushSaves().catch(() => {});
  e.preventDefault();
  e.returnValue = '';
});
