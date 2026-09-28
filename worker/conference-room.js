/**
 * SurveyAll — ConferenceRoom Durable Object.
 *
 * One instance per conference board. Unlike SessionRoom, which is a pure
 * fan-out hub, this object HOLDS STATE: the board's cards — each student's
 * first name and last initial, topic, stage and place in line — live here and nowhere else.
 *
 * WHY HERE AND NOT IN D1. The rest of SurveyAll stores no student
 * identity at all, and the schema says so in a comment every contributor
 * reads. A conference board cannot work without a name — its whole job is
 * telling the instructor who to call up — so rather than weaken that rule
 * for the whole database, the names are kept out of it entirely:
 *
 *   • they exist only in this object's private storage, which no query,
 *     export, archive view or admin screen can reach;
 *   • `end` returns the log to the instructor once and then deletes
 *     everything (storage.deleteAll());
 *   • an alarm set at creation deletes everything BOARD_LIFETIME_MS after
 *     the board started, so a board nobody remembered to end still
 *     forgets its students by the next morning.
 *
 * POLICY SPLIT. The Worker authenticates: it checks the instructor token
 * and board ownership, or the signature on a phone's seat, before calling
 * in, and passes the verified role and seat. This object never trusts a
 * role or seat from a client. What it does decide is what each role may
 * change — a phone can edit only its own card and only the fields
 * cleanStudentPatch() allows; status changes are instructor ops.
 *
 * REALTIME. After every change, presenters get the whole board and each
 * phone gets its own card — never anyone else's, and never its place in
 * line. A phone that locks drops its socket; on waking it reconnects and
 * gets a fresh snapshot, and nothing it entered is lost, because the
 * state lives here rather than on the phone.
 */

import {
  BOARD_LIFETIME_MS, LIMITS, cleanLine, cleanStudentPatch, newCard,
} from '../app/conference-logic.js';

const OPEN = 1;

/** Per-seat write budget: a debounced phone sends a handful a minute. */
const SEAT_OPS_PER_MINUTE = 30;

export class ConferenceRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.meta = null;
    this.cards = null;
    this.writes = new Map();
    this.loading = null;

    if (typeof WebSocketRequestResponsePair === 'function'
        && typeof state.setWebSocketAutoResponse === 'function') {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }

  // ------------------------------------------------------------ storage

  /**
   * Read the board into memory, once per wake. Memoised as a promise so
   * that requests arriving together on a cold object share ONE read.
   * Cloudflare's input gates already hold a second request while the
   * first awaits storage, so this is belt-and-braces rather than a fix:
   * it keeps the object correct even if that default is ever relaxed.
   */
  load() {
    this.loading ??= (async () => {
      this.meta = (await this.state.storage.get('meta')) || null;
      const rows = await this.state.storage.list({ prefix: 'seat:' });
      const cards = new Map();
      for (const card of rows.values()) cards.set(card.seat, card);
      this.cards = cards;
    })();
    return this.loading;
  }

  async saveCard(card) {
    this.cards.set(card.seat, card);
    await this.state.storage.put(`seat:${card.seat}`, card);
  }

  async erase() {
    await this.state.storage.deleteAll();
    try { await this.state.storage.deleteAlarm(); } catch { /* none set */ }
    this.meta = null;
    this.cards = new Map();
  }

  // -------------------------------------------------------------- views

  boardView() {
    return {
      meta: this.meta,
      cards: [...this.cards.values()],
    };
  }

  /**
   * What a phone sees: the board's lists and its own card. Not its place
   * in line, and never another student — see queueOrder() for why.
   */
  studentView(seat) {
    // Whether the instructor has called them up is the instructor's
    // bookkeeping. Stripped rather than just ignored by the page, so no
    // version of the phone can ever turn into a "you're up" alert.
    const stored = this.cards.get(seat);
    const card = stored ? (({ call, callAt, ...own }) => own)(stored) : null;
    return {
      board: this.meta ? {
        title: this.meta.title,
        stages: this.meta.stages,
        topics: this.meta.topics,
        expiresAt: this.meta.expiresAt,
      } : null,
      card,
    };
  }

  // ----------------------------------------------------------- realtime

  send(ws, event, data) {
    try { ws.send(JSON.stringify({ event, data, at: Date.now() })); } catch {
      try { ws.close(1011, 'send failed'); } catch { /* gone */ }
    }
  }

  tagsOf(ws) {
    try { return ws.deserializeAttachment() || {}; } catch { return {}; }
  }

  broadcastAll() {
    const board = this.boardView();
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState !== undefined && ws.readyState !== OPEN) continue;
      const { role, seat } = this.tagsOf(ws);
      if (role === 'presenter') this.send(ws, 'board', board);
      else if (seat) this.send(ws, 'me', this.studentView(seat));
    }
  }

  closeAll(reason) {
    for (const ws of this.state.getWebSockets()) {
      this.send(ws, 'ended', { reason });
      try { ws.close(1000, 'board ended'); } catch { /* gone */ }
    }
  }

  // ---------------------------------------------------------------- entry

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') {
      // The Worker authenticated this socket and chose these values.
      const role = url.searchParams.get('role') === 'presenter' ? 'presenter' : 'participant';
      const seat = role === 'participant' ? String(url.searchParams.get('seat') || '') : '';
      await this.load();

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server, [role]);
      server.serializeAttachment({ role, seat });

      // A snapshot straight away: a phone waking from a locked screen
      // should see where it stands without waiting for the next change.
      if (!this.meta) this.send(server, 'ended', { reason: 'erased' });
      else if (role === 'presenter') this.send(server, 'board', this.boardView());
      else this.send(server, 'me', this.studentView(seat));

      const headers = {};
      const offered = (request.headers.get('Sec-WebSocket-Protocol') || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      if (offered.length) headers['Sec-WebSocket-Protocol'] = offered[0];
      return new Response(null, { status: 101, webSocket: client, headers });
    }

    if (request.headers.get('X-Room-Secret') !== (this.env.AUTH_SECRET || '')) {
      return new Response('forbidden', { status: 403 });
    }

    const msg = await request.json().catch(() => ({}));
    const res = await this.op(msg);
    return new Response(JSON.stringify(res.body ?? null), {
      status: res.status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Apply one operation. `role` and `seat` came from the Worker, which
   * verified them; `data` came from a client and is cleaned here.
   */
  async op({ op, role, seat, data = {}, now = Date.now() }) {
    await this.load();
    const ok = (body) => ({ status: 200, body });
    const no = (status, error) => ({ status, body: { error } });

    // ---- creation (instructor, once) -----------------------------------
    if (op === 'init') {
      if (role !== 'presenter') return no(403, 'Instructors only.');
      if (this.meta) return ok({ ok: true });
      this.meta = {
        boardId: String(data.boardId || ''),
        title: cleanLine(data.title, LIMITS.title),
        stages: data.stages,
        topics: data.topics,
        target: data.target,
        createdAt: now,
        expiresAt: now + BOARD_LIFETIME_MS,
      };
      await this.state.storage.put('meta', this.meta);
      await this.state.storage.setAlarm(this.meta.expiresAt);
      return ok({ ok: true });
    }

    if (!this.meta) return no(410, 'This conference board has ended.');

    // ---- instructor ------------------------------------------------------
    if (role === 'presenter') {
      if (op === 'view') return ok(this.boardView());

      if (op === 'end') {
        const log = this.boardView();
        this.closeAll('ended');
        await this.erase();
        return ok(log);
      }

      const card = this.cards.get(String(data.seat || ''));
      if (!card) return no(404, 'That student is no longer on the board.');
      const next = { ...card };

      if (op === 'call') {
        next.call = 'with';
        next.callAt = now;
      } else if (op === 'done') {
        // Allowed from any state, not only after "call up": a roving
        // conference at the student's desk is still a conference, it just
        // has no call-up to time it from.
        next.conferences = [...(card.conferences || []), {
          start: card.call === 'with' ? card.callAt : now,
          end: now,
          about: card.ask?.about || '',
          note: card.ask?.note || '',
        }];
        next.ask = null;
        next.call = '';
        next.callAt = 0;
        next.stepPending = true;
      } else if (op === 'back') {
        // Back in line, keeping their original place: they did not lose
        // their turn because the instructor called them early.
        next.call = '';
        next.callAt = 0;
      } else if (op === 'clear') {
        // Answered from across the room — no conference to record.
        next.ask = null;
        next.call = '';
        next.callAt = 0;
      } else if (op === 'remove') {
        this.cards.delete(card.seat);
        await this.state.storage.delete(`seat:${card.seat}`);
        this.broadcastAll();
        return ok({ ok: true });
      } else {
        return no(400, 'Unknown action.');
      }
      next.updatedAt = now;
      await this.saveCard(next);
      this.broadcastAll();
      return ok({ ok: true });
    }

    // ---- a student's phone ------------------------------------------------
    if (!seat) return no(403, 'This device has not joined the board. Reload the page.');
    if (op === 'me') return ok(this.studentView(seat));

    if (!this.underBudget(seat, now)) return no(429, 'Slow down a moment, then try again.');

    let card = this.cards.get(seat);
    if (op === 'save') {
      const patch = cleanStudentPatch(data, this.meta.stages?.length);
      if (!card) {
        if (!patch.name) return no(400, 'Add your first name and last initial so your instructor knows who you are.');
        if (this.cards.size >= LIMITS.seats) return no(409, 'This board is full.');
        card = newCard(seat, now);
      }
      if (patch.name === '') delete patch.name; // a name can change, not vanish
      const next = { ...card, ...patch, updatedAt: now };
      if (patch.mood !== undefined && patch.mood !== card.mood) next.moodAt = now;
      await this.saveCard(next);
      this.broadcastAll();
      return ok(this.studentView(seat));
    }

    if (!card) return no(409, 'Add your name first.');

    if (op === 'ask') {
      const about = cleanLine(data.about, LIMITS.listItem);
      if (!about) return no(400, 'Pick what you want to talk about.');
      // Editing a request keeps its place in line; only a new one queues.
      const at = card.ask?.at || now;
      await this.saveCard({
        ...card,
        ask: { about, note: cleanLine(data.note, LIMITS.note), at },
        updatedAt: now,
      });
    } else if (op === 'unask') {
      await this.saveCard({ ...card, ask: null, updatedAt: now });
    } else if (op === 'step') {
      await this.saveCard({
        ...card,
        step: cleanLine(data.text, LIMITS.step),
        stepPending: false,
        updatedAt: now,
      });
    } else {
      return no(400, 'Unknown action.');
    }
    this.broadcastAll();
    return ok(this.studentView(seat));
  }

  underBudget(seat, now) {
    const recent = (this.writes.get(seat) || []).filter((t) => now - t < 60_000);
    if (recent.length >= SEAT_OPS_PER_MINUTE) return false;
    recent.push(now);
    this.writes.set(seat, recent);
    return true;
  }

  // ------------------------------------------------------------- alarms

  /** Twelve hours on: forget everyone, whether or not anybody ended it. */
  async alarm() {
    await this.load();
    this.closeAll('expired');
    await this.erase();
  }

  // --------------------------------------------------- hibernation hooks

  async webSocketMessage(ws, raw) {
    // Keepalive only. Every change goes through the Worker's HTTP API,
    // where the seat signature is checked.
    if (raw === 'ping') {
      try { ws.send('pong'); } catch { /* closing */ }
    }
  }

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(ws) {
    try { ws.close(1011, 'error'); } catch { /* already closed */ }
  }
}
