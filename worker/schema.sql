-- =====================================================================
-- SurveyAll — Cloudflare D1 (SQLite) schema
--
-- Run this ONCE against your D1 database. See docs/DEPLOYMENT.md.
-- Every statement is idempotent, so it is safe to re-run.
-- =====================================================================
--
-- FERPA NOTE — read before changing anything here:
--
-- There is deliberately NO column anywhere in this schema that can hold a
-- student name, email, student ID, IP address, or device fingerprint.
-- The only per-respondent value is `pseudonym`, a random two-word label
-- assigned by the server, scoped to a SINGLE session, and never reused or
-- linked across sessions. Two responses carrying the same pseudonym in
-- two different sessions are NOT the same student as far as this database
-- is concerned — there is no key that could join them.
--
-- If you ever add a column that identifies a person, this app stops being
-- FERPA-safe by design. Don't.
-- =====================================================================
--
-- SECURITY MODEL — this differs from the Postgres version, so read it:
--
-- The original build ran on Postgres and used Row Level Security, which
-- let the DATABASE itself refuse to serve a quiz answer key to a student.
-- SQLite/D1 has no RLS. Every one of those guarantees now lives in the
-- Worker (worker/index.js) instead, which is the only thing that ever
-- talks to this database — students hold no database credentials at all,
-- only a session code.
--
-- That is a genuinely different shape of protection, and the tradeoff is
-- worth stating plainly: with RLS, a bug in the app could not leak
-- answers because the database would still say no. Here, the Worker is
-- the single line of defence, so the rules in it must not be bypassed.
-- The invariants it enforces:
--
--   1. Answer keys are stripped server-side before a question is sent to
--      a phone (never send `config.correct` to a participant).
--   2. Participants may write a response ONLY to the question that is
--      live right now, in a session that is live and accepting, at the
--      current round.
--   3. Participants may never read raw responses — only aggregates, and
--      only once the presenter has revealed them.
--   4. Everything under an instructor's account is scoped by owner_id on
--      every single query.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- USERS — one row per instructor.
--
-- FERPA NOTE, because this table is the exception to the rule above:
-- these are STAFF accounts, never students. A student never appears
-- here, never signs up, and never holds a credential of any kind. The
-- only personal data in this entire database is what an instructor
-- chooses as their username, and it is not verified to be a real name.
--
-- There is deliberately NO email column. Accounts are created with a
-- shared signup code (see SIGNUP_CODE in worker/auth.js), so there is
-- nothing to verify by email and nothing to send mail to. The cost of
-- that choice is real and is documented in docs/DEPLOYMENT.md: a
-- forgotten password can only be reset by an admin, because there is no
-- address to send a reset link to.
--
-- PASSWORD STORAGE — read before changing the numbers:
--
-- Cloudflare's free plan allows 10ms of CPU per request (see
-- docs/architecture.md §2), which rules out PBKDF2 at the iteration
-- count you would normally pick: 100,000 iterations measures ~11ms on a
-- development laptop and Workers CPU is slower still, so the request
-- would be killed mid-hash.
--
-- So the defence is layered rather than piled onto iteration count:
--
--   1. PEPPER. The password is HMAC-SHA256'd with AUTH_SECRET *before*
--      hashing. AUTH_SECRET lives in Cloudflare's encrypted secret
--      store, never in this database and never in the repo. An attacker
--      who obtains a dump of this table therefore has nothing to grind:
--      without the pepper, no candidate password can even be tested.
--      This is the layer doing the real work.
--   2. PBKDF2-SHA256 over a per-user random salt, so that if AUTH_SECRET
--      leaks *as well*, cracking is still per-user and not free.
--
-- `iterations` is stored PER ROW rather than hardcoded, so the cost can
-- be raised later without invalidating existing passwords — auth.js
-- transparently re-hashes on the next successful sign-in. Raise the
-- default in auth.js (PBKDF2_ITERATIONS); do not edit rows here.
-- ---------------------------------------------------------------------
create table if not exists users (
  id            text primary key,
  -- Lowercased on write, so 'Brandon' and 'brandon' cannot both exist.
  username      text not null unique,
  password_hash text not null,
  salt          text not null,
  iterations    integer not null,
  -- Admins can reset another user's password. The FIRST account created
  -- becomes admin; see bootstrap in worker/auth.js.
  is_admin      integer not null default 0,
  created_at    integer not null,
  last_seen_at  integer
);

-- ---------------------------------------------------------------------
-- AUTH_THROTTLE — rate limiting for sign-in and sign-up.
--
-- Keyed by USERNAME (for sign-in) or by the fixed string 'signup', and
-- deliberately NOT by IP address. Throttling by IP is the obvious
-- implementation and it is the wrong one here: it would mean this
-- database storing a network identifier for every person who mistypes a
-- password, which breaks the guarantee stated at the top of this file
-- that no table can hold an IP. Per-username throttling stops password
-- guessing against a specific account, which is the threat that matters;
-- a global counter caps signup spam. Neither records who anyone is.
--
-- Sign-in uses ESCALATING lockout: each consecutive failure doubles the
-- wait, up to an hour. That is not a detail — passwords here may be as
-- short as a 4-digit PIN, and this table is what makes that survivable.
-- The full reasoning, the arithmetic, and the denial-of-service tradeoff
-- it carries are documented at SIGNIN_FREE_ATTEMPTS in worker/auth.js.
-- Read that before changing any of it.
--
-- `retry_after` is an epoch-ms deadline: refuse this key until then.
-- `last_fail_at` doubles as the decay clock, so an old failure is
-- forgotten rather than counted toward a future lockout.
-- ---------------------------------------------------------------------
create table if not exists auth_throttle (
  key          text primary key,
  attempts     integer not null default 0,
  last_fail_at integer not null default 0,
  retry_after  integer not null default 0
);

-- ---------------------------------------------------------------------
-- DECKS — a reusable set of questions.
-- `background` is a JSON blob; see app/themes.js for its shape.
-- ---------------------------------------------------------------------
create table if not exists decks (
  id         text primary key,
  owner_id   text not null default 'owner',
  -- The deck's permanent join code, assigned when it is created.
  --
  -- A code used to belong to a session, which meant a deck had nothing to
  -- print until a session started — so the instructions slide could only
  -- show a placeholder while you were writing it. The code lives here
  -- instead, so the slide shows a real code and a real QR at authoring
  -- time, and students scanning it land on whichever session of this deck
  -- is currently running. Nullable so existing databases can be migrated
  -- with a bare ADD COLUMN; the Worker fills it in on first use.
  join_code  text,
  title      text not null default 'Untitled deck',
  theme      text not null default 'lecture-hall',
  background text not null default '{"kind":"theme"}',
  settings   text not null default '{}',
  created_at integer not null,
  updated_at integer not null
);

create index if not exists decks_owner_idx on decks (owner_id, updated_at desc);

-- ---------------------------------------------------------------------
-- QUESTIONS — ordered within a deck.
--
-- `config` holds everything type-specific, INCLUDING quiz answer keys.
-- The Worker strips those before any participant response leaves it.
-- ---------------------------------------------------------------------
create table if not exists questions (
  id         text primary key,
  deck_id    text not null references decks (id) on delete cascade,
  position   integer not null default 0,
  -- KEEP IN STEP WITH QUESTION_TYPES IN app/logic.js. This list is the
  -- second place a slide type has to be declared, and SQLite will not let
  -- you ALTER a CHECK afterwards — adding a type here on an existing
  -- database means rebuilding the table. Adding 'instructions' without
  -- this line is exactly how the editor's "add slide" button went dead
  -- while every other type kept working.
  type       text not null check (type in (
               'instructions',
               'multiple_choice','word_cloud','open_ended',
               'scales','ranking','quiz','qa',
               'spectrum','sample_vote','heatmap',
               'traffic','mood','this_or_that',
               'budget','probability',
               'cloze','matching','timeline',
               'exit_ticket')),
  prompt     text not null default '',
  config     text not null default '{}',
  created_at integer not null
);

create index if not exists questions_deck_idx on questions (deck_id, position);

-- Deck codes must be unique, and SQLite allows many NULLs in a unique
-- index — which is what lets a migrated database sit with un-coded decks
-- until the Worker assigns them. It is also what makes the retry loop in
-- ensureDeckCode() correct: a colliding UPDATE raises here, rather than
-- silently handing two decks the same code.
create unique index if not exists decks_join_code_idx on decks (join_code);

-- ---------------------------------------------------------------------
-- SESSIONS — one live run of a deck.
--
-- `theme` is copied from the deck at creation: a participant's phone
-- needs to know which palette to use but must never be able to read the
-- decks table. Only the theme NAME travels; background images stay on
-- the projector.
-- ---------------------------------------------------------------------
create table if not exists sessions (
  id                  text primary key,
  deck_id             text not null references decks (id) on delete cascade,
  owner_id            text not null default 'owner',
  join_code           text not null unique,
  label               text not null default '',
  theme               text not null default 'lecture-hall',
  state               text not null default 'lobby'
                      check (state in ('lobby','live','ended')),
  current_question_id text,
  current_round       integer not null default 1,
  accepting           integer not null default 1,   -- 0/1 booleans
  reveal              integer not null default 1,
  show_on_devices     integer not null default 0,
  qa_moderated        integer not null default 1,
  created_at          integer not null,
  started_at          integer,
  ended_at            integer
);

create index if not exists sessions_owner_idx on sessions (owner_id, created_at desc);
create index if not exists sessions_code_idx  on sessions (join_code);

-- ---------------------------------------------------------------------
-- SESSION_PSEUDONYMS — the claimed-label registry for one session.
-- Guarantees each device gets a DISTINCT label so a quiz leaderboard
-- adds up. Rows here are random labels and nothing else.
-- ---------------------------------------------------------------------
create table if not exists session_pseudonyms (
  session_id text not null references sessions (id) on delete cascade,
  pseudonym  text not null,
  claimed_at integer not null,
  primary key (session_id, pseudonym)
);

-- ---------------------------------------------------------------------
-- RESPONSES — the actual answers.
--
-- `round` supports Re-ask (ask again after discussion, then diff the two).
-- `slot` lets one pseudonym submit several answers to types that allow it
-- (word cloud, open ended) while single-answer types upsert cleanly on
-- the unique key below.
-- ---------------------------------------------------------------------
create table if not exists responses (
  id          integer primary key autoincrement,
  session_id  text not null references sessions (id) on delete cascade,
  question_id text not null references questions (id) on delete cascade,
  round       integer not null default 1,
  pseudonym   text not null,
  slot        integer not null default 0,
  payload     text not null,
  created_at  integer not null,
  unique (session_id, question_id, round, pseudonym, slot)
);

create index if not exists responses_lookup_idx
  on responses (session_id, question_id, round);

-- ---------------------------------------------------------------------
-- AUDIENCE_QUESTIONS — the Q&A backchannel.
-- Moderation (hide until approved) is FREE here. All three commercial
-- tools charge for it; it costs one boolean.
-- ---------------------------------------------------------------------
create table if not exists audience_questions (
  id         integer primary key autoincrement,
  session_id text not null references sessions (id) on delete cascade,
  body       text not null,
  upvotes    integer not null default 0,
  approved   integer not null default 0,
  answered   integer not null default 0,
  created_at integer not null
);

create index if not exists audience_questions_session_idx
  on audience_questions (session_id, created_at desc);

-- ---------------------------------------------------------------------
-- BACKGROUNDS — instructor-uploaded projector backdrops.
--
-- Stored inline as a data URI rather than in object storage: R2 wants a
-- payment method on file, and this project's hard rule is that no credit
-- card is ever required. The client downscales and re-encodes to JPEG
-- before upload (see app/db.js), so a backdrop lands around 200–400 KB
-- against D1's 500 MB ceiling — room for hundreds of images.
--
-- These are the instructor's own files. Students never upload anything,
-- anywhere in this app.
-- ---------------------------------------------------------------------
create table if not exists backgrounds (
  id         text primary key,
  owner_id   text not null default 'owner',
  data_uri   text not null,
  bytes      integer not null,
  created_at integer not null
);

create index if not exists backgrounds_owner_idx on backgrounds (owner_id, created_at desc);
