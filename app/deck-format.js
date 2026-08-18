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
 *   transition: push
 *
 *   ## instructions
 *   Join in before we start
 *   - Point your phone's camera at the QR code.
 *   - Or go to the address on screen and type in the code.
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
 *   transition: none
 *
 *   ## qa
 *   Open floor
 *
 * `transition:` in the header is the deck's default (none, fade, push,
 * rise, zoom, wipe); on a question it overrides that default for one
 * slide, and `transition: none` is how a single slide opts back out of a
 * deck that otherwise moves.
 *
 * A "+" line places an element on the slide:
 *
 *   ## multiple_choice
 *   Which of these is a primary source?
 *   + microscope @ top-right lg
 *   + mark-arc-right @ 31.5,68 accent-2 w:3 rot:15
 *
 * Placement is "x,y" as a PERCENTAGE of the slide, so it is free but
 * still resolution-free — it means the same thing on a laptop and on a
 * lecture-hall projector, which a pixel coordinate would not. The nine
 * corner and edge names still parse, and are written back out whenever
 * an element sits exactly on one, so the common case stays readable.
 */

import {
  QUESTION_TYPES, splitPassage, DEFAULT_JOIN_STEPS,
  DEFAULT_TRAFFIC, DEFAULT_EXIT_PROMPTS,
} from './logic.js';
import {
  hasElement, readPos, posName, anchorPos, sizeId, colorId, weightValue,
  rotValue, opacityValue, layerId, normaliseDecor, decorOf, MAX_DECOR,
  DEFAULT_ANCHOR, DEFAULT_SIZE, DEFAULT_STROKE, DEFAULT_FILL, DEFAULT_WEIGHT,
  DEFAULT_LAYER,
} from './elements.js';
import { normalizeTransition } from './transitions.js';

const TYPE_ALIASES = {
  instructions: 'instructions', instruction: 'instructions', intro: 'instructions',
  info: 'instructions', how_to_join: 'instructions', join: 'instructions',
  mc: 'multiple_choice', choice: 'multiple_choice', multiple_choice: 'multiple_choice',
  wordcloud: 'word_cloud', word_cloud: 'word_cloud', cloud: 'word_cloud',
  open: 'open_ended', open_ended: 'open_ended', text: 'open_ended',
  scale: 'scales', scales: 'scales', likert: 'scales',
  rank: 'ranking', ranking: 'ranking',
  quiz: 'quiz', competition: 'quiz',
  qa: 'qa', questions: 'qa',
  spectrum: 'spectrum', opinion: 'spectrum',
  sample_vote: 'sample_vote', showdown: 'sample_vote', samples: 'sample_vote',
  heatmap: 'heatmap', passage: 'heatmap',
  traffic: 'traffic', traffic_light: 'traffic', pulse: 'traffic',
  mood: 'mood', mood_check: 'mood', weather: 'mood',
  this_or_that: 'this_or_that', thisorthat: 'this_or_that', either_or: 'this_or_that',
  budget: 'budget', budget_split: 'budget', allocate: 'budget',
  probability: 'probability', likelihood: 'probability', percent: 'probability',
  cloze: 'cloze', fill_in_the_blank: 'cloze', blanks: 'cloze', fill: 'cloze',
  matching: 'matching', match: 'matching', pairs: 'matching',
  timeline: 'timeline', order: 'timeline', chronology: 'timeline',
  exit_ticket: 'exit_ticket', exit: 'exit_ticket', ticket: 'exit_ticket',
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
  let sawQuestion = false; // any "##" header yet? after one, "#" is prose

  const pushCurrent = () => {
    if (!current) return;
    // A content slide's prompt is its heading, and a heading is optional —
    // "How to join" is a sensible default and not worth an error.
    if (!current.prompt && current.type === 'instructions') current.prompt = 'How to join';
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
    // Only in the header, before the first "##". Past that point a line
    // opening with "#" is a prompt — "#MeToo — was it a turning point?"
    // is a question somebody will really ask, and silently turning it
    // into the deck's title loses both the title and the prompt.
    if (!sawQuestion && /^#(?!#)/.test(trimmed)) {
      const title = trimmed.replace(/^#\s*/, '').replace(/^Deck:\s*/i, '').trim();
      if (title) { deck.title = title; sawTitle = true; }
      return;
    }

    // ---- new question ----------------------------------------------
    if (/^##/.test(trimmed)) {
      pushCurrent();
      sawQuestion = true;
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
        passage: [],
        decor: [],
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

    // ---- placed element ("+ microscope @ top-right lg") -------------
    const decorMatch = trimmed.match(/^\+\s+(.*)$/);
    if (decorMatch) {
      const placed = parseDecorLine(decorMatch[1], errors, lineNo + 1);
      if (placed) {
        if (current.decor.length >= MAX_DECOR) {
          errors.push(`Line ${lineNo + 1}: a slide can hold ${MAX_DECOR} elements; `
            + 'this one was dropped.');
        } else {
          current.decor.push(placed);
        }
      }
      return;
    }

    // ---- option / statement lines ----------------------------------
    // A bare "-" is an option that has not been filled in yet. It must
    // parse as an *empty option*, not fall through to the prompt: a
    // brand-new slide starts life with blank options, and if saving it
    // glued a stray "-" onto its prompt the editor would corrupt decks
    // just by round-tripping them.
    const optMatch = trimmed.match(/^[-*](?:\s+(.*))?$/);
    if (optMatch) {
      let body = (optMatch[1] || '').trim();
      let correct = false;
      const check = body.match(/^\[([ xX])\]\s*(.*)$/);
      if (check) { correct = check[1].toLowerCase() === 'x'; body = check[2].trim(); }
      current.options.push({ label: body, correct });
      return;
    }

    const numMatch = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (numMatch && (current.type === 'ranking' || current.type === 'multiple_choice')) {
      current.options.push({ label: numMatch[1].trim(), correct: false });
      return;
    }

    // passage lines: the text under study for a heatmap, the sentence
    // with the gaps in it for a cloze
    const passMatch = trimmed.match(/^>\s?(.*)$/);
    if (passMatch && (current.type === 'heatmap' || current.type === 'cloze')) {
      if (passMatch[1].trim()) current.passage.push(passMatch[1].trim());
      return;
    }

    // as with "-", a bare "~" is a statement nobody has typed yet
    const stmtMatch = trimmed.match(/^~(?:\s+(.*))?$/);
    if (stmtMatch) {
      let body = (stmtMatch[1] || '').trim();
      // allow "~ statement | 1..7"
      const range = body.match(/^(.*?)\s*\|\s*(\d+)\s*\.\.\s*(\d+)\s*$/);
      if (range) {
        body = range[1].trim();
        current.config.min = Number(range[2]);
        current.config.max = Number(range[3]);
      }
      current.statements.push(body);
      return;
    }

    // ---- key: value -------------------------------------------------
    // Only a *known* setting is a setting — before the prompt as much as
    // after it. Prompts contain colons all the time ("Weber: what did he
    // mean by rationalisation?"), and treating any "word: value" line as
    // configuration swallowed the question whole.
    const kv = matchKeyValue(trimmed);
    if (kv && isKnownSetting(kv.key)) {
      applyQuestionSetting(current, kv.key, kv.value);
      return;
    }

    // ---- otherwise: prompt text ------------------------------------
    current.prompt = current.prompt ? `${current.prompt} ${trimmed}` : trimmed;
  });

  pushCurrent();

  // dim/blur only mean anything over a photo; a stray one must not reach
  // the ambience engine, which reads bg.blur.
  if (deck.background && deck.background.kind !== 'image') {
    delete deck.background.dim;
    delete deck.background.blur;
  }

  if (!deck.questions.length) errors.push('No questions found. Start a question with "## multiple_choice".');

  return { ...deck, errors };
}

/**
 * One "+" line -> a decor record.
 *
 *   + microscope
 *   + microscope @ top-right lg
 *   + mark-arc-right @ mid-left accent-2 fill:accent-soft w:3 rot:15 op:70 flip
 *
 * Everything after the element id is optional and order-free, because
 * this is a line a person types. Bare words are accepted where they are
 * unambiguous — `lg` can only be a size and `accent` can only be a colour
 * — so the common case stays short, while `stroke:`/`fill:` spell it out
 * when both colours are set. Anything unrecognised is reported against
 * its line number rather than silently ignored: a typo'd element that
 * just doesn't appear on the projector is the worst possible outcome.
 */
function parseDecorLine(body, errors, lineNo) {
  // "@ top-right" and "@top-right" are the same thing to a person
  const parts = String(body).replace(/@\s+/g, '@').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  const id = parts.shift().toLowerCase();
  if (!hasElement(id)) {
    errors.push(`Line ${lineNo}: no element called "${id}".`);
    return null;
  }

  const home = anchorPos(DEFAULT_ANCHOR);
  const out = {
    id,
    x: home.x,
    y: home.y,
    layer: DEFAULT_LAYER,
    size: DEFAULT_SIZE,
    stroke: DEFAULT_STROKE,
    fill: DEFAULT_FILL,
    w: DEFAULT_WEIGHT,
    rot: 0,
    flip: false,
    op: 100,
  };

  for (const raw of parts) {
    const token = raw.toLowerCase();

    if (token.startsWith('@')) {
      const pos = readPos(token.slice(1));
      if (pos) { out.x = pos.x; out.y = pos.y; } else {
        errors.push(`Line ${lineNo}: "${raw.slice(1)}" is not a place on the slide. `
          + 'use "x,y" as percentages, or a name like top-right.');
      }
      continue;
    }

    if (token === 'flip') { out.flip = true; continue; }

    // "behind" / "front" — which side of the slide's content it sits on
    const bare = layerId(token);
    if (bare) { out.layer = bare; continue; }

    const kv = token.match(/^([a-z]+):(.*)$/);
    if (kv) {
      const [, key, value] = kv;
      if (key === 'stroke' || key === 'color' || key === 'colour') {
        const c = colorId(value);
        if (c) out.stroke = c;
        else errors.push(`Line ${lineNo}: "${value}" is not a colour.`);
      } else if (key === 'fill') {
        const c = colorId(value);
        if (c) out.fill = c;
        else errors.push(`Line ${lineNo}: "${value}" is not a colour.`);
      } else if (key === 'w' || key === 'weight' || key === 'width') {
        out.w = weightValue(value);
      } else if (key === 'rot' || key === 'rotate') {
        out.rot = rotValue(value);
      } else if (key === 'op' || key === 'opacity') {
        out.op = opacityValue(value);
      } else if (key === 'layer') {
        const l = layerId(value);
        if (l) out.layer = l;
        else errors.push(`Line ${lineNo}: a layer is "front" or "behind", not "${value}".`);
      } else if (key === 'size') {
        const s = sizeId(value);
        if (s) out.size = s;
        else errors.push(`Line ${lineNo}: "${value}" is not a size.`);
      } else {
        errors.push(`Line ${lineNo}: "${key}" is not something an element has.`);
      }
      continue;
    }

    // bare words: a size, or a colour for the stroke
    const size = sizeId(token);
    if (size) { out.size = size; continue; }
    const color = colorId(token);
    if (color) { out.stroke = color; continue; }

    errors.push(`Line ${lineNo}: don't know what "${raw}" means on an element line.`);
  }

  // normaliseDecor owns the final say on every field, so a hand-written
  // line and one placed by dragging can never disagree
  const item = normaliseDecor(out);

  // An open path — an arc, a brace, an underline — has no inside to
  // colour, so normaliseDecor drops the fill. Say so, rather than let the
  // instructor wonder why the line they wrote had no effect.
  if (item && out.fill !== DEFAULT_FILL && item.fill === DEFAULT_FILL) {
    errors.push(`Line ${lineNo}: "${id}" is an open line, so it has no fill to set.`);
  }
  return item;
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
  'background', 'ambience', 'motion', 'anonymous_note', 'layout',
  'mode', 'confidence', 'hold', 'left', 'right', 'labels', 'max_picks',
  'rationale', 'corners', 'anchors',
  'join', 'show_join', 'note',
  'total', 'truth', 'case_sensitive',
  // how this slide arrives on the projector; also legal in the header,
  // where it sets the default for the whole deck
  'transition',
]);

function isKnownSetting(key) { return KNOWN_SETTINGS.has(key); }

function matchKeyValue(line) {
  const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_ -]*)\s*:\s*(.*)$/);
  if (!m) return null;
  return { key: m[1].trim().toLowerCase().replace(/[\s-]+/g, '_'), value: m[2].trim() };
}

/**
 * A comma-separated list where a comma can appear *inside* an item.
 *
 * Labels are written by hand ("Claim, unsupported") and a naive split
 * turned one label into two every time the deck was saved and reopened.
 * A backslash escapes the next character, which is the shortest rule a
 * person can be told and the only one that survives a round-trip.
 */
function splitList(value) {
  const s = String(value);
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 1; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function joinList(items) {
  return items.map((s) => String(s).replace(/([\\,])/g, '\\$1')).join(', ');
}

function coerce(value) {
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/**
 * `ambience` and `background` are two header lines describing one record,
 * and a deck can list them in either order — so each merges onto whatever
 * the other already put there rather than replacing it.
 */
function applyDeckSetting(deck, key, value) {
  if (key === 'theme') deck.theme = String(value);
  else if (key === 'transition') {
    // Deck-wide default. Merged rather than assigned because deck.settings
    // also carries the instructor's custom theme, and a deck file that
    // mentions a transition must not be a way to delete a theme they built.
    const id = normalizeTransition(value);
    if (id) deck.settings = { ...(deck.settings || {}), transition: id };
  }
  else if (key === 'background') {
    const prev = deck.background || {};
    deck.background = parseBackground(value);
    if (prev.motion) deck.background.motion = prev.motion;
    // "dim:"/"blur:" may be written on either side of "background:"
    if (prev.dim != null) deck.background.dim = prev.dim;
    if (prev.blur != null) deck.background.blur = prev.blur;
  } else if (key === 'dim' || key === 'blur') {
    // How hard a photo backdrop is pushed behind the type. Without these
    // two lines a deck read its own file back at the default darkness,
    // which on a bright photo is the difference between readable and not.
    const raw = String(value).trim();
    const n = Number(raw.replace(/%$/, ''));
    if (!Number.isFinite(n)) return;
    deck.background = { ...(deck.background || { kind: 'theme' }) };
    if (key === 'dim') {
      const frac = /%$/.test(raw) || n > 1 ? n / 100 : n;
      deck.background.dim = Math.min(1, Math.max(0, frac));
    } else {
      deck.background.blur = Math.max(0, n);
    }
  } else if (key === 'ambience' || key === 'motion') {
    const v = String(value).trim().toLowerCase();
    deck.background = { ...(deck.background || { kind: 'theme' }) };
    if (v === 'off' || v === 'none' || v === 'false') delete deck.background.motion;
    else if (v === 'subtle' || v === 'lively') deck.background.motion = v;
  } else if (key === 'title') deck.title = String(value);
}

function parseBackground(value) {
  const v = String(value).trim();
  if (!v || v === 'theme') return { kind: 'theme' };
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return { kind: 'solid', color: v };
  if (/^https?:\/\//i.test(v)) return { kind: 'image', url: v, dim: 0.45, blur: 0 };
  return { kind: 'preset', id: v };
}

function applyQuestionSetting(q, key, value) {
  if (key === 'join' || key === 'show_join') { q.config.show_join = coerce(value) !== false; return; }
  if (key === 'note') { q.config.note = String(value); return; }
  if (key === 'left') { q.config.left_label = String(value); return; }
  if (key === 'right') { q.config.right_label = String(value); return; }
  if (key === 'rationale') { q.config.allow_rationale = coerce(value) !== false; return; }
  if (key === 'transition') {
    // Never through coerce(). "transition: off" would come back as the
    // boolean false and "transition: 0" as a number, and both would then
    // fall through resolveTransition() to the deck default — silently
    // doing the opposite of what the line says. An unrecognised name is
    // dropped rather than guessed at: a deck naming a transition this
    // build has not got should still present.
    const id = normalizeTransition(value);
    if (id) q.config.transition = id;
    return;
  }
  if (key === 'labels') {
    q.config.labels = splitList(value).filter(Boolean);
    return;
  }
  if (key === 'anchors') {
    // An anchor the instructor has not set is written as an empty slot
    // ("anchors: 1, , 5"). Number('') is 0, which is off the bottom of a
    // 1..5 scale — an unset anchor must come back as null, not as a
    // rating the instructor never gave.
    q.config.anchors = splitList(value).map((s) => {
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    });
    return;
  }
  q.config[key] = coerce(value);
}

function finaliseQuestion(q, errors, number) {
  const config = { ...q.config };
  const out = { type: q.type, prompt: q.prompt, config };

  // Only written when the slide actually carries elements — an empty
  // `decor: []` on every question would bloat a deck's stored config for
  // a feature most slides never use.
  if (q.decor?.length) config.decor = q.decor;

  switch (q.type) {
    case 'instructions': {
      // "- " lines are the steps; an empty list falls back to the built-in
      // join instructions rather than projecting a blank slide.
      config.steps = q.options.length ? q.options.map((o) => o.label) : [...DEFAULT_JOIN_STEPS];
      if (config.show_join == null) config.show_join = true;
      break;
    }
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
    case 'spectrum': {
      if (!config.left_label) config.left_label = 'Disagree';
      if (!config.right_label) config.right_label = 'Agree';
      break;
    }
    case 'sample_vote': {
      config.samples = q.options.map((o) => o.label);
      if (config.samples.length < 2) {
        errors.push(`Question ${number}: a showdown needs at least two samples (lines starting with "-").`);
      }
      if (config.allow_rationale == null) config.allow_rationale = true;
      break;
    }
    case 'traffic': {
      const labels = q.options.map((o) => o.label);
      // three lights, always — a fourth would silently become a poll
      config.labels = [0, 1, 2].map((i) => labels[i] || DEFAULT_TRAFFIC[i]);
      break;
    }
    case 'mood': {
      // "- ☀️ Clear" — the glyph, then what it means
      config.icons = q.options.map((o) => {
        const m = o.label.match(/^(\S+)\s*(.*)$/);
        return { emoji: m ? m[1] : o.label, label: m ? m[2].trim() : '' };
      });
      if (!config.icons.length) delete config.icons;
      break;
    }
    case 'this_or_that':
    case 'matching': {
      // "- this | or that" — one pair per line
      config.pairs = q.options.map((o) => {
        const [left, right] = o.label.split('|');
        return { left: (left || '').trim(), right: (right || '').trim() };
      });
      if (config.pairs.length < (q.type === 'matching' ? 2 : 1)) {
        errors.push(`Question ${number}: needs pairs, written as "- this | or that".`);
      }
      if (q.type === 'matching' && config.pairs.some((p) => !p.right)) {
        errors.push(`Question ${number}: every matching pair needs both halves.`);
      }
      break;
    }
    case 'budget': {
      config.options = q.options.map((o) => o.label);
      if (config.options.length < 2) {
        errors.push(`Question ${number}: needs at least two things to fund.`);
      }
      if (config.total == null) config.total = 100;
      break;
    }
    case 'probability': {
      if (config.truth === '' || config.truth == null) config.truth = null;
      else config.truth = Math.min(100, Math.max(0, Number(config.truth) || 0));
      break;
    }
    case 'cloze': {
      const text = q.passage.join(' ');
      if (!text) {
        errors.push(`Question ${number}: needs a sentence (a line starting with ">").`);
      }
      config.text = text;
      if (text && !/\[[^\]]*\]/.test(text)) {
        errors.push(`Question ${number}: no blanks. Put an answer in [square brackets].`);
      }
      break;
    }
    case 'timeline': {
      config.items = q.options.map((o) => o.label);
      if (config.items.length < 2) {
        errors.push(`Question ${number}: needs at least two events, listed in the correct order.`);
      }
      break;
    }
    case 'exit_ticket': {
      const prompts = q.options.map((o) => o.label);
      config.prompts = prompts.length ? prompts : [...DEFAULT_EXIT_PROMPTS];
      if (config.max_length == null) config.max_length = 200;
      break;
    }
    case 'heatmap': {
      const passage = q.passage.join(' ');
      if (!passage) {
        errors.push(`Question ${number}: a heatmap needs a passage (lines starting with ">").`);
      }
      config.passage = passage.replace(/\s*\|\s*/g, ' | ');
      config.segments = splitPassage(passage);
      // labels imply classify only when no mode was asked for: an
      // instructor who keeps their categories but switches back to
      // highlighting must not be switched to classify again on reload.
      if (config.mode == null && Array.isArray(config.labels) && config.labels.length) {
        config.mode = 'classify';
      }
      if (config.max_picks == null) config.max_picks = 1;
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

/**
 * One list line. An item nobody has filled in yet is written as a bare
 * "-" (never "- " with nothing after it): trailing whitespace does not
 * survive a text editor, and the marker has to be readable on its own so
 * a half-written slide reopens as the half-written slide it was.
 */
function bullet(label, mark = '-') {
  const s = label == null ? '' : String(label);
  return s ? `${mark} ${s}` : mark;
}

export function serialiseDeck(deck, questions) {
  const out = [];
  out.push(`# ${deck.title || 'Untitled deck'}`);
  if (deck.theme) out.push(`theme: ${deck.theme}`);
  const bg = deck.background;
  if (bg && bg.kind && bg.kind !== 'theme') {
    if (bg.kind === 'solid') out.push(`background: ${bg.color}`);
    else if (bg.kind === 'image') {
      out.push(`background: ${bg.url}`);
      // only when they differ from what parseBackground assumes, so a
      // plain photo backdrop still reads as one line
      if (bg.dim != null && Number(bg.dim) !== 0.45) out.push(`dim: ${Number(bg.dim)}`);
      if (bg.blur) out.push(`blur: ${Number(bg.blur)}`);
    } else if (bg.kind === 'preset') out.push(`background: ${bg.id}`);
  }
  // independent of the line above: a deck can keep the theme's own
  // backdrop and still ask it to move
  if (bg && bg.motion && bg.motion !== 'off') out.push(`ambience: ${bg.motion}`);
  // 'none' is the absence of a setting, not a setting — writing it would
  // add a line to every exported deck that has never been touched.
  const deckTrans = normalizeTransition(deck.settings?.transition);
  if (deckTrans && deckTrans !== 'none') out.push(`transition: ${deckTrans}`);
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
        out.push(correct.has(i) ? bullet(label, '- [x]') : bullet(label));
      });
    }
    if (q.type === 'instructions' && Array.isArray(cfg.steps)) {
      cfg.steps.forEach((s) => out.push(bullet(s)));
      if (cfg.show_join === false) out.push('join: false');
      if (cfg.note) out.push(`note: ${cfg.note}`);
    }
    if (Array.isArray(cfg.items)) cfg.items.forEach((it) => out.push(bullet(it)));
    if (Array.isArray(cfg.samples)) cfg.samples.forEach((s) => out.push(bullet(s)));
    if (Array.isArray(cfg.statements)) cfg.statements.forEach((s) => out.push(bullet(s, '~')));
    if (q.type === 'traffic' && Array.isArray(cfg.labels)) {
      cfg.labels.forEach((l) => out.push(bullet(l)));
    }
    if (q.type === 'mood' && Array.isArray(cfg.icons)) {
      cfg.icons.forEach((m) => out.push(bullet(`${m.emoji || ''}${m.label ? ` ${m.label}` : ''}`)));
    }
    if (Array.isArray(cfg.pairs)) {
      cfg.pairs.forEach((p) => out.push(bullet(`${p.left || ''} | ${p.right || ''}`.trim())));
    }
    if (q.type === 'exit_ticket' && Array.isArray(cfg.prompts)) {
      cfg.prompts.forEach((p) => out.push(bullet(p)));
    }
    if (q.type === 'cloze' && cfg.text) out.push(`> ${cfg.text}`);
    // segments joined with ' | ' round-trip to the exact same segmentation
    if (q.type === 'heatmap' && (cfg.segments || cfg.passage)) {
      out.push(`> ${Array.isArray(cfg.segments) && cfg.segments.length
        ? cfg.segments.join(' | ') : cfg.passage}`);
    }

    if (cfg.left_label) out.push(`left: ${cfg.left_label}`);
    if (cfg.right_label) out.push(`right: ${cfg.right_label}`);
    if (Array.isArray(cfg.labels) && cfg.labels.length) out.push(`labels: ${joinList(cfg.labels)}`);
    if (Array.isArray(cfg.anchors) && cfg.anchors.some((a) => a != null)) {
      out.push(`anchors: ${cfg.anchors.map((a) => (a == null ? '' : a)).join(', ')}`);
    }
    if (cfg.allow_rationale === false) out.push('rationale: false');

    // Placed elements. Written last so the text view reads the way the
    // slide is built: what it asks, then what it offers, then how it is
    // dressed. Only non-default properties are printed — a deck full of
    // `w:2 op:100 rot:0` would be noise nobody wants to diff.
    for (const item of decorOf(cfg)) {
      // a name when it sits exactly on one, numbers otherwise: an
      // untouched corner element still reads "@ top-right"
      const where = posName(item.x, item.y) || `${item.x},${item.y}`;
      const bits = [item.id, `@ ${where}`];
      if (item.layer !== DEFAULT_LAYER) bits.push('behind');
      if (item.size !== DEFAULT_SIZE) bits.push(item.size);
      if (item.stroke !== DEFAULT_STROKE) bits.push(`stroke:${item.stroke}`);
      if (item.fill !== DEFAULT_FILL) bits.push(`fill:${item.fill}`);
      if (item.w !== DEFAULT_WEIGHT) bits.push(`w:${item.w}`);
      if (item.rot) bits.push(`rot:${item.rot}`);
      if (item.op !== 100) bits.push(`op:${item.op}`);
      if (item.flip) bits.push('flip');
      out.push(`+ ${bits.join(' ')}`);
    }

    for (const key of ['multiple', 'max_choices', 'max_words', 'max_length',
                       'scoring', 'allow_skip', 'allow_partial', 'chart']) {
      if (cfg[key] != null && cfg[key] !== '') out.push(`${key}: ${cfg[key]}`);
    }
    if (q.type === 'budget' && cfg.total != null) out.push(`total: ${cfg.total}`);
    if (q.type === 'probability' && cfg.truth != null) out.push(`truth: ${cfg.truth}`);
    if (q.type === 'cloze' && cfg.case_sensitive) out.push('case_sensitive: true');
    // newer settings: only serialised when meaningfully set
    // 'transition' rides in this list rather than the one above because
    // it is the only key here whose 'none' is meaningful: it is how a
    // single slide opts OUT of a deck-wide transition, so it has to be
    // written even though it looks like a default.
    for (const key of ['mode', 'confidence', 'hold', 'max_picks', 'corners',
                       'transition']) {
      if (cfg[key] != null && cfg[key] !== '' && cfg[key] !== false) {
        out.push(`${key}: ${cfg[key]}`);
      }
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export const SAMPLE_DECK = `# Sample deck: first day of class
theme: lecture-hall
background: gradient-dusk

## instructions
Join in before we start
- Open the camera on your phone and point it at the QR code.
- Or go to the address on screen and type in the code.
- Leave the page open, and questions appear as we go.

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
Anything you want to ask about the course
`;

export { QUESTION_TYPES };
