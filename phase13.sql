-- Habit Tracker — Phase 13 migration (new "bites" type for meals)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Adds a "bites" habit type (meals). It behaves like "track" (log each meal, no
-- reminders by default), so no other schema change is needed — just widen the
-- allowed type values.

alter table public.habits drop constraint if exists habits_type_check;
alter table public.habits
  add constraint habits_type_check check (type in ('build', 'break', 'track', 'bonds', 'buys', 'bites'));
