# Accessibility — WCAG 2.1 AA

Target standard: **WCAG 2.1 Level AA**, which is what ADA Title II (28 CFR
Part 35, effective 2026–2027 for public entities), Section 508, and EN
301 549 all currently point at. Everything below is graded against that.

**Status: the colour system passes.** 1,680 automated checks across 20
built-in themes and 160 live rendered-pixel checks in a real browser,
0 failures, asserted by the test suite so it stays that way. The findings
that led here are kept at the bottom for the record.

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

`--focus` was `color-mix(in srgb, var(--accent) 45%, transparent)`. At
45% alpha the ring composites toward whatever it sits on; it cleared 3:1
in **3 of 40** theme/surface combinations (worst: citrus-studio 1.74:1).

Now two solid rings — `0 0 0 2px var(--ground), 0 0 0 5px var(--accent)`.
The inner ground-coloured ring separates the accent from the control so
the indicator holds on both light and dark surfaces. `--accent` clears
3:1 against `--ground` and `--surface` in all 20 themes, asserted.

Two per-element overrides also replaced their own weak rings with
`var(--focus)`: `.decor-handle` (a 28%-alpha wash) and `.swatch` (which
wore the *same* ring as its selected state, so focus and selection were
indistinguishable).

> **Correction to the first audit.** It reported five places where focus
> was "disabled outright", three with no fallback. That was wrong, and
> the browser is what showed it: those rules set `outline: none` but not
> `box-shadow`, so the base `:focus-visible` ring still applied to every
> one of them. The real defect was the base ring itself, which is what
> changed. Verified live — tabbing to the join button yields
> `rgb(255,248,239) 0 0 0 2px, rgb(232,89,12) 0 0 0 5px`.

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

**Found while verifying this in the browser:** the join-code input on the
landing page carried no `type` attribute, so `input[type="text"]` had
never matched it. It was rendering with the UA default border *and the UA
default white background*, while inheriting `--ink` for its text — which
on the six dark themes meant near-white text on white, **1.06:1, an
invisible input on the first screen a student sees**. Fixed at
[index.html:21](../index.html:21); the input now themes with everything
else (worst case across 20 themes is now 9.28:1).

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

### 6. Icon-only rank buttons — 4.1.2

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
