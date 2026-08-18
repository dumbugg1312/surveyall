/**
 * SurveyAll — every backend call in one place.
 *
 * This is the ONLY file that knows a backend exists. Every exported name
 * here kept its shape when the project moved from Supabase to Cloudflare,
 * which is why that migration touched no page controller, no chart, and
 * no test. Keep it that way: if a new backend is ever needed, this file
 * is the whole surface area.
 *
 * Two audiences use it:
 *   • the instructor — authenticated with a bearer token
 *   • the student — no account, no credential, no identity at all
 *
 * Student-facing calls go to /api/join/<code>/… on purpose. Those
 * endpoints exist so a phone can be given exactly what it needs and
 * nothing else: the Worker strips quiz answer keys before they leave the
 * server, and there is no route at all that would hand a participant raw
 * responses.
 */

import { apiURL, isConfigured } from './config.js';

export const configured = isConfigured();

const TOKEN_KEY = 'surveyall:token';

// =====================================================================
// HTTP
// =====================================================================

function getToken() {
  try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch { /* private browsing — the session still works in-memory */ }
}

async function api(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(apiURL(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection.');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    const message = (data && data.error) || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// =====================================================================
// Auth — instructor only. Students never touch any of this.
// =====================================================================

let cachedUser = null;
const authListeners = new Set();

function emitAuth(user) {
  cachedUser = user;
  authListeners.forEach((cb) => { try { cb(user); } catch { /* ignore */ } });
}

/**
 * @returns {Promise<{id, username, is_admin}|null>} the signed-in
 * instructor. The server resolves the token to a real row on every call,
 * so a deleted account stops working immediately rather than at expiry.
 */
export async function currentUser() {
  if (!getToken()) return null;
  if (cachedUser) return cachedUser;
  try {
    const res = await api('/api/auth/check', { auth: true });
    if (res?.ok && res.user) { emitAuth(res.user); return cachedUser; }
  } catch { /* fall through */ }
  setToken(null);
  return null;
}

/** Sign in with a username and password. */
export async function signIn(username, password) {
  const res = await api('/api/auth/signin', {
    method: 'POST',
    body: { username, password },
  });
  setToken(res.token);
  emitAuth(res.user);
  return cachedUser;
}

/**
 * Create an account. `code` is the shared sign-up code the operator
 * hands out — there is no email address in this system, so that code is
 * the only thing gating who can make an account.
 */
export async function signUp(username, password, code) {
  const res = await api('/api/auth/signup', {
    method: 'POST',
    body: { username, password, code },
  });
  setToken(res.token);
  emitAuth(res.user);
  return cachedUser;
}

/** Whether this deployment has sign-up switched on at all. */
export async function signUpEnabled() {
  try {
    const res = await api('/api/auth/config');
    return !!res?.signup_enabled;
  } catch { return false; }
}

/** Change your own password. Requires the current one. */
export async function changePassword(current, next) {
  return api('/api/auth/password', { method: 'POST', auth: true, body: { current, next } });
}

/**
 * Admin-only: set another user's password.
 * This is the whole account-recovery story — no email means no reset
 * link. See docs/DEPLOYMENT.md.
 */
export async function resetUserPassword(username, next) {
  return api('/api/auth/reset', { method: 'POST', auth: true, body: { username, next } });
}

export async function signOut() {
  setToken(null);
  emitAuth(null);
}

export function onAuthChange(cb) {
  authListeners.add(cb);
  return { unsubscribe() { authListeners.delete(cb); } };
}

/** True when the API is reachable and configured. Used by the setup screen. */
export async function health() {
  try {
    await api('/api/auth/check');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// =====================================================================
// Decks
// =====================================================================

export const listDecks = () => api('/api/decks', { auth: true });
export const getDeck = (id) => api(`/api/decks/${id}`, { auth: true });

export const createDeck = (fields = {}) =>
  api('/api/decks', { method: 'POST', body: fields, auth: true });

export const updateDeck = (id, patch) =>
  api(`/api/decks/${id}`, { method: 'PATCH', body: patch, auth: true });

export const deleteDeck = (id) =>
  api(`/api/decks/${id}`, { method: 'DELETE', auth: true });

/** Rotate a deck's permanent join code. @returns {Promise<{join_code: string}>} */
export const regenerateDeckCode = (id) =>
  api(`/api/decks/${id}/code`, { method: 'POST', auth: true });

// =====================================================================
// Questions
// =====================================================================

export const listQuestions = (deckId) =>
  api(`/api/decks/${deckId}/questions`, { auth: true });

export const createQuestion = (deckId, q, position) =>
  api(`/api/decks/${deckId}/questions`, {
    method: 'POST',
    body: { type: q.type, prompt: q.prompt || '', config: q.config || {}, position: position ?? 0 },
    auth: true,
  });

export const updateQuestion = (id, patch) =>
  api(`/api/questions/${id}`, { method: 'PATCH', body: patch, auth: true });

export const deleteQuestion = (id) =>
  api(`/api/questions/${id}`, { method: 'DELETE', auth: true });

/** Rewrite the whole question list for a deck (used by the text import). */
export const replaceQuestions = (deckId, questions) =>
  api(`/api/decks/${deckId}/questions`, {
    method: 'PUT', body: { questions }, auth: true,
  });

export const reorderQuestions = (deckId, orderedIds) => {
  if (!orderedIds?.length) return Promise.resolve({ ok: true });
  return api(`/api/decks/${deckId}/questions/reorder`, {
    method: 'POST', body: { ids: orderedIds }, auth: true,
  });
};

// =====================================================================
// Sessions
// =====================================================================

/**
 * Sessions, newest first, each carrying what came of it.
 *
 * Rows from this endpoint (and only this one — a single-session GET has
 * no counts on it) also have `participant_count`, `response_count`,
 * `answered_count` and `last_response_at`. They are aggregates: the
 * number of distinct pseudonyms, never the pseudonyms themselves.
 */
export const listSessions = (deckId) =>
  api(`/api/sessions${deckId ? `?deck=${encodeURIComponent(deckId)}` : ''}`, { auth: true });

export const getSession = (id) => api(`/api/sessions/${id}`, { auth: true });

/**
 * Public lookup by join code — a student's first call.
 * Also caches code↔id so the realtime helpers below can pick the
 * participant route without the caller having to know about it.
 */
export async function getSessionByCode(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  try {
    const session = await api(`/api/join/${encodeURIComponent(clean)}`);
    if (session?.id) codeById.set(session.id, clean);
    return session;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export const createSession = (deckId, label = '', theme) =>
  api('/api/sessions', { method: 'POST', body: { deckId, label, theme }, auth: true });

export const updateSession = (id, patch) =>
  api(`/api/sessions/${id}`, { method: 'PATCH', body: patch, auth: true });

export const deleteSession = (id) =>
  api(`/api/sessions/${id}`, { method: 'DELETE', auth: true });

// =====================================================================
// Live participation (anonymous)
// =====================================================================

const codeById = new Map();

function codeFor(sessionId) {
  return codeById.get(sessionId) || null;
}

/** The live question, with the answer key already stripped server-side. */
export async function fetchLiveQuestion(sessionId) {
  const code = codeFor(sessionId);
  if (!code) return null;
  return api(`/api/join/${code}/question`);
}

/** Claim a distinct random label for this session. No identity involved. */
/** @returns {Promise<{pseudonym: string, token: string}>} label plus the server's signature over it. */
export async function claimPseudonym(sessionId) {
  const code = codeFor(sessionId);
  if (!code) throw new Error('Not joined to a session.');
  const res = await api(`/api/join/${code}/pseudonym`, { method: 'POST', body: {} });
  if (!res || !res.pseudonym || !res.token) throw new Error('Could not join this session.');
  return { pseudonym: res.pseudonym, token: res.token };
}

export async function submitResponse({
  sessionId, questionId, round, pseudonym, pseudonymToken, payload, slot = 0,
}) {
  const code = codeFor(sessionId);
  if (!code) throw new Error('Not joined to a session.');
  // pseudonymToken is what stops one phone overwriting another's answer by
  // sending its label; the server refuses any label it did not sign.
  return api(`/api/join/${code}/respond`, {
    method: 'POST',
    body: { questionId, round, pseudonym, pseudonymToken, payload, slot },
  });
}

/** Aggregates for the student's own phone — null unless the presenter pushed them. */
export async function fetchSharedResults(sessionId, questionId, round) {
  const code = codeFor(sessionId);
  if (!code) return null;
  const params = new URLSearchParams({ question: questionId });
  if (round != null) params.set('round', String(round));
  return api(`/api/join/${code}/results?${params}`);
}

// =====================================================================
// Results (instructor)
// =====================================================================

export function fetchResponses(sessionId, questionId, round) {
  const params = new URLSearchParams();
  if (questionId) params.set('question', questionId);
  if (round != null) params.set('round', String(round));
  const qs = params.toString();
  return api(`/api/sessions/${sessionId}/responses${qs ? `?${qs}` : ''}`, { auth: true });
}

export const deleteResponse = (id) =>
  api(`/api/responses/${id}`, { method: 'DELETE', auth: true });

export function clearResponses(sessionId, questionId, round) {
  const params = new URLSearchParams();
  if (questionId) params.set('question', questionId);
  if (round != null) params.set('round', String(round));
  const qs = params.toString();
  return api(`/api/sessions/${sessionId}/responses${qs ? `?${qs}` : ''}`,
    { method: 'DELETE', auth: true });
}

export async function maxRound(sessionId, questionId) {
  const res = await api(
    `/api/sessions/${sessionId}/maxround?question=${encodeURIComponent(questionId)}`,
    { auth: true });
  return res?.round ?? 1;
}

// =====================================================================
// Q&A
// =====================================================================

export async function askAudienceQuestion(sessionId, body, autoApprove) {
  const code = codeFor(sessionId);
  if (!code) throw new Error('Not joined to a session.');
  return api(`/api/join/${code}/qa`, { method: 'POST', body: { body, autoApprove } });
}

/** Instructor sees everything; a participant sees only approved questions. */
export async function listAudienceQuestions(sessionId) {
  if (getToken()) {
    try {
      return await api(`/api/sessions/${sessionId}/qa`, { auth: true });
    } catch { /* fall back to the public view */ }
  }
  const code = codeFor(sessionId);
  if (!code) return [];
  return api(`/api/join/${code}/qa`);
}

export async function upvoteAudienceQuestion(sessionId, id) {
  const code = codeFor(sessionId);
  if (!code) throw new Error('Not joined to a session.');
  const res = await api(`/api/join/${code}/qa/${id}/upvote`, { method: 'POST', body: {} });
  return res.upvotes;
}

export const moderateAudienceQuestion = (id, patch) =>
  api(`/api/qa/${id}`, { method: 'PATCH', body: patch, auth: true });

// =====================================================================
// Realtime
//
// One WebSocket per session, shared by every subscriber on the page, so
// a presenter watching session state, responses and Q&A holds a single
// connection rather than three. That matters: connections are the one
// resource a classroom actually consumes at scale.
// =====================================================================

const sockets = new Map();

// How often a client says "still here", and how long it will wait for any
// reply before deciding the socket is dead.
//
// A TCP connection that is dropped without a close frame — a phone going
// through a tunnel, campus wifi handing off between APs, iOS suspending a
// backgrounded tab — leaves `readyState === OPEN` forever. No 'close'
// event fires, so the retry ladder below never runs, and the page sits
// there looking connected while the room moves on without it. The only
// way to find out is to send something and notice that nothing comes
// back. The Durable Object answers 'ping' with 'pong' (see
// worker/session-room.js) precisely so this can exist.
const PING_MS = 25000;
const SILENCE_MS = PING_MS * 2 + 5000;

function socketFor(sessionId) {
  let entry = sockets.get(sessionId);
  if (entry) return entry;

  entry = {
    ws: null, handlers: new Set(), closed: false, retry: 0, timer: null,
    ping: null, lastSeen: 0, connect: null,
  };
  sockets.set(sessionId, entry);

  const connect = () => {
    if (entry.closed) return;

    const code = codeFor(sessionId);
    const authed = !!getToken();
    // Presenters use the authenticated session route; students use the
    // join-code route, which is the only one they can reach.
    const path = (!authed && code)
      ? `/api/join/${code}/ws`
      : `/api/sessions/${sessionId}/ws`;

    const url = new URL(apiURL(path), window.location.href);
    url.protocol = url.protocol.replace('http', 'ws');

    let ws;
    try {
      // A browser cannot put an Authorization header on a WebSocket
      // handshake, so a presenter's token travels as a subprotocol.
      // Participants send nothing: their route is unauthenticated by
      // design and offering a protocol they don't need would only be
      // one more thing to get wrong.
      const token = getToken();
      ws = (authed && token)
        ? new WebSocket(url.toString(), ['surveyall.bearer', token])
        : new WebSocket(url.toString());
    } catch {
      scheduleRetry();
      return;
    }
    entry.ws = ws;

    ws.addEventListener('open', () => {
      entry.retry = 0;
      entry.lastSeen = Date.now();
      startHeartbeat();
    });

    ws.addEventListener('message', (ev) => {
      // Any frame at all proves the link is alive, 'pong' included — which
      // is the whole reason the heartbeat is worth sending.
      entry.lastSeen = Date.now();
      if (ev.data === 'pong') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      entry.handlers.forEach((h) => {
        try { h(msg.event, msg.data); } catch (err) { console.error(err); }
      });
    });

    ws.addEventListener('close', () => { stopHeartbeat(); scheduleRetry(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch { /* ignore */ } });
  };

  entry.connect = connect;

  function stopHeartbeat() {
    clearInterval(entry.ping);
    entry.ping = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    entry.ping = setInterval(() => {
      const ws = entry.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Nothing has come back in two whole ping cycles: this socket is
      // open in name only. Close it by hand so the 'close' handler runs
      // and the retry ladder actually gets a chance to reconnect.
      if (Date.now() - entry.lastSeen > SILENCE_MS) {
        try { ws.close(); } catch { /* ignore */ }
        return;
      }
      try { ws.send('ping'); } catch { /* the close handler will pick it up */ }
    }, PING_MS);
  }

  function scheduleRetry() {
    if (entry.closed) return;
    // Back off, but never past a few seconds: a class is happening and a
    // reconnect that takes a minute is the same as a broken app.
    entry.retry = Math.min(entry.retry + 1, 5);
    const wait = Math.min(500 * 2 ** (entry.retry - 1), 5000);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(connect, wait);
  }

  connect();
  return entry;
}

function subscribe(sessionId, handler) {
  const entry = socketFor(sessionId);
  entry.handlers.add(handler);
  return () => {
    entry.handlers.delete(handler);
    if (entry.handlers.size === 0) {
      entry.closed = true;
      clearTimeout(entry.timer);
      clearInterval(entry.ping);
      entry.ping = null;
      try { entry.ws?.close(); } catch { /* ignore */ }
      sockets.delete(sessionId);
    }
  };
}

/**
 * Wake every live socket, now, without waiting for the backoff ladder.
 *
 * A phone that has been locked or backgrounded comes back with its timers
 * throttled and, very often, with a socket the OS quietly tore down. The
 * page has no way to know which, so on becoming visible it calls this: an
 * already-healthy socket just gets an early keepalive, and a dead one is
 * reconnected on the spot rather than in however many seconds the backoff
 * had reached. Idempotent, so calling it on every wake is fine.
 */
export function reconnectSockets() {
  sockets.forEach((entry) => {
    if (entry.closed) return;
    const ws = entry.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // "OPEN" after a suspend is a claim, not a fact. Ping it and give it
      // three seconds to prove itself; if nothing comes back, close it so
      // the reconnect happens now rather than at the next heartbeat.
      const sentAt = Date.now();
      try { ws.send('ping'); } catch { /* the timeout below handles it */ }
      setTimeout(() => {
        if (entry.closed || entry.ws !== ws) return;
        if (entry.lastSeen < sentAt && ws.readyState === WebSocket.OPEN) {
          try { ws.close(); } catch { /* ignore */ }
        }
      }, 3000);
      return;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    clearTimeout(entry.timer);
    entry.retry = 0;
    entry.connect?.();
  });
}

/** Watch one session: how a phone follows the presenter. */
export function subscribeToSession(sessionId, onChange) {
  return subscribe(sessionId, (event, data) => {
    if (event === 'session') onChange(data);
  });
}

/**
 * How many phones are connected right now. Presenter only — the Durable
 * Object sends this event to presenter sockets alone. `onCount` receives a
 * plain number, so the room's live headcount can drive the lobby.
 */
export function subscribeToPresence(sessionId, onCount) {
  return subscribe(sessionId, (event, data) => {
    if (event === 'presence' && typeof data?.participants === 'number') {
      onCount(data.participants);
    }
  });
}

/** Watch incoming answers: how the projector animates. Presenter only. */
export function subscribeToResponses(sessionId, onInsert) {
  return subscribe(sessionId, (event, data) => {
    if (event === 'response') onInsert(data, 'INSERT');
    else if (event === 'responses-cleared') onInsert(null, 'CLEARED');
  });
}

export function subscribeToAudienceQuestions(sessionId, onChange) {
  return subscribe(sessionId, (event) => {
    if (event === 'qa') onChange();
  });
}

// =====================================================================
// Background images
//
// Stored in the database as compressed data URIs rather than object
// storage: Cloudflare R2 requires a payment method, and this project's
// hard rule is that no card is ever needed. Downscaling happens here, in
// the browser, so a 6 MB phone photo becomes a few hundred KB before it
// is ever sent.
// =====================================================================

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.82;

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // PNG screenshots of slides compress terribly as PNG and beautifully
  // as JPEG; backgrounds are photographic, so JPEG is always right here.
  let quality = JPEG_QUALITY;
  let dataUri = canvas.toDataURL('image/jpeg', quality);
  while (dataUri.length > 1_200_000 && quality > 0.4) {
    quality -= 0.12;
    dataUri = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUri;
}

export async function uploadBackground(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('That is not an image.');
  const dataUri = await downscale(file);
  const res = await api('/api/backgrounds', {
    method: 'POST', body: { dataUri }, auth: true,
  });
  return { path: res.id, url: apiURL(res.url) };
}

export async function listBackgrounds() {
  try {
    const rows = await api('/api/backgrounds', { auth: true });
    return (rows || []).map((r) => ({ path: r.id, url: apiURL(`/api/backgrounds/${r.id}`) }));
  } catch {
    return [];
  }
}

export const deleteBackground = (path) =>
  api(`/api/backgrounds/${path}`, { method: 'DELETE', auth: true });

// =====================================================================
// Feedback — notes for whoever runs this site
// =====================================================================

/**
 * Leave a note. Works signed out: the server records the username only
 * when there is one, and stores no way to reply otherwise.
 * @param {string} body what they wrote
 * @param {string} page path it was written from, e.g. '/dashboard'
 */
export const sendFeedback = (body, page) =>
  api('/api/feedback', { method: 'POST', body: { body, page }, auth: true });

/** Admin only. Newest first. */
export const listFeedback = () => api('/api/feedback', { auth: true });

export const markFeedback = (id, handled) =>
  api(`/api/feedback/${id}`, { method: 'PATCH', body: { handled }, auth: true });

export const deleteFeedback = (id) =>
  api(`/api/feedback/${id}`, { method: 'DELETE', auth: true });
