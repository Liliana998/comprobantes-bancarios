// Archivo de Comprobantes - direccion antigua.
// La aplicacion se traslado a /archivo-comprobantes/. Este service worker
// solo se elimina a si mismo para no interceptar nada en la direccion antigua.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.unregister());
});
