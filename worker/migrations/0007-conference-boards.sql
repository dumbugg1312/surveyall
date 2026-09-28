-- Migration 0007 — conference boards.
--
-- Creates the `conference_boards` table. Instructor data only: student
-- names and topics are held in the ConferenceRoom Durable Object, never
-- here. See the FERPA note on the table in worker/schema.sql.
--
-- Run against BOTH databases:
--
--   local dev:   npx wrangler d1 execute DB --local  --file=worker/migrations/0007-conference-boards.sql
--   production:  npx wrangler d1 execute DB --remote --file=worker/migrations/0007-conference-boards.sql
--
-- Safe to re-run.

create table if not exists conference_boards (
  id         text primary key,
  owner_id   text not null,
  join_code  text not null unique,
  title      text not null default '',
  settings   text not null default '{}',
  created_at integer not null,
  expires_at integer not null,
  ended_at   integer
);

create index if not exists conference_boards_owner_idx
  on conference_boards (owner_id, created_at desc);
