-- Habit Tracker — Phase 2 (solo-phase quick wins) migration
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Adds: pin / hide / pause / custom color on habits, notes on entries,
-- global quiet mode on push_settings, and a user_prefs table for cross-device
-- UI preferences (currently just the sort mode).

-- ---- habits: pin / hide / pause / color ---------------------------------
alter table public.habits add column if not exists pinned boolean not null default false;
alter table public.habits add column if not exists hidden boolean not null default false;
alter table public.habits add column if not exists paused boolean not null default false;
alter table public.habits add column if not exists color  text;          -- hex like '#4f8cf5'; null = use type color

-- ---- entries: free-text note per log ------------------------------------
alter table public.entries add column if not exists note text;

-- ---- push_settings: one switch to mute all reminders --------------------
alter table public.push_settings add column if not exists quiet_mode boolean not null default false;

-- ---- user_prefs: per-user UI preferences, synced across devices ---------
create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  sort_mode  text not null default 'manual'
               check (sort_mode in ('manual','activity','created','alpha')),
  updated_at timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

drop policy if exists "own prefs" on public.user_prefs;
create policy "own prefs" on public.user_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.user_prefs to authenticated;
