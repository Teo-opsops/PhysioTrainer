const CACHE_NAME = 'physiotrainer-v4';
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

// Fetch event: Network-First strategy
self.addEventListener('fetch', event => {
    event.respondWith(
        fetch(event.request).catch(() => {
            if (event.request.mode === 'navigate') {
                return caches.match('./index.html');
            }
            return caches.match(event.request);
        })
    );
});
