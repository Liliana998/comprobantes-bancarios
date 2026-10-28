// Archivo de Comprobantes - service worker minimo.
// Solo permite instalar la aplicacion. No guarda comprobantes, datos,
// busquedas ni respuestas del servicio: todo se pide siempre a internet.
const VERSION_AC = 'ac-v3';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', function (e) {
  // Solo la propia pagina; nunca las consultas al servicio de Google.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" ' +
      'content="width=device-width,initial-scale=1"><body style="font-family:' +
      'system-ui;background:#F7F1E8;color:#604A33;padding:32px;text-align:center">' +
      '<h2>Sin conexión</h2><p>El Archivo de Comprobantes necesita internet.' +
      '</p><button onclick="location.reload()" style="height:48px;padding:0 24px;' +
      'border-radius:14px;border:none;background:#604A33;color:#fff;font-size:16px">' +
      'Reintentar</button></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }));
});
