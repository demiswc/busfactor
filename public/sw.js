// busfactor service worker: shows check-in reminders sent to this device, nothing else.
// It does not cache pages and never checks you in by itself: tapping a reminder opens a page
// where you confirm you are OK.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(d.title || 'busfactor', {
    body: d.body || 'Time for your check-in.',
    tag: d.tag || 'busfactor',
    renotify: true,
    requireInteraction: !!d.urgent,
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    data: { url: d.url || '/dashboard' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  let target
  try { target = new URL(event.notification.data && event.notification.data.url, self.location.origin) } catch { target = new URL('/dashboard', self.location.origin) }
  if (target.origin !== self.location.origin) target = new URL('/dashboard', self.location.origin)
  event.waitUntil(self.clients.openWindow(target.href))
})
