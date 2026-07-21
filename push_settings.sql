-- Habit Tracker — Web Push: per-user reminder settings
-- Run this once in the Supabase SQL Editor (after push.sql).
-- These are the tunable knobs the Edge Function reads at send time — change a
-- row here anytime to change WHEN reminders fire; no code redeploy needed.

create table if not exists public.push_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  enabled           boolean not null default true,
  send_hour         integer not null default 8 check (send_hour between 0 and 23),  -- local hour, 0-23
  timezone          text    not null default 'UTC',   -- IANA tz, e.g. America/Los_Angeles
  last_notified_on  date,                              -- guards against double-sends in a day
  updated_at        timestamptz not null default now()
);

alter table public.push_settings enable row level security;

drop policy if exists "own push settings" on public.push_settings;
create policy "own push settings" on public.push_settings
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- authenticated = the app (via RLS); service_role = the Edge Function (bypasses RLS
-- but still needs table privileges).
grant select, insert, update, delete on public.push_settings to authenticated, service_role;
