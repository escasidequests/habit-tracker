// Supabase Edge Function: send-reminders
//
// Invoked hourly by pg_cron. For each user whose LOCAL time matches their chosen
// send hour (and who hasn't already been notified today), it finds habits past
// their reminder threshold and sends one Web Push digest to all their devices.
//
// Deploy with JWT verification OFF — we authenticate the cron caller with a
// shared secret header (x-cron-secret) instead.
//
// Required function secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
//   CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const DAY = 86_400_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const db = createClient(SUPABASE_URL, SERVICE_ROLE);

// Current hour (0-23) and calendar date (YYYY-MM-DD) in a given IANA timezone.
function localHour(tz: string, now: Date): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(now),
    10,
  ) % 24;
}
function localDate(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const now = new Date();
  const force = new URL(req.url).searchParams.get("force") === "1"; // manual test: ignore hour/day gating

  const { data: rows, error } = await db
    .from("push_settings")
    .select("user_id, send_hour, timezone, last_notified_on")
    .eq("enabled", true);
  if (error) return json({ error: error.message }, 500);

  let users = 0, sent = 0;
  for (const s of rows ?? []) {
    const tz = s.timezone || "UTC";
    if (!force) {
      if (localHour(tz, now) !== s.send_hour) continue;
      if (s.last_notified_on === localDate(tz, now)) continue;
      // Mark handled for today up front so a duplicate cron tick won't double-send.
      await db.from("push_settings").update({ last_notified_on: localDate(tz, now) }).eq("user_id", s.user_id);
    }
    users++;
    const due = await dueHabits(s.user_id, now);
    if (due.length) sent += await pushToUser(s.user_id, buildPayload(due));
  }
  return json({ ok: true, users, sent });
});

async function dueHabits(userId: string, now: Date) {
  const [{ data: habits }, { data: entries }] = await Promise.all([
    db.from("habits").select("id, name, emoji, reminder_threshold_days")
      .eq("user_id", userId).eq("reminder_enabled", true),
    db.from("entries").select("habit_id, logged_at").eq("user_id", userId),
  ]);
  const last: Record<string, number> = {};
  for (const e of entries ?? []) {
    const t = new Date(e.logged_at).getTime();
    if (!last[e.habit_id] || t > last[e.habit_id]) last[e.habit_id] = t;
  }
  const due: { name: string; emoji: string; days: number | null }[] = [];
  for (const h of habits ?? []) {
    if (!h.reminder_threshold_days) continue;
    const days = last[h.id] ? Math.floor((now.getTime() - last[h.id]) / DAY) : null;
    if (days === null || days > h.reminder_threshold_days) {
      due.push({ name: h.name, emoji: h.emoji, days });
    }
  }
  return due;
}

function buildPayload(due: { name: string; emoji: string; days: number | null }[]) {
  if (due.length === 1) {
    const h = due[0];
    return {
      title: `⏰ ${h.emoji} ${h.name} is due`,
      body: h.days === null ? "You haven't logged this yet." : `It's been ${h.days} days.`,
      url: "./",
    };
  }
  return {
    title: `⏰ ${due.length} habits due`,
    body: due.map((h) => `${h.emoji} ${h.name}`).join(", "),
    url: "./",
  };
}

async function pushToUser(userId: string, payload: unknown) {
  const { data: subs } = await db.from("push_subscriptions")
    .select("id, endpoint, p256dh, auth").eq("user_id", userId);
  let n = 0;
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      n++;
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await db.from("push_subscriptions").delete().eq("id", sub.id); // subscription expired
      }
    }
  }
  return n;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
