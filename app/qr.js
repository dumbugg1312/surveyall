/**
 * SurveyAll — QR rendering.
 *
 * Uses the well-tested `qrcode-generator` package rather than a
 * hand-rolled encoder: a subtly wrong QR code is a silent failure that
 * you'd only discover in front of a class. The library is vendored into
 * app/vendor/ (MIT) — it used to load from esm.sh at runtime, which made
 * the lobby QR quietly disappear whenever the CDN or the room's internet
 * hiccuped. The dynamic import and failure path remain so a broken file
 * still degrades to the printed join code rather than a broken page.
 */

import { contrastRatio } from './themes.js';

let qrcodeLib = null;
let loadFailed = false;

/**
 * A module colour that a camera can actually read.
 *
 * The QR is drawn in the deck's ink so it belongs to the theme, and it
 * always sits on a white plate so it stays scannable under projector
 * gamma. Those two rules fight on a dark theme: Chalkboard's ink is
 * #f2f5ef, which on white is a QR you can barely see and no phone will
 * decode. Five of the built-in themes are dark, so this was every one of
 * their lobby screens.
 *
 * Tint when the ink is dark enough to survive the plate; otherwise fall
 * back to near-black. Scannability wins over palette, every time.
 * @param {string} ink theme's --ink
 * @param {string} plate the background the modules are drawn on
 */
export function qrInk(ink, plate = '#ffffff') {
  const hex = String(ink || '').trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return '#111111';
  // 7:1 is WCAG AAA for text; a camera decoding at an angle in a bright
  // room wants at least that much separation.
  return contrastRatio(hex, plate) >= 7 ? hex : '#111111';
}

async function loadLib() {
  if (qrcodeLib) return qrcodeLib;
  if (loadFailed) return null;
  try {
    const mod = await import('./vendor/qrcode-generator.js');
    qrcodeLib = mod.default || mod;
    return qrcodeLib;
  } catch {
    loadFailed = true;
    return null;
  }
}

/**
 * Build an SVG string for `text`.
 * @returns {Promise<string|null>} null if the library could not load.
 */
export async function qrSVG(text, { dark = '#000000', light = '#ffffff', margin = 2 } = {}) {
  const lib = await loadLib();
  if (!lib) return null;

  // typeNumber 0 = pick the smallest version that fits; 'M' = ~15% recovery,
  // plenty for a screen and forgiving of a phone camera at an angle.
  const qr = lib(0, 'M');
  qr.addData(String(text));
  qr.make();

  const count = qr.getModuleCount();
  const size = count + margin * 2;
  const rects = [];

  for (let r = 0; r < count; r += 1) {
    let runStart = -1;
    for (let c = 0; c <= count; c += 1) {
      const on = c < count && qr.isDark(r, c);
      if (on && runStart === -1) runStart = c;
      if (!on && runStart !== -1) {
        rects.push(`<rect x="${runStart + margin}" y="${r + margin}" width="${c - runStart}" height="1"/>`);
        runStart = -1;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code to join">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<g fill="${dark}">${rects.join('')}</g></svg>`;
}

/** Render into a container, or mark it failed so the caller can degrade. */
export async function renderQR(el, text, opts) {
  if (!el) return false;
  const svg = await qrSVG(text, opts);
  if (!svg) {
    el.dataset.qrFailed = 'true';
    el.innerHTML = '';
    return false;
  }
  delete el.dataset.qrFailed;
  el.innerHTML = svg;
  return true;
}

/** Data URL, for printing a join slip. */
export async function qrDataURL(text, opts) {
  const svg = await qrSVG(text, opts);
  if (!svg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
