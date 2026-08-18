/**
 * SurveyAll — slide transitions for the projector.
 *
 * WHY A FROZEN CLONE, AND NOT A CAROUSEL
 *
 * The presenter view has exactly one slide in the DOM and mutates it in
 * place: charts keep their nodes and retarget springs, decor keeps its
 * entrance, the QR corner never moves. That in-place design is the reason
 * sixty phones answering at once cost one repaint, and a two-slide
 * carousel would have to give it up — every chart would need to know
 * which of two copies of itself is live.
 *
 * So instead of moving the real slide out, we photograph it. On a slide
 * change we deep-clone the outgoing content into an inert overlay, let
 * render() rebuild the real slide underneath exactly as it always has,
 * and animate the photograph out while the real thing animates in. The
 * clone is static by construction — no springs, no rAF, no listeners —
 * which is precisely what a freeze-frame should be.
 *
 * (The View Transitions API does this natively and better, including
 * canvas. It is not used here because render() is async and does network
 * work inside the update, because Firefox has no support, and because a
 * classroom projector is the worst possible place to discover a
 * browser-specific fallback path. The clone works identically
 * everywhere. Charts are SVG and DOM, never canvas, so a clone is a
 * faithful photograph — see charts.js svgEl().)
 *
 * WHAT MOVES, AND WHAT DELIBERATELY DOES NOT
 *
 *   moves:  the slide's own content — decor, heading, chart, footer
 *   stays:  the ambience backdrop, the join QR, the control bar
 *
 * The backdrop holding still through the cut is what makes this read as
 * one deck turning a page rather than a browser loading a document; it
 * is the same trick a film uses when the camera holds and the actors
 * move. The QR holding still is a promise: a student scanning it never
 * has to chase it, and it can never be covered (present.css keeps it at
 * z-index 6, above this overlay at 5).
 *
 * DISPLACEMENTS ARE SMALL ON PURPOSE
 *
 * A full-width shove is what PowerPoint does and it reads cheap on a
 * projector, because at 30 feet the eye tracks the whole wall moving and
 * loses the content. Every transition here travels under 10% and leans
 * on opacity and easing to carry the change. The outgoing slide leaves
 * on an accelerating curve and the incoming arrives on a decelerating
 * one, so the pair reads as one gesture with a handoff rather than two
 * animations that happen to overlap.
 */

import { prefersReducedMotion } from './motion.js';

/**
 * The vocabulary.
 *
 * `out`/`in` are functions of direction (+1 forward, −1 back) returning a
 * LIST of WAAPI [keyframes, options] pairs, so a Back press mirrors the
 * gesture instead of replaying the forward one — a deck that pushes the
 * same way whichever key you press feels like it has no spatial model at
 * all.
 *
 * WHY EACH MOVE IS TWO ANIMATIONS AND NOT ONE
 *
 * Transform and opacity need opposite curves and cannot share one.
 *
 * The transform wants an accelerating exit and a decelerating arrival —
 * that is what makes the pair read as a handoff. The opacity wants the
 * opposite emphasis: the outgoing slide has to be GONE before the
 * incoming one is really here, because both slides put their heading in
 * the same place, and two headings at 50% opacity on top of each other
 * is not a transition, it is a legibility failure the whole room can
 * see. Fading them on symmetrical curves sums the pair to ~2 through the
 * middle of the move; front-loading the exit and back-loading the
 * arrival keeps the sum near 1, which is what a crossfade is supposed to
 * be.
 *
 * WAAPI applies easing per keyframe interval, not per property, so one
 * animation cannot carry both curves. Two can, they compose on the
 * compositor for free, and each is independently readable.
 */

/** Decelerate hard, then coast. The "arriving" curve, for transforms. */
const EASE_ARRIVE = 'cubic-bezier(.16, 1, .3, 1)';
/** Accelerate away. The "leaving" curve, for transforms. */
const EASE_LEAVE = 'cubic-bezier(.55, 0, 1, .45)';
/** Shed light early. The outgoing slide's opacity. */
const EASE_CLEAR = 'cubic-bezier(.4, 0, .7, 1)';
/** Symmetrical and decisive — for a wipe, where the edge is the subject. */
const EASE_SWEEP = 'cubic-bezier(.65, 0, .35, 1)';

/** The outgoing slide's opacity fall. Same shape for every transition. */
const fadeOut = (duration) => [
  [{ opacity: 1 }, { opacity: 0 }],
  { duration, easing: EASE_CLEAR, fill: 'forwards' },
];

/** The incoming slide's opacity rise, started late so the two don't sum. */
const fadeIn = (duration, delay) => [
  [{ opacity: 0 }, { opacity: 1 }],
  { duration, delay, easing: EASE_ARRIVE, fill: 'backwards' },
];

export const SLIDE_TRANSITIONS = [
  {
    id: 'none',
    label: 'None',
    hint: 'Instant cut.',
    out: null,
    in: null,
  },
  {
    id: 'fade',
    label: 'Fade',
    hint: 'Dissolves through the background.',
    // Through, not across: the old slide clears completely before the new
    // one starts arriving. The gap costs a beat and buys the room a
    // moment where exactly one thing is readable.
    out: () => [fadeOut(220)],
    in: () => [fadeIn(330, 150)],
  },
  {
    id: 'push',
    label: 'Push',
    hint: 'Slides sideways. Back pushes the other way.',
    out: (dir) => [
      [
        [
          { transform: 'translate3d(0,0,0) scale(1)' },
          { transform: `translate3d(${-7 * dir}%,0,0) scale(.985)` },
        ],
        { duration: 340, easing: EASE_LEAVE, fill: 'forwards' },
      ],
      fadeOut(200),
    ],
    in: (dir) => [
      [
        [
          { transform: `translate3d(${9 * dir}%,0,0) scale(.992)` },
          { transform: 'translate3d(0,0,0) scale(1)' },
        ],
        { duration: 520, delay: 70, easing: EASE_ARRIVE, fill: 'backwards' },
      ],
      fadeIn(260, 150),
    ],
  },
  {
    id: 'rise',
    label: 'Rise',
    hint: 'Lifts up from below. Good for section breaks.',
    out: (dir) => [
      [
        [
          { transform: 'translate3d(0,0,0)' },
          { transform: `translate3d(0,${-3.5 * dir}%,0)` },
        ],
        { duration: 300, easing: EASE_LEAVE, fill: 'forwards' },
      ],
      fadeOut(190),
    ],
    in: (dir) => [
      [
        [
          { transform: `translate3d(0,${5 * dir}%,0)` },
          { transform: 'translate3d(0,0,0)' },
        ],
        { duration: 500, delay: 60, easing: EASE_ARRIVE, fill: 'backwards' },
      ],
      fadeIn(260, 140),
    ],
  },
  {
    id: 'zoom',
    label: 'Zoom',
    hint: 'Pushes back and pulls forward. Cinematic.',
    // Direction-blind on purpose: depth has no left and right, and
    // inverting it on Back reads as a mistake rather than as a return.
    // This is also the transition with the WORST overlap risk, because
    // nothing moves sideways — the two headings sit exactly on top of
    // each other — so its opacity gap is the widest of the set.
    out: () => [
      [
        [{ transform: 'scale(1)' }, { transform: 'scale(.945)' }],
        { duration: 320, easing: EASE_LEAVE, fill: 'forwards' },
      ],
      fadeOut(190),
    ],
    in: () => [
      [
        [{ transform: 'scale(1.055)' }, { transform: 'scale(1)' }],
        { duration: 540, delay: 60, easing: EASE_ARRIVE, fill: 'backwards' },
      ],
      fadeIn(280, 170),
    ],
  },
  {
    id: 'wipe',
    label: 'Wipe',
    hint: 'A lit edge sweeps the new slide in over the old.',
    // The old slide does not move and does not fade — it is CUT AWAY,
    // by exactly the clip that reveals the new one.
    //
    // The complement is not decoration, it is the whole mechanism. A
    // slide's content has no background of its own (the ambience
    // backdrop is the ground, and it stays put through the cut), so
    // revealing the new slide over the old one does not hide the old
    // one: both headings render in the same place and the swept region
    // shows the two of them stacked. Clipping the ghost to precisely the
    // ground the incoming slide has not claimed yet means every pixel
    // belongs to exactly one slide at every instant.
    out: (dir) => [
      [
        [
          { clipPath: 'inset(0 0 0 0)' },
          { clipPath: dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' },
        ],
        { duration: 560, easing: EASE_SWEEP, fill: 'forwards' },
      ],
    ],
    in: (dir) => [
      [
        [
          { clipPath: dir > 0 ? 'inset(0 100% 0 0)' : 'inset(0 0 0 100%)' },
          { clipPath: 'inset(0 0 0 0)' },
        ],
        { duration: 560, easing: EASE_SWEEP, fill: 'backwards' },
      ],
    ],
    edge: true,
  },
];

const BY_ID = new Map(SLIDE_TRANSITIONS.map((t) => [t.id, t]));

/** Ids in menu order — the editor's picker and the text format share this. */
export const TRANSITION_IDS = SLIDE_TRANSITIONS.map((t) => t.id);

export const DEFAULT_TRANSITION = 'none';

/**
 * Coerce anything (a hand-typed deck file, an older deck, a typo) to a
 * real transition id, or null if it is not one.
 *
 * Null rather than a throw or a default: a deck that names a transition
 * this build has never heard of should present, not refuse to open, and
 * silently substituting a different animation would be worse than
 * substituting none.
 */
export function normalizeTransition(value) {
  if (value == null) return null;
  const id = String(value).trim().toLowerCase();
  return BY_ID.has(id) ? id : null;
}

/**
 * Which transition plays for this slide.
 *
 * Per-slide setting wins; the deck default is the fallback. Both are
 * optional, and the answer when neither is set is a plain cut — a
 * presentation tool that animates by default is a presentation tool that
 * animates when nobody asked it to.
 */
export function resolveTransition(question, deck) {
  return normalizeTransition(question?.config?.transition)
    ?? normalizeTransition(deck?.settings?.transition)
    ?? DEFAULT_TRANSITION;
}

/** Forward or back, from the two slides' positions in the deck. */
export function transitionDirection(fromQuestion, toQuestion) {
  const a = fromQuestion?.position;
  const b = toQuestion?.position;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 1;
  return b > a ? 1 : -1;
}

// =====================================================================
// The runner
// =====================================================================

/**
 * The parts of the stage that constitute "the slide". Everything else in
 * .stage — backdrop, scrim, QR, controls, Q&A drawer, flash — is chrome
 * that persists across the cut and must not be photographed or moved.
 *
 * Order matters: it is the paint order inside the ghost.
 */
const SLIDE_PARTS = ['decorBack', 'head', 'body', 'foot'];
const SLIDE_PARTS_FRONT = ['decorFront'];

/**
 * One in-flight transition at a time, page-wide.
 *
 * Held at module scope rather than per-stage because there is exactly one
 * projector stage per document, and an arrow key held down can fire
 * faster than any of these durations. A second press must abandon the
 * first cleanly — a queue would let a leaning finger build a backlog of
 * animations the room then has to sit through after the instructor has
 * stopped pressing.
 */
let live = null;

function abortLive() {
  if (!live) return;
  const { nodes, animations, cleanup } = live;
  live = null;
  for (const a of animations) { try { a.cancel(); } catch { /* already gone */ } }
  for (const n of nodes) n?.remove();
  cleanup?.();
}

/** Strip anything that makes a clone act like a live element. */
function inertify(root) {
  root.removeAttribute?.('id');
  for (const el of root.querySelectorAll('[id]')) el.removeAttribute('id');
  // A cloned live region is a second announcer for the same room. It
  // would not fire on its own (live regions announce changes, and this
  // one never changes), but aria-hidden alone has historically not been
  // enough in every screen reader, so the role goes too.
  for (const el of root.querySelectorAll('[aria-live], [role="status"]')) {
    el.removeAttribute('aria-live');
    el.removeAttribute('role');
  }
}

/**
 * Photograph the current slide.
 *
 * MUST be called before render() has written a single character of the
 * new slide. Returns null when there is nothing to photograph or when
 * motion is off, and the caller treats null as "no transition".
 */
export function captureSlide(stage, id) {
  if (!stage || id === 'none' || !BY_ID.has(id)) return null;
  if (prefersReducedMotion()) return null;
  // A second navigation mid-flight: drop the previous photograph rather
  // than stacking a second one over it.
  abortLive();

  const ghost = document.createElement('div');
  ghost.className = 'stage-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;

  let painted = false;
  for (const partId of [...SLIDE_PARTS, ...SLIDE_PARTS_FRONT]) {
    const el = document.getElementById(partId);
    if (!el || el.hidden) continue;
    const copy = el.cloneNode(true);
    inertify(copy);
    ghost.append(copy);
    painted = true;
  }
  // Nothing on screen worth animating away (the lobby, or a slide whose
  // parts are all hidden). A transition out of blankness is just a delay.
  if (!painted) return null;

  return ghost;
}

/**
 * Play the pair. `ghost` comes from captureSlide(); the real slide is
 * expected to already hold the NEW content.
 *
 * @returns {Promise<void>} resolves when the stage is clean again.
 */
export function playSlideTransition(stage, ghost, { id, direction = 1 } = {}) {
  const spec = BY_ID.get(id);
  if (!ghost || !spec || spec.id === 'none' || prefersReducedMotion()) {
    ghost?.remove();
    return Promise.resolve();
  }

  const dir = direction < 0 ? -1 : 1;
  const animations = [];
  const incoming = [...SLIDE_PARTS, ...SLIDE_PARTS_FRONT]
    .map((partId) => document.getElementById(partId))
    .filter((el) => el && !el.hidden);

  stage.append(ghost);
  stage.classList.add('is-transitioning');

  // --- the outgoing photograph ---------------------------------------
  for (const [kf, opts] of spec.out?.(dir) || []) {
    animations.push(ghost.animate(kf, opts));
  }

  // --- the lit edge, for wipe ----------------------------------------
  // A sibling of the ghost, NOT a child of it: the ghost is itself being
  // clipped away along this exact line, and an edge inside it would be
  // clipped at precisely its own position — the one place it must not
  // be. Sitting on the stage it stays above both slides and marks the
  // seam between them.
  let edge = null;
  if (spec.edge) {
    edge = document.createElement('i');
    edge.className = 'stage-wipe-edge';
    stage.append(edge);
    const w = stage.clientWidth || window.innerWidth;
    const from = dir > 0 ? 0 : w;
    const to = dir > 0 ? w : 0;
    animations.push(edge.animate(
      [
        { transform: `translate3d(${from}px,0,0)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: .12 },
        { opacity: 1, offset: .88 },
        { transform: `translate3d(${to}px,0,0)`, opacity: 0, offset: 1 },
      ],
      { duration: 560, easing: EASE_SWEEP, fill: 'forwards' },
    ));
  }

  // --- the incoming slide --------------------------------------------
  for (const [kf, opts] of spec.in?.(dir) || []) {
    for (const el of incoming) animations.push(el.animate(kf, opts));
  }

  const cleanup = () => {
    stage.classList.remove('is-transitioning');
  };
  const nodes = [ghost, edge];
  const entry = { nodes, animations, cleanup };
  live = entry;

  const done = () => {
    // Another navigation already tore this one down and may have started
    // its own; touching the stage now would undo its setup.
    if (live !== entry) return;
    live = null;
    // Cancelling matters beyond tidiness: the incoming animations carry
    // fill:'backwards' and the outgoing ones fill:'forwards', so a
    // finished-but-live animation keeps holding its endpoint over the
    // element. Leaving them attached would pin the new slide's clip or
    // opacity at whatever the transition ended on.
    for (const a of animations) { try { a.cancel(); } catch { /* fine */ } }
    for (const n of nodes) n?.remove();
    cleanup();
  };

  // Promise.allSettled, not Promise.all: cancel() rejects the finished
  // promise, and an abandoned transition must still resolve for any
  // caller awaiting it.
  return Promise.allSettled(animations.map((a) => a.finished)).then(done);
}

/**
 * Hard reset. Called when the tab comes back from hidden and on teardown.
 *
 * A backgrounded tab does not run rAF, and while WAAPI keeps its own
 * clock, a machine that was asleep can return with a ghost still parked
 * over the slide. Any state that can strand a full-screen opaque overlay
 * in front of a class needs a way back that does not involve the
 * instructor reloading the page mid-lecture.
 */
export function clearSlideTransition() {
  abortLive();
  for (const el of document.querySelectorAll('.stage-ghost, .stage-wipe-edge')) {
    el.remove();
  }
  document.querySelector('.stage')?.classList.remove('is-transitioning');
}
