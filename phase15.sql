-- Habit Tracker — Phase 15 migration (per-log tags / subsets)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Adds tagging so a habit can track subsets of itself. Example: a "Fried Chicken"
-- habit defines tags ["Popeyes", "KFC"]; each log can record which one. The overall
-- habit count is unchanged (still every log); a subset count is the logs with that tag.
--
--  * habits.tags   — the list of tags DEFINED for a habit (drives the log picker and
--                    "has at least one tag" check). Empty by default.
--  * entries.tag   — which tag a given log used (null = logged without a tag).
-- Notes (entries.note) are unaffected — tags are a separate, structured field.

alter table public.habits  add column if not exists tags text[] not null default '{}';
alter table public.entries add column if not exists tag  text;
