// Minimal service worker: caches the app shell so it opens offline.
// Data always comes from Supabase over the network.
const CACHE = "habit-shell-v9";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest"];

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
