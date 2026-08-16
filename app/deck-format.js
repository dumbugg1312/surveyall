/**
 * SurveyAll — plain-text deck format (proposal P3).
 *
 * A deck is a text file. That is the whole idea: you can keep it in a
 * folder, email it to a colleague, diff it between semesters, paste it
 * into git, and duplicate it for another section by copying a file.
 * None of the commercial tools give you a portable authoring format —
 * which is exactly why instructors lose their decks when a campus
 * licence lapses.
 *
 * Format (whitespace-tolerant, comments with //):
 *
 *   # Intro to Sociology — Week 3
 *   theme: chalkboard
 *   background: gradient-dusk
 *
 *   ## multiple_choice
 *   Which of these is a social institution?
 *   - Marriage
 *   - [x] The economy
 *   - A crowd at a concert
 *   multiple: false
 *
 *   ## word_cloud
 *   One word: how did the reading leave you feeling?
 *   max_words: 2
 *
 *   ## scales  (1..7)
 *   Rate your agreement
 *   ~ Sociology explains behaviour better than psychology
 *   ~ I understood the reading
 *
 *   ## ranking
 *   Rank these by influence on you
 *   - Family
 *   - Media
 *   - Peers
 *
 *   ## quiz (25s)
 *   Who wrote "The Protestant Ethic"?
 *   - Durkheim
 *   - [x] Weber
 *   - Marx
 *
 *   ## open_ended
 *   What should I re-explain next class?
 *
 *   ## qa
 *   Open floor
 */

import { QUESTION_TYPES } from './logic.js';

const TYPE_ALIASES = {
  mc: 'multiple_choice', choice: 'multiple_choice', multiple_choice: 'multiple_choice',
  wordcloud: 'word_cloud', word_cloud: 'word_cloud', cloud: 'word_cloud',
  open: 'open_ended', open_ended: 'open_ended', text: 'open_ended',
  scale: 'scales', scales: 'scales', likert: 'scales',
  rank: 'ranking', ranking: 'ranking',
  quiz: 'quiz', competition: 'quiz',
  qa: 'qa', questions: 'qa',
};

/**
 * @returns {{title, theme, background, questions: Array, errors: Array<string>}}
 */
export function parseDeck(source) {
  const lines = String(source || '').split(/\r?\n/);
  const errors = [];

  const deck = {
    title: 'Untitled deck',
    theme: 'lecture-hall',
    background: { kind: 'theme' },
    questions: [],
  };

  let current = null;      // question under construction
  let sawTitle = false;

  const pushCurrent = () => {
    if (!current) return;
    if (!current.prompt) {
      errors.push(`Question ${deck.questions.length + 1} (${current.type}) has no prompt line.`);
    }
    deck.questions.push(finaliseQuestion(current, errors, deck.questions.length + 1));
    current = null;
  };

  lines.forEach((rawLine, lineNo) => {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!trimmed) return;
    if (trimmed.startsWith('//')) return;

    // ---- deck title -------------------------------------------------
    if (/^#(?!#)/.test(trimmed)) {
      const title = trimmed.replace(/^#\s*/, '').replace(/^Deck:\s*/i, '').trim();
      if (title) { deck.title = title; sawTitle = true; }
      return;
    }

    // ---- new question ----------------------------------------------
    if (/^##/.test(trimmed)) {
      pushCurrent();
      const header = trimmed.replace(/^##\s*/, '');
      const parsed = parseTypeHeader(header);
      if (!parsed.type) {
        errors.push(`Line ${lineNo + 1}: unknown question type "${header}".`);
        current = null;
        return;
      }
      current = {
        type: parsed.type,
        prompt: '',
        options: [],
        statements: [],
        config: { ...parsed.config },
      };
      return;
    }

    if (!current) {
      // key: value before any question = deck-level setting
      const kv = matchKeyValue(trimmed);
      if (kv) {
        applyDeckSetting(deck, kv.key, kv.value);
      } else if (!sawTitle) {
        deck.title = trimmed;
        sawTitle = true;
      }
      return;
    }

    // ---- option / statement lines ----------------------------------
    const optMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (optMatch) {
      let body = optMatch[1].trim();
      let correct = false;
      const check = body.match(/^\[([ xX])\]\s*(.*)$/);
      if (check) { correct = check[1].toLowerCase() === 'x'; body = check[2].trim(); }
      if (body) current.options.push({ label: body, correct });
      return;
    }

    const numMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numMatch && (current.type === 'ranking' || current.type === 'multiple_choice')) {
      current.options.push({ label: numMatch[1].trim(), correct: false });
      return;
    }

    const stmtMatch = trimmed.match(/^~\s+(.*)$/);
    if (stmtMatch) {
      let body = stmtMatch[1].trim();
      // allow "~ statement | 1..7"
      const range = body.match(/^(.*?)\s*\|\s*(\d+)\s*\.\.\s*(\d+)\s*$/);
      if (range) {
        body = range[1].trim();
        current.config.min = Number(range[2]);
        current.config.max = Number(range[3]);
      }
      if (body) current.statements.push(body);
      return;
    }

    // ---- key: value -------------------------------------------------
    const kv = matchKeyValue(trimmed);
    if (kv && !current.prompt) {
      // a setting before the prompt is still a setting
      applyQuestionSetting(current, kv.key, kv.value);
      return;
    }
    if (kv && isKnownSetting(kv.key)) {
      applyQuestionSetting(current, kv.key, kv.value);
      return;
    }

    // ---- otherwise: prompt text ------------------------------------
    current.prompt = current.prompt ? `${current.prompt} ${trimmed}` : trimmed;
  });

  pushCurrent();

  if (!deck.questions.length) errors.push('No questions found. Start a question with "## multiple_choice".');

  return { ...deck, errors };
}

function parseTypeHeader(header) {
  // "quiz (25s)"  |  "scales 1..7"  |  "multiple_choice"
  const config = {};
  let body = header.trim();

  const paren = body.match(/^(.*?)\s*\((.*)\)\s*$/);
  let extra = '';
  if (paren) { body = paren[1].trim(); extra = paren[2].trim(); }

  const range = (extra || body).match(/(\d+)\s*\.\.\s*(\d+)/);
  if (range) {
    config.min = Number(range[1]);
    config.max = Number(range[2]);
    body = body.replace(/(\d+)\s*\.\.\s*(\d+)/, '').trim();
  }

  const secs = extra.match(/(\d+)\s*s(?:ec|econds)?/i);
  if (secs) config.time = Number(secs[1]);

  const key = body.toLowerCase().replace(/[\s-]+/g, '_');
  return { type: TYPE_ALIASES[key] || null, config };
}

const KNOWN_SETTINGS = new Set([
  'multiple', 'max_choices', 'max_words', 'max_length', 'min', 'max',
  'time', 'scoring', 'allow_skip', 'allow_partial', 'chart', 'theme',
  'background', 'anonymous_note', 'layout',
]);

function isKnownSetting(key) { return KNOWN_SETTINGS.has(key); }

function matchKeyValue(line) {
  const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_ -]*)\s*:\s*(.*)$/);
  if (!m) return null;
  return { key: m[1].trim().toLowerCase().replace(/[\s-]+/g, '_'), value: m[2].trim() };
}

function coerce(value) {
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function applyDeckSetting(deck, key, value) {
  if (key === 'theme') deck.theme = String(value);
  else if (key === 'background') deck.background = parseBackground(value);
  else if (key === 'title') deck.title = String(value);
}

function parseBackground(value) {
  const v = String(value).trim();
  if (!v || v === 'theme') return { kind: 'theme' };
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return { kind: 'solid', color: v };
  if (/^https?:\/\//i.test(v)) return { kind: 'image', url: v, dim: 0.45, blur: 0 };
  return { kind: 'preset', id: v };
}

function applyQuestionSetting(q, key, value) {
  q.config[key] = coerce(value);
}

function finaliseQuestion(q, errors, number) {
  const config = { ...q.config };
  const out = { type: q.type, prompt: q.prompt, config };

  switch (q.type) {
    case 'multiple_choice':
    case 'quiz': {
      config.options = q.options.map((o) => o.label);
      const correct = [];
      q.options.forEach((o, i) => { if (o.correct) correct.push(i); });
      if (q.options.length < 2) {
        errors.push(`Question ${number}: needs at least two options (lines starting with "-").`);
      }
      if (q.type === 'quiz') {
        if (!correct.length) {
          errors.push(`Question ${number}: a quiz needs a correct answer, marked "- [x] Answer".`);
        }
        config.correct = correct;
        if (config.time == null) config.time = 20;
      } else if (correct.length) {
        config.correct = correct; // optional "reference answer" on a normal poll
      }
      break;
    }
    case 'scales': {
      config.statements = q.statements.length ? q.statements : q.options.map((o) => o.label);
      if (!config.statements.length) errors.push(`Question ${number}: needs statements (lines starting with "~").`);
      if (config.min == null) config.min = 1;
      if (config.max == null) config.max = 5;
      if (config.max <= config.min) {
        errors.push(`Question ${number}: scale max must be greater than min.`);
        config.min = 1; config.max = 5;
      }
      break;
    }
    case 'ranking': {
      config.items = q.options.map((o) => o.label);
      if (config.items.length < 2) errors.push(`Question ${number}: needs at least two items to rank.`);
      break;
    }
    case 'word_cloud': {
      if (config.max_words == null) config.max_words = 1;
      if (config.max_length == null) config.max_length = 25;
      break;
    }
    case 'open_ended': {
      if (config.max_length == null) config.max_length = 200;
      break;
    }
    default:
      break;
  }
  return out;
}

// =====================================================================
// Serialise back out — round-trips with parseDeck()
// =====================================================================

export function serialiseDeck(deck, questions) {
  const out = [];
  out.push(`# ${deck.title || 'Untitled deck'}`);
  if (deck.theme) out.push(`theme: ${deck.theme}`);
  const bg = deck.background;
  if (bg && bg.kind && bg.kind !== 'theme') {
    if (bg.kind === 'solid') out.push(`background: ${bg.color}`);
    else if (bg.kind === 'image') out.push(`background: ${bg.url}`);
    else if (bg.kind === 'preset') out.push(`background: ${bg.id}`);
  }
  out.push('');

  for (const q of questions || []) {
    const cfg = q.config || {};
    let header = `## ${q.type}`;
    if (q.type === 'quiz' && cfg.time) header += ` (${cfg.time}s)`;
    if (q.type === 'scales') header += ` (${cfg.min ?? 1}..${cfg.max ?? 5})`;
    out.push(header);
    if (q.prompt) out.push(q.prompt);

    const correct = new Set(
      Array.isArray(cfg.correct) ? cfg.correct
        : (typeof cfg.correct === 'number' ? [cfg.correct] : []));

    if (Array.isArray(cfg.options)) {
      cfg.options.forEach((opt, i) => {
        const label = typeof opt === 'string' ? opt : String(opt?.label ?? '');
        out.push(correct.has(i) ? `- [x] ${label}` : `- ${label}`);
      });
    }
    if (Array.isArray(cfg.items)) cfg.items.forEach((it) => out.push(`- ${it}`));
    if (Array.isArray(cfg.statements)) cfg.statements.forEach((s) => out.push(`~ ${s}`));

    for (const key of ['multiple', 'max_choices', 'max_words', 'max_length',
                       'scoring', 'allow_skip', 'allow_partial', 'chart']) {
      if (cfg[key] != null && cfg[key] !== '') out.push(`${key}: ${cfg[key]}`);
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const SAMPLE_DECK = `# Sample deck — first day of class
theme: lecture-hall
background: gradient-dusk

## word_cloud
In one word, how are you feeling about this course?
max_words: 2

## multiple_choice
Have you taken a course in this subject before?
- Never
- One course
- Two or more
- I'm not sure what counts

## scales (1..7)
How confident are you about each of these right now?
~ Reading dense academic writing
~ Writing an argument with sources
~ Speaking up in a seminar
allow_skip: true

## quiz (20s)
Which of these is a primary source?
- A textbook chapter summarising a war
- [x] A soldier's letter written during that war
- An encyclopedia entry
- A documentary made last year

## ranking
Rank what would help you most this semester
- Worked examples in class
- More feedback on drafts
- Optional review sessions
- Practice quizzes

## open_ended
What is one thing you want me to know about how you learn?
max_length: 200

## qa
Anything you want to ask, anonymously
`;

export { QUESTION_TYPES };
