importScripts('/push-sw-handlers.js');

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open('2j-hub-static-v2');
  await cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => (name.startsWith('2j-client-static-') || name.startsWith('2j-hub-static-')) && name !== '2j-hub-static-v2').map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) { const cache = await caches.open('2j-hub-static-v2'); await cache.put('/', response.clone()); }
        return response;
      } catch { return (await caches.match('/')) ?? Response.error(); }
    })());
    return;
  }
  if (!['script', 'style', 'image', 'font'].includes(request.destination)) return;
  event.respondWith((async () => {
    const cache = await caches.open('2j-hub-static-v2');
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
