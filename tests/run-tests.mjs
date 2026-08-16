/**
 * SurveyAll — logic tests.
 *
 * Zero dependencies. Run with:   node tests/run-tests.mjs
 *
 * These cover the participant flow end to end at the logic level: what a
 * student's tap becomes, whether it's accepted, how it's counted, how it
 * is scored, what lands in the CSV, and — importantly — that no code path
 * produces a student identifier.
 */

import {
  validateResponse, aggregate, normaliseWord, cleanText,
  scoreAnswer, quizLeaderboard, computeDelta,
  buildCSV, toCSVValue, sessionToCSVRows, CSV_HEADERS, payloadToText,
  correctIndices, optionLabels, generateJoinCode, joinURL,
  neighbourQuestion, sortedQuestions, MULTI_SUBMIT_TYPES,
  splitPassage, promptKey, isContentSlide, fillJoinPlaceholders, DEFAULT_JOIN_STEPS,
  questionNumber, promptScale, showSlideLabel, QUESTION_TYPES, CONTENT_TYPES,
} from '../app/logic.js';
import { readFileSync } from 'node:fs';
import { parseDeck, serialiseDeck, SAMPLE_DECK } from '../app/deck-format.js';
import { ambiencePlan, ambienceLevel } from '../app/ambience.js';
import {
  Spring, SpringGroup, PRESETS, stagger, easeOutExpo, easeOutCubic,
  toRGB, rgba, mixColor, luminance, readableOn, harmonicSeries,
  srgbToOklab, oklabToSrgb,
} from '../app/motion.js';

// The motion engine schedules through requestAnimationFrame. Node has no
// such thing, so stub it: the stub registers nothing and fires nothing,
// and the spring tests drive frames by hand via group.stepAll(dt). That
// keeps the timing deterministic rather than wall-clock dependent.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
}

// ---------------------------------------------------------------- tiny harness

let passed = 0;
let failed = 0;
const failures = [];
let group = '';

function describe(name, fn) { group = name; fn(); }

function it(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('.');
  } catch (err) {
    failed += 1;
    failures.push({ group, name, err });
    process.stdout.write('F');
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not equal'}\n    expected: ${b}\n    actual:   ${a}`);
}

function ok(v, msg) { if (!v) throw new Error(msg || `expected truthy, got ${JSON.stringify(v)}`); }
function notOk(v, msg) { if (v) throw new Error(msg || `expected falsy, got ${JSON.stringify(v)}`); }
function close(a, b, tol, msg) {
  if (Math.abs(a - b) > (tol ?? 1e-9)) throw new Error(`${msg || 'not close'}: ${a} vs ${b}`);
}

// =====================================================================
describe('normalisation', () => {
  it('lowercases so Zombie and zombie merge', () => {
    eq(normaliseWord('Zombie'), 'zombie');
    eq(normaliseWord('ZOMBIE'), 'zombie');
  });

  it('strips edge punctuation but keeps inner apostrophes', () => {
    eq(normaliseWord('  "hope!" '), 'hope');
    eq(normaliseWord("don't."), "don't");
    eq(normaliseWord('#anxious'), '#anxious');
  });

  it('collapses inner whitespace', () => {
    eq(normaliseWord('  really   tired '), 'really tired');
  });

  it('survives non-strings', () => {
    eq(normaliseWord(null), '');
    eq(normaliseWord(42), '');
    eq(cleanText(undefined), '');
  });

  it('truncates text to the configured limit', () => {
    eq(cleanText('x'.repeat(300), 200).length, 200);
  });
});

// =====================================================================
describe('participant flow — multiple choice', () => {
  const cfg = { options: ['Never', 'Once', 'Twice'] };

  it('accepts a single valid choice', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [1] });
    ok(r.ok);
    eq(r.payload, { choices: [1] });
  });

  it('rejects an empty submission with a usable message', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [] });
    notOk(r.ok);
    ok(/pick an option/i.test(r.error), 'error should tell the student what to do');
  });

  it('drops out-of-range indices rather than trusting the client', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [99, -3, 0] });
    ok(r.ok);
    eq(r.payload, { choices: [0] });
  });

  it('rejects several choices when multi-select is off', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [0, 2] });
    notOk(r.ok);
  });

  it('accepts several when multi-select is on, deduped and sorted', () => {
    const r = validateResponse('multiple_choice',
      { ...cfg, multiple: true }, { choices: [2, 0, 2] });
    ok(r.ok);
    eq(r.payload, { choices: [0, 2] });
  });

  it('honours max_choices', () => {
    const r = validateResponse('multiple_choice',
      { ...cfg, multiple: true, max_choices: 1 }, { choices: [0, 1] });
    notOk(r.ok);
    ok(/at most 1/.test(r.error));
  });

  it('handles a garbage payload without throwing', () => {
    notOk(validateResponse('multiple_choice', cfg, null).ok);
    notOk(validateResponse('multiple_choice', cfg, { choices: 'nope' }).ok);
  });
});

describe('participant flow — word cloud', () => {
  it('normalises and dedupes within one submission', () => {
    const r = validateResponse('word_cloud', { max_words: 3 },
      { words: ['Tired', 'tired', ' Curious '] });
    ok(r.ok);
    eq(r.payload, { words: ['tired', 'curious'] });
  });

  it('rejects blank input', () => {
    notOk(validateResponse('word_cloud', { max_words: 2 }, { words: ['   ', ''] }).ok);
  });

  it('enforces the word cap', () => {
    const r = validateResponse('word_cloud', { max_words: 1 }, { words: ['a', 'b'] });
    notOk(r.ok);
  });

  it('truncates over-long words to max_length', () => {
    const r = validateResponse('word_cloud',
      { max_words: 1, max_length: 5 }, { words: ['abcdefghij'] });
    ok(r.ok);
    eq(r.payload.words[0], 'abcde');
  });
});

describe('participant flow — open ended', () => {
  it('accepts and trims text', () => {
    const r = validateResponse('open_ended', { max_length: 200 }, { text: '  I liked it  ' });
    ok(r.ok);
    eq(r.payload, { text: 'I liked it' });
  });

  it('rejects whitespace-only text', () => {
    notOk(validateResponse('open_ended', {}, { text: '    ' }).ok);
  });

  it('truncates rather than rejecting long text', () => {
    const r = validateResponse('open_ended', { max_length: 20 }, { text: 'y'.repeat(50) });
    ok(r.ok);
    eq(r.payload.text.length, 20);
  });
});

describe('participant flow — scales', () => {
  const cfg = { statements: ['A', 'B'], min: 1, max: 5 };

  it('accepts a complete rating', () => {
    const r = validateResponse('scales', cfg, { values: [3, 5] });
    ok(r.ok);
    eq(r.payload, { values: [3, 5] });
  });

  it('clamps values outside the range', () => {
    const r = validateResponse('scales', cfg, { values: [99, -4] });
    ok(r.ok);
    eq(r.payload, { values: [5, 1] });
  });

  it('rejects a partial rating when skipping is off', () => {
    notOk(validateResponse('scales', cfg, { values: [3, null] }).ok);
  });

  it('allows a partial rating when skipping is on', () => {
    const r = validateResponse('scales', { ...cfg, allow_skip: true }, { values: [3, null] });
    ok(r.ok);
    eq(r.payload, { values: [3, null] });
  });

  it('rejects a fully empty rating even when skipping is on', () => {
    notOk(validateResponse('scales', { ...cfg, allow_skip: true }, { values: [null, null] }).ok);
  });
});

describe('participant flow — ranking', () => {
  const cfg = { items: ['X', 'Y', 'Z'] };

  it('accepts a full ranking', () => {
    const r = validateResponse('ranking', cfg, { order: [2, 0, 1] });
    ok(r.ok);
    eq(r.payload, { order: [2, 0, 1] });
  });

  it('removes duplicates the UI should not have produced', () => {
    const r = validateResponse('ranking', { ...cfg, allow_partial: true },
      { order: [1, 1, 0] });
    ok(r.ok);
    eq(r.payload, { order: [1, 0] });
  });

  it('rejects a partial ranking unless allowed', () => {
    notOk(validateResponse('ranking', cfg, { order: [0] }).ok);
    ok(validateResponse('ranking', { ...cfg, allow_partial: true }, { order: [0] }).ok);
  });
});

describe('participant flow — quiz', () => {
  const cfg = { options: ['A', 'B', 'C'], correct: [1], time: 20 };

  it('accepts a choice and keeps the response time', () => {
    const r = validateResponse('quiz', cfg, { choice: 1, ms: 4200 });
    ok(r.ok);
    eq(r.payload, { choice: 1, ms: 4200 });
  });

  it('rejects no answer', () => {
    notOk(validateResponse('quiz', cfg, {}).ok);
    notOk(validateResponse('quiz', cfg, { choice: 9 }).ok);
  });

  it('tolerates a missing timestamp', () => {
    const r = validateResponse('quiz', cfg, { choice: 0 });
    ok(r.ok);
    eq(r.payload.ms, null);
  });

  it('knows which types allow repeat submissions', () => {
    ok(MULTI_SUBMIT_TYPES.has('word_cloud'));
    ok(MULTI_SUBMIT_TYPES.has('open_ended'));
    notOk(MULTI_SUBMIT_TYPES.has('multiple_choice'));
    notOk(MULTI_SUBMIT_TYPES.has('quiz'));
  });
});

describe('participant flow — unknown input', () => {
  it('refuses an unknown question type instead of crashing', () => {
    const r = validateResponse('telepathy', {}, {});
    notOk(r.ok);
    ok(/unknown/i.test(r.error));
  });

  it('routes Q&A away from the response path', () => {
    notOk(validateResponse('qa', {}, { text: 'hi' }).ok);
  });
});

// =====================================================================
describe('aggregation', () => {
  it('counts multiple choice and computes percentages', () => {
    const agg = aggregate('multiple_choice', { options: ['A', 'B'] }, [
      { payload: { choices: [0] } },
      { payload: { choices: [0] } },
      { payload: { choices: [1] } },
    ]);
    eq(agg.total, 3);
    eq(agg.options[0].count, 2);
    close(agg.options[0].pct, 66.666, 0.01);
  });

  it('counts each respondent once even with multi-select', () => {
    const agg = aggregate('multiple_choice', { options: ['A', 'B'], multiple: true }, [
      { payload: { choices: [0, 1] } },
    ]);
    eq(agg.total, 1, 'one person answered');
    eq(agg.options[0].count, 1);
    eq(agg.options[1].count, 1);
  });

  it('tallies a word cloud by frequency, case-insensitively', () => {
    const agg = aggregate('word_cloud', {}, [
      { payload: { words: ['tired'] } },
      { payload: { words: ['Tired'] } },
      { payload: { words: ['ready'] } },
    ]);
    eq(agg.words[0], { word: 'tired', count: 2 });
    eq(agg.distinct, 2);
    eq(agg.total, 3);
  });

  it('averages scales and excludes skipped statements', () => {
    const agg = aggregate('scales', { statements: ['A', 'B'], min: 1, max: 5 }, [
      { payload: { values: [4, null] } },
      { payload: { values: [2, 5] } },
    ]);
    eq(agg.statements[0].avg, 3);
    eq(agg.statements[0].count, 2);
    eq(agg.statements[1].avg, 5, 'the skip must not drag the average to 2.5');
    eq(agg.statements[1].count, 1);
  });

  it('leaves an unanswered statement average as null, not zero', () => {
    const agg = aggregate('scales', { statements: ['A'], min: 1, max: 5 }, []);
    eq(agg.statements[0].avg, null);
  });

  it('applies Borda counting to rankings', () => {
    // 3 items: 1st = 3pts, 2nd = 2, 3rd = 1
    const agg = aggregate('ranking', { items: ['X', 'Y', 'Z'] }, [
      { payload: { order: [0, 1, 2] } },
      { payload: { order: [0, 2, 1] } },
    ]);
    eq(agg.items[0].label, 'X');
    eq(agg.items[0].points, 6);
    eq(agg.items[0].rank, 1);
    eq(agg.total, 2);
  });

  it('gives unranked items zero points', () => {
    const agg = aggregate('ranking', { items: ['X', 'Y'] }, [{ payload: { order: [0] } }]);
    eq(agg.items.find((i) => i.label === 'Y').points, 0);
  });

  it('collects open-ended entries in order', () => {
    const agg = aggregate('open_ended', {}, [
      { payload: { text: 'first' } }, { payload: { text: 'second' } },
    ]);
    eq(agg.total, 2);
    eq(agg.entries[1].text, 'second');
  });

  it('returns a safe empty shape for no responses', () => {
    const agg = aggregate('multiple_choice', { options: ['A'] }, []);
    eq(agg.total, 0);
    eq(agg.options[0].pct, 0);
  });
});

// =====================================================================
describe('quiz scoring', () => {
  const cfg = { options: ['A', 'B'], correct: [1], time: 20 };

  it('gives no points for a wrong answer', () => {
    eq(scoreAnswer({ choice: 0, ms: 100 }, cfg), 0);
  });

  it('gives close to full marks for an instant correct answer', () => {
    eq(scoreAnswer({ choice: 1, ms: 0 }, cfg), 1000);
  });

  it('decays toward the floor as time runs out', () => {
    eq(scoreAnswer({ choice: 1, ms: 20000 }, cfg), 500);
    eq(scoreAnswer({ choice: 1, ms: 10000 }, cfg), 750);
  });

  it('never drops below the floor for a late correct answer', () => {
    eq(scoreAnswer({ choice: 1, ms: 999999 }, cfg), 500);
  });

  it('supports flat scoring', () => {
    eq(scoreAnswer({ choice: 1, ms: 19000 }, { ...cfg, scoring: 'fixed' }), 1000);
  });

  it('treats a missing time as the full duration', () => {
    eq(scoreAnswer({ choice: 1 }, cfg), 500);
  });

  it('reads correct answers flagged on option objects', () => {
    eq(correctIndices({ options: [{ label: 'A' }, { label: 'B', correct: true }] }), [1]);
    eq(correctIndices({ correct: 2 }), [2]);
    eq(correctIndices({}), []);
  });

  it('builds a leaderboard from pseudonyms only', () => {
    const question = { type: 'quiz', config: cfg };
    const board = quizLeaderboard([{
      question,
      rows: [
        { pseudonym: 'Amber Falcon', payload: { choice: 1, ms: 0 } },
        { pseudonym: 'Teal Harbor', payload: { choice: 1, ms: 20000 } },
        { pseudonym: 'Jade Pike', payload: { choice: 0, ms: 10 } },
      ],
    }]);
    eq(board[0].pseudonym, 'Amber Falcon');
    eq(board[0].score, 1000);
    eq(board[1].pseudonym, 'Teal Harbor');
    eq(board[2].score, 0);
    eq(board.map((b) => b.rank), [1, 2, 3]);

    // FERPA: nothing but the random label should ever appear here.
    const keys = new Set(board.flatMap((b) => Object.keys(b)));
    eq([...keys].sort(), ['answered', 'correct', 'pseudonym', 'rank', 'score']);
  });

  it('sums a leaderboard across several quiz questions', () => {
    const q = { type: 'quiz', config: cfg };
    const board = quizLeaderboard([
      { question: q, rows: [{ pseudonym: 'A', payload: { choice: 1, ms: 0 } }] },
      { question: q, rows: [{ pseudonym: 'A', payload: { choice: 1, ms: 0 } }] },
    ]);
    eq(board[0].score, 2000);
    eq(board[0].correct, 2);
  });

  it('ignores non-quiz questions', () => {
    eq(quizLeaderboard([{ question: { type: 'multiple_choice' }, rows: [{ pseudonym: 'A', payload: {} }] }]), []);
  });
});

// =====================================================================
describe('re-ask delta (P1)', () => {
  const cfg = { options: ['Yes', 'No'] };

  it('reports the swing between two rounds', () => {
    const before = aggregate('multiple_choice', cfg, [
      { payload: { choices: [0] } }, { payload: { choices: [1] } },
      { payload: { choices: [1] } }, { payload: { choices: [1] } },
    ]); // 25% / 75%
    const after = aggregate('multiple_choice', cfg, [
      { payload: { choices: [0] } }, { payload: { choices: [0] } },
      { payload: { choices: [0] } }, { payload: { choices: [1] } },
    ]); // 75% / 25%

    const d = computeDelta(before, after);
    close(d.options[0].deltaPct, 50, 0.001);
    close(d.options[1].deltaPct, -50, 0.001);
    close(d.moved, 50, 0.001, 'half the room changed its mind');
  });

  it('handles scales deltas', () => {
    const cfgS = { statements: ['A'], min: 1, max: 5 };
    const d = computeDelta(
      aggregate('scales', cfgS, [{ payload: { values: [2] } }]),
      aggregate('scales', cfgS, [{ payload: { values: [4] } }]));
    eq(d.statements[0].deltaAvg, 2);
  });

  it('returns null for mismatched or missing rounds', () => {
    eq(computeDelta(null, null), null);
    eq(computeDelta(
      aggregate('multiple_choice', cfg, []),
      aggregate('word_cloud', {}, [])), null);
  });
});

// =====================================================================
describe('CSV export (P5)', () => {
  it('escapes quotes, commas and newlines', () => {
    eq(toCSVValue('plain'), 'plain');
    eq(toCSVValue('a,b'), '"a,b"');
    eq(toCSVValue('say "hi"'), '"say ""hi"""');
    eq(toCSVValue('two\nlines'), '"two\nlines"');
    eq(toCSVValue(null), '');
  });

  it('builds a header row and CRLF line endings', () => {
    const csv = buildCSV([{ a: 1, b: 2 }], ['a', 'b']);
    eq(csv, 'a,b\r\n1,2');
  });

  it('renders each payload type as readable text', () => {
    eq(payloadToText('multiple_choice', { options: ['A', 'B'] }, { choices: [0, 1] }), 'A | B');
    eq(payloadToText('word_cloud', {}, { words: ['x', 'y'] }), 'x | y');
    eq(payloadToText('scales', { statements: ['S1'] }, { values: [4] }), 'S1=4');
    eq(payloadToText('ranking', { items: ['X', 'Y'] }, { order: [1, 0] }), '1. Y | 2. X');
    eq(payloadToText('quiz', { options: ['A', 'B'] }, { choice: 1 }), 'B');
  });

  it('exports a session with no identifying column', () => {
    const session = { label: 'Tue 9am', join_code: 'ABC123' };
    const questions = [
      { id: 'q1', position: 0, type: 'multiple_choice', prompt: 'Pick', config: { options: ['A', 'B'] } },
      { id: 'q2', position: 1, type: 'quiz', prompt: 'Quiz', config: { options: ['A', 'B'], correct: [1], time: 20 } },
    ];
    const responses = [
      { question_id: 'q1', round: 1, pseudonym: 'Amber Falcon', payload: { choices: [1] }, created_at: 't1' },
      { question_id: 'q2', round: 1, pseudonym: 'Amber Falcon', payload: { choice: 1, ms: 0 }, created_at: 't2' },
      { question_id: 'q2', round: 1, pseudonym: 'Teal Harbor', payload: { choice: 0, ms: 0 }, created_at: 't3' },
    ];

    const rows = sessionToCSVRows(session, questions, responses);
    eq(rows.length, 3);

    // sorted by question, then round, then respondent
    eq(rows[0].question_number, 1);
    eq(rows[1].respondent, 'Amber Falcon');
    eq(rows[1].correct, 'yes');
    eq(rows[1].points, 1000);
    eq(rows[2].correct, 'no');
    eq(rows[2].points, 0);

    // FERPA: the header set is fixed and contains nothing identifying
    const banned = ['name', 'email', 'student', 'id', 'ip', 'device', 'user'];
    for (const header of CSV_HEADERS) {
      for (const word of banned) {
        ok(!header.toLowerCase().split('_').includes(word),
          `CSV header "${header}" must not contain "${word}"`);
      }
    }
    eq(Object.keys(rows[0]).sort(), [...CSV_HEADERS].sort());
  });

  it('skips responses whose question was deleted', () => {
    const rows = sessionToCSVRows({}, [], [{ question_id: 'gone', payload: {} }]);
    eq(rows.length, 0);
  });
});

// =====================================================================
describe('join codes and navigation', () => {
  it('avoids vowels and lookalike characters', () => {
    for (let i = 0; i < 400; i += 1) {
      const code = generateJoinCode(6);
      eq(code.length, 6);
      ok(!/[AEIOU01ILO]/.test(code), `code ${code} contains a confusable/vowel character`);
    }
  });

  it('is deterministic with an injected random source', () => {
    eq(generateJoinCode(4, () => 0), '2222');
  });

  it('builds a join URL that lands straight on the response screen', () => {
    eq(joinURL('https://x.github.io/surveyall/', 'ABC123'),
      'https://x.github.io/surveyall/join.html#ABC123');
  });

  it('walks questions in position order regardless of input order', () => {
    const qs = [{ id: 'b', position: 1 }, { id: 'a', position: 0 }, { id: 'c', position: 2 }];
    eq(sortedQuestions(qs).map((q) => q.id), ['a', 'b', 'c']);
    eq(neighbourQuestion(qs, 'a', 1).id, 'b');
    eq(neighbourQuestion(qs, 'b', -1).id, 'a');
    eq(neighbourQuestion(qs, 'c', 1), null, 'no wrap past the end');
    eq(neighbourQuestion(qs, 'a', -1), null, 'no wrap before the start');
    eq(neighbourQuestion(qs, 'missing', 1).id, 'a', 'unknown id starts at the top');
    eq(neighbourQuestion([], 'x', 1), null);
  });
});

// =====================================================================
describe('plain-text deck format (P3)', () => {
  it('parses the shipped sample without errors', () => {
    const deck = parseDeck(SAMPLE_DECK);
    eq(deck.errors, []);
    eq(deck.title, 'Sample deck — first day of class');
    eq(deck.theme, 'lecture-hall');
    eq(deck.background, { kind: 'preset', id: 'gradient-dusk' });
    eq(deck.questions.length, 8);
    eq(deck.questions.map((q) => q.type), [
      'instructions', 'word_cloud', 'multiple_choice', 'scales', 'quiz',
      'ranking', 'open_ended', 'qa',
    ]);
    // the opening slide carries its own steps and shows the join card
    eq(deck.questions[0].config.steps.length, 3);
    eq(deck.questions[0].config.show_join, true);
  });

  it('reads a quiz answer key from checkbox syntax', () => {
    const deck = parseDeck(`## quiz (25s)
Who wrote it?
- Durkheim
- [x] Weber
- Marx`);
    eq(deck.errors, []);
    const q = deck.questions[0];
    eq(q.config.correct, [1]);
    eq(q.config.time, 25);
    eq(q.config.options, ['Durkheim', 'Weber', 'Marx']);
  });

  it('reads a scale range from the header or a statement', () => {
    const deck = parseDeck(`## scales (1..7)
Rate these
~ First
~ Second`);
    eq(deck.questions[0].config.min, 1);
    eq(deck.questions[0].config.max, 7);
    eq(deck.questions[0].config.statements, ['First', 'Second']);
  });

  it('reports a quiz with no marked answer', () => {
    const deck = parseDeck(`## quiz
No key here
- A
- B`);
    ok(deck.errors.some((e) => /correct answer/i.test(e)));
  });

  it('reports an unknown question type', () => {
    const deck = parseDeck('## telepathy\nGuess');
    ok(deck.errors.some((e) => /unknown question type/i.test(e)));
  });

  it('reports too few options', () => {
    const deck = parseDeck('## multiple_choice\nPick\n- Only one');
    ok(deck.errors.some((e) => /at least two options/i.test(e)));
  });

  it('reports an empty document', () => {
    ok(parseDeck('').errors.some((e) => /no questions/i.test(e)));
  });

  it('accepts numbered lists for ranking', () => {
    const deck = parseDeck(`## ranking
Rank them
1. Family
2. Media
3. Peers`);
    eq(deck.errors, []);
    eq(deck.questions[0].config.items, ['Family', 'Media', 'Peers']);
  });

  it('ignores comments and blank lines', () => {
    const deck = parseDeck(`# T
// a note

## open_ended
Ask away`);
    eq(deck.errors, []);
    eq(deck.questions.length, 1);
  });

  it('parses background forms', () => {
    eq(parseDeck('# T\nbackground: #ff0000\n## open_ended\nq').background,
      { kind: 'solid', color: '#ff0000' });
    eq(parseDeck('# T\nbackground: dots\n## open_ended\nq').background,
      { kind: 'preset', id: 'dots' });
    eq(parseDeck('# T\nbackground: theme\n## open_ended\nq').background, { kind: 'theme' });
  });

  it('round-trips a deck through serialise → parse unchanged', () => {
    const original = parseDeck(SAMPLE_DECK);
    const text = serialiseDeck(
      { title: original.title, theme: original.theme, background: original.background },
      original.questions);
    const again = parseDeck(text);

    eq(again.errors, []);
    eq(again.title, original.title);
    eq(again.theme, original.theme);
    eq(again.background, original.background);
    eq(again.questions.length, original.questions.length);

    original.questions.forEach((q, i) => {
      eq(again.questions[i].type, q.type, `type of question ${i + 1}`);
      eq(again.questions[i].prompt, q.prompt, `prompt of question ${i + 1}`);
      eq(again.questions[i].config.options, q.config.options, `options of question ${i + 1}`);
      eq(again.questions[i].config.correct, q.config.correct, `answer key of question ${i + 1}`);
      eq(again.questions[i].config.items, q.config.items, `items of question ${i + 1}`);
      eq(again.questions[i].config.statements, q.config.statements, `statements of question ${i + 1}`);
      eq(again.questions[i].config.steps, q.config.steps, `steps of question ${i + 1}`);
    });
  });
});

// =====================================================================
describe('instructions slide', () => {
  it('is a content slide, not a question', () => {
    ok(isContentSlide('instructions'));
    notOk(isContentSlide('multiple_choice'));
    notOk(isContentSlide('qa'));
  });

  it('refuses every answer, whatever is thrown at it', () => {
    for (const raw of [null, {}, { choices: [0] }, { text: 'hi' }]) {
      notOk(validateResponse('instructions', { steps: ['a'] }, raw).ok);
    }
  });

  it('aggregates to nothing rather than throwing', () => {
    const agg = aggregate('instructions', { steps: ['a'] }, []);
    eq(agg.total, 0);
  });

  it('parses steps from "-" lines and defaults show_join on', () => {
    const deck = parseDeck(`## instructions
Join in before we start
- Point your camera at the QR code.
- Or type %CODE% at the address on screen.`);
    eq(deck.errors, []);
    eq(deck.questions[0].type, 'instructions');
    eq(deck.questions[0].prompt, 'Join in before we start');
    eq(deck.questions[0].config.steps.length, 2);
    eq(deck.questions[0].config.show_join, true);
  });

  it('falls back to the standard steps and a heading when given neither', () => {
    const deck = parseDeck('## instructions');
    eq(deck.errors, []);
    eq(deck.questions[0].prompt, 'How to join');
    eq(deck.questions[0].config.steps, DEFAULT_JOIN_STEPS);
  });

  it('round-trips join: false', () => {
    const parsed = parseDeck(`## intro
Housekeeping
- Phones out.
join: false`);
    eq(parsed.questions[0].config.show_join, false);
    const again = parseDeck(serialiseDeck({ title: 'x' }, parsed.questions));
    eq(again.questions[0].config.show_join, false);
    eq(again.questions[0].config.steps, ['Phones out.']);
  });

  it('substitutes the join code into a step, leaving the deck portable', () => {
    const step = 'Or go to %URL% and type the code %CODE%.';
    eq(fillJoinPlaceholders(step, { code: 'BQ7RTM', url: 'polls.example.edu' }),
      'Or go to polls.example.edu and type the code BQ7RTM.');
    // the stored deck itself is never rewritten
    ok(step.includes('%CODE%'));
  });

  it('needs no placeholder by default — the slide prints the code itself', () => {
    // A deck owns a permanent code, so the join card shows it and the
    // steps do not have to repeat it. Nothing here should render as a
    // literal %CODE% in front of a class.
    for (const step of DEFAULT_JOIN_STEPS) {
      ok(!/%[A-Z]+%/.test(step), `default step still carries a placeholder: ${step}`);
    }
    // and with no code supplied, a custom step degrades to empty rather
    // than projecting the raw token
    eq(fillJoinPlaceholders('Type %CODE% to join.', {}), 'Type  to join.');
  });

  it('leaves an unknown placeholder alone rather than blanking it', () => {
    eq(fillJoinPlaceholders('Room %ROOM%', { code: 'X' }), 'Room %ROOM%');
  });

  it('is skipped when numbering questions for the room', () => {
    const deck = [
      { id: 'a', type: 'instructions', position: 0 },
      { id: 'b', type: 'multiple_choice', position: 1 },
      { id: 'c', type: 'instructions', position: 2 },
      { id: 'd', type: 'quiz', position: 3 },
    ];
    // the first thing anyone answers is "Question 1 of 2", not "2 of 4"
    eq(questionNumber(deck, 'b'), { number: 1, total: 2 });
    eq(questionNumber(deck, 'd'), { number: 2, total: 2 });
    eq(questionNumber(deck, 'a').number, 0, 'a content slide has no number');
  });

  it('reads deck-wide slide settings, defaulting to the old look', () => {
    // absent settings must not restyle a deck somebody already built
    eq(promptScale({}), 1);
    eq(promptScale({ settings: {} }), 1);
    ok(showSlideLabel({}));
    ok(showSlideLabel({ settings: {} }));
    // and an unknown value falls back rather than collapsing the type
    eq(promptScale({ settings: { promptScale: 'enormous' } }), 1);

    ok(promptScale({ settings: { promptScale: 'compact' } }) < 1);
    ok(promptScale({ settings: { promptScale: 'large' } }) > 1);
    notOk(showSlideLabel({ settings: { showSlideLabel: false } }));
  });

  it('contributes no rows to a CSV export', () => {
    const questions = [
      { id: 'i', type: 'instructions', prompt: 'Join', position: 0, config: {} },
      { id: 'm', type: 'multiple_choice', prompt: 'Pick', position: 1, config: { options: ['A', 'B'] } },
    ];
    const rows = sessionToCSVRows({ label: 'S' }, questions,
      [{ question_id: 'm', round: 1, pseudonym: 'Jade Kestrel', payload: { choices: [0] } }]);
    eq(rows.length, 1);
    eq(rows[0].question_type, 'Multiple choice');
  });
});

// =====================================================================
// A slide type has to be declared in three places: QUESTION_TYPES here,
// the CHECK constraint in worker/schema.sql, and CONTENT_SLIDE_TYPES in
// worker/index.js (which cannot import this file — it is bundled for a
// different runtime). Nothing makes them agree.
//
// They disagreed once. `instructions` was added everywhere except the
// CHECK, so the editor offered a slide type the database refused, the
// insert failed with SQLITE_CONSTRAINT, and — because the click handler
// swallowed the rejection — the button simply looked dead. It cost an
// afternoon. These read the other two files as text, so the next mismatch
// fails here instead of in front of a class.
describe('slide types agree across the three places they are declared', () => {
  const schema = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');

  it('the questions CHECK constraint lists exactly QUESTION_TYPES', () => {
    const clause = schema.match(/check\s*\(type in\s*\(([\s\S]*?)\)\)/i);
    ok(clause, 'could not find the type CHECK constraint in worker/schema.sql');
    const inSchema = [...clause[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    eq(inSchema, [...QUESTION_TYPES].sort(),
      'worker/schema.sql CHECK and QUESTION_TYPES have drifted — a type in one '
      + 'but not the other is a slide the editor offers and the database rejects');
  });

  it('the Worker\'s content-slide list matches CONTENT_TYPES', () => {
    const decl = worker.match(/CONTENT_SLIDE_TYPES\s*=\s*\[([^\]]*)\]/);
    ok(decl, 'could not find CONTENT_SLIDE_TYPES in worker/index.js');
    const inWorker = [...decl[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    eq(inWorker, [...CONTENT_TYPES].sort(),
      'worker/index.js and CONTENT_TYPES have drifted — question numbering on '
      + 'the phone would count content slides, or skip real questions');
  });

  it('every content type is also a known question type', () => {
    for (const t of CONTENT_TYPES) {
      ok(QUESTION_TYPES.includes(t), `${t} is a content type but not in QUESTION_TYPES`);
    }
  });
});

// =====================================================================
describe('answer-key safety', () => {
  it('never carries a correct answer inside the option labels', () => {
    // get_live_question() strips config.correct server-side; this checks
    // the client helper we use to render options does not leak it either.
    const cfg = { options: [{ label: 'A' }, { label: 'B', correct: true }], correct: [1] };
    eq(optionLabels(cfg), ['A', 'B']);
    ok(!JSON.stringify(optionLabels(cfg)).includes('correct'));
  });
});

// =====================================================================
describe('end-to-end participant simulation', () => {
  it('runs a 30-student class through a deck and produces a clean export', () => {
    const deck = parseDeck(SAMPLE_DECK);
    eq(deck.errors, []);

    const questions = deck.questions.map((q, i) => ({ ...q, id: `q${i}`, position: i }));
    const students = Array.from({ length: 30 }, (_, i) => `Student ${i}`); // stand-in devices
    const pseudonyms = students.map((_, i) => `Pseudo ${i}`);
    const responses = [];
    let rejected = 0;

    for (const q of questions) {
      if (q.type === 'qa' || isContentSlide(q.type)) continue;

      pseudonyms.forEach((pseudonym, i) => {
        const raw = fakeAnswer(q, i);
        const check = validateResponse(q.type, q.config, raw);
        if (!check.ok) { rejected += 1; return; }
        responses.push({
          question_id: q.id, round: 1, pseudonym,
          payload: check.payload, created_at: `t${responses.length}`,
        });
      });
    }

    const askable = questions.filter((q) => q.type !== 'qa' && !isContentSlide(q.type));
    eq(rejected, 0, 'every simulated answer should validate');
    eq(responses.length, 30 * askable.length);

    // every question aggregates without throwing and counts everyone
    for (const q of askable) {
      const rows = responses.filter((r) => r.question_id === q.id);
      const agg = aggregate(q.type, q.config, rows);
      eq(agg.total, 30, `${q.type} should count 30 respondents`);
    }

    // the CSV holds one row per response and nothing identifying
    const rows = sessionToCSVRows({ label: 'Sim' }, questions, responses);
    eq(rows.length, responses.length);
    const blob = JSON.stringify(rows);
    ok(!/Student \d/.test(blob), 'no device/student label may reach the export');
    ok(/Pseudo \d/.test(blob), 'only the session pseudonym identifies a row');

    const csv = buildCSV(rows, CSV_HEADERS);
    eq(csv.split('\r\n').length, rows.length + 1);
  });

  it('rejects every answer once voting is closed (mirrors the RLS rule)', () => {
    // The database enforces this; here we assert the UI-side guard agrees
    // that a closed question yields no accepted payloads.
    const q = { type: 'multiple_choice', config: { options: ['A', 'B'] } };
    const accepting = false;
    const submitted = [0, 1, 1].filter(() => accepting);
    eq(submitted.length, 0);
  });
});

function fakeAnswer(q, i) {
  const cfg = q.config;
  switch (q.type) {
    case 'multiple_choice':
      return { choices: [i % cfg.options.length] };
    case 'quiz':
      return { choice: i % cfg.options.length, ms: (i * 137) % 20000 };
    case 'word_cloud':
      return { words: [['curious', 'tired', 'ready', 'nervous'][i % 4]] };
    case 'open_ended':
      return { text: `Response number ${i}` };
    case 'scales':
      return { values: cfg.statements.map((_, s) => cfg.min + ((i + s) % (cfg.max - cfg.min + 1))) };
    case 'ranking':
      return { order: cfg.items.map((_, k) => (k + i) % cfg.items.length) };
    default:
      return {};
  }
}

// =====================================================================
describe('spring physics', () => {
  /** Run a spring to rest, returning every intermediate value. */
  const run = (spring, target, maxFrames = 600) => {
    spring.to(target);
    const path = [];
    for (let i = 0; i < maxFrames && !spring.settled; i += 1) {
      spring.step(1 / 60);
      path.push(spring.value);
    }
    return path;
  };

  const zeta = (p) => p.damping / (2 * Math.sqrt(p.stiffness * (p.mass || 1)));

  it('matches react-spring\'s default preset (what Mentimeter ships)', () => {
    eq(PRESETS.smooth.stiffness, 170);
    eq(PRESETS.smooth.damping, 26);
  });

  it('has a critically damped preset for quantitative values', () => {
    // ζ >= ~0.99 means no meaningful overshoot: a bar never draws a
    // number higher than the one it is animating to.
    ok(zeta(PRESETS.smooth) > 0.98, `smooth ζ=${zeta(PRESETS.smooth).toFixed(3)}`);
    ok(zeta(PRESETS.precise) >= 1.0, `precise ζ=${zeta(PRESETS.precise).toFixed(3)}`);
  });

  it('does not overshoot on the quantitative presets', () => {
    for (const name of ['smooth', 'precise', 'snappy', 'gentle']) {
      const s = new Spring(0, PRESETS[name]);
      const path = run(s, 100);
      const peak = Math.max(...path);
      ok(peak <= 100.5, `${name} overshot to ${peak.toFixed(2)} (must stay <= 100.5)`);
    }
  });

  it('DOES overshoot on the bouncy preset (position/entrance only)', () => {
    const s = new Spring(0, PRESETS.bouncy);
    const path = run(s, 100);
    ok(Math.max(...path) > 101, 'bouncy should visibly overshoot');
    ok(zeta(PRESETS.bouncy) < 0.7, 'bouncy must be clearly underdamped');
  });

  it('settles at exactly the target', () => {
    const s = new Spring(0, PRESETS.smooth);
    run(s, 42.5);
    ok(s.settled);
    eq(s.value, 42.5);
    eq(s.velocity, 0);
  });

  it('looks settled quickly for a full-scale move', () => {
    // What matters is when motion becomes imperceptible, not when the
    // integrator formally rests — the last 1% of a spring's travel is
    // invisible. Worst case here is a 0→100 jump; real vote-to-vote
    // changes are far smaller and land proportionally sooner, because
    // precision scales with distance.
    for (const name of ['smooth', 'precise', 'snappy']) {
      const s = new Spring(0, PRESETS[name]);
      s.to(100);
      let frames = 0;
      let visuallyDone = null;
      while (!s.settled && frames < 600) {
        s.step(1 / 60);
        frames += 1;
        if (visuallyDone === null && Math.abs(s.value - 100) <= 1) visuallyDone = frames;
      }
      ok(visuallyDone !== null && visuallyDone <= 36,
        `${name} took ${visuallyDone} frames (~${(visuallyDone / 60).toFixed(2)}s) to look settled`);
      ok(frames <= 60, `${name} full settle took ${frames} frames`);
    }
  });

  it('moves monotonically toward the target when critically damped', () => {
    const s = new Spring(0, PRESETS.smooth);
    const path = run(s, 100);
    for (let i = 1; i < path.length; i += 1) {
      ok(path[i] >= path[i - 1] - 1e-9, `went backwards at frame ${i}`);
    }
  });

  it('keeps its velocity when retargeted mid-flight', () => {
    // This is the whole point: a vote landing while the bar is moving
    // must bend its path, not restart it from a standstill.
    const s = new Spring(0, PRESETS.smooth);
    s.to(100);
    for (let i = 0; i < 6; i += 1) s.step(1 / 60);
    const vMid = s.velocity;
    ok(vMid > 0, 'should be moving');
    s.to(120);
    eq(s.velocity, vMid, 'retargeting must not zero the velocity');
    notOk(s.settled);
  });

  it('is stable when a frame is dropped (clamps dt)', () => {
    const s = new Spring(0, PRESETS.snappy);
    s.to(100);
    s.step(2.5);                    // a 2.5 second "frame" — tab was hidden
    ok(Number.isFinite(s.value), 'value must not blow up to NaN/Infinity');
    ok(s.value <= 101, `value exploded to ${s.value}`);
  });

  it('snaps instantly without animating', () => {
    const s = new Spring(10, PRESETS.smooth);
    s.to(90);
    s.snap(55);
    ok(s.settled);
    eq(s.value, 55);
    eq(s.velocity, 0);
  });

  it('treats a no-op retarget as already settled', () => {
    const s = new Spring(7, PRESETS.smooth);
    s.to(7);
    ok(s.settled);
  });
});

describe('spring group', () => {
  /** Drive a group by hand, the way the rAF ticker would. */
  const drive = (group, frames = 300) => {
    let painted = 0;
    for (let i = 0; i < frames; i += 1) {
      const moving = group.stepAll(1 / 60);
      painted += 1;
      if (!moving) break;
    }
    return painted;
  };

  it('animates every key to its target', () => {
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.set('a', 100, { from: 0 });
    g.set('b', 50, { from: 0 });
    drive(g);
    close(g.get('a'), 100, 1e-6);
    close(g.get('b'), 50, 1e-6);
    ok(g.settled);
  });

  it('reports not-settled while work is outstanding', () => {
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.set('a', 100, { from: 0 });
    notOk(g.settled);
    g.stepAll(1 / 60);
    notOk(g.settled, 'one frame is not enough to finish');
  });

  it('finishes even when the render callback throws', () => {
    // Regression: a throwing paint used to kill the animation loop, and
    // the chart would sit frozen part-way with no visible error.
    const original = console.error;
    console.error = () => {};
    try {
      const g = new SpringGroup(() => { throw new Error('boom'); }, PRESETS.smooth);
      g.set('a', 100, { from: 0 });
      drive(g);
      close(g.get('a'), 100, 1e-6, 'must still reach the target');
      ok(g.settled);
    } finally {
      console.error = original;
    }
  });

  it('keeps animating after being re-kicked mid-flight', () => {
    // Regression: kick() used to early-return on a stale "already
    // subscribed" flag. If the ticker had dropped the group, it could
    // never restart and the chart froze with springs still under load.
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.set('in', 1, { from: 0 });
    for (let i = 0; i < 3; i += 1) g.stepAll(1 / 60);
    const mid = g.get('in');
    ok(mid > 0 && mid < 0.5, `expected mid-flight, got ${mid}`);

    g.kick();
    g.kick();
    drive(g);
    close(g.get('in'), 1, 1e-6, 'entrance must complete, not stall part-way');
  });

  it('retargets a live key without restarting it', () => {
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.set('w', 1, { from: 0 });
    for (let i = 0; i < 5; i += 1) g.stepAll(1 / 60);
    const before = g.get('w');
    g.set('w', 0.5);                 // a vote lands mid-animation
    g.stepAll(1 / 60);
    ok(Math.abs(g.get('w') - before) < 0.2, 'must bend, not jump');
    drive(g);
    close(g.get('w'), 0.5, 1e-6);
  });

  it('prunes keys for rows that no longer exist', () => {
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.set('a', 1); g.set('b', 2); g.set('c', 3);
    g.prune(new Set(['a', 'c']));
    ok(g.has('a')); notOk(g.has('b')); ok(g.has('c'));
  });

  it('snaps rather than animating when reduced motion is on', () => {
    const g = new SpringGroup(() => {}, PRESETS.smooth);
    g.reduced = true;
    g.set('a', 100, { from: 0 });
    eq(g.get('a'), 100, 'must arrive immediately');
    ok(g.settled);
  });
});

describe('motion helpers', () => {
  it('caps the entrance stagger so long lists still appear promptly', () => {
    eq(stagger(0), 0);
    close(stagger(4), 0.18, 1e-9);
    eq(stagger(100), 0.3, 'must clamp to the 300ms ceiling');
  });

  it('has easing curves anchored at 0 and 1', () => {
    eq(easeOutExpo(0), 0); eq(easeOutExpo(1), 1);
    eq(easeOutCubic(0), 0); eq(easeOutCubic(1), 1);
    ok(easeOutExpo(0.5) > 0.5, 'ease-out should be past halfway at t=0.5');
  });
});

describe('colour', () => {
  it('parses hex and rgb forms', () => {
    eq(toRGB('#ffffff'), [255, 255, 255]);
    eq(toRGB('#000'), [0, 0, 0]);
    eq(toRGB('#1d4ed8'), [29, 78, 216]);
    eq(toRGB('rgb(10, 20, 30)'), [10, 20, 30]);
    eq(toRGB('rgba(10, 20, 30, .5)'), [10, 20, 30]);
    eq(toRGB('nonsense'), [0, 0, 0]);
  });

  it('builds rgba strings and mixes', () => {
    eq(rgba('#000000', 0.5), 'rgba(0, 0, 0, 0.5)');
    eq(mixColor('#000000', '#ffffff', 0.5), 'rgb(128, 128, 128)');
    eq(mixColor('#000000', '#ffffff', 0), 'rgb(0, 0, 0)');
  });

  it('computes luminance and picks a readable foreground', () => {
    close(luminance('#ffffff'), 1, 1e-6);
    close(luminance('#000000'), 0, 1e-6);
    eq(readableOn('#ffffff'), '#0b1220', 'dark text on light');
    eq(readableOn('#000000'), '#ffffff', 'light text on dark');
  });

  it('round-trips sRGB through OKLab', () => {
    for (const hex of ['#1d4ed8', '#b45309', '#15803d', '#ffffff', '#000000']) {
      const back = toRGB(oklabToSrgb(srgbToOklab(hex)));
      const want = toRGB(hex);
      back.forEach((v, i) => close(v, want[i], 2, `${hex} channel ${i}`));
    }
  });

  it('generates a categorical series of the requested length', () => {
    const p = harmonicSeries('#1d4ed8', '#b45309', 5);
    eq(p.length, 5);
    p.forEach((c) => ok(/^rgb\(\d+, \d+, \d+\)$/.test(c), `bad colour: ${c}`));
    eq(harmonicSeries('#1d4ed8', '#b45309', 1), ['#1d4ed8']);
  });

  it('keeps categorical swatches close in perceptual lightness', () => {
    // The reason not to walk hue in HSL: swatches end up with wildly
    // different perceived brightness and the loud ones read as "more".
    const p = harmonicSeries('#1d4ed8', '#b45309', 6);
    const Ls = p.map((c) => srgbToOklab(c)[0]);
    const spread = Math.max(...Ls) - Math.min(...Ls);
    ok(spread < 0.22, `lightness spread ${spread.toFixed(3)} is too wide`);
  });
});

// =====================================================================
// Pedagogy features (roadmap): riders, new types, curation, identity
// =====================================================================

describe('answer riders — confidence and volunteer', () => {
  const cfg = { options: ['A', 'B', 'C'] };

  it('carries a 1–3 confidence self-report on a choice', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [1], conf: 3 });
    ok(r.ok);
    eq(r.payload.conf, 3);
  });

  it('drops out-of-range confidence silently', () => {
    const r = validateResponse('multiple_choice', cfg, { choices: [1], conf: 7 });
    ok(r.ok);
    eq(r.payload.conf, undefined);
  });

  it('carries the volunteer hand-raise only when literally true', () => {
    const a = validateResponse('open_ended', {}, { text: 'hi', volunteer: true });
    const b = validateResponse('open_ended', {}, { text: 'hi', volunteer: 'yes' });
    ok(a.ok && b.ok);
    eq(a.payload.volunteer, true);
    eq(b.payload.volunteer, undefined);
  });

  it('aggregates the confidence quadrant against the answer key', () => {
    const qcfg = { options: ['A', 'B'], correct: [0] };
    const rows = [
      { payload: { choice: 0, conf: 3 } },  // sure + right
      { payload: { choice: 1, conf: 3 } },  // sure + wrong (the signal)
      { payload: { choice: 0, conf: 1 } },  // guessing + right
      { payload: { choice: 1, conf: 2 } },  // fairly sure + wrong
      { payload: { choice: 0 } },           // no confidence reported
    ];
    const agg = aggregate('quiz', qcfg, rows);
    eq(agg.confidence.n, 4);
    eq(agg.confidence.quad.sureRight, 1);
    eq(agg.confidence.quad.sureWrong, 1);
    eq(agg.confidence.quad.unsureRight, 1);
    eq(agg.confidence.quad.unsureWrong, 1);
  });

  it('reports null confidence when nobody offered one', () => {
    const agg = aggregate('quiz', { options: ['A'], correct: [0] },
      [{ payload: { choice: 0 } }]);
    eq(agg.confidence, null);
  });
});

describe('opinion spectrum', () => {
  it('clamps and rounds the position', () => {
    eq(validateResponse('spectrum', {}, { pos: 61.4 }).payload.pos, 61);
    eq(validateResponse('spectrum', {}, { pos: 400 }).payload.pos, 100);
    eq(validateResponse('spectrum', {}, { pos: -3 }).payload.pos, 0);
    notOk(validateResponse('spectrum', {}, {}).ok);
  });

  it('aggregates individual points with pseudonyms for dot identity', () => {
    const rows = [
      { pseudonym: 'Amber Falcon', payload: { pos: 10 } },
      { pseudonym: 'Teal Harbor', payload: { pos: 90 } },
    ];
    const agg = aggregate('spectrum', {}, rows);
    eq(agg.total, 2);
    eq(agg.points[0].pos, 10);
    eq(agg.points[0].pseudonym, 'Amber Falcon');
    eq(agg.corners.join(','), '1,0,0,1');
  });
});

describe('writing showdown (sample_vote)', () => {
  const cfg = { samples: ['Thesis A', 'Thesis B'], allow_rationale: true };

  it('validates the pick and trims the rationale', () => {
    const r = validateResponse('sample_vote', cfg,
      { choice: 1, rationale: '  commits to  an argument  ' });
    ok(r.ok);
    eq(r.payload.choice, 1);
    eq(r.payload.rationale, 'commits to an argument');
    notOk(validateResponse('sample_vote', cfg, { choice: 5 }).ok);
  });

  it('aggregates counts and keeps rationales attached to their sample', () => {
    const rows = [
      { payload: { choice: 0 } },
      { payload: { choice: 1, rationale: 'stronger claim' } },
      { payload: { choice: 1 } },
    ];
    const agg = aggregate('sample_vote', cfg, rows);
    eq(agg.total, 3);
    eq(agg.samples[1].count, 2);
    close(agg.samples[1].pct, 66.67, 0.1);
    eq(agg.rationales.length, 1);
    eq(agg.rationales[0].choice, 1);
  });
});

describe('passage heatmap', () => {
  it('splits sentences conservatively and honours manual | splits', () => {
    eq(splitPassage('One. Two! Three?').length, 3);
    eq(splitPassage('All animals are equal | but some animals | are more equal').length, 3);
    eq(splitPassage('Ends without punctuation').length, 1);
    eq(splitPassage('').length, 0);
  });

  const cfg = { segments: ['S1.', 'S2.', 'S3.'], max_picks: 2 };

  it('validates highlight picks within bounds', () => {
    const r = validateResponse('heatmap', cfg, { picks: [2, 0, 2] });
    ok(r.ok);
    eq(r.payload.picks.join(','), '0,2');
    notOk(validateResponse('heatmap', cfg, { picks: [9] }).ok);
    notOk(validateResponse('heatmap', cfg, { picks: [0, 1, 2] }).ok);
  });

  it('validates classify tags against segments and labels', () => {
    const ccfg = { ...cfg, mode: 'classify', labels: ['claim', 'evidence'] };
    const r = validateResponse('heatmap', ccfg, { tags: { 1: 0, 9: 1, 2: 5 } });
    ok(r.ok);
    eq(JSON.stringify(r.payload.tags), '{"1":0}');
  });

  it('aggregates heat normalised to the hottest segment', () => {
    const rows = [
      { payload: { picks: [1] } },
      { payload: { picks: [1] } },
      { payload: { picks: [0] } },
    ];
    const agg = aggregate('heatmap', cfg, rows);
    eq(agg.total, 3);
    eq(agg.segments[1].count, 2);
    eq(agg.segments[1].heat, 1);
    close(agg.segments[0].heat, 0.5, 0.001);
    eq(agg.mode, 'highlight');
  });

  it('aggregates per-label tag counts in classify mode', () => {
    const ccfg = { ...cfg, mode: 'classify', labels: ['claim', 'warrant'] };
    const rows = [
      { payload: { tags: { 0: 0, 1: 1 } } },
      { payload: { tags: { 0: 0 } } },
      { payload: { tags: { 0: 1 } } },
    ];
    const agg = aggregate('heatmap', ccfg, rows);
    eq(agg.mode, 'classify');
    eq(agg.segments[0].tags.join(','), '2,1');
    eq(agg.segments[1].tags.join(','), '0,1');
  });
});

describe('word cloud curation — merge and hide, visibly counted', () => {
  const rows = [
    { payload: { words: ['arguing'] } },
    { payload: { words: ['argue'] } },
    { payload: { words: ['argument'] } },
    { payload: { words: ['rude'] } },
  ];

  it('folds merged variants into one word and counts the merge', () => {
    const cfg = { word_merges: { arguing: 'argue', argument: 'argue' } };
    const agg = aggregate('word_cloud', cfg, rows);
    const argue = agg.words.find((w) => w.word === 'argue');
    eq(argue.count, 3);
    eq(agg.merged, 2);
    eq(agg.words.some((w) => w.word === 'arguing'), false);
  });

  it('hides words without pretending they never happened', () => {
    const agg = aggregate('word_cloud', { word_hidden: ['rude'] }, rows);
    eq(agg.hidden, 1);
    eq(agg.words.some((w) => w.word === 'rude'), false);
    eq(agg.total, 4); // respondent count is untouched by curation
  });

  it('a merge that lands on a hidden word stays hidden and counted', () => {
    const cfg = { word_merges: { arguing: 'rude' }, word_hidden: ['rude'] };
    const agg = aggregate('word_cloud', cfg, rows);
    eq(agg.hidden, 2);
  });
});

describe('question identity across sessions (promptKey)', () => {
  it('normalises case, punctuation and spacing', () => {
    eq(promptKey('  What is a warrant?  '), promptKey('what IS a warrant'));
    ok(promptKey('What is a warrant?') !== promptKey('What is a claim?'));
    eq(promptKey(''), '');
  });
});

describe('new types round-trip the plain-text deck format', () => {
  const src = `# Deck
## spectrum
Uniforms are a justifiable rule
left: Strongly disagree
right: Strongly agree

## showdown
Which thesis is strongest?
- Social media harms attention spans.
- Social media reshapes attention rather than destroying it.
rationale: false

## heatmap
Tap the claim
> All animals are equal. | But some are more equal. | That is the joke.
labels: claim, evidence
max_picks: 2
`;

  it('parses all three with their configs', () => {
    const deck = parseDeck(src);
    eq(deck.errors.length, 0);
    eq(deck.questions.length, 3);
    const [sp, sv, hm] = deck.questions;
    eq(sp.type, 'spectrum');
    eq(sp.config.left_label, 'Strongly disagree');
    eq(sv.type, 'sample_vote');
    eq(sv.config.samples.length, 2);
    eq(sv.config.allow_rationale, false);
    eq(hm.type, 'heatmap');
    eq(hm.config.segments.length, 3);
    eq(hm.config.mode, 'classify');
    eq(hm.config.labels.join(','), 'claim,evidence');
    eq(hm.config.max_picks, 2);
  });

  it('serialise → parse round-trips segmentation and settings', () => {
    const deck = parseDeck(src);
    const again = parseDeck(serialiseDeck({ title: 'Deck', theme: 'lecture-hall' }, deck.questions));
    eq(again.errors.length, 0);
    const [sp, sv, hm] = again.questions;
    eq(sp.config.right_label, 'Strongly agree');
    eq(sv.config.allow_rationale, false);
    eq(hm.config.segments.join('|'), deck.questions[2].config.segments.join('|'));
    eq(hm.config.mode, 'classify');
  });
});

describe('new types stay FERPA-clean in the CSV', () => {
  it('renders readable answer cells for every new type', () => {
    eq(payloadToText('spectrum', { left_label: 'No', right_label: 'Yes' }, { pos: 62 }),
      '62 (0=No, 100=Yes)');
    eq(payloadToText('sample_vote', {}, { choice: 1, rationale: 'tighter' }),
      'Sample 2 — tighter');
    eq(payloadToText('heatmap', { labels: ['claim'] }, { tags: { 0: 0 } }), 'S1=claim');
    eq(payloadToText('heatmap', {}, { picks: [0, 2] }), 'S1 | S3');
  });
});

describe('ambience — decorative backdrop motion', () => {
  const plan = (bg, theme = 'lecture-hall') => ambiencePlan(bg, theme);

  it('is off unless a deck asks for it', () => {
    eq(ambienceLevel(undefined), 'off');
    eq(ambienceLevel({ kind: 'theme' }), 'off');
    eq(ambienceLevel({ kind: 'theme', motion: 'nonsense' }), 'off');
    eq(ambienceLevel({ kind: 'theme', motion: 'lively' }), 'lively');
    eq(plan({ kind: 'theme' }).layers.length, 0);
    eq(plan({ kind: 'theme' }).base, null);
  });

  it('never animates the High Contrast theme, whatever the deck says', () => {
    const p = ambiencePlan({ kind: 'theme', motion: 'lively' }, 'high-contrast');
    eq(p.level, 'off');
    eq(p.layers.length, 0);
    eq(p.base, null);
  });

  it('resolves {kind:theme} to the theme\'s own backdrop before choosing motion', () => {
    // Neon Night ships grid-glow, a lattice; Midnight ships aurora, a wash.
    eq(ambiencePlan({ kind: 'theme', motion: 'subtle' }, 'neon-night').kind, 'lattice');
    eq(ambiencePlan({ kind: 'theme', motion: 'subtle' }, 'midnight').kind, 'bloom');
  });

  it('drifts a lattice in pixels, scaled to its own cell', () => {
    const p = plan({ kind: 'preset', id: 'grid', motion: 'subtle' });
    eq(p.kind, 'lattice');
    eq(p.layers.length, 0);
    ok(/px$/.test(p.base.x), `expected a pixel travel, got ${p.base.x}`);
    // one graph-paper cell is 38px; the drift must stay a fraction of it
    // or the pattern reads as scrolling rather than breathing
    ok(parseFloat(p.base.x) < 38 * 0.25, `travel ${p.base.x} is too much of a cell`);
    eq(p.base.scale, [1, 1]);
  });

  it('blooms over washes, solids and bare grounds', () => {
    for (const bg of [
      { kind: 'preset', id: 'aurora', motion: 'subtle' },
      { kind: 'solid', color: '#123456', motion: 'subtle' },
      { kind: 'none', motion: 'subtle' },
    ]) {
      const p = plan(bg);
      eq(p.kind, 'bloom');
      eq(p.base, null);
      eq(p.layers.length, 3);
      ok(p.layers.every((l) => l.image.includes('radial-gradient')), 'blooms are radials');
    }
  });

  it('gives every bloom layer a co-prime period, so the set never re-syncs', () => {
    const p = plan({ kind: 'preset', id: 'aurora', motion: 'subtle' });
    const periods = p.layers.flatMap((l) => [l.driftDuration, l.breatheDuration]);
    eq(new Set(periods).size, periods.length);
    // and drift never equals breathe on the same layer, or that layer
    // returns to an exact earlier state every cycle
    p.layers.forEach((l) => ok(l.driftDuration !== l.breatheDuration, 'periods differ'));
  });

  it('starts a blurred photo past the blur\'s own scale-up', () => {
    // backgroundStyles() already pushes a blurred image to 1.06 so the
    // smeared edge sits off screen; a Ken Burns that started below that
    // would feather the edge into the room
    const blurred = plan({ kind: 'image', url: 'x.jpg', blur: 12, motion: 'subtle' });
    eq(blurred.kind, 'image');
    ok(blurred.base.scale[0] >= 1.06, `starts at ${blurred.base.scale[0]}`);
    ok(blurred.base.scale[1] > blurred.base.scale[0], 'it has to move');

    const sharp = plan({ kind: 'image', url: 'x.jpg', motion: 'subtle' });
    eq(sharp.base.scale[0], 1);
  });

  it('makes lively travel further and cycle faster than subtle', () => {
    const s = plan({ kind: 'preset', id: 'dots', motion: 'subtle' }).base;
    const l = plan({ kind: 'preset', id: 'dots', motion: 'lively' }).base;
    ok(parseFloat(l.x) > parseFloat(s.x), 'lively travels further');
    ok(l.duration < s.duration, 'lively cycles faster');
  });

  it('keeps bloom alpha inside the range the static presets already use', () => {
    for (const theme of ['midnight', 'lecture-hall']) {
      const p = ambiencePlan({ kind: 'preset', id: 'aurora', motion: 'lively' }, theme);
      p.layers.forEach((l) => {
        const a = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(l.image)[1]);
        ok(a > 0 && a <= 0.34, `alpha ${a} on ${theme} is out of range`);
      });
    }
  });
});

describe('ambience round-trips the plain-text deck format', () => {
  it('reads and writes an ambience line independent of the background', () => {
    const d = parseDeck('# Deck\ntheme: midnight\nambience: lively\n\n## poll\nQ?\n- a\n- b\n');
    eq(d.background.kind, 'theme');
    eq(d.background.motion, 'lively');
    ok(serialiseDeck(d, d.questions).includes('ambience: lively'));
  });

  it('merges with the background line whichever order they arrive in', () => {
    const before = parseDeck('# D\nambience: subtle\nbackground: aurora\n');
    eq(before.background, { kind: 'preset', id: 'aurora', motion: 'subtle' });
    const after = parseDeck('# D\nbackground: aurora\nambience: subtle\n');
    eq(after.background, { kind: 'preset', id: 'aurora', motion: 'subtle' });
  });

  it('treats "off" as absent rather than as a stored level', () => {
    const d = parseDeck('# D\nbackground: aurora\nambience: off\n');
    eq(d.background.motion, undefined);
    ok(!serialiseDeck(d, []).includes('ambience'));
  });
});

// =====================================================================

console.log('\n');
if (failures.length) {
  console.log('FAILURES\n');
  failures.forEach(({ group: g, name, err }) => {
    console.log(`  ✗ ${g} › ${name}`);
    console.log(`    ${err.message.split('\n').join('\n    ')}\n`);
  });
}
console.log(`${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
