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
  isContentSlide, sortedQuestions, optionLabels, correctIndices, splitPassage,
} from './logic.js';

const CHANNEL = 'surveyall-preview';

/** Content slides and Q&A collect nothing a chart can draw. */
const NO_RESPONSES = new Set(['instructions', 'qa']);

// =====================================================================
// Sample answers
//
// Deliberately generic: they have to look like a class answered without
// pretending to know anything about the instructor's actual question.
// Every one of them reads as somebody in a lecture hall, which is the
// point — the instructor is judging the shape of the slide, and a wall of
// "Lorem ipsum" tells you nothing about whether nine cards fit.
// =====================================================================

const WORDS = [
  'curious', 'ready', 'tired', 'unsure', 'hopeful', 'confused', 'focused',
  'excited', 'nervous', 'sleepy', 'interested', 'lost', 'calm', 'keen',
  'overwhelmed', 'fine', 'rushed', 'motivated',
];

const SENTENCES = [
  'I think it depends on the context.',
  'Not sure yet — I want to hear what other people say first.',
  'It made much more sense the second time through.',
  'Mostly agree, but I can think of exceptions.',
  'Could we go over the second part again?',
  'This reminded me of the example from last week.',
  'I got stuck on the third step and never recovered.',
  'Clear now. It really was not at first.',
  'Yes, and I would add one thing to that.',
  'This is the part I found hardest to follow.',
  'I had the opposite reaction, honestly.',
  'Somewhere in between the two answers.',
];

const AUDIENCE_QUESTIONS = [
  'Will this be on the exam?',
  'Could you go through that last step once more?',
  'Is there a reading that covers this in more depth?',
  'How does this connect to what we did last week?',
  'Does the same rule hold for the edge case you mentioned?',
];

const RATIONALES = [
  'It states the claim first.',
  'The evidence actually supports the point.',
  'Clearer, even if it is shorter.',
  'The other one buries the argument.',
];

const ADJECTIVES = [
  'Amber', 'Brisk', 'Copper', 'Dusky', 'Ember', 'Fleet', 'Golden', 'Hazel',
  'Ivory', 'Jade', 'Keen', 'Lucid', 'Mellow', 'Nimble', 'Onyx', 'Plum',
  'Quiet', 'Russet', 'Silver', 'Teal', 'Umber', 'Verdant', 'Wispy', 'Zesty',
];
const NOUNS = [
  'Falcon', 'Beacon', 'Cedar', 'Delta', 'Ellipse', 'Fern', 'Gable', 'Harbor',
  'Isle', 'Juniper', 'Kestrel', 'Lantern', 'Meridian', 'Nectar', 'Orbit', 'Pike',
  'Quarry', 'Ridge', 'Summit', 'Thistle', 'Umbra', 'Vessel', 'Willow', 'Zephyr',
];

// =====================================================================
// Deterministic randomness
//
// Seeded per question, so the same slide always draws the same-shaped
// distribution. A preview that reshuffles itself every time you open it
// makes it impossible to tell whether you changed the slide or the dice.
// =====================================================================

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function pickWeighted(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/** Roughly bell-shaped, in [0, 1]. Three dice, the usual trick. */
const bell = (rng) => (rng() + rng() + rng()) / 3;

/**
 * A heatmap's tappable sentences. The editor stores them, but a deck that
 * arrived through the text import may carry only the passage — and the
 * weights and the answers have to agree on how many there are.
 */
function passageSegments(cfg) {
  const stored = Array.isArray(cfg?.segments) ? cfg.segments : [];
  return stored.length ? stored : splitPassage(cfg?.passage || '');
}

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
   * Per-question generator state.
   *
   * The weights are drawn once, from a seed made of the question's own id
   * and text, so every slide gets its own believable shape and keeps it.
   * Round two leans harder on the marked answer, which is the whole point
   * of asking twice — you get to see what the Compare view will look like.
   */
  function streamFor(q, round) {
    const key = `${q.id}:${round}`;
    let s = streams.get(key);
    if (s) return s;

    const rng = mulberry32(seedFrom(`${q.id}|${q.prompt || ''}|${round}`));
    const correct = new Set(correctIndices(q.config));
    // Options, writing samples and passage sentences are all "one of
    // these" — one set of weights covers the three of them, which is what
    // keeps a showdown or a heatmap from redrawing its odds per answer.
    const nOptions = Math.max(
      optionLabels(q.config).length,
      Array.isArray(q.config?.samples) ? q.config.samples.length : 0,
      passageSegments(q.config).length,
      1,
    );

    // The room's underlying preference is drawn once for the question,
    // WITHOUT the round in the seed, and the answer key's pull is what
    // grows on the second ask. Redrawing per round instead let a
    // discussion round land worse than the first — which is a lie about
    // what Peer Instruction does, printed on the Compare screen.
    const shape = mulberry32(seedFrom(`${q.id}|${q.prompt || ''}|shape`));
    const base = Array.from({ length: nOptions }, () => 0.3 + shape() * 1.1);
    const keyBias = round >= 2 ? 3.4 : 1.3;

    s = {
      rng,
      correct,
      names: [],
      optionWeights: base.map((w, i) => w + (correct.has(i) ? keyBias : 0)),
      // Flat enough that most of the bank shows up. A cloud of three
      // words tells you nothing about whether a real one will be legible.
      wordWeights: WORDS.map(() => 0.3 + rng() * 1.3),
      centre: 0.25 + rng() * 0.5,
    };
    streams.set(key, s);
    return s;
  }

  function nextName(s) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const name = `${pick(s.rng, ADJECTIVES)} ${pick(s.rng, NOUNS)}`;
      if (!s.names.includes(name)) { s.names.push(name); return name; }
    }
    const fallback = `Guest ${s.names.length + 1}`;
    s.names.push(fallback);
    return fallback;
  }

  /** One plausible answer for this slide. Shapes match validateResponse(). */
  function fakePayload(q, s) {
    const cfg = q.config || {};
    const rng = s.rng;

    switch (q.type) {
      case 'multiple_choice': {
        const n = optionLabels(cfg).length;
        if (!n) return null;
        const max = cfg.multiple ? Math.min(cfg.max_choices || n, n) : 1;
        const picks = new Set([pickWeighted(rng, s.optionWeights)]);
        while (max > 1 && picks.size < max && rng() < 0.35) {
          picks.add(pickWeighted(rng, s.optionWeights));
        }
        const payload = { choices: [...picks].sort((a, b) => a - b) };
        if (cfg.confidence) payload.conf = 1 + Math.floor(bell(rng) * 3);
        if (rng() < 0.12) payload.volunteer = true;
        return payload;
      }

      case 'quiz': {
        const n = optionLabels(cfg).length;
        if (!n) return null;
        const payload = {
          choice: pickWeighted(rng, s.optionWeights),
          ms: Math.round(2200 + bell(rng) * 12000),
        };
        if (cfg.confidence) payload.conf = 1 + Math.floor(bell(rng) * 3);
        return payload;
      }

      case 'word_cloud': {
        const maxWords = Math.max(1, Math.min(10, cfg.max_words || 1));
        const count = maxWords === 1 ? 1 : 1 + Math.floor(rng() * maxWords);
        const words = new Set();
        for (let i = 0; i < count; i += 1) {
          words.add(WORDS[pickWeighted(rng, s.wordWeights)]);
        }
        return { words: [...words] };
      }

      case 'open_ended': {
        const payload = { text: pick(rng, SENTENCES) };
        if (rng() < 0.15) payload.volunteer = true;
        return payload;
      }

      case 'scales': {
        const statements = Array.isArray(cfg.statements) ? cfg.statements : [];
        if (!statements.length) return null;
        const min = Number.isFinite(cfg.min) ? cfg.min : 1;
        const max = Number.isFinite(cfg.max) ? cfg.max : 5;
        const span = max - min;
        return {
          values: statements.map((_, i) => {
            if (cfg.allow_skip && rng() < 0.08) return null;
            // each statement sits somewhere different on the scale, and
            // the room scatters around it
            const centre = 0.3 + ((i * 0.37) % 0.5);
            const v = centre + (bell(rng) - 0.5) * 0.55;
            return min + Math.round(Math.min(1, Math.max(0, v)) * span);
          }),
        };
      }

      case 'ranking': {
        const items = Array.isArray(cfg.items) ? cfg.items : [];
        if (!items.length) return null;
        // a shared consensus order, jittered per person — otherwise the
        // Borda chart is a flat tie and shows nothing
        const order = items.map((_, i) => i)
          .map((i) => ({ i, k: i + (rng() - 0.5) * 2.4 }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.i);
        if (cfg.allow_partial && rng() < 0.3) order.length = Math.max(1, order.length - 1);
        return { order };
      }

      case 'spectrum': {
        const payload = { pos: Math.round(Math.min(1, Math.max(0,
          s.centre + (bell(rng) - 0.5) * 0.7)) * 100) };
        if (cfg.confidence) payload.conf = 1 + Math.floor(bell(rng) * 3);
        return payload;
      }

      case 'sample_vote': {
        const samples = Array.isArray(cfg.samples) ? cfg.samples : [];
        if (!samples.length) return null;
        const payload = { choice: pickWeighted(rng, s.optionWeights.slice(0, samples.length)) };
        if (cfg.allow_rationale !== false && rng() < 0.55) {
          payload.rationale = pick(rng, RATIONALES);
        }
        if (cfg.confidence) payload.conf = 1 + Math.floor(bell(rng) * 3);
        return payload;
      }

      case 'heatmap': {
        const segs = passageSegments(cfg);
        if (!segs.length) return null;
        if (cfg.mode === 'classify') {
          const labels = Array.isArray(cfg.labels) ? cfg.labels : [];
          if (!labels.length) return null;
          const tags = {};
          segs.forEach((_, si) => {
            if (rng() < 0.25) return; // not everyone labels everything
            tags[si] = Math.floor(rng() * labels.length);
          });
          if (!Object.keys(tags).length) tags[0] = 0;
          return { tags };
        }
        const maxPicks = Math.max(1, Math.min(5, Number(cfg.max_picks) || 1));
        const picks = new Set();
        const weights = s.optionWeights.slice(0, segs.length);
        picks.add(pickWeighted(rng, weights));
        while (picks.size < maxPicks && rng() < 0.4) picks.add(pickWeighted(rng, weights));
        return { picks: [...picks].sort((a, b) => a - b) };
      }

      default:
        return null;
    }
  }

  /** How many people a slide is worth pretending about. */
  function targetFor(q) {
    if (q.type === 'open_ended') return 9;   // each one is a card on screen
    if (q.type === 'word_cloud') return 20;
    return 17;
  }

  function addOneFakeResponse() {
    const q = currentQuestion();
    if (!q || NO_RESPONSES.has(q.type)) return false;
    if (session.state !== 'live' || !session.accepting) return false;

    const s = streamFor(q, session.current_round);
    const already = new Set(responses
      .filter((r) => r.question_id === q.id && r.round === session.current_round)
      .map((r) => r.pseudonym)).size;
    if (already >= targetFor(q)) return false;

    const payload = fakePayload(q, s);
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
        return ok(addResponse(
          body.questionId, Number(body.round), String(body.pseudonym),
          Number.isInteger(body.slot) ? body.slot : 0, body.payload ?? {},
        ));
      }

      if (tail === 'results' && method === 'GET') {
        if (!session.reveal || !session.show_on_devices) return ok(null);
        const questionId = params.get('question');
        const round = Number(params.get('round') || session.current_round);
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
