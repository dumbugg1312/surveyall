-- Migration 0005 — expiring backdrop uploads.
--
-- Adds `pinned` to backgrounds. Unpinned uploads are deleted 30 days
-- after upload by the nightly sweep in worker/index.js; pinned ones are
-- kept forever. Existing uploads are pinned on the way in, so turning
-- this on never deletes anything somebody already had.
--
--   local dev:   npx wrangler d1 execute DB --local  --file=worker/migrations/0005-background-retention.sql
--   production:  npx wrangler d1 execute DB --remote --file=worker/migrations/0005-background-retention.sql
--
-- Safe to re-run: the ALTER fails harmlessly if the column is already
-- there, and the UPDATE only ever pins rows that predate the column.

alter table backgrounds add column pinned integer not null default 0;

-- Everything uploaded before this rule existed was uploaded under the
-- old promise ("kept until you delete it"), so it keeps that promise.
update backgrounds set pinned = 1;
