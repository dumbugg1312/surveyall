/**
 * SurveyAll — deck editor.
 *
 * Questions on the left, look-and-feel on the right, live preview under
 * it. Everything saves as you go; the text view round-trips the whole
 * deck through the plain-text format so a deck is never trapped here.
 */

import {
  configured, currentUser, getDeck, updateDeck, listQuestions,
  createQuestion, updateQuestion, deleteQuestion, reorderQuestions,
  replaceQuestions, createSession,
  uploadBackground, listBackgrounds, deleteBackground,
} from './db.js';
import { TYPE_LABELS } from './logic.js';
import {
  THEMES, BACKGROUND_PRESETS, getTheme, applyTheme,
  backgroundStyles, scrimOpacity, CHART_STYLES,
} from './themes.js';
import { parseDeck, serialiseDeck } from './deck-format.js';

const $ = (id) => document.getElementById(id);

let deck = null;
let questions = [];
let openId = null;
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

  $('deckTitle').value = deck.title;
  $('deckTitle').addEventListener('input', () => {
    saveDeck({ title: $('deckTitle').value.trim() || 'Untitled deck' });
  });

  $('addQuestion').addEventListener('click', onAdd);
  $('textView').addEventListener('click', openTextView);
  $('startSession').addEventListener('click', onStart);

  buildThemeGrid();
  buildBackgroundGrid();
  wireBackgroundControls();
  await refreshUploads();

  renderQuestions();
  renderPreview();
}

// =====================================================================
// Questions
// =====================================================================

async function onAdd() {
  const type = $('addType').value;
  const created = await createQuestion(deck.id, {
    type,
    prompt: '',
    config: defaultConfig(type),
  }, questions.length);
  questions.push(created);
  openId = created.id;
  renderQuestions();
  touch();
}

function defaultConfig(type) {
  switch (type) {
    case 'multiple_choice': return { options: ['', ''], multiple: false, chart: 'bars' };
    case 'quiz': return { options: ['', '', '', ''], correct: [0], time: 20, scoring: 'time' };
    case 'word_cloud': return { max_words: 1, max_length: 25 };
    case 'open_ended': return { max_length: 200 };
    case 'scales': return { statements: [''], min: 1, max: 5, allow_skip: false };
    case 'ranking': return { items: ['', ''] };
    default: return {};
  }
}

function renderQuestions() {
  const list = $('qList');
  list.textContent = '';

  if (!questions.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const h = document.createElement('h3');
    h.textContent = 'No questions yet';
    const p = document.createElement('p');
    p.textContent = 'Pick a type above and hit Add, or use the text view to paste a whole deck at once.';
    empty.append(h, p);
    list.append(empty);
    return;
  }

  questions.forEach((q, i) => list.append(questionCard(q, i)));
}

function questionCard(q, index) {
  const card = document.createElement('div');
  card.className = 'q-card' + (openId === q.id ? ' is-open' : '');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'q-card-head';

  const num = document.createElement('span');
  num.className = 'q-num';
  num.textContent = String(index + 1);

  const title = document.createElement('div');
  title.className = 'q-card-title';
  const prompt = document.createElement('div');
  prompt.className = 'q-card-prompt';
  prompt.textContent = q.prompt || 'Untitled question';
  const type = document.createElement('div');
  type.className = 'q-card-type';
  type.textContent = TYPE_LABELS[q.type] || q.type;
  title.append(prompt, type);

  head.append(num, title);
  head.addEventListener('click', () => {
    openId = openId === q.id ? null : q.id;
    renderQuestions();
  });
  card.append(head);

  if (openId === q.id) card.append(questionBody(q, index));
  return card;
}

function questionBody(q, index) {
  const body = document.createElement('div');
  body.className = 'q-card-body';

  // ---- prompt -------------------------------------------------------
  const promptField = field('Question', textarea(q.prompt, (v) => {
    q.prompt = v;
    save(q, { prompt: v });
    const card = $('qList').children[index];
    card.querySelector('.q-card-prompt').textContent = v || 'Untitled question';
  }));
  body.append(promptField);

  // ---- type-specific ------------------------------------------------
  if (q.type === 'multiple_choice' || q.type === 'quiz') {
    body.append(optionsEditor(q, q.type === 'quiz'));
  }
  if (q.type === 'ranking') body.append(listEditor(q, 'items', 'Items to rank'));
  if (q.type === 'scales') body.append(listEditor(q, 'statements', 'Statements'));

  body.append(settingsFor(q));

  // ---- row actions --------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'row row-wrap';
  actions.append(
    btn('↑', 'btn-sm', async () => { await move(index, -1); }, index === 0),
    btn('↓', 'btn-sm', async () => { await move(index, 1); }, index === questions.length - 1),
    spacer(),
    btn('Duplicate', 'btn-sm', async () => {
      const copy = await createQuestion(deck.id,
        { type: q.type, prompt: q.prompt, config: JSON.parse(JSON.stringify(q.config)) },
        questions.length);
      questions.push(copy);
      renderQuestions();
      touch();
    }),
    btn('Delete', 'btn-sm btn-danger', async () => {
      if (!confirm('Delete this question?')) return;
      await deleteQuestion(q.id);
      questions = questions.filter((x) => x.id !== q.id);
      await reorderQuestions(deck.id, questions.map((x) => x.id));
      questions.forEach((x, i) => { x.position = i; });
      renderQuestions();
      touch();
    }),
  );
  body.append(actions);
  return body;
}

function optionsEditor(q, isQuiz) {
  const wrap = document.createElement('div');
  wrap.className = 'opt-editor';

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = isQuiz ? 'Answers (tick the correct one)' : 'Options';
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

    if (isQuiz || q.config.mark_correct) {
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
      renderQuestions();
    });
    line.append(remove);

    wrap.append(line);
  });

  wrap.append(btn('+ Add option', 'btn-sm', () => {
    q.config.options = [...options, ''];
    save(q, { config: q.config });
    renderQuestions();
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
      renderQuestions();
    });
    line.append(input, remove);
    wrap.append(line);
  });

  wrap.append(btn('+ Add', 'btn-sm', () => {
    q.config[key] = [...items, ''];
    save(q, { config: q.config });
    renderQuestions();
  }));

  return wrap;
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
    renderQuestions();
  }));

  const choose = (key, label, options, dflt) => grid.append(field(label, (() => {
    const s = document.createElement('select');
    Object.entries(options).forEach(([value, text]) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = text;
      s.append(o);
    });
    s.value = cfg[key] ?? dflt;
    s.addEventListener('change', () => { cfg[key] = s.value; save(q, { config: cfg }); renderPreview(); });
    return s;
  })()));

  switch (q.type) {
    case 'multiple_choice':
      bool('multiple', 'Allow several answers');
      if (cfg.multiple) num('max_choices', 'Max choices', 1, 20, (cfg.options || []).length);
      bool('mark_correct', 'Mark a reference answer');
      choose('chart', 'Chart', CHART_STYLES, 'bars');
      break;
    case 'quiz':
      num('time', 'Seconds to answer', 5, 300, 20);
      choose('scoring', 'Scoring', { time: 'Faster = more points', fixed: 'Flat points' }, 'time');
      break;
    case 'word_cloud':
      num('max_words', 'Words per person', 1, 10, 1);
      num('max_length', 'Max characters', 5, 60, 25);
      break;
    case 'open_ended':
      num('max_length', 'Max characters', 20, 1000, 200);
      break;
    case 'scales':
      num('min', 'Lowest', 0, 10, 1);
      num('max', 'Highest', 2, 100, 5);
      bool('allow_skip', 'Allow skipping');
      break;
    case 'ranking':
      bool('allow_partial', 'Allow ranking only some');
      break;
    default:
      break;
  }

  return grid;
}

async function move(index, step) {
  const target = index + step;
  if (target < 0 || target >= questions.length) return;
  [questions[index], questions[target]] = [questions[target], questions[index]];
  questions.forEach((q, i) => { q.position = i; });
  await reorderQuestions(deck.id, questions.map((q) => q.id));
  renderQuestions();
  touch();
}

// =====================================================================
// Theme + background
// =====================================================================

function buildThemeGrid() {
  const grid = $('themeGrid');
  grid.textContent = '';

  Object.entries(THEMES).forEach(([id, theme]) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'theme-tile' + (deck.theme === id ? ' is-active' : '');
    tile.title = theme.blurb;

    const preview = document.createElement('div');
    preview.className = 'theme-preview';
    preview.style.background = theme.tokens['--ground'];
    ['--accent', '--accent-2', '--ink'].forEach((tok) => {
      const bar = document.createElement('span');
      bar.className = 'theme-bar';
      bar.style.background = theme.tokens[tok];
      preview.append(bar);
    });

    const name = document.createElement('span');
    name.className = 'theme-name';
    name.textContent = theme.name;
    name.style.background = theme.tokens['--surface'];
    name.style.color = theme.tokens['--ink'];

    tile.append(preview, name);
    tile.addEventListener('click', async () => {
      deck.theme = id;
      await updateDeck(deck.id, { theme: id });
      buildThemeGrid();
      buildBackgroundGrid();
      renderPreview();
      touch();
    });

    grid.append(tile);
  });
}

function buildBackgroundGrid() {
  const grid = $('bgGrid');
  grid.textContent = '';
  const theme = getTheme(deck.theme);

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

    const styles = backgroundStyles(bg, deck.theme);
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
  renderPreview();
  touch();
}

// =====================================================================
// Preview
// =====================================================================

function renderPreview() {
  const host = $('preview');
  host.textContent = '';

  const frame = document.createElement('div');
  frame.style.cssText = 'position:relative;aspect-ratio:16/9;overflow:hidden;isolation:isolate';
  applyTheme(frame, deck.theme);
  const theme = getTheme(deck.theme);
  frame.style.background = theme.tokens['--ground'];

  const backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;inset:0';
  Object.assign(backdrop.style, backgroundStyles(deck.background, deck.theme));

  const scrim = document.createElement('div');
  scrim.style.cssText = `position:absolute;inset:0;background:${theme.tokens['--ground']};` +
    `opacity:${scrimOpacity(deck.background)}`;

  const content = document.createElement('div');
  content.style.cssText =
    'position:relative;padding:8% 7%;display:flex;flex-direction:column;gap:6%;height:100%';

  const q = questions[0];
  const heading = document.createElement('div');
  heading.style.cssText = `font-family:${theme.tokens['--display']};font-size:1.05rem;` +
    `font-weight:600;line-height:1.15;color:${theme.tokens['--ink']}`;
  heading.textContent = q?.prompt || deck.title || 'Your question appears here';

  const bars = document.createElement('div');
  bars.style.cssText = 'display:flex;flex-direction:column;gap:5%';
  [78, 52, 34].forEach((w, i) => {
    const track = document.createElement('div');
    track.style.cssText = `height:.5rem;border-radius:${theme.tokens['--bar-radius']};` +
      `background:${theme.tokens['--edge']};overflow:hidden`;
    const fill = document.createElement('div');
    fill.style.cssText = `height:100%;width:${w}%;border-radius:inherit;background:${
      i === 0 ? theme.tokens['--accent'] : theme.tokens['--accent-2']};opacity:${1 - i * 0.22}`;
    track.append(fill);
    bars.append(track);
  });

  content.append(heading, bars);
  frame.append(backdrop, scrim, content);
  host.append(frame);
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
      if (!confirm('Replace every question in this deck with the text above?')) return;
      await updateDeck(deck.id, {
        title: parsed.title, theme: parsed.theme, background: parsed.background,
      });
      questions = await replaceQuestions(deck.id, parsed.questions);
      deck = await getDeck(deck.id);
      $('deckTitle').value = deck.title;
      buildThemeGrid(); buildBackgroundGrid();
      renderQuestions(); renderPreview();
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
  if (!questions.length) { toast('Add a question first'); return; }
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
  renderPreview();
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

function textarea(value, onInput) {
  const t = document.createElement('textarea');
  t.value = value || '';
  t.rows = 2;
  t.placeholder = 'What do you want to ask?';
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
