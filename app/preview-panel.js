/**
 * SurveyAll — "what will they see?", answered before the class arrives.
 *
 * Opens the real projector and the real phone side by side, driven by a
 * make-believe room (app/preview-room.js) that never touches the
 * database. The instructor can walk the whole deck, close voting, run a
 * discussion round, watch the leaderboard — and, with one switch, fill
 * the room with invented answers so the charts have something to draw.
 *
 * The two panes are iframes rather than a bespoke renderer, which is the
 * only version of this feature worth shipping: a hand-drawn preview is a
 * second implementation of the projector that starts drifting from the
 * real one the day it lands. These are present.html and join.html, at
 * their real sizes, scaled down to fit.
 */

import { createPreviewRoom } from './preview-room.js';

/** Real pixels, then scaled — so the projector lays out like a projector. */
const PROJECTOR = { w: 1280, h: 720 };
const PHONE = { w: 390, h: 844 };

/**
 * The banner. It stays in the instructor's eyeline the whole time,
 * because the one dangerous misreading of this screen is "the class can
 * see this" — or, once the switch is on, "somebody answered".
 */
const NOTE_IDLE = 'Preview. Nothing is saved and nobody can join. '
  + 'Your real join code is unused.';
const NOTE_TESTING = 'Invented answers, from nobody. Nothing is saved.';

let open = null;

/**
 * @param {object} deck       the deck as it stands in the editor
 * @param {object[]} questions the slide list, unsaved edits included
 */
export function openPreview(deck, questions) {
  if (open) return;
  if (!questions.length) return;

  const room = createPreviewRoom(deck, questions);
  const cleanups = [];

  // -------------------------------------------------------------- shell

  const backdrop = el('div', 'preview-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Preview this deck');

  const sheet = el('div', 'preview-sheet');

  // ---------------------------------------------------------------- bar

  const bar = el('header', 'preview-bar');

  const toggle = el('label', 'preview-switch');
  const check = document.createElement('input');
  check.type = 'checkbox';
  const track = el('span', 'preview-switch-track');
  track.append(el('span', 'preview-switch-thumb'));
  toggle.append(check, track, el('span', null, 'Show test responses'));

  const note = el('p', 'preview-note', NOTE_IDLE);

  const close = el('button', 'preview-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close preview');
  close.append(el('span', null, 'Close'), Object.assign(document.createElement('kbd'),
    { textContent: 'Esc' }));

  bar.append(toggle, note, close);

  // ------------------------------------------------------------ screens

  const screens = el('div', 'preview-screens');

  const projector = pane('Your screen', 'What the room sees, at projector size.');
  const projectorFrame = frame(`present.html?preview=1&session=${encodeURIComponent(room.sessionId)}`,
    'Projector preview');
  projector.fit.append(sized(projectorFrame, PROJECTOR));

  const phone = pane('A student\'s phone', 'Answer here, and it lands on the projector.');
  phone.wrap.classList.add('preview-pane-phone');
  const phoneFrame = frame(`join.html?preview=1#${encodeURIComponent(room.joinCode)}`,
    'Participant preview');
  const device = el('div', 'preview-device');
  device.append(sized(phoneFrame, PHONE));
  phone.fit.append(device);

  screens.append(projector.wrap, phone.wrap);
  sheet.append(bar, screens);
  backdrop.append(sheet);
  document.body.append(backdrop);

  // aria-modal is a claim, and `inert` is what makes it true: without it
  // the rail behind the dialog is still tabbable and a screen reader will
  // happily walk into a deck the instructor cannot see.
  const behind = [...document.body.children].filter((n) => n !== backdrop);
  behind.forEach((n) => { n.inert = true; });
  cleanups.push(() => behind.forEach((n) => { n.inert = false; }));

  // ------------------------------------------------------------- sizing
  //
  // Each pane holds a real-sized document and scales it to whatever room
  // it has. Done here rather than in CSS because the scale depends on two
  // measurements CSS cannot compare.

  const fits = [projector.fit, phone.fit];

  const resize = () => {
    for (const host of fits) {
      const child = host.firstElementChild;
      const box = host.getBoundingClientRect();
      // offsetWidth/Height are the untransformed size, so this stays
      // stable no matter what scale is already applied. The phone's
      // bezel is measured with it, and shrinks with the phone.
      const w = child?.offsetWidth;
      const h = child?.offsetHeight;
      if (!box.width || !box.height || !w || !h) continue;
      host.style.setProperty('--preview-scale',
        String(Math.max(0.05, Math.min(box.width / w, box.height / h))));
    }
  };

  const observer = new ResizeObserver(resize);
  fits.forEach((host) => observer.observe(host));
  cleanups.push(() => observer.disconnect());
  resize();

  // ------------------------------------------------------------- wiring

  check.addEventListener('change', () => {
    room.setTestResponses(check.checked);
    note.textContent = check.checked ? NOTE_TESTING : NOTE_IDLE;
  });

  close.addEventListener('click', shut);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) shut(); });

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    shut();
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  // Escape has to work from inside the panes too, or it stops working the
  // moment you click the projector to use its arrow keys. The projector
  // spends Escape on its own Q&A drawer first — that one is a real
  // control with a real open state, so it wins while it is showing.
  [projectorFrame, phoneFrame].forEach((f) => {
    f.addEventListener('load', () => {
      const win = f.contentWindow;
      if (!win) return;
      const handler = (e) => {
        if (e.key !== 'Escape') return;
        if (win.document.getElementById('qaPanel')?.classList.contains('is-open')) return;
        shut();
      };
      win.addEventListener('keydown', handler);
      cleanups.push(() => { try { win.removeEventListener('keydown', handler); } catch { /* gone */ } });
    });
  });

  // Focus the projector so ← and → drive the deck straight away. That is
  // how this gets used: click Preview, then arrow through the lesson.
  projectorFrame.addEventListener('load', () => {
    try { projectorFrame.contentWindow.focus(); } catch { /* cross-doc focus refused */ }
  }, { once: true });

  open = { backdrop, room, cleanups };

  function shut() {
    if (!open) return;
    cleanups.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    room.destroy();
    forgetParticipantState(room.sessionId);
    backdrop.remove();
    open = null;
  }
}

/**
 * The phone stores its label and its answers in sessionStorage, keyed by
 * session. A preview session is thrown away when the dialog closes, so
 * its keys go with it — otherwise reopening the preview would restore
 * yesterday's pretend answers and a nickname for a room that never was.
 */
function forgetParticipantState(sessionId) {
  try {
    const doomed = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const key = window.sessionStorage.key(i);
      // Split, not includes: session ids are colon-separated segments and
      // "preview-1" is a prefix of "preview-10".
      if (key && key.startsWith('surveyall:') && key.split(':').includes(sessionId)) {
        doomed.push(key);
      }
    }
    doomed.forEach((k) => window.sessionStorage.removeItem(k));
  } catch { /* private browsing — nothing was stored to begin with */ }
}

// ------------------------------------------------------------- builders

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function pane(title, sub) {
  const wrap = el('section', 'preview-pane');
  const head = el('p', 'preview-pane-title', title);
  const fit = el('div', 'preview-fit');
  wrap.append(head, fit, el('p', 'preview-pane-sub', sub));
  return { wrap, fit };
}

function frame(src, title) {
  const f = document.createElement('iframe');
  f.className = 'preview-frame';
  f.title = title;
  f.src = src;
  return f;
}

/** Give a frame its true pixel size; CSS scales the wrapper down to fit. */
function sized(node, size) {
  const box = el('div', 'preview-sized');
  box.style.width = `${size.w}px`;
  box.style.height = `${size.h}px`;
  node.style.width = `${size.w}px`;
  node.style.height = `${size.h}px`;
  box.append(node);
  return box;
}
