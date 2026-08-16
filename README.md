# SurveyAll

Free, anonymous live polling for the classroom. A replacement for Mentimeter, Slido, and Poll Everywhere that costs nothing to run and collects no student data.

Students scan a QR code and answer. No app, no account, no name — ever.

---

## Why this exists

As of August 2026, none of the three commercial tools' free tiers survives one normal college class, and what they paywall is exactly what an instructor needs:

| | Free tier limit | Export on free? |
|---|---|---|
| Mentimeter | **50 participants per month, total** | No |
| Slido | 100 participants, but **3 polls per event** | No |
| Poll Everywhere | **40 responses per poll** | No |

One 60-student session blows past all three. The cheapest workable paid plans run $84–$108/year. (Sources for every figure: [`docs/phase1-competitive-research.md`](docs/phase1-competitive-research.md).)

---

## What it does

**Seven question types** — multiple choice, word cloud, open ended, scales, ranking, quiz with leaderboard, and Q&A.

**Presenter view** for the projector: advance with the arrow keys, results animate as answers land, hide/reveal results, close voting, countdown timers, and a QR code that stays in the corner all lesson.

Results are animated with real spring physics rather than CSS transitions, so a bar that moves 2% and a bar that leaps 60% behave differently, and a vote landing mid-animation bends the motion instead of restarting it. Bars encoding a quantity are critically damped on purpose — an overshooting bar briefly draws a number that isn't true.

**Participant view** built mobile-first: big tap targets, no scrolling to find the submit button, works on anything with a browser.

**Deck customisation** — 8 designed themes, gradient/pattern/solid backgrounds, your own uploaded images with dim and blur, and per-question chart styles.

### Four things the commercial tools don't do

- **Re-ask with a delta view.** Ask a question, hide the results, let the room argue, press `R` to ask again, press `D` to see exactly what moved. Peer instruction as a first-class feature rather than a duplicated slide.
- **Anonymous *and* competitive.** Each device gets a random per-session nickname ("Amber Falcon"), so leaderboards and per-respondent CSV rows work with zero identity collected. Slido, by contrast, forces every quiz participant to enter a name.
- **Decks are plain text.** Your whole deck round-trips through a readable text format — version it, email it, diff it between semesters, keep it after this project is gone.
- **Your data is never hostage.** Every session is archived permanently and exports to CSV, free. There is no tier that could take that away.

---

## Setup

**→ [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — about 25 minutes, no terminal, no credit card.

The short version: fork the repo, create a free Cloudflare account, create a D1 database and run one SQL file, paste the database ID into `wrangler.jsonc`, connect the repo in Cloudflare, set your password as a secret.

Handing the remaining setup to another AI session? Give it **[docs/HANDOFF.md](docs/HANDOFF.md)** — it covers what's built, what has never been run against a live database, which steps a human must do personally, and the security checks to run before trusting this with a class.

---

## FERPA-safe by design

Not "we're careful with student data" — **there is no student data**.

No name field exists. No student logs in. Students hold no credential at all — only a join code, which is a room number, not a key. No table has a column that could hold a name, email, ID, or IP address. The only per-response value is a random nickname scoped to a single session that can't be linked across sessions. No cookies, no analytics, no third-party trackers. CSV exports have nothing to redact.

The one honest caveat: a student can type their name into an open-ended answer, and no tool can prevent that. You can delete any response with one click.

Every enforcement point is listed in [`docs/architecture.md`](docs/architecture.md) §5. Note that these rules are enforced in [`worker/index.js`](worker/index.js) rather than by the database — §5 explains what that trades off.

---

## Architecture

**One Cloudflare Worker** serves both the site and the API. D1 (SQLite) holds the data; one Durable Object per live session holds that room's WebSockets. No separate frontend host, no CORS, one deploy.

**No build step for the frontend** — plain ES modules. Cloudflare runs `wrangler deploy` on its own servers from your GitHub repo, so you never install Node or open a terminal.

One 60-student class with a 20-question deck uses roughly 1,500 Worker requests and 1,200 database writes, against daily free limits of 100,000 and 100,000 — room for dozens of sections a day. **Nothing sleeps or pauses**, and no credit card is required at any point. Full numbers, alternatives considered, and tradeoffs: [`docs/architecture.md`](docs/architecture.md).

> Originally built on Supabase; migrated when its free plan's 2-active-project cap (counted per user, across all organisations) proved binding. Because every backend call lives in `app/db.js`, the swap touched no page controller, no chart, and no test.

---

## Repository layout

```
index.html          landing — students join, instructor signs in
join.html           participant view (mobile)
present.html        projector view
dashboard.html      your decks and sessions
edit.html           deck editor — questions, themes, backgrounds
results.html        session archive and CSV export

app/                ES modules, no build step
  logic.js            pure logic: validation, aggregation, scoring, CSV
  deck-format.js      plain-text deck parser/serialiser
  db.js               the ONLY file that knows a backend exists
  charts.js           result rendering
  motion.js           spring-physics animation engine
  themes.js           8 themes + background presets
  participant-state.js session-scoped pseudonym handling
  *-page.js           one controller per page

worker/             the Cloudflare Worker
  index.js            the API, and all security enforcement
  session-room.js     Durable Object — realtime fan-out per session
  auth.js             password check + signed tokens
  schema.sql          D1 tables (run once)

styles/             base, charts, present, join, app
tests/              run-tests.mjs (node), visual-check.html (browser)
docs/               architecture.md, DEPLOYMENT.md, HANDOFF.md, phase1 research
wrangler.jsonc      deploy config — only `database_id` needs editing
```

---

## Tests

```bash
node tests/run-tests.mjs
```

104 tests, no dependencies. They cover the participant flow end to end at the logic level (what a tap becomes, whether it's accepted, how it's counted and scored, what reaches the CSV, and that no code path can emit a student identifier) plus the animation engine: that quantitative springs never overshoot, that a spring retargeted mid-flight keeps its velocity instead of restarting, and that a throwing render can't leave a chart frozen half-drawn.

For the rendering itself, open `tests/visual-check.html` in a browser. It draws every chart type with sample data and no database, simulates a live class so you can watch results animate in, and self-audits the word-cloud layout for overlaps. It also doubles as a way to check a theme is readable on your projector before class.

---

## Deliberately not included

PowerPoint and Google Slides add-ins (the single most-complained-about feature across all three competitors, and a large maintenance surface), any participant-identifying feature, LMS grade passback, SMS voting, and AI question generation. Reasoning for each: [`docs/phase1-competitive-research.md`](docs/phase1-competitive-research.md) §7.
