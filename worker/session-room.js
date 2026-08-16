/**
 * SurveyAll — SessionRoom Durable Object.
 *
 * One instance per live session, addressed by session id. It is a pure
 * fan-out hub: it holds the WebSocket connections for that room and
 * relays events the Worker hands it. It never touches the database and
 * never decides policy — the Worker does all of that before calling in.
 *
 * WHY A DURABLE OBJECT: every phone in the room must learn within a
 * moment that the presenter advanced a question. Polling 60 devices
 * against the API would burn the daily request budget and still feel
 * sluggish; a DO gives every session a single addressable place that all
 * its sockets are already attached to.
 *
 * ROLES ARE A SECURITY BOUNDARY, NOT A CONVENIENCE. Sockets are tagged
 * 'presenter' or 'participant' at accept time. Raw response rows are
 * broadcast ONLY to presenter sockets. If a participant socket ever
 * received them, a student could read the room's answers — including,
 * for a quiz, before answering. Keep that split.
 *
 * HIBERNATION: sockets are accepted through the hibernation API, so an
 * idle room costs no compute while students sit connected between
 * questions. Without it, a 50-minute class would bill duration for the
 * whole lesson rather than the moments something happens.
 */

export class SessionRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // ---- internal: Worker asking us to broadcast --------------------
    if (url.pathname.endsWith('/broadcast')) {
      // Only the Worker can reach a DO — there is no public route to one
      // — but check a shared secret anyway so a bug in routing can't
      // turn this into an open megaphone.
      if (request.headers.get('X-Room-Secret') !== (this.env.AUTH_SECRET || '')) {
        return new Response('forbidden', { status: 403 });
      }
      const { event, data, to } = await request.json();
      this.broadcast(event, data, to);
      return new Response(null, { status: 204 });
    }

    // ---- WebSocket upgrade -------------------------------------------
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    // The Worker has already authenticated and passed the role through;
    // we never trust a role claimed by the client itself.
    const role = url.searchParams.get('role') === 'presenter' ? 'presenter' : 'participant';

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server, [role]);

    // If the client offered subprotocols we MUST select one, or the
    // browser rejects the handshake. A presenter offers
    // ['surveyall.bearer', <token>] because a WebSocket has no other way
    // to authenticate; echo the marker back, never the token itself.
    const headers = {};
    const offered = (request.headers.get('Sec-WebSocket-Protocol') || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (offered.length) headers['Sec-WebSocket-Protocol'] = offered[0];

    return new Response(null, { status: 101, webSocket: client, headers });
  }

  /**
   * @param {string} event
   * @param {any} data
   * @param {'all'|'presenter'|'participant'} to
   */
  broadcast(event, data, to = 'all') {
    const message = JSON.stringify({ event, data, at: Date.now() });
    const sockets = to === 'all'
      ? this.state.getWebSockets()
      : this.state.getWebSockets(to);

    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch {
        // A socket that has gone away throws on send; drop it and move
        // on. One dead phone must never stop the rest of the room from
        // receiving the next question.
        try { ws.close(1011, 'send failed'); } catch { /* already gone */ }
      }
    }
  }

  // ---- hibernation handlers -----------------------------------------

  async webSocketMessage(ws, raw) {
    // The only thing a client may send is a keepalive. Everything that
    // changes state goes through the Worker's HTTP API, where it can be
    // authenticated and validated. Accepting commands here would bypass
    // every rule the Worker enforces.
    if (raw === 'ping') {
      try { ws.send('pong'); } catch { /* closing */ }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }
}
