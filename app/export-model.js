/**
 * SurveyAll — export model.
 *
 * One session, described once, in shapes a document can draw.
 *
 * The CSV was never the problem: it is complete, and it is free. What an
 * instructor actually wants to hand a department chair is the DECK — the
 * thing the room looked at — and that is what all three commercial tools
 * put behind a paywall. So this file answers a narrower question than
 * charts.js does: not "how does a live word cloud breathe", but "what are
 * the numbers, in reading order, with nothing in them that could identify
 * a student".
 *
 * WHY A MODEL AND NOT TWO EXPORTERS. The PDF is drawn by the browser's own
 * print engine from the real charts (see export-print.js), so it needs no
 * help. PowerPoint does: a .pptx is a bag of rectangles and text runs, and
 * every one of this app's twenty question types has to become rectangles
 * and text runs. Doing that inside the pptx writer would bury pedagogy
 * decisions ("a spectrum is four buckets, not an average") inside XML
 * plumbing. They live here instead, where they are readable and where
 * tests can reach them without a DOM.
 *
 * FORMS. Every slide's body is one of six shapes. That ceiling is
 * deliberate — a renderer that has to handle six forms stays honest,
 * whereas one that handles twenty types drifts type by type until the
 * PowerPoint and the projector disagree about what the room said.
 *
 *   bars      a ranked, labelled list with a length per row
 *   splits    a two-sided bar per row (tug of war)
 *   deltas    before/after pairs (a re-asked question)
 *   lines     free text, one entry per line
 *   sections  free text under headings
 *   table     columns and rows, when the finding is a comparison
 *
 * ANONYMITY. Nothing in here reads `pseudonym` except the quiz
 * leaderboard, which is the one place the product already shows nicknames
 * on the projector. The spectrum aggregate carries pseudonyms so the live
 * chart can move the same dot on a re-ask; this file takes its `corners`
 * and never touches its `points`. See the test that asserts it.
 */

import {
  TYPE_LABELS, isContentSlide, sortedQuestions, aggregate, computeDelta,
  quizLeaderboard,
} from './logic.js';

/** Word clouds and open-ended lists are unbounded; paper is not. */
const MAX_BARS = 12;
const MAX_LINES = 30;
const MAX_LEADERBOARD = 20;

const NUM = new Intl.NumberFormat('en-US');

function pct(n) {
  return `${Math.round(Number(n) || 0)}%`;
}

function plural(n, one, many) {
  return `${NUM.format(n)} ${n === 1 ? one : many}`;
}

/** Trim for a slide, not for a database. Long prose belongs in the CSV. */
function short(s, max = 90) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Bars carry a tone, not a colour. The writer resolves tone against the
 * deck's own theme tokens, so an export of a Chalkboard deck is drawn in
 * chalk and an export of Neon Night is drawn in cyan — the PowerPoint
 * looks like the session, not like PowerPoint.
 */
const TONE = { accent: 'accent', good: 'good', bad: 'bad', soft: 'soft' };

// =====================================================================
// Per-type mapping
// =====================================================================

/**
 * Turn one question's aggregate into a body shape.
 *
 * Returns null when there is genuinely nothing to draw, which the caller
 * treats as "skip this slide" rather than "draw an empty one".
 */
export function bodyFor(type, config, agg) {
  if (!agg) return null;
  const cfg = config || {};

  switch (type) {
    case 'multiple_choice':
    case 'quiz': {
      const correct = new Set(agg.correct || []);
      const bars = agg.options.map((o, i) => ({
        label: o.label,
        value: o.pct,
        max: 100,
        note: `${pct(o.pct)} · ${NUM.format(o.count)}`,
        tone: correct.has(i) ? TONE.good : TONE.accent,
        marked: correct.has(i),
      }));
      // The confidence quadrant is the highest-value line a formative
      // question produces, and it is one sentence. It rides as a footnote
      // rather than a second chart so it survives into a printed page.
      let footnote = '';
      const q = agg.confidence?.quad;
      if (q) {
        footnote = `Confident and wrong: ${NUM.format(q.sureWrong)} · `
          + `confident and right: ${NUM.format(q.sureRight)}`;
      }
      return { form: 'bars', bars, footnote };
    }

    case 'word_cloud': {
      if (!agg.words.length) return null;
      const top = agg.words.slice(0, MAX_BARS);
      const peak = top[0]?.count || 1;
      const curated = [];
      if (agg.merged) curated.push(`${agg.merged} merged`);
      if (agg.hidden) curated.push(`${agg.hidden} hidden`);
      return {
        form: 'bars',
        // A cloud on a projector is a shape; on paper it is a ranking,
        // and a ranking is the honest version — nobody can read relative
        // font size off a printed page to two significant figures.
        bars: top.map((w) => ({
          label: w.word,
          value: (w.count / peak) * 100,
          max: 100,
          note: NUM.format(w.count),
          tone: TONE.accent,
        })),
        footnote: [
          `${plural(agg.distinct, 'distinct word', 'distinct words')} from `
            + `${plural(agg.total, 'response', 'responses')}`,
          agg.words.length > MAX_BARS ? `top ${MAX_BARS} shown` : '',
          curated.join(' · '),
        ].filter(Boolean).join(' · '),
      };
    }

    case 'open_ended': {
      if (!agg.entries.length) return null;
      return {
        form: 'lines',
        lines: agg.entries.slice(0, MAX_LINES).map((e) => ({ text: e.text })),
        footnote: agg.entries.length > MAX_LINES
          ? `${MAX_LINES} of ${NUM.format(agg.entries.length)} shown — the CSV has every answer`
          : '',
      };
    }

    case 'scales': {
      const answered = agg.statements.filter((s) => s.avg != null);
      if (!answered.length) return null;
      return {
        form: 'bars',
        // Averages sit on the question's OWN scale (1–5, 0–10), not
        // rescaled to a percentage. Rescaling makes a 3.1 on a 5-point
        // scale and a 62 on a 100-point scale draw identically, which
        // reads as agreement between two questions that never agreed.
        bars: agg.statements.map((s) => ({
          label: s.label,
          value: s.avg == null ? 0 : s.avg - agg.min,
          max: agg.max - agg.min,
          note: s.avg == null ? 'no answers' : s.avg.toFixed(1),
          tone: TONE.accent,
        })),
        footnote: `Scale ${agg.min}–${agg.max} · averages exclude skipped statements`,
      };
    }

    case 'ranking': {
      if (!agg.items.length || !agg.total) return null;
      const peak = agg.items[0]?.points || 1;
      return {
        form: 'bars',
        bars: agg.items.map((it) => ({
          label: `${it.rank}. ${it.label}`,
          value: (it.points / peak) * 100,
          max: 100,
          note: `${NUM.format(it.points)} pts`,
          tone: TONE.accent,
        })),
        footnote: 'Borda count — first place scores highest',
      };
    }

    case 'spectrum': {
      if (!agg.total) return null;
      const left = cfg.left_label || 'Left';
      const right = cfg.right_label || 'Right';
      const labels = [
        `Strongly ${String(left).toLowerCase()}`,
        String(left),
        String(right),
        `Strongly ${String(right).toLowerCase()}`,
      ];
      return {
        form: 'bars',
        // Deliberately buckets, never a mean. The average of a room split
        // hard between two poles is the middle, which is the one position
        // nobody in the room actually held.
        bars: agg.corners.map((n, i) => ({
          label: labels[i],
          value: agg.total ? (n / agg.total) * 100 : 0,
          max: 100,
          note: `${pct(agg.total ? (n / agg.total) * 100 : 0)} · ${NUM.format(n)}`,
          tone: TONE.accent,
        })),
        footnote: 'Positions counted in quarters — never averaged',
      };
    }

    case 'sample_vote': {
      if (!agg.total) return null;
      return {
        form: 'bars',
        bars: agg.samples.map((s, i) => ({
          label: `Sample ${i + 1}: ${short(s.text, 60)}`,
          value: s.pct,
          max: 100,
          note: `${pct(s.pct)} · ${NUM.format(s.count)}`,
          tone: TONE.accent,
        })),
        footnote: agg.rationales.length
          ? `${plural(agg.rationales.length, 'reason', 'reasons')} given — see the notes`
          : '',
      };
    }

    case 'heatmap': {
      if (!agg.total) return null;
      const picked = agg.segments.filter((s) => s.count > 0)
        .sort((a, b) => b.count - a.count).slice(0, MAX_BARS);
      if (!picked.length) return null;
      const peak = picked[0].count || 1;
      return {
        form: 'bars',
        bars: picked.map((s) => ({
          label: short(s.text, 70),
          value: (s.count / peak) * 100,
          max: 100,
          note: NUM.format(s.count),
          tone: TONE.accent,
        })),
        footnote: agg.mode === 'classify'
          ? `Classified against: ${agg.labels.join(', ')}`
          : 'Passage segments the room highlighted, most-marked first',
      };
    }

    case 'traffic':
    case 'mood': {
      if (!agg.total) return null;
      return {
        form: 'bars',
        bars: agg.options.map((o) => ({
          label: o.emoji ? `${o.emoji}  ${o.label}` : o.label,
          value: o.pct,
          max: 100,
          note: `${pct(o.pct)} · ${NUM.format(o.count)}`,
          tone: TONE.accent,
        })),
        footnote: '',
      };
    }

    case 'this_or_that': {
      if (!agg.total) return null;
      return {
        form: 'splits',
        splits: agg.pairs.map((p) => ({
          left: p.left,
          right: p.right,
          leftCount: p.leftCount,
          rightCount: p.rightCount,
          leftPct: p.leftPct,
        })),
        footnote: 'A bar at the middle means the room was genuinely torn',
      };
    }

    case 'budget': {
      if (!agg.total) return null;
      return {
        form: 'bars',
        bars: agg.options.map((o) => ({
          label: o.label,
          value: o.share,
          max: 100,
          note: `${pct(o.share)} · avg ${o.avg.toFixed(1)}`,
          tone: TONE.accent,
        })),
        // Share of the whole pot, not the mean of the means — see the
        // comment on the budget branch in logic.js aggregate().
        footnote: `${plural(agg.total, 'allocation', 'allocations')} of ${NUM.format(agg.pot)} points each`,
      };
    }

    case 'probability': {
      if (!agg.total) return null;
      const peak = Math.max(1, ...agg.bins);
      const bars = agg.bins.map((n, i) => ({
        label: `${i * 10}–${i * 10 + 9}%`,
        value: (n / peak) * 100,
        max: 100,
        note: n ? NUM.format(n) : '',
        tone: agg.truth != null && Math.floor(agg.truth / 10) === i ? TONE.good : TONE.accent,
        marked: agg.truth != null && Math.floor(agg.truth / 10) === i,
      }));
      const parts = [];
      if (agg.median != null) parts.push(`Median ${Math.round(agg.median)}%`);
      if (agg.truth != null) parts.push(`actual ${agg.truth}%`);
      return { form: 'bars', bars, footnote: parts.join(' · ') };
    }

    case 'cloze': {
      if (!agg.total) return null;
      return {
        form: 'table',
        columns: ['Blank', 'What the room wrote', 'Right'],
        rows: agg.blanks.map((b, i) => [
          `${i + 1}. ${short(b.key.join(' / '), 28)}`,
          b.answers.slice(0, 4).map((a) => `${a.text} (${a.count})`).join(', ') || '—',
          b.count ? pct(b.pct) : '—',
        ]),
        footnote: 'Answer key in the first column',
      };
    }

    case 'matching': {
      if (!agg.total) return null;
      return {
        form: 'table',
        columns: ['Item', 'Correct match', 'Right', 'Most confused with'],
        rows: agg.rows.map((r) => [
          short(r.left, 34),
          short(r.right, 34),
          r.count ? pct(r.pct) : '—',
          // The off-diagonal cell is the whole reason to run this
          // question type: a named, specific mix-up is teachable, and a
          // bare percentage is not.
          r.confusedWith ? `${short(r.confusedWith.label, 28)} (${r.confusedWith.count})` : '—',
        ]),
        footnote: `${NUM.format(agg.exact)} of ${NUM.format(agg.total)} got every pair right`,
      };
    }

    case 'timeline': {
      if (!agg.total) return null;
      return {
        form: 'table',
        columns: ['Correct order', 'Room put it', 'Right'],
        rows: agg.items.map((it, i) => {
          const placed = agg.consensus.find((c) => c.index === i);
          return [
            `${i + 1}. ${short(it.label, 44)}`,
            placed ? `#${placed.place + 1}` : '—',
            it.count ? pct(it.pct) : '—',
          ];
        }),
        footnote: `${NUM.format(agg.exact)} of ${NUM.format(agg.total)} ordered the whole timeline correctly`,
      };
    }

    case 'exit_ticket': {
      const filled = agg.columns.filter((c) => c.entries.length);
      if (!filled.length) return null;
      // Per-prompt caps, not one global cap: an exit ticket whose first
      // prompt drew forty answers must not silence the third prompt.
      const per = Math.max(4, Math.floor(MAX_LINES / filled.length));
      return {
        form: 'sections',
        sections: filled.map((c) => ({
          label: c.label,
          lines: c.entries.slice(0, per).map((e) => ({ text: e.text })),
          more: Math.max(0, c.entries.length - per),
        })),
        footnote: 'The CSV has every answer',
      };
    }

    default:
      return null;
  }
}

/** A re-asked question: the movement is the finding, so it gets its own slide. */
function deltaBody(delta) {
  if (!delta) return null;

  if (delta.type === 'scales') {
    const moved = delta.statements.filter((s) => s.deltaAvg != null);
    if (!moved.length) return null;
    return {
      form: 'table',
      columns: ['Statement', 'Before', 'After', 'Change'],
      rows: delta.statements.map((s) => [
        short(s.label, 44),
        s.beforeAvg == null ? '—' : s.beforeAvg.toFixed(1),
        s.afterAvg == null ? '—' : s.afterAvg.toFixed(1),
        s.deltaAvg == null ? '—' : `${s.deltaAvg >= 0 ? '+' : ''}${s.deltaAvg.toFixed(1)}`,
      ]),
      footnote: `${NUM.format(delta.beforeTotal)} answered first, ${NUM.format(delta.afterTotal)} the second time`,
    };
  }

  return {
    form: 'deltas',
    rows: delta.options.map((o) => ({
      label: o.label,
      beforePct: o.beforePct,
      afterPct: o.afterPct,
      deltaPct: o.deltaPct,
    })),
    footnote: `${pct(delta.moved)} of the room changed its answer`,
  };
}

// =====================================================================
// Slide assembly
// =====================================================================

/**
 * Build the ordered slide list for one archived session.
 *
 * Results only: a question nobody answered is not a slide, because a
 * printed page of zeros tells a reader the tool failed rather than that
 * the question went unused. Content slides (instructions) are likewise
 * left out — they carry no result. The cover carries the session's shape
 * so the document can be read months later without the app.
 *
 * @param {object} ctx
 * @param {object} ctx.deck
 * @param {object} ctx.session
 * @param {Array}  ctx.questions
 * @param {Array}  ctx.responses     every response row for the session
 * @param {Array}  [ctx.audience]    audience questions, for a Q&A slide
 * @returns {Array} slides
 */
export function buildExportSlides({ deck, session, questions, responses, audience = [] }) {
  const ordered = sortedQuestions(questions || []);
  const rows = responses || [];
  const slides = [];

  // ---------------------------------------------------------- cover
  const people = new Set(rows.map((r) => r.pseudonym)).size;
  const answered = new Set(rows.map((r) => r.question_id)).size;
  const askable = ordered.filter((q) => !isContentSlide(q.type)).length;

  slides.push({
    kind: 'cover',
    title: deck?.title || 'Session results',
    subtitle: session?.label || (session?.join_code ? `Session ${session.join_code}` : ''),
    body: {
      form: 'stats',
      stats: [
        [NUM.format(people), people === 1 ? 'Nickname' : 'Nicknames'],
        [NUM.format(rows.length), 'Responses'],
        [`${answered}/${askable}`, 'Questions used'],
        [session?.created_at ? new Date(session.created_at).toLocaleDateString() : '—', 'Date'],
      ].map(([value, label]) => ({ value, label })),
      footnote: 'Nicknames were assigned for this session only. They are not names, '
        + 'IDs or device identifiers, and cannot be matched to a person or to any other session.',
    },
    notes: 'Exported from SurveyAll. Anonymous by design: no row in this deck '
      + 'or in the companion CSV can be traced to a student.',
  });

  // ------------------------------------------------------- questions
  // The numbering the room saw. An instructions slide at the front means
  // slide 2 was "Question 1", and the export has to agree or nobody can
  // match a page to the question they remember asking.
  const numbers = new Map();
  ordered.filter((q) => !isContentSlide(q.type)).forEach((q, i) => numbers.set(q.id, i + 1));

  for (const q of ordered) {
    if (isContentSlide(q.type)) continue;
    const qRows = rows.filter((r) => r.question_id === q.id);

    if (q.type === 'qa') {
      const asked = audience || [];
      if (!asked.length) continue;
      slides.push({
        kind: 'question',
        number: numbers.get(q.id),
        type: q.type,
        typeLabel: TYPE_LABELS[q.type] || q.type,
        title: q.prompt || 'Questions from the room',
        subtitle: plural(asked.length, 'question asked', 'questions asked'),
        body: {
          form: 'lines',
          lines: asked.slice(0, MAX_LINES).map((a) => ({
            text: a.body,
            note: `▲ ${NUM.format(a.upvotes || 0)}${a.answered ? ' · answered' : ''}`,
          })),
          footnote: asked.length > MAX_LINES ? `${MAX_LINES} of ${asked.length} shown` : '',
        },
        notes: notesFor(q, asked.length),
      });
      continue;
    }

    if (!qRows.length) continue;

    const rounds = [...new Set(qRows.map((r) => r.round))].sort((a, b) => a - b);

    for (const round of rounds) {
      const roundRows = qRows.filter((r) => r.round === round);
      const agg = aggregate(q.type, q.config, roundRows);
      const body = bodyFor(q.type, q.config, agg);
      if (!body) continue;

      const heads = new Set(roundRows.map((r) => r.pseudonym)).size;
      slides.push({
        kind: 'question',
        number: numbers.get(q.id),
        round: rounds.length > 1 ? round : null,
        type: q.type,
        typeLabel: TYPE_LABELS[q.type] || q.type,
        title: q.prompt || 'Untitled',
        subtitle: [
          TYPE_LABELS[q.type] || q.type,
          plural(heads, 'nickname', 'nicknames'),
          rounds.length > 1 ? `round ${round}` : '',
        ].filter(Boolean).join(' · '),
        body,
        // The PDF is drawn by the browser from the live chart renderers,
        // not from `body` — see export-print.js. It needs the aggregate
        // the projector had, so it rides along rather than being
        // recomputed from a shape that has already been flattened.
        raw: { question: q, agg },
        notes: notesFor(q, heads, agg),
      });
    }

    // Re-ask comparison. Only the last two rounds: the finding is "what
    // moved when I asked again", and a third round makes that ambiguous.
    if (rounds.length > 1) {
      const last = rounds[rounds.length - 1];
      const prev = rounds[rounds.length - 2];
      const delta = computeDelta(
        aggregate(q.type, q.config, qRows.filter((r) => r.round === prev)),
        aggregate(q.type, q.config, qRows.filter((r) => r.round === last)));
      const body = deltaBody(delta);
      if (body) {
        slides.push({
          kind: 'delta',
          number: numbers.get(q.id),
          type: q.type,
          typeLabel: 'What changed',
          title: q.prompt || 'Untitled',
          subtitle: `What changed · round ${prev} to round ${last}`,
          body,
          raw: { question: q, delta },
          notes: `Re-ask comparison for question ${numbers.get(q.id)}.`,
        });
      }
    }
  }

  // ----------------------------------------------------- leaderboard
  const quizzes = ordered.filter((q) => q.type === 'quiz');
  if (quizzes.length) {
    const entries = quizLeaderboard(quizzes.map((question) => ({
      question,
      rows: rows.filter((r) => r.question_id === question.id),
    }))).slice(0, MAX_LEADERBOARD);

    if (entries.length) {
      const peak = entries[0].score || 1;
      slides.push({
        kind: 'leaderboard',
        title: 'Quiz leaderboard',
        subtitle: plural(entries.length, 'player', 'players'),
        body: {
          form: 'bars',
          // The nickname is the sanctioned label — the same one the
          // projector showed the room. It is random per session and
          // survives nowhere else.
          bars: entries.map((e) => ({
            label: `${e.rank}. ${e.pseudonym}`,
            value: (e.score / peak) * 100,
            max: 100,
            note: `${NUM.format(e.score)} · ${e.correct}/${e.answered}`,
            tone: TONE.accent,
          })),
          footnote: 'Nicknames were assigned for this session only',
        },
        raw: { entries },
        notes: 'Scores use time-decay: a correct answer is worth more the sooner it lands.',
      });
    }
  }

  return slides;
}

/**
 * Speaker notes. PowerPoint hides these behind the slide, which makes
 * them the right home for the numbers that would crowd a projector but
 * that someone reading the file a term later will want — the exact
 * counts, and the open text a bar chart summarises away.
 */
function notesFor(q, heads, agg) {
  const out = [`${TYPE_LABELS[q.type] || q.type} · ${plural(heads, 'nickname', 'nicknames')}.`];

  if (agg?.type === 'sample_vote' && agg.rationales?.length) {
    out.push('', 'Reasons given:');
    agg.rationales.slice(0, 20).forEach((r) => out.push(`  Sample ${r.choice + 1}: ${r.text}`));
  }
  if (agg?.type === 'word_cloud' && agg.words?.length > MAX_BARS) {
    out.push('', `Also said: ${agg.words.slice(MAX_BARS, 60).map((w) => `${w.word} (${w.count})`).join(', ')}`);
  }
  if (agg?.confidence?.quad) {
    const c = agg.confidence.quad;
    out.push('', `Confidence — sure and right ${c.sureRight}, sure and wrong ${c.sureWrong}, `
      + `unsure and right ${c.unsureRight}, unsure and wrong ${c.unsureWrong}.`);
  }
  out.push('', 'Every individual answer is in the CSV export.');
  return out.join('\n');
}

/** Filename stem shared by all three exports, so a folder sorts together. */
export function exportStem(deck, session) {
  const s = (v, fallback) => String(v || fallback).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || fallback;
  return `${s(deck?.title, 'deck')}-${s(session?.label || session?.join_code, 'session')}`;
}
