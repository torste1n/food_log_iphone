// Service worker: keeps a copy of the app's files on the phone so it opens without a
// connection. Raise VERSION whenever any file below changes; the phone then fetches the
// new files the next time the app is opened online, and uses them from the launch after.

const VERSION = "6";
const PREFIX = "foodlog-v";             // other apps at the same address keep their own caches
const CACHE = `${PREFIX}${VERSION}`;
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "db.js",
  "export.js",
  "xlsx.js",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()));
});

// App files come from the cache; anything else goes to the network.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(event.request)));
});
