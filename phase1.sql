-- Habit Tracker — Phase 1 (due model) migration
-- Run this once in the Supabase SQL Editor, BEFORE deploying the Build-22 front end
-- and the updated send-reminders function. Idempotent / safe to re-run.
--
-- Replaces the single "reminder_enabled + reminder_threshold_days" idea with an
-- explicit per-habit due_mode:
--   'none'        → just track, never nudge
--   'recurrence'  → due when days-since exceeds recurrence_days
--   'interval'    → due from a learned average of recent log gaps (computed on read)
--
-- The OLD columns (reminder_enabled, reminder_threshold_days) are intentionally
-- LEFT IN PLACE and untouched — nothing here is destructive, so this is reversible.

alter table public.habits add column if not exists due_mode text not null default 'none'
  check (due_mode in ('none', 'recurrence', 'interval'));
alter table public.habits add column if not exists recurrence_days integer;  -- used when due_mode = 'recurrence'

-- Backfill existing habits from the old reminder columns. The `due_mode = 'none'`
-- guard makes this a no-op on re-run (already-migrated rows are skipped).
update public.habits
   set due_mode = 'recurrence',
       recurrence_days = reminder_threshold_days
 where reminder_enabled = true
   and reminder_threshold_days is not null
   and due_mode = 'none';
