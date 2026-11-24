// Seguridad: PIN, huella / Face ID / Windows Hello, calculadora camuflada y segundo candado.
// Nota: este bloqueo protege la app al abrirla. El cifrado completo de los datos llega con la
// sincronización (fase 4), que usa una clave larga y no un PIN de pocos dígitos.
import { db } from './db.js';
import { esc } from './ui.js';

const ID = 'seguridad';
const ITER = 150000;

export const SEG_DEFAULT = {
  id: ID, pinHash: '', pinSalt: '', pin2Hash: '', pin2Salt: '',
  pinLen: 0, pin2Len: 0, bioId: '', bloqueoMin: 0, camuflaje: false, codigoHash: '', codigoSalt: '',
  nombre: 'finanzas', candados: {}, ocultarMontosAvisos: true,
  fallos: 0, esperaHasta: 0
};

export let seg = { ...SEG_DEFAULT };

export async function cargarSeg() {
  const s = await db.get('meta', ID);
  seg = { ...SEG_DEFAULT, ...(s || {}) };
  try { localStorage.setItem('mf360-nombre', seg.nombre); } catch (e) { /* sin almacenamiento */ }
  return seg;
}

export async function guardarSeg(cambios) {
  seg = { ...seg, ...cambios };
  await db.put('meta', seg);
  try { localStorage.setItem('mf360-nombre', seg.nombre); } catch (e) { /* sin almacenamiento */ }
  return seg;
}

// ---------------------------------------------------------------- Hash
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashSecreto(secreto, saltB64) {
  const salt = saltB64 ? deb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

async function coincide(secreto, hash, salt) {
  if (!hash) return false;
  const r = await hashSecreto(secreto, salt);
  return r.hash === hash;
}

export async function definirPin(pin) { const r = await hashSecreto(pin); await guardarSeg({ pinHash: r.hash, pinSalt: r.salt, pinLen: pin.length, fallos: 0, esperaHasta: 0 }); }
export async function definirPin2(pin) { const r = await hashSecreto(pin); await guardarSeg({ pin2Hash: r.hash, pin2Salt: r.salt, pin2Len: pin.length }); }
export async function definirCodigo(codigo) { const r = await hashSecreto('calc:' + codigo); await guardarSeg({ codigoHash: r.hash, codigoSalt: r.salt }); }
export const verificarPin = (pin) => coincide(pin, seg.pinHash, seg.pinSalt);
export const verificarPin2 = (pin) => (seg.pin2Hash ? coincide(pin, seg.pin2Hash, seg.pin2Salt) : verificarPin(pin));
export const verificarCodigo = (codigo) => coincide('calc:' + codigo, seg.codigoHash, seg.codigoSalt);
export const tienePin = () => !!seg.pinHash;

// ---------------------------------------------------------------- Huella / Face ID / Windows Hello
export async function biometriaDisponible() {
  try {
    return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}

export async function activarBiometria() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Mis Finanzas 360' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'usuario', displayName: 'Usuario' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000, attestation: 'none'
    }
  });
  await guardarSeg({ bioId: b64(cred.rawId) });
}

export async function usarBiometria() {
  if (!seg.bioId) return false;
  try {
    const r = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: deb64(seg.bioId), transports: ['internal'] }],
        userVerification: 'required', timeout: 60000
      }
    });
    return !!(r && r.response && new Uint8Array(r.response.authenticatorData)[32] & 0x04);
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- Intentos fallidos
function segundosEspera() { return Math.max(0, Math.ceil((seg.esperaHasta - Date.now()) / 1000)); }
async function registrarFallo() {
  const fallos = seg.fallos + 1;
  const espera = fallos >= 5 ? Math.min(300, 30 * 2 ** (fallos - 5)) * 1000 : 0;
  await guardarSeg({ fallos, esperaHasta: espera ? Date.now() + espera : 0 });
}

// ---------------------------------------------------------------- Teclado de PIN (pantalla o ventana)
function tecladoHtml({ titulo, sub, bio, cancelar, olvide, listo }) {
  const tecla = (d) => `<button type="button" class="pin-tecla" data-pin="${d}">${d}</button>`;
  return `
  <div class="pin-caja">
    ${seg.nombre === 'notas' || seg.nombre === 'calculadora' ? `<img src="icons/${seg.nombre === 'notas' ? 'notas' : 'calc'}-192.png" alt="" width="48" height="48" style="border-radius:12px">` : '<div class="pin-logo">M</div>'}
    <h1 class="pin-tit">${esc(titulo)}</h1>
    <p class="pin-sub" id="pin-sub">${esc(sub || '')}</p>
    <div class="pin-puntos" id="pin-puntos" role="img" aria-label="0 dígitos"></div>
    <div class="pin-teclado">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tecla).join('')}
      ${bio ? `<button type="button" class="pin-tecla pin-icono" data-pin="bio" aria-label="Usar huella, Face ID o Windows Hello">${huella()}</button>` : '<span></span>'}
      ${tecla(0)}
      <button type="button" class="pin-tecla pin-icono" data-pin="borrar" aria-label="Borrar"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11v12H9l-5-6z"/><line x1="12" y1="10" x2="16" y2="14"/><line x1="16" y1="10" x2="12" y2="14"/></svg></button>
    </div>
    <div class="pin-pie">
      ${cancelar ? '<button type="button" class="pin-link" data-pin="cancelar">Cancelar</button>' : ''}
      ${listo ? '<button type="button" class="pin-link fuerte" data-pin="listo">Continuar</button>' : ''}
      ${olvide ? '<button type="button" class="pin-link" data-pin="olvide">Olvidé mi PIN</button>' : ''}
    </div>
  </div>`;
}

function huella() {
  return '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 11v3a6 6 0 0 1-1 3.5"/><path d="M8.5 9.5A4 4 0 0 1 16 11v2.5"/><path d="M6 8a7 7 0 0 1 12 3v2"/><path d="M9 12v1.5a8 8 0 0 1-1.5 4.5"/><path d="M15.5 16a10 10 0 0 1-1 3"/></svg>';
}

// Muestra el teclado y resuelve con el PIN tecleado ya verificado (true) o false si se cancela.
// opciones.verificar(pin) -> Promise<boolean>; opciones.largo: dígitos esperados (4-6) o 0 para "Enter".
function teclado(opciones) {
  return new Promise((resolve) => {
    const capa = document.createElement('div');
    capa.className = 'pin-capa';
    capa.setAttribute('role', 'dialog');
    capa.setAttribute('aria-modal', 'true');
    capa.innerHTML = tecladoHtml(opciones);
    document.body.appendChild(capa);
    let pin = '';
    let ocupado = false;
    const puntos = capa.querySelector('#pin-puntos');
    const sub = capa.querySelector('#pin-sub');
    const largoMax = 6;
    const pintar = () => {
      const n = Math.max(opciones.largo || 4, pin.length);
      puntos.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
      puntos.setAttribute('aria-label', pin.length + ' dígitos');
    };
    const cerrar = (v) => { document.removeEventListener('keydown', onKey, true); capa.remove(); resolve(v); };
    const error = (msg) => { sub.textContent = msg; sub.classList.add('err'); capa.querySelector('.pin-caja').classList.add('sacude'); setTimeout(() => capa.querySelector('.pin-caja') && capa.querySelector('.pin-caja').classList.remove('sacude'), 400); };
    const intentar = async () => {
      if (ocupado || !pin) return;
      if (opciones.conEspera && segundosEspera() > 0) { error(`Demasiados intentos. Espera ${segundosEspera()} s.`); pin = ''; pintar(); return; }
      ocupado = true;
      const ok = await opciones.verificar(pin);
      ocupado = false;
      if (ok) { if (opciones.conEspera) await guardarSeg({ fallos: 0, esperaHasta: 0 }); cerrar(opciones.devolverPin ? pin : true); return; }
      if (opciones.conEspera) await registrarFallo();
      pin = ''; pintar();
      error(opciones.mensajeError || (segundosEspera() > 0 ? `PIN incorrecto. Espera ${segundosEspera()} s.` : 'PIN incorrecto'));
    };
    const tecla = async (k) => {
      if (k === 'cancelar') { cerrar(false); return; }
      if (k === 'olvide') { cerrar('olvide'); return; }
      if (k === 'listo') { if (pin.length < 4) error('Usa al menos 4 dígitos'); else intentar(); return; }
      if (k === 'bio') { const ok = await usarBiometria(); if (ok) { await guardarSeg({ fallos: 0, esperaHasta: 0 }); cerrar(true); } else error('No se pudo verificar. Usa tu PIN.'); return; }
      if (k === 'borrar') { pin = pin.slice(0, -1); pintar(); return; }
      if (pin.length >= largoMax) return;
      pin += k; sub.classList.remove('err'); sub.textContent = opciones.sub || '';
      pintar();
      if (opciones.largo && pin.length === opciones.largo) intentar();
      else if (!opciones.largo && !opciones.listo && pin.length >= 4) { clearTimeout(capa._t); capa._t = setTimeout(intentar, 650); }
    };
    function onKey(e) {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); tecla(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); tecla('borrar'); }
      else if (e.key === 'Enter') { e.preventDefault(); intentar(); }
      else if (e.key === 'Escape' && opciones.cancelar) { e.preventDefault(); cerrar(false); }
    }
    capa.addEventListener('click', (e) => { const b = e.target.closest('[data-pin]'); if (b) tecla(b.dataset.pin); });
    document.addEventListener('keydown', onKey, true);
    pintar();
    const f = capa.querySelector('.pin-tecla'); if (f && window.matchMedia('(min-width: 900px)').matches) f.focus();
  });
}

// Pantalla de bloqueo principal. Devuelve true al desbloquear o 'olvide'.
export function pantallaBloqueo() {
  return teclado({ titulo: 'Ingresa tu PIN', sub: '', bio: !!seg.bioId, olvide: true, conEspera: true, largo: seg.pinLen || 0, verificar: verificarPin });
}

// PIN del segundo candado (o el principal si no hay uno aparte).
export function pedirPinSeccion(nombre) {
  return teclado({ titulo: 'Sección protegida', sub: nombre, bio: !!seg.bioId && !seg.pin2Hash, cancelar: true, conEspera: true, largo: (seg.pin2Hash ? seg.pin2Len : seg.pinLen) || 0, verificar: verificarPin2 });
}

export function pedirPinActual(titulo = 'Confirma tu PIN') {
  return teclado({ titulo, sub: '', bio: !!seg.bioId, cancelar: true, conEspera: true, largo: seg.pinLen || 0, verificar: verificarPin });
}

// Pide un PIN nuevo dos veces. Devuelve el PIN o false.
export async function capturarPinNuevo(titulo = 'Elige un PIN') {
  const uno = await teclado({ titulo, sub: 'De 4 a 6 dígitos', cancelar: true, listo: true, largo: 0, devolverPin: true, verificar: async (p) => p.length >= 4 });
  if (!uno) return false;
  const dos = await teclado({ titulo: 'Confírmalo', sub: 'Escríbelo otra vez', cancelar: true, largo: uno.length, devolverPin: true, mensajeError: 'No coincide. Intenta de nuevo.', verificar: async (p) => p === uno });
  return dos || false;
}

// ---------------------------------------------------------------- Calculadora camuflada
// Calculadora funcional. Al teclear el código y "=", resuelve.
export function pantallaCalculadora() {
  return new Promise((resolve) => {
    const capa = document.createElement('div');
    capa.className = 'calc';
    const teclas = ['C', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='];
    const nombres = { 'C': 'Borrar', '±': 'Cambiar signo', '%': 'Porcentaje', '÷': 'Dividir', '×': 'Multiplicar', '−': 'Restar', '+': 'Sumar', '=': 'Igual', '.': 'Punto decimal' };
    capa.innerHTML = `
      <div class="calc-caja">
        <div class="calc-pantalla"><div class="calc-expr" id="calc-expr"></div><output class="calc-disp" id="calc-disp" aria-live="polite">0</output></div>
        <div class="calc-teclas">${teclas.map((k) => `<button type="button" data-k="${k}" aria-label="${nombres[k] || k}" class="${'÷×−+='.includes(k) ? 'op' : 'C±%'.includes(k) ? 'fn' : ''} ${k === '0' ? 'cero' : ''}">${k}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(capa);
    const disp = capa.querySelector('#calc-disp'), expr = capa.querySelector('#calc-expr');
    let st = { disp: '0', acc: null, op: null, fresh: true, tecleado: '' };
    const fmt = (n) => { const s = String(Math.round(n * 1e8) / 1e8); return s.length > 12 ? Number(n).toExponential(5) : s; };
    const calc = (a, b, op) => (op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : op === '÷' ? (b === 0 ? 0 : a / b) : b);
    const pinta = () => { disp.textContent = st.disp; expr.textContent = st.op ? fmt(st.acc) + ' ' + st.op : ''; };
    const press = async (k) => {
      if (/^[0-9]$/.test(k)) { st.disp = st.fresh || st.disp === '0' ? k : (st.disp.length < 12 ? st.disp + k : st.disp); st.fresh = false; st.tecleado += k; }
      else if (k === '.') { if (st.fresh) { st.disp = '0.'; st.fresh = false; } else if (!st.disp.includes('.')) st.disp += '.'; st.tecleado = ''; }
      else if (k === 'C') st = { disp: '0', acc: null, op: null, fresh: true, tecleado: '' };
      else if (k === '±') { st.disp = fmt(-parseFloat(st.disp)); st.tecleado = ''; }
      else if (k === '%') { st.disp = fmt(parseFloat(st.disp) / 100); st.tecleado = ''; }
      else if (k === '=') {
        if (st.op === null && st.tecleado && await verificarCodigo(st.tecleado)) { cerrar(); return; }
        if (st.op !== null) { st.disp = fmt(calc(st.acc, parseFloat(st.disp), st.op)); st.acc = null; st.op = null; st.fresh = true; }
        st.tecleado = '';
      } else {
        const cur = parseFloat(st.disp);
        st.acc = st.op !== null && !st.fresh ? calc(st.acc, cur, st.op) : cur;
        st.op = k; st.fresh = true; st.disp = fmt(st.acc); st.tecleado = '';
      }
      pinta();
    };
    const mapa = { '/': '÷', '*': '×', '-': '−', '+': '+', 'Enter': '=', '=': '=', 'Escape': 'C', '.': '.', ',': '.', '%': '%' };
    function onKey(e) {
      const k = /^[0-9]$/.test(e.key) ? e.key : mapa[e.key];
      if (k) { e.preventDefault(); press(k); }
      else if (e.key === 'Backspace') { e.preventDefault(); if (!st.fresh && st.disp.length > 1) { st.disp = st.disp.slice(0, -1); st.tecleado = st.tecleado.slice(0, -1); } else { st.disp = '0'; st.fresh = true; st.tecleado = ''; } pinta(); }
    }
    function cerrar() { document.removeEventListener('keydown', onKey, true); capa.remove(); resolve(true); }
    capa.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
    document.addEventListener('keydown', onKey, true);
  });
}
