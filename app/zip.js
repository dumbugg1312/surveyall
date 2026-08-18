/**
 * SurveyAll — a ZIP writer, because a .pptx is a ZIP.
 *
 * This exists so the PowerPoint export costs nothing. The usual answer is
 * JSZip plus PptxGenJS, which is roughly 400KB of dependency, a build step
 * this repo does not have, and a supply chain to keep watching — all to
 * emit a container format that is ninety lines of arithmetic. The app has
 * no bundler and no runtime dependencies on purpose (see package.json);
 * this keeps it that way.
 *
 * Only the parts PowerPoint reads are implemented: one entry per file,
 * stored or deflated, no ZIP64, no encryption, no data descriptors. That
 * is the whole of what an Office Open XML package needs.
 *
 * Deflate comes from the platform's own CompressionStream. Where the
 * 'deflate-raw' format is missing — older Safari, older Node — every entry
 * falls back to STORE, which is a valid ZIP that PowerPoint opens happily.
 * It is simply larger, and a results deck is small either way.
 */

/** CRC-32, table built once. Every ZIP entry carries one. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function toBytes(data) {
  if (typeof data === 'string') return encoder.encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('zip: entry data must be a string, Uint8Array or ArrayBuffer');
}

/** Raw deflate, or null when the platform cannot do it. */
async function deflate(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  let stream;
  try {
    stream = new CompressionStream('deflate-raw');
  } catch {
    return null; // format not supported here — caller stores instead
  }
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * DOS date/time. ZIP predates the epoch everyone else uses, and stores
 * local time in two 16-bit halves with two-second resolution.
 */
function dosStamp(date) {
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

/**
 * Build a ZIP archive.
 *
 * @param {Array<{name: string, data: string|Uint8Array|ArrayBuffer, store?: boolean}>} entries
 *        `store: true` skips compression for an entry. [Content_Types].xml
 *        is tiny and read first by every consumer, so it is stored.
 * @param {{date?: Date}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function zip(entries, { date = new Date() } = {}) {
  const stamp = dosStamp(date);
  const prepared = [];

  for (const entry of entries) {
    const raw = toBytes(entry.data);
    const name = encoder.encode(entry.name);
    let body = raw;
    let method = 0;

    if (!entry.store && raw.length > 64) {
      const packed = await deflate(raw);
      // A deflate that grows the entry is a deflate not worth declaring.
      if (packed && packed.length < raw.length) { body = packed; method = 8; }
    }

    prepared.push({ name, body, method, crc: crc32(raw), size: raw.length });
  }

  const LOCAL = 30;
  const CENTRAL = 46;
  const END = 22;

  const total = prepared.reduce(
    (n, e) => n + LOCAL + e.name.length + e.body.length + CENTRAL + e.name.length, 0) + END;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;

  // ---------------------------------------------------- local headers
  for (const e of prepared) {
    e.offset = at;
    u32(view, at, 0x04034b50);
    u16(view, at + 4, 20);            // version needed: 2.0, the deflate floor
    u16(view, at + 6, 0x0800);        // bit 11: names are UTF-8
    u16(view, at + 8, e.method);
    u16(view, at + 10, stamp.time);
    u16(view, at + 12, stamp.date);
    u32(view, at + 14, e.crc);
    u32(view, at + 18, e.body.length);
    u32(view, at + 22, e.size);
    u16(view, at + 26, e.name.length);
    u16(view, at + 28, 0);            // no extra field
    at += LOCAL;
    out.set(e.name, at); at += e.name.length;
    out.set(e.body, at); at += e.body.length;
  }

  // ------------------------------------------------ central directory
  const dirAt = at;
  for (const e of prepared) {
    u32(view, at, 0x02014b50);
    u16(view, at + 4, 20);            // version made by
    u16(view, at + 6, 20);            // version needed
    u16(view, at + 8, 0x0800);
    u16(view, at + 10, e.method);
    u16(view, at + 12, stamp.time);
    u16(view, at + 14, stamp.date);
    u32(view, at + 16, e.crc);
    u32(view, at + 20, e.body.length);
    u32(view, at + 24, e.size);
    u16(view, at + 28, e.name.length);
    u16(view, at + 30, 0);            // extra
    u16(view, at + 32, 0);            // comment
    u16(view, at + 34, 0);            // disk number
    u16(view, at + 36, 0);            // internal attrs
    u32(view, at + 38, 0);            // external attrs
    u32(view, at + 42, e.offset);
    at += CENTRAL;
    out.set(e.name, at); at += e.name.length;
  }

  // ------------------------------------------------- end of directory
  u32(view, at, 0x06054b50);
  u16(view, at + 4, 0);
  u16(view, at + 6, 0);
  u16(view, at + 8, prepared.length);
  u16(view, at + 10, prepared.length);
  u32(view, at + 12, at - dirAt);
  u32(view, at + 16, dirAt);
  u16(view, at + 20, 0);              // no archive comment

  return out;
}
