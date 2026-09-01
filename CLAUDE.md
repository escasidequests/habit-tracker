# Project: Habit Tracker

Personal PWA habit/activity tracker (Supabase + GitHub Pages). This project uses the
three-part handoff pattern (see the `session-handoff-best-practices` skill) — two durable
files, plus an ephemeral re-entry prompt that isn't stored.

**Persistent narrative:** `habit-tracker-working.md`
**Latest handoff:** check the most recent `habit-tracker-handoff-yyyy-mm-dd.md` in this folder.

When starting a session here:
1. Read the persistent narrative first
2. Read the latest handoff doc
3. Verify open items against current file state before acting

## Quick conventions (details in the persistent narrative)
- **Deploy = bump `APP_BUILD` in `app.js` AND `CACHE` in `sw.js` together, then push.**
  Reopen the app to pick up the new shell.
- **Push:** direct-to-main, as `escasidequests` via inline token (the active `gh` account
  is `juliachensuite`, which 403s). Julia runs the push herself via `!`; default-branch
  pushes need her explicit OK.
- **Overlays** must use `.popover` (z-index ≥ 50) or they hide behind `.screen` panels.
