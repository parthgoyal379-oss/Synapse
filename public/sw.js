/* ─── SYNAPSE Service Worker ─────────────────────────────────────────────── */
const CACHE = 'synapse-v1';
const SHELL  = ['/', '/index.html'];

/* ── Install: cache app shell ─────────────────────────────────────────────── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: purge old caches ───────────────────────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: stale-while-revalidate for shell, pass-through for API ────────── */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never cache Groq API calls
  if (e.request.url.includes('api.groq.com') || e.request.url.includes('anthropic')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached); // network failed → fall back to cache
      return cached || fresh;
    })
  );
});

/* ── Push Notifications ───────────────────────────────────────────────────── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'SYNAPSE', {
      body:    data.body    || "Daily check-in time, soldier. Don't break the streak.",
      icon:    '/icon-192.png',
      badge:   '/icon-192.png',
      vibrate: [200, 100, 200],
      tag:     'synapse-daily',
      renotify: false,
      data:    { url: '/' }
    })
  );
});

/* ── Notification click → open app ───────────────────────────────────────── */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow('/');
    })
  );
});

/* ── Message: schedule local reminder ────────────────────────────────────── */
self.addEventListener('message', e => {
  if (e.data?.type === 'PING') {
    e.ports[0]?.postMessage({ type: 'PONG' });
  }
});