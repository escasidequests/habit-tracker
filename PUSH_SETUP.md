# Web Push — backend setup (Phase 2)

One-time setup so the app sends a daily "habits due" reminder. You run these
in your Supabase project (`fcihxtwxlfmpcefhzgvs`). Do them in order.

> Secrets (the VAPID **private** key and your CRON secret) are **not** in this repo.
> Paste the private key I gave you in chat where noted, and pick your own CRON secret.

---

## 1. Create the tables

Supabase Dashboard → **SQL Editor** → New query → paste & Run, once each:

- `push.sql`  (subscriptions — you may have already run this)
- `push_settings.sql`  (reminder schedule)

## 2. Enable the scheduling extensions

Dashboard → **Database → Extensions** → search and enable:

- **pg_cron**  (runs the job on a schedule)
- **pg_net**   (lets the job call the Edge Function over HTTP)

## 3. Deploy the Edge Function

Dashboard → **Edge Functions** → **Create a function**:

- Name it exactly `send-reminders`.
- Paste the contents of `supabase/functions/send-reminders/index.ts`.
- **Turn OFF "Verify JWT"** for this function (we authenticate with our own secret).
- Deploy.

## 4. Set the function secrets

Dashboard → **Edge Functions → Secrets** (project secrets) → add these four:

| Name | Value |
|------|-------|
| `VAPID_PUBLIC_KEY` | `BOkXGKvmw3aqBT-wMPs9hE8RU2J9yHrU2ymQ2p0KPVYxANW7FXP3paBLJYKUKg2YElm-AJzSJKgzrZ4NofFRvDc` |
| `VAPID_PRIVATE_KEY` | *(the private key from chat — never commit it)* |
| `VAPID_SUBJECT` | `mailto:escamakes@gmail.com` |
| `CRON_SECRET` | *(make up a long random string; you'll reuse it in step 5)* |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically — don't add them.

## 5. Schedule the hourly job

SQL Editor → run this, replacing `<CRON_SECRET>` with the same value from step 4.
It runs every hour on the hour; the function only actually sends to a user when
their local time matches their chosen send hour, so hourly is correct.

```sql
select cron.schedule(
  'send-reminders-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://fcihxtwxlfmpcefhzgvs.functions.supabase.co/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
```

(The hourly hit also keeps the free project awake, so no separate keep-alive is needed.)

To change or remove it later:
```sql
select cron.unschedule('send-reminders-hourly');
```

## 6. Test it immediately

Make sure you have at least one habit that's currently overdue and has reminders on,
and that you tapped **Enable notifications** in the app. Then, from a terminal
(replace `<CRON_SECRET>`):

```bash
curl -X POST 'https://fcihxtwxlfmpcefhzgvs.functions.supabase.co/send-reminders?force=1' \
  -H 'x-cron-secret: <CRON_SECRET>'
```

`?force=1` bypasses the hour/day gating and sends right now. You should get a
notification, and the response shows `{ "ok": true, "users": 1, "sent": 1 }`.
Drop `?force=1` and it behaves exactly as the scheduled job does.

---

## Changing behavior later (no redeploy)

- **When it fires** → open the app → 🔔 → *Reminder schedule* → Send time. (Or edit
  `send_hour` / `timezone` in the `push_settings` row directly.)
- **Turn reminders off** → set `push_settings.enabled = false`.
- **Which habits nudge you** → each habit's reminder toggle/threshold in the app.
- **Message wording / one-digest-vs-per-habit** → the only change that needs a
  redeploy: edit `buildPayload()` in the function and deploy again.
