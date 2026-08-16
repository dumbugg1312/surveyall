/**
 * SurveyAll — deck editor.
 *
 * Three panes, the shape every instructor already has muscle memory for:
 * the deck as a strip of slides on the left, the slide you're working on
 * in the middle (what the room sees on top, what you type underneath),
 * and the look of the whole deck on the right.
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
  uploadBackground, listBackgrounds, deleteBackground,
} from './db.js';
import {
  TYPE_LABELS, splitPassage, DEFAULT_JOIN_STEPS, isContentSlide,
} from './logic.js';
import { TEMPLATES } from './templates.js';
import {
  THEMES, BACKGROUND_PRESETS, getTheme, applyTheme,
  backgroundStyles, scrimOpacity, CHART_STYLES,
  resolveTheme, buildCustomTheme, CUSTOM_FONTS, CUSTOM_RADII, contrastRatio,
} from './themes.js';
import { parseDeck, serialiseDeck } from './deck-format.js';
import { renderSlide } from './slide-preview.js';

const $ = (id) => document.getElementById(id);

let deck = null;
let questions = [];
let selectedId = null;
let saveTimer = null;

boot().catch((e) => { console.error(e); toast(e.message || String(e)); });

async function boot() {
  if (!configured) { window.location.replace('index.html'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`index.html?next=${encodeURIComponent(window.location.href)}`);
    return;
  }

  const deckId = new URLSearchParams(window.location.search).get('deck');
  if (!deckId) { window.location.replace('dashboard.html'); return; }

  deck = await getDeck(deckId);
  questions = await listQuestions(deckId);
  selectedId = questions[0]?.id || null;

  $('deckTitle').value = deck.title;
  $('deckTitle').addEventListener('input', () => {
    saveDeck({ title: $('deckTitle').value.trim() || 'Untitled deck' });
  });

  $('addSlide').addEventListener('click', toggleSlideGallery);
  $('addTemplate').addEventListener('click', openTemplatePicker);
  $('textView').addEventListener('click', openTextView);
  $('startSession').addEventListener('click', onStart);
  $('btnDesign').addEventListener('click', toggleDesign);

  buildThemeGrid();
  buildMyThemesGrid();
  wireThemeBuilder();
  buildBackgroundGrid();
  wireBackgroundControls();
  await refreshUploads();

  renderRail();
  renderStage();
}

function selected() {
  return questions.find((q) => q.id === selectedId) || null;
}

function selectSlide(id) {
  if (selectedId === id) return;
  selectedId = id;
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
    `Slide ${index + 1}: ${q.prompt || 'untitled'} — ${TYPE_LABELS[q.type] || q.type}`);
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
  renderSlide(host, q, deck, resolveTheme(deck.theme, deck));
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
          toast(e?.message || 'Something went wrong — see the console.');
        });
      }
      return out;
    } catch (e) {
      console.error(e);
      toast(e?.message || 'Something went wrong — see the console.');
      return undefined;
    }
  };
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
  ['multiple_choice', 'The everyday poll. Bars, donut, opinion or best answer.'],
  ['word_cloud', 'One or two words each; the room writes the headline.'],
  ['open_ended', 'Sentences, shown as cards. Hold them for review if you like.'],
  ['scales', 'Rate several statements 1–5. Good for confidence checks.'],
  ['ranking', 'Put items in order. Counted by Borda points.'],
  ['quiz', 'Timed, scored, with a leaderboard.'],
  ['spectrum', 'Where do you stand? A slider, drawn as a scatter, never averaged.'],
  ['sample_vote', 'Two or more samples; the room picks the strongest and says why.'],
  ['heatmap', 'A short passage the room highlights or labels.'],
  ['qa', 'Open floor. Questions from the room, upvoted, moderated by you.'],
];

function toggleSlideGallery() {
  const open = document.getElementById('slideGallery');
  if (open) { closeSlideGallery(); return; }
  openSlideGallery();
}

function closeSlideGallery() {
  document.getElementById('slideGallery')?.remove();
  document.getElementById('galleryBackdrop')?.remove();
  $('addSlide').setAttribute('aria-expanded', 'false');
}

function openSlideGallery() {
  const backdrop = document.createElement('div');
  backdrop.id = 'galleryBackdrop';
  backdrop.className = 'gallery-backdrop';
  backdrop.addEventListener('click', closeSlideGallery);

  const pop = document.createElement('div');
  pop.id = 'slideGallery';
  pop.className = 'slide-gallery';

  const head = document.createElement('div');
  head.className = 'gallery-head';
  head.append(Object.assign(document.createElement('h3'), { textContent: 'New slide' }));
  pop.append(head);

  const grid = document.createElement('div');
  grid.className = 'gallery-grid';

  SLIDE_TYPES.forEach(([type, blurb]) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'gallery-tile';

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
  $('addSlide').setAttribute('aria-expanded', 'true');

  // anchor under the button, kept inside the viewport
  const r = $('addSlide').getBoundingClientRect();
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12))}px`;
  pop.style.bottom = `${Math.max(12, window.innerHeight - r.top + 8)}px`;
  pop.querySelector('.gallery-tile')?.focus();
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
  if (!confirm('Delete this slide?')) return;
  const at = questions.findIndex((x) => x.id === q.id);
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

function defaultConfig(type) {
  switch (type) {
    case 'instructions': return { steps: [...DEFAULT_JOIN_STEPS], show_join: true };
    case 'multiple_choice': return { options: ['', ''], multiple: false, chart: 'bars' };
    case 'quiz': return { options: ['', '', '', ''], correct: [0], time: 20, scoring: 'time' };
    case 'word_cloud': return { max_words: 1, max_length: 25 };
    case 'open_ended': return { max_length: 200 };
    case 'scales': return { statements: [''], min: 1, max: 5, allow_skip: false };
    case 'ranking': return { items: ['', ''] };
    case 'sample_vote': return { samples: ['', ''], allow_rationale: true };
    case 'heatmap': return { passage: '', segments: [], mode: 'highlight', max_picks: 1 };
    default: return {};
  }
}

// =====================================================================
// The stage — canvas on top, the slide's own editor underneath
// =====================================================================

function renderStage() {
  renderCanvas();
  renderSlideEditor();
}

function renderCanvas() {
  const host = $('canvas');
  const q = selected();
  const note = $('canvasNote');

  if (!q) {
    host.textContent = '';
    renderSlide(host, { type: null, prompt: deck.title || 'Your deck', config: {} },
      deck, resolveTheme(deck.theme, deck), { placeholder: true });
    note.textContent = '';
    return;
  }

  const index = questions.findIndex((x) => x.id === q.id);
  renderSlide(host, q, deck, resolveTheme(deck.theme, deck), {
    kicker: `${TYPE_LABELS[q.type] || q.type} · Slide ${index + 1} of ${questions.length}`,
  });
  note.textContent = isContentSlide(q.type)
    ? 'Nothing to answer — this slide just sits on the projector.'
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

  // ---- heading / prompt ---------------------------------------------
  body.append(field(
    q.type === 'instructions' ? 'Heading' : 'Question',
    textarea(q.prompt, q.type === 'instructions' ? 'What should the slide say up top?'
      : 'What do you want to ask?', (v) => {
      q.prompt = v;
      save(q, { prompt: v });
    }),
  ));

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

  body.append(settingsFor(q));
  return body;
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
  l.textContent = 'Steps — %CODE% becomes this session\'s join code';
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

  // like bool, but the unset state reads as `dflt` rather than false
  const bool2 = (key, label, dflt) => grid.append(checkline(label, cfg[key] ?? dflt, (v) => {
    cfg[key] = v;
    save(q, { config: cfg });
    renderStage();
  }));

  switch (q.type) {
    case 'instructions':
      bool2('show_join', 'Show the QR code and join code', true);
      text('note', 'Small print (optional)', 'Phones on silent, please');
      break;
    case 'multiple_choice':
      choose('mode', 'Question mode', {
        opinion: 'Opinion — no key, the split is the point',
        best: 'Best answer — mark the most defensible below',
      }, 'opinion');
      bool('multiple', 'Allow several answers');
      if (cfg.multiple) num('max_choices', 'Max choices', 1, 20, (cfg.options || []).length);
      bool('confidence', 'Ask “how sure are you?”');
      choose('chart', 'Chart', CHART_STYLES, 'bars');
      break;
    case 'quiz':
      num('time', 'Seconds to answer', 5, 300, 20);
      choose('scoring', 'Scoring', { time: 'Faster = more points', fixed: 'Flat points' }, 'time');
      bool('confidence', 'Ask “how sure are you?”');
      break;
    case 'word_cloud':
      num('max_words', 'Words per person', 1, 10, 1);
      num('max_length', 'Max characters', 5, 60, 25);
      bool('hold', 'Hold answers for review before they show');
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
        highlight: 'Highlight — tap the sentence(s)',
        classify: 'Classify — label the parts',
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
    default:
      break;
  }

  return grid;
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
  l.textContent = 'Your anchor ratings (optional — revealed after voting closes)';
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
  l.textContent = 'Passage — keep it short; use | to override the sentence splits';
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
      warn.textContent = `${words} words — close reading works best under ~120`;
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

function toggleDesign() {
  const open = $('editorShell').classList.toggle('design-hidden');
  $('btnDesign').setAttribute('aria-expanded', open ? 'false' : 'true');
  $('btnDesign').classList.toggle('is-active', !open);
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

async function applyDeckTheme(themeId, customTheme) {
  deck.theme = themeId;
  if (customTheme) deck.settings = { ...(deck.settings || {}), customTheme };
  await updateDeck(deck.id, themeId === 'custom'
    ? { theme: 'custom', settings: deck.settings }
    : { theme: themeId });
  buildThemeGrid();
  buildMyThemesGrid();
  buildBackgroundGrid();
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

  // legibility guard: warn when the projected text would fail WCAG AA
  const ratio = contrastRatio(t.tokens['--ink'], t.tokens['--ground']);
  const warn = $('ctWarn');
  warn.hidden = ratio >= 4.5;
  if (!warn.hidden) {
    warn.textContent = `Text on background is ${ratio.toFixed(1)}:1 — `
      + 'aim for at least 4.5:1 so the back row can read it.';
  }
}

function openBuilder(existing) {
  editingThemeId = existing?.id || null;
  const p = existing?.picks || {};
  $('ctName').value = existing?.name || '';
  $('ctGround').value = p.ground || '#f7f4ee';
  $('ctInk').value = p.ink || '#1c2434';
  $('ctAccent').value = p.accent || '#1d4ed8';
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
    if (id === 'none') return;
    const o = document.createElement('option');
    o.value = id; o.textContent = b.name;
    backdropSel.append(o);
  });

  ['ctName', 'ctGround', 'ctInk', 'ctAccent', 'ctAccent2', 'ctFont', 'ctRadius', 'ctBackdrop']
    .forEach((id) => $(id).addEventListener('input', refreshBuilderPreview));

  $('btnNewTheme').addEventListener('click', () => openBuilder(null));
  $('ctCancel').addEventListener('click', closeBuilder);

  $('ctSave').addEventListener('click', async () => {
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
    if (!window.confirm('Delete this theme? Decks using it fall back to Lecture Hall.')) return;
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

  const tiles = [
    { kind: 'theme', label: 'Theme' },
    ...Object.keys(BACKGROUND_PRESETS).map((id) => ({ kind: 'preset', id, label: BACKGROUND_PRESETS[id].name })),
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
  try { files = await listBackgrounds(); } catch { return; }

  files.forEach((f) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    const active = deck.background?.kind === 'image' && deck.background.url === f.url;
    tile.className = 'bg-tile' + (active ? ' is-active' : '');
    tile.style.backgroundImage = `url("${f.url}")`;
    tile.title = 'Click to use · shift-click to delete';

    tile.addEventListener('click', async (e) => {
      if (e.shiftKey) {
        if (!confirm('Delete this uploaded image?')) return;
        await deleteBackground(f.path);
        await refreshUploads();
        return;
      }
      setBackground({
        kind: 'image', url: f.url,
        dim: Number($('bgDim').value) / 100,
        blur: Number($('bgBlur').value),
      });
    });
    grid.append(tile);
  });
}

function wireBackgroundControls() {
  const solid = $('bgSolid');
  solid.value = deck.background?.kind === 'solid' ? deck.background.color : '#1e2a24';
  solid.addEventListener('input', () => setBackground({ kind: 'solid', color: solid.value }));

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
    toast('Image is over 6 MB — please shrink it first');
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

async function setBackground(bg) {
  deck.background = bg;
  await updateDeck(deck.id, { background: bg });
  $('imageControls').hidden = bg.kind !== 'image';
  buildBackgroundGrid();
  await refreshUploads();
  renderRail();
  renderCanvas();
  touch();
}

// =====================================================================
// Text view (import / export)
// =====================================================================

function openTextView() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const h = document.createElement('h2');
  h.textContent = 'Text view';
  const p = document.createElement('p');
  p.className = 'muted';
  p.style.fontSize = '.86rem';
  p.textContent = 'This is your whole deck as plain text. Copy it to keep a backup, '
    + 'paste it into another deck, or edit here and apply.';

  const area = document.createElement('textarea');
  area.className = 'text-editor';
  area.value = serialiseDeck(deck, questions);

  const errors = document.createElement('div');
  errors.className = 'parse-errors';

  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    btn('Copy', '', async () => {
      try {
        await navigator.clipboard.writeText(area.value);
        toast('Copied');
      } catch { area.select(); }
    }),
    btn('Download', '', () => {
      const blob = new Blob([area.value], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${slug(deck.title)}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    }),
    spacer(),
    btn('Close', '', () => backdrop.remove()),
    btn('Apply changes', 'btn-primary', async () => {
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
      if (!confirm('Replace every slide in this deck with the text above?')) return;
      await updateDeck(deck.id, {
        title: parsed.title, theme: parsed.theme, background: parsed.background,
      });
      questions = await replaceQuestions(deck.id, parsed.questions);
      deck = await getDeck(deck.id);
      selectedId = questions[0]?.id || null;
      $('deckTitle').value = deck.title;
      buildThemeGrid(); buildBackgroundGrid();
      renderRail(); renderStage();
      backdrop.remove();
      toast('Deck updated');
    }),
  );

  modal.append(h, p, area, errors, row);
  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
}

async function onStart() {
  if (!questions.length) { toast('Add a slide first'); return; }
  const label = prompt('Label this session (e.g. "Tue 9am section")',
    new Date().toLocaleDateString());
  if (label == null) return;
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
 */
const pendingPatches = new Map();

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

function scheduleFlush() {
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 420);
  // The canvas and the open thumbnail follow every keystroke; the rest of
  // the rail is untouched, so nothing you are not looking at repaints.
  renderCanvas();
  refreshSelectedThumb();
}

async function flushSaves() {
  const jobs = [...pendingPatches.values()];
  pendingPatches.clear();
  try {
    for (const job of jobs) {
      if (job.kind === 'question') await updateQuestion(job.id, job.patch);
      else if (job.kind === 'deck') await updateDeck(deck.id, job.patch);
    }
    await updateDeck(deck.id, {}); // bump updated_at so the dashboard sorts right
    setSaveState('Saved');
    setTimeout(() => setSaveState(''), 1600);
  } catch (e) {
    setSaveState('Not saved');
    toast(e.message || 'Could not save');
  }
}

function touch() { scheduleFlush(); }

function setSaveState(text) { $('saveState').textContent = text; }

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

function slug(s) {
  return String(s || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200);
}

// ------------------------------------------------------------ keyboard

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSlideGallery(); return; }
  // Slide-to-slide with the keyboard, but only when the caret isn't in a
  // field — otherwise arrowing through your own prompt would jump slides.
  if (e.target.matches('input, textarea, select')) return;
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const i = questions.findIndex((q) => q.id === selectedId);
  const next = questions[i + (e.key === 'ArrowDown' ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  selectSlide(next.id);
});
