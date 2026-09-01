# Habit Tracker — Handoff Snapshot 2026-09-01

## What was done
Diagnosed and fixed the intermittent black-screen-on-launch on the iPhone home-screen PWA.
Two network-dependent boot delays were the cause: supabase-js was a render-blocking CDN
script that was never cached, and the service worker served even its own shell files
network-first. Fix: vendored supabase-js (pinned 2.112.4) and load it locally; switched the
SW to stale-while-revalidate (show saved copy instantly, refresh in background, offline
fallback to the shell); kept the existing auto-reload so real updates still land in-session.

## Current state of key artifacts
- Branch `main`, last commit **`b50efd3`** — pushed; remote `main` HEAD confirmed `b50efd3`.
- `supabase-2.112.4.min.js` — new vendored file at repo root, tracked in git.
- `index.html` — loads the local vendored lib (CDN `<script>` removed).
- `sw.js` — `CACHE = "habit-shell-v44"`, vendored lib added to `SHELL`, fetch handler now
  stale-while-revalidate for same-origin.
- `app.js` — `APP_BUILD = "44"`.
- Uncommitted noise only: `.DS_Store` files and a `.docx` task log (not part of the app).

## Outstanding open items
- **Verify on a physical iPhone** that the black screen is gone once GitHub Pages redeploys.
  The first open after deploy may refresh once as the new SW swaps in — expected, one-time.
- No other work in flight.

## Recommended next action
Confirm the fix on device. If the black screen persists, re-examine `app.js` boot path
(does anything else block first paint on the network before a screen is un-hidden?) and the
`controllerchange` reload timing in `index.html`.
