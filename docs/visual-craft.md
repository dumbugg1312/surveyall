# Visual & motion craft notes

What changed in the August 2026 graphics pass, and why. Scope was purely
visual/motion: no backend, schema, or API changes. `node tests/run-tests.mjs`
stays at 104 passing; `tests/visual-check.html` `__audit()` stays `ok: true`
(zero word-cloud overlaps, zero out-of-bounds), verified across all 8 themes
and after simulated live-class runs.

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
400/700. Four OFL latin-subset variable fonts (~220KB total, self-hosted in
`fonts/`, no runtime network requests) make the design real everywhere:
**Inter** (body + plain themes), **Fraunces** (lecture-hall, letterpress),
**Oswald** (neon-night, midnight), **Caveat** (chalkboard). The projector
preloads the default theme's two faces so it never flashes fallback type.

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
Caveat headline), **Arcade** (dark violet with lime/magenta, Oswald) —
twelve total, all 13-token shaped, all audit-clean.

### My themes — the custom theme builder

Instructors can build their own theme from four colours (background, text,
accent, second accent), a headline face (the four shipped fonts), a corner
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

## Infrastructure

`qrcode-generator` is vendored (`app/vendor/`, MIT) instead of imported from
esm.sh at runtime — the lobby QR no longer disappears when the CDN or the
room's internet hiccups. The visual-check page now applies a chosen theme
*before* rendering (stored + reload) so its charts show true theme colours,
and it gained waiting-state panels.

## Invariants held

Quantities animate only on critically damped springs (`precise`/`smooth`);
`bouncy` stays position/entrance-only. Bars stay square at the baseline,
rounded at the tip. Poll bars stay single-accent (the reveal's green and the
confetti are the sanctioned exceptions). Charts reuse DOM between renders.
`[hidden] { display: none !important }` stays. No new direct children of
`.stage`; the overlay-lift list is untouched. Nothing collects or displays
any student identity. `prefersReducedMotion()` is respected by every new
animation (and the emulated-reduce pass verifies: no sweeps, no dots, no
confetti, instant reveal, snapped springs).
