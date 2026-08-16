-- Migration 0002 — allow the pedagogy question types
-- (spectrum, sample_vote, heatmap) past the questions.type CHECK.
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt and the rows copied. Run against BOTH databases:
--
--   local dev:   npx wrangler d1 execute DB --local  --file=worker/migrations/0002-new-question-types.sql
--   production:  npx wrangler d1 execute DB --remote --file=worker/migrations/0002-new-question-types.sql
--
-- (The binding name `DB` comes from wrangler.jsonc. Safe to re-run: the
-- rebuild is idempotent in effect — it recreates the same rows.)

pragma foreign_keys = off;

create table questions_new (
  id         text primary key,
  deck_id    text not null references decks (id) on delete cascade,
  position   integer not null default 0,
  type       text not null check (type in (
               'multiple_choice','word_cloud','open_ended',
               'scales','ranking','quiz','qa',
               'spectrum','sample_vote','heatmap')),
  prompt     text not null default '',
  config     text not null default '{}',
  created_at integer not null
);

insert into questions_new select id, deck_id, position, type, prompt, config, created_at from questions;

drop table questions;

alter table questions_new rename to questions;

create index if not exists questions_deck_idx on questions (deck_id, position);

pragma foreign_keys = on;
