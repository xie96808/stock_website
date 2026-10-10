/* Minimal service worker for PWA installability.
 * Network-only fetch — does not cache app shell (avoids stale deploys).
 */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through; presence of fetch handler satisfies Chromium install criteria.
  event.respondWith(fetch(event.request));
});
