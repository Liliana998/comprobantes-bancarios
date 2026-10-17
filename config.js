// Archivo de Comprobantes - configuracion publica de la aplicacion.
// Estos dos datos NO son secretos: sin la identidad de Google de la
// propietaria y sin el PIN, el servicio no entrega ningun dato.
window.CONFIG_AC = {
  // Direccion de la implementacion de Api.gs (termina en /exec).
  API_URL: 'https://script.google.com/macros/s/AKfycbz0vJyBTiBFbUZ9WFaIuLyY2KdRnYpC9diR3C5JdzEfz92w19MiwEmYqYZ3TEx2UIY-tg/exec',
  // ID de cliente de Google (termina en .apps.googleusercontent.com).
  ID_CLIENTE: '575889810613-87gle57sd5l8rp6je69cc66slnkp5ch6.apps.googleusercontent.com',
  // Minutos en segundo plano tras los cuales se vuelve a pedir el PIN.
  MINUTOS_BLOQUEO: 5
};
