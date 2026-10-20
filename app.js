/**
 * Archivo de Comprobantes Bancarios - aplicacion instalable (Etapa 3) v2
 * v2: asignar el beneficiario cuando el comprobante no lo trae.
 * v3: recordar este dispositivo. Tras entrar con Google + PIN se guarda una
 *     llave aleatoria del dispositivo; despues basta el PIN (30 dias).
 * Interfaz trasladada de Buscador.html v3 (identidad visual v1.1).
 * Acceso: identidad de Google (una vez por dispositivo) + PIN de 7 digitos
 * (cada vez que se abre). No guarda comprobantes, datos, PIN ni sesiones en
 * el dispositivo: todo vive en memoria mientras la aplicacion esta abierta.
 */
(function () {
  'use strict';

  var CFG = window.CONFIG_AC || {};
  var VISTAS = ['vistaInicio', 'vistaGoogle', 'vistaPin', 'vistaBuscar', 'vistaDetalle'];
  var LARGO_PIN = 7;

  var est = {
    idToken: null,       // justificante de Google (solo en memoria)
    vence: 0,            // vencimiento del justificante (ms)
    sesion: null,        // sesion abierta con el PIN (solo en memoria)
    pinCreado: true,
    pin: '',
    pinPrimero: null,    // al crear el PIN: primera vez escrito
    enviandoPin: false,
    esperaToken: null,   // promesa pendiente de renovar identidad
    ocultoDesde: 0,
    vistaPrevia: null,   // pantalla a la que volver tras el PIN
    googleIniciado: false,
    llave: null          // llave del dispositivo (unico dato guardado aqui)
  };

  /* ====================== LLAVE DEL DISPOSITIVO ====================== */

  var CLAVE_LLAVE = 'ac_llave_dispositivo';

  function leerLlave() {
    try {
      var v = localStorage.getItem(CLAVE_LLAVE);
      return /^[a-f0-9]{64}$/.test(v || '') ? v : null;
    } catch (e) { return null; }
  }

  function guardarLlave(v) {
    est.llave = v;
    try { localStorage.setItem(CLAVE_LLAVE, v); } catch (e) { /* sin almacenamiento */ }
  }

  function olvidarLlave() {
    est.llave = null;
    try { localStorage.removeItem(CLAVE_LLAVE); } catch (e) { /* nada */ }
  }

  function $(id) { return document.getElementById(id); }

  function mostrar(vista) {
    VISTAS.forEach(function (v) { $(v).classList.toggle('oculto', v !== vista); });
    window.scrollTo(0, 0);
  }

  function vistaActual() {
    for (var i = 0; i < VISTAS.length; i++) {
      if (!$(VISTAS[i]).classList.contains('oculto')) return VISTAS[i];
    }
    return null;
  }

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  /* ====================== CONFIGURACION ====================== */

  function configurada() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/
        .test(CFG.API_URL || '') &&
        /\.apps\.googleusercontent\.com$/.test(CFG.ID_CLIENTE || '');
  }

  /* ====================== SERVICIO ====================== */

  function llamar(accion, datos) {
    var cuerpo = Object.assign({ accion: accion, idToken: est.idToken,
                                 sesion: est.sesion }, datos || {});
    return fetch(CFG.API_URL, {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      // text/plain evita la consulta previa que Apps Script no admite.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      credentials: 'omit',   // no envia las sesiones de Google del navegador
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    }).then(function (r) {
      if (!r.ok) return { ok: false, error: 'red' };
      return r.json().catch(function () { return { ok: false, error: 'red' }; });
    }, function () {
      return { ok: false, error: 'red' };
    });
  }

  // Renueva el justificante si esta por vencer y reintenta una vez si el
  // servicio lo rechaza por identidad.
  function api(accion, datos) {
    var previo = (est.idToken && est.vence && est.vence - Date.now() < 120000)
        ? renovarIdentidad() : Promise.resolve(true);
    return previo.then(function () {
      return llamar(accion, datos);
    }).then(function (r) {
      if (!r.ok && r.error === 'identidad' && accion !== 'estado') {
        return renovarIdentidad().then(function (renovado) {
          return renovado ? llamar(accion, datos) : r;
        });
      }
      return r;
    });
  }

  // Manejo comun de errores. Devuelve true si ya se atendio.
  function manejarError(r, salida) {
    if (r.error === 'sesion') {
      est.sesion = null;
      abrirPin('Su sesión terminó. Ingrese su PIN.');
      return true;
    }
    if (r.error === 'identidad') {
      est.idToken = null;
      est.sesion = null;
      pantallaGoogle('Vuelva a iniciar sesión con su cuenta de Google.');
      return true;
    }
    var texto = {
      red: 'No hay conexión con el servicio. Revise su internet e intente de nuevo.',
      config: 'El servicio aún no está configurado (falta el ID de cliente en Api.gs).',
      consulta: 'La búsqueda no es válida.',
      interno: 'Error del servicio: ' + (r.mensaje || 'sin detalle') + '.'
    }[r.error] || 'No se pudo completar la operación.';
    if (salida) salida(texto);
    return false;
  }

  /* ====================== IDENTIDAD DE GOOGLE ====================== */

  function leerJwt(token) {
    try {
      var parte = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(parte));
    } catch (e) {
      return {};
    }
  }

  function iniciarGoogle() {
    if (est.googleIniciado || !window.google || !google.accounts) return;
    est.googleIniciado = true;
    google.accounts.id.initialize({
      client_id: CFG.ID_CLIENTE,
      callback: recibirCredencial,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      itp_support: true,
      context: 'signin'
    });
    google.accounts.id.renderButton($('botonGoogle'), {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with',
      locale: 'es', width: 260
    });
    google.accounts.id.prompt();
    // Si en unos segundos no hubo inicio automatico, se muestra el boton.
    setTimeout(function () {
      if (!est.idToken && vistaActual() === 'vistaInicio') pantallaGoogle();
    }, 2500);
  }

  // Camino con Google (primera vez, llave vencida o anulada, otra cuenta).
  function iniciarFlujoGoogle(mensaje) {
    est.sesion = null;
    if (est.googleIniciado) {
      pantallaGoogle(mensaje);
      try { google.accounts.id.prompt(); } catch (e) { /* nada */ }
      return;
    }
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    if (mensaje) setTimeout(function () {
      if (!est.idToken && vistaActual() !== 'vistaPin') pantallaGoogle(mensaje);
    }, 2600);
    if (window.google && google.accounts) iniciarGoogle();
    else window.onGoogleLibraryLoad = iniciarGoogle;
    setTimeout(function () {
      if (!est.googleIniciado) {
        $('inicioMensaje').textContent = 'No se pudo conectar con Google. ' +
            'Revise su internet y vuelva a abrir la aplicación.';
      }
    }, 12000);
  }

  function pantallaGoogle(mensaje) {
    var aviso = $('googleMensaje');
    aviso.textContent = mensaje || '';
    aviso.classList.toggle('oculto', !mensaje);
    mostrar('vistaGoogle');
  }

  function recibirCredencial(resp) {
    var token = resp && resp.credential;
    if (!token) return;
    var datos = leerJwt(token);
    est.idToken = token;
    est.vence = Number(datos.exp || 0) * 1000;
    if (est.esperaToken) {
      var listo = est.esperaToken;
      est.esperaToken = null;
      listo(true);
      return;
    }
    consultarEstado();
  }

  function renovarIdentidad() {
    if (!window.google || !google.accounts) return Promise.resolve(false);
    return new Promise(function (resolver) {
      est.esperaToken = resolver;
      try { google.accounts.id.prompt(); } catch (e) { /* sin efecto */ }
      setTimeout(function () {
        if (est.esperaToken === resolver) {
          est.esperaToken = null;
          resolver(false);
        }
      }, 10000);
    });
  }

  function consultarEstado() {
    $('inicioMensaje').textContent = 'Verificando su cuenta...';
    mostrar('vistaInicio');
    llamar('estado').then(function (r) {
      if (r.ok) {
        est.pinCreado = !!r.pinCreado;
        abrirPin();
        return;
      }
      if (r.error === 'identidad') {
        est.idToken = null;
        try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
        pantallaGoogle('Esta cuenta de Google no tiene acceso. Elija la cuenta propietaria.');
        return;
      }
      manejarError(r, function (t) { pantallaGoogle(t); });
    });
  }

  /* ====================== PIN ====================== */

  function construirTeclado() {
    var puntos = $('puntos');
    for (var i = 0; i < LARGO_PIN; i++) puntos.appendChild(el('span'));
    var teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Borrar'];
    teclas.forEach(function (t) {
      var b = el('button', t === '' ? 'vacio' : (t === 'Borrar' ? 'borrar' : ''), t);
      b.type = 'button';
      if (t === 'Borrar') b.setAttribute('aria-label', 'Borrar');
      b.addEventListener('click', function () {
        if (t === 'Borrar') borrarDigito(); else if (t) agregarDigito(t);
      });
      $('teclado').appendChild(b);
    });
    document.addEventListener('keydown', function (ev) {
      if (vistaActual() !== 'vistaPin') return;
      if (/^\d$/.test(ev.key)) agregarDigito(ev.key);
      else if (ev.key === 'Backspace') borrarDigito();
    });
    $('btnOtraCuenta').addEventListener('click', function () {
      est.idToken = null;
      est.sesion = null;
      olvidarLlave();
      try { google.accounts.id.disableAutoSelect(); } catch (e) { /* nada */ }
      iniciarFlujoGoogle();
    });
  }

  function pintarPuntos() {
    var spans = $('puntos').children;
    for (var i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('lleno', i < est.pin.length);
    }
  }

  function textosPin() {
    if (est.pinCreado) {
      $('pinTitulo').textContent = 'Ingrese su PIN';
      $('pinTexto').textContent = 'Clave de acceso de 7 dígitos.';
    } else if (est.pinPrimero === null) {
      $('pinTitulo').textContent = 'Cree su PIN';
      $('pinTexto').textContent = 'Elija una clave de 7 dígitos. Se pedirá cada vez ' +
          'que abra la aplicación.';
    } else {
      $('pinTitulo').textContent = 'Repita su PIN';
      $('pinTexto').textContent = 'Escriba la misma clave para confirmarla.';
    }
  }

  function abrirPin(mensaje) {
    est.pin = '';
    est.pinPrimero = null;
    est.enviandoPin = false;
    textosPin();
    pintarPuntos();
    $('pinMensaje').textContent = mensaje || '';
    $('btnOtraCuenta').classList.remove('oculto');
    mostrar('vistaPin');
  }

  function errorPin(texto) {
    var p = $('puntos');
    p.classList.remove('error');
    void p.offsetWidth;
    p.classList.add('error');
    $('pinMensaje').textContent = texto;
    est.pin = '';
    pintarPuntos();
  }

  function agregarDigito(d) {
    if (est.enviandoPin || est.pin.length >= LARGO_PIN) return;
    est.pin += d;
    $('pinMensaje').textContent = '';
    pintarPuntos();
    if (est.pin.length === LARGO_PIN) setTimeout(completarPin, 120);
  }

  function borrarDigito() {
    if (est.enviandoPin) return;
    est.pin = est.pin.slice(0, -1);
    pintarPuntos();
  }

  function pinDebil(pin) {
    return /^(\d)\1+$/.test(pin) || '01234567890'.indexOf(pin) !== -1 ||
        '09876543210'.indexOf(pin) !== -1;
  }

  function completarPin() {
    var pin = est.pin;
    if (!est.pinCreado) {
      if (est.pinPrimero === null) {
        if (pinDebil(pin)) {
          errorPin('Ese PIN es demasiado fácil de adivinar. Elija otro.');
          return;
        }
        est.pinPrimero = pin;
        est.pin = '';
        textosPin();
        pintarPuntos();
        return;
      }
      if (pin !== est.pinPrimero) {
        est.pinPrimero = null;
        textosPin();
        errorPin('Los PIN no coinciden. Empiece de nuevo.');
        return;
      }
      enviarPin('crearPin', pin);
      return;
    }
    enviarPin('entrar', pin);
  }

  function enviarPin(accion, pin) {
    est.enviandoPin = true;
    $('pinMensaje').textContent = 'Verificando...';
    var conLlave = accion === 'entrar' && est.llave && !est.idToken;
    var peticion = conLlave
        ? api('entrarDispositivo', { pin: pin, llave: est.llave })
        : api(accion, { pin: pin, recordar: true });
    peticion.then(function (r) {
      est.enviandoPin = false;
      est.pin = '';
      if (r.ok && r.sesion) {
        if (r.llave) guardarLlave(r.llave);
        est.sesion = r.sesion;
        est.pinCreado = true;
        est.pinPrimero = null;
        $('pinMensaje').textContent = '';
        pintarPuntos();
        entrarALaApp();
        return;
      }
      if (r.error === 'pin') {
        errorPin('PIN incorrecto. ' + (r.restantes === 1 ? 'Le queda 1 intento.' :
            'Le quedan ' + r.restantes + ' intentos.'));
      } else if (r.error === 'bloqueado') {
        errorPin('Demasiados intentos. Espere ' + r.minutos +
            (r.minutos === 1 ? ' minuto.' : ' minutos.'));
      } else if (r.error === 'sinPin') {
        est.pinCreado = false;
        abrirPin('Todavía no hay un PIN. Cree uno.');
      } else if (r.error === 'pinExiste') {
        est.pinCreado = true;
        abrirPin('Ya existe un PIN. Ingréselo.');
      } else if (r.error === 'formatoPin') {
        errorPin('El PIN debe tener 7 dígitos.');
      } else if (r.error === 'llave') {
        olvidarLlave();
        iniciarFlujoGoogle('Por seguridad, vuelva a iniciar sesión con Google.');
      } else if (!manejarError(r, errorPin)) {
        /* mensaje ya mostrado */
      }
    });
  }

  function entrarALaApp() {
    if (est.vistaPrevia) {
      var v = est.vistaPrevia;
      est.vistaPrevia = null;
      mostrar(v);
      return;
    }
    mostrar('vistaBuscar');
    buscar('');
  }

  // Cierra la sesion y vuelve al PIN. No borra la identidad de Google.
  function bloquear(volverDespues) {
    if (est.sesion) llamar('salir');
    est.sesion = null;
    var v = vistaActual();
    est.vistaPrevia = volverDespues && (v === 'vistaBuscar' || v === 'vistaDetalle') ? v : null;
    if (!est.vistaPrevia) {
      $('resultados').innerHTML = '';
      $('detalleContenido').innerHTML = '';
      $('texto').value = '';
      archivoActual = null;
    }
    cerrarVisor();
    abrirPin();
  }

  /* ====================== BUSCAR ====================== */

  var resultados = $('resultados');
  var mensaje = $('mensaje');
  var contenido = $('detalleContenido');
  var archivoActual = null;
  var detalleActual = null;
  var ultimaConsulta = '';
  var listaDesactualizada = false;

  var NOMBRES_ESTADO = {
    'completada': 'Completada',
    'pendiente': 'Pendiente · no confirmado',
    'rechazada': '✕ Rechazada',
    'no determinada': 'Estado no determinado'
  };
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var NIVELES = { 'alta': 3, 'media': 2, 'baja': 1 };

  function chip(estado) {
    return el('span', 'chip ' + String(estado).replace(/\s/g, ''),
              NOMBRES_ESTADO[estado] || estado);
  }

  // "$6,550.00 MXN" -> ["$6,550.00", "MXN"];  "Bs 2.622,24" -> ["2.622,24", "BS"]
  function partirImporte(t) {
    if (/ MXN$/.test(t)) return [t.replace(/ MXN$/, ''), 'MXN'];
    if (/^Bs /.test(t)) return [t.replace(/^Bs /, ''), 'BS'];
    return [t, ''];
  }

  // "15/10/2026" -> {dia: "15", mes: 9, anio: "2026"}
  function partirFecha(f) {
    var m = String(f).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? { dia: m[1], mes: Number(m[2]) - 1, anio: m[3] } : null;
  }

  function buscar(consulta) {
    ultimaConsulta = consulta;
    listaDesactualizada = false;
    mensaje.textContent = 'Buscando...';
    resultados.innerHTML = '';
    api('buscar', { consulta: consulta }).then(function (r) {
      if (r.ok) {
        mostrarResultados(r.datos);
        return;
      }
      manejarError(r, function (t) { mensaje.textContent = t; });
    });
  }

  function mostrarResultados(r) {
    $('contador').textContent = 'Consulta privada · ' + r.totalIndice + ' registrados';
    if (!r.consulta) {
      mensaje.textContent = 'Los ' + r.resultados.length + ' más recientes. ' +
          'Escriba para buscar en todos.';
    } else if (r.total === 0) {
      mensaje.textContent = 'No se encontraron comprobantes para “' + r.consulta + '”.';
    } else if (r.total > r.resultados.length) {
      mensaje.textContent = 'Se encontraron ' + r.total + '. Se muestran los ' +
          r.resultados.length + ' más recientes; agregue otra palabra para precisar.';
    } else {
      mensaje.textContent = 'Se encontraron ' + r.total + '.';
    }
    var grupoActual = null;
    var lista = null;
    r.resultados.forEach(function (c) {
      var f = partirFecha(c.fecha);
      var grupo = f ? MESES[f.mes] + ' ' + f.anio : 'Sin fecha';
      if (grupo !== grupoActual) {
        grupoActual = grupo;
        resultados.appendChild(el('div', 'mes', grupo));
        lista = el('div', 'lista');
        resultados.appendChild(lista);
      }
      var fila = el('div', 'mov');
      fila.setAttribute('role', 'button');
      fila.tabIndex = 0;
      var dia = el('div', 'dia');
      dia.appendChild(el('b', '', f ? f.dia : '—'));
      dia.appendChild(el('span', '', f ? MESES[f.mes].slice(0, 3) : ''));
      fila.appendChild(dia);

      var centro = el('div');
      var quien = el('div', 'quien', c.beneficiario || 'Beneficiario no identificado');
      if (c.beneficiario) {
        quien.appendChild(document.createTextNode(' '));
        quien.appendChild(el('i', c.origenBeneficiario === 'asignado' ? 'propio' : '',
            c.origenBeneficiario === 'asignado' ? 'asignado por usted' : 'sugerido'));
      }
      centro.appendChild(quien);
      var chips = el('div', 'chips');
      chips.appendChild(chip(c.estado));
      if (c.duplicado) chips.appendChild(el('span', 'chip duplicado', 'Posible duplicado'));
      if (c.revisar) chips.appendChild(el('span', 'chip revisar', 'Revisar datos'));
      centro.appendChild(chips);
      fila.appendChild(centro);

      var imp = partirImporte(c.importe);
      var monto = el('div', 'monto');
      monto.appendChild(el('b', '', imp[0]));
      monto.appendChild(el('span', '', imp[1]));
      fila.appendChild(monto);

      fila.addEventListener('click', function () { abrir(c.id); });
      fila.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') abrir(c.id);
      });
      lista.appendChild(fila);
    });
  }

  /* ====================== COMPROBANTE ====================== */

  function abrir(id) {
    archivoActual = null;
    mostrar('vistaDetalle');
    history.pushState({ ac: 'detalle' }, '');
    contenido.innerHTML = '';
    contenido.appendChild(el('p', 'fecha cargando', 'Cargando el comprobante...'));
    api('comprobante', { id: id }).then(function (r) {
      if (r.ok) {
        mostrarDetalle(r.datos);
        return;
      }
      manejarError(r, function (t) {
        contenido.innerHTML = '';
        contenido.appendChild(el('div', 'alerta', 'No se pudo abrir el comprobante: ' + t));
      });
    });
  }

  function dato(ficha, nombre, valor, confianza) {
    if (!valor) return;
    var d = el('div', 'dato');
    d.appendChild(el('div', 'k', nombre));
    var v = el('div', 'v', valor);
    if (confianza) {
      var c = el('div', 'conf');
      var n = NIVELES[confianza] || 0;
      for (var i = 1; i <= 3; i++) c.appendChild(el('s', i <= n ? 'on' : ''));
      c.appendChild(document.createTextNode(' sugerido · ' + confianza));
      v.appendChild(c);
    }
    d.appendChild(v);
    ficha.appendChild(d);
  }

  function mostrarDetalle(d) {
    detalleActual = d;
    contenido.innerHTML = '';
    var imp = partirImporte(d.importe);
    var f = partirFecha(d.fecha);
    var res = el('div', 'resumen');
    res.appendChild(el('div', 'moneda', imp[1] === 'BS' ? 'Bolívares' :
                       (imp[1] === 'MXN' ? 'Pesos mexicanos' : '')));
    res.appendChild(el('div', 'importe', imp[0]));
    res.appendChild(el('div', 'fecha',
        (f ? Number(f.dia) + ' de ' + MESES[f.mes] + ' de ' + f.anio : d.fecha) +
        (d.hora ? ' · ' + d.hora : '') +
        (d.beneficiario ? ' · ' + d.beneficiario : '')));
    res.appendChild(chip(d.estado));
    contenido.appendChild(res);

    if (d.estado === 'pendiente') {
      contenido.appendChild(el('div', 'alerta',
          'Operación pendiente: este comprobante NO confirma que el pago se ' +
          'haya realizado.'));
    }
    if (d.duplicado) {
      contenido.appendChild(el('div', 'alerta', 'Posible duplicado de: ' + d.duplicadoDe));
    }

    if (d.archivo) {
      archivoActual = base64AArchivo(d.archivo);
      var hoja = el('div', 'hoja');
      var img = el('img');
      img.alt = 'Comprobante original';
      img.src = 'data:' + d.archivo.tipo + ';base64,' + d.archivo.base64;
      img.addEventListener('click', function () { abrirVisor(img.src); });
      hoja.appendChild(img);
      contenido.appendChild(hoja);
      contenido.appendChild(el('p', 'ampliar', 'Toque la imagen para ampliarla'));
    } else if (d.aviso) {
      contenido.appendChild(el('div', 'alerta', d.aviso));
    }
    contenido.appendChild(el('div', '', '')).id = 'resultadoCompartir';

    if (!d.beneficiario || d.origenBeneficiario === 'asignado') {
      contenido.appendChild(bloqueAsignar(d));
    }

    var ficha = el('div', 'ficha');
    if (d.origenBeneficiario === 'asignado') {
      dato(ficha, 'Beneficiario', d.beneficiario);
      ficha.lastChild.querySelector('.v').appendChild(el('div', 'conf', 'asignado por usted'));
    } else {
      dato(ficha, 'Beneficiario', d.beneficiario, d.confianzaBeneficiario);
    }
    dato(ficha, 'Banco origen', d.bancoOrigen, d.confianzaBancoOrigen);
    dato(ficha, 'Banco destino', d.bancoDestino);
    dato(ficha, 'Concepto', d.concepto, d.confianzaConcepto);
    dato(ficha, 'Referencia', d.referencia +
         (d.tipoReferencia ? ' (' + d.tipoReferencia + ')' : ''));
    dato(ficha, 'Cuenta destino', d.cuentaDestino);
    dato(ficha, 'Servicio', d.destinoServicio);
    dato(ficha, 'Revisión', d.revision);
    dato(ficha, 'Archivo', d.nombre);
    contenido.appendChild(ficha);

    if (d.textoOcr) {
      var det = el('details');
      det.appendChild(el('summary', '', 'Texto reconocido'));
      det.appendChild(el('pre', '', d.textoOcr));
      contenido.appendChild(det);
    }
    contenido.appendChild(el('div', 'espacio'));

    // Barra inferior fija: compartir (si hay imagen) y abrir en Drive.
    var acciones = el('div', 'acciones' + (d.archivo ? '' : ' sola'));
    if (d.archivo) {
      var btn = el('button', 'btn pri');
      btn.type = 'button';
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
          'stroke="#fff" stroke-width="2"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 ' +
          '0 0 1-1v-7"/><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/></svg>';
      btn.appendChild(document.createTextNode('Compartir por WhatsApp'));
      btn.addEventListener('click', compartir);
      acciones.appendChild(btn);
    }
    var drive = el('a', 'btn sec', d.archivo ? '' : 'Abrir en Drive');
    drive.href = d.enlace;
    drive.target = '_blank';
    drive.rel = 'noopener noreferrer';
    drive.setAttribute('aria-label', 'Abrir en Drive');
    if (d.archivo) {
      drive.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
          'stroke="#604A33" stroke-width="2"><path d="M14 3h7v7"/><path d="M10 14 ' +
          '21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 ' +
          '2-2h5"/></svg>';
    }
    acciones.appendChild(drive);
    contenido.appendChild(acciones);
  }

  // Asignar o cambiar el beneficiario. Solo se guarda el nombre en la hoja
  // "Beneficiarios"; el comprobante y sus datos automaticos no cambian.
  function bloqueAsignar(d) {
    var caja = el('div', 'asignar');
    var abrirBtn = el('button', d.beneficiario ? 'enlace' : 'btn sec ancho',
        d.beneficiario ? 'Cambiar beneficiario' : 'Asignar beneficiario');
    abrirBtn.type = 'button';
    var form = el('form', 'oculto');
    var etiqueta = el('label', 'k', 'Nombre del beneficiario');
    etiqueta.setAttribute('for', 'nombreBen');
    var entrada = el('input');
    entrada.id = 'nombreBen';
    entrada.type = 'text';
    entrada.maxLength = 80;
    entrada.autocomplete = 'off';
    entrada.setAttribute('autocapitalize', 'words');
    entrada.value = d.origenBeneficiario === 'asignado' ? d.beneficiario : '';
    form.appendChild(etiqueta);
    form.appendChild(entrada);
    if (d.recordarReceptor) {
      form.appendChild(el('p', 'nota', 'Se aplicará también a los demás pagos ' +
          'a este teléfono y cédula.'));
    }
    if (d.origenBeneficiario === 'asignado') {
      form.appendChild(el('p', 'nota', 'Deje el campo vacío y guarde para quitarlo.'));
    }
    var aviso = el('p', 'error');
    var botones = el('div', 'botones');
    var cancelar = el('button', 'btn sec', 'Cancelar');
    cancelar.type = 'button';
    var guardar = el('button', 'btn pri', 'Guardar');
    guardar.type = 'submit';
    botones.appendChild(cancelar);
    botones.appendChild(guardar);
    form.appendChild(aviso);
    form.appendChild(botones);
    caja.appendChild(abrirBtn);
    caja.appendChild(form);

    abrirBtn.addEventListener('click', function () {
      abrirBtn.classList.add('oculto');
      form.classList.remove('oculto');
      entrada.focus();
    });
    cancelar.addEventListener('click', function () {
      form.classList.add('oculto');
      abrirBtn.classList.remove('oculto');
      aviso.textContent = '';
      entrada.value = d.origenBeneficiario === 'asignado' ? d.beneficiario : '';
    });
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nombre = entrada.value.replace(/\s+/g, ' ').trim();
      if (!nombre && d.origenBeneficiario !== 'asignado') {
        aviso.textContent = 'Escriba el nombre.';
        return;
      }
      guardar.disabled = true;
      cancelar.disabled = true;
      aviso.textContent = 'Guardando...';
      api('asignarBeneficiario', { id: d.id, nombre: nombre }).then(function (r) {
        guardar.disabled = false;
        cancelar.disabled = false;
        if (r.ok) {
          var x = r.datos;
          d.beneficiario = x.beneficiario;
          d.origenBeneficiario = x.origenBeneficiario;
          d.confianzaBeneficiario = x.confianzaBeneficiario;
          d.revision = x.revision;
          d.revisar = x.revisar;
          listaDesactualizada = true;
          var y = window.scrollY;
          mostrarDetalle(d);
          window.scrollTo(0, y);
          return;
        }
        if (r.error === 'interno') {
          aviso.textContent = r.mensaje || 'No se pudo guardar.';
          return;
        }
        manejarError(r, function (t) { aviso.textContent = t; });
      });
    });
    return caja;
  }

  // Visor: imagen completa ampliable (100%, 200%, 300%). Solo muestra.
  var visorAbierto = null;

  function abrirVisor(src) {
    var nivel = 1;
    var visor = el('div', 'visor');
    var lienzo = el('div', 'lienzo');
    var img = el('img');
    img.src = src;
    img.alt = 'Comprobante original ampliado';
    lienzo.appendChild(img);
    var controles = el('div', 'controles');
    var menos = el('button', '', '−');
    var mas = el('button', '', '+');
    var cerrar = el('button', 'cerrar', 'Cerrar');
    menos.setAttribute('aria-label', 'Reducir');
    mas.setAttribute('aria-label', 'Ampliar');
    function aplicar() {
      img.style.width = (nivel * 100) + '%';
      img.style.maxWidth = 'none';
    }
    menos.addEventListener('click', function () { nivel = Math.max(1, nivel - 1); aplicar(); });
    mas.addEventListener('click', function () { nivel = Math.min(3, nivel + 1); aplicar(); });
    img.addEventListener('click', function () { nivel = nivel === 1 ? 2 : 1; aplicar(); });
    cerrar.addEventListener('click', function () { history.back(); });
    controles.appendChild(menos);
    controles.appendChild(mas);
    controles.appendChild(cerrar);
    visor.appendChild(lienzo);
    visor.appendChild(controles);
    document.body.appendChild(visor);
    visorAbierto = visor;
    history.pushState({ ac: 'visor' }, '');
  }

  function cerrarVisor() {
    if (visorAbierto && visorAbierto.parentNode) visorAbierto.parentNode.removeChild(visorAbierto);
    visorAbierto = null;
  }

  function base64AArchivo(a) {
    var binario = atob(a.base64);
    var bytes = new Uint8Array(binario.length);
    for (var i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new File([bytes], a.nombre, { type: a.tipo });
  }

  // Envia el archivo original (no un enlace ni una captura).
  function compartir() {
    var salida = $('resultadoCompartir');
    salida.className = '';
    salida.textContent = '';
    if (!archivoActual) return;
    if (!(navigator.canShare && navigator.canShare({ files: [archivoActual] }))) {
      salida.className = 'alerta';
      salida.textContent = 'Este navegador no permite compartir archivos. ' +
          'Use el botón de Drive y compártalo desde allí.';
      return;
    }
    navigator.share({ files: [archivoActual] }).catch(function (e) {
      if (e.name === 'AbortError') return;
      salida.className = 'alerta';
      salida.textContent = 'No se pudo compartir: ' + e.message;
    });
  }

  function cerrarDetalle() {
    mostrar('vistaBuscar');
    contenido.innerHTML = '';
    archivoActual = null;
    detalleActual = null;
    if (listaDesactualizada) buscar(ultimaConsulta);
  }

  /* ====================== NAVEGACION Y BLOQUEO ====================== */

  // El boton "atras" del telefono cierra el visor o vuelve a la busqueda.
  window.addEventListener('popstate', function () {
    if (visorAbierto) { cerrarVisor(); return; }
    if (vistaActual() === 'vistaDetalle') cerrarDetalle();
  });

  $('btnVolver').addEventListener('click', function () { history.back(); });
  $('btnBloquear').addEventListener('click', function () { bloquear(false); });

  $('formBuscar').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('texto').blur();
    buscar($('texto').value);
  });

  // Tras varios minutos en segundo plano se vuelve a pedir el PIN.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      est.ocultoDesde = Date.now();
      return;
    }
    var limite = (Number(CFG.MINUTOS_BLOQUEO) || 5) * 60000;
    if (est.sesion && est.ocultoDesde && Date.now() - est.ocultoDesde > limite) {
      bloquear(true);
    }
  });

  /* ====================== ARRANQUE ====================== */

  construirTeclado();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* opcional */ });
  }

  if (!configurada()) {
    $('inicioMensaje').textContent = 'La aplicación aún no está configurada ' +
        '(faltan la dirección del servicio y el ID de cliente).';
    return;
  }
  // Dispositivo recordado: directo al PIN, sin pasar por Google.
  est.llave = leerLlave();
  if (est.llave) {
    est.pinCreado = true;
    abrirPin();
  } else {
    iniciarFlujoGoogle();
  }
})();
