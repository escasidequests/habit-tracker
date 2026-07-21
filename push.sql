-- Habit Tracker — Web Push: subscriptions table
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Stores one row per device/browser a user has enabled notifications on.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,        -- the browser's push endpoint URL
  p256dh      text not null,               -- encryption key (from the subscription)
  auth        text not null,               -- auth secret (from the subscription)
  user_agent  text,                        -- which device/browser, for your reference
  created_at  timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

-- Row Level Security: a user can only see/modify their own subscriptions.
alter table public.push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.push_subscriptions to authenticated;
