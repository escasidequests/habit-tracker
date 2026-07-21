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

// Interval-prediction tuning — MUST stay in sync with the same constants in app.js.
const PRED_WINDOW = 5;    // average the most recent N gaps
const PRED_MIN_GAPS = 2;  // need at least this many gaps before predicting/nudging
const PRED_GRACE = 1.2;   // "Automatic" habit is due once days-since exceeds avg gap * this

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
    .select("user_id, send_hour, timezone, last_notified_on, quiet_mode")
    .eq("enabled", true)
    .eq("quiet_mode", false); // global mute: skip these users entirely
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

// Average of the most recent gaps (in days) between sorted log times.
// null when there aren't enough gaps yet (still "learning").
function predictedInterval(times: number[]): number | null {
  if (times.length < PRED_MIN_GAPS + 1) return null;
  const sorted = times.slice().sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] - sorted[i - 1]) / DAY);
  const recent = gaps.slice(-PRED_WINDOW);
  return recent.reduce((s, g) => s + g, 0) / recent.length;
}

type Due = { name: string; emoji: string; days: number | null; status: "soon" | "overdue" };

// 'none' | 'soon' | 'overdue'. lead = days before the due point to start nudging
// (0 = only once overdue). MUST mirror dueStatus() in app.js.
function dueStatus(
  dueMode: string,
  recurrenceDays: number | null,
  lead: number,
  avg: number | null,
  days: number | null,
): "none" | "soon" | "overdue" {
  if (dueMode === "recurrence") {
    if (!recurrenceDays) return "none";
    if (days === null || days > recurrenceDays) return "overdue";
    if (days > recurrenceDays - lead) return "soon";
    return "none";
  }
  if (dueMode === "interval") {
    if (avg === null || days === null) return "none"; // never-logged or still learning
    const threshold = avg * PRED_GRACE;
    if (days > threshold) return "overdue";
    if (days > threshold - lead) return "soon";
    return "none";
  }
  return "none";
}

async function dueHabits(userId: string, now: Date) {
  const [{ data: habits }, { data: entries }] = await Promise.all([
    db.from("habits").select("id, name, emoji, due_mode, recurrence_days, reminder_lead_days")
      .eq("user_id", userId).eq("paused", false).neq("due_mode", "none"),
    db.from("entries").select("habit_id, logged_at").eq("user_id", userId),
  ]);
  const times: Record<string, number[]> = {};
  for (const e of entries ?? []) {
    (times[e.habit_id] ||= []).push(new Date(e.logged_at).getTime());
  }
  const due: Due[] = [];
  for (const h of habits ?? []) {
    const list = times[h.id] ?? [];
    const lastAt = list.length ? Math.max(...list) : null;
    const days = lastAt === null ? null : Math.floor((now.getTime() - lastAt) / DAY);
    const avg = h.due_mode === "interval" ? predictedInterval(list) : null;
    const status = dueStatus(h.due_mode, h.recurrence_days, h.reminder_lead_days ?? 0, avg, days);
    if (status !== "none") due.push({ name: h.name, emoji: h.emoji, days, status });
  }
  return due;
}

function buildPayload(due: Due[]) {
  if (due.length === 1) {
    const h = due[0];
    if (h.status === "soon") {
      return { title: `🔔 ${h.emoji} ${h.name} is coming due`, body: "A heads-up — it'll be due soon.", url: "./" };
    }
    return {
      title: `⏰ ${h.emoji} ${h.name} is due`,
      body: h.days === null ? "You haven't logged this yet." : `It's been ${h.days} days.`,
      url: "./",
    };
  }
  const anyOverdue = due.some((h) => h.status === "overdue");
  return {
    title: anyOverdue ? `⏰ ${due.length} habits need attention` : `🔔 ${due.length} habits coming due`,
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
