/**
 * SurveyAll — the invented class.
 *
 * One deterministic room of plausible answers, shared by everything that
 * has to show a slide with results on it before a real class has given
 * any: the editor's slide previews (app/slide-preview.js) and the
 * rehearsal room behind the Preview button (app/preview-room.js).
 *
 * It lives in its own file because those two used to invent their own
 * answers separately, and a preview that disagrees with the rehearsal
 * about what a full slide looks like is exactly the drift the single
 * renderer exists to remove.
 *
 * DETERMINISTIC, ALWAYS. Every stream is seeded from the question's own
 * id and text, so the same slide always draws the same-shaped
 * distribution. A preview that reshuffles itself on every repaint makes
 * it impossible to tell whether you changed the slide or the dice.
 */

import {
  optionLabels, correctIndices, splitPassage,
  trafficLabels, moodIcons, pairList, budgetTotal, clozeBlanks,
  exitPrompts, timelineItems,
  bucketLabels, bucketCards, quadrantItems, consensusClaims,
} from './logic.js';

/** Content slides and Q&A collect nothing a chart can draw. */
export const NO_RESPONSES = new Set(['instructions', 'qa']);

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
  'Not sure yet. I want to hear what other people say first.',
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

export const AUDIENCE_QUESTIONS = [
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
// One question's stream
//
// A "stream" is the room's settled opinion about one slide: how the
// options are weighted, where the middle of a scale sits, which
// pseudonyms have already been handed out. Answers are drawn from it one
// at a time, so a rehearsal room can fill a chart gradually and a static
// preview can ask for a full class in one call.
// =====================================================================

/**
 * Per-question generator state.
 *
 * The weights are drawn once, from a seed made of the slide's own
 * identity, so every slide gets its own believable shape and keeps it.
 * Round two leans harder on the marked answer, which is the whole point
 * of asking twice — you get to see what the Compare view will look like.
 *
 * IDENTITY, NOT WORDING. The seed deliberately excludes the prompt. The
 * editor draws this room into a live preview on every keystroke, so a
 * prompt in the seed meant the invented class changed its mind about the
 * answer with each letter typed — a word cloud reshuffling itself under
 * an instructor who is still writing the question. Which slide this is
 * gives all the variety the seed needs, and it holds still while the
 * words around it are edited.
 */
export function createSampleStream(q, round = 1) {
  const rng = mulberry32(seedFrom(`${q.id ?? q.type ?? ''}|${round}`));
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
  const shape = mulberry32(seedFrom(`${q.id ?? q.type ?? ''}|shape`));
  const base = Array.from({ length: nOptions }, () => 0.3 + shape() * 1.1);
  const keyBias = round >= 2 ? 3.4 : 1.3;

  return {
    rng,
    correct,
    names: [],
    optionWeights: base.map((w, i) => w + (correct.has(i) ? keyBias : 0)),
    // Flat enough that most of the bank shows up. A cloud of three
    // words tells you nothing about whether a real one will be legible.
    wordWeights: WORDS.map(() => 0.3 + rng() * 1.3),
    centre: 0.25 + rng() * 0.5,
  };
}

/** One unused pseudonym, in the room's own Adjective-Noun style. */
export function nextName(s) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const name = `${pick(s.rng, ADJECTIVES)} ${pick(s.rng, NOUNS)}`;
    if (!s.names.includes(name)) { s.names.push(name); return name; }
  }
  const fallback = `Guest ${s.names.length + 1}`;
  s.names.push(fallback);
  return fallback;
}


/** One plausible answer for this slide. Shapes match validateResponse(). */
export function samplePayload(q, s) {
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

    // A rehearsal room that always answers correctly teaches you
    // nothing about what the chart looks like when it matters, so the
    // checkable types below get a class that mostly knows it, with a
    // believable minority who don't.
    case 'traffic':
      return { choice: pickWeighted(rng, [3, 1.4, 0.5].slice(0, trafficLabels(cfg).length)) };

    case 'mood': {
      const icons = moodIcons(cfg);
      return { choice: pickWeighted(rng, s.optionWeights.slice(0, icons.length)) };
    }

    case 'this_or_that': {
      const pairs = pairList(cfg);
      if (!pairs.length) return null;
      return {
        picks: pairs.map((_, i) => {
          if (cfg.allow_skip && rng() < 0.08) return null;
          // each pair has its own lean, so the rows don't all agree
          return rng() < 0.35 + ((i * 0.23) % 0.4) ? 0 : 1;
        }),
      };
    }

    case 'budget': {
      const labels = optionLabels(cfg);
      if (!labels.length) return null;
      const total = budgetTotal(cfg);
      // spend on two or three favourites, then round the last one up so
      // the pot balances exactly the way the phone insists on
      const weights = labels.map((_, i) => s.optionWeights[i] ?? 1);
      const alloc = new Array(labels.length).fill(0);
      let left = total;
      const picks = Math.min(labels.length, 2 + Math.floor(rng() * 2));
      for (let k = 0; k < picks - 1 && left > 0; k += 1) {
        const i = pickWeighted(rng, weights);
        const give = Math.max(1, Math.round(left * (0.25 + rng() * 0.4)));
        alloc[i] += Math.min(give, left);
        left -= Math.min(give, left);
      }
      alloc[pickWeighted(rng, weights)] += left;
      return { alloc };
    }

    case 'probability': {
      const truth = Number.isFinite(Number(cfg.truth)) && cfg.truth != null
        ? Number(cfg.truth) : 55;
      // clustered near the answer, with the honest long tail of people
      // who are miles off — which is the reason to ask at all
      const near = Math.max(0, Math.min(100,
        Math.round(truth + (bell(rng) - 0.5) * 46)));
      const wild = Math.round(rng() * 100);
      const payload = { pct: rng() < 0.18 ? wild : near };
      if (cfg.confidence) payload.conf = 1 + Math.floor(bell(rng) * 3);
      return payload;
    }

    case 'cloze': {
      const blanks = clozeBlanks(cfg);
      if (!blanks.length) return null;
      return {
        blanks: blanks.map((b, i) => {
          const key = b.answers[0] || '';
          if (!key) return pick(rng, WORDS);
          // most get it; the rest produce a plausible near-miss
          if (rng() < 0.66 - i * 0.08) return key;
          return rng() < 0.5 ? pick(rng, WORDS) : key.slice(0, Math.max(3, key.length - 2));
        }),
      };
    }

    case 'matching': {
      const pairs = pairList(cfg);
      if (!pairs.length) return null;
      const matches = pairs.map((_, i) => i);
      // swap one adjacent pair for most people, two for a few — the
      // confusion matrix needs a specific mix-up, not uniform noise
      const swaps = rng() < 0.55 ? 1 : rng() < 0.8 ? 0 : 2;
      for (let k = 0; k < swaps && pairs.length > 1; k += 1) {
        const i = Math.floor(rng() * (pairs.length - 1));
        [matches[i], matches[i + 1]] = [matches[i + 1], matches[i]];
      }
      if (cfg.allow_partial && rng() < 0.15) {
        matches[Math.floor(rng() * matches.length)] = null;
      }
      return { matches };
    }

    case 'timeline': {
      const items = timelineItems(cfg);
      if (!items.length) return null;
      const order = items.map((_, i) => i);
      const swaps = rng() < 0.4 ? 0 : 1 + Math.floor(rng() * 2);
      for (let k = 0; k < swaps && items.length > 1; k += 1) {
        const i = Math.floor(rng() * (items.length - 1));
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
      return { order };
    }

    case 'exit_ticket': {
      const prompts = exitPrompts(cfg);
      return {
        answers: prompts.map((_, i) => (
          // the middle prompt ("a question you still have") is the one
          // real rooms leave blank most often
          rng() < (i === 1 ? 0.62 : 0.85) ? pick(rng, SENTENCES) : ''
        )),
      };
    }

    case 'buckets': {
      const nB = bucketLabels(cfg).length;
      const cards = bucketCards(cfg);
      if (nB < 2 || !cards.length) return null;
      // each card has a deterministic "home" most of the rehearsal room
      // agrees on, so the preview shows both settled cards and a fence
      // sitter rather than uniform noise
      return {
        places: cards.map((_, i) => {
          const home = (i * 7 + 1) % nB;
          return rng() < 0.72 ? home : Math.floor(rng() * nB);
        }),
      };
    }

    case 'quadrant': {
      const n = Math.max(1, quadrantItems(cfg).length);
      const clampPct = (v) => Math.min(100, Math.max(0, Math.round(v)));
      return {
        spots: Array.from({ length: n }, (_, i) => {
          // item one splits into two camps — the shape this chart
          // exists to show — and the rest gather in their own corners
          const camp = i === 0
            ? (rng() < 0.5 ? [26, 30] : [74, 72])
            : [30 + ((i * 23) % 45), 68 - ((i * 17) % 40)];
          return [
            clampPct(camp[0] + (rng() - 0.5) * 22),
            clampPct(camp[1] + (rng() - 0.5) * 22),
          ];
        }),
      };
    }

    case 'consensus': {
      const claims = consensusClaims(cfg);
      const votes = {};
      claims.forEach((c, i) => {
        if (rng() < 0.88) {
          const r = rng();
          // odd claims trend agreed, even ones contested — so the field
          // shows both a card that migrated and one stuck on the fence
          const agreeP = i % 2 ? 0.8 : 0.48;
          votes[c.key] = r < agreeP ? 1 : r < 0.92 ? -1 : 0;
        }
      });
      const out = { votes };
      if (rng() < 0.2) out.claims = [pick(rng, SENTENCES)];
      if (!Object.keys(votes).length && !out.claims) return null;
      return out;
    }

    default:
      return null;
  }
}

/** How many people a slide is worth pretending about. */
export function sampleTarget(q) {
  if (q.type === 'open_ended') return 9;   // each one is a card on screen
  if (q.type === 'exit_ticket') return 7;  // three columns of the same
  if (q.type === 'word_cloud') return 20;
  return 17;
}

/**
 * A whole invented class, in one call.
 *
 * The rehearsal room draws answers one at a time because it is pretending
 * to be a room filling up. A still preview has no time axis: it wants the
 * slide as it will look once everyone has answered, immediately and the
 * same way every repaint. Same stream, same order, same result — this is
 * simply the rehearsal room's loop run to completion.
 *
 * Rows carry the shape D1 stores, not bare payloads, because the charts
 * count distinct `pseudonym`s to say "17 responses · 17 people".
 *
 * @param {object} q question row
 * @param {{round?: number, n?: number}} [opts]
 * @returns {object[]} response rows, ready for aggregate()
 */
export function sampleRows(q, { round = 1, n } = {}) {
  if (!q || NO_RESPONSES.has(q.type)) return [];
  const s = createSampleStream(q, round);
  const want = n ?? sampleTarget(q);
  const rows = [];
  for (let i = 0; i < want; i += 1) {
    const payload = samplePayload(q, s);
    // A slide with no options yet cannot be answered — every draw returns
    // null, and the chart should show its empty state rather than a
    // fabricated one.
    if (!payload) break;
    rows.push({
      id: i + 1,
      question_id: q.id,
      round,
      pseudonym: nextName(s),
      slot: 0,
      payload,
    });
  }
  return rows;
}

/**
 * An invented Q&A queue, for previewing a Q&A slide.
 *
 * renderQA draws rows, not an aggregate, so this is the shape it wants —
 * the same one preview-room.js pushes into a live rehearsal. Upvotes are
 * seeded from the slide rather than drawn fresh, so the queue does not
 * reshuffle itself under an instructor deciding how many questions fit.
 */
export function sampleQuestions(q, { n = 4 } = {}) {
  const rng = mulberry32(seedFrom(`${q?.id ?? q?.type ?? ''}|qa`));
  return AUDIENCE_QUESTIONS.slice(0, n).map((body, i) => ({
    id: i + 1,
    body,
    upvotes: Math.floor(rng() * 9),
    approved: true,
    answered: false,
  }));
}
