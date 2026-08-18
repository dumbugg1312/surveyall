/**
 * SurveyAll — the small shared chrome vocabulary.
 *
 * Every instructor-facing page had grown its own `el()`, its own `button()`
 * and its own `toast()`, and they had drifted: three toast durations, one
 * page announcing to a screen reader and two silent, one modal shell with
 * a focus trap and three without. None of that was a decision — it was the
 * cost of the fourth page being written after the first three.
 *
 * The rule here is that a component exists once and the good version wins.
 * The dialog is the dashboard's (it was the one with the working focus
 * return), plus the gallery's focus trap, which the dashboard lacked.
 */

// --------------------------------------------------------------- elements

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** A `<button type=button>`, which is never the accidental form submit. */
export function button(label, cls, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls || ''}`.trim();
  b.textContent = label;
  if (fn) b.addEventListener('click', fn);
  return b;
}

export function linkBtn(label, cls, href) {
  const a = document.createElement('a');
  a.className = `btn ${cls || ''}`.trim();
  a.href = href;
  a.textContent = label;
  return a;
}

export function chip(text, cls) {
  return el('span', `chip ${cls || ''}`.trim(), text);
}

export function emptyState(title, text, actions) {
  const wrap = el('div', 'empty-state');
  wrap.append(el('h3', null, title), el('p', null, text));
  if (actions?.length) {
    const row = el('div', 'row');
    actions.forEach((a) => row.append(a));
    wrap.append(row);
  }
  return wrap;
}

// ------------------------------------------------------------------ toast

let toastTimer = null;

/**
 * The toast elements themselves carry role="status", so this does not
 * mirror into a second live region: that is how the dashboard used to say
 * everything twice.
 */
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), ms);
}

// ----------------------------------------------------------------- dialog

let modalSeq = 0;

/**
 * Keep Tab inside the dialog. Without this, tabbing off the last control
 * walks into the page behind — which is still there, still scrollable, and
 * for a screen reader indistinguishable from the dialog's own content.
 */
function trapFocus(root, onEscape) {
  const SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]),'
    + ' textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll(SELECTOR)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
  document.addEventListener('keydown', onKey, true);
  return () => document.removeEventListener('keydown', onKey, true);
}

/**
 * One modal shell for asking a question and getting an answer back.
 *
 * Escape closes, the backdrop closes, Enter submits, focus starts inside,
 * stays inside, and returns to whatever opened it. Resolves null on cancel,
 * so a caller can tell "cancelled" from "submitted empty".
 */
export function openModal({
  title, blurb, build, confirmLabel = 'OK', danger, cancelLabel = 'Cancel',
}) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const backdrop = el('div', 'modal-backdrop');

    const form = document.createElement('form');
    form.className = 'modal';
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-modal', 'true');

    const heading = el('h2', null, title);
    heading.id = `modal-title-${(modalSeq += 1)}`;
    form.setAttribute('aria-labelledby', heading.id);
    form.append(heading);

    if (blurb) {
      const p = el('p', 'modal-blurb', blurb);
      p.id = `modal-blurb-${modalSeq}`;
      form.setAttribute('aria-describedby', p.id);
      form.append(p);
    }

    const getValue = build ? build(form) : () => true;

    const row = el('div', 'row modal-actions');
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
    submit.textContent = confirmLabel;
    row.append(button(cancelLabel, '', () => close(null)), submit);
    form.append(row);

    let releaseTrap = null;
    function close(value) {
      releaseTrap?.();
      backdrop.remove();
      opener?.focus?.();
      resolve(value);
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); close(getValue()); });
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(null); });

    backdrop.append(form);
    document.body.append(backdrop);
    releaseTrap = trapFocus(form, () => close(null));

    const first = form.querySelector('input, textarea') || submit;
    first.focus();
    if (first.select) first.select();
  });
}

/** @returns {Promise<string|null>} trimmed text, or null if cancelled. */
export function askText({
  title, blurb, label, value = '', placeholder = '', confirmLabel = 'Save', multiline = false,
}) {
  let input;
  return openModal({
    title,
    blurb,
    confirmLabel,
    build(form) {
      const field = el('div', 'field');
      const lab = document.createElement('label');
      lab.htmlFor = `modal-input-${modalSeq}`;
      lab.textContent = label;
      input = document.createElement(multiline ? 'textarea' : 'input');
      if (!multiline) input.type = 'text';
      else input.rows = 10;
      input.id = lab.htmlFor;
      input.value = value;
      input.placeholder = placeholder;
      field.append(lab, input);
      form.append(field);
      return () => input.value.trim();
    },
  });
}

/**
 * A destructive confirm. `blurb` is where the consequence goes, in the
 * caller's own words and with real numbers — "this also deletes 3 sessions
 * and 1,204 recorded answers" tells somebody something; "are you sure?"
 * does not.
 *
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, blurb, confirmLabel = 'Delete', danger = true }) {
  return openModal({ title, blurb, confirmLabel, danger }).then((v) => v === true);
}

/**
 * A password prompt that is a real dialog rather than window.prompt —
 * which cannot be labelled, cannot be styled, and on repeat use offers the
 * browser's own "prevent this page from creating additional dialogs".
 *
 * @returns {Promise<string|null>}
 */
export function askPassword({ title, blurb, label = 'New password', confirmLabel = 'Set password' }) {
  let input;
  return openModal({
    title,
    blurb,
    confirmLabel,
    build(form) {
      const field = el('div', 'field');
      const lab = document.createElement('label');
      lab.htmlFor = `modal-input-${modalSeq}`;
      lab.textContent = label;
      input = document.createElement('input');
      input.type = 'password';
      input.id = lab.htmlFor;
      input.autocomplete = 'new-password';
      input.minLength = 4;
      field.append(lab, input);
      form.append(field);
      return () => input.value;
    },
  });
}

// ------------------------------------------------------------------ misc

export function fmt(n) {
  return Number(n || 0).toLocaleString();
}
