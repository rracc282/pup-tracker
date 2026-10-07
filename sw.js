// Service worker: offline shell + push notifications.
const CACHE = 'churro-v17';
const SHELL = ['./', 'index.html', 'app.js', 'logic.js', 'config.js', 'supabase.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first for our own files (so updates arrive), cache as the offline fallback.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(new Request(e.request, { cache: 'no-cache' })).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
self.addEventListener('push', e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }catch(_){ d = { title: 'Churro', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Churro', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    requireInteraction: !!d.urgent, data: { open: d.open || '' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const open = (e.notification.data && e.notification.data.open) || '';
  e.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(cs => {
    for(const c of cs){
      if('focus' in c){ c.postMessage({ open }); return c.focus(); }
    }
    return self.clients.openWindow('./' + (open ? '?open=' + open : ''));
  }));
});
