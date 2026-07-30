/* AAC Conversation Assistant — service worker
 *
 * Strategy:
 *   - Same-origin GET requests: network-first, falling back to cache when
 *     offline. Network-first keeps the app fresh whenever GitHub Pages
 *     redeploys; the cache only serves when the network is unavailable.
 *   - Cross-origin requests (the Claude API at api.anthropic.com, the speech
 *     services, etc.) are never intercepted — they pass straight through.
 *
 * Bump CACHE_VERSION whenever the precached shell changes so old caches are
 * cleaned out on activate.
 */
const CACHE_VERSION = 'aac-v0.5.99';
// Cache Storage is scoped to the ORIGIN, not the path, and activate() below
// deletes every cache that is not this one. Two Conversant deployments on the same
// GitHub Pages origin (/conversant-aac/ and the /conversant-aac-ipad/ trial) would
// therefore delete each other's shell every time the user switched between them —
// self-healing, since fetch is network-first, but it would look like a bug and
// would break offline start for whichever was used last. Including the scope's own
// path segment gives each deployment its own cache namespace.
const SCOPE_TAG = (() => {
    try {
        const seg = new URL(self.registration.scope).pathname.split('/').filter(Boolean).pop();
        return seg ? `${seg}-` : '';
    } catch {
        return '';
    }
})();
const CACHE_NAME = `aac-shell-${SCOPE_TAG}${CACHE_VERSION}`;

// App shell precached on install so the app can cold-start offline.
// Paths are relative to the service worker scope (the site root).
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/stt.js',
  './js/tts.js',
  './js/llm.js',
  './js/ui.js',
  './js/storage.js',
  './js/placeholders.js',
  './js/chime.js',
  './js/practice-scenarios.js',
  './js/engine.js',
  './js/conversation-logic.js',
  './js/transcript-log.js',
  './js/worldview.js',
  './js/relationships.js',
  './js/worldview-ui.js',
  './js/confirm-dialog.js',
  './js/keyboard.js',
  './js/keyboard-layouts.js',
  './js/viewport.js',
  './js/express-items.js',
  './js/express-panel.js',
  './js/data-transfer.js',
  './js/platform.js',
  './js/namespace.js',
  './js/express-editor.js',
  './js/control-phrases.js',
  './js/control-phrases-editor.js',
  './js/icons.js',
  './js/prediction.js',
  './js/whats-new.js',
  './data/placeholders.json',
  './data/words.json',
  './data/pricing.json',
  './data/worldview-questions.json',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll is atomic; if any file 404s the whole install fails, so keep
      // SHELL in sync with what actually ships. `cache: 'reload'` bypasses the
      // browser HTTP cache (GitHub Pages serves max-age=600) so a freshly
      // deployed shell is precached, not a stale copy.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GETs. Everything else (Claude API POSTs,
  // cross-origin assets) bypasses the worker entirely.
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    // `cache: 'no-cache'` forces revalidation with the server (ETag) instead of
    // letting the browser's HTTP cache serve a stale copy within GitHub Pages'
    // max-age=600 window — so a launch while online always gets the latest.
    fetch(new Request(request, { cache: 'no-cache' }))
      .then((response) => {
        // Cache a copy of successful responses for offline fallback.
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // Navigation requests fall back to the cached app shell.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
