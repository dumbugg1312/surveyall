/**
 * SurveyAll — Cloudflare Worker API.
 *
 * This one Worker serves BOTH the static site and the API, so there is a
 * single deploy, one origin, and no CORS to configure. Requests matching
 * a file in the repo are served as static assets; everything under /api/
 * lands here.
 *
 * This file replaces what Postgres Row Level Security used to do. On
 * Supabase the database itself refused to hand a quiz answer key to a
 * student; D1 has no such mechanism, so these handlers are the only
 * thing standing between a participant and data they must not see.
 * Four rules, enforced here and nowhere else:
 *
 *   1. `sanitiseQuestion()` strips answer keys before any question is
 *      sent to a phone.
 *   2. A participant may write a response ONLY to the currently-live
 *      question, in a live session that is accepting, at the current
 *      round — checked against the database, not trusted from the body.
 *   3. A participant may never read raw responses. Aggregates are served
 *      only once the presenter has both revealed AND pushed to devices.
 *   4. Every instructor route requires a valid token before it touches
 *      anything.
 *   5. Every instructor route is scoped to the signed-in user. This one
 *      is newer than the others and is the easiest to get wrong: it is
 *      not enough to know that SOMEBODY is signed in, because a bare
 *      resource id in a URL says nothing about who owns it. Route
 *      handlers below therefore never query by id alone — they go
 *      through ownedDeck/ownedSession/ownedQuestion/… which join back to
 *      an owner_id, and treat "not yours" as 404 so the existence of
 *      another instructor's data is never confirmed.
 *
 * If you edit this file, re-run the security probes in docs/HANDOFF.md.
 */

import { SessionRoom } from './session-room.js';
import {
  changePassword, currentUser, questionPermutation, resetPassword, signIn, signUp,
  signPseudonym, verifyPseudonym,
} from './auth.js';

export { SessionRoom };

// =====================================================================
// Small helpers
// =====================================================================

const json = (data, status = 200) => new Response(
  JSON.stringify(data),
  { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
);

const fail = (message, status = 400) => json({ error: message }, status);
const now = () => Date.now();
const uid = () => crypto.randomUUID();

const parse = (text, fallback) => {
  try { return JSON.parse(text); } catch { return fallback; }
};

/** SQLite stores booleans as 0/1; the frontend expects real booleans. */
function rowToSession(row) {
  if (!row) return null;
  const out = {
    ...row,
    accepting: !!row.accepting,
    reveal: !!row.reveal,
    show_on_devices: !!row.show_on_devices,
    qa_moderated: !!row.qa_moderated,
  };
  // Only the list query carries the aggregate counts. Normalise them when
  // they are present and leave them absent when they are not, so a reader
  // can still tell "nobody answered" from "nobody asked" — reporting 0 on
  // a single-session read would be a lie about data we simply didn't fetch.
  for (const key of ['response_count', 'participant_count', 'answered_count']) {
    if (key in row) out[key] = Number(row[key]) || 0;
  }
  if ('last_response_at' in row) out.last_response_at = row.last_response_at ?? null;
  return out;
}

function rowToDeck(row) {
  if (!row) return null;
  return {
    ...row,
    background: parse(row.background, { kind: 'theme' }),
    settings: parse(row.settings, {}),
  };
}

function rowToQuestion(row) {
  if (!row) return null;
  return { ...row, config: parse(row.config, {}) };
}

function rowToResponse(row) {
  if (!row) return null;
  return { ...row, payload: parse(row.payload, {}) };
}

/**
 * Remove everything that could give away a graded answer.
 * This is the single most security-sensitive function in the file: if an
 * answer key reaches a phone, every quiz is trivially cheatable by
 * opening the network tab.
 */
async function sanitiseQuestion(env, question) {
  const config = { ...(question.config || {}) };
  delete config.correct;
  delete config.correct_answers;
  delete config.answer_key;
  // calibration anchors (the instructor's own rubric rating) would bias
  // the student ratings they exist to be compared against
  delete config.anchors;

  // options may themselves carry a per-option correctness flag
  if (Array.isArray(config.options)) {
    config.options = config.options.map((opt) => {
      if (opt && typeof opt === 'object') {
        const { correct, ...rest } = opt;
        return rest;
      }
      return opt;
    });
  }

  // The four types below keep no field called `correct`, so the deletions
  // above never touched them. Each hides its key somewhere structural
  // instead, and each needs its own answer.
  switch (question.type) {
    // The sentence carries its own key inline — "the [mitochondrion] is" —
    // so the text itself is the thing that cannot be sent. Send the shape
    // of the sentence with every blank emptied: clozeParts() still finds
    // the blanks, so the phone still renders the right number of inputs,
    // and each one simply arrives with no answers attached.
    case 'cloze':
      config.text = String(config.text || '').replace(/\[[^\]]*\]/g, '[]');
      break;

    // The instructor's own estimate is the answer to the question being
    // asked. It is only ever needed to draw the marker on the result.
    case 'probability':
      delete config.truth;
      break;

    // Graded by position: event i is right when it lands at place i. Send
    // the events in a server-seeded order so position carries nothing.
    case 'timeline': {
      const items = Array.isArray(config.items) ? config.items : [];
      const order = await questionPermutation(env, question.id, items.length);
      config.items = order.map((from) => items[from]);
      break;
    }

    // Graded by pairing: left i is right when it points at right i. The
    // lefts can stay put — it is the correspondence that is secret — so
    // permute only the rights against them.
    case 'matching': {
      const pairs = Array.isArray(config.pairs) ? config.pairs : [];
      const order = await questionPermutation(env, question.id, pairs.length);
      config.pairs = pairs.map((pair, i) => ({
        ...(pair && typeof pair === 'object' ? pair : {}),
        left: typeof pair === 'string' ? pair : pair?.left ?? '',
        right: pairs[order[i]] && typeof pairs[order[i]] === 'object'
          ? pairs[order[i]].right ?? '' : '',
      }));
      break;
    }

    default:
      break;
  }

  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    position: question.position,
    config,
  };
}

/**
 * Undo sanitiseQuestion()'s display shuffle on the way back in.
 *
 * The phone answers in the order it was shown; `responses` has always
 * stored config-index space, and every grader, CSV export and archived row
 * from before this shuffle existed reads it that way. Translating here —
 * rather than at grading time — is what keeps all of that true.
 */
async function unshuffleAnswer(env, question, payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (question.type === 'timeline' && Array.isArray(payload.order)) {
    const items = Array.isArray(question.config?.items) ? question.config.items : [];
    const order = await questionPermutation(env, question.id, items.length);
    return { ...payload, order: payload.order.map((shown) => order[shown] ?? shown) };
  }

  if (question.type === 'matching' && Array.isArray(payload.matches)) {
    const pairs = Array.isArray(question.config?.pairs) ? question.config.pairs : [];
    const order = await questionPermutation(env, question.id, pairs.length);
    return {
      ...payload,
      matches: payload.matches.map((shown) => (shown == null ? shown : order[shown] ?? shown)),
    };
  }

  return payload;
}

/**
 * "Question 3 of 8" for the phone.
 *
 * A phone is handed one question, never the deck, so it cannot work out
 * its own place in the running order — and `position` is the wrong answer
 * anyway now that a deck can open with an instructions slide: slide 2 is
 * question 1. Counted here, in one aggregate, rather than shipping the
 * whole deck's shape to sixty devices.
 *
 * Content slides return number 0: they are not asked, so they are not
 * numbered. Kept in step with CONTENT_TYPES in app/logic.js.
 */
const CONTENT_SLIDE_TYPES = ['instructions'];

async function questionOrdinal(env, deckId, question) {
  if (CONTENT_SLIDE_TYPES.includes(question.type)) return { number: 0, total: 0 };
  const marks = CONTENT_SLIDE_TYPES.map(() => '?').join(', ');
  const row = await env.DB.prepare(`
    select
      count(*) as total,
      sum(case when position <= ? then 1 else 0 end) as number
    from questions
    where deck_id = ? and type not in (${marks})
  `).bind(question.position ?? 0, deckId, ...CONTENT_SLIDE_TYPES).first();
  return { number: Number(row?.number || 0), total: Number(row?.total || 0) };
}

const ADJECTIVES = [
  'Amber', 'Brisk', 'Copper', 'Dusky', 'Ember', 'Fleet', 'Golden', 'Hazel',
  'Ivory', 'Jade', 'Keen', 'Lucid', 'Mellow', 'Nimble', 'Onyx', 'Plum',
  'Quiet', 'Russet', 'Silver', 'Teal', 'Umber', 'Verdant', 'Wispy', 'Zesty',
  'Bright', 'Cobalt', 'Drifting', 'Echo', 'Frosted', 'Glint', 'Hollow', 'Indigo',
];
const NOUNS = [
  'Falcon', 'Beacon', 'Cedar', 'Delta', 'Ellipse', 'Fern', 'Gable', 'Harbor',
  'Isle', 'Juniper', 'Kestrel', 'Lantern', 'Meridian', 'Nectar', 'Orbit', 'Pike',
  'Quarry', 'Ridge', 'Summit', 'Thistle', 'Umbra', 'Vessel', 'Willow', 'Zephyr',
  'Anchor', 'Bramble', 'Compass', 'Dune', 'Fathom', 'Grove', 'Hearth', 'Lumen',
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * A deck's permanent join code, assigned the first time anything needs it.
 *
 * Decks created before this feature have `join_code` NULL, and migrating
 * them in SQL would mean generating unique random values per row — so they
 * are filled in lazily here instead, and a bare `ALTER TABLE ADD COLUMN`
 * is the whole migration. The unique index on decks(join_code) is what
 * makes the retry meaningful: a collision raises rather than duplicating.
 */
async function ensureDeckCode(env, deck) {
  if (deck?.join_code) return deck.join_code;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateJoinCode(6);
    try {
      await env.DB.prepare('update decks set join_code = ? where id = ?')
        .bind(code, deck.id).run();
      return code;
    } catch (err) {
      if (attempt === 7) throw err; // ran out of code attempts
    }
  }
  return null;
}

/** No vowels (can't spell anything) and no 0/O/1/I/L (misread on a projector). */
function generateJoinCode(len = 6) {
  const alphabet = '23456789BCDFGHJKMNPQRSTVWXYZ';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Serve one uploaded backdrop as an actual image.
 *
 * Hand back the decoded bytes rather than a redirect so that
 * <img src="/api/backgrounds/:id"> and CSS url(...) just work and can be
 * cached. Both of those are fetched by the browser itself, which cannot
 * attach an Authorization header, so this route is reachable without a
 * token; the unguessable id is what protects it.
 *
 * This is the ONE route that rule 5 does not cover, so be precise about
 * what that means now that several instructors share an instance:
 * anybody holding a background's id can fetch that image, including
 * another instructor. What is exposed is a backdrop the owner chose to
 * project onto a wall in front of a room of people — their own art, no
 * student data in it, no way to reach anything else from it. Listing,
 * uploading and deleting are all owner-scoped, so a collection still
 * cannot be enumerated and ids do not leak between accounts.
 *
 * It is called out in privacy.html rather than left implicit, because
 * "images are served by unguessable URL" is a real property of the
 * system and someone reviewing it deserves to read it from us first.
 */
async function serveBackground(env, id) {
  const row = await env.DB.prepare('select data_uri from backgrounds where id = ?')
    .bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });
  const [meta, b64] = row.data_uri.split(',');
  const type = (meta.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

/**
 * Does this session's deck contain a quiz question?
 *
 * A deck is a competition exactly when something in it is scored, and the
 * plain-text importer already treats the two words as synonyms (`competition`
 * is an alias for the `quiz` type in app/deck-format.js). This is DERIVED on
 * every read rather than cached on the deck or session row, because question
 * types are edited through PATCH /api/questions/:id and replaced wholesale by
 * PUT, and neither touches those rows: a stored flag would go stale the moment
 * an instructor turned a poll into a quiz, including mid-session.
 *
 * A phone needs this to decide whether to show a student their nickname. It
 * discloses nothing: it says a quiz exists, not what any answer is.
 */
async function deckHasQuiz(env, sessionId) {
  const row = await env.DB.prepare(`
    select 1 as yes from questions q
    join sessions s on s.deck_id = q.deck_id
    where s.id = ? and q.type = 'quiz' limit 1
  `).bind(sessionId).first();
  return !!row;
}

/**
 * Custom-theme tokens for a participant. Decks can carry an
 * instructor-built theme (settings.customTheme, session.theme='custom');
 * phones don't load decks, so the join payload delivers the colours.
 * Sanitised to plain `--token: string` pairs — this is served to every
 * student device, so nothing else from settings may leak through.
 */
async function customThemeFor(env, deckId) {
  const row = await env.DB.prepare('select settings from decks where id = ?')
    .bind(deckId).first();
  let settings = {};
  try { settings = JSON.parse(row?.settings || '{}'); } catch { /* ignore */ }
  const c = settings.customTheme;
  if (!c || typeof c.tokens !== 'object') return null;
  const tokens = {};
  for (const [k, v] of Object.entries(c.tokens)) {
    if (k.startsWith('--') && typeof v === 'string' && v.length <= 200) tokens[k] = v;
  }
  return Object.keys(tokens).length ? { tokens, dark: !!c.dark } : null;
}

/** Ask the session's Durable Object to push an event to its room. */
async function notifyRoom(env, sessionId, event, data, to = 'all') {
  try {
    const id = env.SESSION_ROOM.idFromName(sessionId);
    const stub = env.SESSION_ROOM.get(id);
    await stub.fetch('https://room/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Room-Secret': env.AUTH_SECRET || '',
      },
      body: JSON.stringify({ event, data, to }),
    });
  } catch (err) {
    // A failed broadcast must never fail the write that triggered it.
    // Clients fall back to polling, so the worst case is a slower update.
    console.error('broadcast failed', err);
  }
}

// =====================================================================
// Router
// =====================================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith('/api/')) {
      // Static assets are handled by the assets binding; if we got here
      // the path simply doesn't exist.
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }

    if (!env.DB) return fail('D1 binding "DB" is not configured', 500);

    try {
      return await route(request, env, url, ctx);
    } catch (err) {
      console.error(err);
      return fail(err.message || 'Unexpected error', 500);
    }
  },
};

async function route(request, env, url, ctx) {
  const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const seg = path.split('/');
  const method = request.method.toUpperCase();
  const body = ['POST', 'PATCH', 'PUT'].includes(method)
    ? await request.json().catch(() => ({}))
    : {};

  // ---------------------------------------------------------------- auth
  if (seg[0] === 'auth') {
    if (seg[1] === 'signin' && method === 'POST') {
      const res = await signIn(env, body.username, body.password);
      if (!res.ok) return fail(res.error, res.status);
      return json({ token: res.token, user: res.user });
    }

    if (seg[1] === 'signup' && method === 'POST') {
      const res = await signUp(env, body.username, body.password, body.code);
      if (!res.ok) return fail(res.error, res.status);
      return json({ token: res.token, user: res.user });
    }

    // Does this server have sign-up switched on at all? The sign-up form
    // is hidden when it doesn't, rather than failing at submit. This
    // reveals only whether a code is configured, never what it is.
    if (seg[1] === 'config' && method === 'GET') {
      return json({ signup_enabled: !!env.SIGNUP_CODE });
    }

    if (seg[1] === 'check') {
      const user = await currentUser(request, env);
      return json({ ok: !!user, user: user || null });
    }

    if (seg[1] === 'password' && method === 'POST') {
      const user = await currentUser(request, env);
      if (!user) return fail('Sign in first.', 401);
      const res = await changePassword(env, user, body.current, body.next);
      if (!res.ok) return fail(res.error, res.status);
      return json({ ok: true });
    }

    // Admin-only. The only way back in for a colleague who forgot their
    // password, because no email address is stored to mail a link to.
    if (seg[1] === 'reset' && method === 'POST') {
      const user = await currentUser(request, env);
      if (!user) return fail('Sign in first.', 401);
      const res = await resetPassword(env, user, body.username, body.next);
      if (!res.ok) return fail(res.error, res.status);
      return json({ ok: true });
    }

    return fail('Unknown auth route', 404);
  }

  // ------------------------------------------------------- participants
  // Everything under /api/join/ is unauthenticated by design: a student
  // proves nothing, holds no credential, and is never identified.
  if (seg[0] === 'join') {
    return participantRoute(request, env, seg, method, body, url);
  }

  // ------------------------------------------------- backdrop images
  // Reachable without a token, and only ever one image at a time by its
  // id. See serveBackground() for why that is the right call: the
  // browser fetches these as <img src>/url(), which cannot carry an
  // Authorization header at all.
  if (seg[0] === 'backgrounds' && seg[1] && method === 'GET') {
    return serveBackground(env, seg[1]);
  }

  // --------------------------------------------------------- instructor
  // From here down, `user` is never optional. Every handler below scopes
  // its queries to user.id — see rule 5 in the file header.
  const user = await currentUser(request, env);
  if (!user) return fail('Sign in first.', 401);
  return instructorRoute(request, env, seg, method, body, url, ctx, user);
}

// =====================================================================
// Participant routes (no auth, ever)
// =====================================================================

async function participantRoute(request, env, seg, method, body, url) {
  const code = String(seg[1] || '').toUpperCase();
  if (!code) return fail('No session code', 400);

  // A code names a DECK, permanently, and resolves to whichever session of
  // that deck is currently worth joining: a live one first, then one still
  // in the lobby, newest first either way. Ended sessions are last so a
  // student scanning during the changeover between two runs of the same
  // deck lands on the new one rather than yesterday's.
  let session = rowToSession(await env.DB.prepare(`
    select s.* from sessions s
    join decks d on d.id = s.deck_id
    where d.join_code = ?
    order by case s.state when 'live' then 0 when 'lobby' then 1 else 2 end,
             s.created_at desc
    limit 1
  `).bind(code).first());

  // Older links carry a per-session code. They keep working: anything
  // already printed on a handout or bookmarked by a student still lands.
  if (!session) {
    session = rowToSession(
      await env.DB.prepare('select * from sessions where join_code = ?').bind(code).first(),
    );
  }

  if (!session) {
    // Distinguish "that deck exists, nothing is running" from "no such
    // code" — the first is a student who scanned early, and telling them
    // to check the code would send them hunting for a typo they didn't make.
    const deck = await env.DB.prepare('select id from decks where join_code = ?')
      .bind(code).first();
    return fail(deck
      ? 'Your instructor has not started this yet. Try again in a moment.'
      : 'No session found for that code.', 404);
  }

  const tail = seg[2] || '';

  // ---- realtime socket ------------------------------------------------
  if (tail === 'ws') {
    const id = env.SESSION_ROOM.idFromName(session.id);
    return env.SESSION_ROOM.get(id).fetch(
      new Request(`https://room/connect?role=participant`, request),
    );
  }

  // ---- the session itself (holds no student data) ---------------------
  if (!tail && method === 'GET') {
    return json({
      id: session.id,
      // Echo back the code that actually got them here, not the session's
      // own. A student who scanned the deck's QR must see the same six
      // characters the projector is showing — two codes for one room is
      // precisely the confusion a deck-level code exists to remove. It is
      // also what the phone re-queries with on refresh, and both resolve.
      join_code: code,
      theme: session.theme,
      state: session.state,
      current_question_id: session.current_question_id,
      current_round: session.current_round,
      accepting: session.accepting,
      reveal: session.reveal,
      show_on_devices: session.show_on_devices,
      qa_moderated: session.qa_moderated,
      // Whether a nickname is worth showing this student at all. See
      // deckHasQuiz(): on a deck nobody is being scored on, a nickname is
      // an invitation to adopt a persona and nothing else.
      has_quiz: await deckHasQuiz(env, session.id),
      // instructor-built theme colours, when the deck uses one
      custom_theme: session.theme === 'custom'
        ? await customThemeFor(env, session.deck_id) : null,
    });
  }

  // ---- the live question, answer key removed --------------------------
  if (tail === 'question' && method === 'GET') {
    if (session.state !== 'live' || !session.current_question_id) return json(null);
    const q = rowToQuestion(
      await env.DB.prepare('select * from questions where id = ?')
        .bind(session.current_question_id).first(),
    );
    if (!q) return json(null);
    return json({
      ...(await sanitiseQuestion(env, q)),
      ...(await questionOrdinal(env, session.deck_id, q)),
      round: session.current_round,
      accepting: session.accepting,
      reveal: session.reveal,
      show_on_devices: session.show_on_devices,
    });
  }

  // ---- claim a random per-session label --------------------------------
  if (tail === 'pseudonym' && method === 'POST') {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let name = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
      if (attempt > 12) name += ` ${100 + Math.floor(Math.random() * 900)}`;
      try {
        await env.DB.prepare(
          'insert into session_pseudonyms (session_id, pseudonym, claimed_at) values (?, ?, ?)',
        ).bind(session.id, name, now()).run();
        // The signature is what proves, on every later answer, that this
        // device is the one that claimed this label. See worker/auth.js.
        return json({
          pseudonym: name,
          token: await signPseudonym(env, session.id, name),
        });
      } catch {
        // unique violation — that label is taken in this room, try again
      }
    }
    return fail('Could not allocate a nickname.', 500);
  }

  // ---- submit an answer -------------------------------------------------
  if (tail === 'respond' && method === 'POST') {
    // Re-read the rules from the database rather than trusting the body.
    if (session.state !== 'live') return fail('This session is not live.', 409);
    if (!session.accepting) return fail('Voting just closed for this question.', 409);
    if (body.questionId !== session.current_question_id) {
      return fail('That question is no longer live.', 409);
    }
    if (Number(body.round) !== Number(session.current_round)) {
      return fail('That round has ended.', 409);
    }
    if (!body.pseudonym) return fail('Missing nickname.', 400);

    // The label is this answer's row key, so anyone who can send a label
    // can overwrite whatever that row holds. Accept only labels this
    // server signed, for this session. Without it, a crafted POST carrying
    // another student's label replaces their answer, which on a graded
    // quiz means destroying someone's score from a phone in the room.
    if (!(await verifyPseudonym(env, session.id, String(body.pseudonym), body.pseudonymToken))) {
      return fail('This device has not joined this session. Reload the page.', 403);
    }

    // The live question, re-read rather than trusted, because undoing the
    // display shuffle needs its real config — the one the phone never saw.
    const liveQuestion = rowToQuestion(
      await env.DB.prepare('select * from questions where id = ?')
        .bind(session.current_question_id).first(),
    );
    if (!liveQuestion) return fail('That question is no longer live.', 409);

    const slot = Number.isInteger(body.slot) ? body.slot : 0;
    const payload = await unshuffleAnswer(env, liveQuestion, body.payload ?? {});
    await env.DB.prepare(`
      insert into responses (session_id, question_id, round, pseudonym, slot, payload, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict (session_id, question_id, round, pseudonym, slot)
      do update set payload = excluded.payload, created_at = excluded.created_at
    `).bind(
      session.id, body.questionId, Number(body.round),
      String(body.pseudonym), slot, JSON.stringify(payload), now(),
    ).run();

    const row = rowToResponse(
      await env.DB.prepare(`
        select * from responses
        where session_id = ? and question_id = ? and round = ? and pseudonym = ? and slot = ?
      `).bind(session.id, body.questionId, Number(body.round), String(body.pseudonym), slot).first(),
    );

    // Raw rows go ONLY to presenter sockets.
    await notifyRoom(env, session.id, 'response', row, 'presenter');
    return json(row);
  }

  // ---- aggregates for the student's own phone ---------------------------
  if (tail === 'results' && method === 'GET') {
    // Two switches must both be on. `reveal` alone means "on the
    // projector"; pushing to phones is a separate, deliberate act.
    if (!session.reveal || !session.show_on_devices) return json(null);
    const questionId = url.searchParams.get('question');
    const round = Number(url.searchParams.get('round') || session.current_round);
    if (!questionId) return fail('Missing question', 400);

    const { results } = await env.DB.prepare(
      'select payload from responses where session_id = ? and question_id = ? and round = ?',
    ).bind(session.id, questionId, round).all();

    // Payloads only — no pseudonyms, no timestamps, nothing per-person.
    return json({ round, payloads: (results || []).map((r) => parse(r.payload, {})) });
  }

  // ---- Q&A ---------------------------------------------------------------
  if (tail === 'qa') {
    if (method === 'GET') {
      const { results } = await env.DB.prepare(`
        select id, body, upvotes, answered, created_at from audience_questions
        where session_id = ? and approved = 1
        order by upvotes desc, created_at asc
      `).bind(session.id).all();
      return json(results || []);
    }
    if (method === 'POST') {
      if (session.state !== 'live') return fail('This session is not live.', 409);
      const text = String(body.body || '').trim().slice(0, 500);
      if (!text) return fail('Write a question first.', 400);
      const approved = session.qa_moderated ? 0 : 1;
      await env.DB.prepare(
        'insert into audience_questions (session_id, body, approved, created_at) values (?, ?, ?, ?)',
      ).bind(session.id, text, approved, now()).run();
      await notifyRoom(env, session.id, 'qa', { changed: true });
      return json({ ok: true, pending: !approved });
    }
  }

  if (seg[2] === 'qa' && seg[4] === 'upvote' && method === 'POST') {
    const id = Number(seg[3]);
    await env.DB.prepare(
      'update audience_questions set upvotes = upvotes + 1 where id = ? and session_id = ? and approved = 1',
    ).bind(id, session.id).run();
    const row = await env.DB.prepare('select upvotes from audience_questions where id = ?')
      .bind(id).first();
    await notifyRoom(env, session.id, 'qa', { changed: true });
    return json({ upvotes: row?.upvotes ?? 0 });
  }

  return fail('Unknown route', 404);
}

// =====================================================================
// Ownership
//
// The whole of rule 5 lives in these five functions. Each takes a bare
// id from a URL and returns the row ONLY if the signed-in user owns it,
// joining back to an owner_id where the table has no owner of its own
// (a question belongs to whoever owns its deck; a response belongs to
// whoever owns its session).
//
// Handlers below must go through these rather than querying by id. A
// query like `where id = ?` looks harmless and is the exact shape of the
// bug: ids are random, but an unguessable identifier is not an access
// control, and `GET /api/sessions/:id/responses` returns student answers.
//
// "Not yours" is answered 404, never 403 — a 403 would confirm that the
// id exists and belongs to somebody else, which is itself a disclosure.
// =====================================================================

const ownedDeck = (DB, id, user) => DB
  .prepare('select * from decks where id = ? and owner_id = ?').bind(id, user.id).first();

const ownedSession = (DB, id, user) => DB
  .prepare('select * from sessions where id = ? and owner_id = ?').bind(id, user.id).first();

const ownedQuestion = (DB, id, user) => DB.prepare(`
  select q.* from questions q
  join decks d on d.id = q.deck_id
  where q.id = ? and d.owner_id = ?
`).bind(id, user.id).first();

const ownedResponse = (DB, id, user) => DB.prepare(`
  select r.id, r.session_id from responses r
  join sessions s on s.id = r.session_id
  where r.id = ? and s.owner_id = ?
`).bind(id, user.id).first();

const ownedAudienceQuestion = (DB, id, user) => DB.prepare(`
  select a.id, a.session_id from audience_questions a
  join sessions s on s.id = a.session_id
  where a.id = ? and s.owner_id = ?
`).bind(id, user.id).first();

/** The one answer given for "doesn't exist" and "belongs to someone else". */
const notYours = () => fail('Not found.', 404);

// =====================================================================
// Instructor routes (token required — checked before we got here)
// =====================================================================

async function instructorRoute(request, env, seg, method, body, url, ctx, user) {
  const DB = env.DB;

  // ------------------------------------------------------------- decks
  if (seg[0] === 'decks') {
    const deckId = seg[1];

    if (!deckId && method === 'GET') {
      const { results } = await DB.prepare(
        'select * from decks where owner_id = ? order by updated_at desc',
      ).bind(user.id).all();
      // Decks predating permanent codes get one here. After the first
      // load this loop does nothing, so it costs a comparison per deck.
      for (const row of results || []) {
        if (!row.join_code) row.join_code = await ensureDeckCode(env, row);
      }
      return json((results || []).map(rowToDeck));
    }

    if (!deckId && method === 'POST') {
      const id = uid();
      const t = now();
      // A deck carries its join code from birth, so the instructions
      // slide has a real code and a real QR the moment you start writing.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await DB.prepare(`
            insert into decks (id, owner_id, join_code, title, theme, background, settings, created_at, updated_at)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id, user.id, generateJoinCode(6),
            body.title || 'Untitled deck', body.theme || 'lecture-hall',
            JSON.stringify(body.background || { kind: 'theme' }),
            JSON.stringify(body.settings || {}), t, t,
          ).run();
          break;
        } catch (err) {
          if (attempt === 7) throw err; // ran out of code attempts
        }
      }
      return json(rowToDeck(await DB.prepare('select * from decks where id = ?').bind(id).first()));
    }

    // ---- questions under a deck ----------------------------------------
    if (deckId && seg[2] === 'questions') {
      // One check covers every verb below: a question is reachable only
      // through a deck you own.
      if (!(await ownedDeck(DB, deckId, user))) return notYours();

      if (seg[3] === 'reorder' && method === 'POST') {
        const ids = Array.isArray(body.ids) ? body.ids : [];
        await DB.batch(ids.map((id, i) =>
          DB.prepare('update questions set position = ? where id = ? and deck_id = ?')
            .bind(i, id, deckId)));
        return json({ ok: true });
      }

      if (method === 'GET') {
        const { results } = await DB.prepare(
          'select * from questions where deck_id = ? order by position asc',
        ).bind(deckId).all();
        return json((results || []).map(rowToQuestion));
      }

      if (method === 'POST') {
        const id = uid();
        await DB.prepare(`
          insert into questions (id, deck_id, position, type, prompt, config, created_at)
          values (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, deckId, Number(body.position) || 0, body.type,
          body.prompt || '', JSON.stringify(body.config || {}), now(),
        ).run();
        return json(rowToQuestion(
          await DB.prepare('select * from questions where id = ?').bind(id).first()));
      }

      // replace the whole set (used by the plain-text import)
      if (method === 'PUT') {
        const items = Array.isArray(body.questions) ? body.questions : [];
        const t = now();
        const stmts = [DB.prepare('delete from questions where deck_id = ?').bind(deckId)];
        items.forEach((q, i) => stmts.push(DB.prepare(`
          insert into questions (id, deck_id, position, type, prompt, config, created_at)
          values (?, ?, ?, ?, ?, ?, ?)
        `).bind(uid(), deckId, i, q.type, q.prompt || '', JSON.stringify(q.config || {}), t)));
        await DB.batch(stmts);
        const { results } = await DB.prepare(
          'select * from questions where deck_id = ? order by position asc').bind(deckId).all();
        return json((results || []).map(rowToQuestion));
      }
    }

    if (deckId && method === 'GET') {
      const deck = await ownedDeck(DB, deckId, user);
      if (!deck) return notYours();
      if (!deck.join_code) deck.join_code = await ensureDeckCode(env, deck);
      return json(rowToDeck(deck));
    }

    // ---- rotate the deck's code ----------------------------------------
    // A permanent code is permanent until you say otherwise. Rotating it
    // is the answer to "last term's students still have the link" — it
    // takes effect immediately and orphans nothing: past sessions keep
    // their own codes and all their results.
    if (deckId && seg[2] === 'code' && method === 'POST') {
      const deck = await ownedDeck(DB, deckId, user);
      if (!deck) return notYours();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generateJoinCode(6);
        try {
          await DB.prepare('update decks set join_code = ?, updated_at = ? where id = ?')
            .bind(code, now(), deckId).run();
          return json({ join_code: code });
        } catch (err) {
          if (attempt === 7) throw err;
        }
      }
    }

    if (deckId && method === 'PATCH') {
      if (!(await ownedDeck(DB, deckId, user))) return notYours();
      const fields = [];
      const values = [];
      for (const key of ['title', 'theme']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
      }
      for (const key of ['background', 'settings']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(JSON.stringify(body[key])); }
      }
      fields.push('updated_at = ?'); values.push(now());
      values.push(deckId, user.id);
      // owner_id repeated in the WHERE as well as checked above: belt and
      // braces on the one statement that rewrites a deck.
      await DB.prepare(`update decks set ${fields.join(', ')} where id = ? and owner_id = ?`)
        .bind(...values).run();
      return json(rowToDeck(
        await DB.prepare('select * from decks where id = ?').bind(deckId).first()));
    }

    if (deckId && method === 'DELETE') {
      if (!(await ownedDeck(DB, deckId, user))) return notYours();
      await DB.prepare('delete from decks where id = ? and owner_id = ?')
        .bind(deckId, user.id).run();
      return json({ ok: true });
    }
  }

  // --------------------------------------------------------- questions
  if (seg[0] === 'questions' && seg[1]) {
    if (method === 'PATCH') {
      if (!(await ownedQuestion(DB, seg[1], user))) return notYours();
      const fields = [];
      const values = [];
      for (const key of ['prompt', 'type', 'position']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
      }
      if (body.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(body.config)); }
      if (!fields.length) return fail('Nothing to update', 400);
      values.push(seg[1]);
      await DB.prepare(`update questions set ${fields.join(', ')} where id = ?`).bind(...values).run();
      return json(rowToQuestion(
        await DB.prepare('select * from questions where id = ?').bind(seg[1]).first()));
    }
    if (method === 'DELETE') {
      if (!(await ownedQuestion(DB, seg[1], user))) return notYours();
      await DB.prepare('delete from questions where id = ?').bind(seg[1]).run();
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------- sessions
  if (seg[0] === 'sessions') {
    const sessionId = seg[1];

    if (!sessionId && method === 'GET') {
      const deck = url.searchParams.get('deck');
      // The counts ride along with the list rather than being fetched per
      // row afterwards. A list of codes and dates cannot tell a real class
      // run from a session nobody ever joined, and which of those a row is
      // happens to be the only question the archive is ever asked. One
      // pass: responses_lookup_idx leads with session_id, so the join is
      // an index scan, and no student identity leaves the aggregate — a
      // pseudonym is only ever counted, never returned.
      const sql = `
        select s.*,
               count(r.id)                   as response_count,
               count(distinct r.pseudonym)   as participant_count,
               count(distinct r.question_id) as answered_count,
               max(r.created_at)             as last_response_at
        from sessions s
        left join responses r on r.session_id = s.id
        where s.owner_id = ?${deck ? ' and s.deck_id = ?' : ''}
        group by s.id
        order by s.created_at desc
      `;
      const stmt = deck
        ? DB.prepare(sql).bind(user.id, deck)
        : DB.prepare(sql).bind(user.id);
      const { results } = await stmt.all();
      return json((results || []).map(rowToSession));
    }

    if (!sessionId && method === 'POST') {
      // Starting a session on somebody else's deck would run their
      // questions under your account and file the answers under yours.
      const deck = await ownedDeck(DB, body.deckId, user);
      if (!deck) return notYours();
      const id = uid();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await DB.prepare(`
            insert into sessions (id, deck_id, owner_id, join_code, label, theme, created_at)
            values (?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id, body.deckId, user.id, generateJoinCode(6), body.label || '',
            body.theme || deck.theme || 'lecture-hall', now(),
          ).run();
          return json(rowToSession(
            await DB.prepare('select * from sessions where id = ?').bind(id).first()));
        } catch (err) {
          if (attempt === 7) throw err; // ran out of code attempts
        }
      }
    }

    if (sessionId && seg[2] === 'ws') {
      if (!(await ownedSession(DB, sessionId, user))) return notYours();
      const roomId = env.SESSION_ROOM.idFromName(sessionId);
      return env.SESSION_ROOM.get(roomId).fetch(
        new Request('https://room/connect?role=presenter', request),
      );
    }

    if (sessionId && seg[2] === 'responses') {
      // The most sensitive read in the file: raw student answers.
      if (!(await ownedSession(DB, sessionId, user))) return notYours();

      if (method === 'GET') {
        const q = url.searchParams.get('question');
        const round = url.searchParams.get('round');
        let sql = 'select * from responses where session_id = ?';
        const args = [sessionId];
        if (q) { sql += ' and question_id = ?'; args.push(q); }
        if (round) { sql += ' and round = ?'; args.push(Number(round)); }
        sql += ' order by created_at asc';
        const { results } = await DB.prepare(sql).bind(...args).all();
        return json((results || []).map(rowToResponse));
      }
      if (method === 'DELETE') {
        const q = url.searchParams.get('question');
        const round = url.searchParams.get('round');
        let sql = 'delete from responses where session_id = ?';
        const args = [sessionId];
        if (q) { sql += ' and question_id = ?'; args.push(q); }
        if (round) { sql += ' and round = ?'; args.push(Number(round)); }
        await DB.prepare(sql).bind(...args).run();
        await notifyRoom(env, sessionId, 'responses-cleared', { question: q, round });
        return json({ ok: true });
      }
    }

    if (sessionId && seg[2] === 'qa' && method === 'GET') {
      if (!(await ownedSession(DB, sessionId, user))) return notYours();
      const { results } = await DB.prepare(`
        select * from audience_questions where session_id = ?
        order by upvotes desc, created_at asc
      `).bind(sessionId).all();
      return json((results || []).map((r) => ({
        ...r, approved: !!r.approved, answered: !!r.answered,
      })));
    }

    if (sessionId && seg[2] === 'maxround' && method === 'GET') {
      if (!(await ownedSession(DB, sessionId, user))) return notYours();
      const q = url.searchParams.get('question');
      const row = await DB.prepare(
        'select max(round) as r from responses where session_id = ? and question_id = ?',
      ).bind(sessionId, q).first();
      return json({ round: row?.r || 1 });
    }

    if (sessionId && method === 'GET') {
      const session = await ownedSession(DB, sessionId, user);
      if (!session) return notYours();
      return json(rowToSession(session));
    }

    if (sessionId && method === 'PATCH') {
      if (!(await ownedSession(DB, sessionId, user))) return notYours();
      const allowed = ['state', 'current_question_id', 'current_round', 'accepting',
        'reveal', 'show_on_devices', 'qa_moderated', 'label', 'started_at', 'ended_at'];
      const bools = new Set(['accepting', 'reveal', 'show_on_devices', 'qa_moderated']);
      const fields = [];
      const values = [];
      for (const key of allowed) {
        if (body[key] === undefined) continue;
        fields.push(`${key} = ?`);
        values.push(bools.has(key) ? (body[key] ? 1 : 0) : body[key]);
      }
      if (!fields.length) return fail('Nothing to update', 400);
      values.push(sessionId, user.id);
      await DB.prepare(`update sessions set ${fields.join(', ')} where id = ? and owner_id = ?`)
        .bind(...values).run();

      const updated = rowToSession(
        await DB.prepare('select * from sessions where id = ?').bind(sessionId).first());

      // This is the write that drives the whole room: every phone learns
      // the presenter moved on from this one broadcast.
      await notifyRoom(env, sessionId, 'session', {
        id: updated.id,
        state: updated.state,
        current_question_id: updated.current_question_id,
        current_round: updated.current_round,
        accepting: updated.accepting,
        reveal: updated.reveal,
        show_on_devices: updated.show_on_devices,
        qa_moderated: updated.qa_moderated,
        theme: updated.theme,
        // Mirrored here as well as on GET /api/join/:code so a phone already
        // sitting in the lobby learns it from the broadcast rather than
        // waiting out its slow poll. An instructor can add a quiz to a live
        // deck at any moment.
        has_quiz: await deckHasQuiz(env, sessionId),
      });
      return json(updated);
    }

    if (sessionId && method === 'DELETE') {
      if (!(await ownedSession(DB, sessionId, user))) return notYours();
      await DB.prepare('delete from sessions where id = ? and owner_id = ?')
        .bind(sessionId, user.id).run();
      return json({ ok: true });
    }
  }

  // -------------------------------------------------------- responses
  if (seg[0] === 'responses' && seg[1] && method === 'DELETE') {
    if (!(await ownedResponse(DB, Number(seg[1]), user))) return notYours();
    await DB.prepare('delete from responses where id = ?').bind(Number(seg[1])).run();
    return json({ ok: true });
  }

  // --------------------------------------------------------------- qa
  if (seg[0] === 'qa' && seg[1] && method === 'PATCH') {
    const owned = await ownedAudienceQuestion(DB, Number(seg[1]), user);
    if (!owned) return notYours();
    const fields = [];
    const values = [];
    for (const key of ['approved', 'answered']) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key] ? 1 : 0); }
    }
    if (!fields.length) return fail('Nothing to update', 400);
    values.push(Number(seg[1]));
    await DB.prepare(`update audience_questions set ${fields.join(', ')} where id = ?`)
      .bind(...values).run();
    await notifyRoom(env, owned.session_id, 'qa', { changed: true });
    return json({ ok: true });
  }

  // ------------------------------------------------------- backgrounds
  if (seg[0] === 'backgrounds') {
    if (!seg[1] && method === 'GET') {
      // Deliberately omits data_uri: the picker only needs ids, and
      // shipping every image on every editor load would be wasteful.
      const { results } = await DB.prepare(
        'select id, bytes, created_at from backgrounds where owner_id = ? order by created_at desc',
      ).bind(user.id).all();
      return json(results || []);
    }
    if (!seg[1] && method === 'POST') {
      const dataUri = String(body.dataUri || '');
      if (!dataUri.startsWith('data:image/')) return fail('Not an image', 400);
      // D1 rows are capped well below this, and the client already
      // downscales; this is the backstop.
      if (dataUri.length > 1_500_000) return fail('Image too large after compression', 413);
      const id = uid();
      await DB.prepare(
        'insert into backgrounds (id, owner_id, data_uri, bytes, created_at) values (?, ?, ?, ?, ?)',
      ).bind(id, user.id, dataUri, dataUri.length, now()).run();
      return json({ id, url: `/api/backgrounds/${id}` });
    }
    // NOTE: GET /api/backgrounds/:id is handled earlier, before the
    // instructor gate, because the browser fetches it as an image.
    if (seg[1] && method === 'DELETE') {
      const owned = await DB.prepare('select id from backgrounds where id = ? and owner_id = ?')
        .bind(seg[1], user.id).first();
      if (!owned) return notYours();
      await DB.prepare('delete from backgrounds where id = ? and owner_id = ?')
        .bind(seg[1], user.id).run();
      return json({ ok: true });
    }
  }

  return fail('Unknown route', 404);
}
