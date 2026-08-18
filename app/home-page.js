/**
 * SurveyAll — the public home page.
 *
 * The page is complete without this script: every claim, both call-to-
 * action pairs, the student link and the video's poster frame are plain
 * markup. All this adds is the four things only the running browser
 * knows — whether you're already signed in, whether sign-up is open, what
 * address this particular deployment answers on, and whether you have
 * asked your system for less motion.
 */

import { currentUser, signUpEnabled } from './db.js';
import { joinBase } from './config.js';

init();

function init() {
  // A signed-in instructor wants their decks, not the pitch. `?stay=1`
  // is the way back to this page (the dashboard's sign-out uses it, and
  // it's how you show the home page while logged in).
  const staying = new URLSearchParams(window.location.search).get('stay') === '1';
  if (!staying) {
    currentUser().then((user) => {
      if (user) window.location.replace('dashboard.html');
    });
  }

  // Sign-up is only offered when the server has a sign-up code set;
  // otherwise every button here would lead to a form that can't succeed,
  // so those visitors are left with the sign-in door only.
  signUpEnabled().then((enabled) => {
    if (enabled) return;
    for (const el of document.querySelectorAll('[data-signup]')) el.hidden = true;
  });

  joinAddress();
  video();
}

/**
 * The address students type when they can't scan.
 *
 * Derived from the address bar rather than written into the markup,
 * because this repo is meant to be forked: a literal domain in index.html
 * would tell one deployment's students to visit another deployment. Same
 * source of truth as the QR code and the projector's join card, which
 * both go through joinBase().
 *
 * The markup ships with a sentence that is true on every deployment, so a
 * visitor with no JavaScript is told something correct rather than
 * nothing.
 */
function joinAddress() {
  const el = document.getElementById('joinAddress');
  if (!el) return;
  const base = joinBase();
  if (!base) return;
  el.textContent = `${base.replace(/^https?:\/\//, '')}/join`;
}

/**
 * The hero loop.
 *
 * `autoplay` is set here rather than in the markup, because the one
 * setting that must be able to stop it — prefers-reduced-motion — is not
 * something HTML can express. Someone who has asked for less motion gets
 * the poster frame and a button; everyone else gets the loop.
 *
 * A silent muted loop is allowed to autoplay everywhere, but play() can
 * still be refused (Low Power Mode on iOS, a data-saver extension), so
 * the promise is caught and the button offered as the way back in rather
 * than leaving a frozen frame with no explanation.
 */
function video() {
  const el = document.getElementById('heroVideo');
  const toggle = document.getElementById('videoToggle');
  if (!el || !toggle) return;

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  // The control stays on screen whether or not it is currently needed. A
  // button that appears only once something has gone wrong is a button
  // nobody finds, and a minute-long loop beside the text you are trying
  // to read is a reasonable thing to want to stop.
  const label = () => {
    toggle.textContent = el.paused ? 'Play' : 'Pause';
    toggle.setAttribute('aria-label', el.paused ? 'Play the tour' : 'Pause the tour');
    toggle.hidden = false;
  };

  // Driven by the events rather than by the click handler, so the label
  // still tells the truth when something else changes playback — the
  // browser pausing a background tab, or picture-in-picture.
  el.addEventListener('play', label);
  el.addEventListener('pause', label);

  toggle.addEventListener('click', () => {
    if (el.paused) el.play().catch(label); else el.pause();
  });

  // Data Saver is a request not to spend somebody's cellular allowance on
  // decoration, and this loop is 5 MB of it. Same treatment as reduced
  // motion: the poster frame, and a button for anyone who wants it.
  const thrifty = () => navigator.connection?.saveData === true;

  const start = () => {
    if (still.matches || thrifty()) { el.pause(); label(); return; }
    el.play().catch(() => {});
    label();
  };

  start();
  // Someone can turn reduced motion on while the page is open; on macOS
  // that happens the moment Low Power Mode kicks in.
  still.addEventListener('change', start);
}
