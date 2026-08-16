# SurveyAll — handoff for a browser session

**Read this first, in full, before touching anything.**

You are picking up a finished codebase that has never been deployed. The code is written and tested; what remains is account setup, deployment, and the live verification that could not be done without a real browser and a real database.

**Owner:** Brandon, a college instructor. Comfortable with GitHub, not a professional developer. Write and speak accordingly.
**Goal:** a free, anonymous classroom polling tool replacing Mentimeter, running at `https://surveyall.<name>.workers.dev`.

**Where the code is.** It was written locally at `/Users/grover/Documents/PROGRAMS/surveyall`. If you are running in a browser you almost certainly cannot read that path — ask Brandon for the GitHub URL and work from there. **If the code is not on GitHub yet, that is the first task**, because the whole deploy path is "connect Cloudflare to a GitHub repo". Brandon must create the repo and push it himself (it's his account); you can talk him through it. Nothing in the repo is secret, so public or private both work.

**Stack:** one Cloudflare Worker serving both the site and the API, D1 (SQLite) for data, one Durable Object per live session for realtime. **It was originally built on Supabase and migrated** — Supabase's free plan allows only 2 active projects *per user across all organisations*, and Brandon's were in use. If you find stale Supabase references anywhere, they're bugs; flag them.

---

## 0. Rules that override everything else

**Never do these — ask Brandon to do them himself:**

- Create the Cloudflare or GitHub account.
- Type any password. Including `INSTRUCTOR_PASSWORD`.
- Enter payment details. **Nothing in this project requires a card.** If a page asks for one, you are on the wrong product — stop and say so. The one Cloudflare product that demands a card is **R2**; SurveyAll deliberately doesn't use it, so if something is steering you toward R2, that is a mistake to report rather than work around.

**Ask before each of these** (irreversible or outward-facing):

- Pushing to GitHub.
- Changing Cloudflare Worker settings, bindings, or secrets.
- Deleting any deck, session, or response.
- Running any SQL that isn't `worker/schema.sql`.

**Safe to do freely:** navigating, reading pages, running `worker/schema.sql`, editing local files, `node tests/run-tests.mjs`, and the verification in §4.

**On secrets:** `INSTRUCTOR_PASSWORD` and `AUTH_SECRET` live in Cloudflare's encrypted store. They must never appear in the repo, in a file you write, or in anything you print back. The repo is safe to be public precisely because it contains nothing secret — keep that true.

---

## 1. Current state

**Done and verified:**

- All 6 pages, 7 question types, editor, presenter view, participant view, results archive, CSV export.
- 8 themes + background system (gradients, patterns, solid, uploaded images with dim/blur).
- Spring-physics animation engine for results.
- `node tests/run-tests.mjs` → **104 passing, zero dependencies.** Run this first; if it fails, something is wrong before you start.
- Rendering verified programmatically in a browser: 13/13 chart views render, word cloud holds 0 overlaps across 14 rounds of changing data, all 8 themes clear WCAG contrast.

**Built but NEVER RUN against a real deployment.** The entire Cloudflare layer is unexercised:

- `worker/index.js` — every route, including all four security rules
- `worker/session-room.js` — the Durable Object and its WebSockets
- `worker/schema.sql` — never executed against a real D1 database
- `app/db.js` — rewritten for HTTP + WebSocket, never round-tripped

**Never visually confirmed** (the previous session's browser pane ran hidden, where `requestAnimationFrame` is paused at 0 fps, and screenshots of scrolled content came back blank):

- The spring animations actually moving.
- The word cloud, delta view, and leaderboard as rendered pictures.
- Anything on a real phone.

Those are your highest-value checks. See §4.

---

## 2. Setup — follow `docs/DEPLOYMENT.md`

That file is the user-facing guide, written for Brandon. Work through it *with* him. Division of labour:

| Step | Who |
|---|---|
| 1. Fork the repo | **Brandon** |
| 2. Create the Cloudflare account | **Brandon** (account + password) |
| 3. Create the D1 database `surveyall`, run `worker/schema.sql` in its console | You — paste and run, report the result |
| 4. Paste the database ID into `wrangler.jsonc` | You (local edit) or Brandon (GitHub web editor) |
| 5. Connect the repo in Workers & Pages and deploy | Brandon (authorising GitHub access) |
| 6. Set `INSTRUCTOR_PASSWORD` and `AUTH_SECRET` as **encrypted secrets** | **Brandon** — never type these yourself |
| 7. Sign in and confirm the dashboard loads | Either |

**Gotchas worth pre-empting:**

- The D1 database must be named exactly `surveyall`, matching `wrangler.jsonc`.
- Both secrets must be **encrypted secrets**, not plain-text variables. A plaintext `INSTRUCTOR_PASSWORD` would be visible in the dashboard and, worse, is the kind of thing that leaks into a screenshot.
- `migrations` in `wrangler.jsonc` uses `new_sqlite_classes`, not `new_classes`. The free plan only supports SQLite-backed Durable Objects, and using the wrong key produces a billing error that misleadingly reads as though Durable Objects are paid-only. Don't "fix" it by switching keys.
- If the build fails, read the **last few lines** of the build log in Workers & Pages → Deployments. You can roll back to any previous deployment from that screen.

---

## 3. The end-to-end smoke test

In order. Stop at the first failure and diagnose rather than pressing on.

1. Open the Worker URL. Expect the join screen. "Not finished setting up" means the API isn't answering — check the D1 binding and that the schema ran.
2. Sign in as instructor → lands on **Decks**.
3. Dashboard → **Import from text** → accept the prefilled sample → **Import**. Expect the editor with 7 questions.
4. Change the theme; the preview updates. Upload a background image; confirm it appears. (This exercises client-side downscaling and D1 storage — watch for anything over ~1.2 MB being rejected.)
5. **Start session** → presenter view with a QR and a 6-character code.
6. **Scan the QR with a real phone.** The single most important check here — it is the whole product promise. Expect: lands directly on the live question, no account, no name field, no app install.
7. Presenter presses `→`. The phone should follow within a second or two. **If it doesn't, the Durable Object isn't working** — check the browser console for WebSocket errors, then Worker logs.
8. Answer from the phone. The bar should **grow smoothly**, not jump; the count should tick up.
9. Try every question type: multiple choice, word cloud, open ended, scales, ranking, quiz, Q&A.
10. On the quiz: press `C` → correct answer highlights green, others dim, confetti. Press `L` → leaderboard shows random nicknames. **Confirm no real names appear anywhere.**
11. Press `H` (hide), `R` (re-ask), `D` (compare). Expect a before/after view and *"N% of the room changed their answer."*
12. End the session → **Results** → **Download CSV**. Open it. **Confirm `respondent` contains only nicknames — no names, emails, or IDs.**

---

## 4. Verification the previous session could not do

### 4a. Watch the animation (highest priority)

Open `tests/visual-check.html` on the deployed site **in a visible foreground tab** and click **Simulate a live class**.

Good: bars glide and *bend* toward new values as votes land rather than restarting; numbers count rather than snapping; word-cloud words drift instead of teleporting; leaderboard rows slide past each other when ranks change.

Wrong: visible stutter or restart mid-motion; a bar overshooting past its value then settling back (quantitative springs are critically damped deliberately — overshoot means a preset got mis-assigned in `app/charts.js`); overlapping words.

Run `window.__audit()` in the console — returns `{ok: true, clouds: [{overlaps: 0, outOfBounds: 0}]}` when the layout is sound.

**Two environment traps that cost the previous session real time:**

- **A hidden/background tab pauses `requestAnimationFrame` completely.** Springs then appear frozen. That is the environment, not a bug. Check `document.hidden` and count rAF ticks over a second before concluding anything.
- **Stylesheets cache hard.** A query string on the HTML does *not* bust linked CSS. Force it: `document.querySelector('link[href*="charts.css"]').href += '?cb=' + Date.now()`.

### 4b. Prove the security rules hold — DO NOT SKIP

This is the part that matters most and has never been run. On Supabase these guarantees were enforced by Postgres Row Level Security; **they now live entirely in `worker/index.js`**, so there is one line of defence rather than two, and it has never been tested against a live server.

Run each in the browser console **signed out** (open `join.html` in a private window, or run `localStorage.clear()` first), with a live session running. Replace `CODE` with the real join code.

| # | Probe | Expected |
|---|---|---|
| 1 | `await (await fetch('/api/join/CODE/question')).json()` | Returns the question, and `config` has **no** `correct` key. **If an answer key appears, STOP — quizzes are cheatable and this is a release blocker.** |
| 2 | `await fetch('/api/decks').then(r => r.status)` | `401` |
| 3 | `await fetch('/api/sessions').then(r => r.status)` | `401` |
| 4 | `await fetch('/api/sessions/<id>/responses').then(r => r.status)` | `401` — a student must never read raw responses |
| 5 | `await fetch('/api/backgrounds').then(r => r.status)` | `401` |
| 6 | POST to `/api/join/CODE/respond` with a `questionId` that is **not** the live one | Rejected `409` |
| 7 | Presenter presses `C` (close voting), then POST a response | Rejected `409` |
| 8 | POST a response with a stale `round` number | Rejected `409` |
| 9 | `await (await fetch('/api/join/CODE/results?question=<id>')).json()` while "push to phones" is **off** | `null` — aggregates must not leak before the presenter shares them |
| 10 | `await (await fetch('/api/join/CODE')).json()` | Succeeds and contains **no** student data — expected and safe |

Report results as a table. Any surprise in 1–9 is a release blocker. Re-run all of these after **any** edit to `worker/index.js`.

### 4c. Realtime and load

- Presenter view plus 3+ participant tabs. Advance a question; confirm all follow.
- Confirm the response count on the projector matches the number of tabs that answered.
- Kill wifi on one phone mid-session, restore it. It should recover — `app/db.js` reconnects with backoff and there's a slow poll behind it.
- Watch the Worker's request count in the dashboard during a test session and sanity-check it against the ~1,500/session estimate in `docs/architecture.md` §3.

### 4d. Mobile

On a real phone: comfortable tap targets, submit reachable without scrolling, no horizontal scroll, both orientations, readable in a bright room.

---

## 5. Where things live

```
app/logic.js       pure logic — validation, aggregation, scoring, CSV. No DOM, no network. Fully unit-tested.
app/motion.js      spring-physics engine. PRESETS mirror react-spring (what Mentimeter ships).
app/charts.js      all result rendering. Springs only; almost no CSS transitions.
app/db.js          THE ONLY FILE THAT KNOWS A BACKEND EXISTS. Start debugging here.
app/themes.js      8 themes + background presets.
app/deck-format.js plain-text deck parser/serialiser.

worker/index.js       the API and ALL security. Read the header before editing.
worker/session-room.js Durable Object — WebSocket fan-out, role-separated.
worker/auth.js        password check + HMAC tokens.
worker/schema.sql     D1 tables.
wrangler.jsonc        deploy config. Only `database_id` needs editing.

docs/architecture.md  why this stack, free-tier limits vs load, FERPA enforcement (§5)
docs/phase1-competitive-research.md  the research; §7 explains what was deliberately skipped
```

**Invariants to preserve:**

- `app/db.js` is the whole backend surface. Keeping it that way is why migrating off Supabase touched no page controller, no chart, and no test. Don't scatter `fetch` calls into page files.
- Anything encoding a quantity (bar length, counter, average) uses a critically-damped spring preset. Overshoot on a quantity briefly draws a number that isn't true. `bouncy` is for position and entrance only.
- Bars are square at the baseline, rounded only at the tip — rounding the origin end visually shortens the value.
- Poll bars are one accent colour deliberately. Length already encodes the answer.
- Charts reuse their DOM between renders. Rebuilding is what makes live charts flicker.

**Non-negotiable:** never add a field, column, or flow that collects a student name, email, ID, or IP. The FERPA claim is structural, not aspirational. If a feature seems to need identity, it belongs on the skip list.

---

## 6. Known gaps, in rough priority order

1. **Nothing has run against a real deployment.** Expect first-run friction in `worker/index.js` — most likely candidates: the D1 `on conflict` upsert in `/respond`, the Durable Object WebSocket upgrade path, and the `assets` binding shadowing an `/api/` route.
2. **The security probes in §4b have never been run.** Until they pass, treat quizzes as unverified.
3. **No reconnect indicator on the presenter view.** If realtime drops it silently falls back to polling. A small "reconnecting…" chip would help.
4. **Word-cloud entries can't be individually deleted.** Open-ended responses can (hover a card); word-cloud words can't. Worth adding before a large lecture, along with a profanity filter.
5. **Accessibility pass not done.** Charts have `aria-label`s and reduced-motion is respected, but no screen-reader or keyboard-only audit. The research found accessibility to be a documented weakness of all three commercial tools — a chance to beat them, not match them.
6. **Single shared password, no multi-user.** Fine for one instructor; see `docs/architecture.md` §4 for when that stops being fine.
7. **PowerPoint integration deliberately deferred** — Brandon said "later". Read `phase1-competitive-research.md` §7 first; add-in fragility was the most-complained-about feature across all three competitors.

---

## 7. First message to Brandon

Something like:

> I've read the handoff. The code is done and its tests pass, but it has never talked to a real Cloudflare deployment — so the plan is: get the Worker and database set up (you'll do the account bits and both secrets), then run a live class end-to-end from a real phone. I'll also run the security probes, since the answer-key protection moved into the Worker during the migration and has never been tested, and check that the animations actually move. Want to start with the Cloudflare account?

Then work through §2, §3, §4 in order, and report what actually happened — including anything that didn't work.
