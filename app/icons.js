/**
 * SurveyAll — the editor's icon set.
 *
 * Two families, both drawn on a 24×24 grid in one weight so they read as
 * a set rather than as clip-art:
 *
 *   TYPE_ICONS   one per question type, for the type picker
 *   CHART_ICONS  one per chart style, for the style row
 *
 * Everything is `currentColor`, so an icon takes the colour of whatever
 * it sits in — active tab, disabled control, dark theme — with no
 * per-context variants to keep in step.
 *
 * A chart icon is a PICTURE OF THE CHART IT SELECTS. That sounds obvious
 * and is the entire point of the row: the instructor is choosing between
 * four shapes, and four little shapes decide it faster than four words
 * ever will. It also means an icon here is a promise — if the renderer
 * cannot draw that shape, the icon must not exist. See CHART_STYLES in
 * themes.js, which is the list these are keyed to.
 */

const NS = 'http://www.w3.org/2000/svg';

/**
 * Build an <svg> from a path string.
 * innerHTML is safe here and below: every `d` in this file is a literal,
 * none of it is ever assembled from anything a user typed.
 */
export function icon(markup, cls) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'currentColor');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = markup;
  return s;
}

// =====================================================================
// Chart styles
// =====================================================================

export const CHART_ICONS = {
  // three horizontal bars of different lengths — the default result view
  bars: '<rect x="3" y="5" width="15" height="3.6" rx="1.2"/>'
    + '<rect x="3" y="10.2" width="19" height="3.6" rx="1.2"/>'
    + '<rect x="3" y="15.4" width="9" height="3.6" rx="1.2"/>',

  // the same data stood up: ascending columns on a shared baseline
  columns: '<rect x="3" y="13" width="4.6" height="8" rx="1.2"/>'
    + '<rect x="9.7" y="8" width="4.6" height="13" rx="1.2"/>'
    + '<rect x="16.4" y="3.5" width="4.6" height="17.5" rx="1.2"/>',

  // a ring with one segment stepped out, so it reads as parts-of-a-whole
  // rather than as a plain circle
  donut: '<path d="M12 2a10 10 0 1 0 9.8 12h-6.2A4 4 0 1 1 12 8.2V2z"/>'
    + '<path d="M13.6 2.15V8.4a4 4 0 0 1 2.9 3.1h6.25a10 10 0 0 0-9.15-9.35z"'
    + ' opacity=".55"/>',

  // one mark per person — the cluster IS the count
  dots: '<circle cx="8" cy="8" r="2.7"/><circle cx="16" cy="8" r="2.7"/>'
    + '<circle cx="8" cy="16" r="2.7"/><circle cx="16" cy="16" r="2.7"/>',
};

// =====================================================================
// Question types
// =====================================================================

export const TYPE_ICONS = {
  // a numbered list — the join steps
  instructions: '<circle cx="5" cy="6.5" r="1.8"/><rect x="9.5" y="5.2" width="11.5" height="2.6" rx="1.3"/>'
    + '<circle cx="5" cy="12" r="1.8"/><rect x="9.5" y="10.7" width="11.5" height="2.6" rx="1.3"/>'
    + '<circle cx="5" cy="17.5" r="1.8"/><rect x="9.5" y="16.2" width="8" height="2.6" rx="1.3"/>',

  // ascending columns: the shape a choice question makes
  multiple_choice: CHART_ICONS.columns,

  // words at three sizes, stacked the way a cloud settles
  word_cloud: '<rect x="2.5" y="4" width="11" height="4.2" rx="2.1"/>'
    + '<rect x="15" y="4.6" width="6.5" height="3" rx="1.5" opacity=".55"/>'
    + '<rect x="4.5" y="10.2" width="15" height="3.6" rx="1.8"/>'
    + '<rect x="2.5" y="15.8" width="7.5" height="3" rx="1.5" opacity=".55"/>'
    + '<rect x="11.5" y="15.4" width="10" height="3.8" rx="1.9"/>',

  // a speech bubble — someone writing back
  open_ended: '<path d="M4 3.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8.2L6.5 21.5V17.5H4A2.5 2.5 0 0 1 1.5 15V6A2.5 2.5 0 0 1 4 3.5z"/>',

  // a scale with its marker off centre
  scales: '<rect x="2" y="10.6" width="20" height="2.8" rx="1.4" opacity=".5"/>'
    + '<rect x="4.6" y="7" width="1.8" height="10" rx=".9"/>'
    + '<rect x="11.1" y="7" width="1.8" height="10" rx=".9"/>'
    + '<rect x="17.6" y="7" width="1.8" height="10" rx=".9"/>'
    + '<circle cx="15" cy="12" r="3.6"/>',

  // an ordered stack, longest first
  ranking: '<rect x="3" y="4.5" width="18" height="3.4" rx="1.7"/>'
    + '<rect x="3" y="10.3" width="13" height="3.4" rx="1.7"/>'
    + '<rect x="3" y="16.1" width="8" height="3.4" rx="1.7"/>',

  // a ticked answer
  quiz: '<path d="M12 1.8 2.5 6v6.4c0 5.3 3.9 9.3 9.5 10.8 5.6-1.5 9.5-5.5 9.5-10.8V6L12 1.8z"/>'
    + '<path d="m10.8 15.4-3.3-3.3 1.7-1.7 1.6 1.6 4.3-4.3 1.7 1.7-6 6z" fill="var(--surface,#fff)"/>',

  // opinion spread along a line
  spectrum: '<rect x="2" y="11" width="20" height="2" rx="1" opacity=".5"/>'
    + '<circle cx="5.5" cy="12" r="2.6"/><circle cx="11" cy="7.5" r="2.2" opacity=".7"/>'
    + '<circle cx="13.5" cy="16" r="2.4" opacity=".7"/><circle cx="18.5" cy="12" r="3"/>',

  // two samples, side by side, one picked
  sample_vote: '<rect x="2" y="4" width="8.8" height="16" rx="2"/>'
    + '<rect x="13.2" y="4" width="8.8" height="16" rx="2" opacity=".45"/>',

  // lines of a passage with one stretch marked
  heatmap: '<rect x="2.5" y="5" width="19" height="2.8" rx="1.4" opacity=".45"/>'
    + '<rect x="2.5" y="10.6" width="12.5" height="2.8" rx="1.4"/>'
    + '<rect x="16.5" y="10.6" width="5" height="2.8" rx="1.4" opacity=".45"/>'
    + '<rect x="2.5" y="16.2" width="19" height="2.8" rx="1.4" opacity=".45"/>',

  // the lantern itself, amber lit
  traffic: '<rect x="6.5" y="1.5" width="11" height="21" rx="4"/>'
    + '<circle cx="12" cy="6.6" r="2.5" fill="var(--surface,#fff)" opacity=".45"/>'
    + '<circle cx="12" cy="12" r="2.5" fill="var(--surface,#fff)"/>'
    + '<circle cx="12" cy="17.4" r="2.5" fill="var(--surface,#fff)" opacity=".45"/>',

  // weather, not faces — the room reports on the day, not on itself
  mood: '<circle cx="8.4" cy="8.4" r="4.4"/>'
    + '<path d="M17.4 21.5H9.2a4.2 4.2 0 0 1-.5-8.4 5.4 5.4 0 0 1 10.2 1 3.7 3.7 0 0 1-1.5 7.4z" opacity=".5"/>',

  // two either/ors, a side taken on each
  this_or_that: '<rect x="2" y="4.4" width="9" height="6" rx="3"/>'
    + '<rect x="13" y="4.4" width="9" height="6" rx="3" opacity=".35"/>'
    + '<rect x="2" y="13.6" width="9" height="6" rx="3" opacity=".35"/>'
    + '<rect x="13" y="13.6" width="9" height="6" rx="3"/>',

  // one pot, divided unevenly — the trade-off made visible
  budget: '<rect x="2" y="8.4" width="9.5" height="7.2" rx="2"/>'
    + '<rect x="12.6" y="8.4" width="5.6" height="7.2" rx="2" opacity=".6"/>'
    + '<rect x="19.3" y="8.4" width="2.7" height="7.2" rx="1.35" opacity=".35"/>',

  // a distribution with its long tail
  probability: '<path d="M2 19.5c4.2 0 4.6-13 10-13s5.8 13 10 13z" opacity=".45"/>'
    + '<rect x="2" y="19.2" width="20" height="2.3" rx="1.15"/>'
    + '<rect x="11" y="7" width="2" height="12" rx="1"/>',

  // a line of prose with the word taken out
  cloze: '<rect x="2.5" y="5" width="19" height="2.8" rx="1.4" opacity=".45"/>'
    + '<rect x="2.5" y="10.6" width="6" height="2.8" rx="1.4" opacity=".45"/>'
    + '<rect x="10" y="9.8" width="7" height="4.4" rx="1.4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-dasharray="2.6 2"/>'
    + '<rect x="18.5" y="10.6" width="3" height="2.8" rx="1.4" opacity=".45"/>'
    + '<rect x="2.5" y="16.2" width="13" height="2.8" rx="1.4" opacity=".45"/>',

  // two columns, joined across
  matching: '<circle cx="4.6" cy="6" r="2.4"/><circle cx="19.4" cy="6" r="2.4" opacity=".5"/>'
    + '<circle cx="4.6" cy="12" r="2.4"/><circle cx="19.4" cy="12" r="2.4" opacity=".5"/>'
    + '<circle cx="4.6" cy="18" r="2.4"/><circle cx="19.4" cy="18" r="2.4" opacity=".5"/>'
    + '<path d="M7 6h10M7 12l10 6M7 18l10-6" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".7"/>',

  // events pegged along a line, in order
  timeline: '<rect x="2" y="11" width="20" height="2" rx="1" opacity=".45"/>'
    + '<circle cx="5" cy="12" r="3"/><circle cx="12" cy="12" r="3" opacity=".7"/>'
    + '<circle cx="19" cy="12" r="3" opacity=".45"/>'
    + '<rect x="4.2" y="4" width="1.6" height="4" rx=".8" opacity=".5"/>'
    + '<rect x="11.2" y="16" width="1.6" height="4" rx=".8" opacity=".5"/>',

  // a ticket, torn off on the way out
  exit_ticket: '<path d="M3 5.5h18a1.5 1.5 0 0 1 1.5 1.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 18v-3a2.5 2.5 0 0 0 0-5V7A1.5 1.5 0 0 1 3 5.5z"/>'
    + '<rect x="5" y="9.4" width="8" height="1.8" rx=".9" fill="var(--surface,#fff)"/>'
    + '<rect x="5" y="12.8" width="5.5" height="1.8" rx=".9" fill="var(--surface,#fff)" opacity=".7"/>',

  // a question coming from the room
  qa: '<path d="M4 3.5h16a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-8.2L6.5 21.5V17.5H4A2.5 2.5 0 0 1 1.5 15V6A2.5 2.5 0 0 1 4 3.5z" opacity=".45"/>'
    + '<path d="M12 6.2c-2 0-3.4 1.1-3.7 2.9h2.2c.2-.7.7-1.1 1.5-1.1.8 0 1.3.4 1.3 1.1 0 .6-.3.9-1.1 1.4-.9.6-1.3 1.2-1.3 2.2v.4h2.2v-.3c0-.6.2-.9 1-1.4 1-.6 1.5-1.3 1.5-2.4 0-1.7-1.4-2.8-3.6-2.8z"/>'
    + '<circle cx="12" cy="15.6" r="1.3"/>',
};

/** The glyph for a type, with a safe fallback for anything unmapped. */
export function typeIcon(type, cls) {
  return icon(TYPE_ICONS[type] || TYPE_ICONS.multiple_choice, cls);
}

export function chartIcon(style, cls) {
  return icon(CHART_ICONS[style] || CHART_ICONS.bars, cls);
}
