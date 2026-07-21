# Features Roadmap — Solo Phase

_Backlog of features to build **before** adding cross-user / shared functionality._
_Derived from a competitive review of SinceWhen and Since (Day Counter & Tracker), July 2026._
_Last updated: 2026-07-21_

## Scope & sequencing

Everything here ships to the **single-user** app first. The parked cross-user work
(shared boards / "shared home") lives in `SHARING_DESIGN.md` and comes **after** this list.
Rationale: these features harden the core product and most of them (due logic, charts,
notes, export) are things a shared version will also need — better to get them right solo.

**Not being built** (from the competitive review): biometric/FaceID lock (#15 — declined),
plus all iOS-native-only surfaces (Lock Screen widgets, Siri/Shortcuts/NFC, Apple Watch) —
those are impossible in the GitHub Pages PWA stack and are the deliberate trade-off for our
cross-platform + free + own-your-data wedge.

---

## Build phases

Ordered by dependency, then value-to-effort. Phase 1 unlocks the reminder work in Phase 3.

### Phase 1 — Due model foundation
The keystone change. Today a habit has a single `reminder_threshold_days`. We replace that
with an explicit **due mode** chosen at habit creation, so a habit is one of three kinds:

| Due mode | Meaning | "Due" is calculated from |
|---|---|---|
| `recurrence` | User sets a fixed cadence (e.g. every 7 days) | the set interval |
| `interval` | **Smart interval prediction** — app learns the rhythm | rolling average of gaps between entries |
| `none` | **Pure tracking** — no due logic, no nudges | n/a (just logs + days-since) |

- **[#1] Smart interval prediction** — at create time, choose *Set a recurrence* **or**
  *Turn on interval prediction* (mutually exclusive; `none` is the default/off state).
  Prediction is computed on read from the entry history — surfaces "usually every ~N days"
  and "expected today / overdue by N." No stored counters (consistent with the days-since
  design that never stores rollups).
- **[#11] Pure tracking mode** — simply `due_mode = 'none'`; the tile shows days-since/count
  but never nudges or predicts. Falls out of the tri-state for free.

_Proposed schema (`habits`):_
- `due_mode` text not null default `'none'` — `recurrence` | `interval` | `none`
- `recurrence_days` int null — used when `due_mode = 'recurrence'`
- (interval prediction stored nowhere — derived from `entries`)
- Migrate existing `reminder_threshold_days` → `recurrence_days` + `due_mode='recurrence'`.

_Open questions:_ Does "set a recurrence" need day-of-week scheduling (e.g. "every Monday"),
or is a fixed **every-N-days** interval enough for v1? Assuming every-N-days unless you say
otherwise. How many recent gaps should prediction average (all history vs last ~5)?

### Phase 2 — Quick wins (low effort, independent)
Each is small and can ship in any order.

- **[#4] Pin / hide habits** — `pinned` bool (float to top), `hidden` bool (out of main view,
  still tracked). Schema: two flags on `habits`.
- **[#5] Pause / resume** — `paused` bool. Paused habits keep history but drop out of nudges
  and prediction. Distinct from hide (hide is visual; pause stops due logic).
- **[#6] Sort options** — latest activity / created / alphabetical / manual. Client-side; the
  chosen sort is a user preference (local for now, see Open Questions).
- **[#7] Search** — client-side filter across habit names.
- **[#8] Custom tile colors** — `color` text null on `habits`; complements the editable emoji.
- **[#12] Global quiet mode** — one switch to mute all push. `quiet_mode` bool on `push_settings`;
  the send-reminders Edge Function skips users with it on.
- **[#13] Entry notes** — `note` text null on `entries`; shown in the habit's entry history,
  editable in the backdate/entry sheet.

### Phase 3 — Reminder granularity  _(depends on Phase 1)_
- **[#10] Lead-time nudges** — nudge on the due date, or 1–2 days before, per habit.
  Requires a real due date, which Phase 1's due model provides.
  _Schema:_ `reminder_lead_days` int default 0 on `habits` (0 = on due date).
  Extends the existing daily-digest logic in the `send-reminders` Edge Function.

### Phase 4 — Charts
- **[#2] Visual history chart** — per-habit chart in the full habit screen: interval-between-logs
  over time and/or a monthly pattern view. Lightweight (small charting lib or hand-rolled SVG —
  no build step, so avoid anything requiring bundling). Reads existing `entries`.

### Phase 5 — Data portability
- **[#9] In-app export** — self-serve JSON **and** CSV download from within the app (today export
  is only via the Supabase dashboard). Directly reinforces the own-your-data wedge. Client-side
  generation from the user's own rows.

---

## Maybe pile (revisit later)

- **[#3] User-defined categories / groups + filter chips** — deferred because it likely couples
  with the shared version: if we build sharing we'll need a **"shared home"** construct at minimum,
  and grouping should be designed once against that model rather than twice. Revisit alongside
  `SHARING_DESIGN.md`.
- **[#14] Count-down / "time until" a future date** — parked; feels like a different *type* of
  tracking than the days-since/count core. Would need its own tile mode.
- **[#16] Trophies / achievements** — interesting for a future iteration; watch that it doesn't
  cut against the "no streaks, no shame" ethos.

## Polish backlog (shipped but wants refinement)
- **Drag-to-reorder UX** (Phase 2, Build 20) — works, but it's the basic version: tiles snap to
  their slot as you drag over a neighbor, with no floating "ghost" tile following the finger and no
  gap/slide animation. Julia wants this polished later. Ideas: a lifted ghost element that tracks the
  pointer, animated gap opening, auto-scroll near screen edges, subtle haptic on drop (Android only).

## Declined
- **[#15] Biometric / FaceID app lock** — not needed.

---

## Schema change summary (if we build all of Phases 1–5)

`habits`: `+ due_mode`, `+ recurrence_days`, `+ pinned`, `+ hidden`, `+ paused`, `+ color`,
`+ reminder_lead_days` (and retire `reminder_threshold_days` after migration).
`entries`: `+ note`.
`push_settings`: `+ quiet_mode`.
Sort preference: TBD storage (see below).

## Resolved decisions (2026-07-21)
1. **Recurrence granularity:** every-N-days only for now (no day-of-week schedules).
2. **Interval prediction window:** trailing window (adapts to recent rhythm) rather than
   all-history. Exact window size TBD at build (start with last ~5 gaps, tune from real data).
3. **UI prefs storage:** new `user_prefs` table in Supabase (syncs across devices), not
   `localStorage`.
