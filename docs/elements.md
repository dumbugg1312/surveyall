# Slide elements

Instructors can place icons and annotation marks on a slide — the thing
people mean when they ask for "Canva, but for this". 907 elements across
fifteen teaching categories: 752 curated from Lucide (ISC), 131 from
Tabler (MIT), and 24 annotation marks drawn for this app.

This note is about the two decisions that shaped it, because both of them
say no to the obvious version of the feature.

## Placement is free, but stored as a percentage

Drag an element anywhere on the slide. What gets stored is `x` and `y` as
a **percentage of the slide**, never a pixel.

That matters because the same deck is drawn at four very different sizes:
a 9rem rail thumbnail, the editor canvas, a student's phone, and whatever
the lecture hall's projector happens to be — often a dim 1280×720. A
pixel coordinate is only true at the resolution it was authored on. An
element placed on a 4K laptop would land somewhere else entirely at 720p,
and what it landed on might be the QR code the room is trying to scan.

A percentage is true everywhere, which is why every other measurement on
the projector side is relative too.

It also round-trips cleanly through the plain-text deck format, but that
is a convenience rather than the reason — that format predates this
feature and elements simply had to not break it.

### Snapping is a guide, not a grid

This began as a grid of named slots. It grew to 45, at which point the
grid had stopped being "a few meaningful places" and become a clumsy
coordinate system — so it was replaced by free placement plus the help a
design tool actually gives you:

- **Alignment guides** appear when you come within ~1.4% of the slide's
  centre, its thirds, its margins, or **another element's centre** — that
  last one being the one that matters, because two marks a hair out of
  line is what makes a slide look homemade.
- **Hold Alt** to ignore them and place freehand.
- **Arrow keys** nudge by 0.5%; **Shift+arrow** by 5%.
There is no position control in the panel and no grid of buttons: you
drag it where you want it, and the handle takes arrow keys. A pad of nine
buttons and a pair of percentage boxes were two more ways to say the same
thing.

The nine names still parse (`@ top-right`), and are written back out
whenever an element sits exactly on one, so ordinary decks stay readable.
Decks written against the old grid are unaffected.

### The reserved areas are shaded, not fenced

The join card (bottom-right) and the control bar (bottom-centre) are
hatched while you drag. They are advice, not a rule, because the
guarantee is structural rather than positional: the decor layer is
z-index 3, the join card 6, the controls 7. **Nothing an instructor can
place anywhere is able to cover the QR the room is scanning.**

## Front or behind the content

Each element chooses which side of the slide's content it sits on.

- **In front** (default) — over the question and the results. A mark is an
  annotation: an arrow pointing at a bar has to be on top of the bar or it
  is pointing at nothing.
- **Behind** — under the question and the results. A big faint microscope
  reads far better as a watermark than as a sticker, and it is the only
  way to use one large without burying the text.

This is two DOM layers, not per-item `z-index`. One layer cannot go below
the content at all — the layer itself would still be above it.

The stack on the projector:

```
7  control bar
6  join card (the QR)
3  decor — in front
2  slide content: prompt, chart, footer
1  decor — behind      (ties with the scrim; later in the DOM, so it wins)
1  scrim
0  backdrop
```

"Behind" is still above the backdrop and its scrim, so a watermark sits on
the slide rather than in the wallpaper. And both layers stay below 6,
which is the structural guarantee that **nothing placed anywhere can
cover the QR the room is scanning**.

In a deck file it is the word `behind`; `front` is the default and is
never written out.

## Colour defaults to a theme token

An element's stroke and fill are stored as *tokens* — `accent`, `ink`,
`good` — not as colours. So a microscope dropped on a Chalkboard slide
comes out chalk-yellow, and the same slide in Neon Night comes out neon,
with no per-theme variants to maintain.

That is the actual thing people like about Canva ("whatever I drag in
looks like it belongs") and it is the part a sticker library cannot keep,
because a sticker is a picture with its colours baked in.

Custom hex is available on every colour control for the instructor who
genuinely wants their department's blue. It just isn't the default, and
it does not re-theme — which is the honest trade and why the tokens come
first in the picker.

## What an element carries

| property | values | default |
|---|---|---|
| `x`, `y` | 0–100, a percentage of the slide, to 0.1 | top-right corner |
| `layer` | `front` or `behind` | `front` |
| `size` | `xs` `sm` `md` `lg` `xl` — a % of slide **height** | `md` |
| `stroke` | colour token, `#hex`, or `none` | `accent` |
| `fill` | colour token, `#hex`, or `none` | `none` |
| `w` | stroke weight: 0, 1, 1.5, 2, 2.5, 3, 4 | `2` |
| `rot` | degrees, snapped to 15° | `0` |
| `flip` | mirrored horizontally | `false` |
| `op` | 5–100 | `100` |

Twelve elements per slide, capped. Everything above passes through
`normaliseDecor()` — the parser, the editor and the renderers all use it,
so a hand-typed line and a dragged one cannot disagree.

Two rules the normaliser enforces that are worth knowing:

- **Open paths refuse a fill.** An arc, a brace, an underline has no
  inside; filling it produces a blob. The editor hides the control and
  the parser reports the line.
- **Nothing renders invisible.** Weight 0 *and* no fill would be an
  element the instructor cannot see or select, so one of the two holds.

### Sizes are `cqh`, not `em`

Everything else in this app measures in `em`. Elements can't, and this is
the one genuinely surprising bit of the implementation.

The projector sizes its `em` from the viewport
(`clamp(16px, 1.3vw + 9.5px, 33px)`) while a preview sizes its own from
its width (`5.6cqw`). Those curves do not agree — a `md` icon tuned to
look right on the projector came out at 42% of the height of a rail
thumbnail. What has to stay constant is the fraction of the *slide*, so
that is what `SIZES` stores, the decor layer declares
`container-type: size`, and the values land as `cqh`.

`tests/elements-check.html` asserts this directly: the same element in
the big canvas and in a rail thumbnail must differ in pixels by the same
ratio as the two slides differ in height.

## In a deck file

```
## multiple_choice
Which of these is a primary source?
- A textbook chapter
- [x] A soldier's letter
+ microscope @ top-right lg
+ mark-arc-right @ 31.5,68.2 accent-2 w:3 rot:15
+ mark-ring @ center stroke:bad op:60
+ microscope @ center behind xl op:15
```

`@` takes either `x,y` as percentages or one of the nine names. Order-free after the id. Bare words are taken where they are
unambiguous — `lg` can only be a size, `accent` can only be a colour — so
the common case stays short. Only non-default properties are written back
out, so a deck does not fill up with `w:2 op:100 rot:0`.

Anything unrecognised is reported against its line number rather than
ignored. A typo'd element that simply fails to appear on the projector is
the worst available outcome.

## Where the art comes from

**Lucide**, ISC licensed, vendored the same way as the QR encoder:
`app/vendor/lucide-LICENSE.txt` travels with `app/elements-data.js`. ISC
requires no attribution line, which is why nothing has to appear on a
projected slide.

**Tabler**, MIT licensed, vendored the same way:
`app/vendor/tabler-LICENSE.txt`. MIT wants the copyright notice kept with
the source, not shown to an audience, so it costs the projector nothing
either.

Lucide ships 2,025 icons and the catalog draws on 754, so the answer to
"can we add more?" is usually "widen the catalog", not "add a source". A
second source costs a second licence to honour and, worse, a second
drawing style.

Tabler is the exception because it passes the only test that matters: it
is drawn to the same spec — 24x24, stroke 2, round caps and joins — so a
Tabler abacus and a Lucide microscope on the same slide look drawn by the
same hand. It is not a second general-purpose pile. Every one of its 142
entries is something a lesson wanted and Lucide could not supply:

| what Lucide lacks | Tabler gives |
|---|---|
| logic gates | AND, OR, NOT, XOR, NAND, NOR, XNOR, buffer |
| inequalities | `<` `>` `≤` `≥`, plus-or-minus |
| trigonometry | sine, cosine, tangent, integral |
| labelling | ringed A–Z and 0–9, for options and diagram points |
| sport | eight balls, swimming, running, yoga, skating, scoreboard |
| biology | butterfly, virus, lungs, spider, tooth |
| physics | prism, pendulum, planet, galaxy, comet |

Two things to know when adding more. Tabler prefixes every icon with a
full-bleed transparent square, which the build strips. And 640 names
exist in both sets — `cross`, `atom`, `medal`, `flame` — so a Tabler
entry can name the file it came from separately from the id we give it,
because a deck stores the id and one token must mean one drawing
forever.

Deliberately not used: **Font Awesome Free** and **The Noun Project**
free tier are CC BY — they need visible credit, and a credit line on a
lecture slide is a worse feature than not having the icon. Anything from
Flaticon/Freepik carries per-asset terms nobody is going to read.
**OpenMoji** is CC BY-SA, so it wants credit *and* share-alike, and it is
coloured — which breaks the theme-token promise above. **Phosphor**,
**Heroicons**, **Bootstrap Icons**, **Material Symbols** and **Remix**
are all permissively licensed and all drawn on a different grid or at a
different weight; mixing one in means a slide where the icon you dragged
in visibly came from somewhere else.

## No religious symbols

There are none, on purpose, and it is asserted by a test rather than left
to whoever next widens the catalog.

Tabler draws symbols for most major religions — a cross, a Star of David,
om, yin-yang, an ankh, a torii, a menorah — and no star and crescent.
Neither set has one. So any selection would have represented some faiths
and left others with nothing, in a room where the instructor does not
know what every student believes. Hand-drawing the missing one, the way
the annotation marks are drawn, would have meant this app taking a
position on which symbols are canonical. Neither is a good look on a
projector.

The buildings went with the symbols. A church and a mosque are ordinary
geography and architecture content and it is a real loss, but keeping
exactly those two would have left two faiths standing and the rest
absent, which is the same problem wearing a different hat.

`scripture` came off the scrolls and `temple` off the landmark for the
same reason. Seasonal words upstream attached to secular objects were
left alone — `christmas` still finds the deer, the snowman and the
pudding, and `easter` still finds the egg — because those are the ones a
teacher plausibly types in December.

To change the catalog, edit `CATALOG` in `tools/build-elements.mjs`:

```bash
cd /tmp && npm pack lucide-static && tar xzf lucide-static-*.tgz
node tools/build-elements.mjs /tmp/package
```

The build refuses duplicate ids. It has to: `ICON_PATHS` is an object and
`ICON_INDEX` is a list, so a duplicate shrinks one and not the other and
silently drops the icon from whichever category claimed it first. It
reports every unknown id in one pass rather than one per run, because a
Lucide upgrade renames icons in batches.

A catalog entry can be a bare id. Search tags then come from Lucide's own
`tags.json`, which ships in the same package as the art — 1,767 icons'
worth of synonyms written by the people who drew them. Write tags only
for the words upstream wouldn't think of, which are the classroom ones:
Lucide tagged the calculator "arithmetic"; a teacher types "maths".

Upstream tags are not always right *here*, so a tag can be vetoed with a
leading minus. Lucide tags the tally marks "prison cell sentence", and a
science teacher searching "cell" should get the microscope. The veto is
per icon rather than a banned-word list, because "drug" belongs on the
pill and "weapon" belongs on the sword.

Tags are stored as single words even where upstream wrote a phrase.
"passive aggressive" on the slight-smile survived a whole-string veto and
still matched a search for "aggressive", because search splits on
whitespace and the veto did not.

## Keeping it safe to open in front of a class

Lucide is a general-purpose set. It has cigarettes, cannabis, martinis
and a corna hand sign, and it tags icons for a general audience — which
is how "prison", "begging", "patronizing" and "dating" arrive attached to
a tally mark, a helping hand, a smile and a kind word.

Both halves are curated on the way in: the art by choosing ids, the words
by vetoing tags. What stays is what a lesson actually needs — the sword
and the shield for history, the pills and the syringe for health, the
skull for archaeology. What goes is what earns nothing: alcohol, the
penknife, the corna.

`is safe to open in front of a class` in the test suite asserts no
element carries any of it, so a Lucide upgrade cannot quietly put it
back. `no two elements share a label` is the other half — a tile shows
its label and nothing else, so a garden "Spade" and a card-suit "Spade"
are indistinguishable in the grid.

A new category has to be added in two places — `CATALOG` here and
`CATEGORY_ORDER` in `app/elements.js`, which also needs a short tab name
in `CATEGORY_TABS`. `orphanCategories()` is the guard, asserted empty by
the test suite.

Then open `tests/elements-check.html` and look at it. A Lucide upgrade
can redraw an icon, and no unit test can tell you whether the new drawing
still reads from the back of a lecture hall.

## Files

| file | what it is |
|---|---|
| `app/elements.js` | the API — anchors, sizes, colours, normalising, drawing. The 24 annotation marks are here, because they are ours. |
| `app/elements-data.js` | generated Lucide path data. Do not hand-edit. |
| `app/elements-editor.js` | the picker, the per-element controls, the drag surface |
| `styles/elements.css` | the decor layer, shared by the projector and every preview |
| `tools/build-elements.mjs` | catalog build + curation list, both sources |
| `app/vendor/lucide-LICENSE.txt`, `tabler-LICENSE.txt` | the licences, travelling with the art |
| `tests/elements-check.html` | visual check and self-audit across all themes |

## Not included

**Image upload.** It is the obvious next ask and it is a different
project: R2 storage, size limits, and a moderation surface on an app
whose entire pitch is that it holds no student data. Worth doing
deliberately, not as a side effect of this.
