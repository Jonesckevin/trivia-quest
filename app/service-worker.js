// Service Worker for Trivia Quest - Offline PWA Support
const CACHE_NAME = 'trivia-quest-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './themes.js',
  './style.css',
  './logo.svg',
  './manifest.json'
];

// External resources to cache (Google Fonts)
const EXTERNAL_CACHE = [
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Caching app assets');
        // Cache local assets
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        // Try to cache external resources but don't fail if they're unavailable
        return caches.open(CACHE_NAME).then((cache) => {
          return Promise.allSettled(
            EXTERNAL_CACHE.map(url => 
              fetch(url, { mode: 'cors' })
                .then(response => {
                  if (response.ok) {
                    return cache.put(url, response);
                  }
                })
                .catch(() => console.log(`[Service Worker] Could not cache: ${url}`))
            )
          );
        });
      })
      .then(() => {
        console.log('[Service Worker] Installation complete');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => {
              console.log('[Service Worker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - cache-first for static assets, always network for API
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests (POST, PUT, DELETE etc. bypass SW entirely)
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip non-http requests
  if (!event.request.url.startsWith('http')) {
    return;
  }

  const url = new URL(event.request.url);

  // ---- API routes: ALWAYS fetch from network, NEVER cache ----
  // This ensures activate/deactivate/create/delete changes are always reflected.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ---- Static assets: cache-first, update in background ----
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Return cached version immediately and refresh in background
          event.waitUntil(
            fetch(event.request)
              .then((networkResponse) => {
                if (networkResponse && networkResponse.ok) {
                  return caches.open(CACHE_NAME)
                    .then((cache) => cache.put(event.request, networkResponse));
                }
              })
              .catch(() => {})
          );
          return cachedResponse;
        }

        // Not in cache — fetch from network and cache successful responses
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseToCache));
            }
            return networkResponse;
          })
          .catch((error) => {
            console.log('[Service Worker] Fetch failed:', error);
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return new Response(
                `<!DOCTYPE html>
                <html>
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Offline - Trivia Quest</title>
                  <style>
                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                      background: #0d0d1a;
                      color: #e2e8f0;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      height: 100vh;
                      margin: 0;
                      text-align: center;
                    }
                    .offline-message {
                      max-width: 400px;
                      padding: 2rem;
                    }
                    h1 { color: #8b5cf6; }
                    button {
                      background: #8b5cf6;
                      color: white;
                      border: none;
                      padding: 0.75rem 1.5rem;
                      border-radius: 8px;
                      cursor: pointer;
                      font-size: 1rem;
                      margin-top: 1rem;
                    }
                    button:hover { background: #a78bfa; }
                  </style>
                </head>
                <body>
                  <div class="offline-message">
                    <h1>📡 You're Offline</h1>
                    <p>Trivia Quest needs to be loaded at least once while online to work offline.</p>
                    <button onclick="location.reload()">Try Again</button>
                  </div>
                </body>
                </html>`,
                {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: new Headers({ 'Content-Type': 'text/html' })
                }
              );
            }
            
            throw error;
          });
      })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
