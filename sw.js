const CACHE_NAME = 'crucible-forge-v1';

// The essential UI framework files
const STATIC_ASSETS = [
    '/',
    '/ui/style.css',
    '/ui/themes.js',
    '/ui/js/globals.js',
    '/ui/js/editor.js',
    '/ui/js/filesystem.js',
    '/ui/js/git.js',
    '/ui/js/ai_core.js',
    '/ui/js/settings.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

self.addEventListener('activate', event => {
    self.clients.claim();
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // GUARD CLAUSE: Only intercept standard GET requests
    if (event.request.method !== 'GET') return;

    // GUARD CLAUSE: Bypass the cache entirely for active filesystem operations
    if (url.pathname.startsWith('/api/')) return;

    // STALE-WHILE-REVALIDATE STRATEGY
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            // 1. Trigger the background network fetch to update the cache silently
            const fetchPromise = fetch(event.request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Fails silently if the network connection drops
            });

            // 2. Return the cached file instantly if it exists, otherwise wait for the network
            return cachedResponse || fetchPromise;
        })
    );
});