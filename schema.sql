-- Habit Tracker — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.habits (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  name                     text not null,
  type                     text not null
                             check (type in ('good','bad','neutral','people_hangcall','people_text')),
  emoji                    text not null default '✅',
  reminder_enabled         boolean not null default false,
  reminder_threshold_days  integer,          -- nudge when days-since exceeds this
  sort_order               integer not null default 0,
  created_at               timestamptz not null default now()
);

create table if not exists public.entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  habit_id    uuid not null references public.habits(id) on delete cascade,
  logged_at   timestamptz not null default now(),   -- the event time (backdatable)
  created_at  timestamptz not null default now()
);

create index if not exists habits_user_id_idx  on public.habits(user_id);
create index if not exists entries_user_id_idx  on public.entries(user_id);
create index if not exists entries_habit_id_idx on public.entries(habit_id);

-- =========================================================================
-- Row Level Security — this is what keeps every user's data private.
-- With these policies, a query can only ever touch rows owned by the
-- logged-in user, so the same app safely serves 1 person or 1,000.
-- =========================================================================

alter table public.habits  enable row level security;
alter table public.entries enable row level security;

drop policy if exists "habits are private to owner" on public.habits;
create policy "habits are private to owner" on public.habits
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "entries are private to owner" on public.entries;
create policy "entries are private to owner" on public.entries
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================================
-- Table privileges. RLS decides WHICH ROWS; these GRANTs decide who may
-- touch the tables at all. Logged-in users get access; anonymous gets none.
-- =========================================================================

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.habits, public.entries to authenticated;
-- service_role is what the push Edge Function uses to read habits/entries for all users.
grant select, insert, update, delete on public.habits, public.entries to service_role;
