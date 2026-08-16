/**
 * SurveyAll — landing page.
 * Two doors: students type a join code, the instructor signs in.
 */

import { signIn, currentUser, health } from './db.js';

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

  $('showSignIn').addEventListener('click', () => {
    $('landing').hidden = true;
    $('auth').hidden = false;
    $('password').focus();
  });

  $('backToJoin').addEventListener('click', () => {
    $('auth').hidden = true;
    $('landing').hidden = false;
  });

  $('authForm').addEventListener('submit', onAuth);

  // Check the API in the background. A student typing a code shouldn't
  // wait on this, but if the backend genuinely isn't wired up yet it's
  // better to say so than to fail mysteriously at the first click.
  health().then((res) => {
    if (res.ok) return;
    $('landing').hidden = true;
    $('auth').hidden = true;
    $('setup').hidden = false;
    $('setupDetail').textContent = res.error || 'The API is not responding.';
  });
}

async function onAuth(e) {
  e.preventDefault();
  const password = $('password').value;
  const err = $('authError');
  const btn = $('authSubmit');

  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    await signIn(null, password);
    window.location.href = nextTarget();
  } catch (e2) {
    err.textContent = friendly(e2.message || String(e2));
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

function friendly(msg) {
  if (/incorrect password/i.test(msg)) {
    return 'That password doesn\'t match the one set on the server.';
  }
  if (/reach the server/i.test(msg)) {
    return 'Could not reach the server. Check your connection.';
  }
  return msg;
}

function nextTarget() {
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith(window.location.origin)) return next;
  return 'dashboard.html';
}
