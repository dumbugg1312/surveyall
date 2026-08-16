/**
 * SurveyAll — landing page.
 * Two doors: students type a join code, instructors sign in or sign up.
 */

import { signIn, signUp, signUpEnabled, currentUser, health } from './db.js';

const $ = (id) => document.getElementById(id);

init();

async function init() {
  // Already signed in? Straight to the dashboard.
  const user = await currentUser();
  if (user && new URLSearchParams(window.location.search).get('stay') !== '1') {
    window.location.replace(nextTarget());
    return;
  }

  $('codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('code').value.trim().toUpperCase();
    if (code) window.location.href = `join.html#${encodeURIComponent(code)}`;
  });

  $('showSignIn').addEventListener('click', () => show('auth', 'username'));
  $('backToJoin').addEventListener('click', () => show('landing'));
  $('showSignUp').addEventListener('click', () => show('signup', 'suCode'));
  $('backToSignIn').addEventListener('click', () => show('auth', 'username'));

  $('authForm').addEventListener('submit', onSignIn);
  $('signUpForm').addEventListener('submit', onSignUp);

  // Only offer the sign-up door when the server actually has a code
  // configured — otherwise every attempt would fail at submit with a
  // message the person reading it can do nothing about.
  signUpEnabled().then((enabled) => { $('toSignUpWrap').hidden = !enabled; });

  // Check the API in the background. A student typing a code shouldn't
  // wait on this, but if the backend genuinely isn't wired up yet it's
  // better to say so than to fail mysteriously at the first click.
  health().then((res) => {
    if (res.ok) return;
    show('setup');
    $('setupDetail').textContent = res.error || 'The API is not responding.';
  });
}

/** Exactly one panel is visible at a time. */
function show(id, focusId) {
  for (const panel of ['landing', 'auth', 'signup', 'setup']) {
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
