// Push handlers for Home's service worker. Home's `service-worker.js` adds ONE line to use them:  importScripts('/push-sw-handlers.js');
// The payload is built by Platform (title/body/url only, no sensitive text). No sound (E14); the url is only ever an in-app path.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title : '2J Fitness';
  const safeUrl = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  event.waitUntil(self.registration.showNotification(title, { body: typeof data.body === 'string' ? data.body : '', tag: typeof data.tag === 'string' ? data.tag : undefined, silent: true, lang: 'es', data: { url: safeUrl } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === self.location.origin);
    return open ? open.focus().then(() => open.navigate(target)) : self.clients.openWindow(target);
  }));
});
