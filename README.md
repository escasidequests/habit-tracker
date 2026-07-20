# Habit Tracker

A free, private habit tracker. Front end on **GitHub Pages**, data + accounts on
**Supabase**. Rebuild of the original Airtable version. See `PLAN.md` for the full design
and the reasoning behind the architecture.

## Files
- `index.html`, `styles.css`, `app.js` — the app (plain JS, no build step)
- `config.js` — your Supabase URL + anon key (safe to commit)
- `schema.sql` — database tables + row-level security
- `build_seed.py` / `seed.sql` — migrates your old Airtable CSVs into Supabase
- `manifest.webmanifest`, `sw.js` — makes it installable + offline-capable (PWA)

## One-time setup

### 1. Supabase project
1. Go to supabase.com → **sign in with GitHub** (the personal `escamakes` account —
   double-check the avatar is correct first).
2. **New project.** Pick a name, a strong database password, and the closest region.
3. Wait for it to finish provisioning (~2 min).

### 2. Create the tables
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste all of `schema.sql`, click **Run**. You should see "Success".

### 3. Make your account
1. Left sidebar → **Authentication → Users → Add user → Create new user**.
2. Use `escamakes@gmail.com` and a password. (Tick "auto-confirm" so you can log in
   immediately.) This must exist *before* the next step, because the seed data attaches
   to this user.

### 4. Load your old data (optional but nice)
1. Confirm the email at the top of `seed.sql` matches the user you just created
   (regenerate with `python3 build_seed.py` if you change it).
2. SQL Editor → **New query** → paste all of `seed.sql` → **Run**.
3. Your ~30 habits and ~78 entries are now in.

### 5. Point the app at your project
1. Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. Paste both into `config.js`.

### 6. Deploy to GitHub Pages
1. Create a repo named **`habit-tracker`** under the personal account.
2. Push these files to it.
3. Repo → **Settings → Pages** → Source = **Deploy from a branch** → branch `main`, folder
   `/ (root)` → Save.
4. Your app is live at `https://escamakes.github.io/habit-tracker/`.
5. On your phone, open that URL in Safari → **Share → Add to Home Screen** to install it.

## Using it
- **Tap a tile** to log the habit right now.
- **Tap the emoji** to change it.
- **Tap ⋯** to backdate a log or delete the habit.
- **+ Habit** adds a new one (name, type, emoji, optional reminder threshold).
- Habits past their reminder threshold get a gold border and sort to the top.

## Notes
- The anon key in `config.js` is meant to be public — row-level security keeps each
  user's data private. Never put the `service_role` key in the front end.
- Free Supabase projects pause after ~1 week of inactivity; a daily-use tracker won't
  trigger it. A keep-alive ping comes with the push-notifications fast-follow.
- Add `icon-192.png` and `icon-512.png` for a custom home-screen icon (optional).
