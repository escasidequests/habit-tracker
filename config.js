// Supabase connection settings.
// Get these from: Supabase Dashboard → Project Settings → API.
//
// The ANON key is SAFE to commit and expose publicly — it only grants access
// through Row Level Security, so users can still only ever see their own data.
// (Never put the *service_role* key here — that one bypasses RLS.)

window.HABIT_CONFIG = {
  SUPABASE_URL: "https://fcihxtwxlfmpcefhzgvs.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjaWh4dHd4bGZtcGNlZmh6Z3ZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NzgwMjcsImV4cCI6MjEwMDE1NDAyN30.0X6touvuasCyX-gQoqWfqoXszrBJ0ViFHiVl7wogJ68",

  // Web Push public (VAPID) key — safe to expose. The matching PRIVATE key lives
  // only in Supabase as a secret, never here.
  VAPID_PUBLIC_KEY: "BOkXGKvmw3aqBT-wMPs9hE8RU2J9yHrU2ymQ2p0KPVYxANW7FXP3paBLJYKUKg2YElm-AJzSJKgzrZ4NofFRvDc",
};
