/**
 * WCAG 2.1 contrast audit over every built-in theme token pair and every
 * generated chart palette. Run: node tools/a11y-contrast.mjs [--json]
 *
 * Thresholds: 4.5 normal text, 3.0 large text (>=24px, or >=18.66px bold),
 * 3.0 non-text UI components and graphical objects (1.4.11).
 */
import { THEMES, getTheme } from '../app/themes.js';
import { luminance, hueWheel, harmonicSeries } from '../app/motion.js';

const ratio = (a, b) => {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
const hx=(h)=>{let x=String(h).replace('#','');if(x.length===3)x=[...x].map(c=>c+c).join('');const n=parseInt(x,16);return [(n>>16)&255,(n>>8)&255,n&255];};
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return '#'+A.map((v,i)=>Math.round(v*t+B[i]*(1-t)).toString(16).padStart(2,'0')).join('');};
const r2 = (n) => Math.round(n * 100) / 100;

// [label, fg token, bg token, required ratio, why]
const TEXT_PAIRS = [
  ['body ink on ground', '--ink', '--ground', 4.5],
  ['body ink on surface', '--ink', '--surface', 4.5],
  ['secondary ink-soft on ground', '--ink-soft', '--ground', 4.5],
  ['secondary ink-soft on surface', '--ink-soft', '--surface', 4.5],
  ['accent type on ground', '--accent-text', '--ground', 4.5],
  ['accent type on surface', '--accent-text', '--surface', 4.5],
  ['accent type on accent-soft chip', '--accent-text', '--accent-soft', 4.5],
  ['accent-2 type on ground', '--accent-2-text', '--ground', 4.5],
  ['accent-2 type on surface', '--accent-2-text', '--surface', 4.5],
  ['good type on surface', '--good-text', '--surface', 4.5],
  ['bad type on surface', '--bad-text', '--surface', 4.5],
  ['ink on accent-soft chip', '--ink', '--accent-soft', 4.5],
];

// The tinted chips: `color-mix(TOKEN n%, transparent)` behind type of that
// same colour. Checking only plain surfaces reports clean while these fail.
const CHIP_TINT = {
  '--accent': 0.20, '--accent-2': 0.18, '--good': 0.18, '--bad': 0.16, '--ink': 0.10,
};
const TINTED_PAIRS = [
  ['accent type on an accent wash', '--accent-text', '--accent'],
  ['accent-2 type on its own wash', '--accent-2-text', '--accent-2'],
  ['status text on a "correct" wash', '--good-text', '--good'],
  ['status text on a "wrong" wash', '--bad-text', '--bad'],
  ['secondary text on an ink wash', '--ink-soft', '--ink'],
];
const LITERAL_ON_ACCENT = [
  ['on-accent type on accent fill', '--on-accent', '--accent', 4.5],
  ['on-good type on good fill', '--on-good', '--good', 4.5],
  ['on-bad type on bad fill', '--on-bad', '--bad', 4.5],
];
const NONTEXT_PAIRS = [
  ['control border vs ground', '--edge-strong', '--ground', 3.0],
  ['control border vs surface', '--edge-strong', '--surface', 3.0],
  ['accent bar/fill vs ground', '--accent', '--ground', 3.0],
];

// Deliberately NOT checked: --accent-soft tints and the --surface/--ground
// step. 1.4.11 exempts purely decorative surfaces, and both are read
// through the text and borders drawn on top of them, never on their own.

const val = (t, k) => (k.startsWith('#') ? k : t.tokens[k]);
const rows = [];

for (const id of Object.keys(THEMES)) {
  const theme = getTheme(id);
  const push = (kind, label, fg, bg, need) => {
    const c = ratio(val(theme, fg), val(theme, bg));
    rows.push({
      theme: id, name: theme.name, kind, label, need,
      fg: val(theme, fg), bg: val(theme, bg), ratio: r2(c),
      pass: c >= need,
      passLarge: kind === 'text' ? c >= 3 : null,
    });
  };
  for (const [l, f, b, n] of TEXT_PAIRS) push('text', l, f, b, n);
  for (const [l, f, b, n] of LITERAL_ON_ACCENT) push('text', l, f, b, n);
  for (const [l, f, b, n] of NONTEXT_PAIRS) push('nontext', l, f, b, n);

  for (const [label, fg, base] of TINTED_PAIRS) {
    const bg = mix(theme.tokens[base], theme.tokens['--surface'], CHIP_TINT[base]);
    const c = ratio(theme.tokens[fg], bg);
    rows.push({
      theme: id, name: theme.name, kind: 'text', label, need: 4.5,
      fg: theme.tokens[fg], bg, ratio: r2(c), pass: c >= 4.5, passLarge: c >= 3,
    });
  }

  // focus ring: a solid --accent outline, so what matters is the accent
  // against whatever the control sits on. 2.4.7/1.4.11 want 3:1.
  for (const under of ['--ground', '--surface']) {
    const bg = theme.tokens[under];
    const ring = theme.tokens['--accent'];
    const c = ratio(ring, bg);
    rows.push({
      theme: id, name: theme.name, kind: 'nontext',
      label: `focus ring over ${under.slice(2)}`, need: 3.0,
      fg: ring, bg, ratio: r2(c), pass: c >= 3.0, passLarge: null,
    });
  }

  // chart palettes — graphical objects, need 3.0 against the ground
  const g = theme.tokens['--ground'];
  for (const count of [2, 4, 6, 8, 12]) {
    hueWheel(theme.tokens['--accent'], count, g).forEach((c, i) => {
      const cr = ratio(c, g);
      rows.push({
        theme: id, name: theme.name, kind: 'chart',
        label: `hueWheel n=${count} #${i + 1}`, need: 3.0,
        fg: c, bg: g, ratio: r2(cr), pass: cr >= 3.0, passLarge: null,
      });
    });
    harmonicSeries(theme.tokens['--accent'], theme.tokens['--accent-2'], count, g)
      .forEach((c, i) => {
        const cr = ratio(c, g);
        rows.push({
          theme: id, name: theme.name, kind: 'chart',
          label: `harmonic n=${count} #${i + 1}`, need: 3.0,
          fg: c, bg: g, ratio: r2(cr), pass: cr >= 3.0, passLarge: null,
        });
      });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  const fails = rows.filter((r) => !r.pass);
  const byTheme = new Map();
  for (const f of fails) {
    if (!byTheme.has(f.theme)) byTheme.set(f.theme, []);
    byTheme.get(f.theme).push(f);
  }
  console.log(`${rows.length} checks, ${fails.length} failures across ${byTheme.size}/${Object.keys(THEMES).length} themes\n`);
  for (const [id, list] of byTheme) {
    const chart = list.filter((f) => f.kind === 'chart');
    const rest = list.filter((f) => f.kind !== 'chart');
    console.log(`## ${id}`);
    for (const f of rest) {
      const tag = f.kind === 'text' && f.ratio >= 3 ? 'AA-large-only' : 'FAIL';
      console.log(`  ${tag.padEnd(14)} ${f.ratio.toFixed(2)}:1 (need ${f.need}) ${f.label}  ${f.fg} on ${f.bg}`);
    }
    if (chart.length) {
      const worst = chart.reduce((a, b) => (a.ratio < b.ratio ? a : b));
      console.log(`  CHART          ${chart.length} palette swatches under 3:1 (worst ${worst.ratio.toFixed(2)}:1 — ${worst.label} ${worst.fg})`);
    }
    console.log('');
  }
}
