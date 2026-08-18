/**
 * Builds app/elements-data.js — a curated teaching subset of two icon
 * sets: Lucide (ISC) and Tabler (MIT).
 *
 * Between them they ship 7,000+ icons. This file is the curation, and it
 * is the only place to add or rename an element.
 *
 * Run:
 *   cd /tmp
 *   npm pack lucide-static && mkdir -p lu && tar xzf lucide-static-*.tgz -C lu --strip-components=1
 *   npm pack @tabler/icons && mkdir -p tb && tar xzf tabler-icons-*.tgz -C tb --strip-components=1
 *   node tools/build-elements.mjs /tmp/lu /tmp/tb
 *
 * WHY TWO SETS AND NOT FIVE
 *
 * A second source is a second licence to honour and, worse, a second
 * drawing style — the whole promise is that anything you drag in looks
 * like it belongs. Tabler qualifies on the only test that matters: it is
 * drawn to the same spec as Lucide, 24x24 at stroke 2 with round caps
 * and joins, so the two sit side by side on a slide without announcing
 * which came from where. Phosphor, Heroicons, Material and the rest are
 * permissively licensed and drawn to a different grid, and mixing one in
 * shows.
 *
 * Tabler earns its place by covering what Lucide simply does not have:
 * logic gates, inequality signs, trig, an abacus, ringed letters for
 * labelling A/B/C/D, world-religion symbols, and a proper spread of
 * sports. It is not a second general-purpose pile — every id below is
 * something a lesson wanted and Lucide could not supply.
 *
 * Then check the result in tests/elements-check.html before committing —
 * a Lucide upgrade can rename or redraw an icon, and the only way to know
 * a redraw still reads at projector size is to look at it.
 *
 * WHERE THE SEARCH TAGS COME FROM
 *
 * Lucide's own package ships tags.json: a synonym list per icon, written
 * by the people who drew them. Every entry here gets those merged in, so
 * the catalog only has to carry the words upstream wouldn't think of —
 * the classroom ones. Lucide tagged the calculator "arithmetic"; a
 * teacher types "maths".
 *
 *   'telescope'                        id alone — label and tags derived
 *   ['flask-conical', 'Conical flask'] our label, upstream tags
 *   ['dna', 'DNA', 'genetics helix']   our label, our tags then upstream
 *
 * Most entries name a label, because the picker reads better for it. Drop
 * to the bare form when the id already says it and Lucide's tags already
 * cover it — 'telescope' does not need to be told it is a telescope.
 *
 * The annotation marks are NOT here. They are ours, hand-drawn, and live
 * in app/elements.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , LUCIDE_DIR, TABLER_DIR] = process.argv;
if (!LUCIDE_DIR || !TABLER_DIR) {
  console.error('usage: node tools/build-elements.mjs <lucide-static dir> <@tabler/icons dir>');
  process.exit(1);
}
const OUT = new URL('../app/elements-data.js', import.meta.url);

const lucidePkg = JSON.parse(readFileSync(path.join(LUCIDE_DIR, 'package.json'), 'utf8'));
const tablerPkg = JSON.parse(readFileSync(path.join(TABLER_DIR, 'package.json'), 'utf8'));

/** Tabler's icons.json is keyed by name with `tags`; Lucide's tags.json is name -> tags. */
const tablerMeta = JSON.parse(readFileSync(path.join(TABLER_DIR, 'icons.json'), 'utf8'));

const SOURCES = {
  lucide: {
    version: lucidePkg.version,
    dir: new URL(`file://${path.resolve(LUCIDE_DIR)}/icons/`),
    tags: JSON.parse(readFileSync(path.join(LUCIDE_DIR, 'tags.json'), 'utf8')),
  },
  tabler: {
    version: tablerPkg.version,
    dir: new URL(`file://${path.resolve(TABLER_DIR)}/icons/outline/`),
    tags: Object.fromEntries(Object.entries(tablerMeta).map(([k, v]) => [k, v.tags || []])),
  },
};

/**
 * Words an auto-label must not sentence-case, because they are not words.
 *
 * Everything else is `kebab-id -> Sentence case`, which is the house style
 * for a label ("Open book", not "Open Book") and is right often enough
 * that writing 600 labels by hand would only introduce typos.
 */
const SHOUT = new Set(['dna', 'tv', 'usb', 'cpu', 'gpu', 'qr', 'id', 'hd', 'ai', 'pc', 'cctv', 'rss', 'nfc']);

function autoLabel(id) {
  const words = id.split('-').map((w) => (SHOUT.has(w) ? w.toUpperCase() : w));
  const [first, ...rest] = words;
  const head = SHOUT.has(first.toLowerCase()) ? first : first[0].toUpperCase() + first.slice(1);
  return [head, ...rest].join(' ');
}

/**
 * The catalog. Categories appear in the picker in this order, after the
 * hand-drawn marks. `[id]` | `[id, label]` | `[id, label, tags]`.
 */
const CATALOG = {
  arrows: ['Arrows', [
    ['arrow-right', 'Arrow right', 'point direction next'],
    ['arrow-left', 'Arrow left', 'point direction back'],
    ['arrow-up', 'Arrow up', 'point direction increase'],
    ['arrow-down', 'Arrow down', 'point direction decrease'],
    ['arrow-up-right', 'Arrow up-right', 'point diagonal growth'],
    ['arrow-up-left', 'Arrow up-left', 'point diagonal'],
    ['arrow-down-right', 'Arrow down-right', 'point diagonal'],
    ['arrow-down-left', 'Arrow down-left', 'point diagonal'],
    ['arrow-left-right', 'Arrow both ways', 'exchange swap two-way'],
    ['arrow-up-down', 'Arrow up and down', 'exchange vary two-way'],
    ['arrow-right-left', 'Swap', 'exchange trade switch'],
    ['arrow-down-up', 'Swap vertical', 'exchange switch'],
    ['arrow-big-right', 'Big arrow right', 'point direction bold'],
    ['arrow-big-left', 'Big arrow left', 'point direction bold'],
    ['arrow-big-up', 'Big arrow up', 'point direction bold'],
    ['arrow-big-down', 'Big arrow down', 'point direction bold'],
    ['move-right', 'Long arrow', 'point direction leads to'],
    ['move-left', 'Long arrow left', 'point direction back'],
    ['move-up', 'Long arrow up', 'point direction'],
    ['move-down', 'Long arrow down', 'point direction'],
    ['move-horizontal', 'Long arrow, both ways', 'range span between'],
    ['move-vertical', 'Long arrow, up and down', 'range span between'],
    ['move-diagonal', 'Diagonal arrow', 'resize expand'],
    ['corner-down-right', 'Turn down-right', 'therefore follows result'],
    ['corner-up-right', 'Turn up-right', 'follows result'],
    ['corner-down-left', 'Turn down-left', 'follows result'],
    ['corner-up-left', 'Turn up-left', 'follows result'],
    ['corner-right-down', 'Bend right-down', 'branch path'],
    ['corner-left-down', 'Bend left-down', 'branch path'],
    ['circle-arrow-right', 'Arrow right, ringed', 'next step'],
    ['circle-arrow-left', 'Arrow left, ringed', 'back step'],
    ['circle-arrow-up', 'Arrow up, ringed', 'rise step'],
    ['circle-arrow-down', 'Arrow down, ringed', 'fall step'],
    'chevron-right',
    'chevron-left',
    ['chevron-up', 'Chevron up', 'collapse less'],
    ['chevron-down', 'Chevron down', 'expand more'],
    ['chevrons-right', 'Double chevron', 'fast forward next'],
    ['chevrons-left', 'Double chevron left', 'rewind back'],
    ['chevrons-up', 'Double chevron up', 'raise top'],
    ['chevrons-down', 'Double chevron down', 'lower bottom'],
    ['chevrons-up-down', 'Chevrons, both ways', 'sort expand'],
    ['chevrons-left-right', 'Chevrons, outward', 'widen expand'],
    ['redo-2', 'Redo', 'again repeat forward'],
    ['undo-2', 'Undo', 'back revert'],
    ['refresh-cw', 'Cycle', 'repeat loop iterate process'],
    ['refresh-ccw', 'Cycle back', 'repeat loop reverse'],
    ['rotate-cw', 'Rotate right', 'turn clockwise'],
    ['rotate-ccw', 'Rotate left', 'turn anticlockwise reset'],
    ['repeat', 'Repeat', 'loop cycle again'],
    ['repeat-1', 'Repeat once', 'loop single again'],
    ['shuffle', 'Shuffle', 'random mix reorder'],
    ['milestone', 'Milestone', 'signpost stage progress'],
    ['signpost', 'Signpost', 'direction choice way'],
    ['signpost-big', 'Signpost, two ways', 'direction choice fork'],
    ['waypoints', 'Waypoints', 'route path network stages'],
    ['step-forward', 'Step forward', 'next advance'],
    ['step-back', 'Step back', 'previous retreat'],
    ['fast-forward', 'Fast forward', 'speed ahead skip'],
    ['rewind', 'Rewind', 'back replay'],
    ['skip-forward', 'Skip forward', 'end next'],
    ['skip-back', 'Skip back', 'start previous'],
    ['check', 'Tick', 'correct yes done'],
    ['check-check', 'Double tick', 'confirmed all done'],
    ['x', 'Cross', 'wrong no close'],
    ['asterisk', 'Asterisk', 'footnote caveat note'],
  ]],

  signals: ['Signals & status', [
    ['circle-check', 'Correct', 'right tick yes approve'],
    ['circle-x', 'Incorrect', 'wrong no reject'],
    ['circle-alert', 'Alert', 'caution attention notice'],
    ['triangle-alert', 'Warning', 'caution careful important'],
    ['octagon-alert', 'Stop and read', 'caution serious warning'],
    ['info', 'Information', 'note aside'],
    ['circle-help', 'Help', 'question unsure support'],
    ['badge-question-mark', 'Open question', 'ask unknown inquiry'],
    ['ban', 'Not allowed', 'forbidden no never'],
    ['badge-check', 'Verified', 'confirmed correct trusted'],
    ['badge-alert', 'Flagged', 'caution attention'],
    ['badge-info', 'Noted', 'information aside'],
    ['badge-x', 'Rejected', 'wrong no denied'],
    ['badge-plus', 'Added', 'include new'],
    ['badge-minus', 'Removed', 'exclude drop'],
    ['badge', 'Badge', 'label token status'],
    ['bookmark', 'Bookmark', 'save remember reference'],
    ['bookmark-check', 'Bookmarked', 'saved marked read'],
    ['flag-triangle-right', 'Pennant', 'mark milestone claim'],
    ['siren', 'Alarm', 'emergency urgent alert'],
    ['bell-ring', 'Bell ringing', 'alert now attention'],
    ['bell-off', 'Bell off', 'silent muted do not disturb'],
    ['lightbulb-off', 'Lightbulb off', 'no idea stuck dark'],
    ['zap-off', 'Power off', 'no energy dead'],
    ['radar', 'Radar', 'detect sweep scan monitor'],
    ['scan', 'Scan', 'read capture detect'],
    ['scan-line', 'Scan line', 'read capture measure'],
    ['scan-eye', 'Observe closely', 'watch detect notice'],
    ['scan-search', 'Examine', 'analyse inspect close reading'],
    ['search', 'Search', 'find inquiry research'],
    ['zoom-in', 'Zoom in', 'detail closer examine'],
    ['zoom-out', 'Zoom out', 'wider context overview'],
    ['eye', 'Look', 'watch notice observe'],
    ['eye-off', 'Hidden', 'unseen conceal'],
    ['eye-closed', 'Eyes closed', 'unseen ignore blind'],
    ['crosshair', 'Focus point', 'precise target aim'],
    ['sparkles', 'Sparkles', 'new highlight delight magic'],
    ['sparkle', 'Sparkle', 'new highlight'],
    ['circle-dot', 'Point', 'bullet focus'],
    ['circle-dashed', 'Dashed circle', 'provisional draft placeholder'],
    ['circle-slash', 'Excluded', 'none zero not'],
    ['contrast', 'Contrast', 'compare opposite difference'],
    ['filter', 'Filter', 'narrow select criteria'],
    ['list-checks', 'Ticked list', 'tasks steps done'],
    ['list-todo', 'To do', 'tasks unchecked pending'],
    ['toggle-left', 'Toggle off', 'switch state false'],
    ['toggle-right', 'Toggle on', 'switch state true'],
    ['ellipsis', 'Ellipsis', 'more continues and so on'],
    ['grip-horizontal', 'Grip', 'handle drag move'],
    ['link', 'Link', 'connection relation'],
    ['unlink', 'Broken link', 'disconnect separate'],
    ['external-link', 'External link', 'elsewhere source out'],
    ['share-2', 'Share', 'distribute network'],
    ['split', 'Split', 'diverge branch options'],
    ['merge', 'Merge', 'converge combine'],
  ]],

  classroom: ['Classroom', [
    ['graduation-cap', 'Graduation cap', 'school student degree education'],
    'school',
    ['university', 'University', 'college higher education'],
    ['lectern', 'Lectern', 'lecture podium speaking'],
    ['backpack', 'Backpack', 'school student'],
    ['apple', 'Apple', 'teacher school fruit'],
    ['clock', 'Clock', 'time schedule'],
    ['alarm-clock', 'Alarm clock', 'time wake deadline'],
    ['watch', 'Watch', 'time wrist'],
    ['timer', 'Timer', 'time countdown'],
    ['timer-reset', 'Reset timer', 'time restart again'],
    ['hourglass', 'Hourglass', 'time waiting'],
    ['calendar', 'Calendar', 'date schedule'],
    ['calendar-days', 'Calendar month', 'date schedule'],
    ['clipboard', 'Clipboard', 'notes assessment'],
    ['clipboard-list', 'Checklist', 'notes assessment tasks'],
    ['clipboard-check', 'Marked off', 'assessment complete done'],
    ['clipboard-pen', 'Filling in', 'assessment writing form'],
    ['clipboard-copy', 'Copy down', 'transcribe duplicate'],
    'notebook',
    ['notebook-pen', 'Notebook and pen', 'notes writing'],
    ['notebook-text', 'Written notes', 'notes lined writing'],
    ['notebook-tabs', 'Tabbed notebook', 'notes sections organise'],
    ['notepad-text', 'Notepad', 'notes jot memo'],
    ['sticky-note', 'Sticky note', 'reminder notes'],
    ['sticky-notes', 'Sticky notes', 'reminders brainstorm ideas'],
    ['highlighter', 'Highlighter pen', 'annotate mark notes'],
    ['eraser', 'Eraser', 'undo correct'],
    'pen',
    'pencil-line',
    ['pencil-ruler', 'Pencil and ruler', 'drafting design technical'],
    ['scissors', 'Scissors', 'cut craft activity'],
    ['folder', 'Folder', 'files organise'],
    ['folder-open', 'Open folder', 'files organise'],
    ['folder-plus', 'New folder', 'files organise add'],
    ['file-text', 'Document', 'handout paper worksheet'],
    'paperclip',
    ['pin', 'Pin', 'attach remember'],
    ['pin-off', 'Unpinned', 'detach release'],
    ['upload', 'Upload', 'submit hand in send'],
    ['download', 'Download', 'get handout save'],
    ['library-big', 'Shelf of books', 'library reading collection'],
    ['id-card', 'ID card', 'register name identity'],
    ['lightbulb', 'Lightbulb', 'idea insight understand'],
    ['brain', 'Brain', 'thinking cognition psychology memory'],
    ['megaphone', 'Megaphone', 'announce attention'],
    ['presentation', 'Presentation', 'slides lecture'],
    ['projector', 'Projector', 'slides lecture av'],
    ['screen-share', 'Screen share', 'display cast show'],
    ['monitor', 'Monitor', 'screen computer'],
    ['monitor-play', 'Play on screen', 'video clip show'],
    ['tv', 'Television', 'screen broadcast media'],
    ['laptop', 'Laptop', 'computer device'],
    ['tablet', 'Tablet', 'device ipad'],
    ['smartphone', 'Phone', 'device mobile'],
    ['keyboard', 'Keyboard', 'typing input'],
    ['printer', 'Printer', 'handout paper'],
    ['bell', 'Bell', 'alert reminder time'],
    'award',
    'trophy',
    ['medal', 'Medal', 'achievement prize rank'],
    ['target', 'Target', 'goal objective aim outcome'],
    ['goal', 'Goal', 'objective aim outcome'],
    ['flag', 'Flag', 'milestone mark goal'],
    ['party-popper', 'Celebrate', 'well done congratulations party'],
    ['gift', 'Gift', 'reward present prize'],
    ['cake', 'Cake', 'birthday celebrate'],
    ['balloon', 'Balloon', 'celebrate party'],
    ['puzzle', 'Puzzle piece', 'problem fit solve activity'],
    ['blocks', 'Building blocks', 'construct model activity'],
    ['dices', 'Dice', 'chance random probability game'],
    ['dice-1', 'Dice, one', 'chance probability number'],
    ['dice-2', 'Dice, two', 'chance probability number'],
    ['dice-3', 'Dice, three', 'chance probability number'],
    ['dice-4', 'Dice, four', 'chance probability number'],
    ['dice-5', 'Dice, five', 'chance probability number'],
    ['dice-6', 'Dice, six', 'chance probability number'],
  ]],

  people: ['People & feelings', [
    ['user', 'Person', 'individual student'],
    ['users', 'Group', 'people class team pairs'],
    ['user-round', 'Person, round', 'individual student'],
    ['users-round', 'Community', 'society people group'],
    ['user-check', 'Present', 'here register confirmed'],
    ['user-plus', 'Add a person', 'join invite new'],
    ['user-minus', 'Remove a person', 'leave drop'],
    ['user-x', 'Absent', 'missing away not here'],
    ['contact', 'Contact card', 'details profile'],
    ['id-card-lanyard', 'Lanyard', 'identity badge name'],
    ['person-standing', 'Standing figure', 'body person human'],
    ['accessibility', 'Accessibility', 'inclusion disability access'],
    ['baby', 'Baby', 'infant child development'],
    ['biceps-flexed', 'Strength', 'effort strong try hard'],
    ['footprints', 'Footprints', 'steps journey trace evidence'],
    ['hand', 'Raised hand', 'volunteer ask participate'],
    ['hand-helping', 'Helping hand', 'support assist scaffold -begging'],
    ['hand-heart', 'Care', 'kindness support wellbeing'],
    ['hand-fist', 'Fist', 'solidarity protest strength'],
    ['handshake', 'Handshake', 'agreement negotiation civics'],
    ['heart-handshake', 'Shared care', 'trust partnership community'],
    ['heart', 'Heart', 'like care wellbeing'],
    ['heart-crack', 'Broken heart', 'sad loss upset'],
    ['thumbs-up', 'Thumbs up', 'agree approve like'],
    ['thumbs-down', 'Thumbs down', 'disagree reject dislike'],
    ['smile', 'Smile', 'happy feedback mood'],
    ['meh', 'Neutral face', 'unsure feedback mood'],
    ['frown', 'Frown', 'unhappy confused feedback mood'],
    ['laugh', 'Laughing', 'funny happy mood'],
    ['angry', 'Angry', 'cross upset mood'],
    ['annoyed', 'Annoyed', 'irritated unimpressed mood'],
    ['face-grinning', 'Grinning', 'happy delighted mood'],
    ['face-neutral', 'Blank face', 'indifferent unsure mood'],
    ['face-slightly-smiling', 'Slight smile', 'content ok mood -aggressive -patronizing'],
    ['face-slightly-frowning', 'Slight frown', 'doubt unsure mood'],
    ['face-angry', 'Furious', 'anger upset mood'],
    ['face-expressionless', 'Expressionless', 'deadpan flat mood'],
    ['message-circle', 'Discussion', 'talk chat comment'],
    ['message-circle-question', 'Question', 'ask query doubt'],
    ['message-circle-heart', 'Kind word', 'praise support feedback -dating'],
    ['message-square', 'Comment', 'reply note respond'],
    ['messages-square', 'Conversation', 'dialogue debate exchange'],
    ['speech', 'Speech', 'speaking talk voice'],
    ['vote', 'Vote', 'democracy civics election'],
    ['venus', 'Venus', 'female gender symbol'],
    ['mars', 'Mars', 'male gender symbol'],
    ['transgender', 'Transgender', 'gender identity symbol'],
    ['non-binary', 'Non-binary', 'gender identity symbol'],
  ]],

  science: ['Science & nature', [
    ['microscope', 'Microscope', 'lab biology science cell specimen slide'],
    ['atom', 'Atom', 'physics chemistry nucleus'],
    ['flask-conical', 'Flask', 'chemistry lab experiment'],
    ['flask-round', 'Round flask', 'chemistry lab'],
    ['beaker', 'Beaker', 'chemistry lab measure'],
    ['test-tube', 'Test tube', 'chemistry lab sample'],
    ['test-tube-diagonal', 'Test tube, tilted', 'chemistry lab'],
    ['test-tubes', 'Test tubes', 'chemistry lab rack samples'],
    ['pipette', 'Pipette', 'chemistry lab measure drop'],
    ['dna', 'DNA', 'genetics biology helix cell chromosome'],
    'telescope',
    ['satellite', 'Satellite', 'space orbit technology'],
    ['magnet', 'Magnet', 'physics force'],
    ['thermometer', 'Thermometer', 'temperature heat physics'],
    ['thermometer-sun', 'Heat', 'temperature hot warm'],
    ['thermometer-snowflake', 'Cold', 'temperature freezing chill'],
    ['gauge', 'Gauge', 'measure pressure reading dial'],
    ['lens-convex', 'Convex lens', 'optics physics light'],
    ['lens-concave', 'Concave lens', 'optics physics light'],
    ['mirror-round', 'Mirror', 'optics reflection light'],
    ['circuit-board', 'Circuit board', 'electronics physics current'],
    ['brain-circuit', 'Neural network', 'ai cognition connections'],
    ['rocket', 'Rocket', 'space launch physics'],
    ['orbit', 'Orbit', 'space planets astronomy'],
    ['eclipse', 'Eclipse', 'astronomy moon shadow'],
    ['radiation', 'Radiation', 'nuclear physics hazard'],
    ['biohazard', 'Biohazard', 'biology safety hazard'],
    ['recycle', 'Recycle', 'sustainability environment reuse'],
    ['leaf', 'Leaf', 'biology plant nature ecology'],
    ['leafy-green', 'Leafy green', 'plant vegetable nutrition'],
    ['sprout', 'Sprout', 'growth plant biology'],
    ['shrub', 'Shrub', 'plant nature garden'],
    ['flower', 'Flower', 'plant biology pollination'],
    ['flower-2', 'Blossom', 'plant biology spring'],
    ['rose', 'Rose', 'plant flower garden'],
    ['wheat', 'Wheat', 'crop agriculture harvest'],
    ['tree-pine', 'Pine tree', 'forest nature ecology'],
    ['tree-deciduous', 'Tree', 'forest nature ecology'],
    ['tree-palm', 'Palm tree', 'tropical nature climate'],
    ['trees', 'Woodland', 'forest nature ecology habitat'],
    ['bug', 'Insect', 'biology entomology'],
    ['worm', 'Worm', 'biology soil invertebrate'],
    ['shrimp', 'Shrimp', 'biology marine crustacean'],
    ['shell', 'Shell', 'biology marine mollusc'],
    ['fish', 'Fish', 'biology marine'],
    ['bird', 'Bird', 'biology zoology'],
    ['birdhouse', 'Nest box', 'birds habitat conservation'],
    ['egg', 'Egg', 'biology reproduction bird'],
    ['dog', 'Dog', 'animal zoology'],
    ['cat', 'Cat', 'animal zoology'],
    ['rabbit', 'Rabbit', 'animal zoology'],
    ['rat', 'Rat', 'animal zoology rodent'],
    ['squirrel', 'Squirrel', 'animal zoology rodent'],
    ['panda', 'Panda', 'animal zoology conservation'],
    ['turtle', 'Turtle', 'animal zoology reptile'],
    ['snail', 'Snail', 'animal zoology slow'],
    ['paw-print', 'Paw print', 'animal track trace'],
    ['origami', 'Paper crane', 'origami craft folding'],
    ['mountain', 'Mountain', 'geography geology terrain'],
    ['mountain-snow', 'Snowy mountain', 'geography geology'],
    ['stone', 'Rock', 'geology mineral sample'],
    ['shovel', 'Garden spade', 'digging soil excavate'],
    ['solar-panel', 'Solar panel', 'renewable energy sustainability'],
    ['waves', 'Waves', 'ocean physics sound frequency'],
    ['cloud', 'Cloud', 'weather meteorology'],
    ['cloudy', 'Overcast', 'weather meteorology grey'],
    ['cloud-rain', 'Rain', 'weather meteorology'],
    ['cloud-drizzle', 'Drizzle', 'weather meteorology light rain'],
    ['cloud-hail', 'Hail', 'weather meteorology ice'],
    ['cloud-snow', 'Snowfall', 'weather meteorology winter'],
    ['cloud-lightning', 'Thunderstorm', 'weather meteorology storm'],
    ['cloud-fog', 'Fog', 'weather meteorology mist'],
    ['haze', 'Haze', 'weather meteorology smog air'],
    ['cloud-sun', 'Sunny spells', 'weather meteorology'],
    ['cloud-moon', 'Cloudy night', 'weather meteorology'],
    ['tornado', 'Tornado', 'weather storm extreme'],
    ['rainbow', 'Rainbow', 'light spectrum optics weather'],
    ['umbrella', 'Umbrella', 'rain weather shelter'],
    ['sun', 'Sun', 'weather star energy'],
    ['sun-dim', 'Dim sun', 'weather light faint'],
    ['sun-moon', 'Day and night', 'cycle rotation earth'],
    'sunrise',
    'sunset',
    ['moon', 'Moon', 'astronomy night'],
    ['moon-star', 'Night sky', 'astronomy stars dark'],
    ['star', 'Star', 'astronomy favourite'],
    'snowflake',
    ['droplet', 'Droplet', 'water chemistry liquid'],
    ['droplets', 'Droplets', 'water chemistry liquid'],
    ['flame', 'Flame', 'fire heat energy'],
    'wind',
    ['zap', 'Lightning', 'electricity energy power physics'],
    ['globe', 'Globe', 'earth world geography'],
    ['earth', 'Earth', 'world planet geography'],
  ]],

  maths: ['Maths & shapes', [
    ['calculator', 'Calculator', 'maths math arithmetic'],
    ['sigma', 'Sigma', 'maths sum series statistics'],
    ['pi', 'Pi', 'maths geometry constant'],
    ['phi', 'Phi', 'maths golden ratio constant'],
    ['omega', 'Omega', 'maths physics constant last'],
    ['radical', 'Square root', 'maths radical surd'],
    ['variable', 'Variable', 'maths algebra'],
    ['parentheses', 'Brackets', 'maths grouping order'],
    ['braces', 'Braces', 'maths set notation'],
    ['square-function', 'Function', 'maths algebra mapping'],
    ['divide', 'Divide', 'maths arithmetic'],
    ['plus', 'Plus', 'maths add arithmetic'],
    ['minus', 'Minus', 'maths subtract arithmetic'],
    ['equal', 'Equals', 'maths arithmetic'],
    ['equal-not', 'Not equal', 'maths inequality different'],
    ['percent', 'Percent', 'maths proportion statistics'],
    ['infinity', 'Infinity', 'maths limit'],
    ['binary', 'Binary', 'maths computing base two'],
    ['superscript', 'Superscript', 'maths power exponent'],
    ['subscript', 'Subscript', 'maths notation'],
    ['circle-plus', 'Plus, ringed', 'maths add more'],
    ['circle-minus', 'Minus, ringed', 'maths subtract fewer'],
    ['circle-divide', 'Divide, ringed', 'maths arithmetic'],
    ['circle-equal', 'Equals, ringed', 'maths same balance'],
    ['circle-percent', 'Percent, ringed', 'maths proportion'],
    ['tally-1', 'Tally, one', 'count data frequency -prison -sentence -cell'],
    ['tally-2', 'Tally, two', 'count data frequency -prison -sentence -cell'],
    ['tally-3', 'Tally, three', 'count data frequency -prison -sentence -cell'],
    ['tally-4', 'Tally, four', 'count data frequency -prison -sentence -cell'],
    ['tally-5', 'Tally, five', 'count data frequency -prison -sentence -cell'],
    ['ruler', 'Ruler', 'measure geometry length'],
    ['ruler-dimension-line', 'Dimension', 'measure length width span'],
    ['drafting-compass', 'Compasses', 'geometry circle construct draw'],
    ['angle', 'Angle', 'geometry degrees corner'],
    ['diameter', 'Diameter', 'geometry circle across'],
    ['radius', 'Radius', 'geometry circle centre'],
    ['tangent', 'Tangent', 'geometry curve touch'],
    ['spline', 'Curve', 'maths graph function bezier'],
    ['line-squiggle', 'Squiggle', 'curve wave irregular'],
    ['vector-square', 'Vector', 'geometry points nodes shape'],
    'weight',
    ['triangle', 'Triangle', 'shape geometry'],
    ['triangle-right', 'Right triangle', 'shape geometry'],
    ['triangle-dashed', 'Dashed triangle', 'shape geometry construction'],
    ['square', 'Square', 'shape geometry'],
    ['rectangle-horizontal', 'Rectangle', 'shape geometry oblong'],
    ['rectangle-vertical', 'Tall rectangle', 'shape geometry oblong'],
    ['circle', 'Circle', 'shape geometry'],
    'ellipse',
    ['pentagon', 'Pentagon', 'shape geometry'],
    ['hexagon', 'Hexagon', 'shape geometry'],
    ['octagon', 'Octagon', 'shape geometry'],
    ['diamond', 'Diamond', 'shape geometry rhombus'],
    ['star-half', 'Half star', 'fraction part rating'],
    'club',
    'spade',
    ['cone', 'Cone', 'solid 3d geometry volume'],
    ['cylinder', 'Cylinder', 'solid 3d geometry volume'],
    ['pyramid', 'Pyramid', 'solid 3d geometry volume'],
    ['box', 'Cube', 'solid 3d geometry volume'],
    ['boxes', 'Cubes', 'solid 3d grouping volume'],
    ['grid-2x2', 'Grid', 'array rows columns matrix'],
    ['shapes', 'Shapes', 'geometry forms'],
  ]],

  charts: ['Charts & data', [
    ['chart-column', 'Bar chart', 'data statistics compare'],
    ['chart-column-big', 'Bar chart, bold', 'data statistics compare'],
    ['chart-column-increasing', 'Bars rising', 'data growth increase'],
    ['chart-column-decreasing', 'Bars falling', 'data decline decrease'],
    ['chart-column-stacked', 'Stacked bars', 'data parts composition'],
    ['chart-bar', 'Horizontal bars', 'data statistics compare'],
    ['chart-bar-big', 'Horizontal bars, bold', 'data statistics'],
    ['chart-bar-stacked', 'Stacked horizontal bars', 'data composition'],
    ['chart-line', 'Line chart', 'data statistics trend'],
    ['chart-spline', 'Curved line chart', 'data trend smooth'],
    ['chart-area', 'Area chart', 'data volume cumulative'],
    ['chart-scatter', 'Scatter plot', 'data correlation points'],
    ['chart-pie', 'Pie chart', 'data statistics proportion'],
    ['chart-candlestick', 'Candlestick chart', 'data finance range'],
    ['chart-gantt', 'Gantt chart', 'plan schedule timeline'],
    ['chart-network', 'Network graph', 'connections relations nodes'],
    ['chart-no-axes-combined', 'Growth', 'data trend combined'],
    ['trending-up', 'Trending up', 'growth increase economics statistics'],
    ['trending-down', 'Trending down', 'decline decrease economics statistics'],
    ['trending-up-down', 'Fluctuating', 'volatile variable change'],
    ['circle-gauge', 'Dial', 'measure level reading'],
    ['activity', 'Vital signs', 'health monitor pulse data'],
    ['table', 'Table', 'data rows columns grid'],
    ['table-2', 'Data table', 'rows columns spreadsheet'],
    ['kanban', 'Kanban board', 'columns workflow plan'],
    ['list-ordered', 'Numbered list', 'rank order steps'],
    ['timeline', 'Timeline', 'sequence chronology history'],
  ]],

  humanities: ['Humanities & arts', [
    ['book', 'Book', 'reading literature text'],
    ['book-open', 'Open book', 'reading literature study'],
    ['book-open-check', 'Read and understood', 'comprehension checked'],
    ['book-marked', 'Bookmarked book', 'reading reference'],
    ['book-text', 'Text', 'reading passage literature'],
    ['book-a', 'Dictionary', 'vocabulary definition language'],
    ['book-copy', 'Class set', 'copies texts reading'],
    ['book-user', 'Biography', 'life story author'],
    ['book-heart', 'Beloved book', 'favourite reading -crush'],
    ['library', 'Library', 'books research reference'],
    ['newspaper', 'Newspaper', 'journalism source media current affairs'],
    ['scroll', 'Scroll', 'history ancient document -scripture'],
    ['scroll-text', 'Written scroll', 'history ancient document -scripture'],
    ['feather', 'Quill', 'writing author literature'],
    ['pen-line', 'Pen stroke', 'writing note'],
    'pencil',
    ['quote', 'Quotation', 'citation literature source'],
    ['text-quote', 'Block quote', 'citation extract passage'],
    ['text-select', 'Select text', 'close reading highlight passage'],
    ['pilcrow', 'Paragraph', 'writing structure prose'],
    ['type', 'Typeface', 'writing letters font'],
    ['a-large-small', 'Text size', 'writing typography emphasis'],
    ['bold', 'Bold', 'emphasis writing formatting'],
    ['italic', 'Italic', 'emphasis writing title formatting'],
    ['underline', 'Underlined text', 'emphasis writing formatting'],
    ['strikethrough', 'Strikethrough', 'delete revise writing'],
    ['heading-1', 'Heading', 'title structure writing'],
    ['heading-2', 'Subheading', 'section structure writing'],
    ['align-left', 'Align left', 'layout writing paragraph'],
    ['align-center', 'Align centre', 'layout writing paragraph'],
    ['align-right', 'Align right', 'layout writing paragraph'],
    ['align-justify', 'Justify', 'layout writing paragraph'],
    ['case-sensitive', 'Capitals matter', 'spelling grammar case'],
    ['case-upper', 'Upper case', 'capitals spelling grammar'],
    ['case-lower', 'Lower case', 'spelling grammar'],
    ['spell-check', 'Spell check', 'spelling accuracy proofread'],
    ['whole-word', 'Whole word', 'vocabulary search literacy'],
    ['languages', 'Languages', 'translation linguistics'],
    ['landmark', 'Landmark', 'government history civics institution -temple'],
    ['gavel', 'Gavel', 'law justice court civics'],
    ['scale', 'Scales of justice', 'law ethics balance fairness'],
    ['stamp', 'Stamp', 'official seal authority document'],
    ['crown', 'Crown', 'monarchy history power'],
    ['swords', 'Swords', 'history conflict war'],
    ['sword', 'Sword', 'history weapon conflict'],
    ['shield-half', 'Heraldic shield', 'history coat of arms defence'],
    ['skull', 'Skull', 'death mortality history archaeology'],
    ['amphora', 'Amphora', 'ancient classics archaeology pottery -wine'],
    ['castle', 'Castle', 'history medieval'],
    ['map', 'Map', 'geography navigation'],
    ['map-pin', 'Map pin', 'geography location place'],
    ['map-pinned', 'Marked map', 'geography location fieldwork'],
    ['compass', 'Compass', 'navigation geography direction'],
    ['anchor', 'Anchor', 'maritime navigation'],
    ['ship-wheel', 'Ship wheel', 'maritime navigation exploration'],
  ]],

  arts: ['Music, art & media', [
    ['music', 'Music', 'note sound arts'],
    ['music-2', 'Quaver', 'note sound notation'],
    ['music-3', 'Minim', 'note sound notation'],
    ['music-4', 'Beamed notes', 'sound notation rhythm'],
    ['keyboard-music', 'Music keyboard', 'music instrument keys'],
    ['piano', 'Piano', 'music instrument arts'],
    ['guitar', 'Guitar', 'music instrument arts'],
    ['drum', 'Drum', 'music instrument percussion rhythm'],
    'metronome',
    ['audio-waveform', 'Waveform', 'sound audio signal'],
    ['audio-lines', 'Audio levels', 'sound volume signal'],
    ['mic', 'Microphone', 'speech audio podcast'],
    ['mic-vocal', 'Singing', 'voice performance music'],
    ['headphones', 'Headphones', 'listening audio'],
    ['headset', 'Headset', 'listening speaking audio'],
    ['speaker', 'Speaker', 'sound audio playback'],
    ['volume-2', 'Volume', 'sound loud audio'],
    ['radio', 'Radio', 'broadcast media listening'],
    ['boom-box', 'Boom box', 'music playback retro'],
    ['cassette-tape', 'Cassette', 'music recording retro'],
    ['disc', 'Disc', 'music recording media'],
    ['disc-album', 'Album', 'music recording release'],
    'turntable',
    ['play', 'Play', 'start clip media'],
    ['pause', 'Pause', 'hold stop media'],
    ['circle-play', 'Play, ringed', 'start clip media'],
    ['circle-pause', 'Pause, ringed', 'hold clip media'],
    ['film', 'Film', 'cinema media clip'],
    ['clapperboard', 'Clapperboard', 'film production media'],
    ['video', 'Video', 'clip record media'],
    'camera',
    ['image', 'Image', 'picture photo illustration'],
    ['images', 'Images', 'gallery pictures collection'],
    ['crop', 'Crop', 'frame composition photography'],
    ['frame', 'Frame', 'picture display composition'],
    ['palette', 'Palette', 'art colour painting'],
    ['swatch-book', 'Colour swatches', 'art palette design'],
    ['paintbrush', 'Paintbrush', 'art painting'],
    ['brush', 'Brush', 'art painting'],
    ['paint-bucket', 'Paint pot', 'art fill colour'],
    ['paint-roller', 'Paint roller', 'art decorating colour'],
    ['spray-can', 'Spray can', 'art street graffiti'],
    ['pen-tool', 'Pen tool', 'writing design vector'],
    ['wand-sparkles', 'Magic wand', 'transform effect imagination'],
    ['drama', 'Theatre masks', 'drama arts performance'],
    ['theater', 'Theatre', 'drama arts stage'],
    ['venetian-mask', 'Mask', 'drama carnival disguise'],
  ]],

  computing: ['Computing & data', [
    ['code', 'Code', 'programming syntax'],
    ['code-xml', 'Markup', 'html programming'],
    ['regex', 'Pattern', 'regex matching search'],
    'terminal',
    ['computer', 'Computer', 'desktop machine hardware'],
    ['cpu', 'Processor', 'hardware computing'],
    ['memory-stick', 'Memory', 'storage ram hardware'],
    'hard-drive',
    ['database', 'Database', 'data storage sql'],
    ['server', 'Server', 'hosting backend'],
    ['cloud-upload', 'Upload to cloud', 'save sync backup'],
    ['cloud-download', 'Download from cloud', 'fetch sync'],
    ['git-branch', 'Branch', 'version control fork path'],
    ['git-merge', 'Merge branches', 'version control join'],
    ['git-fork', 'Fork', 'version control copy diverge'],
    ['git-commit-horizontal', 'Commit', 'version control checkpoint'],
    ['git-pull-request', 'Pull request', 'version control review'],
    ['network', 'Network', 'nodes graph connections'],
    ['workflow', 'Workflow', 'process steps pipeline'],
    ['webhook', 'Webhook', 'trigger integration event'],
    ['list-tree', 'Tree structure', 'hierarchy structure taxonomy'],
    ['wifi', 'Wi-Fi', 'network signal'],
    ['bluetooth', 'Bluetooth', 'wireless pairing signal'],
    ['router', 'Router', 'network hardware internet'],
    ['antenna', 'Antenna', 'signal broadcast reception'],
    ['satellite-dish', 'Satellite dish', 'signal reception broadcast'],
    ['radio-tower', 'Transmitter', 'broadcast signal range'],
    ['cable', 'Cable', 'connection wired hardware'],
    ['plug', 'Plug', 'power connect mains'],
    'power',
    'battery',
    ['battery-charging', 'Charging', 'power energy recharge'],
    ['mouse-pointer', 'Cursor', 'click select pointer'],
    ['mouse', 'Mouse', 'input device click'],
    ['bot', 'Robot', 'ai automation'],
    ['qr-code', 'QR code', 'scan join link'],
    ['scan-qr-code', 'Scan a QR code', 'join camera link'],
    ['barcode', 'Barcode', 'scan product data'],
    ['fingerprint', 'Fingerprint', 'identity biometric evidence'],
    ['lock', 'Lock', 'security privacy'],
    ['lock-open', 'Unlocked', 'access open security'],
    ['key', 'Key', 'access security answer'],
    ['key-round', 'Key, round', 'access security password'],
    ['shield', 'Shield', 'protection security'],
    ['shield-check', 'Protected', 'secure verified safe'],
  ]],

  health: ['Health, body & sport', [
    ['heart-pulse', 'Heartbeat', 'health medicine pulse'],
    ['scan-heart', 'Heart scan', 'health medicine diagnosis'],
    ['stethoscope', 'Stethoscope', 'medicine doctor nursing'],
    'pill',
    ['tablets', 'Tablets', 'medicine pharmacy dose'],
    ['pill-bottle', 'Medicine bottle', 'pharmacy prescription dose'],
    ['syringe', 'Syringe', 'medicine vaccine'],
    ['bandage', 'Plaster', 'first aid injury care'],
    ['bone', 'Bone', 'anatomy skeleton'],
    ['bone-fracture', 'Fracture', 'anatomy injury skeleton'],
    ['ear', 'Ear', 'hearing anatomy senses'],
    ['ear-off', 'Deaf', 'hearing loss accessibility'],
    ['hospital', 'Hospital', 'medicine care building'],
    ['ambulance', 'Ambulance', 'emergency medicine care'],
    ['briefcase-medical', 'First aid kit', 'emergency medicine care'],
    ['cross', 'Medical cross', 'first aid health'],
    ['shield-plus', 'Protection', 'immunity safety prevention'],
    ['life-buoy', 'Life ring', 'rescue safety support'],
    ['ribbon', 'Awareness ribbon', 'campaign support cause'],
    ['bed', 'Bed', 'rest sleep recovery'],
    ['bed-double', 'Double bed', 'rest sleep home'],
    ['toilet', 'Toilet', 'hygiene facilities body'],
    ['shower-head', 'Shower', 'hygiene washing body'],
    ['dumbbell', 'Dumbbell', 'exercise fitness pe strength'],
    ['sport-shoe', 'Trainer', 'sport pe running exercise'],
    ['volleyball', 'Ball', 'sport pe game team'],
    ['podium', 'Podium', 'sport ranking winners results'],
    ['waves-ladder', 'Swimming pool', 'sport pe water swim'],
    ['fishing-rod', 'Fishing rod', 'sport outdoors angling'],
    ['salad', 'Salad', 'nutrition healthy eating diet'],
    ['glass-water', 'Water', 'hydration nutrition drink'],
  ]],

  money: ['Money & work', [
    ['coins', 'Coins', 'money economics currency -gamble'],
    ['banknote', 'Banknote', 'money economics currency'],
    ['hand-coins', 'Paying', 'money economics transaction'],
    ['piggy-bank', 'Savings', 'money economics saving'],
    ['wallet', 'Wallet', 'money personal finance'],
    ['wallet-minimal', 'Purse', 'money personal finance'],
    ['credit-card', 'Card', 'money payment finance'],
    ['dollar-sign', 'Dollar', 'currency money economics'],
    ['euro', 'Euro', 'currency money economics'],
    ['pound-sterling', 'Pound', 'currency money economics'],
    ['japanese-yen', 'Yen', 'currency money economics'],
    ['indian-rupee', 'Rupee', 'currency money economics'],
    ['bitcoin', 'Bitcoin', 'currency crypto economics'],
    ['gem', 'Gem', 'value wealth rare resource'],
    ['receipt', 'Receipt', 'money transaction record'],
    ['receipt-text', 'Itemised receipt', 'money budget record'],
    ['badge-percent', 'Discount', 'sale price economics'],
    ['shopping-cart', 'Shopping cart', 'consumer demand economics'],
    ['shopping-basket', 'Basket', 'consumer shopping economics'],
    ['shopping-bag', 'Shopping bag', 'consumer retail economics'],
    ['handbag', 'Handbag', 'consumer retail personal'],
    ['store', 'Shop', 'retail business high street'],
    ['scan-barcode', 'Scan a barcode', 'retail stock product'],
    ['ticket', 'Ticket', 'entry event price'],
    ['briefcase', 'Briefcase', 'work business career'],
    ['hard-hat', 'Hard hat', 'work safety construction trade'],
    ['factory', 'Factory', 'industry production economics'],
    ['warehouse', 'Warehouse', 'storage logistics supply'],
    ['truck', 'Lorry', 'logistics trade supply'],
    ['tractor', 'Tractor', 'farming agriculture industry'],
    ['building-2', 'Institution', 'organisation civics business'],
  ]],

  world: ['Places & travel', [
    ['house', 'House', 'home building dwelling'],
    ['building', 'Building', 'city architecture urban'],
    ['hotel', 'Hotel', 'travel stay accommodation'],
    ['tower-control', 'Control tower', 'airport aviation travel'],
    ['dam', 'Dam', 'engineering water energy geography'],
    ['brick-wall', 'Brick wall', 'construction barrier building'],
    ['fence', 'Fence', 'boundary field enclosure'],
    ['door-open', 'Open door', 'entry welcome access'],
    ['door-closed', 'Closed door', 'exit private shut'],
    ['tent', 'Tent', 'camping fieldwork outdoors'],
    ['tent-tree', 'Campsite', 'camping outdoors nature'],
    ['caravan', 'Caravan', 'travel holiday touring'],
    ['car', 'Car', 'transport road vehicle'],
    ['car-front', 'Car, front', 'transport road vehicle'],
    ['bus', 'Bus', 'transport public road'],
    ['bus-front', 'Bus, front', 'transport public road'],
    ['van', 'Van', 'transport delivery road'],
    ['train-front', 'Train', 'transport rail public'],
    ['train-track', 'Railway', 'transport rail infrastructure'],
    ['tram-front', 'Tram', 'transport rail city'],
    ['bike', 'Bicycle', 'transport cycling active travel'],
    ['motorbike', 'Motorbike', 'transport road vehicle'],
    ['scooter', 'Scooter', 'transport city active travel'],
    ['plane', 'Aeroplane', 'travel flight transport'],
    ['plane-takeoff', 'Take-off', 'travel flight departure'],
    ['plane-landing', 'Landing', 'travel flight arrival'],
    ['helicopter', 'Helicopter', 'travel flight rescue'],
    ['ship', 'Ship', 'travel sea transport trade'],
    ['sailboat', 'Sailing boat', 'sea travel wind'],
    ['kayak', 'Kayak', 'water sport river travel'],
    ['cable-car', 'Cable car', 'mountain transport travel'],
    ['road', 'Road', 'travel route infrastructure'],
    ['traffic-cone', 'Traffic cone', 'roadworks caution safety'],
    ['fuel', 'Fuel', 'petrol energy transport'],
    ['luggage', 'Suitcase', 'travel packing holiday'],
    ['baggage-claim', 'Baggage', 'travel airport luggage'],
    ['tickets-plane', 'Boarding pass', 'travel flight airport'],
    ['concierge-bell', 'Reception bell', 'hotel service travel'],
    ['binoculars', 'Binoculars', 'looking fieldwork distance'],
    'parasol',
  ]],

  everyday: ['Everyday things', [
    ['banana', 'Banana', 'food fruit nutrition'],
    ['cherry', 'Cherries', 'food fruit nutrition'],
    ['grape', 'Grapes', 'food fruit nutrition -wine'],
    ['citrus', 'Citrus', 'food fruit orange lemon'],
    'carrot',
    'broccoli',
    ['bean', 'Bean', 'food pulse protein nutrition'],
    ['nut', 'Nut', 'food allergy protein nutrition'],
    ['dessert', 'Pudding', 'food dessert sweet meal'],
    'sandwich',
    ['pizza', 'Pizza', 'food meal takeaway'],
    ['hamburger', 'Burger', 'food meal takeaway'],
    ['croissant', 'Croissant', 'food pastry breakfast'],
    ['cookie', 'Biscuit', 'food snack baking'],
    ['cake-slice', 'Slice of cake', 'food fraction dessert'],
    ['donut', 'Doughnut', 'food snack circle'],
    ['ice-cream-cone', 'Ice cream', 'food dessert summer'],
    ['popcorn', 'Popcorn', 'food snack cinema'],
    ['candy', 'Sweet', 'food sugar treat'],
    ['lollipop', 'Lollipop', 'food sugar treat'],
    ['popsicle', 'Ice lolly', 'food frozen summer treat'],
    ['egg-fried', 'Fried egg', 'food breakfast cooking protein'],
    ['soup', 'Soup', 'food meal warm'],
    ['beef', 'Meat', 'food protein nutrition'],
    ['ham', 'Ham', 'food protein meal'],
    ['drumstick', 'Chicken leg', 'food protein meal'],
    'coffee',
    ['cup-soda', 'Fizzy drink', 'drink sugar cup'],
    ['milk', 'Milk', 'drink dairy nutrition'],
    ['utensils', 'Cutlery', 'eating meal food'],
    ['utensils-crossed', 'Knife and fork', 'eating meal restaurant'],
    ['chef-hat', 'Chef hat', 'cooking food catering'],
    'cooking-pot',
    ['microwave', 'Microwave', 'kitchen cooking appliance'],
    ['refrigerator', 'Fridge', 'kitchen food appliance'],
    ['blender', 'Blender', 'kitchen cooking appliance -cocktail'],
    ['vegan', 'Vegan', 'diet plant based food'],
    ['armchair', 'Armchair', 'furniture home seat'],
    ['sofa', 'Sofa', 'furniture home seat'],
    ['rocking-chair', 'Rocking chair', 'furniture home seat'],
    ['shelving-unit', 'Shelves', 'furniture storage home'],
    ['lamp', 'Lamp', 'light home furniture'],
    ['lamp-desk', 'Desk lamp', 'light study home'],
    ['lamp-ceiling', 'Ceiling light', 'light home room'],
    ['blinds', 'Blinds', 'window home light'],
    ['fan', 'Fan', 'cooling air home'],
    ['air-vent', 'Air vent', 'ventilation air home'],
    ['heater', 'Radiator', 'heating warmth home'],
    ['washing-machine', 'Washing machine', 'laundry appliance home'],
    ['bath', 'Bath', 'washing home bathroom'],
    ['broom', 'Broom', 'cleaning tidy home'],
    ['shirt', 'Shirt', 'clothing uniform wear'],
    ['glasses', 'Glasses', 'sight reading wear'],
    ['hat-glasses', 'Disguise', 'costume pretend fun'],
    ['hammer', 'Hammer', 'tool making dt workshop'],
    ['wrench', 'Spanner', 'tool making repair'],
    ['drill', 'Drill', 'tool making dt workshop'],
    ['axe', 'Axe', 'tool cutting wood'],
    ['pickaxe', 'Pickaxe', 'tool mining digging'],
    ['anvil', 'Anvil', 'metalwork forge making'],
    ['spool', 'Reel of thread', 'sewing textiles making'],
    ['toolbox', 'Toolbox', 'tools making repair'],
    ['tool-case', 'Tool case', 'tools kit making'],
    ['bow-arrow', 'Bow and arrow', 'archery aim history'],
    ['fire-extinguisher', 'Fire extinguisher', 'safety emergency lab'],
    ['trash', 'Bin', 'waste rubbish discard'],
    ['mailbox', 'Postbox', 'post letter send'],
    ['mail', 'Letter', 'post message write'],
    ['mail-open', 'Opened letter', 'post message read'],
    ['send', 'Send', 'post message deliver'],
    ['phone', 'Telephone', 'call contact communication'],
    ['gamepad-2', 'Game controller', 'games play digital'],
    ['joystick', 'Joystick', 'games play retro'],
  ]],
};

/**
 * The Tabler half. Same shape as CATALOG, same category keys, plus an
 * optional fourth field: the name of the file in Tabler when our id
 * differs from it.
 *
 * The rename is not cosmetic. 640 names exist in both sets — `cross`,
 * `atom`, `medal`, `flame` — and a deck file stores the id, so two icons
 * answering to one token would be a slide that changes meaning when the
 * catalog is rebuilt. Ours are named for what a teacher would call them
 * and the duplicate guard below catches any that still collide.
 */
const TABLER = {
  letters: ['Letters & numbers', [
    ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [
      `letter-${c}`, `Letter ${c.toUpperCase()}`,
      `label option ${c} alphabet`, `circle-letter-${c}`,
    ]),
    ...Array.from({ length: 10 }, (_, n) => [
      `number-${n}`, `Number ${n}`,
      `label step count ${n} numeral`, `circle-number-${n}`,
    ]),
  ]],

  maths: [null, [
    ['abacus', 'Abacus', 'counting arithmetic place value'],
    ['greater-than', 'Greater than', 'inequality compare more', 'math-greater'],
    ['less-than', 'Less than', 'inequality compare fewer', 'math-lower'],
    ['greater-equal', 'Greater or equal', 'inequality compare at least', 'math-equal-greater'],
    ['less-equal', 'Less or equal', 'inequality compare at most', 'math-equal-lower'],
    ['plus-minus', 'Plus or minus', 'tolerance error range uncertainty'],
    ['integral', 'Integral', 'calculus area under curve', 'math-integral'],
    ['sine', 'Sine', 'trigonometry trig wave ratio', 'math-sin'],
    ['cosine', 'Cosine', 'trigonometry trig ratio', 'math-cos'],
    ['tangent-ratio', 'Tangent (tg)', 'tan trigonometry trig opposite adjacent', 'math-tg'],
    // Tabler draws the continental "tg". The label says so rather than
    // promising a "tan" glyph the art does not have; the tag still finds it.
    //
    // Its `math-avg` did not survive that test: it draws a circle with a
    // slash, which is Scandinavian for an average and reads as diameter
    // or the empty set to everyone this app is for. A maths icon has to
    // be right, not close, so there is no average here at all.
    ['maximum', 'Maximum', 'largest greatest statistics', 'math-max'],
    ['minimum', 'Minimum', 'smallest least statistics', 'math-min'],
    ['one-half', 'One half', 'fraction part share', 'math-1-divide-2'],
    ['one-third', 'One third', 'fraction part share', 'math-1-divide-3'],
    ['exponent', 'To the power of', 'index power squared cubed', 'x-power-y'],
    ['matrix', 'Matrix', 'array grid linear algebra'],
    ['decimal', 'Decimal', 'place value point number'],
    ['square-brackets', 'Square brackets', 'notation grouping interval', 'brackets'],
    ['alpha', 'Alpha', 'greek letter angle constant'],
    ['beta', 'Beta', 'greek letter angle coefficient'],
    ['delta', 'Delta', 'greek letter change difference'],
    ['lambda', 'Lambda', 'greek letter wavelength'],
  ]],

  computing: [null, [
    ['logic-and', 'AND gate', 'logic boolean circuit truth table'],
    ['logic-or', 'OR gate', 'logic boolean circuit truth table'],
    ['logic-not', 'NOT gate', 'logic boolean inverter circuit'],
    ['logic-xor', 'XOR gate', 'logic boolean exclusive circuit'],
    ['logic-nand', 'NAND gate', 'logic boolean circuit'],
    ['logic-nor', 'NOR gate', 'logic boolean circuit'],
    ['logic-xnor', 'XNOR gate', 'logic boolean circuit'],
    ['logic-buffer', 'Buffer gate', 'logic boolean circuit'],
  ]],

  science: [null, [
    ['prism', 'Prism', 'optics light refraction spectrum physics'],
    ['pendulum', 'Pendulum', 'physics oscillation period swing'],
    ['planet', 'Planet', 'astronomy space orbit'],
    ['galaxy', 'Galaxy', 'astronomy space stars spiral'],
    ['comet', 'Comet', 'astronomy space ice tail'],
    ['volcano', 'Volcano', 'geology eruption geography plates'],
    ['iceberg', 'Iceberg', 'geography climate polar ice'],
    ['virus', 'Virus', 'biology microbe infection disease'],
    ['butterfly', 'Butterfly', 'biology life cycle metamorphosis insect'],
    ['spider', 'Spider', 'biology arachnid minibeast'],
    ['acorn', 'Acorn', 'biology seed oak autumn'],
    ['leaf-maple', 'Maple leaf', 'biology autumn tree'],
    ['clover', 'Clover', 'biology plant luck'],
    ['cactus', 'Cactus', 'biology desert adaptation plant'],
    ['horse', 'Horse', 'animal zoology mammal'],
    ['deer', 'Deer', 'animal zoology woodland'],
    ['pig', 'Pig', 'animal zoology farm'],
    ['bat', 'Bat', 'animal zoology nocturnal mammal -blood -vampire -scary'],
    ['windmill', 'Wind turbine', 'renewable energy sustainability'],
    ['celsius', 'Celsius', 'temperature scale measure', 'temperature-celsius'],
    ['fahrenheit', 'Fahrenheit', 'temperature scale measure', 'temperature-fahrenheit'],
    ['snowman', 'Snowman', 'winter snow seasons'],
  ]],

  health: [null, [
    ['lungs', 'Lungs', 'anatomy breathing respiration organ'],
    ['tooth', 'Tooth', 'anatomy dental hygiene', 'dental'],
    ['vaccine', 'Vaccine', 'immunity medicine injection'],
    ['nurse', 'Nurse', 'medicine care hospital'],
    ['wheelchair', 'Wheelchair', 'accessibility mobility inclusion'],
    ['walk', 'Walking', 'sport pe movement active'],
    ['run', 'Running', 'sport pe athletics movement'],
    ['yoga', 'Yoga', 'sport pe stretch wellbeing'],
    ['stretching', 'Stretching', 'sport pe warm up'],
    ['swimming', 'Swimming', 'sport pe water stroke'],
    ['jump-rope', 'Skipping rope', 'sport pe playground'],
    ['basketball', 'Basketball', 'sport pe ball team', 'ball-basketball'],
    ['football', 'Football', 'sport pe soccer ball team', 'ball-football'],
    ['baseball', 'Baseball', 'sport pe ball rounders', 'ball-baseball'],
    ['tennis-ball', 'Tennis ball', 'sport pe racket', 'ball-tennis'],
    ['american-football', 'American football', 'sport pe ball team', 'ball-american-football'],
    ['rugby', 'Rugby', 'sport pe ball team'],
    ['cricket', 'Cricket', 'sport pe bat ball'],
    ['golf', 'Golf', 'sport pe club course'],
    ['table-tennis', 'Table tennis', 'sport pe bat ping pong', 'ping-pong'],
    ['ice-skating', 'Ice skating', 'sport pe winter'],
    ['skateboarding', 'Skateboarding', 'sport pe wheels'],
    ['scoreboard', 'Scoreboard', 'sport pe results score match'],
    ['olympics', 'Olympic rings', 'sport games international'],
    ['helmet', 'Helmet', 'sport safety protection'],
  ]],

  humanities: [null, [
    ['peace', 'Peace', 'symbol protest civics'],
    ['abc', 'ABC', 'literacy alphabet phonics reading'],
    ['vocabulary', 'Vocabulary', 'words language literacy glossary'],
    ['books', 'Books', 'reading library literature'],
    ['handwriting', 'Handwriting', 'writing script literacy', 'writing-sign'],
    ['signature', 'Signature', 'sign name authority document'],
    ['copyright', 'Copyright', 'rights media literacy attribution'],
    ['trademark', 'Trademark', 'rights branding media literacy'],
  ]],

  charts: [null, [
    ['chart-histogram', 'Histogram', 'data distribution frequency statistics'],
    ['chart-donut', 'Doughnut chart', 'data proportion statistics'],
    ['chart-radar', 'Radar chart', 'data compare dimensions statistics'],
    ['chart-bubble', 'Bubble chart', 'data scatter size statistics'],
  ]],

  classroom: [null, [
    ['chalkboard', 'Chalkboard', 'blackboard teaching front of class'],
    ['certificate', 'Certificate', 'award achievement qualification -death -birth'],
  ]],

  everyday: [null, [
    ['bread', 'Bread', 'food staple baking'],
    ['cheese', 'Cheese', 'food dairy nutrition'],
    ['mushroom', 'Mushroom', 'food fungi nature'],
  ]],
};

// ---------------------------------------------------------------------

/** Pull the inner markup out of an icon SVG, collapsed onto one line. */
function inner(id, src) {
  const raw = readFileSync(new URL(`${id}.svg`, src.dir), 'utf8');
  const body = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    // Tabler opens every icon with a full-bleed transparent square. It is
    // invisible, but it is also a 24x24 path in the bounding box of art
    // that elementSvg draws with overflow visible — and it is the same
    // dead 40 bytes in all of them.
    .replace(/<path\s+stroke="none"\s+d="M0 0h24v24H0z"\s+fill="none"\s*\/>/g, '');
  return body
    .replace(/\s*\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\/>/g, '/>')
    .trim();
}

/**
 * Our tags, then Lucide's, deduped and with anything already in the label
 * dropped.
 *
 * The label is searched separately and scores higher than a tag, so a tag
 * repeating a word from the label is dead weight in every row of the file.
 */
function tagsFor(id, own, label, src) {
  const said = new Set(label.toLowerCase().split(/[\s-]+/).filter(Boolean));
  const mine = String(own || '').split(/\s+/).filter(Boolean);

  // A leading minus drops an upstream tag. Lucide tags the tally marks
  // "prison cell sentence", which is fair enough for a general icon set
  // and wrong for this one: a science teacher searching "cell" should not
  // be shown five prison walls, and neither should the English teacher
  // who typed "sentence". Blanket word-banning would be worse — "drug"
  // belongs on the pill and "weapon" belongs on the sword — so removal
  // is per icon, where somebody has actually looked at it.
  const veto = new Set(mine.filter((t) => t.startsWith('-')).map((t) => t.slice(1)));

  // Upstream tags are sometimes phrases — "font size", "passive
  // aggressive". Search splits on whitespace anyway, so they are stored
  // as words: it is the only way a veto or a dedupe can see them.
  const words = [...mine.filter((t) => !t.startsWith('-')), ...(src.tags[id] || [])]
    .flatMap((tag) => String(tag).toLowerCase().split(/\s+/));

  const out = [];
  for (const t of words) {
    const w = t.trim();
    if (!w || said.has(w) || veto.has(w)) continue;
    said.add(w);
    out.push(w);
  }
  return out.join(' ');
}

const out = [];
const meta = [];
const seen = new Map();
const missing = [];
const counts = { lucide: 0, tabler: 0 };

/**
 * Walk one source's half of the catalog.
 *
 * Both halves key on the same category names, so `letters` can be pure
 * Tabler while `maths` is mostly Lucide with the inequality signs bolted
 * on. The category label is declared once, by whichever half declares it.
 */
const labels = {};
function collect(catalog, srcName) {
  const src = SOURCES[srcName];
  for (const [cat, [label, items]] of Object.entries(catalog)) {
    if (label) labels[cat] = label;
    for (const item of items) {
      const [id, name, tags, file] = Array.isArray(item) ? item : [item];
      // ICON_PATHS is an object and ICON_INDEX is a list, so a duplicate id
      // shrinks one and not the other — it silently drops the icon from the
      // first category that claimed it. Refuse instead.
      if (seen.has(id)) {
        throw new Error(`duplicate id "${id}" in ${cat}, already in ${seen.get(id)}`);
      }
      seen.set(id, cat);

      // Collect every bad id before failing. An upgrade renames icons in
      // batches, and finding them one build at a time is a bad afternoon.
      const from = file || id;
      let markup;
      try {
        markup = inner(from, src);
      } catch {
        missing.push(`${id} -> ${srcName}/${from} (${cat})`);
        continue;
      }
      if (!markup) throw new Error(`empty markup for ${id}`);

      const shown = name || autoLabel(id);
      out.push(`  '${id}': '${markup.replace(/'/g, "\\'")}',`);
      meta.push(`  ['${id}', '${shown.replace(/'/g, "\\'")}', '${cat}', `
        + `'${tagsFor(from, tags, shown, src).replace(/'/g, "\\'")}'],`);
      counts[srcName] += 1;
    }
  }
}

collect(CATALOG, 'lucide');
collect(TABLER, 'tabler');

if (missing.length) {
  console.error(`${missing.length} id(s) are not in their source set:`);
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

for (const cat of Object.keys(labels)) {
  if (!labels[cat]) throw new Error(`category "${cat}" has no label in either half`);
}

const count = counts.lucide + counts.tabler;

const header = `/**
 * SurveyAll — element path data. GENERATED FILE, DO NOT HAND-EDIT.
 *
 * A curated teaching subset of two icon sets, regenerated by the script at
 * tools/build-elements.mjs: ${counts.lucide} from Lucide ${SOURCES.lucide.version} (ISC) and
 * ${counts.tabler} from Tabler ${SOURCES.tabler.version} (MIT). Both licences travel with the
 * art in app/vendor/ — the same arrangement as the vendored QR encoder,
 * and the reason this app can ship ${count} icons without owing anyone an
 * attribution line on the projector.
 *
 * Both sets are drawn on the same 24x24 grid at the same stroke weight
 * with the same round caps, which is the whole reason there are two of
 * them and not five: a Tabler abacus dropped next to a Lucide microscope
 * looks drawn by the same hand. See app/elements.js for the API; the
 * hand-drawn annotation marks live there too, because they are ours.
 *
 * Search tags come from each set's own metadata where the catalog doesn't
 * override them, which is why an icon nobody thought to describe is still
 * findable by the word a teacher would actually type.
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
console.log(`wrote ${count} icons across ${Object.keys(labels).length} categories`
  + ` (${counts.lucide} Lucide, ${counts.tabler} Tabler)`);
