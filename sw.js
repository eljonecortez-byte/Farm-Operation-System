// Service Worker for Coconut Farm Operations & KPI Management System
const CACHE_NAME = 'farmops-kpi-v3.3.0';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/db.js',
  './js/auth.js',
  './js/sync.js',
  './js/app.js',
  './js/cycle.js',
  './manifest.json',
  './icons/icon.svg'
];

// Install Event - Pre-cache core application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline assets for FarmOps');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up obsolete caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting legacy cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Stale-While-Revalidate for app assets, Network-only/fallback for GAS API
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // External Google Apps Script API calls bypass local asset cache
  if (requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({
          success: false,
          offline: true,
          error: 'Offline: Network request to Google Apps Script failed. Report queued in local IndexedDB.'
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Local assets cache-first / stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Background fetch to update cache
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => { /* offline silent */ });

        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Fallback for HTML navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// Background Sync Event (Supported in Chrome/Android)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-farm-reports') {
    console.log('[SW] Background sync event triggered');
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_BACKGROUND_SYNC' });
        });
      })
    );
  }
});
