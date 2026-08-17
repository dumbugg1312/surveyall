/**
 * Builds app/elements-data.js — a curated teaching subset of Lucide (ISC).
 *
 * Lucide ships 2,000+ icons. Shipping all of them would turn the picker
 * into a search problem and the payload into a download; this file is the
 * curation, and it is the only place to add or rename an element.
 *
 * Run:
 *   cd /tmp && npm pack lucide-static && tar xzf lucide-static-*.tgz
 *   node tools/build-elements.mjs /tmp/package
 *
 * Then check the result in tests/elements-check.html before committing —
 * a Lucide upgrade can rename or redraw an icon, and the only way to know
 * a redraw still reads at projector size is to look at it.
 *
 * The annotation marks are NOT here. They are ours, hand-drawn, and live
 * in app/elements.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PKG_DIR = process.argv[2];
if (!PKG_DIR) {
  console.error('usage: node tools/build-elements.mjs <path to unpacked lucide-static>');
  process.exit(1);
}
const SRC = new URL(`file://${path.resolve(PKG_DIR)}/icons/`);
const PKG = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const OUT = new URL('../app/elements-data.js', import.meta.url);

/**
 * The catalog. `[id, label, tags]` — id is the Lucide file name and the
 * token that appears in a deck file, label is what the picker shows, tags
 * widen the search beyond the label ("maths" finds the calculator).
 */
const CATALOG = {
  science: ['Science & nature', [
    ['microscope', 'Microscope', 'lab biology science'],
    ['atom', 'Atom', 'physics chemistry nucleus'],
    ['flask-conical', 'Flask', 'chemistry lab experiment'],
    ['flask-round', 'Round flask', 'chemistry lab'],
    ['test-tube', 'Test tube', 'chemistry lab sample'],
    ['test-tube-diagonal', 'Test tube, tilted', 'chemistry lab'],
    ['dna', 'DNA', 'genetics biology helix'],
    ['telescope', 'Telescope', 'astronomy space observe'],
    ['magnet', 'Magnet', 'physics force'],
    ['thermometer', 'Thermometer', 'temperature heat physics'],
    ['rocket', 'Rocket', 'space launch physics'],
    ['orbit', 'Orbit', 'space planets astronomy'],
    ['eclipse', 'Eclipse', 'astronomy moon shadow'],
    ['radiation', 'Radiation', 'nuclear physics hazard'],
    ['biohazard', 'Biohazard', 'biology safety hazard'],
    ['leaf', 'Leaf', 'biology plant nature ecology'],
    ['sprout', 'Sprout', 'growth plant biology'],
    ['tree-pine', 'Pine tree', 'forest nature ecology'],
    ['tree-deciduous', 'Tree', 'forest nature ecology'],
    ['bug', 'Insect', 'biology entomology'],
    ['fish', 'Fish', 'biology marine'],
    ['bird', 'Bird', 'biology zoology'],
    ['dog', 'Dog', 'animal zoology'],
    ['cat', 'Cat', 'animal zoology'],
    ['rabbit', 'Rabbit', 'animal zoology'],
    ['turtle', 'Turtle', 'animal zoology'],
    ['snail', 'Snail', 'animal zoology slow'],
    ['mountain', 'Mountain', 'geography geology terrain'],
    ['mountain-snow', 'Snowy mountain', 'geography geology'],
    ['waves', 'Waves', 'ocean physics sound frequency'],
    ['cloud', 'Cloud', 'weather meteorology'],
    ['cloud-rain', 'Rain', 'weather meteorology'],
    ['sun', 'Sun', 'weather star energy'],
    ['sunrise', 'Sunrise', 'weather morning'],
    ['sunset', 'Sunset', 'weather evening'],
    ['moon', 'Moon', 'astronomy night'],
    ['star', 'Star', 'astronomy favourite'],
    ['snowflake', 'Snowflake', 'weather winter cold'],
    ['droplet', 'Droplet', 'water chemistry liquid'],
    ['droplets', 'Droplets', 'water chemistry liquid'],
    ['flame', 'Flame', 'fire heat energy'],
    ['wind', 'Wind', 'weather air'],
    ['zap', 'Lightning', 'electricity energy power physics'],
    ['globe', 'Globe', 'earth world geography'],
    ['earth', 'Earth', 'world planet geography'],
  ]],

  maths: ['Maths & shapes', [
    ['calculator', 'Calculator', 'maths math arithmetic'],
    ['sigma', 'Sigma', 'maths sum series statistics'],
    ['pi', 'Pi', 'maths geometry constant'],
    ['radical', 'Square root', 'maths radical surd'],
    ['variable', 'Variable', 'maths algebra'],
    ['divide', 'Divide', 'maths arithmetic'],
    ['plus', 'Plus', 'maths add arithmetic'],
    ['minus', 'Minus', 'maths subtract arithmetic'],
    ['equal', 'Equals', 'maths arithmetic'],
    ['percent', 'Percent', 'maths proportion statistics'],
    ['infinity', 'Infinity', 'maths limit'],
    ['binary', 'Binary', 'maths computing base two'],
    ['superscript', 'Superscript', 'maths power exponent'],
    ['subscript', 'Subscript', 'maths notation'],
    ['ruler', 'Ruler', 'measure geometry length'],
    ['spline', 'Curve', 'maths graph function bezier'],
    ['triangle', 'Triangle', 'shape geometry'],
    ['triangle-right', 'Right triangle', 'shape geometry'],
    ['square', 'Square', 'shape geometry'],
    ['circle', 'Circle', 'shape geometry'],
    ['pentagon', 'Pentagon', 'shape geometry'],
    ['hexagon', 'Hexagon', 'shape geometry'],
    ['octagon', 'Octagon', 'shape geometry'],
    ['diamond', 'Diamond', 'shape geometry rhombus'],
    ['shapes', 'Shapes', 'geometry forms'],
  ]],

  humanities: ['Humanities & arts', [
    ['book', 'Book', 'reading literature text'],
    ['book-open', 'Open book', 'reading literature study'],
    ['book-marked', 'Bookmarked book', 'reading reference'],
    ['library', 'Library', 'books research reference'],
    ['scroll', 'Scroll', 'history ancient document'],
    ['scroll-text', 'Written scroll', 'history ancient document'],
    ['feather', 'Quill', 'writing author literature'],
    ['pen-tool', 'Pen tool', 'writing design vector'],
    ['pen-line', 'Pen', 'writing note'],
    ['pencil', 'Pencil', 'writing draft edit'],
    ['quote', 'Quotation', 'citation literature source'],
    ['languages', 'Languages', 'translation linguistics'],
    ['drama', 'Theatre masks', 'drama arts performance'],
    ['theater', 'Theatre', 'drama arts stage'],
    ['music', 'Music', 'note sound arts'],
    ['guitar', 'Guitar', 'music instrument arts'],
    ['piano', 'Piano', 'music instrument arts'],
    ['mic', 'Microphone', 'speech audio podcast'],
    ['palette', 'Palette', 'art colour painting'],
    ['paintbrush', 'Paintbrush', 'art painting'],
    ['brush', 'Brush', 'art painting'],
    ['landmark', 'Landmark', 'government history civics institution'],
    ['gavel', 'Gavel', 'law justice court civics'],
    ['scale', 'Scales of justice', 'law ethics balance fairness'],
    ['crown', 'Crown', 'monarchy history power'],
    ['swords', 'Swords', 'history conflict war'],
    ['castle', 'Castle', 'history medieval'],
    ['map', 'Map', 'geography navigation'],
    ['map-pin', 'Map pin', 'geography location place'],
    ['compass', 'Compass', 'navigation geography direction'],
    ['anchor', 'Anchor', 'maritime navigation'],
  ]],

  classroom: ['Classroom', [
    ['graduation-cap', 'Graduation cap', 'school student degree education'],
    ['school', 'School', 'education building'],
    ['backpack', 'Backpack', 'school student'],
    ['apple', 'Apple', 'teacher school fruit'],
    ['clock', 'Clock', 'time schedule'],
    ['timer', 'Timer', 'time countdown'],
    ['hourglass', 'Hourglass', 'time waiting'],
    ['calendar', 'Calendar', 'date schedule'],
    ['calendar-days', 'Calendar month', 'date schedule'],
    ['clipboard', 'Clipboard', 'notes assessment'],
    ['clipboard-list', 'Checklist', 'notes assessment tasks'],
    ['notebook', 'Notebook', 'notes writing'],
    ['notebook-pen', 'Notebook and pen', 'notes writing'],
    ['sticky-note', 'Sticky note', 'reminder notes'],
    ['highlighter', 'Highlighter', 'annotate mark notes'],
    ['eraser', 'Eraser', 'undo correct'],
    ['folder', 'Folder', 'files organise'],
    ['folder-open', 'Open folder', 'files organise'],
    ['paperclip', 'Paperclip', 'attachment'],
    ['pin', 'Pin', 'attach remember'],
    ['lightbulb', 'Lightbulb', 'idea insight understand'],
    ['brain', 'Brain', 'thinking cognition psychology memory'],
    ['users', 'Group', 'people class team pairs'],
    ['user', 'Person', 'individual student'],
    ['message-circle', 'Discussion', 'talk chat comment'],
    ['message-circle-question', 'Question', 'ask query doubt'],
    ['megaphone', 'Megaphone', 'announce attention'],
    ['presentation', 'Presentation', 'slides lecture'],
    ['projector', 'Projector', 'slides lecture av'],
    ['monitor', 'Monitor', 'screen computer'],
    ['laptop', 'Laptop', 'computer device'],
    ['keyboard', 'Keyboard', 'typing input'],
    ['printer', 'Printer', 'handout paper'],
    ['bell', 'Bell', 'alert reminder time'],
    ['award', 'Award', 'achievement prize'],
    ['trophy', 'Trophy', 'winner achievement competition'],
    ['medal', 'Medal', 'achievement prize rank'],
    ['target', 'Target', 'goal objective aim outcome'],
    ['flag', 'Flag', 'milestone mark goal'],
    ['heart', 'Heart', 'like care wellbeing'],
    ['thumbs-up', 'Thumbs up', 'agree approve like'],
    ['hand', 'Raised hand', 'volunteer ask participate'],
    ['smile', 'Smile', 'happy feedback mood'],
    ['meh', 'Neutral face', 'unsure feedback mood'],
    ['frown', 'Frown', 'unhappy confused feedback mood'],
  ]],

  computing: ['Computing & data', [
    ['code', 'Code', 'programming syntax'],
    ['code-xml', 'Markup', 'html programming'],
    ['terminal', 'Terminal', 'command line shell'],
    ['cpu', 'Processor', 'hardware computing'],
    ['database', 'Database', 'data storage sql'],
    ['server', 'Server', 'hosting backend'],
    ['git-branch', 'Branch', 'version control fork path'],
    ['git-merge', 'Merge', 'version control join'],
    ['network', 'Network', 'nodes graph connections'],
    ['workflow', 'Workflow', 'process steps pipeline'],
    ['list-tree', 'Tree', 'hierarchy structure taxonomy'],
    ['wifi', 'Wi-Fi', 'network signal'],
    ['bot', 'Robot', 'ai automation'],
    ['lock', 'Lock', 'security privacy'],
    ['key', 'Key', 'access security answer'],
    ['shield', 'Shield', 'protection security'],
  ]],

  health: ['Health & body', [
    ['heart-pulse', 'Heartbeat', 'health medicine pulse'],
    ['stethoscope', 'Stethoscope', 'medicine doctor nursing'],
    ['activity', 'Vital signs', 'health monitor pulse data'],
    ['pill', 'Pill', 'medicine pharmacy'],
    ['syringe', 'Syringe', 'medicine vaccine'],
    ['bone', 'Bone', 'anatomy skeleton'],
    ['hospital', 'Hospital', 'medicine care building'],
    ['cross', 'Medical cross', 'first aid health'],
  ]],

  money: ['Money & society', [
    ['coins', 'Coins', 'money economics currency'],
    ['banknote', 'Banknote', 'money economics currency'],
    ['hand-coins', 'Paying', 'money economics transaction'],
    ['piggy-bank', 'Savings', 'money economics saving'],
    ['wallet', 'Wallet', 'money personal finance'],
    ['receipt', 'Receipt', 'money transaction record'],
    ['shopping-cart', 'Shopping cart', 'consumer demand economics'],
    ['trending-up', 'Trending up', 'growth increase economics statistics'],
    ['trending-down', 'Trending down', 'decline decrease economics statistics'],
    ['chart-line', 'Line chart', 'data statistics trend'],
    ['chart-column', 'Bar chart', 'data statistics compare'],
    ['chart-pie', 'Pie chart', 'data statistics proportion'],
    ['handshake', 'Handshake', 'agreement negotiation civics'],
    ['vote', 'Vote', 'democracy civics election'],
    ['briefcase', 'Briefcase', 'work business career'],
    ['factory', 'Factory', 'industry production economics'],
    ['truck', 'Lorry', 'logistics trade supply'],
    ['building-2', 'Institution', 'organisation civics business'],
    ['users-round', 'Community', 'society people group'],
  ]],

  signals: ['Signals & status', [
    ['circle-check', 'Correct', 'right tick yes approve'],
    ['circle-x', 'Incorrect', 'wrong no reject'],
    ['triangle-alert', 'Warning', 'caution careful important'],
    ['info', 'Information', 'note aside'],
    ['circle-help', 'Help', 'question unsure support'],
    ['ban', 'Not allowed', 'forbidden no never'],
    ['eye', 'Look', 'watch notice observe'],
    ['eye-off', 'Hidden', 'unseen conceal'],
    ['search', 'Search', 'find inquiry research'],
    ['zoom-in', 'Zoom in', 'detail closer examine'],
    ['crosshair', 'Focus point', 'precise target aim'],
    ['scan-search', 'Examine', 'analyse inspect close reading'],
    ['sparkles', 'Sparkles', 'new highlight delight magic'],
    ['sparkle', 'Sparkle', 'new highlight'],
    ['circle-dot', 'Point', 'bullet focus'],
    ['link', 'Link', 'connection relation'],
    ['share-2', 'Share', 'distribute network'],
    ['split', 'Split', 'diverge branch options'],
    ['merge', 'Merge', 'converge combine'],
  ]],

  arrows: ['Arrows', [
    ['arrow-right', 'Arrow right', 'point direction next'],
    ['arrow-left', 'Arrow left', 'point direction back'],
    ['arrow-up', 'Arrow up', 'point direction increase'],
    ['arrow-down', 'Arrow down', 'point direction decrease'],
    ['arrow-up-right', 'Arrow up-right', 'point diagonal growth'],
    ['arrow-up-left', 'Arrow up-left', 'point diagonal'],
    ['arrow-down-right', 'Arrow down-right', 'point diagonal'],
    ['arrow-down-left', 'Arrow down-left', 'point diagonal'],
    ['move-right', 'Long arrow', 'point direction leads to'],
    ['corner-down-right', 'Turn down-right', 'therefore follows result'],
    ['corner-up-right', 'Turn up-right', 'follows result'],
    ['redo-2', 'Redo', 'again repeat forward'],
    ['undo-2', 'Undo', 'back revert'],
    ['refresh-cw', 'Cycle', 'repeat loop iterate process'],
    ['repeat', 'Repeat', 'loop cycle again'],
    ['chevron-right', 'Chevron right', 'next more'],
    ['chevron-down', 'Chevron down', 'expand more'],
    ['chevrons-right', 'Double chevron', 'fast forward next'],
    ['check', 'Tick', 'correct yes done'],
    ['x', 'Cross', 'wrong no close'],
    ['asterisk', 'Asterisk', 'footnote caveat note'],
  ]],
};

// ---------------------------------------------------------------------

/** Pull the inner markup out of a Lucide SVG, collapsed onto one line. */
function inner(id) {
  const raw = readFileSync(new URL(`${id}.svg`, SRC), 'utf8');
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');
  return body
    .replace(/\s*\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\/>/g, '/>')
    .trim();
}

const out = [];
const meta = [];
const seen = new Map();
let count = 0;

for (const [cat, [label, items]] of Object.entries(CATALOG)) {
  for (const [id, name, tags] of items) {
    // ICON_PATHS is an object and ICON_INDEX is a list, so a duplicate id
    // shrinks one and not the other — it silently drops the icon from the
    // first category that claimed it. Refuse instead.
    if (seen.has(id)) {
      throw new Error(`duplicate id "${id}" in ${cat}, already in ${seen.get(id)}`);
    }
    seen.set(id, cat);
    const markup = inner(id);
    if (!markup) throw new Error(`empty markup for ${id}`);
    out.push(`  '${id}': '${markup.replace(/'/g, "\\'")}',`);
    meta.push(`  ['${id}', '${name.replace(/'/g, "\\'")}', '${cat}', '${tags}'],`);
    count += 1;
  }
  void label;
}

const header = `/**
 * SurveyAll — element path data. GENERATED FILE, DO NOT HAND-EDIT.
 *
 * A curated teaching subset of Lucide (${PKG.version}), regenerated by the
 * script at tools/build-elements.mjs. Lucide is ISC-licensed and the licence
 * travels with the art in app/vendor/lucide-LICENSE.txt — the same
 * arrangement as the vendored QR encoder, and the reason this app can ship
 * ${count} icons without owing anyone an attribution line on the projector.
 *
 * Every icon is drawn on the same 24x24 grid at one stroke weight, which
 * is why a microscope dropped onto a chalkboard slide looks drawn by the
 * same hand as the chart next to it. See app/elements.js for the API; the
 * hand-drawn annotation marks live there too, because they are ours.
 *
 * The subset is deliberately small. 2,000 icons is a search problem; 200
 * curated ones is a picker you can scroll.
 */

/** id -> inner SVG markup, stroked with currentColor by elementSvg(). */
export const ICON_PATHS = {
${out.join('\n')}
};

/** [id, label, category, search tags] */
export const ICON_INDEX = [
${meta.join('\n')}
];
`;

writeFileSync(OUT, header);
console.log(`wrote ${count} icons across ${Object.keys(CATALOG).length} categories`);
