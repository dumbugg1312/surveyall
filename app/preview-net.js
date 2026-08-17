/**
 * SurveyAll — the network, redirected, inside a preview iframe.
 *
 * present.html and join.html are opened by the editor with `?preview=1`.
 * This module replaces `fetch` and `WebSocket` for those two documents so
 * every API call and every realtime event is answered by the in-memory
 * room running in the editor tab (app/preview-room.js) instead of by the
 * Worker.
 *
 * IT IS PATCHED HERE, AT THE EDGE, ON PURPOSE. Not in db.js, and not with
 * a `preview` branch threaded through the controllers: the whole value of
 * this preview is that the projector and the phone are the real ones, so
 * the swap has to happen underneath the last line of code either of them
 * shares with production. db.js reads `window.fetch` at call time, which
 * is why replacing it after the module graph has loaded is enough.
 *
 * Nothing here writes. There is no session, no join code is consumed, and
 * no student row exists — that is the promise the preview banner makes,
 * and this file is where it is kept.
 */

const CHANNEL = 'surveyall-preview';
const ORIGIN = window.location.origin;
const room = window.parent;

/**
 * Uploaded backdrops are still served by the real Worker: they are
 * ordinary images behind an unguessable id, the preview has no copy of
 * them, and a projector that shows a grey rectangle where the deck's
 * background belongs is a preview that lies about the look.
 */
const PASS_THROUGH = /^\/api\/backgrounds\//;

let seq = 0;
const pending = new Map();

window.addEventListener('message', (event) => {
  if (event.origin !== ORIGIN) return;
  const msg = event.data;
  if (!msg || msg.channel !== CHANNEL) return;

  if (msg.kind === 'http-reply') {
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    entry.resolve(new Response(
      msg.body === null || msg.body === undefined ? '' : JSON.stringify(msg.body),
      { status: msg.status, headers: { 'Content-Type': 'application/json' } },
    ));
    return;
  }

  if (msg.kind === 'socket-open-ack') {
    sockets.get(msg.id)?.__open();
    return;
  }

  if (msg.kind === 'socket-event') {
    sockets.get(msg.id)?.__deliver(JSON.stringify({ event: msg.event, data: msg.data }));
  }
});

function ask(method, path, body) {
  return new Promise((resolve, reject) => {
    const id = (seq += 1);
    // If the editor closed the preview mid-flight nobody will ever answer.
    // db.js turns a rejection into "could not reach the server", which is
    // the honest thing for an iframe that has been orphaned.
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Preview closed.'));
    }, 8000);
    pending.set(id, { resolve, reject, timer });
    room.postMessage({ channel: CHANNEL, kind: 'http', id, method, path, body }, ORIGIN);
  });
}

// ------------------------------------------------------------- fetch

const realFetch = window.fetch.bind(window);

window.fetch = function previewFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input?.url;
  let url;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return realFetch(input, init);
  }

  if (url.origin !== ORIGIN
      || !url.pathname.startsWith('/api/')
      || PASS_THROUGH.test(url.pathname)) {
    return realFetch(input, init);
  }

  const method = (init.method || 'GET').toUpperCase();
  let body;
  if (init.body !== undefined) {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }
  return ask(method, url.pathname + url.search, body);
};

// --------------------------------------------------------- WebSocket

const sockets = new Map();

/**
 * Just enough WebSocket for db.js: open, message, close, error, and a
 * close() that actually detaches. Messages arrive as postMessage from the
 * room, which is the same fan-out shape the Durable Object has — one
 * sender, many listeners, roles decided by the server.
 */
class PreviewSocket extends EventTarget {
  constructor(url) {
    super();
    this.url = String(url);
    this.readyState = 0;
    this.__id = (seq += 1);
    sockets.set(this.__id, this);

    const path = new URL(this.url.replace(/^ws/, 'http')).pathname;
    room.postMessage(
      { channel: CHANNEL, kind: 'socket-open', id: this.__id, path }, ORIGIN);
  }

  __open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }

  __deliver(data) {
    if (this.readyState !== 1) return;
    this.dispatchEvent(new MessageEvent('message', { data }));
  }

  send() { /* the real room accepts only keepalives, and ignores them */ }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    sockets.delete(this.__id);
    room.postMessage({ channel: CHANNEL, kind: 'socket-close', id: this.__id }, ORIGIN);
    // Deliberately no 'close' event: db.js reconnects on close, and a
    // preview that reconnects to a room the editor has already torn down
    // would retry forever behind a closed dialog.
  }
}

window.WebSocket = PreviewSocket;
