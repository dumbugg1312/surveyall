/**
 * SurveyAll — the classroom, faked, so you can walk through a deck alone.
 *
 * This is a working model of the Worker's API held entirely in memory: a
 * session, its questions, its responses and its Q&A, plus the fan-out that
 * a Durable Object normally does. It runs inside the editor tab and
 * answers two iframes — present.html and join.html — over postMessage.
 *
 * WHY A FAKE SERVER RATHER THAN A FAKE SCREEN. A preview drawn by its own
 * renderer is a picture of what somebody thought the projector does. This
 * runs the projector: the same present-page.js, the same charts, the same
 * springs, the same phone. Everything below the network line is the real
 * thing, so the preview cannot drift from the product — and pressing → on
 * the projector moves the phone, because that is exactly how it works in
 * a room.
 *
 * NOTHING HERE TOUCHES THE DATABASE. No session row is created, no
 * response is written, no join code is consumed. Closing the preview
 * leaves no trace, which is the whole promise the banner makes.
 *
 * The route table below deliberately mirrors worker/index.js. When a route
 * changes there, change it here — a preview that answers a request the
 * real server would refuse is worse than no preview at all.
 */

import {
  isContentSlide, sortedQuestions, optionLabels, MULTI_SUBMIT_TYPES,
} from './logic.js';
// The answers themselves. Shared with the editor's slide previews so a
// rehearsal and a preview of the same slide show the same room.
import {
  NO_RESPONSES, AUDIENCE_QUESTIONS,
  createSampleStream, nextName, samplePayload, sampleTarget,
} from './sample-class.js';

const CHANNEL = 'surveyall-preview';

/**
 * Write limits, mirrored from worker/index.js.
 *
 * KEEP THESE IN STEP with the Worker's MAX_SLOT and RESPONSE_MAX_CHARS.
 * Nothing enforces the match, and the cost of drift is an instructor who
 * rehearses a deck that behaves one way here and another way in class.
 */
const MAX_SLOT = 49;
const RESPONSE_MAX_CHARS = 4000;


// =====================================================================
// The room
// =====================================================================

let roomSeq = 0;

/**
 * Build a preview room around a snapshot of the deck being edited.
 *
 * @param {object} deck        the in-memory deck, unsaved edits included
 * @param {object[]} questions the in-memory slide list
 * @returns a controller: {sessionId, joinCode, setTestResponses, destroy}
 */
export function createPreviewRoom(deck, questions) {
  roomSeq += 1;
  const sessionId = `preview-${roomSeq}`;
  const joinCode = deck.join_code || 'PREVUE';

  const slides = sortedQuestions(questions).map((q) => ({
    ...q,
    config: JSON.parse(JSON.stringify(q.config || {})),
  }));

  const session = {
    id: sessionId,
    deck_id: deck.id,
    owner_id: 'preview',
    join_code: joinCode,
    label: 'Preview',
    theme: deck.theme,
    state: 'lobby',
    current_question_id: null,
    current_round: 1,
    accepting: true,
    reveal: true,
    show_on_devices: false,
    qa_moderated: false,
    created_at: Date.now(),
    started_at: null,
    ended_at: null,
  };

  const responses = [];
  const audience = [];
  const sockets = [];          // {source, id, role}
  const streams = new Map();   // `${questionId}:${round}` → generator state
  let responseSeq = 0;
  let audienceSeq = 0;
  let testMode = false;
  let ticker = null;
  let destroyed = false;

  const hasQuiz = slides.some((q) => q.type === 'quiz');

  // ------------------------------------------------------------ helpers

  const currentQuestion = () =>
    slides.find((q) => q.id === session.current_question_id) || null;

  function broadcast(event, data, to = 'all') {
    for (const sock of sockets) {
      if (to !== 'all' && sock.role !== to) continue;
      try {
        sock.source.postMessage({
          channel: CHANNEL, kind: 'socket-event', id: sock.id, event, data,
        }, window.location.origin);
      } catch { /* the iframe went away; the sweep below drops it */ }
    }
  }

  /** The subset of the session a phone is allowed to know about. */
  const participantView = () => ({
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
    has_quiz: hasQuiz,
    custom_theme: session.theme === 'custom' && deck.settings?.customTheme?.tokens
      ? { tokens: deck.settings.customTheme.tokens, dark: !!deck.settings.customTheme.dark }
      : null,
  });

  /**
   * Strip anything that gives away a graded answer. This mirrors
   * sanitiseQuestion() in worker/index.js, and it matters here too: the
   * preview's phone must show what a student's phone shows, or an
   * instructor could ship a quiz believing the key is hidden when the
   * only reason it looked hidden was the preview.
   */
  function sanitise(q) {
    const config = { ...q.config };
    delete config.correct;
    delete config.correct_answers;
    delete config.answer_key;
    delete config.anchors;
    if (Array.isArray(config.options)) {
      config.options = config.options.map((opt) => {
        if (opt && typeof opt === 'object') {
          const { correct, ...rest } = opt;
          return rest;
        }
        return opt;
      });
    }

    // Same four structural keys the worker hides. The worker shuffles
    // timeline and matching under AUTH_SECRET, which no browser has, so
    // the preview cannot reproduce that order — but it can reproduce the
    // only thing the preview is for: showing the instructor that the key
    // is not on the phone. Redacting these two needs no shared secret.
    if (q.type === 'cloze') {
      config.text = String(config.text || '').replace(/\[[^\]]*\]/g, '[]');
    }
    if (q.type === 'probability') delete config.truth;
    if (q.type === 'consensus') delete config.claim_hidden;

    return { id: q.id, type: q.type, prompt: q.prompt, position: q.position, config };
  }

  function ordinal(q) {
    if (isContentSlide(q.type)) return { number: 0, total: 0 };
    const asked = slides.filter((x) => !isContentSlide(x.type));
    return { number: asked.findIndex((x) => x.id === q.id) + 1, total: asked.length };
  }

  function addResponse(questionId, round, pseudonym, slot, payload) {
    const key = (r) => `${r.question_id}:${r.round}:${r.pseudonym}:${r.slot}`;
    const row = {
      id: (responseSeq += 1),
      session_id: sessionId,
      question_id: questionId,
      round,
      pseudonym,
      slot,
      payload,
      created_at: Date.now(),
    };
    // The real table has a unique key on (session, question, round,
    // pseudonym, slot) and the insert upserts onto it — which is what
    // makes "change my answer" replace a vote rather than add one.
    const at = responses.findIndex((r) => key(r) === key(row));
    if (at >= 0) {
      row.id = responses[at].id;
      responses[at] = row;
    } else {
      responses.push(row);
    }
    broadcast('response', row, 'presenter');
    return row;
  }

  // ------------------------------------------------- generated answers

  /**
   * Per-question generator state, memoised per (question, round).
   *
   * The stream itself is app/sample-class.js's — the same invented class
   * the editor's slide previews draw from, so a rehearsal and a preview
   * of the same slide agree about what the room said. This only decides
   * WHEN to make one: a room fills up over time and must keep drawing
   * from where it left off.
   */
  function streamFor(q, round) {
    const key = `${q.id}:${round}`;
    let s = streams.get(key);
    if (!s) {
      s = createSampleStream(q, round);
      streams.set(key, s);
    }
    return s;
  }

  function addOneFakeResponse() {
    const q = currentQuestion();
    if (!q || NO_RESPONSES.has(q.type)) return false;
    if (session.state !== 'live' || !session.accepting) return false;

    const s = streamFor(q, session.current_round);
    const already = new Set(responses
      .filter((r) => r.question_id === q.id && r.round === session.current_round)
      .map((r) => r.pseudonym)).size;
    if (already >= sampleTarget(q)) return false;

    const payload = samplePayload(q, s);
    if (!payload) return false;
    addResponse(q.id, session.current_round, nextName(s), 0, payload);
    return true;
  }

  function addFakeAudienceQuestion() {
    if (audience.length >= AUDIENCE_QUESTIONS.length) return false;
    const body = AUDIENCE_QUESTIONS[audience.length];
    audience.push({
      id: (audienceSeq += 1),
      session_id: sessionId,
      body,
      upvotes: Math.floor(Math.random() * 9),
      approved: !session.qa_moderated,
      answered: false,
      created_at: Date.now(),
    });
    broadcast('qa', { changed: true });
    return true;
  }

  /**
   * The trickle.
   *
   * Answers arrive over several seconds rather than all at once, because
   * what an instructor is actually here to judge is the motion: whether
   * the bars settle somewhere readable, whether the count pill pulses,
   * whether a cloud of eighteen words is legible from the back.
   */
  function tick() {
    ticker = null;
    if (destroyed || !testMode) return;
    const q = currentQuestion();
    const more = q?.type === 'qa' ? addFakeAudienceQuestion() : addOneFakeResponse();
    // Nothing left to add: keep a slow heartbeat so advancing the slide
    // starts the flow again without the instructor doing anything.
    ticker = setTimeout(tick, more ? 260 + Math.random() * 520 : 900);
  }

  function startTicker() {
    if (ticker || destroyed || !testMode) return;
    ticker = setTimeout(tick, 220);
  }

  function stopTicker() {
    clearTimeout(ticker);
    ticker = null;
  }

  // ---------------------------------------------------------- the routes
  //
  // Mirrors worker/index.js. Anything not listed 404s, exactly as there,
  // so a call the real server would not answer does not silently work here.
  //
  // THE ERROR STRINGS BELOW ARE A VERBATIM COPY OF THE WORKER'S. Every
  // message passed to nope() — "This session is not live.", "Voting just
  // closed for this question.", "That question is no longer live.", "That
  // round has ended.", "No session found for that code.", "Write a question
  // first." — is the same sentence the real fail() returns in
  // worker/index.js. That matters because the preview runs the REAL
  // join-page.js, which draws whatever text it is handed: a preview that
  // words a refusal differently teaches the instructor a sentence their
  // students will never see, and does it in the one place they cannot
  // check. Nothing enforces the match, so when a message changes there,
  // change it here in the same commit.

  const ok = (body) => ({ status: 200, body });
  const nope = (error, status = 404) => ({ status, body: { error } });

  function handle(method, path, body) {
    const url = new URL(path, window.location.origin);
    const seg = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '').split('/');
    const params = url.searchParams;

    // ---- auth: the editor is already signed in, so this only has to
    // stop present.html bouncing the iframe to the sign-in page.
    if (seg[0] === 'auth') {
      if (seg[1] === 'check') return ok({ ok: true, user: { id: 'preview', username: 'preview' } });
      return nope('Not available in preview.', 400);
    }

    // ---- participant ---------------------------------------------------
    if (seg[0] === 'join') {
      const tail = seg[2] || '';
      if (String(seg[1] || '').toUpperCase() !== joinCode.toUpperCase()) {
        return nope('No session found for that code.');
      }

      if (!tail && method === 'GET') return ok(participantView());

      if (tail === 'question' && method === 'GET') {
        if (session.state !== 'live' || !session.current_question_id) return ok(null);
        const q = currentQuestion();
        if (!q) return ok(null);
        return ok({
          ...sanitise(q),
          ...ordinal(q),
          round: session.current_round,
          accepting: session.accepting,
          reveal: session.reveal,
          show_on_devices: session.show_on_devices,
        });
      }

      if (tail === 'pseudonym' && method === 'POST') {
        const s = streamFor({ id: 'phone', prompt: 'phone', config: {} }, 0);
        return ok({ pseudonym: nextName(s), token: 'preview' });
      }

      if (tail === 'respond' && method === 'POST') {
        if (session.state !== 'live') return nope('This session is not live.', 409);
        if (!session.accepting) return nope('Voting just closed for this question.', 409);
        if (body.questionId !== session.current_question_id) {
          return nope('That question is no longer live.', 409);
        }
        if (Number(body.round) !== Number(session.current_round)) {
          return nope('That round has ended.', 409);
        }
        // Bounded exactly as the Worker bounds it. A rehearsal that accepts
        // what the real room refuses is worse than no rehearsal.
        const slot = Number.isInteger(body.slot) ? body.slot : 0;
        if (slot < 0 || slot > MAX_SLOT) return nope('That answer slot is out of range.', 400);
        if (slot > 0 && !MULTI_SUBMIT_TYPES.has(currentQuestion()?.type)) {
          return nope('This question takes one answer.', 400);
        }
        if (JSON.stringify(body.payload ?? {}).length > RESPONSE_MAX_CHARS) {
          return nope('That answer is too long.', 400);
        }
        return ok(addResponse(
          body.questionId, Number(body.round), String(body.pseudonym),
          slot, body.payload ?? {},
        ));
      }

      // The pace channel. The rehearsal keeps no flare table — the ember
      // is driven by the broadcast, and a preview has no history to have
      // a history of — but the route has to exist or a rehearsing phone
      // reports a failure the real room would never show.
      if (tail === 'flare' && method === 'POST') {
        if (session.state !== 'live') return nope('This session is not live.', 409);
        broadcast('flare', {
          question_id: session.current_question_id,
          round: session.current_round,
        }, 'presenter');
        return ok({ ok: true });
      }

      if (tail === 'results' && method === 'GET') {
        if (session.state !== 'live') return ok(null);
        if (!session.reveal || !session.show_on_devices) return ok(null);
        const questionId = params.get('question');
        const round = Number(params.get('round') || session.current_round);
        // Same second half of the check the Worker makes: the presenter
        // revealed ONE slide, so that is the only slide readable. See the
        // long note on rule 3 in worker/index.js.
        if (questionId !== session.current_question_id) return ok(null);
        return ok({
          round,
          payloads: responses
            .filter((r) => r.question_id === questionId && r.round === round)
            .map((r) => r.payload),
        });
      }

      if (tail === 'qa' && seg[4] === 'upvote' && method === 'POST') {
        const row = audience.find((a) => a.id === Number(seg[3]));
        if (row) row.upvotes += 1;
        broadcast('qa', { changed: true });
        return ok({ upvotes: row?.upvotes ?? 0 });
      }

      if (tail === 'qa') {
        if (method === 'GET') {
          return ok(audience.filter((a) => a.approved)
            .sort((a, b) => b.upvotes - a.upvotes || a.created_at - b.created_at));
        }
        if (method === 'POST') {
          const text = String(body.body || '').trim().slice(0, 500);
          if (!text) return nope('Write a question first.', 400);
          audience.push({
            id: (audienceSeq += 1),
            session_id: sessionId,
            body: text,
            upvotes: 0,
            approved: !session.qa_moderated,
            answered: false,
            created_at: Date.now(),
          });
          broadcast('qa', { changed: true });
          return ok({ ok: true, pending: !!session.qa_moderated });
        }
      }

      return nope('Unknown route');
    }

    // ---- instructor ----------------------------------------------------
    if (seg[0] === 'decks') {
      if (seg[1] !== deck.id) return nope('Not found.');
      if (seg[2] === 'questions' && method === 'GET') return ok(slides);
      if (!seg[2] && method === 'GET') return ok(deck);
      return nope('Not available in preview.', 400);
    }

    if (seg[0] === 'questions' && method === 'PATCH') {
      // Cloud curation (merge / hide a word) writes back through here. It
      // is a real teaching control, so it works — against the copy this
      // room holds, never against the deck being edited.
      const q = slides.find((x) => x.id === seg[1]);
      if (!q) return nope('Not found.');
      Object.assign(q, body);
      return ok(q);
    }

    if (seg[0] === 'responses' && method === 'DELETE') {
      const at = responses.findIndex((r) => r.id === Number(seg[1]));
      if (at >= 0) responses.splice(at, 1);
      return ok({ ok: true });
    }

    if (seg[0] === 'qa' && method === 'PATCH') {
      const row = audience.find((a) => a.id === Number(seg[1]));
      if (row) Object.assign(row, body);
      broadcast('qa', { changed: true });
      return ok({ ok: true });
    }

    if (seg[0] === 'sessions') {
      const id = seg[1];
      if (!id) return ok([]); // the Compare picker asks for past sessions
      if (id !== sessionId) return nope('Not found.');

      if (seg[2] === 'responses') {
        const q = params.get('question');
        const round = params.get('round');
        const rows = responses.filter((r) =>
          (!q || r.question_id === q) && (round == null || r.round === Number(round)));
        if (method === 'GET') return ok(rows);
        if (method === 'DELETE') {
          rows.forEach((r) => responses.splice(responses.indexOf(r), 1));
          broadcast('responses-cleared', { question: q, round });
          return ok({ ok: true });
        }
      }

      if (seg[2] === 'maxround' && method === 'GET') {
        const q = params.get('question');
        const rounds = responses.filter((r) => r.question_id === q).map((r) => r.round);
        return ok({ round: rounds.length ? Math.max(...rounds) : 1 });
      }

      if (seg[2] === 'qa' && method === 'GET') {
        return ok([...audience]
          .sort((a, b) => b.upvotes - a.upvotes || a.created_at - b.created_at));
      }

      // no flare history in a rehearsal — the ember lights from the
      // broadcast alone, which is exactly what the presenter is here to see
      if (seg[2] === 'flares' && method === 'GET') return ok([]);

      if (!seg[2] && method === 'GET') return ok({ ...session });

      if (!seg[2] && method === 'PATCH') {
        const allowed = ['state', 'current_question_id', 'current_round', 'accepting',
          'reveal', 'show_on_devices', 'qa_moderated', 'label', 'started_at', 'ended_at'];
        const bools = new Set(['accepting', 'reveal', 'show_on_devices', 'qa_moderated']);
        for (const k of allowed) {
          if (body[k] === undefined) continue;
          session[k] = bools.has(k) ? !!body[k] : body[k];
        }
        broadcast('session', participantView());
        // A new slide, or a re-ask, wants its own room full of answers.
        startTicker();
        return ok({ ...session });
      }
    }

    return nope('Unknown route');
  }

  // ------------------------------------------------------- the wire
  //
  // The iframes speak to this over postMessage; preview-net.js turns that
  // back into fetch() and WebSocket on the other side.

  function onMessage(event) {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.channel !== CHANNEL || destroyed) return;

    if (msg.kind === 'http') {
      let reply;
      try {
        reply = handle(msg.method || 'GET', msg.path, msg.body);
      } catch (err) {
        console.error('[preview]', err);
        reply = { status: 500, body: { error: String(err?.message || err) } };
      }
      event.source.postMessage({
        channel: CHANNEL, kind: 'http-reply', id: msg.id, ...reply,
      }, window.location.origin);
      return;
    }

    if (msg.kind === 'socket-open') {
      // Roles are a security boundary in the real room: raw response rows
      // reach presenter sockets only. Keep the split here, so a preview
      // can never show a behaviour the product does not have.
      const role = msg.path.startsWith('/api/sessions/') ? 'presenter' : 'participant';
      sockets.push({ source: event.source, id: msg.id, role });
      event.source.postMessage({
        channel: CHANNEL, kind: 'socket-open-ack', id: msg.id,
      }, window.location.origin);
      return;
    }

    if (msg.kind === 'socket-close') {
      const at = sockets.findIndex((s) => s.source === event.source && s.id === msg.id);
      if (at >= 0) sockets.splice(at, 1);
    }
  }

  window.addEventListener('message', onMessage);

  return {
    sessionId,
    joinCode,

    /** Turn the invented class on or off. Off wipes what it invented. */
    setTestResponses(on) {
      testMode = !!on;
      if (on) {
        startTicker();
      } else {
        stopTicker();
        responses.length = 0;
        audience.length = 0;
        streams.clear();
        broadcast('responses-cleared', { question: null, round: null });
        broadcast('qa', { changed: true });
      }
    },

    destroy() {
      destroyed = true;
      stopTicker();
      sockets.length = 0;
      window.removeEventListener('message', onMessage);
    },
  };
}
