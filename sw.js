// Service worker: lets the site open offline.
//  - the pages, styles, scripts and icons are served from the cache and refreshed in the background
//  - the data files (data/*) are loaded from the network first, and the last copy is kept for offline use
const VERSION = "v1";
const CACHE = `airport-tracker-${VERSION}`;
const SHELL = [
  "./", "index.html", "browse.html", "trends.html", "manifest.webmanifest",
  "assets/site.css", "assets/common.js", "assets/today.js", "assets/browse.js", "assets/trends.js",
  "assets/vendor/chart.umd.min.js", "assets/icons/icon-192.png", "assets/icons/icon-512.png",
  "data/history.csv", "data/status.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // a missing file (for example no data yet) must not stop the install
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const isData = url.pathname.includes("/data/");
  event.respondWith(isData ? networkFirst(request) : staleWhileRevalidate(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await refresh;
  return response || new Response("Offline and not cached yet.", { status: 503, statusText: "Offline" });
}
