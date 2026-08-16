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
  'multiple_choice', 'word_cloud', 'open_ended',
  'scales', 'ranking', 'quiz', 'qa',
];

/** Types where one device may submit many rows (each gets its own slot). */
export const MULTI_SUBMIT_TYPES = new Set(['word_cloud', 'open_ended']);

/** Human labels, used in the editor and in CSV headers. */
export const TYPE_LABELS = {
  multiple_choice: 'Multiple choice',
  word_cloud: 'Word cloud',
  open_ended: 'Open ended',
  scales: 'Scales',
  ranking: 'Ranking',
  quiz: 'Quiz',
  qa: 'Q&A',
};

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
      return { ok: true, payload: { choices: clean } };
    }

    case 'quiz': {
      const labels = optionLabels(cfg);
      const choice = raw?.choice;
      if (!Number.isInteger(choice) || choice < 0 || choice >= labels.length) {
        return { ok: false, error: 'Pick an answer first.' };
      }
      const ms = Number.isFinite(raw?.ms) && raw.ms >= 0 ? Math.round(raw.ms) : null;
      return { ok: true, payload: { choice, ms } };
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
      return { ok: true, payload: { words: unique } };
    }

    case 'open_ended': {
      const limit = clampInt(cfg.max_length, 20, 1000, 200);
      const text = cleanText(raw?.text, limit);
      if (!text) return { ok: false, error: 'Write something first.' };
      return { ok: true, payload: { text } };
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
      return { ok: true, payload: { values } };
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
      return { ok: true, payload: { order: clean } };
    }

    case 'qa':
      return { ok: false, error: 'Q&A is submitted separately.' };

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
      if (type === 'quiz') out.correct = correctIndices(cfg);
      return out;
    }

    case 'word_cloud': {
      const tally = new Map();
      let total = 0;
      for (const p of payloads) {
        const words = Array.isArray(p.words) ? p.words : [];
        if (words.length) total += 1;
        for (const w of words) {
          const k = normaliseWord(w);
          if (!k) continue;
          tally.set(k, (tally.get(k) || 0) + 1);
        }
      }
      const words = [...tally.entries()]
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, 400); // same display ceiling Mentimeter uses
      return { type, total, words, distinct: tally.size };
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

    default:
      return { type, total: 0 };
  }
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

export function toCSVValue(v) {
  if (v == null) return '';
  const s = String(v);
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
    default:
      return JSON.stringify(payload);
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
  const out = [];
  for (const r of responses) {
    const q = byId.get(r.question_id);
    if (!q) continue;
    out.push({
      session: session?.label || session?.join_code || '',
      question_number: (q.position ?? 0) + 1,
      question_type: TYPE_LABELS[q.type] || q.type,
      question: q.prompt,
      round: r.round,
      respondent: r.pseudonym,
      answer: payloadToText(q.type, q.config, r.payload),
      correct: q.type === 'quiz'
        ? (correctIndices(q.config).includes(r.payload?.choice) ? 'yes' : 'no')
        : '',
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
// Session navigation
// =====================================================================

export function sortedQuestions(questions) {
  return [...(questions || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
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

export function joinURL(baseURL, code) {
  const base = String(baseURL || '').replace(/\/+$/, '');
  return `${base}/join.html#${encodeURIComponent(code)}`;
}
