/**
 * SurveyAll — placing elements on a slide.
 *
 * Two halves that share one selection:
 *
 *   elementsEditor()     the "Elements" section in the slide form —
 *                        the catalog, and the controls for whatever is
 *                        currently picked
 *   mountDecorEditor()   the drag surface laid over the editor canvas
 *
 * Placement is free — an element goes wherever you drop it — with the
 * help a design tool gives you rather than the wall a grid gives you:
 * alignment guides that appear when you come near the centre, the
 * thirds, or another element, and snap you onto them. Hold Alt to ignore
 * them entirely.
 *
 * What gets written down is `@ 31.5,68.2` — a percentage of the slide,
 * so it is free and still means the same thing on every projector. See
 * app/elements.js. The areas the join card and control bar occupy are
 * shaded rather than fenced off: decor draws underneath both, so the
 * shading is advice, not a rule.
 */

import {
  ELEMENT_LIST, CATEGORY_ORDER, CATEGORY_LABELS, CATEGORY_TABS, searchElements, getElement,
  elementSvg, decorNode, decorOf, normaliseDecor,
  anchorPos, posLabel, coord, LAYERS, RESERVED_ZONES, reservedAt,
  SIZES, SIZE_LABELS, COLOR_TOKENS, WEIGHTS, ROT_STEP, MAX_DECOR,
  DEFAULT_ANCHOR, DEFAULT_SIZE, DEFAULT_STROKE, DEFAULT_FILL, DEFAULT_WEIGHT,
} from './elements.js';

/**
 * Which placed element is being worked on, as an index into the slide's
 * own decor list, plus the slide it belongs to. Kept at module scope
 * because the form and the canvas overlay are rebuilt independently and
 * both have to agree on what is selected.
 */
let selected = { slideId: null, index: -1 };

/** Last category the picker was left on, so reopening lands where you were. */
let pickerCat = 'marks';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function selectedIndex(q) {
  return selected.slideId === q.id ? selected.index : -1;
}

export function selectDecor(q, index) {
  selected = { slideId: q.id, index };
}

export function clearDecorSelection() {
  selected = { slideId: null, index: -1 };
}

/**
 * Click an element ON THE CANVAS, which has to bring its controls out.
 *
 * They live in the design panel on the right, which the instructor may
 * have collapsed or hidden entirely — so a click whose only effect is a
 * selection ring reads as a click that did nothing. This is the one path
 * that reveals: a drag shows its own result and must not resize the
 * stage mid-gesture, and a nudge is already on something selected. A
 * deselect (-1) asks for nothing — no reason to open a panel to show an
 * empty one.
 */
function selectFromCanvas(q, index, ctx) {
  selectDecor(q, index);
  if (index >= 0) ctx.onReveal?.();
}

/** The slide's decor, cleaned — the single read path for both halves. */
function listOf(q) {
  return decorOf(q.config);
}

/**
 * Write a decor list back onto the question.
 *
 * Everything goes through normaliseDecor on the way in, so a value that
 * arrived from a colour input, a slider or a hand-edited text view is
 * held to the same rules.
 */
function commit(q, items, ctx) {
  const clean = items.map(normaliseDecor).filter(Boolean).slice(0, MAX_DECOR);
  if (clean.length) q.config.decor = clean;
  else delete q.config.decor;
  ctx.onChange();
}

function patchItem(q, index, patch, ctx) {
  const items = listOf(q);
  if (!items[index]) return;
  items[index] = { ...items[index], ...patch };
  commit(q, items, ctx);
}

/**
 * Change one element WITHOUT rebuilding the form.
 *
 * A colour well and a slider both fire `input` continuously while they
 * are being dragged. Committing on each one re-rendered the slide form,
 * which destroyed and recreated the very control under the pointer — so
 * the drag died on its first movement and the colour picker appeared
 * frozen. The value is written and the art is repainted in place; the
 * form redraws on `change`, once the control has settled.
 */
function patchLive(q, index, patch) {
  const items = listOf(q);
  if (!items[index]) return;
  const next = normaliseDecor({ ...items[index], ...patch });
  if (!next) return;
  items[index] = next;
  q.config.decor = items;

  // Every surface that has this element drawn: the canvas, the rail
  // thumbnail, and the projector if a preview is open — but only the ones
  // drawing THIS question. Element indexes restart on every slide, so an
  // unscoped query repainted slide 7's second element with slide 3's
  // colour on every tick of the opacity slider.
  const mine = q?.id != null
    ? `.sp-slide[data-qid="${CSS.escape(String(q.id))}"] `
    : '';
  document.querySelectorAll(`${mine}.decor-item[data-decor-index="${index}"]`).forEach((node) => {
    if (!node.closest('.sp-slide, .stage')) return;
    const fresh = decorNode(next);
    node.style.cssText = fresh.style.cssText;
    node.replaceChildren(...fresh.childNodes);
  });
}

// =====================================================================
// The design panel's "Elements" section
// =====================================================================

export function elementsEditor(q, ctx) {
  const wrap = el('div', 'decor-editor');

  const items = listOf(q);

  // No "Elements" label here: this is rendered into the design panel's
  // Elements section, whose summary already says so. The count earns the
  // line instead, because the strip below it stops being countable at a
  // glance somewhere around six.
  const head = el('div', 'decor-head');
  if (items.length) {
    head.append(el('span', 'label',
      `${items.length} of ${MAX_DECOR} placed`));
  }
  head.append(el('span', 'spacer'));

  const add = el('button', 'btn btn-sm', '+ Add element');
  add.type = 'button';
  // With nothing placed there is no count to sit opposite, and adding one
  // is the only thing this section can do — so it takes the whole line.
  if (!items.length) add.classList.add('decor-add-block');
  add.disabled = items.length >= MAX_DECOR;
  add.title = items.length >= MAX_DECOR
    ? `A slide holds ${MAX_DECOR} elements`
    : 'Pick something to place on this slide';
  add.addEventListener('click', () => openPicker(add, q, ctx));
  head.append(add);
  wrap.append(head);

  if (!items.length) {
    const empty = el('p', 'decor-empty',
      'Nothing placed yet. Marks like circling, arrows and braces do the most '
      + 'teaching work; the subject icons are for setting the scene.');
    wrap.append(empty);
    return wrap;
  }

  // ---- the strip of what's on the slide -------------------------------
  const strip = el('div', 'decor-strip');
  const active = selectedIndex(q);

  items.forEach((item, i) => {
    const chip = el('button', 'decor-chip');
    chip.type = 'button';
    chip.title = `${getElement(item.id)?.label || item.id}: ${posLabel(item.x, item.y)}`;
    if (i === active) chip.classList.add('is-selected');

    const svg = elementSvg(item.id, {
      stroke: item.stroke, fill: item.fill, w: item.w, cls: 'decor-chip-art',
    });
    if (svg) chip.append(svg);
    chip.addEventListener('click', () => {
      selectDecor(q, i === active ? -1 : i);
      ctx.onChange({ quiet: true });
    });
    strip.append(chip);
  });
  wrap.append(strip);

  // ---- controls for the picked one ------------------------------------
  if (active >= 0 && items[active]) {
    wrap.append(itemControls(q, active, items[active], ctx));
  } else {
    wrap.append(el('p', 'decor-empty', 'Pick one above, or on the slide, to change it.'));
  }

  return wrap;
}

function itemControls(q, index, item, ctx) {
  const box = el('div', 'decor-controls');
  const set = (patch) => patchItem(q, index, patch, ctx);
  // live = paint it now, do not touch the form; set = write it down
  const live = (patch) => patchLive(q, index, patch);

  const title = el('div', 'decor-controls-head');
  title.append(el('strong', null, getElement(item.id)?.label || item.id));
  title.append(el('span', 'spacer'));
  const del = el('button', 'btn btn-sm btn-danger', 'Remove');
  del.type = 'button';
  del.addEventListener('click', () => {
    const items = listOf(q);
    items.splice(index, 1);
    selectDecor(q, -1);
    commit(q, items, ctx);
  });
  title.append(del);
  box.append(title);

  // ---- which side of the content --------------------------------------
  // There is no position control. You drag it where you want it, and the
  // handle takes arrow keys for a nudge — a pad of nine buttons and a
  // pair of percentage boxes were two more ways to say the same thing.
  box.append(labelled('Layer', segmented(
    LAYERS.map(([id, label]) => [id, label]),
    item.layer,
    (layer) => set({ layer }),
    LAYERS.map(([, , why]) => why),
  )));

  // ---- how big --------------------------------------------------------
  box.append(labelled('Size', segmented(
    Object.keys(SIZES).map((k) => [k, SIZE_LABELS[k]]),
    item.size,
    (size) => set({ size }),
  )));

  // ---- line -----------------------------------------------------------
  const lineRow = el('div', 'decor-row');
  lineRow.append(labelled('Line', colorPicker(
    item.stroke, false, (stroke) => set({ stroke }), (stroke) => live({ stroke }))));
  lineRow.append(labelled('Weight', selectOf(
    WEIGHTS.map(([v, l]) => [String(v), l]),
    String(item.w),
    (v) => set({ w: Number(v) }),
  )));
  box.append(lineRow);

  // ---- fill -----------------------------------------------------------
  // An open path — an arc, a brace, an underline — has no inside, so the
  // control is absent rather than present and inert.
  if (!getElement(item.id)?.nofill) {
    box.append(labelled('Fill', colorPicker(
      item.fill, true, (fill) => set({ fill }), (fill) => live({ fill }))));
  }

  // ---- angle, flip, fade ----------------------------------------------
  const row = el('div', 'decor-row');

  const rot = el('div', 'decor-rot');
  const rotOut = el('span', 'decor-num', `${item.rot}°`);
  const nudge = (step) => {
    const next = (((item.rot + step) % 360) + 360) % 360;
    rotOut.textContent = `${next}°`;
    set({ rot: next });
  };
  const ccw = el('button', 'btn btn-sm', '↺');
  ccw.type = 'button';
  ccw.title = `Rotate ${ROT_STEP}° anticlockwise`;
  ccw.addEventListener('click', () => nudge(-ROT_STEP));
  const cw = el('button', 'btn btn-sm', '↻');
  cw.type = 'button';
  cw.title = `Rotate ${ROT_STEP}° clockwise`;
  cw.addEventListener('click', () => nudge(ROT_STEP));
  rot.append(ccw, rotOut, cw);
  row.append(labelled('Angle', rot));

  const flip = el('button', `btn btn-sm${item.flip ? ' is-on' : ''}`, '⇄ Flip');
  flip.type = 'button';
  flip.setAttribute('aria-pressed', String(item.flip));
  flip.addEventListener('click', () => set({ flip: !item.flip }));
  row.append(labelled('Mirror', flip));
  box.append(row);

  const fade = document.createElement('input');
  fade.type = 'range';
  fade.min = '5';
  fade.max = '100';
  fade.step = '5';
  fade.value = String(item.op);
  const fadeOut = el('span', 'decor-num', `${item.op}%`);
  // same as the colour well: paint through the drag, commit on release
  fade.addEventListener('input', () => {
    fadeOut.textContent = `${fade.value}%`;
    live({ op: Number(fade.value) });
  });
  fade.addEventListener('change', () => set({ op: Number(fade.value) }));
  const fadeWrap = el('div', 'decor-fade');
  fadeWrap.append(fade, fadeOut);
  box.append(labelled('Strength', fadeWrap));

  const zone = reservedAt(item.x, item.y);
  if (zone) {
    box.append(el('p', 'decor-warn',
      `${zone.label[0].toUpperCase()}${zone.label.slice(1)} sits here during class, `
      + 'and this is drawn underneath it.'));
  }

  return box;
}

// ---------------------------------------------------------------- bits

function labelled(text, control) {
  const f = el('div', 'decor-field');
  f.append(el('span', 'label', text), control);
  return f;
}

/**
 * Arrow keys nudge; Shift takes bigger steps.
 *
 * Half a percent is about a pixel on a laptop preview and four on a
 * projector — fine enough to line two marks up by eye, coarse enough
 * that holding the key does something.
 */
/** Tiles drawn per search. See paint() — the tail of a broad match is never scrolled to. */
const PICKER_MAX = 180;

const NUDGE = 0.5;
const NUDGE_BIG = 5;

export function nudgeFor(key, shift) {
  const step = shift ? NUDGE_BIG : NUDGE;
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

/**
 * Where an element should snap to, given everything else on the slide.
 *
 * Returns the lines worth showing: the slide's own centre and thirds,
 * and the centre of every other element — which is the one that actually
 * matters, because two marks a hair out of line is the thing that makes
 * a slide look homemade.
 */
export function guideLines(items, skipIndex) {
  const xs = new Set([50, 33.3, 66.7, 6, 94]);
  const ys = new Set([50, 33.3, 66.7, 10, 90]);
  items.forEach((it, i) => {
    if (i === skipIndex) return;
    xs.add(it.x);
    ys.add(it.y);
  });
  return { xs: [...xs], ys: [...ys] };
}

/** Snap threshold, in slide percent. Generous enough to catch, small
    enough that you can still sit next to a line without being eaten. */
const SNAP = 1.4;

export function snapTo(value, lines) {
  let best = null;
  let gap = SNAP;
  for (const line of lines) {
    const d = Math.abs(line - value);
    if (d < gap) { gap = d; best = line; }
  }
  return best;
}

function segmented(options, current, onPick, titles) {
  // `decor-seg`, not a bare `seg`: the dashboard's response filter also
  // calls itself `.seg`, and two unscoped rules of equal specificity
  // meant whichever stylesheet block came last styled both
  const bar = el('div', 'decor-seg');
  options.forEach(([value, label], i) => {
    const b = el('button', `decor-seg-btn${value === current ? ' is-on' : ''}`, label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(value === current));
    if (titles?.[i]) b.title = titles[i];
    b.addEventListener('click', () => onPick(value));
    bar.append(b);
  });
  return bar;
}

function selectOf(options, current, onPick) {
  const s = document.createElement('select');
  options.forEach(([value, label]) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (value === current) o.selected = true;
    s.append(o);
  });
  s.addEventListener('change', () => onPick(s.value));
  return s;
}

/**
 * Colour: theme swatches first, custom last.
 *
 * The order is the argument. A token re-themes with the deck and a hex
 * does not, so the tokens are what you reach for without thinking and the
 * colour well is there for the person who genuinely wants their
 * department's blue.
 */
function colorPicker(current, allowNone, onPick, onPreview) {
  const wrap = el('div', 'swatches');

  if (allowNone) {
    const none = el('button', `swatch swatch-none${current === 'none' ? ' is-on' : ''}`);
    none.type = 'button';
    none.title = 'No fill';
    none.setAttribute('aria-label', 'No fill');
    none.setAttribute('aria-pressed', String(current === 'none'));
    none.addEventListener('click', () => onPick('none'));
    wrap.append(none);
  }

  COLOR_TOKENS.forEach(([id, label, cssVar]) => {
    const b = el('button', `swatch${current === id ? ' is-on' : ''}`);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(current === id));
    b.style.background = `var(${cssVar})`;
    b.addEventListener('click', () => onPick(id));
    wrap.append(b);
  });

  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'swatch swatch-custom';
  custom.title = 'Custom colour';
  custom.setAttribute('aria-label', 'Custom colour');
  custom.value = /^#/.test(current) ? current : '#4a5d23';
  if (/^#/.test(current)) custom.classList.add('is-on');
  // `input` fires all the way through a drag inside the picker; `change`
  // fires once it settles. Preview on the first, commit on the second —
  // see patchLive for why committing on `input` broke the control.
  custom.addEventListener('input', () => (onPreview || onPick)(custom.value));
  custom.addEventListener('change', () => onPick(custom.value));
  wrap.append(custom);

  return wrap;
}

// =====================================================================
// The picker
// =====================================================================

function closePicker() {
  document.getElementById('elementPicker')?.remove();
  document.getElementById('elementPickerBackdrop')?.remove();
  document.removeEventListener('keydown', onPickerKey, true);
}

function onPickerKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closePicker(); }
}

function openPicker(anchorEl, q, ctx) {
  closePicker();

  const backdrop = el('div', 'gallery-backdrop');
  backdrop.id = 'elementPickerBackdrop';
  backdrop.addEventListener('click', closePicker);

  const pop = el('div', 'element-picker');
  pop.id = 'elementPicker';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Add an element');

  const head = el('div', 'picker-head');
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'picker-search';
  search.placeholder = 'Search 900+ elements: try "arrow", "cell", "law"';
  search.setAttribute('aria-label', 'Search elements');
  head.append(search);
  pop.append(head);

  const tabs = el('div', 'picker-tabs');
  tabs.setAttribute('role', 'tablist');
  const grid = el('div', 'picker-grid');
  grid.id = 'pickerGrid';
  grid.setAttribute('role', 'listbox');

  const paint = () => {
    const query = search.value.trim();
    const searching = query.length > 0;
    tabs.hidden = searching;

    const list = searching
      ? searchElements(query)
      : ELEMENT_LIST.filter((e) => e.category === pickerCat);

    tabs.querySelectorAll('.picker-tab').forEach((t) => {
      const on = t.dataset.cat === pickerCat;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });

    grid.textContent = '';
    if (!list.length) {
      grid.append(el('p', 'picker-empty', `Nothing matches “${query}”.`));
      return;
    }

    // A one-letter query matches most of the catalog, and every tile is a
    // freshly built SVG — drawing 700 of them between keystrokes is felt.
    // The scoring already put the best rows first, so the tail is the part
    // nobody scrolls to.
    const shown = list.slice(0, PICKER_MAX);
    const hidden = list.length - shown.length;

    shown.forEach((e) => {
      const tile = el('button', 'picker-tile');
      tile.type = 'button';
      tile.title = e.label;
      tile.setAttribute('role', 'option');
      tile.setAttribute('aria-label', e.label);
      const art = elementSvg(e.id, { stroke: 'ink', w: 2, cls: 'picker-art' });
      if (art) tile.append(art);
      tile.append(el('span', 'picker-name', e.label));
      tile.addEventListener('click', () => {
        addElement(q, e.id, ctx);
        closePicker();
      });
      grid.append(tile);
    });

    if (hidden) {
      grid.append(el('p', 'picker-more', `${hidden} more — keep typing to narrow it down.`));
    }
  };

  CATEGORY_ORDER.forEach((cat) => {
    const t = el('button', 'picker-tab', CATEGORY_TABS[cat]);
    t.type = 'button';
    t.title = CATEGORY_LABELS[cat];
    t.dataset.cat = cat;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', grid.id);
    t.addEventListener('click', () => { pickerCat = cat; paint(); });
    tabs.append(t);
  });

  search.addEventListener('input', paint);
  pop.append(tabs, grid);
  document.body.append(backdrop, pop);
  paint();

  // Anchored to the button, kept on screen — same arrangement as the
  // slide gallery, which opens from the other end of the editor.
  const r = anchorEl.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 20;
  const above = r.top - 20;
  const down = below >= 300 || below >= above;
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12))}px`;
  pop.style.maxHeight = `${Math.max(200, Math.min(560, down ? below : above))}px`;
  if (down) {
    pop.style.bottom = 'auto';
    pop.style.top = `${r.bottom + 8}px`;
  } else {
    pop.style.top = 'auto';
    pop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  }

  document.addEventListener('keydown', onPickerKey, true);
  search.focus();
}

/**
 * Place a new element.
 *
 * It cascades down-right from the top-right corner rather than always
 * landing in the same spot, so adding three in a row gives you three
 * visible elements instead of one hiding two. Anything already occupied
 * is stepped past.
 */
function addElement(q, id, ctx) {
  const items = listOf(q);
  if (items.length >= MAX_DECOR) return;

  const home = anchorPos(DEFAULT_ANCHOR);
  let x = home.x;
  let y = home.y;
  const clash = () => items.some((d) => Math.abs(d.x - x) < 4 && Math.abs(d.y - y) < 4);
  for (let guard = 0; clash() && guard < MAX_DECOR; guard += 1) {
    x = coord(x - 7);
    y = coord(y + 7);
  }

  items.push({ id, x, y, size: DEFAULT_SIZE,
    stroke: DEFAULT_STROKE, fill: DEFAULT_FILL, w: DEFAULT_WEIGHT,
    rot: 0, flip: false, op: 100 });
  selectDecor(q, items.length - 1);
  commit(q, items, ctx);
}

// =====================================================================
// The canvas — drag to place
// =====================================================================

/**
 * Lay a drag surface over the rendered editor canvas.
 *
 * `slide` is the .sp-slide returned by renderSlide(), which already has
 * the decor drawn into it. This adds the part you can grab: one handle
 * per element, the two shaded areas the projector's own furniture sits
 * in, and the alignment guides that appear mid-drag.
 */
export function mountDecorEditor(slide, q, ctx) {
  const items = listOf(q);
  const surface = el('div', 'decor-edit is-active');

  // Where the join card and the control bar will be in class. Decor
  // draws underneath both, so this is shown always and quietly rather
  // than as an error at the moment of the drop.
  const zones = el('div', 'decor-zones');
  RESERVED_ZONES.forEach((z) => {
    const box = el('span', 'decor-zone');
    box.title = `${z.label} sits here during class`;
    box.style.left = `${z.x1}%`;
    box.style.top = `${z.y1}%`;
    box.style.width = `${z.x2 - z.x1}%`;
    box.style.height = `${z.y2 - z.y1}%`;
    zones.append(box);
  });
  surface.append(zones);

  // Two lines, moved and shown as a drag finds something to line up with.
  const guides = el('div', 'decor-guides');
  const guideX = el('span', 'decor-guide decor-guide-x');
  const guideY = el('span', 'decor-guide decor-guide-y');
  guides.append(guideX, guideY);
  surface.append(guides);

  const active = selectedIndex(q);

  items.forEach((item, i) => {
    const handle = el('button', 'decor-handle');
    handle.type = 'button';
    handle.dataset.index = String(i);
    handle.setAttribute('aria-label',
      `${getElement(item.id)?.label || item.id}, ${posLabel(item.x, item.y)}. `
      + 'Drag to move, or use the arrow keys.');
    handle.style.left = `${item.x}%`;
    handle.style.top = `${item.y}%`;
    handle.style.setProperty('--decor-size', `${SIZES[item.size]}cqh`);
    if (i === active) handle.classList.add('is-selected');

    handle.addEventListener('click', (e) => {
      e.preventDefault();
      if (handle.dataset.dragged === '1') { handle.dataset.dragged = '0'; return; }
      selectFromCanvas(q, i === selectedIndex(q) ? -1 : i, ctx);
      ctx.onChange({ quiet: true });
    });

    // Keys the handle claims are claimed outright — stopPropagation as well
    // as preventDefault. The editor moves slide-to-slide on ArrowUp and
    // ArrowDown from a window listener, so a nudge that was allowed to bubble
    // moved the element half a percent AND jumped to the next slide, throwing
    // the selection away. Left and right worked, which made it look random.
    handle.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        const next = listOf(q);
        next.splice(i, 1);
        selectDecor(q, -1);
        commit(q, next, ctx);
        return;
      }
      const step = nudgeFor(e.key, e.shiftKey);
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      selectDecor(q, i);
      patchItem(q, i, { x: coord(item.x + step.x), y: coord(item.y + step.y) }, ctx);
    });

    wireDrag(handle, slide, surface, q, i, ctx, { guideX, guideY });
    surface.append(handle);
  });

  // A click on bare canvas drops the selection, the way it does in every
  // other editor — without it the only way to deselect is to find the
  // chip you came from.
  surface.addEventListener('pointerdown', (e) => {
    if (e.target === surface || e.target === zones || e.target === guides) {
      selectDecor(q, -1);
      ctx.onChange({ quiet: true });
    }
  });

  slide.append(surface);
  return surface;
}

/**
 * Pointer drag — free, with alignment guides.
 *
 * The element goes where you put it. As it comes within a hair of the
 * slide's centre, its thirds, its margins, or another element's centre,
 * a guide appears and the drag snaps onto that line — which is how two
 * marks end up actually aligned instead of nearly aligned. Hold Alt to
 * turn that off and place freehand.
 *
 * Pointer capture rather than window listeners, so a fast drag that
 * leaves the canvas still tracks and still lands.
 */
function wireDrag(handle, slide, surface, q, index, ctx, guideEls) {
  let dragging = false;
  let lines = null;
  let last = null;

  /** Pointer -> a position in slide percent, snapped unless Alt is held. */
  const posFor = (e) => {
    const r = slide.getBoundingClientRect();
    const raw = {
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    };
    if (e.altKey || !lines) return { x: coord(raw.x), y: coord(raw.y), snapX: null, snapY: null };

    const snapX = snapTo(raw.x, lines.xs);
    const snapY = snapTo(raw.y, lines.ys);
    return {
      x: coord(snapX ?? raw.x),
      y: coord(snapY ?? raw.y),
      snapX,
      snapY,
    };
  };

  const showGuides = (snapX, snapY) => {
    guideEls.guideX.classList.toggle('is-on', snapX != null);
    guideEls.guideY.classList.toggle('is-on', snapY != null);
    if (snapX != null) guideEls.guideX.style.left = `${snapX}%`;
    if (snapY != null) guideEls.guideY.style.top = `${snapY}%`;
  };

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    last = null;
    // computed once per drag: the other elements do not move while this
    // one is in the air, and recomputing per pointermove is wasted work
    lines = guideLines(listOf(q), index);
    handle.dataset.dragged = '0';
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    surface.classList.add('is-dragging');
    // Plain selectDecor, not selectFromCanvas: revealing the design panel
    // here would resize the stage under a pointer that is mid-drag. A
    // drag also needs no reveal — you can see where the thing went.
    selectDecor(q, index);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    handle.dataset.dragged = '1';
    const p = posFor(e);
    last = p;
    showGuides(p.snapX, p.snapY);
    // Follow the finger while held, so the drag reads as picking the
    // thing up rather than as scrubbing an invisible control. Live, not
    // committed — nothing is saved until the release.
    handle.style.left = `${p.x}%`;
    handle.style.top = `${p.y}%`;
    const art = slide.querySelector(`.decor-layer .decor-item[data-decor-index="${index}"]`);
    if (art) {
      art.style.left = `${p.x}%`;
      art.style.top = `${p.y}%`;
    }
  });

  const finish = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-dragging');
    surface.classList.remove('is-dragging');
    showGuides(null, null);
    if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);

    // Land where the pointer was RELEASED, not where it was last seen
    // moving. Those are usually the same place, but a release that
    // outruns the last move event would otherwise drop the element where
    // the instructor had already dragged past. A cancel carries no
    // meaningful position, so it keeps the last live position.
    const p = (e.type === 'pointerup' && Number.isFinite(e.clientX)) ? posFor(e) : last;

    if (p) patchItem(q, index, { x: p.x, y: p.y }, ctx);
    else ctx.onChange({ quiet: true });
  };

  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}
