-- Migration 0006 — the visual-pedagogy wave.
--
-- 1. Lets the three new slide types past the questions.type CHECK:
--    buckets (card sort), quadrant (two-axis placement), consensus
--    (common ground). SQLite cannot alter a CHECK in place, so the table
--    is rebuilt and the rows copied.
-- 2. Creates the `flares` table for the "lost me" pace channel.
--
-- Run against BOTH databases:
--
--   local dev:   npx wrangler d1 execute DB --local  --file=worker/migrations/0006-visual-pedagogy.sql
--   production:  npx wrangler d1 execute DB --remote --file=worker/migrations/0006-visual-pedagogy.sql
--
-- (The binding name `DB` comes from wrangler.jsonc. Safe to re-run: the
-- rebuild recreates the same rows and the create is IF NOT EXISTS.)
--
-- KEEP THE TYPE LIST BELOW IDENTICAL TO worker/schema.sql AND
-- QUESTION_TYPES IN app/logic.js. tests/run-tests.mjs fails when they
-- drift.

pragma foreign_keys = off;

create table questions_new (
  id         text primary key,
  deck_id    text not null references decks (id) on delete cascade,
  position   integer not null default 0,
  type       text not null check (type in (
               'instructions',
               'multiple_choice','word_cloud','open_ended',
               'scales','ranking','quiz','qa',
               'spectrum','sample_vote','heatmap',
               'traffic','mood','this_or_that',
               'budget','probability',
               'cloze','matching','timeline',
               'exit_ticket',
               'buckets','quadrant','consensus')),
  prompt     text not null default '',
  config     text not null default '{}',
  created_at integer not null
);

insert into questions_new select id, deck_id, position, type, prompt, config, created_at from questions;

drop table questions;

alter table questions_new rename to questions;

create index if not exists questions_deck_idx on questions (deck_id, position);

pragma foreign_keys = on;

create table if not exists flares (
  id          integer primary key autoincrement,
  session_id  text not null references sessions (id) on delete cascade,
  question_id text references questions (id) on delete cascade,
  round       integer not null default 1,
  pseudonym   text not null,
  created_at  integer not null
);

create index if not exists flares_session_idx
  on flares (session_id, created_at desc);
