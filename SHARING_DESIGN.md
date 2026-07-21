# Track Together — Design Doc (draft / exploration)

**Status:** Exploration. Not committed to building. No code written yet.
**Goal:** Let people track *shared* things together — the one thing neither Sincely
nor SinceWhen does — and the strongest wedge for a possible public version.

---

## 1. The three flavors (recap)

- **A. Shared boards** — co-owned habits: anyone in a group can log them, everyone sees
  status, reminders go to all. *(Couples, roommates, families, friend groups.)* ← designed here.
- **B. Accountability circle** — you each keep your own habits; others can *view* + poke. Lighter.
- **C. Two-person "last time" timers** — mutual "when did we last connect." Niche.

This doc designs **A** (the flagship) in full, and sketches **B** as a cheaper fallback (§9).

---

## 2. Core concepts

- **Space** — a shared board (e.g., "Home," "College friends"). Has members and shared habits.
- **Member** — a user who belongs to a space (roles: `owner`, `member`).
- **Personal habit** — today's behavior: `space_id = null`, private to you.
- **Shared habit** — `space_id` set: visible to and loggable by every member of that space.
- Existing entries already record **who logged** (`entries.user_id`), so attribution is free.

## 3. User stories

- As a couple, we add "🪴 Water plants (4d)" to our **Home** space; either of us logs it, and
  the tile shows *"Alex, 2 days ago."* When it's overdue, we **both** get the nudge.
- As a friend group, we track "🍽️ Group dinner (30d)" together so someone organizes it.
- My personal habits (vices, private goals) stay on my own board, invisible to the space.

## 4. UX walkthrough

1. **Create/join a space** — new "Shared" area with a space switcher (Personal ▸ Home ▸ …).
   Create a space → get an **invite link/code** → others tap it to join.
2. **Add a habit** — the New-habit form gains a "Board" selector: *Personal* or a space.
3. **Shared tiles** — same tile, plus an **attribution line** ("Alex · 2 days ago") and a small
   member indicator. Days-since is computed from **all members'** logs.
4. **Reminders** — a shared habit going overdue notifies **every member** (each at their own
   send time), or an assignee (later).
5. **Manage** — space screen: members list, invite link, leave space, rename (owner).

## 5. Data model

```
spaces
  id           uuid pk
  name         text
  invite_code  text unique           -- short code / slug for the join link
  created_by   uuid → auth.users
  created_at   timestamptz

space_members
  space_id     uuid → spaces (on delete cascade)
  user_id      uuid → auth.users (on delete cascade)
  role         text  -- 'owner' | 'member'
  joined_at    timestamptz
  primary key (space_id, user_id)

habits  (add one column)
  space_id     uuid null → spaces (on delete cascade)   -- null = personal
  -- user_id stays as the CREATOR; the space "owns" a shared habit

entries  -- unchanged; user_id already = who logged it

profiles  (NEW — needed for attribution without leaking emails)
  user_id      uuid pk → auth.users
  display_name text          -- "Alex", chosen on signup / first space join
```

**Dependency surfaced:** attribution needs a **display name**. We only have emails today, and
showing co-members each other's email is a privacy problem — so "track together" *requires*
adding a lightweight `profiles` table + a name prompt. Non-obvious but essential.

## 6. Row-Level Security (the hard part)

Today's rule is trivial: `user_id = auth.uid()`. Shared data means **membership-based** policies,
which have a well-known Postgres pitfall: a policy on `space_members` that queries
`space_members` **recurses infinitely**. Standard fix = a `SECURITY DEFINER` helper that bypasses
RLS:

```sql
create function public.is_space_member(p_space uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.space_members
    where space_id = p_space and user_id = auth.uid()
  );
$$;
```

Then, sketched policies:

- **habits SELECT:** `user_id = auth.uid() OR (space_id is not null and is_space_member(space_id))`
- **habits INSERT:** personal (`user_id = auth.uid()` and `space_id is null`) *or* into a space you're in.
- **habits UPDATE/DELETE:** creator or space owner (decision — see §8).
- **entries SELECT/INSERT:** allowed when you can see the parent habit (own, or shared in your space);
  `entries.user_id` is always the logger (`= auth.uid()`).
- **spaces / space_members SELECT:** members can see their spaces + co-members (via the helper).

⚠️ This is the main effort and risk. A mistake here could leak data across spaces — the exact
thing the whole RLS design protects. Needs careful cross-account testing (same discipline as the
`service_role` grant issue we already hit).

## 7. Reminders (push) changes

The Edge Function currently finds *a user's own* overdue habits. It would also need to:
- Include **shared** habits from each space the user belongs to, with days-since computed across
  **all members'** entries.
- Fan a shared overdue habit out to **all members**, each respecting their own send hour.
- Keep dedup so one member's digest merges personal + shared cleanly.

Moderate change; the "due" query gets a shared branch.

## 8. Open decisions (need your calls before building)

1. **Edit/delete a shared habit:** any member, or only creator/owner? *(Recommend: any member can
   log + edit; only creator or space owner can delete.)*
2. **Display names:** real name, first name, or handle? *(Recommend: first name / chosen display
   name; never expose email.)*
3. **Space size:** 2-person only (couples/simplest) or arbitrary groups? *(Recommend: groups, but
   test with 2 first.)*
4. **Reminder targeting:** all members, or an assignee/rotation? *(Recommend: all members for MVP;
   assignment later.)*
5. **One space or many** per user? *(Recommend: many, with a switcher — but MVP could ship one.)*
6. **Layout:** shared + personal on one board with a "Shared" section/tab, or a full space switcher?

## 9. Cheaper alternative — Flavor B (accountability)

If the full build is too much: a **read-only share**. You keep your own habits (no schema change to
sharing/logging), and generate a link that shows a *read-only snapshot* of your board to a friend
(or a friend who's also a member sees but can't log). Far simpler RLS (one-directional visibility),
no `profiles`/attribution-writes complexity, no push fan-out. Less powerful, ~a fraction of the work,
still social. Good stepping-stone.

## 10. Phasing & effort

- **MVP (A-minimal):** `profiles` + one space, invite-by-code, shared habits w/ shared logging +
  attribution (initials/first name), shared reminders. 2-person focus.
- **v1:** multiple spaces + switcher, roles, leave/remove member, rename.
- **Later:** assignment/rotation ("whose turn"), pokes/nudges, per-habit visibility, convert a
  personal habit into a shared one.

**Effort:** largest feature to date — new tables, membership RLS (+ the recursion helper), a
`profiles` prerequisite, invite/join flow, space UI, and push fan-out. Realistically multi-session;
RLS + profiles are the non-obvious costs. Recommend building behind the current friends release, not
blocking it.

---

## Summary

Shared boards are the feature that would most distinguish this from the incumbents, but they're also
the biggest lift — and they pull in two dependencies that aren't obvious from the outside: a
**`profiles`/display-name** table and **membership-based RLS** (with the recursion helper). If the
goal is a quick "together" taste, Flavor B is far cheaper. If the goal is the real wedge for a public
product, Flavor A is the one — worth doing carefully, after the friends release is stable.
