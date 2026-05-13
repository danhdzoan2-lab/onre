self.addEventListener('install', event => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const PATCH_VERSION = 'notify-fix-2026-05-13';
const OLD_NOTIFICATION_HELPER = "async function showBrowserNotification(title,options){if(!('Notification'in window)||Notification.permission!=='granted')return;try{const registration=await navigator.serviceWorker.ready;await registration.showNotification(title,options)}catch(err){console.log('Notification failed:',err)}}";
const NEW_NOTIFICATION_HELPER = "async function showBrowserNotification(title,options){if(!('Notification'in window)||Notification.permission!=='granted')return;try{if('serviceWorker'in navigator){const registration=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker not ready')),1500))]);await registration.showNotification(title,options);return}new Notification(title,options)}catch(err){try{new Notification(title,options)}catch(fallbackErr){console.log('Notification failed:',err,fallbackErr)}}}";

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  const isAppShell = request.mode === 'navigate' || (acceptsHtml && (url.pathname === '/' || url.pathname.endsWith('/index.html')));
  if (!isAppShell) return;

  event.respondWith(patchAppShell(request));
});

async function patchAppShell(request) {
  const response = await fetch(request);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  html = html
    .replace(OLD_NOTIFICATION_HELPER, NEW_NOTIFICATION_HELPER)
    .replace('else if(!isHigh&&notifyNormal)', 'else if(notifyNormal)');

  if (!html.includes(PATCH_VERSION)) {
    html = html.replace('</script>', `\n/* ${PATCH_VERSION} */\n</script>`);
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  headers.delete('content-encoding');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
