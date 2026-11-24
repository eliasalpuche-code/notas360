// Utilidades de interfaz: formato, escape, iconos, hojas y avisos.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function money(n, { signo = false } = {}) {
  const v = Number(n) || 0;
  const s = fmtMXN.format(Math.abs(v));
  if (v < 0) return '−' + s;
  if (signo && v > 0) return '+' + s;
  return s;
}

export function parseImporte(txt) {
  const n = parseFloat(String(txt ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function hoy() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function partes(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return { y, m, d };
}

export function fechaCorta(iso) {
  const { m, d } = partes(iso);
  return m ? d + ' ' + MESES[m - 1] : '';
}

export function fechaLarga(iso) {
  const { y, m, d } = partes(iso);
  return m ? d + ' ' + MESES[m - 1] + ' ' + y : '';
}

export function mesNombre(iso) {
  const { y, m } = partes(iso);
  return m ? MESES_LARGOS[m - 1] + ' ' + y : '';
}

export function diasHasta(iso) {
  const a = new Date(hoy() + 'T00:00:00'), b = new Date(iso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function hoyLargo() {
  const d = new Date();
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
}

const ICONOS = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  movs: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/>',
  mas: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  personas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>',
  atras: '<polyline points="15 6 9 12 15 18"/>',
  sig: '<polyline points="9 6 15 12 9 18"/>',
  alerta: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.6"/>',
  cuenta: '<rect x="3" y="6" width="18" height="13" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/>',
  calendario: '<rect x="4" y="5" width="16" height="15" rx="2"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="9" y1="3" x2="9" y2="7"/><line x1="15" y1="3" x2="15" y2="7"/>',
  corazon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>'
};

export function icon(nombre, size = 20, sw = 1.8) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

let toastTimer = null;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

export function hoja(html) {
  cerrarHoja();
  const velo = document.createElement('div');
  velo.className = 'velo';
  velo.id = 'velo';
  velo.innerHTML = `<div class="hoja" role="dialog" aria-modal="true">${html}</div>`;
  velo.addEventListener('click', (e) => { if (e.target === velo) cerrarHoja(); });
  document.body.appendChild(velo);
  const f = velo.querySelector('button, a, input');
  if (f) f.focus();
}

export function cerrarHoja() {
  const v = $('#velo');
  if (v) v.remove();
}

export function confirmar(titulo, texto, etiqueta = 'Borrar') {
  return new Promise((resolve) => {
    hoja(`<h2>${esc(titulo)}</h2><p class="nota" style="font-size:14px">${esc(texto)}</p>
      <div class="acciones"><button class="btn" data-r="0">Cancelar</button><button class="btn pri" data-r="1">${esc(etiqueta)}</button></div>`);
    $('#velo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      cerrarHoja();
      resolve(b.dataset.r === '1');
    });
  });
}

export function descargar(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
