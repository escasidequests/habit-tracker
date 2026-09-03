-- Habit Tracker — Phase 18 migration (Goals)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- A goal = "log this habit, with a specific tag, N times" — optionally by a target
-- date. Goals live in their own table (one row per goal) so a habit can have several
-- over time; the v1 UI shows one active goal per habit, but the schema already allows
-- stacking (10 → 25 → 50) with no future migration.
--
--  * tag          — REQUIRED. Which subset of the habit counts toward the goal, so
--                   progress is always a filterable slice (e.g. "pixel whip practice").
--  * target_count — how many tagged logs reach the goal.
--  * target_date  — OPTIONAL deadline. Null = open-ended (just a progress bar, no
--                   pace math, never "fails"). Set = the app also shows pace/on-track.
--  * reward       — OPTIONAL free text you type (e.g. "New pixel whip 🎉").
--  * completed_at — set once when the goal is first reached, so the celebration fires
--                   exactly once and the goal stays "done". Null = still active.

create table if not exists public.goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  habit_id      uuid not null references public.habits(id) on delete cascade,
  tag           text not null,
  target_count  integer not null check (target_count > 0),
  target_date   date,
  reward        text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists goals_user_id_idx  on public.goals(user_id);
create index if not exists goals_habit_id_idx on public.goals(habit_id);

-- Row Level Security — same rule as habits/entries: a user can only ever see or touch
-- their own rows.
alter table public.goals enable row level security;

drop policy if exists "goals are private to owner" on public.goals;
create policy "goals are private to owner" on public.goals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.goals to authenticated;
