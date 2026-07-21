-- Habit Tracker — Phase 3 (lead-time nudges) migration
-- Run this once in the Supabase SQL Editor, BEFORE deploying the Build-23 front
-- end and the updated send-reminders function. Idempotent / safe to re-run.
--
-- Adds a per-habit lead time: how many days BEFORE a habit is due to start
-- nudging. 0 (the default) = only nudge once it's actually overdue, which is
-- exactly today's behavior — so existing habits are unaffected until you set it.

alter table public.habits add column if not exists reminder_lead_days integer not null default 0;
