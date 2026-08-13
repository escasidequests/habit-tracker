-- Habit Tracker — Phase 9 migration (customizable tab order)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Stores each user's preferred order of the home-screen tabs. The "Due" tab is
-- always pinned first in the app and is NOT included here — only the reorderable
-- tabs (build / break / bonds / buys) are stored, as an ordered JSON array of keys,
-- e.g. ["break", "build", "buys", "bonds"]. NULL = the app's default order.

alter table public.user_prefs
  add column if not exists tab_order jsonb;
