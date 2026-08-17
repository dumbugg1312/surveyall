/**
 * SurveyAll — the quill button.
 *
 * A note-to-the-maintainer widget: one small button in the corner of the
 * instructor-facing pages, a dialog, and a POST. Import it and it mounts
 * itself — no markup to add per page:
 *
 *     <script type="module" src="app/feedback.js"></script>
 *
 * Two places it deliberately does NOT appear:
 *
 *   · join.html, the student view. A free-text box on a student's screen
 *     is a channel that could carry a name, and the promise this app
 *     makes is that no such channel exists. Feedback about the student
 *     experience reaches you through the instructor who ran the session.
 *   · present.html, the projector. Nothing decorative belongs on a screen
 *     a hundred people are looking at, and a stray click mid-lecture
 *     opening a dialog over a live question is its own small disaster.
 *
 * The dialog is a native <dialog>, so focus trapping, Escape, and the
 * backdrop come from the browser rather than from code that has to be
 * maintained.
 */

import { sendFeedback } from './db.js';

const MAX = 2000;

mount();

function mount() {
  if (document.getElementById('fbButton')) return;

  const button = document.createElement('button');
  button.id = 'fbButton';
  button.className = 'fb-button';
  button.type = 'button';
  button.title = 'Send feedback';
  button.setAttribute('aria-label', 'Send feedback about this page');
  button.innerHTML = quill();

  const dialog = document.createElement('dialog');
  dialog.className = 'fb-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="fb-form" id="fbForm">
      <h2 class="fb-title">Tell me what's wrong with it</h2>
      <p class="fb-note" id="fbNote">
        This goes to whoever runs this site. Nothing is recorded about you
        beyond your username, and only if you're signed in.
      </p>
      <label class="sr-only" for="fbBody">Your feedback</label>
      <textarea id="fbBody" maxlength="${MAX}" rows="6"
                placeholder="What broke, what confused you, what you wish it did…"></textarea>
      <div class="fb-error" id="fbError" hidden></div>
      <div class="fb-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="fbCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="fbSend">Send</button>
      </div>
    </form>
  `;

  // Where the button lives depends on whether the page has a chrome to
  // live in. Floating over the editor put it on top of the theme tiles in
  // the design panel — a decorative button covering a control is worse
  // than no button — so any page with an app bar gets it in the bar, and
  // only the plain pages (home, sign-in, privacy) float one in the
  // corner.
  const bar = document.querySelector('header.appbar');
  if (bar) {
    button.classList.add('fb-inline');
    const spacer = bar.querySelector('.spacer');
    if (spacer && spacer.nextSibling) bar.insertBefore(button, spacer.nextSibling);
    else bar.append(button);
  } else {
    document.body.append(button);
  }
  document.body.append(dialog);

  const $ = (id) => dialog.querySelector(`#${id}`) || document.getElementById(id);
  const field = $('fbBody');
  const error = $('fbError');
  const send = $('fbSend');

  button.addEventListener('click', () => {
    error.hidden = true;
    dialog.showModal();
    field.focus();
  });

  $('fbCancel').addEventListener('click', () => dialog.close());

  send.addEventListener('click', async () => {
    const text = field.value.trim();
    if (text.length < 2) {
      error.textContent = 'Write something first.';
      error.hidden = false;
      field.focus();
      return;
    }

    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      // The path only — never location.href, which on the editor carries
      // a deck id in the query string. See feedbackPage() in the Worker.
      await sendFeedback(text, window.location.pathname);
      field.value = '';
      dialog.close();
      thanks(button);
    } catch (err) {
      error.textContent = err.message || 'That did not send.';
      error.hidden = false;
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
    }
  });

  // Ctrl/Cmd+Enter sends, because the button is a mouse move away from a
  // textarea somebody is already typing in.
  field.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send.click();
  });
}

/** A brief acknowledgement in place of the button, then back to normal. */
function thanks(button) {
  const toast = document.createElement('div');
  toast.className = 'fb-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = 'Sent — thank you.';
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4000);
  button.classList.add('is-sent');
  setTimeout(() => button.classList.remove('is-sent'), 2000);
}

/** A quill, drawn rather than fetched: one more file to load is one more
 *  thing that can fail in a classroom on hotel wifi. */
function quill() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M20 4c-8.5.6-13 4.7-14.4 9.6-.5 1.8-.4 3.4-.2 4.4C7 15 9.6 12.8 13 12"/>
      <path d="M4.6 19.4C4.2 18 4 16.6 4.2 15"/>
      <path d="M20 4c.4 3.4-.3 6.4-1.8 8.6"/>
    </svg>
  `;
}
