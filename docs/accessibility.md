# Accessibility — WCAG 2.1 AA

Target standard: **WCAG 2.1 Level AA**, which is what ADA Title II (28 CFR
Part 35, effective 2026–2027 for public entities), Section 508, and EN
301 549 all currently point at. Everything below is graded against that.

**Status: the colour system passes.** 1,780 automated checks across 20
built-in themes and 160 live rendered-pixel checks in a real browser,
0 failures, asserted by the test suite so it stays that way. The findings
that led here are kept below for the record — including the nine an
adversarial review pass found *in the first round of fixes*.

```bash
node tools/a11y-contrast.mjs      # ratios, per theme, per pair
node tests/run-tests.mjs          # the same checks as assertions
```

---

## The rule

**A palette colour has two jobs, and only one of them is legible.**

`--accent` on a bar is a graphical object: it needs 3:1, and it should be
as loud as the theme wants. `--accent` on a word is type: it needs 4.5:1.
On half the themes the same hex cannot do both. So every colour that can
carry text has a derived sibling, and the two never swap roles:

| Use | Token | Floor |
|---|---|---|
| A fill — bar, chip, dot, chart segment, backdrop | `--accent`, `--accent-2`, `--good`, `--bad` | 3:1 (1.4.11) |
| Type **on** one of those fills | `--on-accent`, `--on-good`, `--on-bad` | 4.5:1 (1.4.3) |
| Type **in** that colour, on the page or a panel | `--accent-text`, `--accent-2-text`, `--good-text`, `--bad-text` | 4.5:1 |
| A border that is the only thing marking out a control | `--edge-strong` | 3:1 (1.4.11) |
| A hairline between panels, decorative | `--edge` | — (exempt) |

The eight derived tokens are **computed, never authored** —
[`deriveTokens`](../app/themes.js) in `app/themes.js`, applied through
`getTheme()` so the projector, the phone, the editor preview and a saved
custom theme all see the same complete set. Adding a 21st theme or
nudging an accent cannot silently reintroduce a failure: the derivation
adjusts, and if it *can't*, `auditTheme()` reports it and the test fails.

Three practical consequences:

- **Never set type in a bare palette token.** `color: var(--accent)` is a
  bug; `color: var(--accent-text)` is the fix. On themes where the raw
  colour already clears 4.5:1 the two are the same hex, so this costs
  nothing visually — it only moves where it has to.
- **Never hardcode `#fff` on a themed fill.** Seven themes ship a light
  accent; white on `#ffd166` is 1.44:1.
- **Fills are untouched.** A test asserts `--accent`, `--accent-2`,
  `--good`, `--bad`, `--ground` and `--ink` come out of the derivation
  byte-identical to what the theme author wrote. Citrus Studio is exactly
  as loud as it was.

---

## What each fix was

### 1. Text on themed fills — 1.4.3

`color: #fff` was written literally against `background: var(--accent)`
in nine places, including the primary button on every page. White on
chalkboard's `#ffd76e` was **1.38:1**; blueprint's `#ffd166`, **1.44:1**.
White on `--good` failed in 11 themes, on `--bad` in 7.

Now `--on-accent` / `--on-good` / `--on-bad`, derived per theme. The
derivation prefers a colour the theme already uses — `--ground` first,
then `--ink` — so a button reads as part of the palette rather than a
white sticker, and only falls back to hard black or white when neither
clears AA.

### 2. Focus indicator — 1.4.11, 2.4.7

This one took three attempts, and the first two are worth recording
because each looked correct and failed somewhere a static check could
not see.

`--focus` began as `color-mix(in srgb, var(--accent) 45%, transparent)`.
At 45% alpha the ring composites toward whatever it sits on; it cleared
3:1 in **3 of 40** theme/surface combinations (worst: 1.74:1).

The second attempt was two solid box-shadow rings. Solid fixed the
contrast, but a box-shadow is painted in the element's background layer,
and that has two consequences:

- **A component's own `box-shadow` replaces it.** `.rail-item.is-selected
  .rail-thumb`, `.theme-tile.is-active` and `.decor-chip.is-selected` all
  draw a selection ring that way, at higher specificity — so a
  selected-and-focused tile showed no focus at all. Reproduced in Chrome.
- **An ancestor's `overflow: hidden` clips it away entirely.**
  `.heatmap-control .seg-row` wraps the heat-map segment buttons with
  zero clip room on all four sides: 100% of the ring erased.

The third and current attempt is an **outline** — `3px solid
var(--accent)` at a 2px offset. An outline is not in the background
layer, so a component's selection shadow and the focus ring now coexist,
and forced-colors mode honours an outline natively. Outlines *are* still
clipped by ancestor overflow, so inside the two known clipping wrappers
the offset flips negative and the ring is drawn just inside the control's
own box — same ring, same contrast, other side of the edge.

Every per-element `outline: none` override went away with it; there is no
longer anything for them to suppress. Verified live across all 20 themes:
solid, 3px, 2px offset everywhere, minimum 3.4:1 against the page.

> **Two corrections to the first audit.** It reported five places where
> focus was "disabled outright", three with no fallback — wrong: those
> rules set `outline: none` but not `box-shadow`, so the base ring still
> applied. And it never checked `forced-colors`, where the box-shadow
> ring vanished completely while `outline: none` was still honoured. That
> gap is now closed explicitly.

### 3. Control borders — 1.4.11

Inputs, selects, textareas and `.btn` are `background: var(--surface)` on
a `--ground` page. `--surface` vs `--ground` runs 1.00–1.23:1 in every
theme, so the border is the *only* thing that marks out the control — and
`--edge` cleared 3:1 in **zero** themes (1.18–1.75:1).

`--edge` now keeps its job as a decorative hairline (exempt under
1.4.11), and interactive boundaries use `--edge-strong`, derived by
walking `--edge` toward `--ink` and stopping at the first step that
clears 3:1 against both `--surface` and `--ground` — so it keeps as much
of the original hairline's character as the floor allows.

The first pass converted only `base.css`, which left **the entire student
answering surface on the weak token** — `.opt` and `.opt-marker` (the
radio/checkbox glyph itself, which has no background until selected, so
the border *is* the control), `.scale-btn`, `.conf-btn`, `.sample-pick`,
`.seg-body`, `.seg-chip`, `.rank-move`, `.qa-vote`, `.mood-btn`,
`.tot-btn`, `.budget-step`, `.match-select` and more, at 1.18–1.55:1.
Thirty-odd rules across `join.css`, `app.css` and `present.css` now use
`--edge-strong`, including the hover-state mixes, which must not drop
below the floor the base state guarantees. Containers that merely group
controls (`.rank-item`, `.scale-item`, `.qa-card`, `kbd`) keep `--edge`:
they are decoration, and 1.4.11 exempts them.

The base selector list is also complete now rather than partial —
`search`, `tel`, `url`, `date` and `time` were missing, and an input type
left out of that list falls back to the UA's white box while inheriting
`--ink` for its text.

**Found while verifying this in the browser:** the join-code input on the
landing page carried no `type` attribute, so `input[type="text"]` had
never matched it. It was rendering with the UA default border *and the UA
default white background*, while inheriting `--ink` for its text — which
on the six dark themes meant near-white text on white, **1.06:1, an
invisible input on the first screen a student sees**. Fixed by giving it an explicit `type="text"`; worst case across 20 themes
is now 9.28:1. (The field has since moved off the home page — the code
entry a student sees is built in
[app/join-page.js](../app/join-page.js), and it still carries the
attribute.)

Adding that attribute then caused a second, quieter bug: `input[type=
"text"]` is (0,1,1) and outranks `.code-input` at (0,1,0), so base.css
silently took over the field's padding, border width and corner radius.
The selector is now `input.code-input`, which matches that specificity
and wins on source order. Worth remembering as a general hazard — fixing
a *missing* match can hand an element to a rule that was never meant to
style it.

### 4. The custom theme builder — 1.4.3

It checked one pair (`--ink` vs `--ground`) and only *warned*, so an
instructor could save and project anyway. Everything else was derived
with no floor: sweeping 25 ground/ink combinations, **17 produced an AA
failure**, and white ink on a white ground saved a 1.00:1 theme silently.

Now `buildCustomTheme` runs the same derivation as the built-ins, plus a
clamp on `--ink-soft` (the 35% walk toward the background is the look we
want, but on a close pair it lands under AA, so it pulls back toward the
ink until it clears). What survives to the warning is a pick the
derivation genuinely cannot rescue — and the Save button is now
**disabled** while any pair fails, with the click handler re-checking so
a stale or scripted click can't slip past. The message names the specific
pair and ratio.

Deliberately *not* auto-corrected: `--ink`, `--accent` and `--accent-2`
are stated by the instructor. Silently darkening a colour they picked
would mean the swatch and the slide disagree. Those get refused, not
rewritten.

### 5. Chart palettes — 1.4.11

`hueWheel` has always searched OKLab lightness for the most saturated hue
that clears its contrast floor; `harmonicSeries`, which draws donut
segments and cloud words, had no floor. On citrus-studio — tangerine to
lime, both light — **16 of 64** swatches fell below 3:1 (worst 2.69:1).

`harmonicSeries` now takes the same `bg` and floor. Holding lightness
steady is what makes the set read as one family *and* what produced the
illegal swatches, so the clamp is per-swatch and as small as possible:
only the offending members move, the family holds together.

Rather than repaint three themes' accent-2 (the first audit's
suggestion), the fill stays vivid and `--accent-2-text` carries the type.
Citrus keeps its lime.

### 6. Icon-only rank buttons — 4.1.2, and the focus they threw away

The ▲/▼ ranking controls had the glyph as text content and no label —
announced as "black up-pointing triangle, button". Now the glyph is
`aria-hidden` inside a labelled button, and the label names the row
(`Move "Photosynthesis" up`), because "Move up" on its own says nothing
about which of eight options is about to move. The remove button, which
had only a `title`, went through the same path.

### Beyond the six

Fixing item 1 exposed the same defect one level out: `a { color:
var(--accent) }` and 38 other declarations set type in a raw palette
token. At body size that is a 1.4.3 failure at 3.40:1 on citrus-studio,
3.99:1 on riviera, 4.10:1 on clean-slate, and similar on kiln, gallery
and fjord — the "large text only" warnings from the first audit, which
are only compliant if every one of those call sites happens to be ≥24px.
They aren't.

Since the machinery was already there, `--accent-text`, `--good-text` and
`--bad-text` joined `--accent-2-text`, and all 39 declarations moved. Each
is derived against every background that colour's type actually lands on
— the page, a panel, **and its own tinted chip**, which is what closes the
`--accent-soft` chip cases (3.03–4.48:1 across seven themes).

### Text the CSS audit could not see

Four chart colours are set from JavaScript, so no amount of CSS grepping
finds them. All four were drawing **text** in a colour picked for a
*shape*:

| Where | Was | Now |
|---|---|---|
| Word-cloud words ([charts.js](../app/charts.js)) | `hueWheel` at its 3.3:1 mark floor — 3.30:1 worst | same wheel at the type floor — 4.55:1 worst |
| Exit-ticket column headings | `harmonicSeries` at 3.05:1 — 3.09:1 on citrus | type floor — 4.56:1 worst |
| Leaderboard rank numbers | `rgba(--ink, .55)` — 3.29:1 on riviera | `--ink-soft` |
| Heat-map counts | `rgba(--ink, .60)` — 3.78:1 on riviera | `--ink-soft` |

`palette()` in `charts.js` now takes the floor from its caller —
`MARK_CONTRAST` (3.05, a bar or a segment) or `TYPE_CONTRAST` (4.55, a
word). The wheel searches for the most saturated hue that clears whatever
floor it is given, so raising it costs saturation, not distinctness: the
closest pair of the twelve cloud colours is still ΔE 0.041 in OKLab,
about twice a just-noticeable difference.

The two `rgba(--ink, α)` washes became `--ink-soft`, which is what that
token is for and, unlike an alpha wash, carries a guaranteed 4.5:1 floor
in every theme. An alpha wash carries whatever it happens to land on.

This is why the projector-versus-phone distinction matters: at lecture-hall
size all four were comfortably "large text" and compliant. The same
markup on a student's phone, and in the archived results page, is not.

### What the adversarial review caught in the fixes

Three independent reviewers went over the first round of fixes and each
finding was then handed to a separate agent told to *refute* it. Nine
survived; five were killed as unreachable, already-handled, or misread
cascade. Two of the nine were regressions the fixes themselves
introduced, both above: the `.code-input` specificity flip, and a
`ctWarn` message that was never cleared — harmless as a stale string
until `aria-describedby` turned it into the Save button's description,
at which point a valid theme was announced as broken.

The rest are folded into the sections above. The pattern worth keeping:

- **Half-applied rules are the dangerous kind.** `--edge-strong` in
  `base.css` alone read as "control borders are fixed" while every
  control a *student* touches was still on the weak token. A rule written
  down in a doc and applied to one file is worse than not writing it
  down, because the doc now lies.
- **A colour audit that only knows plain surfaces is not an audit.** The
  tinted-chip gap and the `color-mix(...var(--accent) 80%, var(--ink))`
  gap both passed a clean 1,680-check run.
- **Two components sharing an unscoped class name.** `.seg` was defined
  twice; the later block styled both, so the dashboard's response filter
  had been silently wearing the decor editor's clothes. The decor one is
  now `.decor-seg`.

### A bug the fix itself had

The first derivation chose which way to push a colour with
`luminance(bg) > 0.4`. The black/white crossover is at ~0.18, so any
threshold picked by eye sends mid-tone backgrounds the wrong way: on
`#8a8a8a`, white tops out at 3.4:1 while black reaches 5.9:1 — the
derivation was making type *less* legible on exactly the backgrounds that
needed help most. Both sites now compare the two poles instead of
thresholding ([themes.js](../app/themes.js), and `legible()` in
[motion.js](../app/motion.js)). A test pins it.

---

## Verified in the browser

Static analysis can't prove the CSS is wired to the tokens. Every theme
was applied to a live page and the **rendered** colours measured: 140
checks (input text and border, primary button, secondary button text and
border, body copy, footer link × 20 themes), **0 failures**.

Two readings looked like failures and weren't: the pane's tab is
throttled, so CSS `transition`s never advance and every property *with* a
transition reported its pre-theme value. Disabling transitions before
measuring resolved both. Worth knowing before trusting a `getComputedStyle`
sweep — the tell is that only transitioned properties look stuck.

---

## Passing — verified, don't regress

- **Body text.** `--ink` on `--ground` and on `--surface` clears 4.5:1 in
  all 20 themes; `--ink-soft` likewise (blueprint and fjord were 4.43 and
  4.37 and were nudged to 4.64 and 4.70).
- **Chart series colour.** 0 failures in 640 `hueWheel` swatches and, now,
  640 `harmonicSeries` swatches.
- **Colour is never the sole signal.** Quiz correctness adds a ✓ glyph and
  `font-weight: 700` ([charts.css](../styles/charts.css)) — 1.4.1.
- **Motion.** A global `prefers-reduced-motion` block
  ([base.css](../styles/base.css)) zeroes animation and transition
  duration everywhere, student phone included (2.3.3, 2.2.2).
- **High contrast.** `prefers-contrast: more` blocks in `present.css` and
  `charts.css`, plus a dedicated `high-contrast` theme.
- **Zoom.** Every page sets `width=device-width, initial-scale=1` with no
  `user-scalable=no` or `maximum-scale` — 1.4.4 clean.
- **Structure.** `lang="en"` and a unique `<title>` on all 7 pages; no
  `<img>` without `alt`; `aria-live="polite"` status regions on join,
  dashboard and present.
- **Keyboard.** The student interactions are real
  `<button type="button">` with `aria-pressed`; ranking offers ▲/▼
  buttons rather than drag-only reordering. No `div`-with-onclick found.
- **Touch targets.** Join controls are ≥3.4rem (~54px), over the 24×24 of
  2.5.8 and the 44×44 of 2.5.5 AAA.

---

## Still open — needs a live screen reader, not static analysis

1. **SVG chart alternatives (1.1.1).** `charts.js` is ~2,700 lines and
   carries three `aria-label`s. The projector charts are arguably
   decorative while the presenter narrates them, but the **student phone**
   and the **results archive** render the same charts as primary content
   with no text equivalent. A `<table class="sr-only">` of the same
   aggregate would settle it. *This is the largest remaining gap.*
2. **Live-region churn (4.1.3).** Results update continuously as votes
   land; whether the polite regions announce usefully or flood the
   listener is a runtime question.
3. **Focus order and focus return** through the modal dialogs (theme
   builder, element picker) — 2.4.3, and focus-trap behaviour.
4. **Reflow at 320px / 400% zoom (1.4.10)** on the editor, the densest
   layout.
5. **The decor layer** ([elements-editor.js](../app/elements-editor.js)).
   The handle has a `keydown` listener, so a keyboard path exists;
   whether it is discoverable and announced is untested.
