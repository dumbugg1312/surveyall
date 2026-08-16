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
 *
 * If you edit this file, re-run the security probes in docs/HANDOFF.md.
 */

import { SessionRoom } from './session-room.js';
import { isInstructor, signIn } from './auth.js';

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
  return {
    ...row,
    accepting: !!row.accepting,
    reveal: !!row.reveal,
    show_on_devices: !!row.show_on_devices,
    qa_moderated: !!row.qa_moderated,
  };
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
function sanitiseQuestion(question) {
  const config = { ...(question.config || {}) };
  delete config.correct;
  delete config.correct_answers;
  delete config.answer_key;

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

  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    position: question.position,
    config,
  };
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
 * token; the unguessable id is what protects it. That is safe here: a
 * backdrop is the instructor's own projector art, holds no student data,
 * and is already being displayed to the whole room. Listing, uploading
 * and deleting stay behind the instructor gate, so the collection cannot
 * be enumerated.
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
      const token = await signIn(env, body.password);
      // Deliberately identical failure for "no password configured" and
      // "wrong password" — never tell an attacker which.
      if (!token) return fail('Incorrect password.', 401);
      return json({ token });
    }
    if (seg[1] === 'check') {
      return json({ ok: await isInstructor(request, env) });
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
  if (!(await isInstructor(request, env))) return fail('Sign in first.', 401);
  return instructorRoute(request, env, seg, method, body, url, ctx);
}

// =====================================================================
// Participant routes (no auth, ever)
// =====================================================================

async function participantRoute(request, env, seg, method, body, url) {
  const code = String(seg[1] || '').toUpperCase();
  if (!code) return fail('No session code', 400);

  const session = rowToSession(
    await env.DB.prepare('select * from sessions where join_code = ?').bind(code).first(),
  );
  if (!session) return fail('No session found for that code.', 404);

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
      join_code: session.join_code,
      theme: session.theme,
      state: session.state,
      current_question_id: session.current_question_id,
      current_round: session.current_round,
      accepting: session.accepting,
      reveal: session.reveal,
      show_on_devices: session.show_on_devices,
      qa_moderated: session.qa_moderated,
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
      ...sanitiseQuestion(q),
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
        return json({ pseudonym: name });
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

    const slot = Number.isInteger(body.slot) ? body.slot : 0;
    await env.DB.prepare(`
      insert into responses (session_id, question_id, round, pseudonym, slot, payload, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict (session_id, question_id, round, pseudonym, slot)
      do update set payload = excluded.payload, created_at = excluded.created_at
    `).bind(
      session.id, body.questionId, Number(body.round),
      String(body.pseudonym), slot, JSON.stringify(body.payload ?? {}), now(),
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
// Instructor routes (token required — checked before we got here)
// =====================================================================

async function instructorRoute(request, env, seg, method, body, url, ctx) {
  const DB = env.DB;

  // ------------------------------------------------------------- decks
  if (seg[0] === 'decks') {
    const deckId = seg[1];

    if (!deckId && method === 'GET') {
      const { results } = await DB.prepare(
        'select * from decks order by updated_at desc',
      ).all();
      return json((results || []).map(rowToDeck));
    }

    if (!deckId && method === 'POST') {
      const id = uid();
      const t = now();
      await DB.prepare(`
        insert into decks (id, title, theme, background, settings, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, body.title || 'Untitled deck', body.theme || 'lecture-hall',
        JSON.stringify(body.background || { kind: 'theme' }),
        JSON.stringify(body.settings || {}), t, t,
      ).run();
      return json(rowToDeck(await DB.prepare('select * from decks where id = ?').bind(id).first()));
    }

    // ---- questions under a deck ----------------------------------------
    if (deckId && seg[2] === 'questions') {
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
      return json(rowToDeck(
        await DB.prepare('select * from decks where id = ?').bind(deckId).first()));
    }

    if (deckId && method === 'PATCH') {
      const fields = [];
      const values = [];
      for (const key of ['title', 'theme']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key]); }
      }
      for (const key of ['background', 'settings']) {
        if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(JSON.stringify(body[key])); }
      }
      fields.push('updated_at = ?'); values.push(now());
      values.push(deckId);
      await DB.prepare(`update decks set ${fields.join(', ')} where id = ?`).bind(...values).run();
      return json(rowToDeck(
        await DB.prepare('select * from decks where id = ?').bind(deckId).first()));
    }

    if (deckId && method === 'DELETE') {
      await DB.prepare('delete from decks where id = ?').bind(deckId).run();
      return json({ ok: true });
    }
  }

  // --------------------------------------------------------- questions
  if (seg[0] === 'questions' && seg[1]) {
    if (method === 'PATCH') {
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
      await DB.prepare('delete from questions where id = ?').bind(seg[1]).run();
      return json({ ok: true });
    }
  }

  // ---------------------------------------------------------- sessions
  if (seg[0] === 'sessions') {
    const sessionId = seg[1];

    if (!sessionId && method === 'GET') {
      const deck = url.searchParams.get('deck');
      const stmt = deck
        ? DB.prepare('select * from sessions where deck_id = ? order by created_at desc').bind(deck)
        : DB.prepare('select * from sessions order by created_at desc');
      const { results } = await stmt.all();
      return json((results || []).map(rowToSession));
    }

    if (!sessionId && method === 'POST') {
      const deck = await DB.prepare('select theme from decks where id = ?')
        .bind(body.deckId).first();
      const id = uid();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          await DB.prepare(`
            insert into sessions (id, deck_id, join_code, label, theme, created_at)
            values (?, ?, ?, ?, ?, ?)
          `).bind(
            id, body.deckId, generateJoinCode(6), body.label || '',
            body.theme || deck?.theme || 'lecture-hall', now(),
          ).run();
          return json(rowToSession(
            await DB.prepare('select * from sessions where id = ?').bind(id).first()));
        } catch (err) {
          if (attempt === 7) throw err; // ran out of code attempts
        }
      }
    }

    if (sessionId && seg[2] === 'ws') {
      const roomId = env.SESSION_ROOM.idFromName(sessionId);
      return env.SESSION_ROOM.get(roomId).fetch(
        new Request('https://room/connect?role=presenter', request),
      );
    }

    if (sessionId && seg[2] === 'responses') {
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
      const { results } = await DB.prepare(`
        select * from audience_questions where session_id = ?
        order by upvotes desc, created_at asc
      `).bind(sessionId).all();
      return json((results || []).map((r) => ({
        ...r, approved: !!r.approved, answered: !!r.answered,
      })));
    }

    if (sessionId && seg[2] === 'maxround' && method === 'GET') {
      const q = url.searchParams.get('question');
      const row = await DB.prepare(
        'select max(round) as r from responses where session_id = ? and question_id = ?',
      ).bind(sessionId, q).first();
      return json({ round: row?.r || 1 });
    }

    if (sessionId && method === 'GET') {
      return json(rowToSession(
        await DB.prepare('select * from sessions where id = ?').bind(sessionId).first()));
    }

    if (sessionId && method === 'PATCH') {
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
      values.push(sessionId);
      await DB.prepare(`update sessions set ${fields.join(', ')} where id = ?`)
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
      });
      return json(updated);
    }

    if (sessionId && method === 'DELETE') {
      await DB.prepare('delete from sessions where id = ?').bind(sessionId).run();
      return json({ ok: true });
    }
  }

  // -------------------------------------------------------- responses
  if (seg[0] === 'responses' && seg[1] && method === 'DELETE') {
    await DB.prepare('delete from responses where id = ?').bind(Number(seg[1])).run();
    return json({ ok: true });
  }

  // --------------------------------------------------------------- qa
  if (seg[0] === 'qa' && seg[1] && method === 'PATCH') {
    const fields = [];
    const values = [];
    for (const key of ['approved', 'answered']) {
      if (body[key] !== undefined) { fields.push(`${key} = ?`); values.push(body[key] ? 1 : 0); }
    }
    if (!fields.length) return fail('Nothing to update', 400);
    values.push(Number(seg[1]));
    await DB.prepare(`update audience_questions set ${fields.join(', ')} where id = ?`)
      .bind(...values).run();
    const row = await DB.prepare('select session_id from audience_questions where id = ?')
      .bind(Number(seg[1])).first();
    if (row) await notifyRoom(env, row.session_id, 'qa', { changed: true });
    return json({ ok: true });
  }

  // ------------------------------------------------------- backgrounds
  if (seg[0] === 'backgrounds') {
    if (!seg[1] && method === 'GET') {
      // Deliberately omits data_uri: the picker only needs ids, and
      // shipping every image on every editor load would be wasteful.
      const { results } = await DB.prepare(
        'select id, bytes, created_at from backgrounds order by created_at desc',
      ).all();
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
        'insert into backgrounds (id, data_uri, bytes, created_at) values (?, ?, ?, ?)',
      ).bind(id, dataUri, dataUri.length, now()).run();
      return json({ id, url: `/api/backgrounds/${id}` });
    }
    // NOTE: GET /api/backgrounds/:id is handled earlier, before the
    // instructor gate, because the browser fetches it as an image.
    if (seg[1] && method === 'DELETE') {
      await DB.prepare('delete from backgrounds where id = ?').bind(seg[1]).run();
      return json({ ok: true });
    }
  }

  return fail('Unknown route', 404);
}
