// Sincronización cifrada con tu Google Drive a través de tu propio Apps Script.
// Los datos se cifran aquí (AES-GCM 256) con una clave derivada de tu frase secreta.
// La frase nunca sale del dispositivo; en Drive solo queda un archivo ilegible.
import { db } from './db.js';

const ITER = 310000;
const ID = 'sync';
let cfg = null;          // { id, url, deviceKey, dispId, nombre, key (CryptoKey), salt, iter, version, ultima, pendiente }
let enCurso = null;
let timer = null;
let reloj = null;
let contador = 0;   // cambios locales; si cambian durante una sincronización, se vuelve a subir
let estadoActual = { error: '', sinRed: false };
const oyentes = [];

export function onEstado(f) { oyentes.push(f); }
function avisarEstado() { for (const f of oyentes) { try { f(estado()); } catch (e) { /* nada */ } } }

export function estado() {
  return {
    configurado: !!(cfg && cfg.deviceKey && cfg.key),
    enlazado: !!(cfg && cfg.deviceKey),
    url: cfg ? cfg.url : '', nombre: cfg ? cfg.nombre : '',
    ultima: cfg ? cfg.ultima : '', pendiente: cfg ? !!cfg.pendiente : false,
    sincronizando: !!enCurso, error: estadoActual.error, sinRed: estadoActual.sinRed
  };
}

async function guardarCfg(cambios) {
  cfg = { ...(cfg || { id: ID }), ...cambios, id: ID };
  await db.putRaw('meta', cfg);
  avisarEstado();
}

// ---------------------------------------------------------------- Cifrado
const b64 = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const deb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function derivarClave(frase, saltB64, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: deb64(saltB64), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function cifrar(obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cfg.key, datos);
  return JSON.stringify({ app: 'mf360', v: 1, kdf: 'PBKDF2-SHA256', iter: cfg.iter, salt: cfg.salt, iv: b64(iv), ct: b64(ct) });
}

async function descifrarCon(key, sobre) {
  const s = typeof sobre === 'string' ? JSON.parse(sobre) : sobre;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deb64(s.iv) }, key, deb64(s.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---------------------------------------------------------------- Comunicación
async function api(accion, datos = {}, url = cfg && cfg.url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, deviceKey: cfg && cfg.deviceKey, ...datos })
    });
  } catch (e) {
    const err = new Error('Sin conexión con Google. Se intentará de nuevo.'); err.sinRed = true; throw err;
  }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('La dirección del script no respondió como se esperaba. Revisa que sea la URL que termina en /exec y que el acceso sea "Cualquier usuario".'); }
  if (!j.ok) {
    if (j.error === 'borrar' || j.error === 'no_enlazado') { await borradoRemoto(j.error); }
    const err = new Error(j.mensaje || j.error); err.codigo = j.error; err.datos = j; throw err;
  }
  return j;
}

let alBorrar = null;
export function onBorradoRemoto(f) { alBorrar = f; }
async function borradoRemoto(motivo) {
  if (motivo === 'borrar') {
    await db.borrarTodo();
    try { localStorage.clear(); } catch (e) { /* nada */ }
    if (alBorrar) alBorrar('borrar');
  } else {
    await guardarCfg({ deviceKey: '', key: null, version: '' });
    if (alBorrar) alBorrar('no_enlazado');
  }
}

// ---------------------------------------------------------------- Fusión
// Combina dos fotos de la base: en cada registro gana el cambio más reciente;
// un borrado gana si es igual o más nuevo que el registro.
export function fusionar(a, b) {
  const tomb = new Map();
  for (const t of [...(a.borrados || []), ...(b.borrados || [])]) {
    const prev = tomb.get(t.id);
    if (!prev || prev.actualizado < t.actualizado) tomb.set(t.id, t);
  }
  const out = {};
  for (const s of ['cuentas', 'personas', 'movimientos', 'recordatorios', 'meta']) {
    const m = new Map();
    for (const r of [...(a[s] || []), ...(b[s] || [])]) {
      const prev = m.get(r.id);
      if (!prev || (prev.actualizado || '') < (r.actualizado || '')) m.set(r.id, r);
    }
    out[s] = [...m.values()].filter((r) => {
      const t = tomb.get(s + '|' + r.id);
      return !t || t.actualizado < (r.actualizado || '');
    });
  }
  const limite = new Date(Date.now() - 400 * 86400000).toISOString();
  out.borrados = [...tomb.values()].filter((t) => t.actualizado > limite);
  return out;
}

function firma(snap) {
  const partes = [];
  for (const s of ['cuentas', 'personas', 'movimientos', 'recordatorios', 'meta', 'borrados']) {
    for (const r of [...(snap[s] || [])].sort((x, y) => (x.id < y.id ? -1 : 1))) partes.push(s + ':' + r.id + ':' + (r.actualizado || ''));
  }
  return partes.join('|');
}

// ---------------------------------------------------------------- Ciclo
let alCambioRemoto = null;
export function onCambioRemoto(f) { alCambioRemoto = f; }

export async function sincronizar() {
  if (!estado().configurado) return false;
  if (enCurso) return enCurso;
  const inicio = contador;
  enCurso = (async () => {
    avisarEstado();
    try {
      for (let intento = 0; intento < 3; intento++) {
        const est = await api('estado');
        let remoto = null;
        if (est.version && est.version !== cfg.version) {
          const r = await api('bajar');
          if (r.contenido) remoto = await descifrarCon(cfg.key, r.contenido);
        }
        const local = await db.snapshot();
        const unido = remoto ? fusionar(local, remoto) : local;
        let cambioLocal = false;
        if (remoto && firma(unido) !== firma(local)) { await db.aplicar(unido); cambioLocal = true; }
        const subir = !est.version || cfg.pendiente || (remoto && firma(unido) !== firma(remoto));
        let version = remoto ? est.version : cfg.version;
        if (subir) {
          try {
            const r = await api('subir', { contenido: await cifrar(unido), baseVersion: est.version || '' });
            version = r.version;
          } catch (e) {
            if (e.codigo === 'conflicto') { if (cambioLocal && alCambioRemoto) await alCambioRemoto(); continue; }
            throw e;
          }
        }
        const otraVez = contador !== inicio;
        await guardarCfg({ version, ultima: new Date().toISOString(), pendiente: otraVez });
        if (otraVez) programar(1500);
        estadoActual = { error: '', sinRed: false };
        if (cambioLocal && alCambioRemoto) await alCambioRemoto();
        return true;
      }
      throw new Error('No se pudo sincronizar por cambios simultáneos. Se intentará de nuevo.');
    } catch (e) {
      estadoActual = { error: e.message, sinRed: !!e.sinRed };
      return false;
    } finally {
      enCurso = null;
      avisarEstado();
    }
  })();
  return enCurso;
}

function programar(ms = 4000) {
  clearTimeout(timer);
  timer = setTimeout(() => { sincronizar(); }, ms);
}

export async function iniciar() {
  cfg = (await db.get('meta', ID)) || null;
  db.onCambio(async () => {
    contador++;
    if (!cfg || !cfg.deviceKey) return;
    if (!cfg.pendiente) await guardarCfg({ pendiente: true });
    programar();
  });
  window.addEventListener('online', () => programar(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') programar(800); });
  clearInterval(reloj);
  reloj = setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 5 * 60000);
  if (estado().configurado) programar(300);
}

// ---------------------------------------------------------------- Conectar un dispositivo
export async function enlazar(url, codigo, nombre) {
  url = String(url || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) throw new Error('Pega la URL de la aplicación web: empieza con https://script.google.com/macros/s/ y termina en /exec.');
  cfg = { id: ID, url };
  const r = await api('enlazar', { codigo, nombre }, url);
  await guardarCfg({ url, deviceKey: r.deviceKey, dispId: r.id, nombre, version: '', pendiente: false, key: null });
  const est = await api('estado');
  let salt = '', iter = ITER;
  if (est.version) {
    const b = await api('bajar');
    if (b.contenido) { const s = JSON.parse(b.contenido); salt = s.salt; iter = s.iter; }
  }
  return { hayDatos: !!est.version, salt, iter };
}

// Primer dispositivo: crea la clave y sube lo que haya en este dispositivo.
export async function crearClave(frase) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await derivarClave(frase, salt, ITER);
  await guardarCfg({ key, salt, iter: ITER, pendiente: true, version: '' });
  return sincronizar();
}

// Otro dispositivo: verifica la clave descifrando lo que hay en Drive y lo combina con lo local.
export async function usarClave(frase, salt, iter) {
  const key = await derivarClave(frase, salt, iter);
  const b = await api('bajar');
  try { await descifrarCon(key, b.contenido); } catch (e) { throw new Error('Esa clave no abre los datos de tu Drive. Revisa mayúsculas, espacios y acentos.'); }
  await quitarCajaDuplicada(await descifrarCon(key, b.contenido));
  await guardarCfg({ key, salt, iter, version: '', pendiente: true });
  return sincronizar();
}

// Cada instalación crea su propia "Efectivo / Caja". Al unir un dispositivo nuevo,
// se quita la caja local si está vacía y en Drive ya hay una.
async function quitarCajaDuplicada(remoto) {
  const cajasRemotas = (remoto.cuentas || []).filter((c) => c.tipo === 'efectivo');
  if (!cajasRemotas.length) return;
  const idsRemotos = new Set((remoto.cuentas || []).map((c) => c.id));
  const movs = await db.all('movimientos');
  for (const c of await db.all('cuentas')) {
    if (c.tipo !== 'efectivo' || idsRemotos.has(c.id) || Number(c.saldoInicial)) continue;
    if (movs.some((m) => m.origenId === c.id || m.destinoId === c.id)) continue;
    await db.del('cuentas', c.id);
  }
}

export async function verificarClave(frase) {
  if (!cfg || !cfg.salt) return false;
  const k = await derivarClave(frase, cfg.salt, cfg.iter);
  try { const b = await api('bajar'); await descifrarCon(k, b.contenido); return true; } catch (e) { return false; }
}

// Qué hay en Drive (para pedir la clave correcta en un dispositivo recién enlazado).
export async function infoRemota() {
  const est = await api('estado');
  if (!est.version) return { hayDatos: false };
  const b = await api('bajar');
  const sobre = JSON.parse(b.contenido);
  return { hayDatos: true, salt: sobre.salt, iter: sobre.iter };
}

export const dispositivos = async () => (await api('estado')).dispositivos;
export const copias = async () => (await api('historial')).copias;
export const desconectar = (id) => api('desconectar', { id });

// Reemplaza todo por una copia diaria de Drive (y la vuelve la versión actual).
export async function restaurarCopia(id) {
  const r = await api('bajar_copia', { id });
  const datos = await descifrarCon(cfg.key, r.contenido);
  const ahora = new Date().toISOString();
  const actual = await db.snapshot();
  const borrados = [];
  for (const s of ['cuentas', 'personas', 'movimientos', 'recordatorios', 'meta']) {
    const vienen = new Set((datos[s] || []).map((x) => x.id));
    for (const x of actual[s]) if (!vienen.has(x.id)) borrados.push({ id: s + '|' + x.id, store: s, recId: x.id, actualizado: ahora });
    datos[s] = (datos[s] || []).map((x) => ({ ...x, actualizado: ahora }));
  }
  datos.borrados = borrados;
  await db.aplicar(datos);
  await guardarCfg({ pendiente: true });
  await sincronizar();
}

export async function salir() {
  try { await api('salir'); } catch (e) { /* sin conexión: se desconecta localmente */ }
  await guardarCfg({ deviceKey: '', key: null, version: '', pendiente: false, ultima: '' });
}
