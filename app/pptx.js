/**
 * SurveyAll — PowerPoint writer.
 *
 * Builds a real .pptx from the export model: native text boxes, native
 * rectangles, native tables. Nothing here is a screenshot.
 *
 * WHY NATIVE SHAPES. The easy version of this feature pastes a picture of
 * each chart onto a slide. It looks right and it is useless: an instructor
 * who wants two of these slides inside their own lecture deck cannot
 * change a word, cannot recolour a bar to match their template, and cannot
 * make the type bigger for a bigger room. Rectangles and text runs cost
 * more code and produce a file someone can actually work with — and, as a
 * side effect, a 40KB deck instead of a 12MB one.
 *
 * WHY IT LOOKS LIKE THE SESSION. Colours are read from the deck's own
 * theme tokens and the display face is the deck's display face, so an
 * export of a Chalkboard deck arrives in chalk. PowerPoint substitutes a
 * font it does not have, which is the normal, visible failure — the
 * alternative, forcing Calibri on everyone, fails invisibly.
 *
 * The OOXML here is the minimum a presentation needs: one master, one
 * layout, one theme, a notes master, and a slide per entry. No
 * placeholders are inherited — every shape is positioned absolutely —
 * because inheritance is where minimal decks usually break in Keynote and
 * Google Slides.
 */

import { zip } from './zip.js';
import { getTheme } from './themes.js';

// EMU — English Metric Units, 914400 to the inch. OOXML measures
// everything in them.
const EMU = 914400;
const inch = (n) => Math.round(n * EMU);

/**
 * 16:9 widescreen, the shape every projector in a classroom is.
 *
 * The EMU figures are exact and are PowerPoint's own; the slide is 13⅓
 * inches, not 13.333. Deriving them with inch(13.333) lands 1735 EMU wide
 * of the standard, which is invisible on screen and is exactly the kind
 * of not-quite-standard size that makes a deck stop matching a template
 * it is pasted into.
 */
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

/** The same slide in inches, for the layout arithmetic below. */
const W_IN = SLIDE_W / EMU;
const H_IN = SLIDE_H / EMU;

const MARGIN = 0.62;
const CONTENT_W = W_IN - MARGIN * 2;

// Vertical bands. Fixed rather than flowed: a deck whose titles sit at
// different heights page to page reads as broken, even when each page is
// individually well laid out.
const KICKER_Y = 0.42;
const TITLE_Y = 0.78;
const TITLE_H = 1.15;
const BODY_Y = 2.08;
const BODY_H = 4.42;
const FOOT_Y = 6.62;

// =====================================================================
// XML plumbing
// =====================================================================

/**
 * Control characters are legal in a student's typed answer and illegal in
 * XML 1.0. Stripping them is the only option that still opens: a .pptx
 * with a raw 0x0B in a text run is not a repairable file, it is a file
 * PowerPoint refuses.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

function esc(s) {
  return String(s ?? '')
    .replace(XML_ILLEGAL, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

/**
 * A CSS colour token to a bare RRGGBB.
 *
 * Themes store plain hex, but a custom theme is built from user input and
 * a deck saved by a future version could hold anything, so an unreadable
 * token falls back rather than writing a malformed file.
 */
function hex(value, fallback = '000000') {
  const s = String(value ?? '').trim();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split('').map((c) => c + c).join('').toUpperCase();
  return fallback;
}

/**
 * The first real family out of a CSS font stack.
 *
 * `--display` is a full stack ("'Fraunces','Iowan Old Style',…,serif").
 * PowerPoint wants one name, and the first is the one the deck was
 * designed in.
 */
function family(stack, fallback) {
  const first = String(stack || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return first && !/^(serif|sans-serif|cursive|monospace|system-ui)$/i.test(first)
    ? first : fallback;
}

let shapeId = 0;
const nextId = () => (shapeId += 1) + 1; // 1 belongs to the slide's own group

/** A positioned shape frame, in inches. */
function xfrm(x, y, w, h) {
  return `<a:xfrm><a:off x="${inch(x)}" y="${inch(y)}"/>`
    + `<a:ext cx="${inch(w)}" cy="${inch(h)}"/></a:xfrm>`;
}

/**
 * One text box.
 *
 * `fit: 'shrink'` turns on PowerPoint's own autofit. A prompt is typed by
 * an instructor with no character limit, so the title box has to be
 * allowed to shrink rather than overflow into the chart.
 */
function textBox(opts) {
  const {
    x, y, w, h, runs, align = 'l', anchor = 't', wrap = true,
    fit = 'none', spacing = 100,
  } = opts;

  const paragraphs = (Array.isArray(runs[0]) ? runs : [runs]).map((para) => {
    const body = para.map((r) => {
      const props = [
        'lang="en-US"',
        `sz="${Math.round(r.size * 100)}"`,
        r.bold ? 'b="1"' : '',
        r.italic ? 'i="1"' : '',
        'dirty="0"',
      ].filter(Boolean).join(' ');
      const font = r.font
        ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : '';
      return `<a:r><a:rPr ${props}><a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>`
        + `${font}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
    }).join('');
    const bullet = para.bullet
      ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>'
      : '<a:buNone/>';
    const indent = para.bullet ? ' marL="171450" indent="-171450"' : '';
    return `<a:p><a:pPr${indent} algn="${align}"><a:lnSpc><a:spcPct val="${spacing * 1000}"/></a:lnSpc>`
      + `<a:spcBef><a:spcPts val="0"/></a:spcBef>${bullet}</a:pPr>${body}</a:p>`;
  }).join('');

  const autofit = fit === 'shrink'
    ? '<a:normAutofit fontScale="92500" lnSpcReduction="10000"/>'
    : '<a:noAutofit/>';

  const id = nextId();
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/>`
    + '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
    + `<p:spPr>${xfrm(x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`
    + `<p:txBody><a:bodyPr wrap="${wrap ? 'square' : 'none'}" anchor="${anchor}" `
    + `lIns="0" tIns="0" rIns="0" bIns="0">${autofit}</a:bodyPr>`
    + `<a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

/** One filled rectangle — a bar, a track, a rule. */
function rect(x, y, w, h, color, { alpha = 100, radius = 0 } = {}) {
  const id = nextId();
  const fill = alpha >= 100
    ? `<a:srgbClr val="${color}"/>`
    : `<a:srgbClr val="${color}"><a:alpha val="${Math.round(alpha * 1000)}"/></a:srgbClr>`;
  // roundRect with an adjusted radius reads as the app's own --bar-radius
  // without having to compute a path.
  const geom = radius
    ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${radius}"/></a:avLst></a:prstGeom>`
    : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Bar ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${xfrm(x, y, Math.max(w, 0.012), h)}${geom}`
    + `<a:solidFill>${fill}</a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>`
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';
}

/** A native PowerPoint table — editable, sortable, restyleable. */
function table(x, y, w, h, columns, rows, palette) {
  const id = nextId();
  // Weighted columns: the first carries the item and needs room, the
  // numeric tail does not.
  const weights = columns.map((_, i) => (i === 0 ? 2.1 : 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((n) => Math.round((n / sum) * inch(w)));

  const rowH = Math.max(inch(0.3), Math.min(inch(0.46), inch(h) / (rows.length + 1)));

  const cell = (text, { head = false, first = false } = {}) =>
    `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${first || head ? 'l' : 'ctr'}"/>`
    + `<a:r><a:rPr lang="en-US" sz="${head ? 1150 : 1250}" b="${head ? 1 : 0}">`
    + `<a:solidFill><a:srgbClr val="${head ? palette.inkSoft : palette.ink}"/></a:solidFill>`
    + `<a:latin typeface="${esc(palette.body)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></a:txBody>`
    + '<a:tcPr marL="82550" marR="82550" marT="41275" marB="41275" anchor="ctr">'
    + `<a:lnB w="6350" cap="flat"><a:solidFill><a:srgbClr val="${palette.edge}"/></a:solidFill></a:lnB>`
    + '<a:noFill/></a:tcPr></a:tc>';

  const head = `<a:tr h="${rowH}">${columns.map((c) => cell(c, { head: true })).join('')}</a:tr>`;
  const body = rows.map((r) =>
    `<a:tr h="${rowH}">${r.map((c, i) => cell(c, { first: i === 0 })).join('')}</a:tr>`).join('');

  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/>`
    + '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>'
    + '<p:nvPr/></p:nvGraphicFramePr>'
    + `<p:xfrm><a:off x="${inch(x)}" y="${inch(y)}"/>`
    + `<a:ext cx="${inch(w)}" cy="${rowH * (rows.length + 1)}"/></p:xfrm>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">'
    + '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid>'
    + widths.map((cx) => `<a:gridCol w="${cx}"/>`).join('')
    + `</a:tblGrid>${head}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

// =====================================================================
// Body forms
// =====================================================================

/**
 * A ranked bar list.
 *
 * Every bar is drawn on a full-width track, so a 12% answer still shows a
 * bar's worth of context rather than a stub floating in white space —
 * the same reasoning the live chart uses.
 */
function drawBars(bars, palette) {
  if (!bars.length) return '';
  const labelW = 4.0;
  const noteW = 1.35;
  const gap = 0.18;
  const trackX = MARGIN + labelW + gap;
  const trackW = CONTENT_W - labelW - noteW - gap * 2;

  const rowH = Math.min(0.52, BODY_H / bars.length);
  const barH = Math.min(0.3, rowH * 0.58);
  const top = BODY_Y + Math.max(0, (BODY_H - rowH * bars.length) / 2);

  return bars.map((b, i) => {
    const y = top + i * rowH;
    const midY = y + (rowH - barH) / 2;
    const ratio = b.max ? Math.max(0, Math.min(1, b.value / b.max)) : 0;

    return [
      textBox({
        x: MARGIN, y, w: labelW, h: rowH, anchor: 'ctr',
        runs: [{
          text: b.label,
          size: bars.length > 8 ? 11 : 12.5,
          color: palette.ink,
          font: palette.body,
          bold: !!b.marked,
        }],
      }),
      rect(trackX, midY, trackW, barH, palette.edge, { alpha: 55, radius: 22000 }),
      rect(trackX, midY, trackW * ratio, barH, palette.tone(b.tone), { radius: 22000 }),
      b.note ? textBox({
        x: trackX + trackW + gap, y, w: noteW, h: rowH, anchor: 'ctr', align: 'r',
        runs: [{
          text: b.note,
          size: bars.length > 8 ? 10 : 11,
          color: palette.inkSoft,
          font: palette.body,
        }],
      }) : '',
    ].join('');
  }).join('');
}

/** Tug of war: one rope per pair, the split drawn where the room sat. */
function drawSplits(splits, palette) {
  if (!splits.length) return '';
  const rowH = Math.min(1.0, BODY_H / splits.length);
  const barH = Math.min(0.34, rowH * 0.34);
  const top = BODY_Y + Math.max(0, (BODY_H - rowH * splits.length) / 2);
  const half = CONTENT_W / 2;

  return splits.map((s, i) => {
    const y = top + i * rowH;
    const ratio = Math.max(0, Math.min(1, s.leftPct / 100));
    const barY = y + rowH * 0.46;

    return [
      textBox({
        x: MARGIN, y: y + rowH * 0.06, w: half - 0.1, h: rowH * 0.36, anchor: 'b',
        runs: [{ text: `${s.left} — ${s.leftCount}`, size: 12, color: palette.ink, font: palette.body }],
      }),
      textBox({
        x: MARGIN + half + 0.1, y: y + rowH * 0.06, w: half - 0.1, h: rowH * 0.36,
        anchor: 'b', align: 'r',
        runs: [{ text: `${s.rightCount} — ${s.right}`, size: 12, color: palette.ink, font: palette.body }],
      }),
      rect(MARGIN, barY, CONTENT_W * ratio, barH, palette.accent, { radius: 22000 }),
      rect(MARGIN + CONTENT_W * ratio, barY, CONTENT_W * (1 - ratio), barH,
        palette.accent2, { radius: 22000 }),
      // The centre mark is the point of the chart: it says where "torn"
      // would be, so a bar near it reads as a split room rather than a
      // near-win for whichever side happens to be longer.
      rect(MARGIN + half - 0.008, barY - 0.06, 0.016, barH + 0.12, palette.inkSoft, { alpha: 45 }),
    ].join('');
  }).join('');
}

/** A re-asked question: before as a ghost, after as the answer. */
function drawDeltas(rows, palette) {
  if (!rows.length) return '';
  const labelW = 3.7;
  const noteW = 1.5;
  const gap = 0.18;
  const trackX = MARGIN + labelW + gap;
  const trackW = CONTENT_W - labelW - noteW - gap * 2;

  const rowH = Math.min(0.62, BODY_H / rows.length);
  const barH = Math.min(0.15, rowH * 0.26);
  const top = BODY_Y + Math.max(0, (BODY_H - rowH * rows.length) / 2);

  return rows.map((r, i) => {
    const y = top + i * rowH;
    const beforeY = y + rowH / 2 - barH - 0.03;
    const afterY = y + rowH / 2 + 0.03;
    const move = r.deltaPct;
    const sign = move > 0.5 ? '+' : '';
    const tone = move > 0.5 ? palette.good : move < -0.5 ? palette.bad : palette.inkSoft;

    return [
      textBox({
        x: MARGIN, y, w: labelW, h: rowH, anchor: 'ctr',
        runs: [{ text: r.label, size: 12, color: palette.ink, font: palette.body }],
      }),
      rect(trackX, beforeY, trackW * (r.beforePct / 100), barH,
        palette.inkSoft, { alpha: 38, radius: 40000 }),
      rect(trackX, afterY, trackW * (r.afterPct / 100), barH,
        palette.accent, { radius: 40000 }),
      textBox({
        x: trackX + trackW + gap, y, w: noteW, h: rowH, anchor: 'ctr', align: 'r',
        runs: [{
          text: `${sign}${Math.round(move)} pts`,
          size: 11, color: tone, font: palette.body, bold: true,
        }],
      }),
    ].join('');
  }).join('');
}

/** Free text, one entry per bullet. */
function drawLines(lines, palette) {
  if (!lines.length) return '';
  // Type shrinks with the count rather than the list being cut: someone
  // reading a printed page would rather squint than be told that eleven
  // of the answers exist somewhere else.
  const size = lines.length > 20 ? 10 : lines.length > 12 ? 12 : lines.length > 7 ? 14 : 16;
  const paras = lines.map((l) => {
    const para = [{ text: l.text, size, color: palette.ink, font: palette.body }];
    if (l.note) {
      para.push({ text: `   ${l.note}`, size: size - 2, color: palette.inkSoft, font: palette.body });
    }
    para.bullet = true;
    return para;
  });
  return textBox({
    x: MARGIN, y: BODY_Y, w: CONTENT_W, h: BODY_H, runs: paras, spacing: 118,
  });
}

/** Free text under headings — the exit ticket's columns, side by side. */
function drawSections(sections, palette) {
  if (!sections.length) return '';
  const colW = (CONTENT_W - 0.4 * (sections.length - 1)) / sections.length;
  const size = sections.some((s) => s.lines.length > 6) ? 11 : 13;

  return sections.map((s, i) => {
    const x = MARGIN + i * (colW + 0.4);
    const paras = [[{
      text: s.label.toUpperCase(), size: 10.5, color: palette.accent,
      font: palette.body, bold: true,
    }]];
    s.lines.forEach((l) => {
      const para = [{ text: l.text, size, color: palette.ink, font: palette.body }];
      para.bullet = true;
      paras.push(para);
    });
    if (s.more) {
      paras.push([{
        text: `+${s.more} more in the CSV`, size: size - 1.5,
        color: palette.inkSoft, font: palette.body, italic: true,
      }]);
    }
    return textBox({ x, y: BODY_Y, w: colW, h: BODY_H, runs: paras, spacing: 116 });
  }).join('');
}

/** The cover's four numbers. */
function drawStats(stats, palette) {
  const colW = CONTENT_W / stats.length;
  return stats.map((s, i) => {
    const x = MARGIN + i * colW;
    return [
      textBox({
        x, y: BODY_Y + 0.5, w: colW - 0.3, h: 1.0, anchor: 'b',
        runs: [{
          text: s.value, size: 40, color: palette.accent,
          font: palette.display, bold: true,
        }],
      }),
      textBox({
        x, y: BODY_Y + 1.58, w: colW - 0.3, h: 0.4,
        runs: [{
          text: s.label.toUpperCase(), size: 11,
          color: palette.inkSoft, font: palette.body, bold: true,
        }],
      }),
    ].join('');
  }).join('');
}

// =====================================================================
// Slides
// =====================================================================

function slideXML(slide, palette, index, total) {
  shapeId = 0;
  const body = slide.body || {};
  const parts = [];

  // Background as a filled rectangle rather than <p:bg>, so the colour
  // survives being pasted into someone else's deck instead of picking up
  // that deck's master.
  parts.push(rect(0, 0, W_IN, H_IN, palette.ground));

  const kicker = slide.kind === 'cover'
    ? 'SurveyAll · session results'
    : [slide.number ? `Question ${slide.number}` : '', slide.subtitle].filter(Boolean).join(' · ');

  parts.push(textBox({
    x: MARGIN, y: KICKER_Y, w: CONTENT_W - 1.2, h: 0.3,
    runs: [{ text: kicker, size: 11.5, color: palette.inkSoft, font: palette.body, bold: true }],
  }));

  parts.push(textBox({
    x: MARGIN, y: TITLE_Y, w: CONTENT_W, h: TITLE_H, fit: 'shrink', spacing: 104,
    runs: [{
      text: slide.title,
      size: slide.kind === 'cover' ? 40 : 27,
      color: palette.ink,
      font: palette.display,
      bold: true,
    }],
  }));

  if (slide.kind === 'cover' && slide.subtitle) {
    parts.push(textBox({
      x: MARGIN, y: TITLE_Y + TITLE_H, w: CONTENT_W, h: 0.4,
      runs: [{ text: slide.subtitle, size: 16, color: palette.inkSoft, font: palette.body }],
    }));
  }

  // A hairline under the head — the same rule the letterpress theme draws.
  parts.push(rect(MARGIN, BODY_Y - 0.24, CONTENT_W, 0.012, palette.edge));

  switch (body.form) {
    case 'bars': parts.push(drawBars(body.bars, palette)); break;
    case 'splits': parts.push(drawSplits(body.splits, palette)); break;
    case 'deltas': parts.push(drawDeltas(body.rows, palette)); break;
    case 'lines': parts.push(drawLines(body.lines, palette)); break;
    case 'sections': parts.push(drawSections(body.sections, palette)); break;
    case 'stats': parts.push(drawStats(body.stats, palette)); break;
    case 'table':
      parts.push(table(MARGIN, BODY_Y, CONTENT_W, BODY_H, body.columns, body.rows, palette));
      break;
    default: break;
  }

  if (body.footnote) {
    parts.push(textBox({
      x: MARGIN, y: FOOT_Y, w: CONTENT_W - 1.6, h: 0.4,
      runs: [{ text: body.footnote, size: 10.5, color: palette.inkSoft, font: palette.body }],
    }));
  }

  parts.push(textBox({
    x: W_IN - MARGIN - 1.5, y: FOOT_Y, w: 1.5, h: 0.3, align: 'r',
    runs: [{ text: `${index} / ${total}`, size: 10, color: palette.inkSoft, font: palette.body }],
  }));

  return XML_HEAD
    + `<p:sld ${NS}>`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
    + '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    + parts.join('')
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
}

function notesXML(text) {
  const paras = String(text || '').split('\n').map((line) =>
    `<a:p><a:r><a:rPr lang="en-US" sz="1200" dirty="0"/><a:t>${esc(line)}</a:t></a:r></a:p>`).join('');
  return XML_HEAD
    + `<p:notes ${NS}>`
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr/>'
    + '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/>'
    + '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    + '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`
    + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>';
}

// =====================================================================
// Package scaffolding
// =====================================================================

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const CLR_MAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
  + 'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" '
  + 'hlink="hlink" folHlink="folHlink"';

function themeXML(palette) {
  const scheme = [
    ['dk1', palette.ink], ['lt1', palette.ground],
    ['dk2', palette.inkSoft], ['lt2', palette.surface],
    ['accent1', palette.accent], ['accent2', palette.accent2],
    ['accent3', palette.good], ['accent4', palette.bad],
    ['accent5', palette.edge], ['accent6', palette.inkSoft],
  ].map(([name, val]) => `<a:${name}><a:srgbClr val="${val}"/></a:${name}>`).join('');

  const font = (tag, name) =>
    `<a:${tag}><a:latin typeface="${esc(name)}"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;

  // A theme has to carry a format scheme even when nothing references it;
  // three entries is the schema's minimum for each list.
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const triple = (s) => s + s + s;

  return XML_HEAD
    + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SurveyAll">'
    + `<a:themeElements><a:clrScheme name="SurveyAll">${scheme}`
    + `<a:hlink><a:srgbClr val="${palette.accent}"/></a:hlink>`
    + `<a:folHlink><a:srgbClr val="${palette.accent2}"/></a:folHlink></a:clrScheme>`
    + '<a:fontScheme name="SurveyAll">'
    + font('majorFont', palette.display)
    + font('minorFont', palette.body)
    + '</a:fontScheme>'
    + '<a:fmtScheme name="SurveyAll">'
    + `<a:fillStyleLst>${triple(solid)}</a:fillStyleLst>`
    + '<a:lnStyleLst>'
    + `<a:ln w="6350">${solid}</a:ln><a:ln w="12700">${solid}</a:ln><a:ln w="19050">${solid}</a:ln>`
    + '</a:lnStyleLst>'
    + `<a:effectStyleLst>${triple('<a:effectStyle><a:effectLst/></a:effectStyle>')}</a:effectStyleLst>`
    + `<a:bgFillStyleLst>${triple(solid)}</a:bgFillStyleLst>`
    + '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
}

function emptyTree() {
  return '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
    + '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
}

function masterXML() {
  return XML_HEAD
    + `<p:sldMaster ${NS}><p:cSld>${emptyTree()}</p:cSld>`
    + `<p:clrMap ${CLR_MAP}/>`
    + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';
}

function layoutXML() {
  return XML_HEAD
    + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree()}</p:cSld>`
    + '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
}

/**
 * The notes master needs a real body placeholder.
 *
 * Each notes slide declares `<p:ph type="body" idx="1"/>`, and a
 * placeholder that inherits from nothing is what makes PowerPoint offer
 * to repair the file. The geometry is the standard notes page: the lower
 * two-thirds of a portrait sheet.
 */
function notesMasterXML() {
  const body = '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/>'
    + '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>'
    + '<p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>'
    + '<p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm>'
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
    + '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>';

  const tree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
    + '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
    + `<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree>`;

  return XML_HEAD
    + `<p:notesMaster ${NS}><p:cSld>${tree}</p:cSld>`
    + `<p:clrMap ${CLR_MAP}/></p:notesMaster>`;
}

function rels(list) {
  return XML_HEAD
    + `<Relationships xmlns="${PKG_REL}">`
    + list.map((r, i) =>
      `<Relationship Id="${r.id || `rId${i + 1}`}" Type="${REL}/${r.type}" Target="${r.target}"/>`).join('')
    + '</Relationships>';
}

function contentTypes(n) {
  const P = 'application/vnd.openxmlformats-officedocument.presentationml';
  const slides = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${P}.slide+xml"/>`
    + `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" `
    + `ContentType="${P}.notesSlide+xml"/>`).join('');
  return XML_HEAD
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" '
    + 'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + `<Override PartName="/ppt/presentation.xml" ContentType="${P}.presentation.main+xml"/>`
    + `<Override PartName="/ppt/presProps.xml" ContentType="${P}.presProps+xml"/>`
    + `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${P}.slideMaster+xml"/>`
    + `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${P}.slideLayout+xml"/>`
    + `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${P}.notesMaster+xml"/>`
    + '<Override PartName="/ppt/theme/theme1.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
    + slides
    + '<Override PartName="/docProps/core.xml" '
    + 'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>';
}

function presentationXML(n) {
  const ids = Array.from({ length: n }, (_, i) =>
    `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  return XML_HEAD
    + `<p:presentation ${NS} saveSubsetFonts="1">`
    + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
    + `<p:notesMasterIdLst><p:notesMasterId r:id="rId${n + 2}"/></p:notesMasterIdLst>`
    + `<p:sldIdLst>${ids}</p:sldIdLst>`
    + `<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/>`
    // Notes pages are portrait — the slide's dimensions, swapped.
    + `<p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/>`
    + '</p:presentation>';
}

/** Presentation relationships: master, then every slide, then the rest. */
export function presentationRels(n) {
  const list = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }];
  for (let i = 0; i < n; i += 1) {
    list.push({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` });
  }
  list.push({ id: `rId${n + 2}`, type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
  list.push({ id: `rId${n + 3}`, type: 'presProps', target: 'presProps.xml' });
  list.push({ id: `rId${n + 4}`, type: 'theme', target: 'theme/theme1.xml' });
  return rels(list);
}

function coreXML(title, subject, now) {
  return XML_HEAD
    + '<cp:coreProperties '
    + 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
    + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${esc(title)}</dc:title>`
    + `<dc:subject>${esc(subject)}</dc:subject>`
    // No dc:creator. The instructor's name is not in this file. An export
    // that quietly stamps an author into document properties is exactly
    // the kind of thing this app promises not to do.
    + '<cp:revision>1</cp:revision>'
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>`
    + '</cp:coreProperties>';
}

function appXML(slides) {
  const titles = slides.map((s) => `<vt:lpstr>${esc(s.title)}</vt:lpstr>`).join('');
  return XML_HEAD
    + '<Properties '
    + 'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
    + 'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + `<Application>SurveyAll</Application><Slides>${slides.length}</Slides>`
    + `<TitlesOfParts><vt:vector size="${slides.length}" baseType="lpstr">${titles}`
    + '</vt:vector></TitlesOfParts>'
    + '</Properties>';
}

// =====================================================================

/**
 * Build the parts of a .pptx for one archived session.
 *
 * Split out from buildPPTX so tests can read the XML without unzipping.
 *
 * @param {Array}  slides  from buildExportSlides()
 * @param {object} meta    {title, subject, themeId, date}
 * @returns {Array<{name: string, data: string, store?: boolean}>}
 */
export function pptxParts(slides, { title = 'Session results', subject = '', themeId, date = new Date() } = {}) {
  const t = getTheme(themeId).tokens || {};

  const palette = {
    ink: hex(t['--ink'], '1C2434'),
    inkSoft: hex(t['--ink-soft'], '5A6474'),
    ground: hex(t['--ground'], 'FFFFFF'),
    surface: hex(t['--surface'], 'F8FAFC'),
    edge: hex(t['--edge'], 'DFE3EA'),
    accent: hex(t['--accent'], '4A5D23'),
    accent2: hex(t['--accent-2'], 'B45309'),
    good: hex(t['--good'], '15803D'),
    bad: hex(t['--bad'], 'B91C1C'),
    display: family(t['--display'], 'Georgia'),
    body: family(t['--body'], 'Calibri'),
  };
  palette.tone = (name) => (
    name === 'good' ? palette.good
      : name === 'bad' ? palette.bad
        : name === 'soft' ? palette.inkSoft
          : palette.accent);

  const now = date.toISOString().replace(/\.\d+Z$/, 'Z');

  const files = [
    { name: '[Content_Types].xml', store: true, data: contentTypes(slides.length) },
    {
      name: '_rels/.rels',
      store: true,
      data: rels([
        { type: 'officeDocument', target: 'ppt/presentation.xml' },
        { type: 'metadata/core-properties', target: 'docProps/core.xml' },
        { type: 'extended-properties', target: 'docProps/app.xml' },
      ]),
    },
    { name: 'docProps/core.xml', data: coreXML(title, subject, now) },
    { name: 'docProps/app.xml', data: appXML(slides) },
    { name: 'ppt/presentation.xml', data: presentationXML(slides.length) },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels(slides.length) },
    { name: 'ppt/presProps.xml', data: `${XML_HEAD}<p:presentationPr ${NS}/>` },
    { name: 'ppt/theme/theme1.xml', data: themeXML(palette) },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: masterXML() },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: rels([
        { type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { type: 'theme', target: '../theme/theme1.xml' },
      ]),
    },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layoutXML() },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: rels([{ type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]),
    },
    { name: 'ppt/notesMasters/notesMaster1.xml', data: notesMasterXML() },
    {
      name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels',
      data: rels([{ type: 'theme', target: '../theme/theme1.xml' }]),
    },
  ];

  slides.forEach((slide, i) => {
    const n = i + 1;
    files.push({
      name: `ppt/slides/slide${n}.xml`,
      data: slideXML(slide, palette, n, slides.length),
    });
    files.push({
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: rels([
        { type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
        { type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` },
      ]),
    });
    files.push({ name: `ppt/notesSlides/notesSlide${n}.xml`, data: notesXML(slide.notes) });
    files.push({
      name: `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
      data: rels([
        { type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' },
        { type: 'slide', target: `../slides/slide${n}.xml` },
      ]),
    });
  });

  return files;
}

/**
 * Build a .pptx for one archived session.
 *
 * @returns {Promise<Blob>}
 */
export async function buildPPTX(slides, meta = {}) {
  const bytes = await zip(pptxParts(slides, meta), { date: meta.date });
  return new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
