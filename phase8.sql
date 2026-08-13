-- Habit Tracker — Phase 8 migration ("Buys": cost-per-wear items)
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent / safe to re-run.
--
-- Adds a 5th habit type "buys" (clothing / gear you want to amortize) plus the
-- per-item fields it needs, and a PRIVATE Storage bucket for item photos.
-- No Edge Function change: "buys" items are pure tracking (due_mode stays 'none'),
-- so they never trigger reminders.

-- ---- 1. Allow the new "buys" type ----------------------------------------

alter table public.habits drop constraint if exists habits_type_check;
alter table public.habits
  add constraint habits_type_check check (type in ('build', 'break', 'track', 'bonds', 'buys'));

-- ---- 2. Per-item fields (all nullable; only "buys" items use them) --------

alter table public.habits
  add column if not exists price          numeric(12, 2),
  add column if not exists description    text,
  add column if not exists date_purchased date,
  add column if not exists photo_path     text;  -- object path inside the habit-photos bucket

-- ---- 3. Private Storage bucket for item photos ---------------------------

insert into storage.buckets (id, name, public)
values ('habit-photos', 'habit-photos', false)
on conflict (id) do nothing;

-- Each user can only touch files under a top-level folder named by their user id
-- (the app uploads to "<user_id>/<habit_id>.jpg"). storage.foldername(name)[1]
-- is that first path segment.
drop policy if exists "own habit photos - read"   on storage.objects;
drop policy if exists "own habit photos - insert" on storage.objects;
drop policy if exists "own habit photos - update" on storage.objects;
drop policy if exists "own habit photos - delete" on storage.objects;

create policy "own habit photos - read" on storage.objects
  for select to authenticated
  using (bucket_id = 'habit-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own habit photos - insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'habit-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own habit photos - update" on storage.objects
  for update to authenticated
  using (bucket_id = 'habit-photos' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'habit-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own habit photos - delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'habit-photos' and auth.uid()::text = (storage.foldername(name))[1]);
