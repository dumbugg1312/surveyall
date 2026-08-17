-- Migration 0004 — the feedback table behind the quill button.
--
-- A database created from worker/schema.sql after this date already has
-- it; an older one does not, and every POST to /api/feedback fails until
-- this runs. Run against BOTH databases:
--
--   local dev:   npx wrangler d1 execute DB --local  --file=worker/migrations/0004-feedback.sql
--   production:  npx wrangler d1 execute DB --remote --file=worker/migrations/0004-feedback.sql
--
-- (The binding name `DB` comes from wrangler.jsonc. Safe to re-run.)
--
-- KEEP THIS IDENTICAL TO THE `feedback` BLOCK IN worker/schema.sql,
-- including the FERPA note there: no IP, no email, no contact field, and
-- `page` is a path rather than a URL.

create table if not exists feedback (
  id         text primary key,
  body       text not null,
  page       text not null default '',
  from_user  text not null default '',
  handled    integer not null default 0,
  created_at integer not null
);

create index if not exists feedback_created_idx on feedback (created_at desc);
