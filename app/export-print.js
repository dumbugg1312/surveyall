/**
 * SurveyAll — the PDF export.
 *
 * There is no PDF writer here, on purpose. The browser already contains
 * a typesetter that knows this deck's self-hosted variable fonts, its
 * OKLab bar colours, its emoji and its balanced text wrapping; a PDF
 * generator written in this repo would have to re-learn all of it and
 * would still come out worse. So the export builds the real slides out
 * of the real chart renderers, hands them to styles/print.css at
 * 13.333in × 7.5in, and lets the print engine do what it is for.
 *
 * The one thing that has to be arranged is stillness. Every chart in
 * this app is a spring settling toward its value, and a page printed
 * mid-flight shows a bar at a length that was never true. setMotionStill
 * makes every spring created from here land on its target immediately;
 * the deck then waits for fonts and two frames before printing, so what
 * the engine captures is the settled state.
 *
 * WHAT IS DELIBERATELY NOT PRINTED: the theme's backdrop image. A photo
 * behind a bar chart is scene-setting on a projector and a legibility
 * problem on paper, and it is the one part of the slide nobody is
 * reading. Ground colour, accents and bar colours all print (print.css
 * forces print-color-adjust: exact), so the page still arrives in the
 * deck's own palette.
 */

import { renderAggregate, renderDelta, renderLeaderboard, archiveOpts } from './charts.js';
import { setMotionStill } from './motion.js';
import { promptScale, promptAlign, resolvePromptAlign } from './logic.js';

const DECK_ID = 'printDeck';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Draw one export slide as a printable page, into `host`.
 *
 * Question slides go through the same renderers the projector used, so
 * there is exactly one implementation of "what a spectrum looks like".
 *
 * The page is attached to `host` BEFORE its chart is drawn, and `host` is
 * already in the document. Several renderers measure themselves — the
 * word cloud's spiral placement measures every word's offsetWidth at the
 * size it will be drawn at, and the bars read their track width — and a
 * detached node answers all of it with zero. The cloud is the loud
 * failure: every word gets a 14px measured box, the spiral packs them
 * into a thumbnail-sized cluster, and the slide prints a legible-looking
 * pile of overlapping words on the centre point.
 */
function drawSlide(host, slide, index, total, deck) {
  const page = el('article', `print-slide${slide.kind === 'cover' ? ' is-cover' : ''}`);
  host.append(page);

  // Per page: a slide that sat its heading in the middle on the
  // projector prints there too. The cover has no question behind it, so
  // it takes the deck's default.
  page.style.setProperty('--prompt-align', resolvePromptAlign(slide.raw?.question, deck));

  const head = el('header', 'print-head');
  const kicker = slide.kind === 'cover'
    ? 'SurveyAll · session results'
    : [slide.number ? `Question ${slide.number}` : '', slide.subtitle].filter(Boolean).join(' · ');
  head.append(el('p', 'print-kicker', kicker));
  head.append(el('h2', 'print-prompt', slide.title));
  if (slide.kind === 'cover' && slide.subtitle) {
    head.append(el('p', 'print-cover-sub', slide.subtitle));
  }
  page.append(head);

  if (slide.kind === 'cover') {
    const stats = el('div', 'print-stats');
    slide.body.stats.forEach((s) => {
      const stat = el('div', 'print-stat');
      stat.append(el('span', 'print-stat-value', s.value));
      stat.append(el('span', 'print-stat-label', s.label));
      stats.append(stat);
    });
    page.append(stats);
    if (slide.body.footnote) page.append(el('p', 'print-note', slide.body.footnote));
    return page;
  }

  page.append(el('div', 'print-rule'));

  const body = el('div', 'print-body');
  page.append(body);

  if (slide.raw?.agg) {
    const chart = el('div', 'chart');
    body.append(chart);
    // The same opts the archive page draws with, so a printed spectrum
    // wears the poles the instructor wrote rather than the defaults.
    renderAggregate(chart, slide.raw.question.type, slide.raw.agg,
      archiveOpts(slide.raw.question));
  } else if (slide.raw?.delta) {
    const chart = el('div', 'chart');
    body.append(chart);
    renderDelta(chart, slide.raw.delta);
  } else if (slide.raw?.entries) {
    const chart = el('div', 'chart');
    body.append(chart);
    renderLeaderboard(chart, slide.raw.entries, { limit: slide.raw.entries.length });
  } else if (slide.body.form === 'lines') {
    const list = el('ul', 'print-list');
    slide.body.lines.forEach((line) => {
      const li = el('li', null, line.text);
      if (line.note) li.append(el('span', 'print-list-note', line.note));
      list.append(li);
    });
    body.append(list);
  } else if (slide.body.form === 'sections') {
    const cols = el('div', 'print-columns');
    slide.body.sections.forEach((section) => {
      const col = el('div', 'print-column');
      col.append(el('h4', null, section.label));
      const list = el('ul', 'print-list');
      section.lines.forEach((line) => list.append(el('li', null, line.text)));
      if (section.more) list.append(el('li', 'print-list-note', `+${section.more} more in the CSV`));
      col.append(list);
      cols.append(col);
    });
    body.append(cols);
  }

  const foot = el('footer', 'print-foot');
  // The delta chart draws its own headline sentence ("50% of the room
  // changed their answer") at full size, so the model's footnote — which
  // exists for PowerPoint, whose bars cannot say it — would print the
  // same fact twice on the same page.
  foot.append(el('span', null, slide.kind === 'delta' ? '' : slide.body.footnote || ''));
  foot.append(el('span', 'spacer'));
  foot.append(el('span', null, `${deck?.title || ''} · ${index} / ${total}`));
  page.append(foot);

  return page;
}

/**
 * Shrink a chart until its page can hold it.
 *
 * The projector solves this with viewport-relative caps and can afford
 * to: if a chart is a little tall, the room still sees it, and the next
 * question is along in a minute. A page cannot — `overflow: hidden` on a
 * printed slide is a silent truncation, and the reader has no way to know
 * that the exit ticket had a sixth answer.
 *
 * A fixed-size page with settled springs is the one place where measuring
 * and resizing is exact and cheap, so the fit is computed rather than
 * guessed at in CSS. Charts are sized in `em` throughout (charts.css), so
 * one font-size on the container scales the whole thing.
 *
 * The word cloud is skipped: its spiral already searches for a scale that
 * fits its own box, and changing the type size under it would invalidate
 * the measurements those positions were computed from.
 */
const MIN_CHART_PX = 13;

/**
 * Two frames — one for the springs to paint, one for the reflow to land.
 *
 * Raced against a timer because requestAnimationFrame does not fire in a
 * background tab. That is not hypothetical here: an instructor can click
 * Export and switch away while it builds, and an un-raced await would
 * leave the deck half-assembled with the button stuck on "busy" until
 * they came back. Losing a frame of settling is the cheaper failure.
 */
const frame = () => Promise.race([
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  new Promise((resolve) => setTimeout(resolve, 250)),
]);

function fitChart(body) {
  const chart = body.firstElementChild;
  if (!chart?.classList.contains('chart')) return;
  if (chart.dataset.chart === 'cloud') return;

  let size = parseFloat(getComputedStyle(chart).fontSize) || 34.5;
  // Ratio-guided, then repeated: one pass usually lands it, but shrinking
  // type rewraps labels, which can make a chart taller than the ratio
  // predicted. Bounded so a pathological slide cannot spin.
  for (let i = 0; i < 8 && chart.scrollHeight > body.clientHeight + 1; i += 1) {
    const ratio = body.clientHeight / chart.scrollHeight;
    const next = Math.max(MIN_CHART_PX, size * Math.max(0.75, ratio * 0.98));
    if (next >= size) break;
    size = next;
    chart.style.fontSize = `${size}px`;
    if (size <= MIN_CHART_PX) break;
  }
}

/** Tear down the deck, including every chart's spring group. */
export function teardownDeck() {
  const host = document.getElementById(DECK_ID);
  if (!host) return;
  host.querySelectorAll('.chart').forEach((c) => {
    try { c.__chart?.group?.destroy(); } catch { /* already gone */ }
  });
  host.remove();
}

/**
 * Build the printable deck into the page and wait for it to settle.
 *
 * Separate from printDeck so tests/export-check.html can look at the
 * pages without a print dialog — and so "did the pages come out right"
 * and "did printing work" stay two questions with two answers.
 *
 * Leaves motion forced still; the caller restores it.
 *
 * @returns {Promise<HTMLElement|null>} the deck element
 */
export async function buildPrintDeck(slides, deck) {
  teardownDeck();
  if (!slides.length) return null;

  setMotionStill(true);

  const host = el('div', null);
  host.id = DECK_ID;
  // The per-deck question size the instructor chose in the editor, so a
  // deck designed for short prompts prints as loud as it projected.
  host.style.setProperty('--prompt-scale', String(promptScale(deck)));
  host.style.setProperty('--prompt-align', promptAlign(deck));

  // In the document before anything is drawn — see drawSlide().
  document.body.append(host);

  slides.forEach((slide, i) => drawSlide(host, slide, i + 1, slides.length, deck));

  // Fonts first: printing before the variable faces load sets the whole
  // deck in a fallback and, worse, at fallback metrics — every balanced
  // prompt rewraps. Then two frames, because a spring that has snapped
  // still has to be painted once by the shared rAF.
  try { await document.fonts.ready; } catch { /* no Font Loading API */ }
  await frame();

  // ONLY NOW. Fitting is a measurement, and measuring before the real
  // faces arrive measures the fallback: every chart came back a few
  // percent short, the fit decided it already fitted, and the slide then
  // grew past its page the moment Fraunces loaded.
  host.querySelectorAll('.print-body').forEach((body) => fitChart(body));
  await frame();

  return host;
}

/**
 * Build the deck and open the print dialog.
 *
 * @param {Array}  slides  from buildExportSlides()
 * @param {object} deck    for the running footer and the prompt scale
 * @param {{title?: string}} [opts] the document title, which is what
 *        every browser offers as the default PDF filename
 */
export async function printDeck(slides, deck, { title } = {}) {
  const originalTitle = document.title;
  const host = await buildPrintDeck(slides, deck);
  if (!host) { setMotionStill(false); return; }

  if (title) document.title = title;

  const done = () => {
    window.removeEventListener('afterprint', done);
    clearTimeout(timer);
    document.title = originalTitle;
    setMotionStill(false);
    teardownDeck();
  };
  // afterprint is the reliable signal in Chrome and Firefox. Safari has
  // historically not fired it, so a timer collects the deck either way —
  // long enough that it cannot fire while the dialog is still open in a
  // browser that does the right thing.
  const timer = setTimeout(done, 60000);
  window.addEventListener('afterprint', done);

  window.print();
}
