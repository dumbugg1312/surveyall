/**
 * SurveyAll — instructor authentication.
 *
 * Multi-instructor. Each instructor holds an account: a username they
 * choose, and a password. There is no email address anywhere in this
 * system — accounts are gated by a shared signup code instead (see
 * SIGNUP_CODE below), so there is nothing to verify and nothing to mail.
 *
 * Signing in exchanges username+password for a short-lived HMAC-signed
 * token carrying that user's id. Every instructor route in index.js
 * scopes its queries by that id; a token with no id in it is refused.
 *
 * Students never touch any of this. They authenticate with nothing at
 * all — a session join code is not a credential, it's a room number.
 * Nothing in this file ever runs for a participant.
 */

const encoder = new TextEncoder();

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * Token format version. v1 tokens (the single-password era) carried an
 * expiry and NOTHING else — no identity. They must be refused rather
 * than tolerated: a v1 token that still verified would be a valid
 * instructor credential belonging to no account, and every owner-scoped
 * query would have nothing to scope by. Bumping this invalidates them.
 */
const TOKEN_VERSION = 2;

/**
 * PBKDF2 cost. See the long note in worker/schema.sql before changing.
 *
 * Short version: the free plan's 10ms CPU ceiling rules out the usual
 * 100k+ (measured ~11ms on a dev laptop, and Workers CPU is slower), so
 * the password is peppered with AUTH_SECRET first — an attacker holding
 * only a database dump cannot test candidate passwords at all. Raising
 * this number is safe: `iterations` is stored per row and any account
 * hashed at a lower cost is transparently re-hashed on its next
 * successful sign-in.
 */
const PBKDF2_ITERATIONS = 25000;

/**
 * Password rules. Length is the only one worth enforcing.
 *
 * Set low on purpose: instructors here pick short PINs, and a rule people
 * work around is worse than a rule that admits what it is. Be clear about
 * what that costs, because it is the SIGNIN throttle below — not the
 * password — that carries the weight at this length.
 *
 * A 4-digit numeric password is 10,000 possibilities. At 8 attempts per
 * 15 minutes per account, exhausting that space takes on the order of a
 * fortnight of sustained, uninterrupted guessing against one username,
 * and the average hit lands around a week. That is real protection
 * against someone idly trying, and thin protection against someone
 * patient and motivated.
 *
 * So: do not raise SIGNIN_MAX_ATTEMPTS or lengthen SIGNIN_WINDOW_MS
 * without understanding that they are the control here. If accounts ever
 * hold something more sensitive than a term's poll results, raise this
 * minimum rather than trying to compensate elsewhere.
 */
const MIN_PASSWORD_LENGTH = 4;

/**
 * Sign-in throttle — an ESCALATING lockout, keyed per username so that
 * no network identifier is ever stored.
 *
 * This is the control that makes a short password survivable, so the
 * numbers are chosen against that job rather than picked by feel.
 *
 * The first few misses are free, because a typo is not an attack. After
 * that each consecutive failure doubles the wait before the next attempt
 * is even looked at:
 *
 *     5th failure   15s        10th   8m
 *     6th           30s        11th  16m
 *     7th            1m        12th  32m
 *     8th            2m        13th+  1h  (cap)
 *     9th            4m
 *
 * A 4-digit PIN is 10,000 possibilities. Under the previous flat rule
 * (8 tries per 15 minutes) exhausting that took about 13 days. Under
 * this one an attacker is at the cap after 13 misses and every further
 * guess costs an hour, so the full space takes roughly **420 days**, and
 * the average hit lands near seven months. That is the difference
 * between a weekend's work and giving up.
 *
 * THE COST, because it is real: this is a denial-of-service lever
 * against a colleague. Anyone who knows a username can deliberately fail
 * sign-ins and keep that person locked out. Three things bound the
 * damage, and all three matter — do not remove one without revisiting
 * this comment:
 *
 *   1. The cap is ONE HOUR, not a day. An instructor locked out before
 *      class waits at most an hour rather than missing the week.
 *   2. An admin password reset clears the lock instantly, so there is
 *      always a same-minute way back in.
 *   3. A correct password clears the counter completely, so a bad streak
 *      leaves nothing behind once you get in.
 *
 * The counter also decays: a failure more than a day old is forgotten
 * entirely, so occasional typos across a semester never accumulate into
 * a lockout.
 */
const SIGNIN_FREE_ATTEMPTS = 4;
const SIGNIN_FIRST_PENALTY_MS = 1000 * 15;
const SIGNIN_MAX_PENALTY_MS = 1000 * 60 * 60;
const SIGNIN_DECAY_MS = 1000 * 60 * 60 * 24;

/**
 * Sign-up throttle: a single global counter in a rolling window, for the
 * same no-identifier reason.
 *
 * Deliberately NOT escalating, unlike sign-in. A global escalating
 * lockout would let one person hammering the wrong code block sign-up
 * for everybody — the exact denial of service that per-account
 * escalation is safe from.
 */
const SIGNUP_MAX_ATTEMPTS = 20;
const SIGNUP_WINDOW_MS = 1000 * 60 * 60;

// =====================================================================
// Encoding helpers
// =====================================================================

/** base64url, because tokens travel in headers. */
function b64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

/**
 * Constant-time string comparison.
 *
 * A plain `a === b` leaks the length of the matching prefix through
 * timing. That is a slim attack surface for a classroom tool, but the
 * fix is four lines, so there is no reason to leave it.
 */
export function safeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  // Compare a fixed number of bytes regardless of input length, then
  // fold the length difference in, so neither length nor content
  // short-circuits.
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

// =====================================================================
// Password hashing
// =====================================================================

/**
 * Pepper: HMAC the password with AUTH_SECRET before it ever reaches
 * PBKDF2.
 *
 * This is the layer carrying most of the weight, so it is worth being
 * precise about what it buys. The threat it defends against is the
 * likeliest one by far — a leak of the D1 database alone, without the
 * Worker's secrets. Against that attacker the stored hashes are inert:
 * they cannot test "password123" against a row, because the input to
 * PBKDF2 is not the password but an HMAC of it under a key they do not
 * have. Iteration count is irrelevant in that scenario; key secrecy is
 * everything.
 *
 * It buys nothing if AUTH_SECRET leaks too, which is exactly why PBKDF2
 * is still underneath it rather than being skipped.
 */
async function pepper(env, password) {
  if (!env.AUTH_SECRET) throw new Error('AUTH_SECRET is not configured');
  const key = await hmacKey(env.AUTH_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(password)));
  return new Uint8Array(sig);
}

/** Derive the stored hash for a password. Salt is base64url. */
async function derive(env, password, saltB64, iterations) {
  const peppered = await pepper(env, password);
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromB64url(saltB64), iterations, hash: 'SHA-256' },
    key, 256,
  );
  return b64url(bits);
}

/** @returns {{salt: string, hash: string, iterations: number}} */
export async function hashPassword(env, password) {
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(env, password, salt, PBKDF2_ITERATIONS);
  return { salt, hash, iterations: PBKDF2_ITERATIONS };
}

/** Constant-time check of a password against a stored user row. */
export async function checkPassword(env, user, password) {
  const attempt = await derive(env, password, user.salt, user.iterations);
  return safeEqual(attempt, user.password_hash);
}

// =====================================================================
// Tokens
// =====================================================================

/** Issue a signed token identifying one user. */
export async function issueToken(env, userId) {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  if (!userId) throw new Error('Cannot issue a token with no user');

  const payload = b64url(encoder.encode(JSON.stringify({
    uid: userId,
    exp: Date.now() + TOKEN_TTL_MS,
    v: TOKEN_VERSION,
  })));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/**
 * Verify a token.
 *
 * @returns {Promise<string|null>} the user id it identifies, or null.
 *
 * Note this returns an ID rather than a boolean, and callers depend on
 * that: a route that only knows "yes, someone signed in" cannot scope a
 * query to the right owner, which was the whole bug class this replaced.
 */
export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string') return null;
  const secret = env.AUTH_SECRET;
  if (!secret) return null;

  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;

  let ok = false;
  try {
    const key = await hmacKey(secret);
    ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), encoder.encode(payload));
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (body.v !== TOKEN_VERSION) return null;          // refuses identity-less v1 tokens
    if (typeof body.uid !== 'string' || !body.uid) return null;
    if (typeof body.exp !== 'number' || body.exp <= Date.now()) return null;
    return body.uid;
  } catch {
    return null;
  }
}

/** The subprotocol name that marks the next value as an instructor token. */
export const WS_TOKEN_PROTOCOL = 'surveyall.bearer';

/**
 * Pull a Bearer token off a request.
 *
 * Normal API calls carry it in the Authorization header. A WebSocket
 * cannot: `new WebSocket(url)` gives a browser no way to set request
 * headers at all, so the presenter's socket would be rejected 401 on
 * every attempt and the projector would never receive live answers. For
 * that one case the token rides in the subprotocol list instead, as
 * ['surveyall.bearer', <token>], which is the standard workaround and
 * keeps the token out of the URL (and therefore out of request logs).
 */
export function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();

  const offered = (request.headers.get('Sec-WebSocket-Protocol') || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const at = offered.indexOf(WS_TOKEN_PROTOCOL);
  if (at !== -1 && offered[at + 1]) return offered[at + 1];

  return null;
}

/**
 * Resolve a request to the instructor making it.
 *
 * @returns {Promise<object|null>} the user row, or null if not signed in.
 *
 * Re-reads the row on every request rather than trusting the token's
 * contents, so that deleting an account takes effect immediately instead
 * of 30 days later when the last token expires.
 */
export async function currentUser(request, env) {
  const uid = await verifyToken(env, bearer(request));
  if (!uid) return null;
  const row = await env.DB.prepare(
    'select id, username, is_admin, created_at from users where id = ?',
  ).bind(uid).first();
  if (!row) return null;
  return { ...row, is_admin: !!row.is_admin };
}

// =====================================================================
// Throttling
//
// Keyed by username or by a fixed string — never by IP. See the note on
// auth_throttle in worker/schema.sql for why that constraint is load
// bearing rather than an oversight.
// =====================================================================

/** How long the nth consecutive failure makes you wait. */
function penaltyFor(attempts) {
  if (attempts <= SIGNIN_FREE_ATTEMPTS) return 0;
  const doublings = attempts - SIGNIN_FREE_ATTEMPTS - 1;
  return Math.min(SIGNIN_FIRST_PENALTY_MS * (2 ** doublings), SIGNIN_MAX_PENALTY_MS);
}

/** "4 minutes", "15 seconds" — for a human staring at an error message. */
function humanDelay(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/**
 * Is this account currently locked out?
 * @returns {Promise<number>} milliseconds still to wait, or 0.
 *
 * Note this only READS. Checking must never itself count as an attempt,
 * or a locked-out account would extend its own sentence every time the
 * owner refreshed the page.
 */
async function lockedFor(env, key) {
  const row = await env.DB.prepare('select retry_after from auth_throttle where key = ?')
    .bind(key).first();
  if (!row) return 0;
  return Math.max(0, Number(row.retry_after || 0) - Date.now());
}

/** Count a failure and set the next penalty. */
async function recordFailure(env, key) {
  const t = Date.now();
  const row = await env.DB.prepare(
    'select attempts, last_fail_at from auth_throttle where key = ?',
  ).bind(key).first();

  // A failure older than the decay window starts a fresh streak, so
  // scattered typos across a term never add up to a lockout.
  const previous = (!row || t - Number(row.last_fail_at || 0) > SIGNIN_DECAY_MS)
    ? 0 : Number(row.attempts || 0);
  const attempts = previous + 1;
  // Store a literal 0 rather than a deadline of "now" when there is no
  // penalty yet. Both read as unlocked, but only one of them says so.
  const penalty = penaltyFor(attempts);
  const retryAfter = penalty ? t + penalty : 0;

  await env.DB.prepare(`
    insert into auth_throttle (key, attempts, last_fail_at, retry_after) values (?, ?, ?, ?)
    on conflict (key) do update set attempts = ?, last_fail_at = ?, retry_after = ?
  `).bind(
    key, attempts, t, retryAfter,
    attempts, t, retryAfter,
  ).run();
}

/**
 * A rolling count for sign-up, which has no account to escalate against.
 * @returns true when still under the limit (and counts the try).
 */
export async function underGlobalLimit(env, key, max, windowMs) {
  const t = Date.now();
  const row = await env.DB.prepare(
    'select attempts, last_fail_at from auth_throttle where key = ?',
  ).bind(key).first();

  if (!row || t - Number(row.last_fail_at || 0) > windowMs) {
    await env.DB.prepare(`
      insert into auth_throttle (key, attempts, last_fail_at, retry_after) values (?, 1, ?, 0)
      on conflict (key) do update set attempts = 1, last_fail_at = ?, retry_after = 0
    `).bind(key, t, t).run();
    return true;
  }
  if (row.attempts >= max) return false;

  await env.DB.prepare('update auth_throttle set attempts = attempts + 1 where key = ?')
    .bind(key).run();
  return true;
}

/** Wipe the counter after a success, so a good password clears the slate. */
async function clearLimit(env, key) {
  await env.DB.prepare('delete from auth_throttle where key = ?').bind(key).run();
}

// =====================================================================
// Accounts
// =====================================================================

/**
 * Usernames are lowercased and restricted so that two accounts can never
 * differ only by case or by invisible whitespace. No email, no real-name
 * requirement — see the FERPA note in schema.sql.
 */
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normaliseUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** @returns an error string, or null when acceptable. */
export function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username)) {
    return 'Username must be 3–32 characters: letters, numbers, dots, dashes or underscores.';
  }
  if (String(password || '').length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Create an account.
 *
 * @returns {Promise<{ok: true, token: string, user: object} | {ok: false, error: string, status: number}>}
 *
 * Gated on SIGNUP_CODE, a shared secret handed out by the operator. Be
 * clear-eyed about what that is worth: a shared code keeps out drive-by
 * bots and randoms who find the URL, and nothing more. Anyone who has
 * the code — or guesses it, and a short institutional abbreviation is
 * guessable — can create an account. It is set as a Cloudflare secret
 * rather than living in this repo precisely so it can be rotated the
 * moment that matters, without a redeploy.
 */
export async function signUp(env, rawUsername, password, code) {
  if (!env.SIGNUP_CODE) {
    return { ok: false, status: 503, error: 'Sign-up is not configured on this server.' };
  }
  if (!(await underGlobalLimit(env, 'signup', SIGNUP_MAX_ATTEMPTS, SIGNUP_WINDOW_MS))) {
    return { ok: false, status: 429, error: 'Too many sign-up attempts. Try again later.' };
  }

  // Case-insensitive: the operator says the code aloud or writes it on a
  // whiteboard, and capitalisation is not the point of it.
  const given = String(code || '').trim().toLowerCase();
  const expected = String(env.SIGNUP_CODE).trim().toLowerCase();
  if (!given || !safeEqual(given, expected)) {
    return { ok: false, status: 403, error: 'That sign-up code is not right.' };
  }

  const username = normaliseUsername(rawUsername);
  const invalid = validateCredentials(username, password);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const taken = await env.DB.prepare('select 1 as yes from users where username = ?')
    .bind(username).first();
  if (taken) return { ok: false, status: 409, error: 'That username is already taken.' };

  const { salt, hash, iterations } = await hashPassword(env, password);
  const id = crypto.randomUUID();
  const t = Date.now();

  // The first account to exist becomes admin, and adopts anything left
  // over from the single-password era. See adoptLegacyRows().
  const firstEver = !(await env.DB.prepare('select 1 as yes from users limit 1').first());

  await env.DB.prepare(`
    insert into users (id, username, password_hash, salt, iterations, is_admin, created_at, last_seen_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, username, hash, salt, iterations, firstEver ? 1 : 0, t, t).run();

  if (firstEver) await adoptLegacyRows(env, id);

  await clearLimit(env, 'signup');
  return {
    ok: true,
    token: await issueToken(env, id),
    user: { id, username, is_admin: firstEver },
  };
}

/**
 * Hand pre-accounts data to the first account created.
 *
 * Before accounts existed every row was written with the literal
 * owner_id 'owner'. Those decks and sessions are real work and must not
 * be stranded, so the first account to sign up claims them.
 *
 * This is why docs/DEPLOYMENT.md says, in bold, to create your own
 * account before giving the signup code to anybody: whoever signs up
 * first inherits the existing decks and becomes the admin. On a fresh
 * install this matches zero rows and does nothing.
 */
async function adoptLegacyRows(env, userId) {
  await env.DB.batch([
    env.DB.prepare("update decks set owner_id = ? where owner_id = 'owner'").bind(userId),
    env.DB.prepare("update sessions set owner_id = ? where owner_id = 'owner'").bind(userId),
    env.DB.prepare("update backgrounds set owner_id = ? where owner_id = 'owner'").bind(userId),
  ]);
}

/**
 * Check a username and password.
 *
 * @returns {Promise<{ok: true, token: string, user: object} | {ok: false, error: string, status: number}>}
 *
 * The failure message is deliberately identical for "no such user" and
 * "wrong password" — never confirm to a stranger that an account exists.
 */
export async function signIn(env, rawUsername, password) {
  const username = normaliseUsername(rawUsername);
  if (!username || !password) {
    return { ok: false, status: 400, error: 'Enter your username and password.' };
  }

  const key = `user:${username}`;

  // Checked BEFORE the password is looked at, so a locked account costs
  // an attacker a database read and nothing more.
  const wait = await lockedFor(env, key);
  if (wait > 0) {
    return {
      ok: false,
      status: 429,
      error: `Too many failed attempts. Try again in ${humanDelay(wait)}.`,
      retryAfterMs: wait,
    };
  }

  const user = await env.DB.prepare('select * from users where username = ?')
    .bind(username).first();

  // Spend the same work on a missing user as on a real one. Returning
  // early here would make "no such account" measurably faster than "wrong
  // password", which is the same disclosure the shared error message is
  // there to prevent.
  if (!user) {
    await hashPassword(env, String(password));
    await recordFailure(env, key);
    return { ok: false, status: 401, error: 'Incorrect username or password.' };
  }

  if (!(await checkPassword(env, user, password))) {
    await recordFailure(env, key);
    return { ok: false, status: 401, error: 'Incorrect username or password.' };
  }

  // Upgrade the stored hash if the cost has been raised since this
  // password was set. This is the only moment the plaintext is in hand.
  if (user.iterations < PBKDF2_ITERATIONS) {
    const next = await hashPassword(env, password);
    await env.DB.prepare(
      'update users set password_hash = ?, salt = ?, iterations = ? where id = ?',
    ).bind(next.hash, next.salt, next.iterations, user.id).run();
  }

  await env.DB.prepare('update users set last_seen_at = ? where id = ?')
    .bind(Date.now(), user.id).run();
  await clearLimit(env, key);

  return {
    ok: true,
    token: await issueToken(env, user.id),
    user: { id: user.id, username: user.username, is_admin: !!user.is_admin },
  };
}

/** Change your own password. Requires the current one. */
export async function changePassword(env, user, currentPassword, newPassword) {
  const row = await env.DB.prepare('select * from users where id = ?').bind(user.id).first();
  if (!row) return { ok: false, status: 404, error: 'Account not found.' };
  if (!(await checkPassword(env, row, currentPassword))) {
    return { ok: false, status: 401, error: 'Your current password is not right.' };
  }
  const invalid = validateCredentials(row.username, newPassword);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const next = await hashPassword(env, newPassword);
  await env.DB.prepare(
    'update users set password_hash = ?, salt = ?, iterations = ? where id = ?',
  ).bind(next.hash, next.salt, next.iterations, row.id).run();
  return { ok: true };
}

/**
 * Admin-only password reset.
 *
 * This exists because there is no email address to send a reset link to
 * — a deliberate tradeoff, not an omission. Somebody has to be able to
 * unlock a colleague who forgot their password, and with no mail path
 * that somebody is the operator. Documented in docs/DEPLOYMENT.md.
 */
export async function resetPassword(env, admin, rawUsername, newPassword) {
  if (!admin?.is_admin) return { ok: false, status: 403, error: 'Admins only.' };
  const username = normaliseUsername(rawUsername);
  const row = await env.DB.prepare('select * from users where username = ?')
    .bind(username).first();
  if (!row) return { ok: false, status: 404, error: 'No account with that username.' };

  const invalid = validateCredentials(username, newPassword);
  if (invalid) return { ok: false, status: 400, error: invalid };

  const next = await hashPassword(env, newPassword);
  await env.DB.prepare(
    'update users set password_hash = ?, salt = ?, iterations = ? where id = ?',
  ).bind(next.hash, next.salt, next.iterations, row.id).run();
  await clearLimit(env, `user:${username}`);
  return { ok: true };
}

// =====================================================================
// Participant labels
//
// A student holds no credential and never will. But the random label a
// device claims IS the row key for its answers: the /respond upsert
// conflicts on (session_id, question_id, round, pseudonym, slot), so
// whoever sends a given label owns that row and can overwrite whatever is
// in it. Without a check, a crafted POST carrying another student's label
// silently replaces their answer, which matters most on a graded quiz.
//
// So the server signs a label when it issues it, and refuses any label it
// did not sign for this session. That does not identify anybody: the
// signature is over the label and the session id, both of which are
// already random and session-scoped, and it is not stored anywhere.
//
// The message is domain-prefixed so a participant label can never be
// replayed as an instructor token, which is signed over a different shape
// with the same key.
// =====================================================================

const pseudonymMessage = (sessionId, pseudonym) =>
  encoder.encode(`surveyall/pseudonym/v1:${sessionId}:${pseudonym}`);

/** Sign a freshly claimed label. Returned to the phone, replayed on every answer. */
export async function signPseudonym(env, sessionId, pseudonym) {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, pseudonymMessage(sessionId, pseudonym));
  return b64url(sig);
}

/** @returns true when this label was issued by this server for this session. */
export async function verifyPseudonym(env, sessionId, pseudonym, token) {
  if (!token || typeof token !== 'string') return false;
  if (!env.AUTH_SECRET) return false;
  try {
    const key = await hmacKey(env.AUTH_SECRET);
    return await crypto.subtle.verify(
      'HMAC', key, fromB64url(token), pseudonymMessage(sessionId, pseudonym));
  } catch {
    return false;
  }
}

/**
 * The display order for a question whose config order IS its answer key.
 *
 * `matching` and `timeline` are graded by position — a match is right when
 * left i points at right i, an event is right when it lands at place i —
 * so handing the phone the config order hands it the key. The phone has
 * always shuffled these for display, but with a seed derived from the
 * question id, which the phone already knows: anyone who read the client
 * could undo it. The shuffle has to be seeded by something the phone
 * cannot see, which means the server has to do it.
 *
 * Returns σ, where σ[displayed position] = original config index. The
 * worker sends items in σ order and maps answers back through σ before
 * storing, so what lands in `responses` is still in config-index space and
 * every existing grader, export and archived row keeps its meaning.
 *
 * Stable for a given question and length, because a phone that reloads
 * mid-answer must get the same order back or the student's arrangement
 * scrambles under them. Stability across sessions costs nothing: undoing
 * the permutation still requires the key it is hiding.
 */
export async function questionPermutation(env, questionId, n) {
  const order = Array.from({ length: n }, (_, i) => i);
  if (!env.AUTH_SECRET || n < 2) return order;

  // One HMAC gives 32 bytes; a Fisher-Yates over a realistic item count
  // needs far fewer, but draw more blocks if a question ever gets long.
  const key = await hmacKey(env.AUTH_SECRET);
  const bytes = [];
  for (let block = 0; bytes.length < n * 2; block += 1) {
    const sig = await crypto.subtle.sign(
      'HMAC', key, encoder.encode(`surveyall/shuffle/v1:${questionId}:${n}:${block}`));
    bytes.push(...new Uint8Array(sig));
  }

  // Fisher-Yates, taking two bytes per draw and reducing modulo the
  // remaining range. The modulo bias is negligible at these lengths and
  // irrelevant anyway: this hides an order, it does not generate keys.
  let cursor = 0;
  for (let i = n - 1; i > 0; i -= 1) {
    const draw = ((bytes[cursor] << 8) | bytes[cursor + 1]) % (i + 1);
    cursor += 2;
    [order[i], order[draw]] = [order[draw], order[i]];
  }
  return order;
}
