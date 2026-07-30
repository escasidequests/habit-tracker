-- Habit Tracker — Phase 7 migration
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Two changes:
--   1. Rename the habit "type" values good/bad/neutral/people_* → build/break/track/bonds.
--      NOTE: "People — Hang/Call" and "People — Text" BOTH fold into a single "bonds"
--      type. That specific split is NOT recoverable afterward — use the new sections
--      feature to re-separate those habits if you want them apart again.
--   2. Add user-defined "sections" for organizing the home screen, plus a
--      habits.section_id link. Existing habits get section_id = NULL and show up as
--      "Ungrouped" until you assign them.

-- ---- 1. Type rename -------------------------------------------------------

-- Drop the old CHECK first; otherwise the UPDATE below would violate it.
alter table public.habits drop constraint if exists habits_type_check;

update public.habits set type = case type
    when 'good'            then 'build'
    when 'bad'             then 'break'
    when 'neutral'         then 'track'
    when 'people_hangcall' then 'bonds'
    when 'people_text'     then 'bonds'
    else type
  end
 where type in ('good', 'bad', 'neutral', 'people_hangcall', 'people_text');

alter table public.habits
  add constraint habits_type_check check (type in ('build', 'break', 'track', 'bonds'));

-- ---- 2. Sections ----------------------------------------------------------

create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  collapsed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists sections_user_id_idx on public.sections(user_id);

-- Deleting a section sets its habits' section_id to NULL (they become Ungrouped);
-- it never deletes the habits themselves.
alter table public.habits
  add column if not exists section_id uuid references public.sections(id) on delete set null;

alter table public.sections enable row level security;

drop policy if exists "sections are private to owner" on public.sections;
create policy "sections are private to owner" on public.sections
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.sections to authenticated;
