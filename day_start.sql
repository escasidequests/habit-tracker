-- Habit Tracker — day-start hour migration
-- Run once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: idempotent (IF NOT EXISTS).
--
-- Adds a per-user "day starts at" hour to user_prefs. Calendar-day counts
-- (days-since, due nudges, trends, predictions) treat this hour as the boundary
-- between one day and the next, in the user's local time. Default 0 = midnight;
-- e.g. 4 makes a 1am log count toward the previous day. The Edge Function
-- (send-reminders) reads this column so push reminders agree with the app.

alter table public.user_prefs
  add column if not exists day_start_hour smallint not null default 0
    check (day_start_hour between 0 and 23);
