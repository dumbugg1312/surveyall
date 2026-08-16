/**
 * SurveyAll — session archive.
 *
 * Every session stays here permanently and exports to CSV for free.
 * That is a deliberate answer to the research: all three commercial
 * tools paywall the export, and instructors lose their archive entirely
 * when a campus licence lapses.
 */

import {
  configured, currentUser, getSession, getDeck, listQuestions,
  fetchResponses, listAudienceQuestions,
} from './db.js';
import {
  aggregate, sortedQuestions, quizLeaderboard, computeDelta,
  sessionToCSVRows, buildCSV, CSV_HEADERS, TYPE_LABELS,
} from './logic.js';
import { applyTheme, resolveTheme } from './themes.js';
import { renderAggregate, renderLeaderboard, renderDelta } from './charts.js';

const $ = (id) => document.getElementById(id);

let session = null;
let deck = null;
let questions = [];
let allResponses = [];

boot().catch((e) => {
  console.error(e);
  $('blocks').textContent = '';
  const a = document.createElement('div');
  a.className = 'alert alert-error';
  a.textContent = e.message || String(e);
  $('blocks').append(a);
});

async function boot() {
  if (!configured) { window.location.replace('index.html'); return; }
  const user = await currentUser();
  if (!user) {
    window.location.replace(`index.html?next=${encodeURIComponent(window.location.href)}`);
    return;
  }

  const id = new URLSearchParams(window.location.search).get('session');
  if (!id) { window.location.replace('dashboard.html'); return; }

  session = await getSession(id);
  deck = await getDeck(session.deck_id);
  questions = sortedQuestions(await listQuestions(deck.id));
  allResponses = await fetchResponses(session.id);

  applyTheme(document.documentElement, resolveTheme(session.theme || deck.theme, deck));

  $('crumb').textContent = `${deck.title} · ${session.label || session.join_code}`;
  $('downloadCSV').addEventListener('click', onDownload);

  renderSummary();
  await renderBlocks();
}

// =====================================================================

function renderSummary() {
  const host = $('summary');
  host.textContent = '';

  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'section-head';
  const h = document.createElement('h2');
  h.textContent = session.label || `Session ${session.join_code}`;
  const chip = document.createElement('span');
  chip.className = `chip ${session.state === 'live' ? 'chip-live' : 'chip-ended'}`;
  chip.textContent = session.state;
  head.append(h, chip);

  const people = new Set(allResponses.map((r) => r.pseudonym)).size;
  const answered = new Set(allResponses.map((r) => r.question_id)).size;

  const stats = document.createElement('div');
  stats.className = 'stat-row';
  stats.style.marginTop = '1rem';
  [
    [people, 'Participants'],
    [allResponses.length, 'Responses'],
    [`${answered}/${questions.length}`, 'Questions used'],
    [new Date(session.created_at).toLocaleDateString(), 'Date'],
  ].forEach(([value, label]) => {
    const stat = document.createElement('div');
    stat.className = 'stat';
    const v = document.createElement('span');
    v.className = 'stat-value';
    v.textContent = String(value);
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = label;
    stat.append(v, l);
    stats.append(stat);
  });

  card.append(head, stats);
  host.append(card);
}

async function renderBlocks() {
  const host = $('blocks');
  host.textContent = '';

  if (!allResponses.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const h = document.createElement('h3');
    h.textContent = 'No responses recorded';
    const p = document.createElement('p');
    p.textContent = 'Nobody answered in this session, or it has not been run yet.';
    empty.append(h, p);
    host.append(empty);
  }

  for (const q of questions) {
    const rows = allResponses.filter((r) => r.question_id === q.id);
    if (!rows.length && q.type !== 'qa') continue;

    const block = document.createElement('div');
    block.className = 'result-block';

    const head = document.createElement('div');
    head.className = 'section-head';
    const title = document.createElement('h3');
    title.textContent = `${(q.position ?? 0) + 1}. ${q.prompt || 'Untitled'}`;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.style.fontSize = '.8rem';
    const people = new Set(rows.map((r) => r.pseudonym)).size;
    meta.textContent = `${TYPE_LABELS[q.type] || q.type} · ${people} ${people === 1 ? 'person' : 'people'}`;
    head.append(title, meta);
    block.append(head);

    if (q.type === 'qa') {
      block.append(await qaList());
      host.append(block);
      continue;
    }

    const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);

    for (const round of rounds) {
      const roundRows = rows.filter((r) => r.round === round);
      if (rounds.length > 1) {
        const label = document.createElement('p');
        label.className = 'eyebrow';
        label.textContent = `Round ${round} · ${new Set(roundRows.map((r) => r.pseudonym)).size} responses`;
        block.append(label);
      }
      const chart = document.createElement('div');
      chart.className = 'chart';
      block.append(chart);
      renderAggregate(chart, q.type, aggregate(q.type, q.config, roundRows), {
        awaiting: false, // archived data: zero responses is a fact, not a wait
        style: q.config?.chart || 'bars',
        revealCorrect: q.type === 'quiz',
      });
    }

    // Re-ask comparison (proposal P1) shown automatically when it exists
    if (rounds.length > 1) {
      const last = rounds[rounds.length - 1];
      const prev = rounds[rounds.length - 2];
      const delta = computeDelta(
        aggregate(q.type, q.config, rows.filter((r) => r.round === prev)),
        aggregate(q.type, q.config, rows.filter((r) => r.round === last)));
      if (delta) {
        const label = document.createElement('p');
        label.className = 'eyebrow';
        label.textContent = 'What changed';
        const chart = document.createElement('div');
        chart.className = 'chart';
        block.append(label, chart);
        renderDelta(chart, delta);
      }
    }

    host.append(block);
  }

  // Leaderboard, if the deck had a quiz
  const quizzes = questions.filter((q) => q.type === 'quiz');
  if (quizzes.length) {
    const block = document.createElement('div');
    block.className = 'result-block';
    const h = document.createElement('h3');
    h.textContent = 'Quiz leaderboard';
    const chart = document.createElement('div');
    chart.className = 'chart';
    block.append(h, chart);
    renderLeaderboard(chart, quizLeaderboard(quizzes.map((question) => ({
      question,
      rows: allResponses.filter((r) => r.question_id === question.id),
    }))), { limit: 25 });
    host.append(block);
  }
}

async function qaList() {
  const wrap = document.createElement('div');
  wrap.className = 'stack-sm';
  let rows = [];
  try { rows = await listAudienceQuestions(session.id); } catch { /* ignore */ }

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'No questions were asked.';
    wrap.append(p);
    return wrap;
  }

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'aq-item';
    const text = document.createElement('p');
    text.className = 'aq-text';
    text.textContent = row.body;
    const meta = document.createElement('span');
    meta.className = 'aq-votes';
    meta.textContent = `▲ ${row.upvotes}${row.answered ? ' · answered' : ''}`;
    item.append(text, meta);
    wrap.append(item);
  });
  return wrap;
}

// =====================================================================

function onDownload() {
  const rows = sessionToCSVRows(session, questions, allResponses);
  if (!rows.length) { toast('Nothing to export yet'); return; }

  const csv = buildCSV(rows, CSV_HEADERS);
  // BOM so Excel opens accented characters correctly
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(deck.title)}-${slug(session.label || session.join_code)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`Exported ${rows.length} responses`);
}

function slug(s) {
  return String(s || 'session').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200);
}
