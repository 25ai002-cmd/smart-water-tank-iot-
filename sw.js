/* =====================================================
   sw.js — Service Worker for Push Notifications
   Smart Water Tank Monitor — IoT Semester 3 Project

   This file MUST be served from the root path (/sw.js)
   so it can control the entire origin.

   Events handled:
   - install  : activates worker immediately
   - activate : claims all open tabs
   - push     : shows a system notification
   - notificationclick : focuses or opens the dashboard
   ===================================================== */

const CACHE_NAME = 'water-tank-cache-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/controls.html',
  '/logs.html',
  '/hardware.html',
  '/project.html',
  '/notifications.html',
  '/notifications.js',
  '/style.css?v=4',
  '/common.js',
  '/script.js',
  '/controls.js',
  '/logs.js',
  '/manifest.json',
  '/college_logo.png',
  '/icons/icon-192.png'
];

/* ──────────────────────────────────────────────────
   INSTALL — Cache assets and activate immediately
   ────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

/* ──────────────────────────────────────────────────
   ACTIVATE — Clean old caches and claim clients
   ────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/* ──────────────────────────────────────────────────
   FETCH — Intercept and serve assets (Network-First)
   ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and local origin
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip API routes to avoid caching live state
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache static requests on the fly if successful
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline fallback: try to serve from cache
        return caches.match(event.request);
      })
  );
});


/* ──────────────────────────────────────────────────
   PUSH — show a notification when the server sends one
   ────────────────────────────────────────────────── */
self.addEventListener('push', (event) => {
  let payload = {
    title: '💧 Water Tank Alert',
    body:  'Check your water tank status.',
    icon:  '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag:   'water-tank-alert',
    data:  { url: '/' },
  };

  // Parse JSON payload from server
  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text();
    }
  }

  const notifOptions = {
    body:    payload.body,
    icon:    payload.icon  || '/icons/icon-192.png',
    badge:   payload.badge || '/icons/icon-192.png',
    tag:     payload.tag   || 'water-tank-alert',
    data:    payload.data  || { url: '/' },
    requireInteraction: false,
    vibrate: [200, 100, 200],
    actions: [
      { action: 'open',    title: '📊 Open Dashboard' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, notifOptions)
  );
});

/* ──────────────────────────────────────────────────
   NOTIFICATION CLICK — open or focus the dashboard
   ────────────────────────────────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Dismiss action — do nothing else
  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // If the dashboard is already open, focus it
        for (const client of clients) {
          const url = new URL(client.url);
          if (url.pathname === '/' || url.pathname === targetUrl) {
            return client.focus();
          }
        }
        // Otherwise open a new tab
        return self.clients.openWindow(targetUrl);
      })
  );
});
