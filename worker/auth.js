/**
 * SurveyAll — instructor authentication.
 *
 * One instructor, one password, held in Cloudflare's encrypted secret
 * store (never in the database, never in the repo). Signing in exchanges
 * the password for a short-lived HMAC-signed token that the browser
 * keeps in localStorage and sends as a Bearer header.
 *
 * Everything here is deliberately cheap: Cloudflare's free plan allows
 * 10ms of CPU per request, which is plenty for one HMAC but nowhere near
 * enough for a real password hash. See the note in worker/schema.sql for
 * why storing the password as a platform secret is the right call here
 * rather than a shortcut.
 *
 * Students never touch any of this. They authenticate with nothing at
 * all — a session join code is not a credential, it's a room number.
 */

const encoder = new TextEncoder();

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

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

/** Issue a signed token. Payload is just an expiry — there is no identity. */
export async function issueToken(env) {
  const secret = env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');

  const payload = b64url(encoder.encode(JSON.stringify({
    exp: Date.now() + TOKEN_TTL_MS,
    v: 1,
  })));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** @returns true when the token is well-formed, correctly signed and unexpired. */
export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string') return false;
  const secret = env.AUTH_SECRET;
  if (!secret) return false;

  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  let ok = false;
  try {
    const key = await hmacKey(secret);
    ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), encoder.encode(payload));
  } catch {
    return false;
  }
  if (!ok) return false;

  try {
    const body = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof body.exp === 'number' && body.exp > Date.now();
  } catch {
    return false;
  }
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

/** True when this request carries a valid instructor token. */
export async function isInstructor(request, env) {
  return verifyToken(env, bearer(request));
}

/**
 * Check a submitted password against the configured secret.
 * Returns a token on success, null on failure — the caller must not
 * reveal which of "no password set" or "wrong password" occurred.
 */
export async function signIn(env, password) {
  const expected = env.INSTRUCTOR_PASSWORD;
  if (!expected) return null;
  if (!password || !safeEqual(password, expected)) return null;
  return issueToken(env);
}
