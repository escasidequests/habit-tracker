#!/usr/bin/env python3
"""
Build seed.sql from the exported Airtable CSVs.

Reads:  "Habit-Grid view.csv", "Entry-Sort Name.csv"
Writes: seed.sql  (paste into Supabase SQL Editor AFTER schema.sql and after
        your user account exists)

The generated SQL looks the owning user up by email, so you never copy a UUID.
Change OWNER_EMAIL below if you sign up under a different address.
"""
import csv
import datetime as dt

OWNER_EMAIL = "escamakes@gmail.com"

TYPE_MAP = {
    "Good Habits": "good",
    "Bad Habits": "bad",
    "Neutral": "neutral",
    "People - Hang/Call": "people_hangcall",
    "People - Text": "people_text",
}

# Sensible defaults — fully editable in the app later.
EMOJI = {
    "Had Soda": "🥤",
    "Drank Alcohol": "🍺",
    "Car Instead of Subway": "🚗",
    "Existential Dread": "😩",
    "Completely Unproductive Day": "🛋️",
    "Washed Hair": "🚿",
    "Laundry": "🧺",
    "Adderall": "💊",
    "Epilate": "🪒",
    "Shave": "🧔",
    "Subway": "🚇",
    "Cry": "😢",
    "Gym": "🏋️",
    "Ate Lunch": "🍽️",
    "Allergy Meds": "🤧",
    "Walked instead of Subway": "🚶",
    "Archery": "🏹",
    "Aerials": "🎪",
    "Aeropress Coffee": "☕",
    "Creatine": "💪",
    "Morning Protein Shake": "🥛",
    "Up before 9": "⏰",
    "Daddy - Call": "📞",
    "Rosa - Hangout": "🧑‍🤝‍🧑",
    "Cyril - Hang": "🧑‍🤝‍🧑",
    "Claire - Hang": "🧑‍🤝‍🧑",
    "Claire - Text": "💬",
    "Cyril - Text": "💬",
    "Rosa - Text": "💬",
    "Daddy - Text": "💬",
}
EMOJI_BY_TYPE = {"good": "✅", "bad": "⛔", "neutral": "➖",
                 "people_hangcall": "🧑‍🤝‍🧑", "people_text": "💬"}


def sq(s: str) -> str:
    """Quote a string for SQL, escaping single quotes."""
    return "'" + s.replace("'", "''") + "'"


def parse_dt(s: str):
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace("am", "AM").replace("pm", "PM")
    for fmt in ("%m/%d/%Y %I:%M%p", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def main():
    out = []
    out.append("-- Seed data generated from the Airtable CSV exports.")
    out.append("-- Run AFTER schema.sql, and AFTER the owner account exists in Auth.")
    out.append(f"-- Owner: {OWNER_EMAIL}\n")

    # ---- Habits ----
    with open("Habit-Grid view.csv", newline="", encoding="utf-8-sig") as f:
        habits = list(csv.DictReader(f))

    out.append("-- Habits")
    for i, h in enumerate(habits):
        name = h["Name"].strip()
        if not name:
            continue
        htype = TYPE_MAP.get(h["Type"].strip(), "neutral")
        emoji = EMOJI.get(name, EMOJI_BY_TYPE[htype])
        thresh_raw = (h.get("Reminder by") or "").strip()
        threshold = None
        try:
            v = int(thresh_raw)
            if v > 0:
                threshold = v
        except ValueError:
            pass
        enabled = "true" if threshold is not None else "false"
        thresh_sql = str(threshold) if threshold is not None else "null"
        out.append(
            "insert into public.habits "
            "(user_id, name, type, emoji, reminder_enabled, reminder_threshold_days, sort_order)\n"
            f"select id, {sq(name)}, {sq(htype)}, {sq(emoji)}, {enabled}, {thresh_sql}, {i}\n"
            f"from auth.users where email = {sq(OWNER_EMAIL)};"
        )

    # ---- Entries ----
    with open("Entry-Sort Name.csv", newline="", encoding="utf-8-sig") as f:
        entries = list(csv.DictReader(f))

    out.append("\n-- Entries (logged_at prefers Date Overwrite, else Date (Concat))")
    skipped = 0
    for e in entries:
        habit = e["Link to Habit"].strip()
        when = parse_dt(e.get("Date Overwrite", "")) or parse_dt(e.get("Date (Concat)", ""))
        if not habit or when is None:
            skipped += 1
            continue
        ts = when.strftime("%Y-%m-%d %H:%M:%S")
        out.append(
            "insert into public.entries (user_id, habit_id, logged_at)\n"
            f"select h.user_id, h.id, {sq(ts)}\n"
            "from public.habits h join auth.users u on u.id = h.user_id\n"
            f"where u.email = {sq(OWNER_EMAIL)} and h.name = {sq(habit)};"
        )

    with open("seed.sql", "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    print(f"Wrote seed.sql — {len(habits)} habits, {len(entries) - skipped} entries "
          f"({skipped} entries skipped for missing habit/date).")


if __name__ == "__main__":
    main()
