// Minimal service worker: caches the app shell so it opens offline.
// Data always comes from Supabase over the network.
const CACHE = "habit-shell-v23";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./config.js",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let Supabase calls hit the network
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

// A push arrived from the server — show a notification (required on iOS).
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { body: e.data && e.data.text() }; }
  const title = data.title || "Habit Tracker";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || "You have habits due.",
    icon: data.icon || "./icon-192.png",
    badge: "./icon-192.png",
    tag: data.tag || "habit-reminder",
    data: { url: data.url || "./" },
  }));
});

// Tapping a notification focuses the app (or opens it).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
