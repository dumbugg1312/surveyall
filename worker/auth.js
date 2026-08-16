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

/** Pull a Bearer token off a request. */
export function bearer(request) {
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
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
