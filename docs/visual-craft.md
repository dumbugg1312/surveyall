# Visual & motion craft notes

What changed in the August 2026 graphics passes, and why. `npm test` stays
green; `tests/visual-check.html` `__audit()` stays `ok: true` (zero
word-cloud overlaps, zero out-of-bounds), verified across all 8 themes and
after simulated live-class runs.

Sections 1–7 are the first pass, which was purely visual/motion: no
backend, schema, or API changes. Section 8 (slide transitions) is the
second, and does touch persistence — a new key in two existing JSON
columns, no migration.

## 1. The waiting state — "the room is listening"

Every question opens with 10–30 seconds of zero responses, projected to the
whole room. Multiple choice — the most common type — used to render a rack of
dead bars reading `0% 0`.

Now, while a question is live with no answers (and only then — archived or
closed-with-zero questions say nothing about waiting):

- The value column hides; a wall of `0%` is a statement, and it isn't true yet.
- Each empty track carries a slow accent-tinted light (a `::after` sweep on
  the track, phase-offset per row via `--row-i`). It's animated with
  `background-position`, not transform, so it clips to the track's own radius
  with no overflow tricks — the empty chart reads as channels waiting to fill.
- A quiet "Waiting for the first answer…" line with pulsing dots sits under
  the chart (`awaitNote` in charts.js — one node, kept across renders so the
  dots never restart).
- The join corner steps forward (`.stage.is-awaiting` scales it via
  `font-size`, keeping the QR vector-crisp) and steps back the instant the
  first vote lands — the shrink is part of the arrival moment.

The empty states for cloud/open-ended got the same treatment via a keyed
`emptyCard` (fixes a latent bug where flipping hidden↔waiting kept stale copy).

## 2. Arrival feedback — every vote is one visible heartbeat

- Response events now coalesce through `queuePaintChart()` (one render per
  frame instead of one per WebSocket event; the springs were built to
  retarget mid-flight, so 60 phones answering in a burst costs one paint).
- The already-shipped-but-never-called `pulseCount()` now fires on the count
  pill when a new person's answer lands, and the footer number rolls on a
  `countTo` tween (tween, not spring — counters must never overshoot).
- The bar that grew fires a glint off its tip: a `.chart-glint` child of the
  fill (so it rides the spring for free and can't alter the encoded length),
  flashed by one-shot WAAPI. Scales pulse a ring off the moved marker instead.

## 3. Word cloud — identity, hierarchy, choreography

- Colour is identity: a word's hue comes from an FNV-1a hash, not its rank,
  so growing/shrinking never recolours it. The one exception: the top answer
  always wears the accent, and leadership handoffs ease over the existing CSS
  colour transition. The smallest tier mixes 22% toward soft ink — the cloud
  reads in layers.
- First fill assembles biggest-first over ~450ms (springs parked at 0,
  released on staggered `delay()` beats) instead of detonating all at once.
- Layout, sizing, and the overlap guarantees are untouched (`sizeFor`,
  spiral, and audit are byte-compatible). No rotation — rotated AABBs would
  break the overlap audit.

## 4. Quiz reveal — breath, verdict, celebration

Closing a quiz used to dim/highlight/confetti in one frame. Now three beats:
at 0ms every bar eases back a touch (the held breath), at 450ms the verdict
lands (wrong rows fall away, the correct row ignites with a spring-tied glow
and the ✓ pops), at 700ms the confetti flies — half of it in the verdict's
green. A `verdictPending` guard keeps the WebSocket echo of the session
update from fast-forwarding the beats; the 10s backstop poll holds the
settled verdict without replaying. Confetti lifetime now outlives its
slowest piece (the flat 3400ms timeout used to behead stragglers mid-fall).
Under reduced motion the whole sequence collapses to the old instant reveal.

## 5. Re-ask compare — the sentence is the slide

"N% of the room changed their answer" is now display-type at chart scale
with the number in accent, counting up on a `countTo` tween. On first paint
the round-one ghosts land first, then each "after" mark sets off *from its
ghost* a staggered beat later — the eye reads "the room was here, then it
moved". The view sizes itself from its row count (`--delta-rows` +
height-aware `min()`) so the sentence can never fall off a 720p screen.

## 6. Fonts and themes as environments

No font files shipped before: theme stacks leaned on Mac-only faces and the
never-loaded 'Inter var', so the same deck projected different type in every
classroom and every in-between weight (550/650/750) silently snapped to
400/700. Eight OFL variable fonts, self-hosted in `fonts/` with no runtime
network requests, make the design real everywhere: **Inter** (body + plain
themes), **Fraunces** (lecture-hall, letterpress, riviera…), **Oswald**
(neon-night, midnight, broadsheet…), **Caveat** (chalkboard, sorbet),
**Source Serif 4** (letterpress + broadsheet body, replacing Mac-only
'Charter'), **Playfair Display** (velvet, replacing 'Didot'), **Cinzel**
(gallery) and **Faustina** (botanical), the last two replacing 'Optima',
which rendered as Optima on a Mac, Gill Sans MT on Windows and something
else again on Linux. The projector preloads the default theme's two faces
so it never flashes fallback type.

The rule the suite now enforces (`theme typography is self-hosted`): the
**first** family in every `--display` and `--body` stack must be one we
ship, so the system faces still listed after it are insurance against a
failed download rather than what most of the room actually sees.

Each family ships as two files split on `unicode-range`, the way Google
Fonts serves them — a `latin` file and a `-ext` file covering Latin
Extended. An ASCII-only deck downloads only the first, so the common case
costs nothing; a roster with a Wojciech Łęski or a Gökçe Şahin pulls the
companion instead of dropping to a system serif mid-word, which is what
used to happen, because all four original files were latin-only.

Per-theme physical signatures hang off the previously-unused
`data-theme-id` hook, on CSS-owned surfaces only: neon-night's prompt glow
and neon-rim tracks, letterpress's hairline rules and matte (sheen-less)
ink, chalkboard's -0.4° hand-written tilt and chalk dust, high-contrast's
2px rules instead of washes. `aurora` gained a third low layer and
`grid-glow` a horizon fade.

### Theme picking is picking a look, not a colour code

The editor's theme grid was three abstract colour bars per tile. Each tile
is now a miniature of the actual slide — the theme's own background preset,
display face and chart colours, scoped onto the tile via `applyTheme` — so
the instructor chooses what the room will actually see (the deck's theme
drives the projector *and* the phone; `tests/visual-check.html` is only a
test harness). Four new themes widen the range on the colourful end while
staying classroom-professional: **Citrus Studio** (tangerine/lime, Oswald),
**Riviera** (sea teal/coral, Fraunces), **Sorbet** (raspberry/apricot,
Caveat headline), **Arcade** (dark violet with lime/magenta, Oswald).

A second wave of eight goes after range rather than more colour, each with
a background preset built for it alone rather than a recolour of an
existing one: **Observatory** (planetarium black and brass, `starfield`),
**Kiln** (terracotta and glaze-blue, `arches`), **Blueprint** (cyanotype
with white line-work, a two-scale `drafting` grid), **Gallery** (museum
white, one vermilion stroke, Cinzel on a `plinth`), **Broadsheet**
(newsprint and press-red, `halftone`), **Velvet** (theatre burgundy and
champagne gold, Playfair on a `vignette`), **Fjord** (glacier blues,
`ridgeline`) and **Rice Paper** (sumi ink and seal-red, `seigaiha` wave
crests) — twenty total, all 13-token shaped, all audit-clean.

### My themes — the custom theme builder

Instructors can build their own theme from four colours (background, text,
accent, second accent), a headline face (any of the eight shipped), a corner
shape and a backdrop preset. Everything else — surfaces, edges, soft
tints, status colours, dark-mode detection — is **derived**
(`buildCustomTheme` in themes.js), so the result is always a coherent
13-token theme, with a live WCAG contrast warning in the builder if the
text/background pick would be unreadable from the back row. The applied
theme is stored on the deck itself (`settings.customTheme`, `theme:
'custom'`) so the projector, results archive and every student phone
render it from any machine (the join payload carries sanitised tokens via
`custom_theme` — the one worker addition). The browser keeps a reusable
"My themes" library in localStorage for applying across decks.

## 7. Leaderboard, legibility, accessibility

- Leaderboard: the board builds top-down on staggered beats; climbing a rank
  flashes the row with an accent wash (WAAPI background — rows own no CSS
  background, transforms stay spring-owned); the podium is filled chips
  instead of bare numerals.
- Stage scale up ~6% (`clamp(16px, 1.3vw + 9.5px, 33px)`), charts
  height-capped (`min(1.5em, 4.8vh)`) so nothing clips at 720p; heavier
  labels/percentages; deeper track wells for dim projectors; a
  `prefers-contrast: more` mode (rules, no gloss) for any theme.
- Accessibility, aimed at the competitors' documented failures: a polite
  `#srStatus` region narrates question changes, voting state, the reveal
  (with the correct answer and how many got it), timer events, and a
  rate-limited response count. The word cloud's DOM re-sorts to frequency
  order after layout (visually inert — words are absolutely positioned), so
  screen readers hear it biggest-first instead of in arrival order. The Q&A
  drawer manages focus in and out (with a fallback when its button is in the
  collapsed tray) and keeps scroll position across live refreshes. `?` opens
  the control tray — the shortcut crib sheet is the buttons themselves. The
  phone's prompt entrance now respects reduced motion, ranking reorders are
  FLIP-animated instead of teleporting, and the submit button gives one
  physical beat on success.

## 8. Slide transitions — turning the page

Until now, advancing a slide was an instant swap: `render()` overwrote the
kicker, the prompt and the chart in place, and the only thing that moved
was whatever the new slide's own entrance choreography did. That in-place
design is load-bearing — it is why sixty phones answering at once cost one
repaint — so transitions had to be added *without* giving it up.

**The outgoing slide is photographed, not moved.** On a real slide change,
`captureSlide()` (`app/transitions.js`) deep-clones the slide's content —
`#decorBack`, `#head`, `#body`, `#foot`, `#decorFront` — into an inert
`.stage-ghost` overlay at z-index 5. `render()` then rebuilds the real
slide underneath exactly as it always has, and the two are animated as a
pair. Charts never learn that a transition happened.

Three things make the clone actually behave like a photograph:

- **It is frozen.** `cloneNode` copies class names, and a CSS animation on
  a freshly inserted node restarts from frame 0 — so without an explicit
  `animation: none !important` over the ghost subtree (pseudo-elements
  included, because the awaiting sweeps live on `::after`) the photograph
  comes alive the instant it mounts: decor replays its entrance, an urgent
  timer starts blinking again. The ghost would be the liveliest thing on
  screen.
- **It carries no identity.** Ids are stripped recursively, and
  `aria-live`/`role="status"` with them, so the room does not acquire a
  second screen-reader announcer for the slide it just left.
- **It is a photograph of the slide, not of the page.** Cloning `#stage`
  wholesale would copy the ambience backdrop (`.amb-stack` is a *child* of
  `.stage-backdrop`, not a sibling), the QR corner and the control bar.
  The backdrop holding still through the cut is what makes this read as
  one deck turning a page rather than a browser loading a document, and
  the QR holding still is a promise to the student trying to scan it.

**Six transitions**: none (default), fade, push, rise, zoom, wipe. Every
displacement is under 10% — a full-width shove reads cheap on a projector
because at thirty feet the eye tracks the whole wall moving and loses the
content. Push, rise and wipe are direction-aware, read from the two
slides' `position` rather than from the arrow key, so a slide change
arriving over the WebSocket from a second window mirrors correctly too.
Zoom is deliberately direction-blind: depth has no left and right.

**Each move is two animations, not one.** Transform wants an accelerating
exit and a decelerating arrival; opacity wants the opposite emphasis.
Both slides put their heading in the same place, so fading them on
symmetrical curves sums the pair to ~2 through the middle of the move and
the room reads two headings stacked on each other. Front-loading the exit
and back-loading the arrival keeps the sum at or under 1 — measured, the
push peaks at 0.58. WAAPI eases per keyframe interval rather than per
property, so one animation cannot carry both curves; two compose for free.

**Wipe clips both sides.** The incoming slide has no background of its own,
so revealing it over the old one does not hide the old one. The ghost is
clipped to exactly the complement of the incoming slide's clip, so every
pixel belongs to one slide at every instant. The lit edge is a sibling of
the ghost rather than a child, because the ghost is being clipped away
along that very line.

**The contents assemble a beat behind the slide.** `.stage.is-entering`
cascades kicker → prompt → chart → footer about 55ms apart, starting after
`--enter-lead` (roughly the incoming transition's own delay). This is what
turns a slide that slides in as a slab into one that arrives and composes
itself. It deliberately targets the *contents* of the three stage blocks
and never the blocks themselves, because the transition is animating those
same blocks with WAAPI at the same moment — and a WAAPI animation outranks
a CSS one on the same property, so a cascade written on `.stage-head`
would simply be discarded whenever a transition was configured.

**Storage**: `config.transition` per slide, `settings.transition` per deck,
per-slide winning. Both ride in existing JSON columns, so there is no
migration. `transition` had to join `KNOWN_SETTINGS` in the text format,
because an unrecognised `key: value` line is appended to the prompt — a
deck written by a newer build would otherwise come back with
"Why? transition: dissolve" projected as the question. It also needs its
own parse branch rather than the generic `coerce()`, which maps `off`/`no`
to the boolean `false`. The worker strips it from the participant payload:
not a leak, but the phone payload is the one thing here that gets audited
line by line, and every key with no reason to be in it is a key someone
has to reason about.

Considered and rejected: the View Transitions API, which does this
natively and handles canvas. `render()` is async and does network work
inside the update, Firefox has no support, and a classroom projector is
the worst place to discover a browser-specific fallback path. The clone
works identically everywhere, and charts here are SVG and DOM, never
canvas.

## Infrastructure

`qrcode-generator` is vendored (`app/vendor/`, MIT) instead of imported from
esm.sh at runtime — the lobby QR no longer disappears when the CDN or the
room's internet hiccups. The visual-check page now applies a chosen theme
*before* rendering (stored + reload) so its charts show true theme colours,
and it gained waiting-state panels.

## Invariants held

Quantities animate only on critically damped springs (`precise`/`smooth`);
`bouncy` stays position/entrance-only. Bars stay square at the baseline,
rounded at the tip. Poll bars carry a distinct per-option hue from the
accent-anchored wheel (`palette(root, n, 'wheel')`), option 1 still reading
as the accent; colour is decoration, so a quiz verdict still overrides the
correct row to `--good` green in `paint()` — that green, and the confetti,
remain the only colours that carry meaning. Scale distributions ramp low→high
between `--accent-2` and `--accent` so the histogram's mass reads as low or
high at a glance. Charts reuse DOM between renders.
`[hidden] { display: none !important }` stays. Nothing collects or displays
any student identity. `prefersReducedMotion()` is respected by every new
animation (and the emulated-reduce pass verifies: no sweeps, no dots, no
confetti, instant reveal, snapped springs).

Added by the transitions pass, and equally load-bearing:

- **The ghost is never alive.** Any change to `.stage-ghost` keeps the
  `animation: none !important` / `transition: none !important` blanket over
  its whole subtree including pseudo-elements. A ghost that animates is not
  a photograph.
- **`prefersReducedMotion()` is checked at the gate, every time.** Not once
  at module load, and not by leaning on `SpringGroup` — a group snapshots
  the preference at construction, so it cannot honour a later
  `setMotionStill(true)`. The print/export path depends on that check
  existing separately.
- **Nothing downstream awaits a transition.** `startSlideChange()` is
  deliberately not awaited, so `loadRows()` fires its fetch immediately; a
  room that is already answering must not watch an empty chart for the
  length of an animation.
- **Only one transition is ever in flight.** A held arrow key aborts the
  previous one rather than queueing, and `visibilitychange` sweeps any
  ghost stranded by a sleeping laptop. A stuck ghost is a full-slide
  overlay of the wrong question in front of a class, whose only obvious
  recovery is reloading mid-lecture.
- **z-index 5 is not arbitrary.** Above the front decor layer (3) so a
  slide leaves as one piece; below the join card (6) and the controls (7)
  so the QR never flickers and Next always works, including mid-transition.

### The `.stage` children rule, restated

This pass held "no new direct children of `.stage`; the overlay-lift list
is untouched", and the slide-elements pass (see `docs/elements.md`) added
one: `.decor-layer`. That is not a quiet exception, so here is the rule
the original line was really protecting.

The overlay-lift list names four in-flow blocks by hand because `:not()`
carries the specificity of its argument, and the old
`.stage > *:not(...)` selector beat every overlay's own
`position: absolute`. What must not happen is a new **in-flow** child —
it would join the flex column, push the layout, and need adding to that
list.

An absolutely-positioned overlay that sets its own `position` and
`z-index` is a different thing, and there were already six of them:
`.stage-backdrop`, `.stage-scrim`, `.join-corner`, `.stage-panel`,
`.stage-flash`, `.stage-controls`. `.decor-layer` is the seventh, at
z-index 3 — above the slide's content (2) so a mark can point at a bar,
below the join card (6) and the controls (7) so nothing an instructor
places can cover the QR the room is scanning.

The overlay-lift list itself is still untouched, which is the part that
actually matters.

One consequence worth recording: `.pair-overlay` is a child of
`.stage-body`, so it cannot stack above a layer on `.stage`. Rather than
fight the z-index, the decoration fades out under `.stage.is-pairing` —
the discussion phase is a full takeover, and stepping back is what
decoration should do during one.
