/**
 * Mis Finanzas 360 — servidor de respaldo en tu Google Drive (Google Apps Script).
 *
 * Este script solo guarda y entrega un archivo YA CIFRADO desde tu celular o laptop.
 * Nunca recibe tu clave, así que ni este script ni Google pueden leer tus datos.
 *
 * Pasos (detalle en el README):
 *   1. Pega este archivo en un proyecto nuevo de script.google.com.
 *   2. Ejecuta la función "configurar" una vez y autoriza el acceso a Drive.
 *      En el registro de ejecución aparece tu CÓDIGO DE ENLACE.
 *   3. Implementar → Nueva implementación → Aplicación web.
 *      Ejecutar como: Yo.  Quién tiene acceso: Cualquier usuario.
 *   4. Copia la URL que termina en /exec y pégala en la app junto con el código.
 */

const NOMBRE_CARPETA = 'Notas - respaldo';   // nombre discreto en tu Drive
const ARCHIVO_ACTUAL = 'actual.dat';
const CARPETA_HISTORIAL = 'historial';
const COPIAS_DIARIAS = 30;                    // cuántas copias diarias se conservan
const MAX_TAM = 20 * 1024 * 1024;             // 20 MB

// ---------------------------------------------------------------- Configuración inicial
function configurar() {
  const props = PropertiesService.getScriptProperties();
  let codigo = props.getProperty('CODIGO_ENLACE');
  if (!codigo) {
    codigo = generarCodigo_();
    props.setProperty('CODIGO_ENLACE', codigo);
  }
  carpeta_();
  Logger.log('Tu CÓDIGO DE ENLACE es: ' + codigo);
  Logger.log('Guárdalo: lo necesitas para conectar cada celular o computadora.');
  return codigo;
}

// Si crees que alguien conoce tu código, ejecuta esta función para generar uno nuevo.
// Los dispositivos ya conectados siguen funcionando.
function nuevoCodigoDeEnlace() {
  const codigo = generarCodigo_();
  PropertiesService.getScriptProperties().setProperty('CODIGO_ENLACE', codigo);
  Logger.log('Nuevo CÓDIGO DE ENLACE: ' + codigo);
  return codigo;
}

function generarCodigo_() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 12; i++) {
    c += letras.charAt(Math.floor(Math.random() * letras.length));
    if (i === 3 || i === 7) c += '-';
  }
  return c;
}

// ---------------------------------------------------------------- Entradas web
function doGet() {
  return ContentService.createTextOutput('Servicio activo.');
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse(e.postData.contents);
    res = atender_(req);
  } catch (err) {
    res = { ok: false, error: 'servidor', mensaje: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function atender_(req) {
  const props = PropertiesService.getScriptProperties();
  const accion = req.accion;

  if (accion === 'enlazar') {
    const codigo = props.getProperty('CODIGO_ENLACE');
    if (!codigo) return { ok: false, error: 'sin_configurar', mensaje: 'Ejecuta la función "configurar" en el script.' };
    if (String(req.codigo || '').trim().toUpperCase() !== codigo) {
      Utilities.sleep(1500);
      return { ok: false, error: 'codigo', mensaje: 'El código de enlace no es correcto.' };
    }
    const disp = dispositivos_();
    const key = Utilities.getUuid() + Utilities.getUuid();
    const id = Utilities.getUuid().slice(0, 8);
    disp[key] = { id: id, nombre: String(req.nombre || 'Dispositivo').slice(0, 40), alta: new Date().toISOString(), ultimo: new Date().toISOString(), estado: 'activo' };
    guardarDispositivos_(disp);
    return { ok: true, deviceKey: key, id: id };
  }

  // Todo lo demás requiere un dispositivo enlazado.
  const disp = dispositivos_();
  const yo = disp[req.deviceKey];
  if (!yo) return { ok: false, error: 'no_enlazado', mensaje: 'Este dispositivo no está enlazado.' };
  if (yo.estado === 'borrar') {
    delete disp[req.deviceKey];
    guardarDispositivos_(disp);
    return { ok: false, error: 'borrar', mensaje: 'Este dispositivo fue desconectado desde otro.' };
  }
  yo.ultimo = new Date().toISOString();
  guardarDispositivos_(disp);

  if (accion === 'estado') {
    const lista = Object.keys(disp).filter(function (k) { return disp[k].estado === 'activo'; }).map(function (k) {
      return { id: disp[k].id, nombre: disp[k].nombre, alta: disp[k].alta, ultimo: disp[k].ultimo, yo: k === req.deviceKey };
    });
    return { ok: true, version: props.getProperty('VERSION') || '', modificado: props.getProperty('MODIFICADO') || '', dispositivos: lista };
  }

  if (accion === 'bajar') {
    const f = archivo_(carpeta_(), ARCHIVO_ACTUAL);
    return { ok: true, version: props.getProperty('VERSION') || '', contenido: f ? f.getBlob().getDataAsString() : '' };
  }

  if (accion === 'subir') {
    const contenido = String(req.contenido || '');
    if (!contenido || contenido.length > MAX_TAM) return { ok: false, error: 'tam', mensaje: 'Archivo vacío o demasiado grande.' };
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const actual = props.getProperty('VERSION') || '';
      if ((req.baseVersion || '') !== actual) return { ok: false, error: 'conflicto', version: actual, mensaje: 'Hay una versión más nueva.' };
      const c = carpeta_();
      const f = archivo_(c, ARCHIVO_ACTUAL);
      if (f) f.setContent(contenido); else c.createFile(ARCHIVO_ACTUAL, contenido, 'application/octet-stream');
      copiaDiaria_(c, contenido);
      const version = new Date().toISOString() + '-' + Utilities.getUuid().slice(0, 6);
      props.setProperty('VERSION', version);
      props.setProperty('MODIFICADO', new Date().toISOString());
      return { ok: true, version: version };
    } finally {
      lock.releaseLock();
    }
  }

  if (accion === 'historial') {
    const h = subcarpeta_(carpeta_(), CARPETA_HISTORIAL);
    const it = h.getFiles();
    const lista = [];
    while (it.hasNext()) { const f = it.next(); lista.push({ id: f.getId(), nombre: f.getName(), tam: f.getSize() }); }
    lista.sort(function (a, b) { return a.nombre < b.nombre ? 1 : -1; });
    return { ok: true, copias: lista };
  }

  if (accion === 'bajar_copia') {
    const h = subcarpeta_(carpeta_(), CARPETA_HISTORIAL);
    const it = h.getFiles();
    while (it.hasNext()) { const f = it.next(); if (f.getId() === req.id) return { ok: true, contenido: f.getBlob().getDataAsString() }; }
    return { ok: false, error: 'no_existe', mensaje: 'Esa copia ya no existe.' };
  }

  if (accion === 'desconectar') {
    // Desconecta otro dispositivo; la próxima vez que se conecte borrará sus datos locales.
    const k = Object.keys(disp).filter(function (x) { return disp[x].id === req.id; })[0];
    if (!k) return { ok: false, error: 'no_existe', mensaje: 'Ese dispositivo ya no está enlazado.' };
    if (k === req.deviceKey) delete disp[k]; else disp[k].estado = 'borrar';
    guardarDispositivos_(disp);
    return { ok: true };
  }

  if (accion === 'salir') {
    delete disp[req.deviceKey];
    guardarDispositivos_(disp);
    return { ok: true };
  }

  return { ok: false, error: 'accion', mensaje: 'Acción desconocida.' };
}

// ---------------------------------------------------------------- Ayudas
function dispositivos_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('DISPOSITIVOS') || '{}');
}
function guardarDispositivos_(d) {
  PropertiesService.getScriptProperties().setProperty('DISPOSITIVOS', JSON.stringify(d));
}
function carpeta_() {
  const it = DriveApp.getFoldersByName(NOMBRE_CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(NOMBRE_CARPETA);
}
function subcarpeta_(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}
function archivo_(carpeta, nombre) {
  const it = carpeta.getFilesByName(nombre);
  return it.hasNext() ? it.next() : null;
}
function copiaDiaria_(carpeta, contenido) {
  const h = subcarpeta_(carpeta, CARPETA_HISTORIAL);
  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const nombre = 'copia-' + hoy + '.dat';
  const f = archivo_(h, nombre);
  if (f) f.setContent(contenido); else h.createFile(nombre, contenido, 'application/octet-stream');
  const it = h.getFiles();
  const todas = [];
  while (it.hasNext()) todas.push(it.next());
  todas.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  for (let i = COPIAS_DIARIAS; i < todas.length; i++) todas[i].setTrashed(true);
}
