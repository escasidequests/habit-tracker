# Habit Tracker — Build Plan (v1)

_Rebuild of the Airtable habit tracker as a free, privately-hosted web app._
_Last updated: 2026-07-20_

## Goal

Recreate the Airtable "days since / how many times" habit tracker without hitting
Airtable's free-tier limits. Free to host, private data, works on phone + laptop.

## Decisions locked

| Decision | Choice | Why |
|---|---|---|
| Hosting (front end) | **GitHub Pages** | Free static hosting |
| Data + auth (back end) | **Supabase** (free tier) | Private per-user data, real accounts, CSV export |
| Icons | **Emoji** | No image files to host or manage |
| v1 features | **Faithful core** (tap-to-log grid, days-since, count, backdating) | Matches original |
| Reminders | **In-app nudge (v1), web push (fast-follow)** | Push became a priority; delivered via Web Push, not native |
| Front-end stack | **Plain HTML/CSS/JS + Supabase CDN client, no build step** | Simplest to host + maintain |
| Accounts / email | **Personal GitHub account + personal email for GitHub _and_ Supabase** | Keep this fully separate from work — IP ownership + continuity |

## Why Supabase over Firebase / raw databases

The real requirement isn't "a database" — it's **database + accounts + private-per-user
data that a browser can hit directly** (Pages gives us no server of our own).

- **Raw DB hosts (Neon, Turso, PlanetScale, Mongo Atlas, etc.)** — no built-in auth and
  not safe to connect to from a browser; they'd need a self-hosted API layer Pages can't
  provide. Ruled out.
- **Firebase** — a valid BaaS, but NoSQL: the core reminder logic ("nudge if days-since >
  N") is a relational SQL query, which is Supabase's strength and Firestore's awkwardness.
  Also proprietary (lock-in) and JSON-oriented export vs Supabase's direct CSV.
- **Supabase wins** on relational fit, SQL, CSV import/export, and no lock-in (open-source
  Postgres — movable/self-hostable).

### On push (why it doesn't force Firebase)
Web/PWA push uses the **standard Web Push API + VAPID**, not native FCM — Supabase sends
it fine via a scheduled Edge Function. Firebase's push edge is real only for **native
iOS/Android apps**. And even if we go native later, we can **keep Supabase and layer FCM
on purely as the delivery pipe** — going native does not require switching databases.

### Free-tier pausing
Supabase free projects pause after ~1 week of inactivity. Mitigated with a small
**keep-alive ping** (and/or the ~$25/mo Pro tier later) so scheduled reminders fire
reliably. Accepted trade-off.

## Why NOT "CSV in the repo" (the original idea)

GitHub Pages is static-only — a page served from it **cannot write to a file on the
server** (there is no server). Worse for this project: the growth path is
**solo → a few private people → public sign-ups**, and the data **must stay private**.
A CSV committed to a public repo is (1) publicly readable, (2) has no accounts, and
(3) can't isolate per-user data. It would be a dead end requiring two rewrites.

Supabase's **row-level security** is the one feature that carries all three stages with
no rewrite — you just flip on public sign-ups when you're ready.

| Stage | What you turn on | Code change |
|---|---|---|
| 1. Just me | One account (yours), private data | build once |
| 2. A few private people | They sign up; data auto-isolated per user | ~none |
| 3. Public sign-ups | Enable open registration | a toggle |

The CSV instinct is preserved: **Supabase exports to CSV any time**, so you still own
and can pull out your data.

## Data model (two tables)

Collapses the original three Airtable tables into two (emoji replaces the shared Icons library).

### `habits`
- `id` (uuid, pk)
- `user_id` (uuid → auth.users) — RLS key, keeps data private
- `name` (text)
- `type` (text) — `good` | `bad` | `neutral` | `people_hangcall` | `people_text`
- `emoji` (text)
- `reminder_enabled` (bool, default false)
- `reminder_threshold_days` (int, nullable) — nudge if days-since exceeds this
- `sort_order` (int)
- `created_at` (timestamptz, default now())

### `entries` (one row per tap — the real data)
- `id` (uuid, pk)
- `user_id` (uuid → auth.users)
- `habit_id` (uuid → habits, on delete cascade)
- `logged_at` (timestamptz) — the event time, **backdatable** (old `Date Overwrite`)
- `created_at` (timestamptz, default now())

**Days Since** and **total count** are computed from `entries` on read — never stored —
so they can't drift the way Airtable rollups did.

Every table gets RLS policies: a user can only read/write rows where `user_id = auth.uid()`.

## Front end

- Single-page app: `index.html` + `app.js` + `styles.css`, Supabase JS client via CDN.
- **Grid of habit tiles grouped by type**; tap a tile to log an entry (timestamped now).
- Each tile shows emoji, name, **days since**, and **total count**.
- Backdate: long-press / "…" on a tile to log an entry with a chosen past date.
- **Reminder nudge:** habits where `days_since > reminder_threshold_days` highlight and
  sort to the top when the app opens. Pure client-side, works on every device (iPhone included).
- Built as an installable **PWA** (add-to-home-screen) — also sets up future push if wanted.
- Auth: Supabase email/password (or magic link) login screen.

## Migration

One-time script transforms the three existing CSVs into seed data:
- `Habit-Grid view.csv` → `habits` (name, type, emoji mapped from icon name, reminder fields)
- `Entry-Sort Name.csv` → `entries` (logged_at from `Date (Concat)` / `Date Overwrite`, linked to habit)
- `Icons-Grid view.csv` → emoji lookup table for the migration (soda→🥤, dumbbell→🏋️, person→🧑, etc.)

Result: you open v1 to your real ~30 habits and ~78 entries, not a blank slate.

## Build phases

1. **Supabase setup** — create project, run schema SQL + RLS policies. _(You + me; needs your account.)_
2. **Migration script** — CSVs → seed data, loaded into your Supabase.
3. **Front end** — login, grid, tap-to-log, days-since/count, backdating, reminder nudge.
4. **Deploy** — push to a GitHub repo, enable Pages, point the app at your Supabase project.
5. **PWA polish** — installable, offline-friendly shell.

## Fast-follow (post-v1) — web push
Push is a near-term priority, so this is the first thing after v1 (not "optional"):
- Service worker + permission prompt in the PWA (iPhone requires it installed to home screen, iOS 16.4+).
- Store push subscriptions per user in Supabase.
- Scheduled Supabase Edge Function (pg_cron) runs the "days-since > threshold" query daily
  and sends Web Push via VAPID.
- **Keep-alive ping** so the free project doesn't pause and stall reminders.
- _Escape hatch if we ever go native: keep Supabase, add FCM only as the delivery pipe._

## Later (optional)
- Charts / streak history.
- Per-habit notes.

## Free-tier gotchas to know
- Supabase free projects **pause after ~1 week of zero activity** (one click to wake).
  A daily-use tracker basically never triggers this.
- Exact free-tier limits (DB size, auth users) change over time — verify current numbers
  before committing. Confidence: high on fit, medium on exact quotas.

## Open questions for you
1. **Personal** email to use for the new GitHub account + Supabase (kept separate from work).
2. Repo name for GitHub Pages (e.g. `habit-tracker`)? Public repo is fine — **no data lives
   there**, only front-end code; all data is in Supabase.
3. Emoji mapping — happy for me to pick sensible emoji per habit, or want to choose them?
