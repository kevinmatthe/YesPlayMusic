// Retire the old player cache on upgrade. Personal music APIs must always reach the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
