/**
 * SurveyAll — the public home page.
 *
 * The page is complete without this script: every claim, both call-to-
 * action pairs and the student link are plain markup. All this adds is
 * the three things only the running site knows — whether you're already
 * signed in, whether sign-up is open, and what a real QR code to this
 * site's join page looks like.
 */

import { currentUser, signUpEnabled } from './db.js';
import { renderQR } from './qr.js';

init();

async function init() {
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

  // A real code for this site's join page — the mock on the projector
  // says "scan this", so it should survive being scanned.
  renderQR(document.getElementById('heroQR'), new URL('join', window.location.href).href,
    { dark: '#1c2434', light: '#ffffff', margin: 1 });
}
