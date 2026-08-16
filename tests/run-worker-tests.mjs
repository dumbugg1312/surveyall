/**
 * SurveyAll — worker and account tests.
 *
 * Zero dependencies. Run with:   node tests/run-worker-tests.mjs
 *
 * These are NOT mocked. They stand up a real SQLite database from the
 * real worker/schema.sql, wrap it in the small slice of the D1 API the
 * Worker actually uses, and drive the Worker's own fetch handler with
 * real Request objects. So a route that forgets an owner check fails
 * here for the same reason it would fail in production.
 *
 * The section that matters most is "cross-account isolation". Before
 * accounts existed, every instructor query ran unscoped — `select * from
 * decks`, `where id = ?` — because there was only ever one instructor.
 * Adding a users table does not fix that on its own, and the failure is
 * silent: everything looks right when you test with one account. Each
 * isolation test therefore comes in a pair, checking that the owner CAN
 * still do the thing and that a second instructor CANNOT. A blanket 404
 * would pass the negative half alone.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import worker from '../worker/index.js';
import {
  hashPassword, checkPassword, issueToken, verifyToken, safeEqual,
  normaliseUsername, validateCredentials,
} from '../worker/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, '..', 'worker', 'schema.sql'), 'utf8');

// ---------------------------------------------------------------- tiny harness

let passed = 0;
let failed = 0;
const failures = [];
let group = '';

const tests = [];
function describe(name, fn) { group = name; fn(); }
function it(name, fn) { tests.push({ group, name, fn }); }

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + '\n' : ''}  expected ${b}\n  received ${a}`);
}

function ok(value, msg) {
  if (!value) throw new Error(msg || `expected truthy, received ${JSON.stringify(value)}`);
}

async function throws(fn, msg) {
  try { await fn(); } catch { return; }
  throw new Error(msg || 'expected it to throw');
}

// ---------------------------------------------------------------- D1 shim

/**
 * The subset of D1 the Worker touches: prepare/bind/first/all/run and
 * batch. Deliberately thin — the point is to run the Worker's real SQL,
 * not to reimplement D1.
 */
class Stmt {
  constructor(db, sql, args) { this.db = db; this.sql = sql; this.args = args; }

  bind(...args) { return new Stmt(this.db, this.sql, args); }

  // node:sqlite rejects JS booleans and undefined; D1 accepts both.
  get #bound() {
    return this.args.map((v) => {
      if (v === true) return 1;
      if (v === false) return 0;
      if (v === undefined) return null;
      return v;
    });
  }

  async first() { return this.db.prepare(this.sql).get(...this.#bound) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.#bound) }; }
  async run() { return this.db.prepare(this.sql).run(...this.#bound); }
}

class D1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Stmt(this.db, sql, []); }
  async batch(stmts) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

/** A fresh, fully migrated environment. */
function freshEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return {
    DB: new D1(db),
    AUTH_SECRET: 'test-auth-secret-do-not-use-in-production',
    SIGNUP_CODE: 'uwf',
    // The Durable Object is a fan-out hub with no bearing on access
    // control; notifyRoom already swallows its failures.
    SESSION_ROOM: {
      idFromName: (name) => name,
      get: () => ({ fetch: async () => new Response('ok') }),
    },
    ...overrides,
  };
}

/** Drive the Worker's real fetch handler. */
async function call(env, method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await worker.fetch(
    new Request(`https://test.local${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil() {} },
  );
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

/** Create an account and return its token. */
async function account(env, username, password = 'a-good-long-password') {
  const res = await call(env, 'POST', '/api/auth/signup', {
    body: { username, password, code: 'uwf' },
  });
  ok(res.data?.token, `sign-up failed for ${username}: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

/**
 * Two instructors, and a deck + live session + response + Q&A owned
 * entirely by the first. The fixture every isolation test shares.
 */
async function twoInstructors() {
  const env = freshEnv();
  const alice = await account(env, 'alice');
  const bob = await account(env, 'bob');

  const deck = (await call(env, 'POST', '/api/decks',
    { token: alice, body: { title: 'Alice deck' } })).data;

  const question = (await call(env, 'POST', `/api/decks/${deck.id}/questions`,
    { token: alice, body: { type: 'multiple_choice', prompt: 'Pick one', config: { options: ['a', 'b'] } } })).data;

  const session = (await call(env, 'POST', '/api/sessions',
    { token: alice, body: { deckId: deck.id } })).data;

  await call(env, 'PATCH', `/api/sessions/${session.id}`, {
    token: alice,
    body: { state: 'live', current_question_id: question.id, accepting: true },
  });

  // A real student answer, submitted through the participant API.
  const claim = (await call(env, 'POST', `/api/join/${session.join_code}/pseudonym`)).data;
  const answered = await call(env, 'POST', `/api/join/${session.join_code}/respond`, {
    body: {
      questionId: question.id,
      round: 1,
      pseudonym: claim.pseudonym,
      pseudonymToken: claim.token,
      payload: { choice: 0 },
    },
  });
  ok(answered.status === 200, `fixture answer rejected: ${JSON.stringify(answered.data)}`);
  await call(env, 'POST', `/api/join/${session.join_code}/qa`, {
    body: { body: 'Can you repeat that?' },
  });

  const responses = (await call(env, 'GET',
    `/api/sessions/${session.id}/responses`, { token: alice })).data;
  const qa = (await call(env, 'GET', `/api/sessions/${session.id}/qa`, { token: alice })).data;

  return { env, alice, bob, deck, question, session, responses, qa };
}

// =====================================================================

describe('password hashing', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const env = freshEnv();
    const { salt, hash, iterations } = await hashPassword(env, 'correct horse battery');
    const user = { salt, password_hash: hash, iterations };
    eq(await checkPassword(env, user, 'correct horse battery'), true);
    eq(await checkPassword(env, user, 'correct horse batterz'), false);
    eq(await checkPassword(env, user, ''), false);
  });

  it('salts every hash, so identical passwords do not collide', async () => {
    const env = freshEnv();
    const a = await hashPassword(env, 'same password');
    const b = await hashPassword(env, 'same password');
    ok(a.salt !== b.salt, 'salts must differ');
    ok(a.hash !== b.hash, 'hashes of the same password must differ');
  });

  it('is worthless without AUTH_SECRET — the pepper is load bearing', async () => {
    // This is the property the whole storage design rests on: an attacker
    // holding a dump of the users table, but not the Worker's secret,
    // cannot test candidate passwords at all.
    const env = freshEnv();
    const stored = await hashPassword(env, 'correct horse battery');
    const thief = freshEnv({ AUTH_SECRET: 'a-different-secret' });
    eq(await checkPassword(thief, {
      salt: stored.salt, password_hash: stored.hash, iterations: stored.iterations,
    }, 'correct horse battery'), false);
  });

  it('records the iteration count so the cost can be raised later', async () => {
    const env = freshEnv();
    const { iterations } = await hashPassword(env, 'a-good-long-password');
    ok(iterations >= 25000, `iterations should be at least 25000, got ${iterations}`);
  });

  it('refuses to hash with no secret configured', async () => {
    await throws(() => hashPassword({ AUTH_SECRET: '' }, 'pw'));
  });
});

describe('tokens', () => {
  it('round-trips a user id', async () => {
    const env = freshEnv();
    eq(await verifyToken(env, await issueToken(env, 'user-123')), 'user-123');
  });

  it('rejects a tampered signature', async () => {
    const env = freshEnv();
    const token = await issueToken(env, 'user-123');
    const [payload] = token.split('.');
    eq(await verifyToken(env, `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`), null);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await issueToken(freshEnv(), 'user-123');
    eq(await verifyToken(freshEnv({ AUTH_SECRET: 'other' }), token), null);
  });

  it('rejects an expired token', async () => {
    const env = freshEnv();
    // Hand-build one that expired an hour ago.
    const enc = new TextEncoder();
    const b64 = (b) => Buffer.from(b).toString('base64url');
    const payload = b64(enc.encode(JSON.stringify({ uid: 'u', exp: Date.now() - 3600e3, v: 2 })));
    const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    eq(await verifyToken(env, `${payload}.${b64(new Uint8Array(sig))}`), null);
  });

  it('rejects a v1 token, which proved someone signed in but not who', async () => {
    // v1 was the single-password era: {exp, v:1} and no identity at all.
    // Correctly signed, unexpired, and still worthless — accepting one
    // would mean an instructor request with no owner to scope by.
    const env = freshEnv();
    const enc = new TextEncoder();
    const b64 = (b) => Buffer.from(b).toString('base64url');
    const payload = b64(enc.encode(JSON.stringify({ exp: Date.now() + 3600e3, v: 1 })));
    const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    eq(await verifyToken(env, `${payload}.${b64(new Uint8Array(sig))}`), null);
  });

  it('refuses to issue a token with no user', async () => {
    await throws(() => issueToken(freshEnv(), ''));
  });

  it('safeEqual still compares correctly', () => {
    eq(safeEqual('abc', 'abc'), true);
    eq(safeEqual('abc', 'abd'), false);
    eq(safeEqual('abc', 'abcd'), false);
    eq(safeEqual('', ''), true);
  });
});

describe('sign-up', () => {
  it('refuses without the right code', async () => {
    const env = freshEnv();
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'nope', password: 'a-good-long-password', code: 'wrong' } })).status, 403);
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'nope', password: 'a-good-long-password' } })).status, 403);
  });

  it('accepts the code case-insensitively', async () => {
    const env = freshEnv();
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'carol', password: 'a-good-long-password', code: 'UWF' } })).status, 200);
  });

  it('is switched off entirely when no code is configured', async () => {
    const env = freshEnv({ SIGNUP_CODE: '' });
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'x', password: 'a-good-long-password', code: '' } })).status, 503);
    eq((await call(env, 'GET', '/api/auth/config')).data.signup_enabled, false);
  });

  it('rejects a short password and a bad username', async () => {
    const env = freshEnv();
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'ok', password: 'a-good-long-password', code: 'uwf' } })).status, 400);
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'fine', password: 'abc', code: 'uwf' } })).status, 400);
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'has space', password: 'a-good-long-password', code: 'uwf' } })).status, 400);
  });

  it('refuses a duplicate username regardless of case', async () => {
    const env = freshEnv();
    await account(env, 'dana');
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'DANA', password: 'a-good-long-password', code: 'uwf' } })).status, 409);
  });

  it('makes the first account admin and later ones not', async () => {
    const env = freshEnv();
    const first = (await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'first', password: 'a-good-long-password', code: 'uwf' } })).data;
    const second = (await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'second', password: 'a-good-long-password', code: 'uwf' } })).data;
    eq(first.user.is_admin, true);
    eq(second.user.is_admin, false);
  });

  it('hands pre-accounts decks and sessions to the first account', async () => {
    // Everything written before accounts existed carries owner_id
    // 'owner'. If the first sign-up did not adopt those rows they would
    // be invisible to every account forever.
    const env = freshEnv();
    const t = Date.now();
    env.DB.db.exec(`
      insert into decks (id, owner_id, title, created_at, updated_at)
      values ('legacy-deck', 'owner', 'From before accounts', ${t}, ${t});
      insert into sessions (id, deck_id, owner_id, join_code, created_at)
      values ('legacy-session', 'legacy-deck', 'owner', 'OLDCODE', ${t});
      insert into backgrounds (id, owner_id, data_uri, bytes, created_at)
      values ('legacy-bg', 'owner', 'data:image/jpeg;base64,AAAA', 4, ${t});
    `);

    const token = await account(env, 'brandon');
    const decks = (await call(env, 'GET', '/api/decks', { token })).data;
    eq(decks.length, 1);
    eq(decks[0].title, 'From before accounts');
    eq((await call(env, 'GET', '/api/sessions', { token })).data.length, 1);
    eq((await call(env, 'GET', '/api/backgrounds', { token })).data.length, 1);
  });

  it('does not hand them to the second account', async () => {
    const env = freshEnv();
    const t = Date.now();
    env.DB.db.exec(`insert into decks (id, owner_id, title, created_at, updated_at)
      values ('legacy-deck', 'owner', 'From before accounts', ${t}, ${t});`);
    await account(env, 'brandon');
    const late = await account(env, 'latecomer');
    eq((await call(env, 'GET', '/api/decks', { token: late })).data.length, 0);
  });

  it('accepts a short PIN, because instructors here use them', async () => {
    // Deliberate: the minimum is 4. The sign-in throttle, not the
    // password, is what protects an account at this length — see the
    // note on MIN_PASSWORD_LENGTH in worker/auth.js.
    const env = freshEnv();
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'pinuser', password: '1234', code: 'uwf' } })).status, 200);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'pinuser', password: '1234' } })).status, 200);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'pinuser', password: '1235' } })).status, 401);
  });

  it('still throttles a 4-digit PIN, which is what makes it survivable', async () => {
    const env = freshEnv();
    await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'pinuser', password: '1234', code: 'uwf' } });
    let last;
    for (let i = 0; i < 9; i += 1) {
      last = await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'pinuser', password: String(9000 + i) } });
    }
    eq(last.status, 429);
  });

  it('normalises usernames', () => {
    eq(normaliseUsername('  Brandon  '), 'brandon');
    eq(validateCredentials('ab', 'a-good-long-password') !== null, true);
    eq(validateCredentials('abc', 'xyz') !== null, true);
    eq(validateCredentials('abc', 'a-good-long-password'), null);
    eq(validateCredentials('a.b-c_d', 'a-good-long-password'), null);
  });
});

describe('sign-in', () => {
  it('works with the right password', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    const res = await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'a-good-long-password' } });
    eq(res.status, 200);
    eq(res.data.user.username, 'erin');
    ok(res.data.token);
  });

  it('is case-insensitive on the username', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'ERIN', password: 'a-good-long-password' } })).status, 200);
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    // Otherwise the error message itself confirms which usernames exist.
    const env = freshEnv();
    await account(env, 'erin');
    const wrong = await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'not-the-password' } });
    const missing = await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'nobody', password: 'not-the-password' } });
    eq(wrong.status, 401);
    eq(missing.status, 401);
    eq(wrong.data.error, missing.data.error);
  });

  it('throttles repeated failures, then keeps refusing the right password', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    let last;
    for (let i = 0; i < 9; i += 1) {
      last = await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    eq(last.status, 429);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'a-good-long-password' } })).status, 429);
  });

  it('throttles one account without locking out another', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    await account(env, 'frank');
    for (let i = 0; i < 9; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'frank', password: 'a-good-long-password' } })).status, 200);
  });

  it('stores no IP address anywhere, throttling included', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'wrong' } });
    const rows = env.DB.db.prepare('select key from auth_throttle').all();
    ok(rows.length > 0, 'expected a throttle row to exist');
    for (const row of rows) {
      ok(/^(signup|user:)/.test(row.key), `throttle key must be username-scoped, got ${row.key}`);
    }
  });
});

describe('escalating lockout', () => {
  const streak = (env, user = 'erin') => env.DB.db
    .prepare('select attempts, retry_after, last_fail_at from auth_throttle where key = ?')
    .get(`user:${user}`);

  it('leaves the first four misses unpunished, because typos happen', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    for (let i = 0; i < 4; i += 1) {
      eq((await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `typo-${i}` } })).status, 401);
    }
    eq(streak(env).retry_after, 0);
    // and the right password still works straight away
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'a-good-long-password' } })).status, 200);
  });

  it('doubles the wait with each further failure, capped at an hour', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    const penalties = [];
    for (let i = 0; i < 14; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
      const row = streak(env);
      penalties.push(row.retry_after === 0 ? 0 : row.retry_after - row.last_fail_at);
      // Pretend the wait elapsed, so the NEXT failure is counted rather
      // than bounced — otherwise the streak stops at the first lockout.
      env.DB.db.exec("update auth_throttle set retry_after = 0 where key = 'user:erin'");
    }
    eq(penalties.slice(0, 4), [0, 0, 0, 0]);
    eq(penalties.slice(4, 9), [15000, 30000, 60000, 120000, 240000]);
    eq(penalties[13], 3600000, 'the cap is one hour, deliberately — see worker/auth.js');
  });

  it('locks after the fifth failure and says how long', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    for (let i = 0; i < 5; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    const locked = await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'a-good-long-password' } });
    eq(locked.status, 429);
    ok(/try again in/i.test(locked.data.error), `unhelpful message: ${locked.data.error}`);
  });

  it('does not extend the sentence just for asking', async () => {
    // A locked-out instructor refreshing the page must not push their
    // own deadline further away.
    const env = freshEnv();
    await account(env, 'erin');
    for (let i = 0; i < 5; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    const before = streak(env);
    for (let i = 0; i < 5; i += 1) {
      eq((await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: 'a-good-long-password' } })).status, 429);
    }
    const after = streak(env);
    eq(after.attempts, before.attempts);
    eq(after.retry_after, before.retry_after);
  });

  it('forgets the whole streak once you get in', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    for (let i = 0; i < 3; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `typo-${i}` } });
    }
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'a-good-long-password' } })).status, 200);
    eq(env.DB.db.prepare(
      "select count(*) as n from auth_throttle where key = 'user:erin'").get().n, 0);
  });

  it('forgets failures older than a day, so typos never accumulate', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    const twoDaysAgo = Date.now() - 1000 * 60 * 60 * 48;
    env.DB.db.exec(`insert into auth_throttle (key, attempts, last_fail_at, retry_after)
      values ('user:erin', 12, ${twoDaysAgo}, 0)`);
    await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'erin', password: 'wrong' } });
    eq(streak(env).attempts, 1, 'a stale streak must reset, not resume at 13');
    eq(streak(env).retry_after, 0);
  });

  it('locks one account without touching another', async () => {
    const env = freshEnv();
    await account(env, 'erin');
    await account(env, 'frank');
    for (let i = 0; i < 6; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'frank', password: 'a-good-long-password' } })).status, 200);
  });

  it('does not let a failed sign-in lock out sign-up', async () => {
    // The two throttles share a table but not their semantics: a global
    // escalating lockout would let one person block all sign-ups.
    const env = freshEnv();
    await account(env, 'erin');
    for (let i = 0; i < 6; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'erin', password: `guess-${i}` } });
    }
    eq((await call(env, 'POST', '/api/auth/signup',
      { body: { username: 'newcomer', password: '1234', code: 'uwf' } })).status, 200);
  });
});

describe('password changes', () => {
  it('lets a user change their own password', async () => {
    const env = freshEnv();
    const token = await account(env, 'gina');
    eq((await call(env, 'POST', '/api/auth/password',
      { token, body: { current: 'a-good-long-password', next: 'a-new-long-password' } })).status, 200);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'gina', password: 'a-new-long-password' } })).status, 200);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'gina', password: 'a-good-long-password' } })).status, 401);
  });

  it('refuses without the current password', async () => {
    const env = freshEnv();
    const token = await account(env, 'gina');
    eq((await call(env, 'POST', '/api/auth/password',
      { token, body: { current: 'wrong', next: 'a-new-long-password' } })).status, 401);
  });

  it('lets an admin reset a colleague, and refuses a non-admin', async () => {
    // The whole account-recovery story: no email means no reset link.
    const env = freshEnv();
    const admin = await account(env, 'brandon');
    await account(env, 'helen');
    const helen = await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'helen', password: 'a-good-long-password' } });

    eq((await call(env, 'POST', '/api/auth/reset',
      { token: helen.data.token, body: { username: 'brandon', next: 'hijacked-password' } })).status, 403);

    eq((await call(env, 'POST', '/api/auth/reset',
      { token: admin, body: { username: 'helen', next: 'reset-by-the-admin' } })).status, 200);
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'helen', password: 'reset-by-the-admin' } })).status, 200);
  });

  it('clears the throttle so a reset actually lets someone back in', async () => {
    const env = freshEnv();
    const admin = await account(env, 'brandon');
    await account(env, 'helen');
    for (let i = 0; i < 9; i += 1) {
      await call(env, 'POST', '/api/auth/signin',
        { body: { username: 'helen', password: `forgot-${i}` } });
    }
    await call(env, 'POST', '/api/auth/reset',
      { token: admin, body: { username: 'helen', next: 'reset-by-the-admin' } });
    eq((await call(env, 'POST', '/api/auth/signin',
      { body: { username: 'helen', password: 'reset-by-the-admin' } })).status, 200);
  });
});

describe('the instructor gate', () => {
  it('refuses every instructor route with no token', async () => {
    const { env, deck, session } = await twoInstructors();
    for (const [method, path] of [
      ['GET', '/api/decks'],
      ['GET', `/api/decks/${deck.id}`],
      ['GET', '/api/sessions'],
      ['GET', `/api/sessions/${session.id}/responses`],
      ['GET', '/api/backgrounds'],
    ]) {
      eq((await call(env, method, path)).status, 401, `${method} ${path} must require a token`);
    }
  });

  it('refuses a token whose account has been deleted', async () => {
    const env = freshEnv();
    const token = await account(env, 'ghost');
    eq((await call(env, 'GET', '/api/decks', { token })).status, 200);
    env.DB.db.exec("delete from users where username = 'ghost'");
    eq((await call(env, 'GET', '/api/decks', { token })).status, 401);
  });
});

describe('cross-account isolation', () => {
  it('lists only your own decks and sessions', async () => {
    const { env, alice, bob } = await twoInstructors();
    eq((await call(env, 'GET', '/api/decks', { token: alice })).data.length, 1);
    eq((await call(env, 'GET', '/api/decks', { token: bob })).data.length, 0);
    eq((await call(env, 'GET', '/api/sessions', { token: alice })).data.length, 1);
    eq((await call(env, 'GET', '/api/sessions', { token: bob })).data.length, 0);
  });

  it('hides another instructor\'s deck by id', async () => {
    const { env, alice, bob, deck } = await twoInstructors();
    eq((await call(env, 'GET', `/api/decks/${deck.id}`, { token: alice })).status, 200);
    eq((await call(env, 'GET', `/api/decks/${deck.id}`, { token: bob })).status, 404);
  });

  it('refuses to let another instructor edit or delete a deck', async () => {
    const { env, bob, deck } = await twoInstructors();
    eq((await call(env, 'PATCH', `/api/decks/${deck.id}`,
      { token: bob, body: { title: 'Stolen' } })).status, 404);
    eq((await call(env, 'DELETE', `/api/decks/${deck.id}`, { token: bob })).status, 404);
    // and the deck is genuinely untouched
    eq(env.DB.db.prepare('select title from decks where id = ?').get(deck.id).title, 'Alice deck');
  });

  it('hides the questions under another instructor\'s deck', async () => {
    const { env, alice, bob, deck } = await twoInstructors();
    eq((await call(env, 'GET', `/api/decks/${deck.id}/questions`, { token: alice })).data.length, 1);
    eq((await call(env, 'GET', `/api/decks/${deck.id}/questions`, { token: bob })).status, 404);
    eq((await call(env, 'POST', `/api/decks/${deck.id}/questions`,
      { token: bob, body: { type: 'open_ended', prompt: 'Injected' } })).status, 404);
    eq((await call(env, 'PUT', `/api/decks/${deck.id}/questions`,
      { token: bob, body: { questions: [] } })).status, 404);
    eq((await call(env, 'POST', `/api/decks/${deck.id}/questions/reorder`,
      { token: bob, body: { ids: [] } })).status, 404);
    // Alice's question survived every one of those.
    eq(env.DB.db.prepare('select count(*) as n from questions where deck_id = ?').get(deck.id).n, 1);
  });

  it('refuses to let another instructor edit a question by its id', async () => {
    const { env, bob, question } = await twoInstructors();
    eq((await call(env, 'PATCH', `/api/questions/${question.id}`,
      { token: bob, body: { prompt: 'Rewritten' } })).status, 404);
    eq((await call(env, 'DELETE', `/api/questions/${question.id}`, { token: bob })).status, 404);
    eq(env.DB.db.prepare('select prompt from questions where id = ?').get(question.id).prompt, 'Pick one');
  });

  it('will not start a session on another instructor\'s deck', async () => {
    const { env, bob, deck } = await twoInstructors();
    eq((await call(env, 'POST', '/api/sessions',
      { token: bob, body: { deckId: deck.id } })).status, 404);
  });

  it('hides another instructor\'s session by id', async () => {
    const { env, alice, bob, session } = await twoInstructors();
    eq((await call(env, 'GET', `/api/sessions/${session.id}`, { token: alice })).status, 200);
    eq((await call(env, 'GET', `/api/sessions/${session.id}`, { token: bob })).status, 404);
    eq((await call(env, 'PATCH', `/api/sessions/${session.id}`,
      { token: bob, body: { state: 'ended' } })).status, 404);
    eq((await call(env, 'DELETE', `/api/sessions/${session.id}`, { token: bob })).status, 404);
    eq(env.DB.db.prepare('select state from sessions where id = ?').get(session.id).state, 'live');
  });

  it('NEVER serves another instructor\'s student responses', async () => {
    // The single most sensitive read in the application.
    const { env, alice, bob, session, responses } = await twoInstructors();
    eq(responses.length, 1);
    eq((await call(env, 'GET', `/api/sessions/${session.id}/responses`, { token: alice })).data.length, 1);
    eq((await call(env, 'GET', `/api/sessions/${session.id}/responses`, { token: bob })).status, 404);
    eq((await call(env, 'GET',
      `/api/sessions/${session.id}/responses?question=${session.current_question_id}`,
      { token: bob })).status, 404);
  });

  it('refuses to let another instructor delete responses', async () => {
    const { env, bob, session, responses } = await twoInstructors();
    eq((await call(env, 'DELETE', `/api/sessions/${session.id}/responses`, { token: bob })).status, 404);
    eq((await call(env, 'DELETE', `/api/responses/${responses[0].id}`, { token: bob })).status, 404);
    eq(env.DB.db.prepare('select count(*) as n from responses').get().n, 1);
  });

  it('refuses to let another instructor read or moderate Q&A', async () => {
    const { env, alice, bob, session, qa } = await twoInstructors();
    eq(qa.length, 1);
    eq((await call(env, 'GET', `/api/sessions/${session.id}/qa`, { token: alice })).status, 200);
    eq((await call(env, 'GET', `/api/sessions/${session.id}/qa`, { token: bob })).status, 404);
    eq((await call(env, 'PATCH', `/api/qa/${qa[0].id}`,
      { token: bob, body: { approved: true } })).status, 404);
  });

  it('refuses the presenter socket and round lookup on someone else\'s session', async () => {
    const { env, bob, session, question } = await twoInstructors();
    eq((await call(env, 'GET', `/api/sessions/${session.id}/ws`, { token: bob })).status, 404);
    eq((await call(env, 'GET',
      `/api/sessions/${session.id}/maxround?question=${question.id}`, { token: bob })).status, 404);
  });

  it('keeps uploaded backgrounds out of another instructor\'s list', async () => {
    const { env, alice, bob } = await twoInstructors();
    const bg = (await call(env, 'POST', '/api/backgrounds',
      { token: alice, body: { dataUri: 'data:image/jpeg;base64,AAAA' } })).data;
    eq((await call(env, 'GET', '/api/backgrounds', { token: alice })).data.length, 1);
    eq((await call(env, 'GET', '/api/backgrounds', { token: bob })).data.length, 0);
    eq((await call(env, 'DELETE', `/api/backgrounds/${bg.id}`, { token: bob })).status, 404);
    eq(env.DB.db.prepare('select count(*) as n from backgrounds').get().n, 1);
  });
});

describe('students still cannot reach anything', () => {
  it('serves the live question with no answer key', async () => {
    const env = freshEnv();
    const token = await account(env, 'alice');
    const deck = (await call(env, 'POST', '/api/decks', { token, body: { title: 'Quiz' } })).data;
    const q = (await call(env, 'POST', `/api/decks/${deck.id}/questions`, {
      token,
      body: {
        type: 'quiz',
        prompt: 'Capital of France?',
        config: { options: ['Paris', 'Rome'], correct: [0], answer_key: 'Paris' },
      },
    })).data;
    const session = (await call(env, 'POST', '/api/sessions',
      { token, body: { deckId: deck.id } })).data;
    await call(env, 'PATCH', `/api/sessions/${session.id}`,
      { token, body: { state: 'live', current_question_id: q.id, accepting: true } });

    const seen = (await call(env, 'GET', `/api/join/${session.join_code}/question`)).data;
    eq(seen.prompt, 'Capital of France?');
    eq(seen.config.correct, undefined);
    eq(seen.config.answer_key, undefined);
    // The options themselves must survive — a phone still has to render
    // them — but nothing in the payload may say which one is right.
    eq(seen.config.options, ['Paris', 'Rome']);
    ok(!JSON.stringify(seen).includes('correct'), 'no correctness marker may reach a phone');
  });

  it('refuses a participant label the server did not sign', async () => {
    const { env, session, question } = await twoInstructors();
    const res = await call(env, 'POST', `/api/join/${session.join_code}/respond`, {
      body: {
        questionId: question.id,
        round: 1,
        pseudonym: 'Forged Label',
        pseudonymToken: 'not-a-real-signature',
        payload: { choice: 1 },
      },
    });
    ok(res.status >= 400, `expected a rejection, got ${res.status}`);
    eq(env.DB.db.prepare('select count(*) as n from responses').get().n, 1);
  });
});

// =====================================================================

const t0 = Date.now();
for (const { group: g, name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    process.stdout.write('.');
  } catch (err) {
    failed += 1;
    failures.push({ group: g, name, err });
    process.stdout.write('F');
  }
}

console.log('\n');
if (failures.length) {
  console.log('FAILURES\n');
  failures.forEach(({ group: g, name, err }) => {
    console.log(`  ✗ ${g} › ${name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}\n`);
  });
}
console.log(`${passed} passed, ${failed} failed  (${Date.now() - t0}ms)\n`);
process.exit(failed ? 1 : 0);
