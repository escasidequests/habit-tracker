# Habit Tracker — Working Notes (Persistent Narrative)

Personal PWA habit/activity tracker. Rebuild of an old Airtable setup onto Supabase
(data/auth) + GitHub Pages (static hosting). Personal project, kept separate from L Suite
work. Used primarily as an "Add to Home Screen" app on iPhone.

## North Star
A fast, offline-tolerant personal tracker for habits you're building, breaking, or just
keeping tabs on (last-done, counts, trends). Instant to open; data always live from Supabase.

## Scope
- **In:** habit logging, counts/days-since/trends, tabs & sections, search, per-log tags,
  photos, push reminders (iOS), a "Bites" meal calendar, CSV/JSON export.
- **Out:** anything tied to work/L Suite; multi-user/social features.

## Stack & layout
- Static front end: `index.html`, `app.js` (single large file), `styles.css`, `config.js`.
- Service worker: `sw.js` (app-shell cache + push notifications).
- Backend: Supabase (Postgres + auth + Edge Functions in `supabase/functions/`). Schema
  changes tracked as `phaseN.sql` files at repo root.
- Supabase JS library is **vendored** at repo root (`supabase-2.112.4.min.js`), loaded
  locally — not from a CDN (see Decisions).

## Standing conventions
- **Deploy = bump `APP_BUILD` in `app.js` AND `CACHE` in `sw.js` together, then push.**
  Reopen the app to pick up the new shell. Build number shows in the UI (topbar + login).
- **Push:** direct-to-main (repo owner is `escasidequests`; deploys GitHub Pages from `main`).
  This machine's `gh` is logged into two accounts; pushing as the active `juliachensuite`
  403s. Push with the escasidequests token inline WITHOUT switching accounts; Julia runs it
  via `!`. Default-branch pushes need Julia's explicit OK. (Details in Claude memory
  `habit-tracker-git-push`.)
- **Overlays:** new overlays must use `.popover` (z-index ≥ 50) or they hide behind
  `.screen` panels. (Claude memory `habit-tracker-zindex-gotcha`.)
- Work proceeds in numbered "phases"; each phase is one commit.

## Big-picture checklist
- [x] Phases 1–15 shipped (tabs/sections, search, undo-delete, Bites meal calendar, 2 emojis,
      push reminders, photos, per-log tags, emoji-picker UX, iPhone tap fixes, etc.).
- [x] **Black-screen-on-launch fix (build 44)** — see Narrative Log 2026-09-01.
- [ ] Future idea: customizable "days-since" awards on a trophy page (Claude memory
      `habit-tracker-trophy-idea`). Not started.

## Decisions log
- **2026-09-01 — Vendor supabase-js locally + cache-first shell.** iOS home-screen launches
  intermittently showed a long black screen. Root cause: (1) supabase-js was a render-blocking
  `<script>` from jsDelivr, re-fetched every launch and never cached (SW skipped it as
  cross-origin), so a slow cold-start hung before `app.js` could paint; (2) the SW served even
  same-origin shell files network-first, so a *slow* (not failed) connection left the cached
  copy unused. Fix: vendored `@supabase/supabase-js` pinned at **2.112.4** into the repo and
  load it locally; switched the SW to **stale-while-revalidate** for same-origin (serve saved
  copy instantly, refresh in background, fall back to shell offline); kept the existing
  `controllerchange` auto-reload so real updates still land within the same session. Trade-off
  accepted: the vendored lib is now frozen until manually updated. Confidence in diagnosis:
  high; not yet verified on a physical iPhone.

## Open questions / flags
- **Verify on device:** confirm the black screen is actually gone after build 44 deploys and
  GitHub Pages rebuilds. First open after deploy may still refresh once (SW swap) — expected.
- When Supabase ships a fix worth taking: re-download a newer pinned `supabase-<ver>.min.js`,
  update the filename in `index.html` + the shell list in `sw.js`, and bump the cache.

## Narrative log
- **2026-09-01** — Diagnosed and fixed the iOS black-screen-on-launch issue. Vendored
  supabase-js 2.112.4, rewrote the SW fetch handler to stale-while-revalidate, bumped build
  43→44. Committed `b50efd3` and pushed to `main` (remote HEAD now `b50efd3`). Awaiting
  on-device confirmation.
