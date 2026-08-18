# Motion Overhaul Plan — "Million Dollars" Pass + Slide Transitions

Execution plan for a top-tier model. Two workstreams:

- **A. Slide transitions** — PowerPoint-style animated transitions between slides in the presenter view (new capability; nothing exists today).
- **B. Elevation pass** — upgrade every existing animation from "good" to "broadcast-quality" without breaking the documented invariants.

Read `docs/visual-craft.md` FIRST — its closing "Invariants held" list is binding. Read `app/motion.js` header comments second. Everything below assumes you did.

---

## Hard invariants (do not regress — tests and docs enforce some of these)

1. **Quantities animate only on critically damped springs** (`smooth`/`precise`, ζ≈1). A bar, a percentage, an average marker may never overshoot. `bouncy` is position/entrance only.
2. **`prefersReducedMotion()` respected by every animation**, old and new. The global kill switch at `styles/base.css:540` is belt; each JS site checks braces. `SpringGroup` snaps, `countTo`/`delay` fire instantly. Any new transition must degrade to an instant swap.
3. **DOM reuse** — charts retarget springs on existing nodes; never rebuild a chart to animate it. `resetChart()` (`app/present-page.js:471`) is the ONLY hard wipe, and only on slide change.
4. The `[hidden]` display rule, the 4-name overlay-lift list in `styles/present.css`, single-accent polls, square-baseline bars — all listed at the end of `docs/visual-craft.md`.
5. **Projector performance**: animate `transform`/`opacity`/`clip-path` only. No per-frame layout reads outside the existing rAF subscribers. One shared rAF (`app/motion.js:173`) — subscribe to it, never start a second loop.
6. **Phones never wait on motion**: nothing on join.html may delay vote submission or acknowledgment. Presenter-side transitions must not block `queuePaintChart()` — votes arriving mid-transition still coalesce and paint.
7. `npm test` (192 tests, zero deps) stays green. `tests/run-tests.mjs` imports `logic.js`/`deck-format.js`/`motion.js` only, so motion helpers you add to `motion.js` are testable; DOM work is not, keep it out of those modules.
8. `setMotionStill(true)` (print/export path, `app/export-print.js`) must freeze any new animation too.
9. When done, **append the new invariants + rationale to `docs/visual-craft.md`** — that file is the motion spec of record.

---

## Workstream A — Slide transitions (PowerPoint-style)

### A1. Current state (verified)

Navigation is `go(step)` → `patch()` → `render()` (`app/present-page.js:1126`, `:1141`, `:246`). `render()` mutates the same DOM nodes in place; the slide-change branch is `if (changed) { … }` at `app/present-page.js:290`, which calls `renderDecor`, `setView('results')`, `resetChart()`, `stopTimer()`, `endPairPhase(false)`. The stage container never moves. `.stage-scrim` is a backdrop dimmer, not a transition — leave it alone.

### A2. Architecture: frozen-snapshot overlay (recommended)

Do NOT refactor the stage into a two-slide carousel — that fights the DOM-reuse design and every chart's assumption that it owns the live nodes. Instead:

1. In `render()`, just before `state.question` is reassigned (`app/present-page.js:270` — capture the outgoing question BEFORE this line), if a transition is configured and this is a real slide change (`changed` true, old question existed, not first paint, not reduced-motion, not print-still):
2. **Snapshot the outgoing stage**: `stage.cloneNode(true)`, strip `id`s, set `inert` + `aria-hidden="true"`, absolutely position it in a new `.stage-ghost` layer covering the stage (same stacking context as `.stage`, above content, below `.stage-controls` so presenter keys stay clickable). The clone is static — springs/rAF don't attach to it, which is exactly what we want: a freeze-frame of the outgoing slide.
3. Let `render()` proceed normally underneath — the real stage becomes the incoming slide instantly, preserving every existing behavior (chart reset, decor entrance, timers).
4. Run the transition as a pair of WAAPI animations: ghost animates OUT, real stage animates IN. On `finished` (or a safety `delay()` at duration + 100ms), remove the ghost. If another navigation fires mid-transition, remove the ghost immediately and start fresh — never queue transitions.
5. **The ambience backdrop does not participate.** `.stage-backdrop`/`.amb-stack` sit behind and keep drifting through the cut — continuity of the backdrop is what makes the content transition read as intentional rather than a page reload.

Edge cases to handle explicitly:
- First render of a session: no transition.
- WebSocket-driven slide change (another window navigated): same path — `render()` is the single consumption point, so it just works; verify.
- Q&A drawer open (`.stage-panel.is-open`): exclude the drawer from the ghost (it's positioned off the stage flow) or close it on navigation (it already effectively resets).
- Hidden tab: rAF is paused (documented trap in README/memory) — WAAPI keeps running on the compositor, but the safety `delay()` won't fire until visible. Use `animation.finished.then(cleanup)` AND a visibilitychange guard that removes any ghost on `hidden→visible`.

### A3. Transition vocabulary

Ship six. Each is a named pair of out/in keyframe sets. Durations 380–560ms; ease the OUT with `--ease-snap`-like acceleration and the IN with a decisive decelerate (`cubic-bezier(.16,1,.3,1)`). The incoming slide's existing entrance choreography (decor stagger, chart await state) layers on top and is what makes these feel expensive.

| id | Name (UI) | Out | In | Notes |
|---|---|---|---|---|
| `none` | None | — | — | default; today's instant swap |
| `fade` | Fade | opacity 1→0 | opacity 0→1, 40ms overlap | the safe classic |
| `push` | Push | translateX(0→-8%) + fade | translateX(8%→0) + fade | **direction-aware**: `go(step)` knows the sign — pass it through so Back pushes the other way. 8% not 100%: a full-width shove reads cheap on a projector; a short push with fade reads editorial. |
| `rise` | Rise | translateY(0→-4%) + fade | translateY(5%→0) + fade | vertical variant, good for section breaks |
| `zoom` | Zoom | scale(1→.97) + fade | scale(1.035→1) + fade | transform-origin center; subtle, cinematic |
| `wipe` | Wipe | static under | `clip-path: inset(0 100% 0 0)` → `inset(0)` on the incoming stage, ghost sits beneath and is removed at end | direction-aware like push; clip-path is compositor-friendly |

Reduced motion: all resolve to instant swap (skip ghost creation entirely — check `prefersReducedMotion()` and the `setMotionStill` flag at the gate).

### A4. Data model & plumbing (all consumption points verified)

- **Storage**: per-slide key `config.transition` (string id). `questions.config` is a free-form JSON blob (`worker/schema.sql:167`, parsed at `worker/index.js:215`) — **no migration needed**.
- **Deck default + per-slide override**: add deck setting `settings.transition` (pattern: `setDeckSetting`, `app/edit-page.js:2043`) as the default, and a per-slide `config.transition` that overrides when set ("Use deck default" as the first option). This matches PowerPoint's mental model AND the project's prompt-size precedent (`app/edit-page.js:955` comment) — one deck-wide feel, with per-slide exceptions for section breaks.
- **Editor UI**: per-slide control goes in `settingsFor(q)` (`app/edit-page.js:1539`) **immediately before the `switch (q.type)` at `:1693`**, so it renders for all 19 types — there is currently no universal-settings section; you're creating the first one. Use the `choose()` helper (`:1562`). Deck-level default goes next to the existing deck settings wired in `wireSlideSettings()` (`:2034`). If time allows, use the `iconRow` pattern (see `CHART_STYLES` usage at `:1714`) with tiny animated-on-hover previews instead of a plain dropdown — that's the million-dollar version of the picker.
- **Participant payload**: strip `config.transition` in the worker sanitization block (`worker/index.js:230-301`) — presenter-only; phones must not receive editor/deck styling keys they don't use.
- **Text format round-trip**: add an explicit `transition: <id>` line in `app/deck-format.js` serialize (`:533`, switch at `:541`); parsing already round-trips via the generic fallback at `:529` but add validation (unknown id → drop, don't crash). **Add tests** in `tests/run-tests.mjs` for round-trip + unknown-id handling.
- **Presenter consumption**: inside the `if (changed)` block at `app/present-page.js:290`. Resolve `q.config.transition ?? deck.settings.transition ?? 'none'`. Direction comes from comparing old/new `position`, not from `go()`'s step (so WS-driven changes are direction-aware too).
- **Preview**: the editor's slide preview (`app/preview-room.js` / slide-preview) does NOT need to play transitions — out of scope; note it in the plan's "not doing" list so the executor doesn't gold-plate.

---

## Workstream B — Elevation pass on existing animations

Full catalog exists (14 keyframes, ~22 SpringGroups in `app/charts.js`, 9 WAAPI one-shots, choreographed sequences). NOTE: `app/charts.js` contains a non-UTF8 byte — use `grep -a`. Per-item prescriptions, ordered by projector visibility:

### B1. Slide entrance choreography (biggest single win)
Today, on slide change, kicker/prompt/chart all appear at once; only decor staggers (`decor-in`, `styles/elements.css:78`). Add a **title cascade** that runs after the transition (or immediately when transition is `none`): kicker → prompt → chart shell/await state, each ~40–60ms apart, small `translateY(0.35em)` + fade, `--ease-out`-decelerate. Implementation: a `.stage.is-entering` class toggled in the `changed` block, pure CSS animations with `animation-delay` steps, removed on `animationend`. Must not delay vote intake or the await-sweep start. Reduced motion: class never applied.

### B2. Quiz reveal (already 3 beats — sharpen to broadcast)
`app/charts.js:335-382` + confetti beat at `app/present-page.js:1159`.
- Add **anticipation** before beat 1: 120ms hold where all bars' saturation dips together (extend the existing `dim` spring choreography — no new mechanism).
- Beat 2 correct-row bloom: add a one-shot WAAPI ring/underline sweep on the correct row's label in the accent color (pattern: the glint at `charts.js:278`).
- Keep `verdictPending` WS-echo guard intact (`:353/:368`).

### B3. Confetti upgrade (`celebrate()`, `app/charts.js:2896`; keyframes `styles/charts.css:1162`)
Current pieces fall on one rotation axis. Upgrade: two-axis tumble (`rotateX` in the keyframe via a second custom prop), slight horizontal sway (nested span: outer translates/falls, inner sways with its own short alternate animation — the classic two-element confetti trick), 3 shape variants (rect, circle via border-radius, thin streamer). Pull colors from the active theme (`--accent`, `--accent-2`, `--good` already used — add per-theme jitter in lightness). Keep the slowest-piece cleanup (`:2922`) and reduced-motion early return (`:2897`).

### B4. Word cloud (`charts.js:735-…`, first-fill at `:794`)
Choreography is strong. Two additions: (a) when a word takes the #1 spot, give it a single one-shot scale pulse via WAAPI (position/entrance, so a bouncy curve is legal) on top of its spring-held size; (b) newly arrived words get a soft blur(2px)→0 with their entrance. No continuous idle motion — a breathing cloud on a projector for 10 minutes is fatiguing, and idle motion is what the ambience layer is for.

### B5. Count-ups and value beats
- Footer response counter already rolls (`present-page.js:537`). Extend the odometer feel: when the count increases, the digit that changed gets a tiny y-slide via `pulseCount`-style WAAPI (pattern at `charts.js:2929`).
- Delta headline `countTo` (`charts.js:1471`): add a settle tick — final value lands with a 1-frame weight change or accent flash so the number's arrival is an event.

### B6. Bar charts / scales / ranking micro-polish
- Arrival glint (`charts.js:278`) — good; extend the same glint to scale tracks and ranking rows on arrival (currently only choice bars glint).
- Leaderboard rank-climb wash (`:1613`) — add direction: climbing rows wash accent, falling rows wash neutral, so the story reads without the numbers.
- Dot-plot `dotp-pop` — keep; add a 1px landing ripple on the axis under the dot (reuse the halo pattern from `:1183`).

### B7. Presenter chrome
- `.progress-dot` (`styles/present.css:321`): current-dot scale transition is fine; add a short trailing fill so navigation direction reads on the rail.
- Timer `is-urgent` blink (`timer-tick`, steps(2)) reads harsh — replace with a scale-heartbeat (1→1.06→1, ~0.9s) + color hold; keep steps() only under reduced-color needs. Verify against `docs/accessibility.md` (2.2.2/2.3.1 — stay well under 3 flashes/sec; the heartbeat also fixes that).
- `flash()` toast (`present-page.js:1520`): add a slight rise+fade like base `.toast`.

### B8. Editor (edit.html)
- **Rail reorder FLIP**: the phone already FLIPs ranking (`app/join-page.js:1231`) — reuse that exact pattern for the slide rail on drag-reorder and on add/delete, so the rail never teleports. This is the single biggest editor-feel upgrade.
- New-slide gallery: entrance stagger (pattern: exit-ticket cards, `charts.js:2729`).
- Right-panel drawers (`.panel-head::after` chevron): add height/opacity reveal on open with `grid-template-rows` 0fr→1fr trick (no JS height measuring).

### B9. Phone (join.html) — light touch only (invariant 6)
- Submit success beat exists (`join-page.js:591`). Add `navigator.vibrate?.(10)` on accepted answer (feature-detected, silent no-op on iOS).
- Waiting screen `wait-bounce`: fine as is. Do not add more idle motion on phones — battery.

### B10. Consolidation & hygiene (do first, it makes everything else cheaper)
- Unify the duplicated `wait-bounce` keyframes (`styles/join.css:487` vs `styles/charts.css:118`) — one definition, em-based, in a shared sheet.
- Promote the transition/entrance curves used by the 9 WAAPI one-shots into named tokens next to the existing `--ease-*` set (`styles/base.css:137`) and reference them from JS via one constants object in `motion.js` (exportable → testable).
- Sweep hard-coded `.3s ease`-style transitions in present.css/charts.css onto the duration/ease tokens.

---

## Sequencing for the executing model

1. B10 hygiene (tokens, dedupe) — foundation.
2. A2–A4 slide transitions end-to-end with `fade` + `push` only; tests for deck-format round-trip; verify in browser (present view, navigate both directions, reduced-motion, WS-driven nav from a second tab).
3. A3 remaining transitions + editor picker polish (iconRow previews).
4. B1 entrance cascade (interacts with A — do after).
5. B2, B3 (reveal + confetti) — highest audience-visible payoff.
6. B4–B9 in order.
7. Update `docs/visual-craft.md` invariants section; run `npm test`; run `tests/visual-check.html` audit; screenshot proof of at least: push transition mid-flight, quiz reveal, confetti, rail FLIP.

**Not doing (scope guard):** transitions in editor slide previews or print/export; per-element build animations within a slide (PowerPoint "animations" as opposed to "transitions"); sound; any motion that delays or gates vote intake.
