-- Habit Tracker — Phase 17 migration (Highlighted tab)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Adds a per-habit "highlighted" flag. A checkbox on the habit screen sets it; the
-- new "★ Highlighted" tab shows a flat, filtered list of just the flagged habits.
-- The habit still lives in its normal category tab too — highlighting only adds it
-- to the Highlighted view, it doesn't move it.

alter table public.habits add column if not exists highlighted boolean not null default false;
