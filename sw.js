const CACHE_NAME = 'physiotrainer-v6'; // v6: skip external URLs
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon.png',
    './sound.aac'
];

// Install event: cache initial assets
self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then(cache => cache.addAll(ASSETS))
    );
});

// Activate event: cleanup old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event: Network-First strategy with dynamic cache update
// CRITICAL: Only handle same-origin requests. External URLs (Google APIs,
// fonts, CDNs) must NOT be intercepted — the Service Worker re-issuing
// cross-origin requests with Authorization headers causes errors.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    // Skip all external (cross-origin) requests — let them go through normally
    if (!event.request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        fetch(event.request, { cache: 'no-store' })
            .then(response => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                return caches.match(event.request);
            })
    );
});
