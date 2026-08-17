/**
 * SurveyAll — the instructor door.
 *
 * One document, two entrances: /login opens the sign-in form and /create
 * opens the sign-up form (the Worker serves account.html for both paths).
 * Students never come here — they go to /join.
 */

import { signIn, signUp, signUpEnabled, currentUser, health } from './db.js';

const $ = (id) => document.getElementById(id);

// /create is the direct link to the sign-up form; anything else is sign-in.
const wantsSignUp = /^\/create\/?$/.test(window.location.pathname);

init();

async function init() {
  // Already signed in? Straight to the dashboard — unless they asked for
  // /create, which is a deliberate request for the sign-up form.
  const user = await currentUser();
  if (user && !wantsSignUp && new URLSearchParams(window.location.search).get('stay') !== '1') {
    window.location.replace(nextTarget());
    return;
  }

  $('showSignUp').addEventListener('click', () => show('signup', 'suCode'));
  $('backToSignIn').addEventListener('click', () => show('auth', 'username'));

  $('authForm').addEventListener('submit', onSignIn);
  $('signUpForm').addEventListener('submit', onSignUp);

  // Only offer the sign-up door when the server actually has a code
  // configured — otherwise every attempt would fail at submit with a
  // message the person reading it can do nothing about.
  signUpEnabled().then((enabled) => {
    $('toSignUpWrap').hidden = !enabled;
    // Same reasoning for a /create link: with sign-up closed, show the
    // sign-in form rather than a form that cannot succeed.
    if (enabled && wantsSignUp) show('signup', 'suCode');
  });

  // Check the API in the background. If the backend genuinely isn't wired
  // up yet it's better to say so than to fail mysteriously at the first
  // click.
  health().then((res) => {
    if (res.ok) return;
    show('setup');
    $('setupDetail').textContent = res.error || 'The API is not responding.';
  });
}

/** Exactly one panel is visible at a time. */
function show(id, focusId) {
  for (const panel of ['auth', 'signup', 'setup']) {
    $(panel).hidden = panel !== id;
  }
  if (focusId) $(focusId).focus();
}

async function onSignIn(e) {
  e.preventDefault();
  await submit({
    button: $('authSubmit'),
    error: $('authError'),
    busyLabel: 'Signing in…',
    idleLabel: 'Sign in',
    run: () => signIn($('username').value, $('password').value),
  });
}

async function onSignUp(e) {
  e.preventDefault();
  await submit({
    button: $('signUpSubmit'),
    error: $('signUpError'),
    busyLabel: 'Creating account…',
    idleLabel: 'Create account',
    run: () => signUp($('suUsername').value, $('suPassword').value, $('suCode').value),
  });
}

/** Shared submit choreography: disable, run, navigate or report. */
async function submit({ button, error, busyLabel, idleLabel, run }) {
  error.textContent = '';
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    await run();
    window.location.href = nextTarget();
  } catch (err) {
    error.textContent = friendly(err.message || String(err));
    button.disabled = false;
    button.textContent = idleLabel;
  }
}

function friendly(msg) {
  if (/reach the server/i.test(msg)) {
    return 'Could not reach the server. Check your connection.';
  }
  // Everything else — wrong password, taken username, bad sign-up code,
  // rate limiting — is already phrased for a human in worker/auth.js, and
  // rewording it here would only risk saying something less true.
  return msg;
}

function nextTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith(window.location.origin)) return next;
  return 'dashboard.html';
}
