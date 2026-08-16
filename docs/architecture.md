# SurveyAll — Architecture

**Date:** August 15, 2026 · **Status:** built, not yet deployed
**Constraints:** free/near-free hosting, no credit card · QR join with no account, app, or name · presenter-driven live sessions · persistent per-session results with CSV export · FERPA-safe by design · heavy deck customisation

> **Revision note.** This was originally built on Supabase. It moved to Cloudflare when the free plan's **2-active-project limit** turned out to be per *user* across all organisations ([billing docs](https://supabase.com/docs/guides/platform/billing-on-supabase)) — the instructor already had two, and a second organisation would not have helped. §2 keeps the comparison, because the reasoning still explains the shape of what's here.

---

## 1. The decision in one paragraph

**One Cloudflare Worker serves both the static site and the API.** D1 (SQLite) holds the data, and one Durable Object per live session holds that room's WebSockets. There is no separate frontend host, no CORS, and no second service to keep in sync. Deployment is a GitHub connection: Cloudflare's Workers Builds runs `wrangler deploy` on its own servers, so the operator never installs Node or opens a terminal. Total recurring cost **$0**, with **no payment method on file anywhere**.

---

## 2. Why this and not the alternatives

All limits verified against official docs on August 15, 2026.

### Option A — Cloudflare Workers + D1 + Durable Objects ✅ **chosen**

| Resource | Free limit | Source |
|---|---|---|
| Worker requests | 100,000/day | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Worker CPU | 10 ms per invocation | [workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| D1 storage | 500 MB/database, 10 databases | [d1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| D1 rows read / written | 5,000,000 / 100,000 per day | [d1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Durable Objects | Free, **SQLite-backed only**; 100,000 req/day | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Inbound WebSocket messages | Billed **20:1** against requests; outbound free | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Static assets | Free and unlimited | [pages](https://pages.cloudflare.com/) |
| Build minutes | 3,000/month | [builds pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) |
| Credit card | **Not required** | [account docs](https://developers.cloudflare.com/fundamentals/account/create-account/), [workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |

Why it wins: the most generous limits of anything surveyed, **no inactivity pause of any kind**, no project cap that a busy account could exhaust, and — decisively — no card. Durable Objects are also simply the right primitive: a live session *is* a room of connected clients, and a DO gives each session one addressable place they're already attached to.

**Two things to know.** Durable Object classes cannot be created from the dashboard — they need `wrangler`. Cloudflare's GitHub-connected [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) runs that server-side, so this stays terminal-free, but it does mean the deploy path is "connect the repo", not "paste code in a box". And **R2 is the one Cloudflare product that requires a payment method** ([R2 get-started](https://developers.cloudflare.com/r2/get-started/)) — which is why background images live in D1 instead (§4).

### Option B — Supabase ❌ ruled out by the project cap

Technically excellent for this and what the first build used. The free plan allows **2 active projects, counted per user across every organisation where they are Owner or Admin** ([billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)). Creating another organisation does not grant more. Pausing an unused project frees a slot with no data loss and a 1-year restore window ([pausing docs](https://supabase.com/docs/guides/platform/free-project-pausing)) — the correct escape hatch if projects ever free up, but not available here.

Its other free-tier ceilings were also tighter than Cloudflare's: 200 concurrent realtime connections, 500 MB database, and a **7-day inactivity pause** that would reliably strand the project over summer break.

### Option C — Firebase (Spark) ❌ rejected

**Cloud Storage was removed from the free Spark plan on February 3, 2026** ([storage FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)) — image uploads would require a billing account. Realtime Database caps **simultaneous connections at 100** ([limits](https://firebase.google.com/docs/database/usage/limits)), which one 60-student class plus reconnects gets uncomfortably close to. Firestore avoids that cap but imposes hard daily read/write quotas that switch the app off when exceeded. Its one genuine advantage — unauthenticated access via security rules, so no per-device identity is created ([rules docs](https://firebase.google.com/docs/rules/basics)) — Cloudflare matches by simply not having client credentials at all.

### Option D — Convex / InstantDB ❌ close seconds

Both are realtime-first and would fit: Convex allows 1,000 concurrent sessions, InstantDB never pauses and needs no card. Rejected because Cloudflare's limits are higher still, and because both are smaller companies — for a tool meant to survive several years of teaching, platform longevity is a real consideration. Worth revisiting if Cloudflare's model ever changes.

---

## 3. Free-tier limits vs. your actual load

Worst realistic case: **60 students, a 20-question deck, plus a few re-asks.**

| Resource | One class session | Free limit | Headroom |
|---|---|---|---|
| Worker requests | ~1,500 (votes, question fetches, joins) | 100,000/day | **~65 sessions/day** |
| Durable Object requests | ~1,300 (61 connections + inbound messages at 20:1) | 100,000/day | far beyond need |
| D1 rows written | ~1,250 | 100,000/day | **~80 sessions/day** |
| D1 rows read | a few thousand | 5,000,000/day | irrelevant |
| D1 storage | ~250 KB of answers | 500 MB | ~2,000 sessions |
| Static page loads | 60+ | unlimited | irrelevant |
| Build minutes | ~1 per push | 3,000/month | irrelevant |

**Nothing binds.** The tightest ratio is Worker requests, and it allows roughly 65 full class sessions per day against a realistic load of one or two.

Three properties that matter more than the raw numbers:

1. **Nothing sleeps.** No inactivity pause on Workers, D1, or Pages. The summer-break problem that Supabase's 7-day pause created simply does not exist here.
2. **Quotas are daily, not monthly.** An unusually heavy day resets at 00:00 UTC rather than stranding you for weeks.
3. **No project cap in practice:** 100 Workers, 10 D1 databases, 100 Pages projects per account.

### Honest caveats

- **The 10 ms CPU limit per request is real** and shaped one design decision: it rules out proper password hashing (PBKDF2/bcrypt at a safe iteration count takes far longer), which is why the instructor password is a platform secret rather than a stored hash. See §5.
- **Whether the 20:1 WebSocket ratio applies to the free daily cap** or only to paid billing is ambiguous in the docs. Even assuming the worst — every inbound message counting as a full request — a class session lands near 2,500 DO requests, still ~40 sessions/day.
- **Durable Objects require the GitHub-connected build path.** If Cloudflare ever changed that, the deploy story would get harder for a non-developer, though the code would be unaffected.

---

## 4. How it fits together

```
   INSTRUCTOR                         STUDENTS (30–60 phones)
   ┌──────────────┐                   ┌──────────────────┐
   │ edit.html    │  Bearer token     │ join.html        │  no credential
   │ present.html │                   │ (scan QR → live) │  at all
   │ results.html │                   └────────┬─────────┘
   └──────┬───────┘                            │
          │        /api/…                      │  /api/join/<code>/…
          └───────────────┬────────────────────┘
                          ▼
             ┌────────────────────────────────┐
             │      ONE CLOUDFLARE WORKER     │
             │                                │
             │  static assets ── index.html,  │
             │                   app/, styles/│
             │  worker/index.js ─ the API and │
             │                   ALL security │
             └───────┬───────────────┬────────┘
                     │               │
              ┌──────▼─────┐  ┌──────▼──────────────┐
              │     D1     │  │  Durable Object     │
              │  (SQLite)  │  │  one per session,   │
              │            │  │  holds its sockets  │
              └────────────┘  └─────────────────────┘
```

**The live loop.** The presenter PATCHes the session. The Worker writes to D1, then tells that session's Durable Object to broadcast. Every phone in the room receives it over an already-open WebSocket and fetches the new question. Nothing polls (except a slow safety net), and no message passes through a server we operate.

### Key decisions and their tradeoffs

| Decision | Why | Tradeoff accepted |
|---|---|---|
| **One Worker serves site + API** | One deploy, one origin, zero CORS config | Static assets and API share a request budget — irrelevant here, since assets are free |
| **No build step for the frontend** | Plain ES modules; editing a file and pushing is the whole workflow | No bundling or minification; the app is small enough not to care |
| **Answer keys stripped server-side** | A student opening devtools cannot see quiz answers | One extra round-trip per question advance |
| **Participants get no database credential** | There is no client-side key to leak or abuse; students can only reach `/api/join/<code>/…` | Every participant action needs an explicit endpoint |
| **Background images stored in D1 as data URIs** | R2 requires a payment method; the hard rule is no card | Images are downscaled to ~200–400 KB client-side; unsuitable for a large media library, fine for slide backdrops |
| **Single instructor password as a platform secret** | 10 ms CPU makes real password hashing impossible; the secret store is encrypted and offers no hash to grind offline | No multi-user accounts, no audit trail. Right for one instructor's own decks; wrong if this ever became departmental |
| **Presenter aggregates client-side** | No server compute to pay for; 1,200 rows is nothing for a laptop | Would need rework at ~10,000 responses/question — not a classroom scenario |
| **Phones get theme colours, not background images** | Legibility on a small screen, and 60 devices don't each download a backdrop | Phones look themed but simpler than the projector |

---

## 5. FERPA-safe by design — where this is enforced

The goal is not "we handle student data carefully" — it is that **no student data ever exists**.

> **Scope note, since instructor accounts landed.** The claim is *no student data*, not *no data*. The `users` table holds a username and a password hash per instructor — staff records, which FERPA does not govern. There is deliberately no email column, so that username is the entire personal footprint of the system. Everything in the list below concerns students and is unaffected. `/privacy.html` states the distinction in the words a non-technical reader needs.

1. **No name field exists in the participant UI.** Not optional, not skippable — the input does not exist. (`join.html`)
2. **No accounts, no login, no email for students.** A join code is a room number, not a credential.
3. **No column in the database can hold an identifier.** There is no `name`, `email`, `student_id`, or `ip` column in any table, and the schema header says so explicitly so a future change can't drift into it. (`worker/schema.sql`)
4. **The only per-respondent token is a random session-scoped pseudonym** ("Amber Falcon"), assigned by the server from a fixed word list with no relationship to the device or person, and **never reused across sessions** — so two sessions cannot be joined to build a per-student history, which is the step that would turn pseudonymous data back into an education record.
5. **No cookies, no analytics, no third-party trackers, no fingerprinting.** The pseudonym lives in `sessionStorage` and dies with the tab.
6. **Quiz leaderboards rank pseudonyms**, resolving the anonymity-vs-competition tension that forces Slido to collect a name for every quiz participant.
7. **CSV exports contain no identifier column** — `respondent` holds the pseudonym. Nothing to redact before sharing.
8. **Q&A is anonymous and moderatable**, with hide-until-approved free.

### What changed when the backend moved — read this

On Supabase, Postgres **Row Level Security** meant the *database itself* would refuse to serve a quiz answer key or another student's responses, even if the application had a bug. D1 has no equivalent. **Those guarantees now live entirely in `worker/index.js`.**

This is a genuinely different shape of protection and worth stating plainly rather than glossing:

- **What got better:** students hold no database credential at all. On Supabase the anon key shipped in the page and RLS policies were what stopped it being abused; here there is no key to abuse, and participants can only reach the handful of `/api/join/<code>/…` endpoints that exist.
- **What got weaker:** there is now one line of defence rather than two. A bug in the Worker's route handling could expose something that RLS would have caught independently.

The mitigation is that the surface is small and explicit: five rules, listed at the top of `worker/index.js`, in one file of a few hundred lines. `docs/HANDOFF.md` includes probes that verify each one against a live deployment, and they should be re-run after any change to that file.

Since accounts arrived those rules are also checked automatically. `tests/run-worker-tests.mjs` builds a real SQLite database from `worker/schema.sql`, wraps it in the slice of the D1 API the Worker uses, and drives the Worker's own `fetch` handler — so a handler that forgets an owner check fails there for the same reason it would fail in production. That is not RLS, and it does not restore the second independent line of defence, but it does mean the single line is regression-tested rather than merely reviewed.

### Multi-instructor: why this was a change of shape, not a migration

`owner_id` was on `decks`, `sessions`, and `backgrounds` from the first schema, defaulting to `'owner'` — but nothing read it, so every instructor query ran unscoped (`select * from decks`, `where id = ?`). That was correct when one person held one password and is silently wrong the moment a second account exists: everything still looks right when tested with one account.

The fix has three parts, and the third is the one worth remembering:

1. **A `users` table**, and tokens that carry a user id. A v1 token proved *someone* signed in without saying *who*, which is unscopeable — `verifyToken` refuses them outright rather than tolerating them.
2. **Every root query filtered by `owner_id`.**
3. **Nested resources resolved through their owner**, not by id. A question, a response, a Q&A message and a background have no owner column of their own; they inherit one from the deck or session above them. `ownedDeck`/`ownedSession`/`ownedQuestion`/`ownedResponse`/`ownedAudienceQuestion` do that join in one place, and handlers call them instead of querying by id. Ids are random, but an unguessable identifier is not an access control — and the route this mattered most for, `GET /api/sessions/:id/responses`, returns raw student answers.

"Not yours" answers **404, never 403**: a 403 confirms the id exists and belongs to somebody else, which is itself a disclosure.

One route is deliberately outside this: `GET /api/backgrounds/:id` serves an uploaded backdrop without a token, because a browser cannot attach an `Authorization` header to `<img src>`. Anyone holding the id can fetch that image, including another instructor. It is projector art with no student data in it, listing and deletion are owner-scoped so a collection cannot be enumerated, and `/privacy.html` discloses it rather than leaving it implicit.

### Passwords under a 10ms CPU ceiling

The free plan's per-invocation CPU limit (§2) rules out PBKDF2 at a normal iteration count — 100,000 measures ~11ms on a development laptop, and Workers CPU is slower, so the request would be killed mid-hash. Storing a weak hash and calling it done would have been the easy wrong answer.

Instead the password is **peppered before hashing**: HMAC-SHA256 under `AUTH_SECRET`, which lives in Cloudflare's encrypted secret store and never in the database. Against the likeliest threat by far — a database leak without the Worker's secrets — the stored hashes are inert, because candidate passwords cannot even be tested without the key. PBKDF2 (25,000 iterations, per-user salt, ~3ms) sits underneath for the case where `AUTH_SECRET` leaks too. `iterations` is stored per row, so the cost can be raised later and rows re-hash themselves on the next successful sign-in.

The cost of this choice is stated where it bites: rotating `AUTH_SECRET` invalidates every stored password, not just every session.

**Residual risk, stated plainly:** a student can type their name into an open-ended answer. No system can prevent that. The presenter can delete any response in one click, and the input's placeholder discourages it. This is the one FERPA surface that is procedural rather than structural.

---

## 6. What gets built (scope)

**In:** deck editor with plain-text import/export; 7 question types; presenter view with live animated results, pacing controls, timer, corner QR, and re-ask/delta; mobile-first participant view; session archive with CSV export; 8 themes with gradient/pattern/solid/custom-image backgrounds.

**Out (per `phase1-competitive-research.md` §7):** PowerPoint/Slides add-ins (deferred by request; also the #1 fragility complaint in the research), any participant-identifying feature, LMS/LTI grade passback, SMS voting, AI generation.

---

## 7. If a limit is ever hit

- **More load than the free tier allows** → the Workers paid plan is $5/month and raises every ceiling by orders of magnitude. Nothing about the code changes.
- **Cloudflare changes terms** → decks are plain text files you already have, and the data is standard SQLite. `app/db.js` is the only file that knows a backend exists — which is exactly how this migration off Supabase touched no page controller, no chart, and no test.
