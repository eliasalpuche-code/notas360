import { db } from './db.js';
import * as Sg from './seguridad.js';
import * as Sy from './sync.js';
import * as L from './ledger.js';
import { $, esc, money, parseImporte, hoy, fechaCorta, fechaLarga, mesNombre, diasHasta, hoyLargo, icon, toast, hoja, cerrarHoja, confirmar, descargar } from './ui.js';

// ---------------------------------------------------------------- Estado
const S = {
  cuentas: [], personas: [], movs: [], recs: [], ajustes: { id: 'ajustes' }, R: null, cById: {}, pById: {}, estado: {},
  mesCal: '', mesGastos: '', catAbierta: '', tabDeudas: 'personas',
  q: '', fTipo: '', fCuenta: '', fPersona: '',
  draft: null, draftKey: '', error: '', rutaPrev: '',
  bloqueado: true, secciones: new Set(), ocultoDesde: 0, bioDisponible: false, syncPaso: null
};

const ORDEN_CUENTA = { debito: 1, ahorro: 2, digital: 3, inversion: 4, otra: 5, efectivo: 6, credito: 7, credito_formal: 8 };

async function cargar() {
  let aj;
  [S.cuentas, S.personas, S.movs, S.recs, aj] = await Promise.all([db.all('cuentas'), db.all('personas'), db.all('movimientos'), db.all('recordatorios'), db.get('meta', 'ajustes')]);
  S.ajustes = aj || { id: 'ajustes' };
  S.cuentas.sort((a, b) => (ORDEN_CUENTA[a.tipo] || 9) - (ORDEN_CUENTA[b.tipo] || 9) || a.nombre.localeCompare(b.nombre, 'es'));
  S.personas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  S.movs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.creado || '').localeCompare(a.creado || ''));
  S.cById = Object.fromEntries(S.cuentas.map((c) => [c.id, c]));
  S.pById = Object.fromEntries(S.personas.map((p) => [p.id, p]));
  S.R = L.resumenGeneral(S.cuentas, S.personas, S.movs, { incluirConfianza: !!S.ajustes.incluirConfianza });
  S.estado = {};
  for (const pid in S.R.personas) {
    const r = S.R.personas[pid];
    r.cobros.forEach((i) => { S.estado[i.mov.id] = { ...i, deuda: false }; });
    r.deudas.forEach((i) => { S.estado[i.mov.id] = { ...i, deuda: true }; });
  }
}

// ---------------------------------------------------------------- Rutas
function ruta() {
  const h = location.hash.slice(1) || '/inicio';
  const [path, qs] = h.split('?');
  const p = path.split('/').filter(Boolean);
  return { name: p[0] || 'inicio', id: p[1] ? decodeURIComponent(p[1]) : '', q: new URLSearchParams(qs || ''), raw: h };
}
const ir = (h) => { location.hash = h; };

const VISTAS = {
  inicio: vInicio, movimientos: vMovimientos, registrar: vRegistrar, editar: vRegistrar,
  cuentas: vCuentas, cuenta: vCuenta, 'cuenta-form': vCuentaForm,
  personas: vPersonas, persona: vPersona, 'persona-form': vPersonaForm,
  mas: vMas, respaldo: vRespaldo,
  seguridad: vSeguridad, sync: vSync,
  tarjetas: vTarjetas, pagos: vPagos, 'recordatorio-form': vRecordatorioForm, confianza: vConfianza, deudas: vDeudas, gastos: vGastos
};

const SECCION = { inicio: 'inicio', movimientos: 'movimientos', registrar: 'registrar', editar: 'movimientos', cuentas: 'cuentas', cuenta: 'cuentas', 'cuenta-form': 'cuentas', personas: 'personas', persona: 'personas', 'persona-form': 'personas', mas: 'mas', respaldo: 'respaldo',
  seguridad: 'seguridad', sync: 'sync', tarjetas: 'tarjetas', pagos: 'pagos', 'recordatorio-form': 'pagos', confianza: 'confianza', deudas: 'deudas', gastos: 'gastos' };

function render() {
  if (S.bloqueado) return;
  const r = ruta();
  let vista = VISTAS[r.name] || vInicio;
  const sec = SECCION[r.name] || 'inicio';
  let candado = sec;
  if (r.name === 'persona' && S.pById[r.id] && S.pById[r.id].confianza) candado = oculta('personas') ? 'personas' : 'confianza';
  if (['cuenta', 'cuenta-form'].includes(r.name) && S.cById[r.id] && S.cById[r.id].tipo === 'credito' && !oculta('cuentas')) candado = 'tarjetas';
  if (oculta(candado)) vista = () => vProtegida(candado);
  if (!['registrar', 'editar'].includes(r.name)) { S.draft = null; S.draftKey = ''; }
  $('#nav').innerHTML = navHtml(sec);
  $('#main').innerHTML = vista(r);
  if (r.raw !== S.rutaPrev) { window.scrollTo(0, 0); S.rutaPrev = r.raw; }
  const enfoque = $('#main [autofocus]');
  if (enfoque && window.matchMedia('(min-width: 900px)').matches) enfoque.focus();
  if (r.name === 'sync' && !oculta(candado)) { prepararPasoSync(); cargarListasSync(); }
}

function navHtml(sec) {
  const enMas = ['cuentas', 'respaldo', 'personas', 'tarjetas', 'confianza', 'deudas', 'gastos', 'seguridad', 'sync'];
  const tab = (id, label, ic) => `<a href="#/${id}" class="${sec === id || (id === 'mas' && enMas.includes(sec)) ? 'on' : ''}">${icon(ic, 22)}${label}</a>`;
  const side = (id, label) => `<a href="#/${id}" class="${sec === id ? 'on' : ''}">${label}</a>`;
  const prox = (label) => `<a class="prox" aria-disabled="true">${label}<span>Pronto</span></a>`;
  return `
  <nav class="tabbar" aria-label="Navegación principal">
    ${tab('inicio', 'Inicio', 'inicio')}${tab('movimientos', 'Movimientos', 'movs')}
    <a href="#/registrar" class="mas-btn" aria-label="Registrar movimiento">${icon('plus', 24, 2.2)}</a>
    ${tab('pagos', 'Pagos', 'calendario')}${tab('mas', 'Más', 'mas')}
  </nav>
  <nav class="sidebar" aria-label="Navegación principal">
    <div class="marca"><span class="logo">M</span>Mis Finanzas 360</div>
    <a href="#/registrar" class="nuevo">+ Registrar movimiento</a>
    <div><div class="grupo">General</div>${side('inicio', 'Inicio')}${side('movimientos', 'Movimientos')}${side('pagos', 'Pagos y recordatorios')}</div>
    <div><div class="grupo">Mi dinero</div>${side('cuentas', 'Cuentas y efectivo')}${side('tarjetas', 'Tarjetas de crédito')}</div>
    <div><div class="grupo">Personas</div>${side('personas', 'Personas y saldos')}${side('confianza', 'Cuentas de confianza')}${side('deudas', 'Deudas personales')}</div>
    <div><div class="grupo">Análisis</div>${side('gastos', 'Gastos del mes')}</div>
    <div><div class="grupo">Ajustes</div>${side('seguridad', 'Seguridad')}${side('sync', 'Respaldo en Drive')}${side('respaldo', 'Respaldo en archivo')}${Sg.tienePin() ? '<a href="#/inicio" data-act="bloquear">Bloquear ahora</a>' : ''}</div>
    <div><div class="grupo">Próximamente</div>${prox('Avisos en Calendar')}</div>
  </nav>`;
}

// ---------------------------------------------------------------- Ayudas de vista
function tope(titulo, sub = '', derecha = '') {
  return `<header class="tope"><div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}<h1>${esc(titulo)}</h1></div>${derecha}</header>`;
}
function volver(href, label) {
  return `<a href="${href}" class="volver">${icon('atras', 18, 2)}${esc(label)}</a>`;
}
const nomCuenta = (id) => (S.cById[id] ? S.cById[id].nombre : '');
const nomPersona = (id) => (S.pById[id] ? S.pById[id].nombre : '');

function conceptoMov(m) {
  if (m.concepto) return m.concepto;
  const p = nomPersona(m.personaId);
  switch (m.tipo) {
    case 'prestamo': return 'Préstamo a ' + p;
    case 'compra_tercero': return 'Compra para ' + p;
    case 'pago_recibido': return 'Pago de ' + p;
    case 'deuda': return 'Me prestó ' + p;
    case 'pago_deuda': return 'Pago a ' + p;
    case 'condonacion': return 'Saldo de ' + p + ' convertido en regalo';
    default: return L.TIPOS[m.tipo] ? L.TIPOS[m.tipo].label : 'Movimiento';
  }
}

function impMov(m) {
  if (['ingreso', 'pago_recibido'].includes(m.tipo)) return ['ingreso', money(m.importe, { signo: true })];
  if (L.esGastoReal(m) || m.tipo === 'sin_identificar') return ['gasto', money(-m.importe)];
  return ['neutro', money(m.importe)];
}

function tagMov(m) {
  if (m.tipo === 'sin_identificar') return '<span class="tag pend">Por identificar</span>';
  const e = S.estado[m.id];
  if (!e) return '';
  if (e.estado === 'pagado') return `<span class="tag ok">${e.deuda ? 'Pagado' : 'Recuperado'}</span>`;
  if (!e.deuda && S.pById[m.personaId] && S.pById[m.personaId].confianza) return '<span class="tag" style="background:#E8EDF5;color:#2D3B55">Confianza</span>';
  if (e.estado === 'parcial') return '<span class="tag parc">Parcial</span>';
  return `<span class="tag pend">${e.deuda ? 'Por pagar' : 'Por recuperar'}</span>`;
}

function cuentasMov(m) {
  const o = nomCuenta(m.origenId), d = nomCuenta(m.destinoId);
  return o && d ? o + ' → ' + d : (o || d || '—');
}

function filaMov(m, opts = {}) {
  let [cls, txt] = impMov(m);
  const velado = m.personaId && S.pById[m.personaId] && S.pById[m.personaId].confianza && oculta('confianza');
  if (velado) return `<button type="button" class="fila" data-act="abrir-seccion" data-v="confianza"><span class="fecha">${esc(fechaCorta(m.fecha))}</span><span class="grow"><span class="t" style="display:block">Movimiento protegido</span><span class="s" style="display:block">Cuentas de confianza</span></span><span class="oculto">•••</span></button>`;
  if (opts.cuentaId) {
    const c = S.cById[opts.cuentaId];
    const entra = m.destinoId === opts.cuentaId;
    const v = entra ? m.importe : -m.importe;
    cls = L.esDeuda(c) ? 'neutro' : (entra ? 'ingreso' : (L.esGastoReal(m) ? 'gasto' : 'neutro'));
    txt = money(v, { signo: true });
  }
  const tipo = L.TIPOS[m.tipo] ? L.TIPOS[m.tipo].label : '';
  const per = nomPersona(m.personaId);
  return `<button type="button" class="fila" data-act="ver-mov" data-id="${esc(m.id)}">
    <span class="fecha">${esc(fechaCorta(m.fecha))}</span>
    <span class="grow"><span class="t" style="display:block">${esc(conceptoMov(m))}</span>
      <span class="s" style="display:block">${esc(cuentasMov(m))} · ${esc(tipo)}${per && !conceptoMov(m).includes(per) ? ' · ' + esc(per) : ''}</span></span>
    <span style="text-align:right"><span class="imp ${cls}" style="display:block">${esc(txt)}</span>${tagMov(m) ? `<span style="display:block;margin-top:3px">${tagMov(m)}</span>` : ''}</span>
  </button>`;
}

function filaCuenta(c) {
  const v = S.R.saldos[c.id] || 0;
  const credito = L.esDeuda(c);
  return `<a class="fila" href="#/cuenta/${encodeURIComponent(c.id)}">
    <span class="grow"><span class="t" style="display:block">${esc(c.nombre)}</span><span class="s" style="display:block">${esc([c.institucion, L.TIPOS_CUENTA[c.tipo]].filter(Boolean).join(' · '))}</span></span>
    <span class="imp ${credito && v < 0 ? 'gasto' : ''}">${esc(money(credito ? -v : v))}</span></a>`;
}

// ---------------------------------------------------------------- Agenda compartida
function agendaEntre(desde, hasta) {
  return L.agenda({ cuentas: S.cuentas, movs: S.movs, R: S.R, recordatorios: S.recs }, desde, hasta, hoy());
}

function tituloAgenda(a) {
  if (a.tipo === 'cobro') return nomPersona(a.personaId) + ' te paga';
  if (a.tipo === 'deuda') return 'Pagar a ' + nomPersona(a.personaId);
  return a.titulo;
}

function hrefAgenda(a) {
  if (a.personaId) return '#/persona/' + encodeURIComponent(a.personaId);
  if (a.cuentaId) return '#/cuenta/' + encodeURIComponent(a.cuentaId);
  if (a.recId) return '#/recordatorio-form/' + encodeURIComponent(a.recId);
  return '#/pagos';
}

function tagDias(f, hecho) {
  if (hecho) return '<span class="tag ok">Hecho</span>';
  const d = diasHasta(f);
  if (d < 0) return `<span class="tag pend">Venció hace ${-d} ${-d === 1 ? 'día' : 'días'}</span>`;
  if (d === 0) return '<span class="tag pend">Hoy</span>';
  if (d <= 7) return `<span class="tag pend">En ${d} ${d === 1 ? 'día' : 'días'}</span>`;
  return '';
}

function filaAgenda(a) {
  const salida = a.tipo === 'pago' || a.tipo === 'deuda';
  const imp = a.importe === null || a.importe === undefined ? '—' : money(a.importe);
  return `<a class="fila" href="${hrefAgenda(a)}">
    <span class="fecha">${esc(fechaCorta(a.fecha))}</span>
    <span class="grow"><span class="t" style="display:block">${esc(tituloAgenda(a))}</span>${a.sub ? `<span class="s" style="display:block">${esc(a.sub)}</span>` : ''}<span style="display:block;margin-top:3px">${tagDias(a.fecha, a.hecho)}</span></span>
    <span class="imp ${salida && a.importe ? 'gasto' : a.tipo === 'corte' ? 'cero' : ''}">${imp}</span></a>`;
}

// Avisos que tocan hoy según la anticipación elegida, más lo atrasado.
function avisosHoy() {
  return agendaEntre(L.sumarDias(hoy(), -60), L.sumarDias(hoy(), 6)).filter((a) => {
    if (a.hecho) return false;
    const d = diasHasta(a.fecha);
    if (a.tipo === 'corte') return d === 0 && (a.avisos || []).includes(0);
    if (d < 0) return true;
    return (a.avisos || []).some((n) => d <= n) && d <= Math.max(...(a.avisos || [0]));
  });
}

// ---------------------------------------------------------------- Inicio
function vInicio() {
  const R = S.R;
  const nuevas = !S.movs.length && S.cuentas.length <= 1;
  const bancos = S.cuentas.filter((c) => c.activa !== false && !L.esDeuda(c));
  const tarjetas = S.cuentas.filter((c) => c.activa !== false && c.tipo === 'credito');
  const conSaldo = S.personas.filter((p) => !p.confianza && Math.abs(R.personas[p.id].neto) > 0.009);
  const avisos = avisosHoy();
  const prox = agendaEntre(hoy(), L.sumarDias(hoy(), 30)).filter((a) => !a.hecho && a.fecha >= hoy() && a.tipo !== 'corte').slice(0, 5);
  const mes = hoy().slice(0, 7);
  const g = L.gastosMes(S.movs, mes);
  const gPrev = L.gastosMes(S.movs, L.sumarMeses(mes + '-01', -1, 1).slice(0, 7));

  const sy = Sy.estado();
  return `
  ${tope('Inicio', hoyLargo(), chipSync())}
  ${!sy.configurado && S.movs.length >= 3 ? `<a class="aviso" href="#/sync" style="background:#EDF1F7;color:#1F3D6B">${icon('alerta', 18, 2)}<span class="grow">Tus datos solo están en este dispositivo. Activa el respaldo cifrado en Google Drive.</span><strong>Activar</strong></a>` : ''}
  ${nuevas ? `<section class="panel panel-pad">
      <h2 style="margin:0;font-size:17px">Bienvenido</h2>
      <p class="nota" style="font-size:14px;margin:6px 0 14px">Empieza agregando tus cuentas de banco y tarjetas con su saldo actual. Ya tienes creada la cuenta <strong>Efectivo / Caja</strong>.</p>
      <div class="acciones"><a class="btn pri" href="#/cuenta-form">Agregar cuenta</a><a class="btn" href="#/registrar">Registrar movimiento</a></div>
    </section>` : ''}

  ${avisos.length ? `<section class="panel" aria-labelledby="h-av" style="border-color:#F1D9B0">
      <div class="panel-cab" style="background:var(--ambar-bg);padding-bottom:12px"><h2 id="h-av" style="display:flex;gap:8px;align-items:center;color:var(--ambar-tx-2)">${icon('campana', 18, 2)}Avisos de hoy</h2></div>
      ${avisos.map(filaAgenda).join('')}</section>` : ''}

  <section class="panel panel-pad" aria-label="Resumen">
    <div class="etq">Total disponible</div>
    <div class="grande">${money(R.disponible)}</div>
    <div class="etq" style="margin-top:2px">Bancos ${money(R.bancos)} · Efectivo ${money(R.efectivo)}</div>
    <div class="grid2 sep">
      <div><div class="etq">Tarjetas</div><div class="medio ${R.tarjetas > 0 ? 'gasto' : ''}">${money(R.tarjetas)}</div></div>
      <div><div class="etq">Me deben</div><div class="medio">${money(R.meDeben)}</div></div>
      <div><div class="etq">Compras para terceros</div><div class="medio">${money(R.compras)}</div></div>
      <div><a href="#/deudas" style="color:inherit"><div class="etq">Yo debo</div><div class="medio ${R.yoDebo > 0 ? 'gasto' : ''}">${money(R.yoDebo)}</div>${R.creditos > 0 ? `<div class="etq" style="font-size:11.5px">Incluye créditos ${money(R.creditos)}</div>` : ''}</a></div>
      <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:baseline;padding-top:12px;border-top:1px solid var(--linea-2)">
        <span class="etq">Patrimonio estimado</span><span class="medio ${R.patrimonio >= 0 ? 'ingreso' : 'gasto'}">${money(R.patrimonio)}</span></div>
    </div>
  </section>

  <div class="chips" aria-label="Registro rápido">
    <a class="chip" href="#/registrar?tipo=gasto">Gasto</a>
    <a class="chip" href="#/registrar?tipo=ingreso">Ingreso</a>
    <a class="chip" href="#/registrar?tipo=prestamo">Préstamo</a>
    <a class="chip" href="#/registrar?tipo=compra_tercero">Compra para alguien</a>
    <a class="chip" href="#/registrar?tipo=retiro">Retiro</a>
    <a class="chip" href="#/registrar?tipo=pago_tarjeta">Pagar tarjeta</a>
  </div>

  ${R.sinIdentificar ? `<a class="aviso" href="#/movimientos?tipo=sin_identificar">${icon('alerta', 18, 2)}<span class="grow">${R.sinIdentificar} ${R.sinIdentificar === 1 ? 'movimiento' : 'movimientos'} sin identificar</span><strong>Revisar</strong></a>` : ''}

  <div class="cols">
    <section class="panel" aria-labelledby="h-prox">
      <div class="panel-cab"><h2 id="h-prox">Próximos pagos y cobros</h2><a class="btn link" href="#/pagos">Ver todo</a></div>
      ${prox.length ? prox.map(filaAgenda).join('') : '<div class="vacio">Nada en los próximos 30 días.</div>'}
    </section>

    <section class="panel" aria-labelledby="h-per">
      <div class="panel-cab"><h2 id="h-per">Personas con saldo</h2><a class="btn link" href="#/personas">Ver todas</a></div>
      ${conSaldo.length ? conSaldo.map((p) => {
        const n = R.personas[p.id].neto;
        return `<a class="fila" href="#/persona/${encodeURIComponent(p.id)}"><span class="grow t">${esc(p.nombre)}${n < 0 ? ' <span class="s" style="display:inline">· le debo</span>' : ''}</span><span class="imp ${n < 0 ? 'gasto' : ''}">${money(n)}</span></a>`;
      }).join('') : '<div class="vacio">Nadie te debe ni le debes a nadie.</div>'}
    </section>

    <section class="panel" aria-labelledby="h-cue">
      <div class="panel-cab"><h2 id="h-cue">Cuentas</h2><a class="btn link" href="#/cuenta-form">+ Agregar</a></div>
      ${bancos.map(filaCuenta).join('')}
    </section>

    <section class="panel" aria-labelledby="h-tdc">
      <div class="panel-cab"><h2 id="h-tdc">Tarjetas de crédito</h2><a class="btn link" href="#/tarjetas">Ver detalle</a></div>
      ${tarjetas.length ? tarjetas.map(filaCuenta).join('') : '<div class="vacio">Aún no agregas tarjetas. <a href="#/cuenta-form?tipo=credito" style="font-weight:600">Agregar</a></div>'}
    </section>
  </div>

  ${R.confianza > 0 && oculta('confianza') ? `<a class="panel panel-pad" href="#/confianza" style="display:flex;align-items:center;gap:10px;background:#EDF1F7;border-color:#DCE3EE;color:var(--tinta)"><span style="color:var(--azul)">${iconCandado(18)}</span><span class="grow"><strong style="font-weight:600">Cuentas de confianza</strong><br><span class="etq" style="font-size:12.5px">Protegido con PIN</span></span><span class="oculto">•••</span></a>` : ''}
  ${R.confianza > 0 && !oculta('confianza') ? `<a class="panel panel-pad" href="#/confianza" style="display:flex;align-items:center;gap:10px;background:#EDF1F7;border-color:#DCE3EE;color:var(--tinta)">
      <span style="color:var(--azul)">${icon('corazon', 18, 2)}</span>
      <span class="grow"><strong style="font-weight:600">Cuentas de confianza</strong><br><span class="etq" style="font-size:12.5px">${R.nConfianza} ${R.nConfianza === 1 ? 'persona' : 'personas'} · ${S.ajustes.incluirConfianza ? 'incluido en patrimonio' : 'no se suma a tus totales'}</span></span>
      <strong style="color:#1F3D6B">${money(R.confianza)}</strong></a>` : ''}

  <a class="panel panel-pad" href="#/gastos" style="display:flex;align-items:center;gap:10px;color:var(--tinta)">
    <span class="grow"><strong style="font-weight:600">Gastos de ${esc(mesNombre(mes + '-01').split(' ')[0])}</strong><br><span class="etq" style="font-size:12.5px">Mes pasado: ${money(gPrev.total)}</span></span>
    <strong class="gasto">${money(g.total)}</strong></a>`;
}

// ---------------------------------------------------------------- Movimientos
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function textoBusqueda(m) {
  return norm([conceptoMov(m), m.notas, m.referenciaBanco, m.categoria, L.TIPOS[m.tipo] && L.TIPOS[m.tipo].label,
    nomCuenta(m.origenId), nomCuenta(m.destinoId), S.cById[m.origenId] && S.cById[m.origenId].institucion, S.cById[m.destinoId] && S.cById[m.destinoId].institucion,
    nomPersona(m.personaId), money(m.importe), String(m.importe), fechaLarga(m.fecha), mesNombre(m.fecha)].join(' '));
}

function filtrar() {
  const tokens = norm(S.q).split(/\s+/).filter(Boolean);
  return S.movs.filter((m) => {
    if (S.fTipo && m.tipo !== S.fTipo) return false;
    if (S.fCuenta && m.origenId !== S.fCuenta && m.destinoId !== S.fCuenta) return false;
    if (S.fPersona && m.personaId !== S.fPersona) return false;
    if (!tokens.length) return true;
    const t = textoBusqueda(m);
    return tokens.every((k) => t.includes(k));
  });
}

function listaMovs(movs) {
  if (!movs.length) return '<div class="vacio">No hay movimientos que coincidan.</div>';
  let mes = '', html = '';
  for (const m of movs) {
    const mm = mesNombre(m.fecha);
    if (mm !== mes) { mes = mm; html += `<div class="mini-tit" style="padding:12px 16px 6px;border-top:1px solid var(--linea-2)">${esc(mm)}</div>`; }
    html += filaMov(m);
  }
  return html;
}

function vMovimientos(r) {
  if (r.q.has('tipo')) S.fTipo = r.q.get('tipo');
  const usados = L.ORDEN_TIPOS.filter((t) => S.movs.some((m) => m.tipo === t));
  const lista = filtrar();
  return `
  ${tope('Movimientos', S.movs.length + ' en total', '<a class="btn pri" href="#/registrar">+ Registrar</a>')}
  <label class="buscador">${icon('buscar', 16, 2)}<span class="sr">Buscar movimientos</span>
    <input type="search" id="q" value="${esc(S.q)}" placeholder="Carlos, HSBC, $5,000, Home Depot, noviembre…" autocomplete="off"></label>
  <div class="chips" aria-label="Filtrar por tipo">
    <button type="button" class="chip ${!S.fTipo ? 'on' : ''}" data-act="f-tipo" data-v="">Todos</button>
    ${usados.map((t) => `<button type="button" class="chip ${S.fTipo === t ? 'on' : ''}" data-act="f-tipo" data-v="${t}">${esc(L.TIPOS[t].label)}</button>`).join('')}
  </div>
  <div class="grid2">
    <label class="campo"><span class="sr">Cuenta</span><select id="fCuenta"><option value="">Todas las cuentas</option>${S.cuentas.map((c) => `<option value="${esc(c.id)}" ${S.fCuenta === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select></label>
    <label class="campo"><span class="sr">Persona</span><select id="fPersona"><option value="">Todas las personas</option>${S.personas.map((p) => `<option value="${esc(p.id)}" ${S.fPersona === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select></label>
  </div>
  <div class="nota" style="display:flex;gap:14px;flex-wrap:wrap"><span><strong class="gasto">Rojo</strong> gasto real</span><span><strong class="ingreso">Verde</strong> entra dinero</span><span><strong>Negro</strong> no es gasto</span></div>
  <section class="panel" id="lista" aria-label="Lista de movimientos" style="margin-top:-2px">${listaMovs(lista)}</section>`;
}

function verMov(id) {
  const m = S.movs.find((x) => x.id === id);
  if (!m) return;
  const [cls, txt] = impMov(m);
  const e = S.estado[m.id];
  const ef = L.efectos(m, S.cById, S.pById);
  const extra = [];
  if (m.categoria && L.TIPOS[m.tipo].categoria) extra.push(['Categoría', m.categoria]);
  if (m.fechaAcordada) extra.push(['Fecha acordada', fechaLarga(m.fechaAcordada)]);
  if (m.tipo === 'compra_tercero') {
    extra.push(['Recuperación', L.RECUPERACION[m.recuperacion || 'despues']]);
    if (m.msi) extra.push(['Meses sin intereses', m.msi + ' MSI']);
    if (m.promocion) extra.push(['Promoción', m.promocion]);
  }
  if (e) extra.push([e.deuda ? 'Pendiente de pagar' : 'Pendiente de recuperar', money(e.pendiente)]);
  hoja(`
    <div><div class="etq">${esc(fechaLarga(m.fecha))} · ${esc(L.TIPOS[m.tipo].label)}</div>
      <div class="grande ${cls}" style="font-size:28px">${esc(txt)}</div>${tagMov(m)}</div>
    ${m.referenciaBanco ? `<div><div class="mini-tit">Lo que dice el banco</div><div class="banco" style="margin-top:6px">${esc(m.referenciaBanco)}</div></div>` : ''}
    <div><div class="mini-tit">Lo que realmente pasó</div><div style="margin-top:6px;font-size:14.5px;line-height:1.5"><strong style="font-weight:600">${esc(conceptoMov(m))}</strong>${m.notas ? '<br>' + esc(m.notas) : ''}</div></div>
    ${extra.length ? `<div>${extra.map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--linea-2);font-size:14px"><span class="etq">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>` : ''}
    <div class="efecto"><h2>Efecto en tus saldos</h2><ul>${ef.map((x) => `<li><span>${esc(x.k)}</span><strong class="${x.clase}">${x.v === null ? esc(x.texto) : esc(money(x.v, { signo: true }))}</strong></li>`).join('')}</ul></div>
    <div class="acciones">
      <button type="button" class="btn" data-act="borrar-mov" data-id="${esc(m.id)}">Borrar</button>
      ${m.tipo === 'condonacion' ? '<button type="button" class="btn pri" data-act="cerrar">Cerrar</button>' : `<a class="btn pri" href="#/editar/${encodeURIComponent(m.vinculoId && S.movs.some((x) => x.id === m.vinculoId) ? m.vinculoId : m.id)}" data-act="cerrar">Editar</a>`}
    </div>
    ${m.vinculoId ? '<p class="nota">Este pago se creó junto con una compra para tercero; al editar se abre la compra original.</p>' : ''}`);
}

async function borrarMov(id) {
  const ok = await confirmar('¿Borrar este movimiento?', 'Los saldos se recalculan solos. Esta acción no se puede deshacer.');
  if (!ok) return;
  await db.del('movimientos', id);
  for (const h of S.movs.filter((x) => x.vinculoId === id)) await db.del('movimientos', h.id);
  await cargar();
  toast('Movimiento borrado');
  render();
}

// ---------------------------------------------------------------- Registrar / editar
function opcionesCuenta(tipo, campo) {
  const act = S.cuentas.filter((c) => c.activa !== false && c.tipo !== 'credito_formal');
  const noCred = act.filter((c) => c.tipo !== 'credito');
  const formales = S.cuentas.filter((c) => c.activa !== false && c.tipo === 'credito_formal');
  const efe = act.filter((c) => c.tipo === 'efectivo');
  const banco = act.filter((c) => !['credito', 'efectivo'].includes(c.tipo));
  const cred = act.filter((c) => c.tipo === 'credito');
  const R = {
    gasto: { origen: act }, ingreso: { destino: noCred }, transferencia: { origen: noCred, destino: noCred },
    retiro: { origen: banco, destino: efe }, deposito: { origen: efe, destino: banco },
    pago_tarjeta: { origen: noCred, destino: [...cred, ...formales] }, prestamo: { origen: act }, pago_recibido: { destino: noCred },
    compra_tercero: { origen: act }, deuda: { destino: noCred }, pago_deuda: { origen: noCred }, sin_identificar: { origen: act }
  };
  return (R[tipo] && R[tipo][campo]) || act;
}

function ultimo(tipo, campo) {
  const m = S.movs.find((x) => x.tipo === tipo && x[campo]);
  return m ? m[campo] : '';
}

function iniciarDraft(r) {
  const key = r.raw;
  if (S.draft && S.draftKey === key) return;
  S.error = '';
  S.draftKey = key;
  if (r.name === 'editar') {
    const m = S.movs.find((x) => x.id === r.id);
    if (!m) { S.draft = null; return; }
    const hijo = S.movs.find((x) => x.vinculoId === m.id);
    S.draft = { ...m, importe: String(m.importe), pagadoEnId: hijo ? hijo.destinoId : '' };
    return;
  }
  const tipo = L.TIPOS[r.q.get('tipo')] ? r.q.get('tipo') : 'gasto';
  S.draft = { tipo, importe: '', fecha: hoy(), concepto: '', notas: '', referenciaBanco: '', categoria: '', personaId: r.q.get('persona') || '',
    origenId: r.q.get('origen') || '', destinoId: r.q.get('destino') || '', recuperacion: 'despues', fechaAcordada: '', msi: '', promocion: '', aplicaA: '', pagadoEnId: '', pagos: '' };
  completarDefaults();
}

function completarDefaults() {
  const d = S.draft, t = L.TIPOS[d.tipo];
  for (const campo of ['origen', 'destino']) {
    const k = campo + 'Id';
    if (!t[campo]) continue;
    const ops = opcionesCuenta(d.tipo, campo);
    if (!ops.some((c) => c.id === d[k])) {
      const u = ultimo(d.tipo, k);
      d[k] = ops.some((c) => c.id === u) ? u : (ops.length === 1 ? ops[0].id : '');
    }
  }
}

function selCuenta(name, label, tipo, campo, valor) {
  const ops = opcionesCuenta(tipo, campo);
  if (!ops.length) {
    const falta = tipo === 'pago_tarjeta' && campo === 'destino' ? 'tarjetas ni créditos' : (campo === 'destino' && tipo === 'retiro') || (campo === 'origen' && tipo === 'deposito') ? 'cuentas de efectivo' : 'cuentas';
    return `<div class="campo">${esc(label)}<div class="aviso" style="font-size:13.5px">No tienes ${falta} para esto. <a href="#/cuenta-form${tipo === 'pago_tarjeta' ? '?tipo=credito' : ''}" style="font-weight:600">Agregar</a></div></div>`;
  }
  return `<label class="campo">${esc(label)}<select name="${name}">${ops.length > 1 || !valor ? '<option value="">Elige…</option>' : ''}${ops.map((c) => `<option value="${esc(c.id)}" ${valor === c.id ? 'selected' : ''}>${esc(c.nombre)}${c.tipo === 'credito' ? ' (tarjeta)' : c.tipo === 'credito_formal' ? ' (crédito)' : ''}</option>`).join('')}</select></label>`;
}

function vRegistrar(r) {
  iniciarDraft(r);
  const d = S.draft;
  if (!d) return `${volver('#/movimientos', 'Movimientos')}<div class="vacio">Ese movimiento ya no existe.</div>`;
  const t = L.TIPOS[d.tipo];
  const editando = r.name === 'editar';
  const persOps = S.personas.map((p) => `<option value="${esc(p.id)}" ${d.personaId === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  const recup = d.recuperacion || 'despues';
  const mostrarAcordada = t.acordada && (!t.compra || ['despues', 'partes'].includes(recup));
  let aplicaHtml = '';
  if (t.aplica && d.personaId && S.R.personas[d.personaId]) {
    const items = (t.aplica === 'cobro' ? S.R.personas[d.personaId].cobros : S.R.personas[d.personaId].deudas).filter((i) => i.pendiente > 0 || i.mov.id === d.aplicaA);
    if (items.length) {
      aplicaHtml = `<label class="campo">¿A qué saldo se aplica?<select name="aplicaA"><option value="">Al más antiguo (automático)</option>${items.map((i) => `<option value="${esc(i.mov.id)}" ${d.aplicaA === i.mov.id ? 'selected' : ''}>${esc(fechaCorta(i.mov.fecha) + ' · ' + conceptoMov(i.mov) + ' · pendiente ' + money(i.pendiente))}</option>`).join('')}</select></label>`;
    }
  }
  return `
  ${editando ? volver('#/movimientos', 'Cancelar') : `<a href="#/inicio" class="volver" data-act="atras">${icon('atras', 18, 2)}Cancelar</a>`}
  <h1 style="margin:-6px 0 0;font-size:22px;font-weight:600">${editando ? 'Editar movimiento' : 'Nuevo movimiento'}</h1>
  <form class="form" data-form="mov" novalidate>
    <div class="importe"><label for="f-importe" class="etq">Importe</label>
      <input id="f-importe" name="importe" inputmode="decimal" autocomplete="off" placeholder="$0" value="${esc(d.importe)}" ${editando ? '' : 'autofocus'}></div>

    <fieldset style="border:0;margin:0;padding:0"><legend class="etq" style="padding:0;margin-bottom:8px;font-weight:600;color:var(--tinta)">Tipo de movimiento</legend>
      <div class="tipos">${L.ORDEN_TIPOS.map((k) => `<button type="button" data-act="tipo" data-v="${k}" class="${d.tipo === k ? 'on' : ''}" aria-pressed="${d.tipo === k}">${esc(L.TIPOS[k].label)}</button>`).join('')}</div>
    </fieldset>

    ${t.origen ? selCuenta('origenId', t.origen, d.tipo, 'origen', d.origenId) : ''}
    ${t.destino ? selCuenta('destinoId', t.destino, d.tipo, 'destino', d.destinoId) : ''}
    ${t.persona ? `<label class="campo">Persona${t.persona === 'opc' ? ' (opcional)' : ''}<select name="personaId"><option value="">${t.persona === 'opc' ? 'Ninguna' : 'Elige…'}</option>${persOps}<option value="__nueva">+ Nueva persona…</option></select></label>` : ''}
    ${aplicaHtml}

    ${t.compra ? `<div><div class="etq" style="margin-bottom:8px">¿Cómo se recupera?</div><div class="chips wrap" role="radiogroup" aria-label="¿Cómo se recupera?">
      ${Object.entries(L.RECUPERACION).map(([k, v]) => `<button type="button" role="radio" aria-checked="${recup === k}" class="chip ${recup === k ? 'on' : ''}" data-act="recup" data-v="${k}">${esc(v)}</button>`).join('')}</div></div>` : ''}
    ${t.compra && recup === 'pagado' ? selCuenta('pagadoEnId', '¿En qué cuenta te pagó?', 'pago_recibido', 'destino', d.pagadoEnId) : ''}
    ${t.compra && recup === 'partes' ? `<label class="campo">Número de pagos (opcional)<input name="pagos" inputmode="numeric" value="${esc(d.pagos)}" placeholder="Ej. 3"></label>` : ''}

    ${t.categoria ? `<label class="campo">Categoría<select name="categoria"><option value="">Elige…</option>${L.CATEGORIAS.map((c) => `<option ${d.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
    <label class="campo">Concepto<input name="concepto" value="${esc(d.concepto)}" placeholder="${esc(t.compra ? 'Ej. Compra de electrónica' : d.tipo === 'gasto' ? 'Ej. Comida' : 'Opcional')}" autocomplete="off"></label>
    <div class="grid2">
      <label class="campo">Fecha<input type="date" name="fecha" value="${esc(d.fecha)}"></label>
      ${mostrarAcordada ? `<label class="campo">Fecha acordada<input type="date" name="fechaAcordada" value="${esc(d.fechaAcordada)}"></label>` : '<span></span>'}
    </div>
    ${t.compra ? `<div class="grid2">
      <label class="campo">Meses sin intereses<select name="msi"><option value="">No aplica</option>${[3, 6, 9, 12, 18, 24].map((n) => `<option value="${n}" ${String(d.msi) === String(n) ? 'selected' : ''}>${n} MSI</option>`).join('')}</select></label>
      <label class="campo">Promoción (opcional)<input name="promocion" value="${esc(d.promocion)}" autocomplete="off"></label></div>` : ''}
    <label class="campo">Texto del banco (opcional)<input name="referenciaBanco" value="${esc(d.referenciaBanco)}" placeholder="Ej. SPEI ENVIADO CTA XXXX4587" autocomplete="off"></label>
    <label class="campo">Notas<textarea name="notas" rows="2" placeholder="¿Por qué hiciste este movimiento? Esto es lo que el banco no guarda.">${esc(d.notas)}</textarea></label>

    <div id="f-error">${S.error ? `<div class="error" role="alert">${esc(S.error)}</div>` : ''}</div>
    <section class="efecto" id="f-preview" aria-live="polite">${previewHtml()}</section>
    <button type="submit" class="btn pri bloque">${editando ? 'Guardar cambios' : 'Guardar movimiento'}</button>
    ${editando ? `<button type="button" class="btn peligro" data-act="borrar-mov" data-id="${esc(d.id)}">Borrar movimiento</button>` : ''}
  </form>`;
}

function movDesdeDraft() {
  const d = S.draft, t = L.TIPOS[d.tipo];
  const m = { ...d, importe: parseImporte(d.importe) };
  if (!t.origen) m.origenId = '';
  if (!t.destino) m.destinoId = '';
  if (!t.persona) m.personaId = '';
  if (!t.categoria) m.categoria = '';
  if (!t.aplica) m.aplicaA = '';
  if (!t.compra) { m.recuperacion = ''; m.msi = ''; m.promocion = ''; m.pagos = ''; m.pagadoEnId = ''; }
  else if (m.recuperacion !== 'pagado') m.pagadoEnId = '';
  if (!t.acordada || (t.compra && !['despues', 'partes'].includes(m.recuperacion))) m.fechaAcordada = '';
  m.concepto = (m.concepto || '').trim();
  return m;
}

function previewHtml() {
  const m = movDesdeDraft();
  const ef = L.efectos(m, S.cById, S.pById);
  let aviso = '';
  const o = S.cById[m.origenId];
  if (o && !L.esDeuda(o) && m.importe > 0) {
    const previo = m.id ? S.movs.find((x) => x.id === m.id) : null;
    const base = (S.R.saldos[o.id] || 0) + (previo && previo.origenId === o.id ? Number(previo.importe) : 0) - (previo && previo.destinoId === o.id ? Number(previo.importe) : 0);
    if (base - m.importe < 0) aviso = `<p class="nota" style="margin:8px 0 0;color:var(--ambar-tx)">${esc(o.nombre)} quedaría en ${esc(money(base - m.importe))}. ¿Falta registrar un ingreso o un retiro?</p>`;
  }
  return `<h2>Así se registrará</h2><ul>${ef.map((x) => `<li><span>${esc(x.k)}</span><strong class="${x.clase}">${x.v === null ? esc(x.texto) : esc(money(x.v, { signo: true }))}</strong></li>`).join('')}</ul>
    <p class="nota" style="margin:8px 0 0">${esc(L.notaTipo(m))}</p>${aviso}`;
}

function leerForm(form) {
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) S.draft[k] = v;
}

async function guardarMov(form) {
  leerForm(form);
  const m = movDesdeDraft();
  const err = L.validar(m, S.cById);
  if (err) { S.error = err; $('#f-error').innerHTML = `<div class="error" role="alert">${esc(err)}</div>`; $('#f-error').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const pagadoEn = m.pagadoEnId;
  delete m.pagadoEnId;
  const guardado = await db.put('movimientos', m);
  const hijo = S.movs.find((x) => x.vinculoId === guardado.id);
  if (m.tipo === 'compra_tercero' && m.recuperacion === 'pagado') {
    await db.put('movimientos', { ...(hijo || {}), tipo: 'pago_recibido', importe: m.importe, fecha: m.fecha, destinoId: pagadoEn, personaId: m.personaId,
      aplicaA: guardado.id, vinculoId: guardado.id, concepto: 'Pago de ' + (m.concepto || 'compra') });
  } else if (hijo) {
    await db.del('movimientos', hijo.id);
  }
  const editando = !!S.draft.id;
  S.draft = null; S.draftKey = ''; S.error = '';
  await cargar();
  toast(editando ? 'Cambios guardados' : 'Movimiento guardado');
  ir('#/movimientos');
}

async function nuevaPersonaRapida() {
  hoja(`<h2>Nueva persona</h2><form class="form" data-form="persona-rapida">
    <label class="campo">Nombre<input name="nombre" required autocomplete="off"></label>
    <label class="campo">Relación (opcional)<input name="relacion" placeholder="Amigo, hermano, compañera…" autocomplete="off"></label>
    <div class="acciones"><button type="button" class="btn" data-act="cerrar-persona-rapida">Cancelar</button><button type="submit" class="btn pri">Agregar</button></div></form>`);
}

// ---------------------------------------------------------------- Cuentas
function vCuentas() {
  const act = S.cuentas.filter((c) => c.activa !== false);
  const grupos = [
    ['Cuentas de banco', act.filter((c) => !['efectivo', 'credito'].includes(c.tipo))],
    ['Efectivo', act.filter((c) => c.tipo === 'efectivo')],
    ['Tarjetas de crédito', act.filter((c) => c.tipo === 'credito')],
    ['Créditos', act.filter((c) => c.tipo === 'credito_formal')],
    ['Inactivas', S.cuentas.filter((c) => c.activa === false)]
  ].filter(([, l]) => l.length);
  return `
  ${tope('Cuentas', 'Disponible ' + money(S.R.disponible), '<a class="btn pri" href="#/cuenta-form">+ Agregar</a>')}
  ${grupos.map(([t, l]) => `<section class="panel" aria-label="${esc(t)}"><div class="panel-cab"><h2>${esc(t)}</h2></div>${l.map(filaCuenta).join('')}</section>`).join('')}
  <p class="nota">Puedes tener las cuentas que quieras, incluso más de una caja de efectivo.</p>`;
}

function vCuenta(r) {
  const c = S.cById[r.id];
  if (!c) return `${volver('#/cuentas', 'Cuentas')}<div class="vacio">Esa cuenta ya no existe.</div>`;
  const v = S.R.saldos[c.id] || 0;
  const credito = L.esDeuda(c);
  const movs = S.movs.filter((m) => m.origenId === c.id || m.destinoId === c.id);
  return `
  ${volver('#/cuentas', 'Cuentas')}
  ${tope(c.nombre, [c.institucion, L.TIPOS_CUENTA[c.tipo]].filter(Boolean).join(' · '), `<a class="btn" href="#/cuenta-form/${encodeURIComponent(c.id)}">Editar</a>`)}
  <section class="panel panel-pad">
    <div class="etq">${credito ? 'Saldo por pagar' : 'Saldo'}</div>
    <div class="grande ${credito && v < 0 ? 'gasto' : ''}">${money(credito ? -v : v)}</div>
    ${credito && c.limite ? `<div class="etq" style="margin-top:4px">Límite ${money(c.limite)} · disponible ${money(Number(c.limite) + v)}</div>` : ''}
    <div class="etq" style="margin-top:4px">Saldo inicial ${money(credito ? -c.saldoInicial : c.saldoInicial)} al ${esc(fechaLarga(c.fechaSaldoInicial))}</div>
    ${c.tipo === 'credito_formal' && c.mensualidad ? `<div class="etq" style="margin-top:4px">Mensualidad ${money(c.mensualidad)}${c.diaPago ? ' · día ' + esc(c.diaPago) : ''}</div>` : ''}
    ${c.activa === false ? '<div style="margin-top:8px"><span class="tag">Inactiva</span></div>' : ''}
    ${c.notas ? `<p class="nota sep">${esc(c.notas)}</p>` : ''}
  </section>
  ${c.tipo === 'credito' ? panelTarjeta(c, { detalle: true }) : ''}
  <div class="acciones">
    ${c.tipo === 'credito_formal' ? `<a class="btn pri" href="#/registrar?tipo=pago_tarjeta&destino=${encodeURIComponent(c.id)}">Registrar pago</a>` : `<a class="btn pri" href="#/registrar?tipo=gasto&origen=${encodeURIComponent(c.id)}">Registrar gasto</a>`}
    <a class="btn" href="#/movimientos" data-act="filtrar-cuenta" data-id="${esc(c.id)}">Ver en movimientos</a>
  </div>
  <section class="panel" aria-label="Movimientos de la cuenta"><div class="panel-cab"><h2>Movimientos</h2><span class="etq">${movs.length}</span></div>
    ${movs.length ? movs.map((m) => filaMov(m, { cuentaId: c.id })).join('') : '<div class="vacio">Sin movimientos todavía.</div>'}</section>`;
}

function vCuentaForm(r) {
  const c = r.id ? S.cById[r.id] : null;
  const tipo = c ? c.tipo : (r.q.get('tipo') || 'debito');
  const credito = tipo === 'credito';
  const formal = tipo === 'credito_formal';
  const deuda = credito || formal;
  const saldoIni = c ? (deuda ? -c.saldoInicial : c.saldoInicial) : '';
  const avisos = (c && c.avisos) || (formal ? [3, 1] : [5, 3, 1]);
  const avisosHtml = `<fieldset style="border:0;margin:0;padding:0"><legend class="etq" style="padding:0;margin-bottom:8px">Avisarme antes del pago</legend><div class="chips wrap">
    ${[[5, '5 días'], [3, '3 días'], [1, '1 día'], [0, 'El mismo día']].map(([n, l]) => `<label class="chip ${avisos.includes(n) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" name="aviso${n}" ${avisos.includes(n) ? 'checked' : ''} class="sr" data-act="chip-check">${l}</label>`).join('')}</div></fieldset>`;
  return `
  ${c ? volver('#/cuenta/' + encodeURIComponent(c.id), 'Cancelar') : `<a href="#/cuentas" class="volver" data-act="atras">${icon('atras', 18, 2)}Cancelar</a>`}
  <h1 style="margin:-6px 0 0;font-size:22px;font-weight:600">${c ? 'Editar cuenta' : 'Nueva cuenta'}</h1>
  <form class="form" data-form="cuenta" data-id="${esc(c ? c.id : '')}" novalidate>
    <label class="campo">Tipo de cuenta<select name="tipo" data-act="tipo-cuenta">${Object.entries(L.TIPOS_CUENTA).map(([k, v]) => `<option value="${k}" ${tipo === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <label class="campo">Nombre<input name="nombre" value="${esc(c ? c.nombre : '')}" placeholder="${credito ? 'Ej. BBVA Azul' : formal ? 'Ej. Crédito del auto' : 'Ej. BBVA nómina'}" required autocomplete="off" ${c ? '' : 'autofocus'}></label>
    <label class="campo">Institución (opcional)<input name="institucion" value="${esc(c ? c.institucion : '')}" placeholder="Ej. BBVA" autocomplete="off"></label>
    <div class="grid2">
      <label class="campo">${credito ? 'Deuda actual de la tarjeta' : formal ? 'Lo que debes hoy' : 'Saldo actual'}<input name="saldoInicial" inputmode="decimal" value="${esc(saldoIni === '' ? '' : String(saldoIni))}" placeholder="$0" autocomplete="off"></label>
      <label class="campo">A la fecha<input type="date" name="fechaSaldoInicial" value="${esc(c ? c.fechaSaldoInicial : hoy())}"></label>
    </div>
    ${credito ? `<div class="grid2">
      <label class="campo">Límite de crédito<input name="limite" inputmode="decimal" value="${esc(c && c.limite ? String(c.limite) : '')}" placeholder="$0" autocomplete="off"></label>
      <label class="campo">Día de corte<input name="diaCorte" inputmode="numeric" value="${esc(c && c.diaCorte ? String(c.diaCorte) : '')}" placeholder="Ej. 28" autocomplete="off"></label>
      <label class="campo">Días para pagar después del corte<input name="diasPago" inputmode="numeric" value="${esc(c && c.diasPago ? String(c.diasPago) : '20')}" autocomplete="off"></label>
    </div>${avisosHtml}
    <label class="check"><input type="checkbox" name="avisoCorte" ${!c || c.avisoCorte !== false ? 'checked' : ''}>Aviso el día de corte</label>` : ''}
    ${formal ? `<div class="grid2">
      <label class="campo">Mensualidad<input name="mensualidad" inputmode="decimal" value="${esc(c && c.mensualidad ? String(c.mensualidad) : '')}" placeholder="$0" autocomplete="off"></label>
      <label class="campo">Día de pago<input name="diaPago" inputmode="numeric" value="${esc(c && c.diaPago ? String(c.diaPago) : '')}" placeholder="Ej. 5" autocomplete="off"></label>
    </div>${avisosHtml}` : ''}
    <label class="campo">Moneda<select name="moneda"><option ${!c || c.moneda === 'MXN' ? 'selected' : ''}>MXN</option><option ${c && c.moneda === 'USD' ? 'selected' : ''}>USD</option></select></label>
    <label class="campo">Notas (opcional)<textarea name="notas" rows="2">${esc(c ? c.notas : '')}</textarea></label>
    ${c ? `<label class="check"><input type="checkbox" name="activa" ${c.activa !== false ? 'checked' : ''}>Cuenta activa</label>` : ''}
    <div id="f-error"></div>
    <button type="submit" class="btn pri bloque">${c ? 'Guardar cambios' : 'Agregar cuenta'}</button>
    ${c && !S.movs.some((m) => m.origenId === c.id || m.destinoId === c.id) ? `<button type="button" class="btn peligro" data-act="borrar-cuenta" data-id="${esc(c.id)}">Borrar cuenta</button>` : ''}
    ${c && S.movs.some((m) => m.origenId === c.id || m.destinoId === c.id) ? '<p class="nota">Esta cuenta tiene movimientos, así que no se puede borrar; desactívala para ocultarla.</p>' : ''}
  </form>`;
}

async function guardarCuenta(form) {
  const fd = Object.fromEntries(new FormData(form).entries());
  const id = form.dataset.id;
  const previa = id ? S.cById[id] : {};
  const nombre = (fd.nombre || '').trim();
  if (!nombre) { $('#f-error').innerHTML = '<div class="error" role="alert">Escribe el nombre de la cuenta.</div>'; return; }
  const credito = fd.tipo === 'credito';
  const deuda = credito || fd.tipo === 'credito_formal';
  const saldo = parseImporte(fd.saldoInicial) * (String(fd.saldoInicial).trim().startsWith('-') ? -1 : 1);
  const c = {
    ...previa, nombre, institucion: (fd.institucion || '').trim(), tipo: fd.tipo,
    saldoInicial: deuda ? -Math.abs(saldo) : saldo, fechaSaldoInicial: fd.fechaSaldoInicial || hoy(),
    moneda: fd.moneda || 'MXN', notas: fd.notas || '', activa: id ? fd.activa === 'on' : true
  };
  const avisos = [5, 3, 1, 0].filter((n) => fd['aviso' + n] === 'on');
  if (credito) {
    const dc = parseInt(fd.diaCorte, 10);
    c.limite = parseImporte(fd.limite); c.diaCorte = dc >= 1 && dc <= 31 ? dc : ''; c.diasPago = parseInt(fd.diasPago, 10) || 20;
    c.avisos = avisos; c.avisoCorte = fd.avisoCorte === 'on';
  }
  if (fd.tipo === 'credito_formal') {
    const dp = parseInt(fd.diaPago, 10);
    c.mensualidad = parseImporte(fd.mensualidad); c.diaPago = dp >= 1 && dp <= 31 ? dp : ''; c.avisos = avisos;
  }
  const g = await db.put('cuentas', c);
  await cargar();
  toast(id ? 'Cuenta actualizada' : 'Cuenta agregada');
  ir('#/cuenta/' + encodeURIComponent(g.id));
}

// ---------------------------------------------------------------- Personas
function vPersonas() {
  const R = S.R.personas;
  const norm2 = S.personas.filter((p) => !p.confianza);
  const deben = norm2.filter((p) => R[p.id].neto > 0.009);
  const debo = norm2.filter((p) => R[p.id].neto < -0.009);
  const cero = norm2.filter((p) => Math.abs(R[p.id].neto) <= 0.009);
  const conf = S.personas.filter((p) => p.confianza);
  const fila = (p) => {
    const r = R[p.id];
    const det = [r.pendPrestamos > 0 ? 'Préstamos ' + money(r.pendPrestamos) : '', r.pendCompras > 0 ? 'Compras ' + money(r.pendCompras) : '', r.yoDebo > 0 ? 'Le debo ' + money(r.yoDebo) : ''].filter(Boolean).join(' · ');
    return `<a class="fila" href="#/persona/${encodeURIComponent(p.id)}"><span class="grow"><span class="t" style="display:block">${esc(p.nombre)}</span><span class="s" style="display:block">${esc(det || p.relacion || 'Sin saldo')}</span></span><span class="imp ${r.neto < 0 ? 'gasto' : ''}">${money(r.neto)}</span></a>`;
  };
  const sec = (t, l) => (l.length ? `<section class="panel" aria-label="${esc(t)}"><div class="panel-cab"><h2>${esc(t)}</h2></div>${l.map(fila).join('')}</section>` : '');
  return `
  ${tope('Personas', 'Quién te debe y a quién le debes', '<a class="btn pri" href="#/persona-form">+ Agregar</a>')}
  ${S.personas.length ? '' : '<section class="panel"><div class="vacio">Agrega a las personas con las que tienes préstamos o compras pendientes. También puedes crearlas al registrar un movimiento.</div></section>'}
  ${sec('Me deben', deben)}${sec('Les debo', debo)}${oculta('confianza') && conf.length ? `<section class="panel"><button type="button" class="fila" style="border-top:0" data-act="abrir-seccion" data-v="confianza"><span style="color:var(--gris)">${iconCandado(16)}</span><span class="grow t">Cuentas de confianza</span><span class="oculto">•••</span></button></section>` : sec('Cuentas de confianza', conf)}${sec('Sin saldo', cero)}`;
}

function vPersona(r) {
  const p = S.pById[r.id];
  if (!p) return `${volver('#/personas', 'Personas')}<div class="vacio">Esa persona ya no existe.</div>`;
  const R = S.R.personas[p.id];
  const prestado = R.cobros.reduce((a, i) => a + i.monto, 0);
  const sumTipo = (t) => R.movimientos.filter((m) => m.tipo === t).reduce((a, m) => a + Number(m.importe), 0);
  const regresado = sumTipo('pago_recibido');
  const regalado = sumTipo('condonacion');
  const abiertos = [...R.cobros, ...R.deudas].filter((i) => i.pendiente > 0);
  const q = encodeURIComponent(p.id);
  return `
  ${volver('#/personas', 'Personas')}
  ${tope(p.nombre, p.relacion || '', `<a class="btn" href="#/persona-form/${q}">Editar</a>`)}
  <section class="panel panel-pad">
    <div class="grid2">
      <div><div class="etq">Me debe</div><div class="grande" style="font-size:28px">${money(R.meDebe)}</div></div>
      <div><div class="etq">Le debo</div><div class="grande ${R.yoDebo > 0 ? 'gasto' : ''}" style="font-size:28px">${money(R.yoDebo)}</div></div>
    </div>
    <div class="grid2 sep">
      <div><div class="etq">Le he dado en total</div><div class="medio">${money(prestado)}</div></div>
      <div><div class="etq">Me ha regresado</div><div class="medio ingreso">${money(regresado)}</div></div>
      ${regalado > 0 ? `<div><div class="etq">Convertido en regalo</div><div class="medio">${money(regalado)}</div></div>` : ''}
    </div>
    ${p.telefono || p.notas ? `<p class="nota sep">${esc([p.telefono, p.notas].filter(Boolean).join(' · '))}</p>` : ''}
  </section>
  ${p.confianza ? `<section class="panel panel-pad" style="background:#EDF1F7;border-color:#DCE3EE">
      <div style="display:flex;gap:8px;align-items:center;font-weight:600;color:#1F3D6B">${icon('corazon', 16, 2)}En cuentas de confianza</div>
      <p class="nota" style="margin:6px 0 12px;color:var(--tinta-2)">Sin plazo ni avisos de cobro. No se suma a "Me deben".</p>
      <div class="chips wrap" role="radiogroup" aria-label="Estado">${Object.entries(L.ESTADO_CONFIANZA).map(([k, v]) => `<button type="button" role="radio" aria-checked="${(p.estadoConfianza || 'sin_plazo') === k}" class="chip ${(p.estadoConfianza || 'sin_plazo') === k ? 'on' : ''}" data-act="estado-confianza" data-id="${esc(p.id)}" data-v="${k}">${esc(v)}</button>`).join('')}</div>
      <div class="acciones" style="margin-top:12px">
        <button type="button" class="btn" data-act="quitar-confianza" data-id="${esc(p.id)}">Volver a Me deben</button>
        <button type="button" class="btn" data-act="regalo" data-id="${esc(p.id)}" ${R.pendPrestamos + R.pendCompras > 0 ? '' : 'disabled'}>Convertir en regalo</button>
      </div></section>` : ''}
  <div class="acciones">
    <a class="btn pri" href="#/registrar?tipo=pago_recibido&persona=${q}">${p.confianza ? 'Registrar abono' : 'Me pagó'}</a>
    <a class="btn" href="#/registrar?tipo=prestamo&persona=${q}">Nuevo préstamo</a>
    <a class="btn" href="#/registrar?tipo=compra_tercero&persona=${q}">Compra para ${esc(p.nombre.split(' ')[0])}</a>
    <a class="btn" href="#/registrar?tipo=deuda&persona=${q}">Me prestó</a>
    ${R.yoDebo > 0 ? `<a class="btn" href="#/registrar?tipo=pago_deuda&persona=${q}" style="grid-column:1/-1">Le pagué</a>` : ''}
    ${!p.confianza && R.meDebe > 0 ? `<button type="button" class="btn" data-act="a-confianza" data-id="${esc(p.id)}" style="grid-column:1/-1">Mover a cuentas de confianza</button>` : ''}
  </div>
  <section class="panel" aria-label="Saldos abiertos"><div class="panel-cab"><h2>Saldos abiertos</h2></div>
    ${abiertos.length ? abiertos.map((i) => {
      const deuda = R.deudas.includes(i);
      return `<button type="button" class="fila" data-act="ver-mov" data-id="${esc(i.mov.id)}">
        <span class="fecha">${esc(fechaCorta(i.mov.fecha))}</span>
        <span class="grow"><span class="t" style="display:block">${esc(conceptoMov(i.mov))}</span>
          <span class="s" style="display:block">${esc(money(i.monto))}${i.pagado > 0 ? ' · ' + (deuda ? 'pagado ' : 'regresado ') + esc(money(i.pagado)) : ''}${i.mov.fechaAcordada ? ' · acordado ' + esc(fechaCorta(i.mov.fechaAcordada)) : ''}</span></span>
        <span style="text-align:right"><span class="imp ${deuda ? 'gasto' : ''}" style="display:block">${money(i.pendiente)}</span><span style="display:block;margin-top:3px">${tagMov(i.mov)}</span></span></button>`;
    }).join('') : '<div class="vacio">No hay saldos pendientes.</div>'}
  </section>
  <section class="panel" aria-label="Historial"><div class="panel-cab"><h2>Historial</h2><span class="etq">${R.movimientos.length}</span></div>
    ${R.movimientos.length ? R.movimientos.map((m) => filaMov(m)).join('') : '<div class="vacio">Sin movimientos todavía.</div>'}</section>`;
}

function vPersonaForm(r) {
  const p = r.id ? S.pById[r.id] : null;
  const tieneMovs = p && S.movs.some((m) => m.personaId === p.id);
  return `
  ${p ? volver('#/persona/' + encodeURIComponent(p.id), 'Cancelar') : `<a href="#/personas" class="volver" data-act="atras">${icon('atras', 18, 2)}Cancelar</a>`}
  <h1 style="margin:-6px 0 0;font-size:22px;font-weight:600">${p ? 'Editar persona' : 'Nueva persona'}</h1>
  <form class="form" data-form="persona" data-id="${esc(p ? p.id : '')}" novalidate>
    <label class="campo">Nombre<input name="nombre" value="${esc(p ? p.nombre : '')}" required autocomplete="off" ${p ? '' : 'autofocus'}></label>
    <label class="campo">Relación (opcional)<input name="relacion" value="${esc(p ? p.relacion : '')}" placeholder="Amigo, hermano, compañera…" autocomplete="off"></label>
    <label class="campo">Teléfono (opcional)<input name="telefono" type="tel" value="${esc(p ? p.telefono : '')}" autocomplete="off"></label>
    <label class="campo">Notas (opcional)<textarea name="notas" rows="2" placeholder="Ej. cuenta destino XXXX4587">${esc(p ? p.notas : '')}</textarea></label>
    <div id="f-error"></div>
    <button type="submit" class="btn pri bloque">${p ? 'Guardar cambios' : 'Agregar persona'}</button>
    ${p && !tieneMovs ? `<button type="button" class="btn peligro" data-act="borrar-persona" data-id="${esc(p.id)}">Borrar persona</button>` : ''}
  </form>`;
}

async function guardarPersona(form, rapida = false) {
  const fd = Object.fromEntries(new FormData(form).entries());
  const nombre = (fd.nombre || '').trim();
  if (!nombre) { const e = form.querySelector('#f-error'); if (e) e.innerHTML = '<div class="error" role="alert">Escribe el nombre.</div>'; else form.querySelector('[name=nombre]').focus(); return null; }
  const id = form.dataset.id;
  const p = { ...(id ? S.pById[id] : {}), nombre, relacion: (fd.relacion || '').trim(), telefono: (fd.telefono || '').trim(), notas: fd.notas || '' };
  const g = await db.put('personas', p);
  await cargar();
  if (!rapida) { toast(id ? 'Persona actualizada' : 'Persona agregada'); ir('#/persona/' + encodeURIComponent(g.id)); }
  return g;
}

// ---------------------------------------------------------------- Tarjetas
function panelTarjeta(c, { detalle = false } = {}) {
  const v = S.R.saldos[c.id] || 0;
  const deuda = -v;
  const lim = Number(c.limite) || 0;
  const uso = lim ? Math.min(100, Math.max(0, Math.round(deuda / lim * 100))) : 0;
  let edo = null, prox = '', estimado = false;
  if (c.diaCorte) {
    let uc = L.ultimoCorte(c.diaCorte, hoy());
    if (uc < (c.fechaSaldoInicial || '')) { uc = L.sumarMeses(uc, 1, c.diaCorte); estimado = true; }
    edo = L.estadoTarjeta(c, S.movs, uc);
    prox = L.sumarMeses(uc, 1, c.diaCorte);
  }
  const terceros = [];
  for (const pid in S.R.personas) for (const i of S.R.personas[pid].cobros) if (i.mov.origenId === c.id && i.pendiente > 0) terceros.push({ i, pid });
  const deTerceros = terceros.reduce((a, x) => a + x.i.pendiente, 0);
  let estadoTag = '';
  if (edo) {
    if (estimado) estadoTag = '<span class="tag">Primer corte ' + esc(fechaCorta(edo.corte)) + '</span>';
    else if (edo.liquidado) estadoTag = '<span class="tag ok">Pagada</span>';
    else estadoTag = tagDias(edo.limite, false) || '<span class="tag">Por pagar</span>';
  }
  return `<section class="panel" aria-label="${esc(c.nombre)}">
    <div class="panel-pad">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>${detalle ? '' : `<a href="#/cuenta/${encodeURIComponent(c.id)}" style="color:inherit"><h2 style="margin:0;font-size:16px;font-weight:600">${esc(c.nombre)}</h2></a><div class="etq" style="margin-top:2px">${esc(c.institucion || 'Tarjeta de crédito')}</div>`}</div>
        ${estadoTag}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:${detalle ? '0' : '12px'}">
        <div><div class="etq">Saldo pendiente</div><div class="grande gasto" style="font-size:28px">${money(deuda)}</div></div>
        ${lim ? `<div style="text-align:right" class="etq">Disponible<br><strong style="font-size:15px;color:var(--tinta)">${money(lim - deuda)}</strong></div>` : ''}
      </div>
      ${lim ? `<div role="img" aria-label="${uso}% del límite usado" style="height:6px;margin-top:12px;border-radius:3px;background:var(--neutro-bg);overflow:hidden"><div style="width:${uso}%;height:100%;background:var(--marino)"></div></div>
        <div class="etq" style="font-size:12px;margin-top:6px">Límite ${money(lim)} · ${uso}% usado</div>` : ''}
      ${edo ? `<div class="grid2 sep" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div><div class="etq">${estimado ? 'Próximo corte' : 'Último corte'}</div><div style="font-weight:600;margin-top:2px">${esc(fechaCorta(edo.corte))}</div></div>
        <div><div class="etq">Pagar antes del</div><div style="font-weight:600;margin-top:2px">${esc(fechaCorta(edo.limite))}</div></div>
        <div><div class="etq">Sin intereses</div><div style="font-weight:600;margin-top:2px">${money(edo.falta)}</div></div>
      </div>
      <p class="nota" style="margin:10px 0 0">${estimado ? `Estimado con lo registrado hasta hoy (${money(edo.deudaCorte)}). Se ajusta al llegar el corte.` : `Al corte debías ${money(edo.deudaCorte)}${edo.pagado > 0 ? `; ya pagaste ${money(edo.pagado)}` : ''}. Próximo corte: ${esc(fechaCorta(prox))}.`}</p>`
      : `<p class="nota sep" style="margin-bottom:0">Agrega el día de corte para calcular cuánto pagar y recibir avisos. <a href="#/cuenta-form/${encodeURIComponent(c.id)}" style="font-weight:600">Editar tarjeta</a></p>`}
    </div>
    <div style="border-top:1px solid var(--linea-2)">
      <div class="panel-cab" style="padding-top:12px"><h2 style="font-size:13px">¿De quién es este saldo?</h2></div>
      <div class="fila"><span class="grow">Mis gastos</span><span class="imp">${money(Math.max(0, deuda - deTerceros))}</span></div>
      ${terceros.map(({ i, pid }) => `<a class="fila" href="#/persona/${encodeURIComponent(pid)}"><span class="grow"><span class="t" style="display:block">${esc(nomPersona(pid))}</span><span class="s" style="display:block">${esc(conceptoMov(i.mov))}${i.mov.msi ? ' · ' + esc(i.mov.msi) + ' MSI' : ''}</span></span><span class="imp">${money(i.pendiente)}</span></a>`).join('')}
    </div>
    ${detalle && edo && edo.msi.length ? `<div style="border-top:1px solid var(--linea-2)"><div class="panel-cab" style="padding-top:12px"><h2 style="font-size:13px">Meses sin intereses</h2></div>
      ${edo.msi.map((x) => `<div class="fila"><span class="grow"><span class="t" style="display:block">${esc(conceptoMov(x.mov))}</span><span class="s" style="display:block">Mensualidad ${x.k} de ${x.n} · ${money(x.mensualidad)}</span></span><span class="imp">${money(x.pendiente)}</span></div>`).join('')}</div>` : ''}
    ${detalle && c.diaCorte ? `<p class="nota" style="margin:0;padding:12px 16px 14px;border-top:1px solid var(--linea-2)">Avisos: ${(c.avisos || [5, 3, 1]).length ? esc((c.avisos || [5, 3, 1]).map((n) => (n ? n + (n === 1 ? ' día' : ' días') : 'el mismo día')).join(', ')) + ' antes del pago' : 'sin avisos de pago'}${c.avisoCorte !== false ? ' · el día de corte' : ''}. Se quitan solos al registrar el pago.</p>` : ''}
  </section>`;
}

function vTarjetas() {
  const t = S.cuentas.filter((c) => c.activa !== false && c.tipo === 'credito');
  const lim = t.reduce((a, c) => a + (Number(c.limite) || 0), 0);
  return `
  ${tope('Tarjetas de crédito', 'Saldo total ' + money(S.R.tarjetas) + (lim ? ' · disponible ' + money(lim - S.R.tarjetas) : ''), '<a class="btn pri" href="#/cuenta-form?tipo=credito">+ Agregar</a>')}
  <div class="acciones"><a class="btn" href="#/registrar?tipo=pago_tarjeta" style="grid-column:1/-1">Registrar pago de tarjeta</a></div>
  ${t.length ? `<div class="cols">${t.map((c) => panelTarjeta(c)).join('')}</div>` : '<section class="panel"><div class="vacio">Aún no agregas tarjetas.</div></section>'}`;
}

// ---------------------------------------------------------------- Pagos y recordatorios
function vPagos() {
  const mes = S.mesCal || hoy().slice(0, 7);
  const ini = mes + '-01';
  const fin = L.sumarDias(L.sumarMeses(ini, 1, 1), -1);
  const delMes = agendaEntre(ini, fin).filter((a) => a.fecha >= ini);
  const marcas = {};
  for (const a of delMes) {
    const d = Number(a.fecha.slice(8, 10));
    const color = a.tipo === 'cobro' ? 'var(--verde)' : a.tipo === 'corte' ? 'var(--gris)' : 'var(--rojo)';
    if (!marcas[d] || color === 'var(--rojo)') marcas[d] = color;
  }
  const primero = new Date(ini + 'T00:00:00').getDay();
  const blancos = (primero + 6) % 7;
  const dias = Number(fin.slice(8, 10));
  const hoyD = hoy().slice(0, 7) === mes ? Number(hoy().slice(8, 10)) : -1;
  let celdas = '';
  for (let i = 0; i < blancos; i++) celdas += '<span></span>';
  for (let d = 1; d <= dias; d++) {
    celdas += `<span style="height:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px">
      <span style="width:30px;height:26px;line-height:26px;border-radius:8px;font-size:13.5px;${d === hoyD ? 'background:var(--marino);color:#fff;font-weight:600' : ''}">${d}</span>
      <span style="width:5px;height:5px;border-radius:50%;background:${marcas[d] || 'transparent'}"></span></span>`;
  }
  const lista = agendaEntre(hoy(), L.sumarDias(hoy(), 45)).filter((a) => !(a.hecho && a.fecha < hoy()));
  const atrasados = lista.filter((a) => a.fecha < hoy());
  const proximos = lista.filter((a) => a.fecha >= hoy());
  return `
  ${tope('Pagos y recordatorios', '', `<a class="btn pri" href="#/recordatorio-form" aria-label="Nuevo recordatorio">${icon('plus', 18, 2.2)}Nuevo</a>`)}
  <section class="panel panel-pad" aria-labelledby="h-cal" style="padding:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <button type="button" class="btn link" data-act="cal-mes" data-v="-1" aria-label="Mes anterior">${icon('atras', 18, 2)}</button>
      <h2 id="h-cal" style="margin:0;font-size:15px;font-weight:600;text-transform:capitalize">${esc(mesNombre(ini))}</h2>
      <button type="button" class="btn link" data-act="cal-mes" data-v="1" aria-label="Mes siguiente">${icon('sig', 18, 2)}</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;font-size:11.5px;color:var(--gris);margin-bottom:4px"><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
    <div style="display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:4px;text-align:center">${celdas}</div>
    <div class="nota" style="display:flex;gap:14px;margin:8px 4px 0">
      <span style="display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:var(--rojo)"></span>Pagas</span>
      <span style="display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:var(--verde)"></span>Te pagan</span>
      <span style="display:flex;align-items:center;gap:5px"><span style="width:7px;height:7px;border-radius:50%;background:var(--gris)"></span>Corte</span>
    </div>
  </section>
  ${atrasados.length ? `<section class="panel" aria-label="Atrasados"><div class="panel-cab"><h2>Atrasados</h2></div>${atrasados.map(filaAgendaAccion).join('')}</section>` : ''}
  <section class="panel" aria-label="Próximos 45 días"><div class="panel-cab"><h2>Próximos 45 días</h2></div>
    ${proximos.length ? proximos.map(filaAgendaAccion).join('') : '<div class="vacio">Sin pagos ni cobros próximos.</div>'}</section>
  <p class="nota">Los avisos aparecen en Inicio al abrir la app. Los avisos en el celular y en Windows con la app cerrada llegarán con Google Calendar en la fase 4.</p>`;
}

function filaAgendaAccion(a) {
  if (a.recId && !a.hecho) return filaAgenda(a) + `<div style="padding:0 16px 10px;margin-top:-6px;text-align:right"><button type="button" class="btn link" data-act="rec-hecho" data-id="${esc(a.recId)}" data-f="${esc(a.fecha)}">Marcar como hecho</button></div>`;
  if (a.tipo === 'pago' && a.cuentaId && !a.hecho) return filaAgenda(a) + `<div style="padding:0 16px 10px;margin-top:-6px;text-align:right"><a class="btn link" href="#/registrar?tipo=pago_tarjeta&destino=${encodeURIComponent(a.cuentaId)}">Registrar pago</a></div>`;
  return filaAgenda(a);
}

function vRecordatorioForm(r) {
  const rec = r.id ? S.recs.find((x) => x.id === r.id) : null;
  const av = (rec && rec.avisos) || [1, 0];
  return `
  ${volver('#/pagos', 'Pagos')}
  <h1 style="margin:-6px 0 0;font-size:22px;font-weight:600">${rec ? 'Editar recordatorio' : 'Nuevo recordatorio'}</h1>
  <form class="form" data-form="recordatorio" data-id="${esc(rec ? rec.id : '')}" novalidate>
    <label class="campo">¿Qué es?<input name="titulo" value="${esc(rec ? rec.titulo : '')}" placeholder="Ej. Renta, Internet, cobrarle a Diego" required autocomplete="off" ${rec ? '' : 'autofocus'}></label>
    <div class="grid2">
      <label class="campo">Tipo<select name="tipo"><option value="pago" ${!rec || rec.tipo !== 'cobro' ? 'selected' : ''}>Pago</option><option value="cobro" ${rec && rec.tipo === 'cobro' ? 'selected' : ''}>Cobro</option></select></label>
      <label class="campo">Importe (opcional)<input name="importe" inputmode="decimal" value="${esc(rec && rec.importe ? String(rec.importe) : '')}" placeholder="$0" autocomplete="off"></label>
      <label class="campo">Fecha<input type="date" name="fecha" value="${esc(rec ? rec.fecha : hoy())}"></label>
      <label class="campo">Se repite<select name="repetir"><option value="no">Una sola vez</option><option value="mensual" ${rec && rec.repetir === 'mensual' ? 'selected' : ''}>Cada mes</option></select></label>
    </div>
    <fieldset style="border:0;margin:0;padding:0"><legend class="etq" style="padding:0;margin-bottom:8px">Avisarme</legend><div class="chips wrap">
      ${[[5, '5 días antes'], [3, '3 días antes'], [1, '1 día antes'], [0, 'El mismo día']].map(([n, l]) => `<label class="chip ${av.includes(n) ? 'on' : ''}" style="cursor:pointer"><input type="checkbox" name="aviso${n}" ${av.includes(n) ? 'checked' : ''} class="sr" data-act="chip-check">${l}</label>`).join('')}</div></fieldset>
    <div id="f-error"></div>
    <button type="submit" class="btn pri bloque">${rec ? 'Guardar cambios' : 'Agregar recordatorio'}</button>
    ${rec ? `<button type="button" class="btn peligro" data-act="borrar-rec" data-id="${esc(rec.id)}">Borrar recordatorio</button>` : ''}
  </form>`;
}

async function guardarRecordatorio(form) {
  const fd = Object.fromEntries(new FormData(form).entries());
  const titulo = (fd.titulo || '').trim();
  if (!titulo || !fd.fecha) { $('#f-error').innerHTML = '<div class="error" role="alert">Escribe qué es y elige la fecha.</div>'; return; }
  const id = form.dataset.id;
  const previo = id ? S.recs.find((x) => x.id === id) : {};
  await db.put('recordatorios', { ...previo, titulo, tipo: fd.tipo, importe: parseImporte(fd.importe) || null, fecha: fd.fecha, repetir: fd.repetir,
    avisos: [5, 3, 1, 0].filter((n) => fd['aviso' + n] === 'on'), hechos: (previo && previo.hechos) || [] });
  await cargar();
  toast(id ? 'Recordatorio actualizado' : 'Recordatorio agregado');
  ir('#/pagos');
}

// ---------------------------------------------------------------- Cuentas de confianza
function estadoConfianza(p, r) {
  if (p.estadoConfianza === 'plan') return ['parc', 'Plan acordado'];
  if (p.estadoConfianza === 'abonando') return ['ok', 'Abonando a su ritmo'];
  if (r.ultimoAbono && diasHasta(r.ultimoAbono) >= -183) return ['ok', 'Abonando a su ritmo'];
  return ['', 'Sin plazo'];
}

function vConfianza() {
  const R = S.R.personas;
  const lista = S.personas.filter((p) => p.confianza).sort((a, b) => (R[a.id].desde || '9').localeCompare(R[b.id].desde || '9'));
  const regresado = lista.reduce((a, p) => a + R[p.id].movimientos.filter((m) => m.tipo === 'pago_recibido').reduce((x, m) => x + Number(m.importe), 0), 0);
  const antiguo = lista.find((p) => R[p.id].desde);
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Cuentas de confianza')}
  <p style="margin:-6px 0 0;font-size:14px;line-height:1.5;color:var(--tinta-2)">Apoyos a personas cercanas, sin plazo. Aquí no hay fechas vencidas ni recordatorios de cobro.</p>
  <section class="panel panel-pad" aria-label="Resumen">
    <div class="etq">Saldo en confianza</div>
    <div class="grande" style="color:#1F3D6B;font-size:30px">${money(S.R.confianza)}</div>
    <div class="grid2 sep" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div><div class="etq">Personas</div><div class="medio">${lista.length}</div></div>
      <div><div class="etq">Regresado</div><div class="medio">${money(regresado)}</div></div>
      <div><div class="etq">Más antiguo</div><div style="font-weight:600;margin-top:4px">${antiguo ? esc(fechaLarga(R[antiguo.id].desde).split(' ').slice(1).join(' ')) : '—'}</div></div>
    </div>
    <label class="check sep" style="margin-bottom:-10px"><input type="checkbox" data-act="incluir-confianza" ${S.ajustes.incluirConfianza ? 'checked' : ''}>Incluir en patrimonio estimado</label>
    <p class="nota" style="margin:8px 0 0">No se suma a "Me deben" ni a tu dinero disponible.</p>
  </section>
  <section class="panel" aria-label="Personas en confianza"><div class="panel-cab"><h2>Personas</h2></div>
    ${lista.length ? lista.map((p) => {
      const r = R[p.id];
      const [cls, txt] = estadoConfianza(p, r);
      const n = r.cobros.filter((i) => i.pendiente > 0).length;
      return `<a class="fila" href="#/persona/${encodeURIComponent(p.id)}"><span class="grow"><span class="t" style="display:block">${esc(p.nombre)}${p.relacion ? ` <span style="font-weight:400;color:var(--gris)">· ${esc(p.relacion)}</span>` : ''}</span>
        <span class="s" style="display:block">${r.desde ? 'Desde ' + esc(fechaLarga(r.desde).split(' ').slice(1).join(' ')) + ' · ' : ''}${n} ${n === 1 ? 'saldo' : 'saldos'}${r.ultimoAbono ? ' · último abono ' + esc(fechaCorta(r.ultimoAbono)) : ''}</span>
        <span style="display:block;margin-top:5px"><span class="tag ${cls}">${txt}</span></span></span><span class="imp">${money(r.pendPrestamos + r.pendCompras)}</span></a>`;
    }).join('') : '<div class="vacio">Aún no hay nadie aquí. Desde la ficha de una persona que te debe, elige <strong>Mover a cuentas de confianza</strong>.</div>'}
  </section>
  <section class="panel panel-pad" aria-label="Cómo funciona">
    <h2 style="margin:0 0 8px;font-size:15px">Cómo funciona</h2>
    <ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.55;color:var(--tinta-2)">
      <li>Nunca aparece como atrasado ni en rojo.</li>
      <li>Cada préstamo o compra conserva su cuenta de origen, fecha y notas.</li>
      <li>Cuando llegue un abono, regístralo como "Pago recibido"; sube el estado a "Abonando a su ritmo".</li>
      <li>Desde la ficha de cada persona puedes marcar su estado, regresarla a "Me deben" o convertir el saldo en regalo.</li>
    </ul>
  </section>`;
}

// ---------------------------------------------------------------- Deudas personales
function vDeudas() {
  const tab = S.tabDeudas;
  const R = S.R.personas;
  const personas = S.personas.filter((p) => R[p.id].yoDebo > 0.009);
  const creditos = S.cuentas.filter((c) => c.activa !== false && c.tipo === 'credito_formal');
  const ag = agendaEntre(L.sumarDias(hoy(), -40), L.sumarDias(hoy(), 45));
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Deudas personales')}
  <p style="margin:-6px 0 0;font-size:14px;color:var(--tinta-2)">Lo que tú debes. Pagarlo no cuenta como gasto.</p>
  <section class="panel panel-pad" aria-label="Resumen" style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px">
    <div><div class="etq">Yo debo</div><div class="grande ${S.R.yoDebo > 0 ? 'gasto' : ''}" style="font-size:30px">${money(S.R.yoDebo)}</div></div>
    <div class="etq" style="text-align:right">Personas ${money(S.R.yoDeboPersonas)}<br>Créditos ${money(S.R.creditos)}</div>
  </section>
  <div role="tablist" aria-label="Tipo de deuda" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));padding:4px;background:#E8EBF0;border-radius:10px">
    <button type="button" role="tab" aria-selected="${tab === 'personas'}" data-act="tab-deudas" data-v="personas" style="height:40px;border:0;border-radius:8px;background:${tab === 'personas' ? '#fff' : 'transparent'};font-weight:${tab === 'personas' ? 600 : 400}">Con personas</button>
    <button type="button" role="tab" aria-selected="${tab === 'creditos'}" data-act="tab-deudas" data-v="creditos" style="height:40px;border:0;border-radius:8px;background:${tab === 'creditos' ? '#fff' : 'transparent'};font-weight:${tab === 'creditos' ? 600 : 400}">Créditos formales</button>
  </div>
  ${tab === 'personas' ? `
    ${personas.length ? personas.map((p) => {
      const r = R[p.id];
      return `<section class="panel"><div class="panel-cab"><h2><a href="#/persona/${encodeURIComponent(p.id)}" style="color:inherit">${esc(p.nombre)}</a></h2><strong class="gasto">${money(r.yoDebo)}</strong></div>
        ${r.deudas.filter((i) => i.pendiente > 0).map((i) => `<button type="button" class="fila" data-act="ver-mov" data-id="${esc(i.mov.id)}"><span class="fecha">${esc(fechaCorta(i.mov.fecha))}</span>
          <span class="grow"><span class="t" style="display:block">${esc(i.mov.concepto || i.mov.notas || 'Me prestó')}</span><span class="s" style="display:block">${money(i.monto)}${i.pagado ? ' · pagado ' + money(i.pagado) : ''}${i.mov.fechaAcordada ? ' · acordado ' + esc(fechaCorta(i.mov.fechaAcordada)) : ''}</span>
          ${i.mov.fechaAcordada ? `<span style="display:block;margin-top:3px">${tagDias(i.mov.fechaAcordada, false)}</span>` : ''}</span><span class="imp gasto">${money(i.pendiente)}</span></button>`).join('')}
        <div style="padding:8px 16px 16px"><a class="btn pri" style="width:100%" href="#/registrar?tipo=pago_deuda&persona=${encodeURIComponent(p.id)}">Registrar pago</a></div></section>`;
    }).join('') : '<section class="panel"><div class="vacio">No le debes a nadie.</div></section>'}
    <a class="btn bloque" href="#/registrar?tipo=deuda" style="border-style:dashed;color:var(--azul)">+ Registrar que alguien me prestó</a>`
  : `
    ${creditos.length ? creditos.map((c) => {
      const deuda = -(S.R.saldos[c.id] || 0);
      const sig = ag.find((a) => a.cuentaId === c.id && !a.hecho);
      return `<section class="panel"><a class="panel-cab" href="#/cuenta/${encodeURIComponent(c.id)}" style="color:inherit"><h2>${esc(c.nombre)}</h2><strong class="gasto">${money(deuda)}</strong></a>
        <div class="fila"><span class="grow etq">${c.mensualidad ? 'Mensualidad ' + money(c.mensualidad) : 'Sin mensualidad registrada'}${c.diaPago ? ' · día ' + esc(c.diaPago) : ''}</span>${sig ? tagDias(sig.fecha, false) : ''}</div>
        <div style="padding:8px 16px 16px"><a class="btn pri" style="width:100%" href="#/registrar?tipo=pago_tarjeta&destino=${encodeURIComponent(c.id)}">Registrar pago</a></div></section>`;
    }).join('') : '<section class="panel panel-pad" style="text-align:center"><h2 style="margin:0;font-size:16px">Sin créditos registrados</h2><p class="nota" style="font-size:13.5px">Registra un préstamo bancario, crédito de auto, Infonavit o tienda departamental. Lleva el saldo, tus mensualidades y te avisa cada pago.</p></section>'}
    <a class="btn pri bloque" href="#/cuenta-form?tipo=credito_formal">+ Agregar crédito</a>`}`;
}

// ---------------------------------------------------------------- Gastos del mes
function vGastos() {
  const mes = S.mesGastos || hoy().slice(0, 7);
  const prev = L.sumarMeses(mes + '-01', -1, 1).slice(0, 7);
  const g = L.gastosMes(S.movs, mes), gp = L.gastosMes(S.movs, prev);
  const prevPor = Object.fromEntries(gp.categorias.map((c) => [c.categoria, c.total]));
  const max = Math.max(1, ...g.categorias.map((c) => c.total));
  const dif = g.total - gp.total;
  const nPrev = mesNombre(prev + '-01').split(' ')[0];
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Gastos del mes')}
  <div class="panel" style="display:flex;align-items:center;justify-content:space-between;padding:4px">
    <button type="button" class="btn link" data-act="gastos-mes" data-v="-1" aria-label="Mes anterior">${icon('atras', 18, 2)}</button>
    <strong style="text-transform:capitalize">${esc(mesNombre(mes + '-01'))}</strong>
    <button type="button" class="btn link" data-act="gastos-mes" data-v="1" aria-label="Mes siguiente">${icon('sig', 18, 2)}</button>
  </div>
  <section class="panel panel-pad" aria-label="Total">
    <div class="etq">Llevas gastado</div>
    <div class="grande gasto" style="font-size:32px">${money(g.total)}</div>
    <div class="etq" style="margin-top:4px;text-transform:none"><span style="text-transform:capitalize">${esc(nPrev)}</span>: ${money(gp.total)}${gp.total ? ` · <strong style="color:var(--tinta);font-weight:500">${money(Math.abs(dif))} ${dif > 0 ? 'más' : dif < 0 ? 'menos' : 'igual'}</strong>` : ''}</div>
    <div class="etq" style="margin-top:4px">Ingresos del mes: <span class="ingreso" style="font-weight:600">${money(g.ingresos)}</span></div>
    <p class="nota sep" style="margin-bottom:0">Solo gastos reales. No incluye préstamos, compras para terceros, transferencias ni pagos de tarjeta.</p>
  </section>
  <section class="panel" aria-label="Por categoría"><div class="panel-cab"><h2>Por categoría</h2></div>
    ${g.categorias.length ? g.categorias.map((c) => {
      const abierta = S.catAbierta === c.categoria;
      const p = prevPor[c.categoria] || 0;
      const d = c.total - p;
      return `<button type="button" class="fila" data-act="gasto-cat" data-v="${esc(c.categoria)}" aria-expanded="${abierta}" style="display:block;${abierta ? 'background:#F7F9FB' : ''}">
        <span style="display:flex;justify-content:space-between"><span class="t">${esc(c.categoria)}</span><span class="imp">${money(c.total)}</span></span>
        <span style="display:block;height:6px;margin-top:8px;border-radius:3px;background:var(--neutro-bg);overflow:hidden"><span style="display:block;height:100%;width:${Math.round(c.total / max * 100)}%;background:var(--marino)"></span></span>
        <span class="s" style="display:block;margin-top:6px"><span style="text-transform:capitalize">${esc(nPrev)}</span> ${money(p)} · ${d === 0 ? 'igual' : money(Math.abs(d)) + (d > 0 ? ' más' : ' menos')}</span></button>
        ${abierta ? `<div style="background:#F7F9FB">${c.movs.map((m) => filaMov(m)).join('')}</div>` : ''}`;
    }).join('') : '<div class="vacio">Sin gastos registrados este mes.</div>'}
  </section>`;
}

// ---------------------------------------------------------------- Seguridad
const SECCIONES_CANDADO = {
  confianza: 'Cuentas de confianza', deudas: 'Deudas personales', personas: 'Personas', tarjetas: 'Tarjetas de crédito',
  gastos: 'Gastos del mes', movimientos: 'Movimientos', cuentas: 'Cuentas y efectivo'
};

// ¿La sección está protegida y todavía no se abre en esta sesión?
function oculta(sec) {
  return Sg.tienePin() && !!Sg.seg.candados[sec] && !S.secciones.has(sec);
}

function vProtegida(sec) {
  return `${tope(SECCIONES_CANDADO[sec] || 'Sección protegida')}
  <section class="panel protegido">
    <div style="color:var(--marino);display:flex;justify-content:center">${iconCandado(28)}</div>
    <h2 style="margin:12px 0 6px;font-size:17px">Sección protegida</h2>
    <p class="nota" style="font-size:14px;margin:0 0 16px">Escribe tu PIN de secciones para ver esta información.</p>
    <button type="button" class="btn pri" data-act="abrir-seccion" data-v="${esc(sec)}">Desbloquear</button>
  </section>`;
}

function iconCandado(size = 16) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
}

async function abrirSeccion(sec) {
  const ok = sec === 'seguridad' ? await Sg.pedirPinActual('PIN para ajustes de seguridad') : await Sg.pedirPinSeccion(SECCIONES_CANDADO[sec] || '');
  if (ok === true) { S.secciones.add(sec); render(); }
}

function aplicarNombre(n) {
  const M = { notas: ['Notas', 'notas', '#F2C46B'], calculadora: ['Calculadora', 'calc', '#2B2F36'] };
  const c = M[n];
  document.title = c ? c[0] : 'Mis Finanzas 360';
  $('#ln-manifest').href = c ? 'manifest-' + c[1] + '.webmanifest' : 'manifest.webmanifest';
  $('#ln-icon').href = c ? 'icons/' + c[1] + '-192.png' : 'icons/icon-192.png';
  $('#ln-apple').href = c ? 'icons/' + c[1] + '-180.png' : 'icons/apple-touch-icon.png';
  $('#meta-apple-tit').content = c ? c[0] : 'Mis Finanzas';
  $('#meta-tema').content = c ? c[2] : '#13223F';
}

function vSeguridad() {
  const g = Sg.seg;
  const pin = Sg.tienePin();
  if (pin && !S.secciones.has('seguridad')) {
    return `${volver('#/mas', 'Más')}${tope('Seguridad')}
    <section class="panel protegido"><div style="color:var(--marino);display:flex;justify-content:center">${iconCandado(28)}</div>
      <h2 style="margin:12px 0 6px;font-size:17px">Confirma que eres tú</h2>
      <p class="nota" style="font-size:14px;margin:0 0 16px">Para cambiar la seguridad escribe tu PIN.</p>
      <button type="button" class="btn pri" data-act="abrir-seccion" data-v="seguridad">Escribir PIN</button></section>`;
  }
  const fila = (t, sub, der) => `<div class="fila" style="min-height:56px"><span class="grow"><span class="t" style="display:block;white-space:normal">${t}</span>${sub ? `<span class="s" style="display:block;white-space:normal">${sub}</span>` : ''}</span>${der}</div>`;
  const grupo = (t, html) => `<section style="display:flex;flex-direction:column;gap:6px"><h2 class="mini-tit" style="margin:0;padding:0 4px">${esc(t)}</h2><div class="panel">${html}</div></section>`;
  const sw = (act, on, label, dis = false) => `<input type="checkbox" role="switch" data-act="${act}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''} aria-label="${esc(label)}" style="width:22px;height:22px;accent-color:var(--marino)">`;
  const nombres = [['finanzas', 'Mis Finanzas', 'icon-192.png'], ['notas', 'Notas', 'notas-192.png'], ['calculadora', 'Calculadora', 'calc-192.png']];
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Seguridad')}
  ${grupo('Acceso',
    fila('PIN de acceso', pin ? `${g.pinLen} dígitos · se pide al abrir la app` : 'Sin PIN: cualquiera con tu celular puede abrir la app',
      pin ? '<button type="button" class="btn link" data-act="pin-cambiar">Cambiar</button><button type="button" class="btn link" style="color:var(--rojo)" data-act="pin-quitar">Quitar</button>'
        : '<button type="button" class="btn pri" data-act="pin-activar">Activar</button>') +
    (S.bioDisponible ? fila('Huella, Face ID o Windows Hello', pin ? 'Para entrar sin escribir el PIN' : 'Primero activa un PIN', sw('bio', !!g.bioId, 'Huella, Face ID o Windows Hello', !pin)) : '') +
    fila('Bloquear al salir de la app', 'Cuánto tiempo puede estar en segundo plano',
      `<select data-act="bloqueo-min" ${pin ? '' : 'disabled'} style="height:40px;border:1px solid var(--borde-input);border-radius:8px;background:#fff;padding:0 8px">
        ${[[0, 'De inmediato'], [1, '1 minuto'], [5, '5 minutos'], [15, '15 minutos']].map(([v, l]) => `<option value="${v}" ${Number(g.bloqueoMin) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`) +
    (pin ? `<div style="padding:12px 16px"><button type="button" class="btn" style="width:100%" data-act="bloquear">${iconCandado(16)}Bloquear ahora</button></div>` : ''))}

  ${grupo('Discreción',
    `<div class="panel-pad" style="padding-bottom:12px"><div class="t" style="font-size:14.5px;font-weight:500">Nombre e icono en el celular</div>
      <div role="radiogroup" aria-label="Nombre de la app" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px">
      ${nombres.map(([k, l, ic]) => `<button type="button" role="radio" aria-checked="${g.nombre === k}" data-act="nombre" data-v="${k}" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:10px;border:${g.nombre === k ? '1.5px solid var(--marino)' : '1px solid var(--borde-input)'};background:${g.nombre === k ? 'var(--sel-bg)' : '#fff'};font-size:12.5px;font-weight:${g.nombre === k ? 600 : 400}"><img src="icons/${ic}" alt="" width="40" height="40" style="border-radius:9px">${l}</button>`).join('')}</div>
      <p class="nota" style="margin:10px 0 0">Para que cambie en tu celular, reinstala la app. <strong>Antes descarga un respaldo</strong>: en iPhone, quitar la app borra sus datos.</p></div>` +
    fila('Entrada camuflada', g.codigoHash ? 'Abre como calculadora; tu código + "=" entra' : 'Abre como una calculadora que funciona; necesitas un código', sw('camuflaje', g.camuflaje, 'Entrada camuflada')) +
    fila('Código secreto', g.codigoHash ? 'Definido · no lo compartas ni uses tu PIN' : 'Sin definir', `<button type="button" class="btn link" data-act="codigo">${g.codigoHash ? 'Cambiar' : 'Definir'}</button>`) +
    fila('Ocultar montos en avisos', 'Para los avisos de Google Calendar (fase 4): solo dirán "Recordatorio"', sw('ocultar-montos', g.ocultarMontosAvisos, 'Ocultar montos en avisos')))}

  ${grupo('Segundo candado',
    `<p class="nota" style="margin:0;padding:12px 16px">Estas secciones piden un PIN otra vez aunque la app ya esté abierta. ${pin ? '' : '<strong>Primero activa un PIN de acceso.</strong>'}</p>` +
    fila('PIN de secciones', g.pin2Hash ? 'PIN aparte, distinto al de acceso' : 'Usa el mismo PIN de acceso',
      g.pin2Hash ? '<button type="button" class="btn link" data-act="pin2">Cambiar</button><button type="button" class="btn link" style="color:var(--rojo)" data-act="pin2-quitar">Quitar</button>'
        : `<button type="button" class="btn link" data-act="pin2" ${pin ? '' : 'disabled'}>Usar uno aparte</button>`) +
    Object.entries(SECCIONES_CANDADO).map(([k, l]) => `<label class="fila" style="cursor:pointer"><span class="grow t">${esc(l)}</span><input type="checkbox" data-act="candado" data-v="${k}" ${g.candados[k] ? 'checked' : ''} ${pin ? '' : 'disabled'} style="width:20px;height:20px;accent-color:var(--marino)"></label>`).join(''))}

  <section class="panel panel-pad"><h2 style="margin:0 0 6px;font-size:14px">Qué protege esto</h2>
    <p class="nota" style="margin:0">El PIN y la calculadora impiden que alguien abra la app y vea tu información. El cifrado completo de los datos llega en la fase 4 junto con la sincronización a Google Drive, con una clave larga solo tuya. Mantén también el bloqueo de pantalla de tu celular.</p></section>`;
}

async function pedirCodigo() {
  return new Promise((resolve) => {
    hoja(`<h2>Código secreto</h2>
      <p class="nota" style="font-size:14px;margin:0">En la calculadora escribe este código y presiona "=". Usa de 3 a 8 dígitos y que <strong>no</strong> sea tu PIN.</p>
      <form class="form" id="f-codigo" novalidate>
        <label class="campo">Código<input name="c1" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8"></label>
        <label class="campo">Repítelo<input name="c2" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8"></label>
        <div id="f-cod-err"></div>
        <div class="acciones"><button type="button" class="btn" data-r="0">Cancelar</button><button type="submit" class="btn pri">Guardar</button></div>
      </form>`);
    const f = $('#f-codigo');
    $('#velo').addEventListener('click', (e) => { if (e.target.closest('[data-r="0"]')) { cerrarHoja(); resolve(false); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const c1 = f.c1.value.trim(), c2 = f.c2.value.trim();
      const err = (m) => { $('#f-cod-err').innerHTML = `<div class="error" role="alert">${esc(m)}</div>`; };
      if (!/^[0-9]{3,8}$/.test(c1)) return err('Usa de 3 a 8 dígitos.');
      if (c1 !== c2) return err('Los códigos no coinciden.');
      if (Sg.tienePin() && await Sg.verificarPin(c1)) return err('No uses tu PIN como código.');
      await Sg.definirCodigo(c1);
      cerrarHoja(); resolve(true);
    });
  });
}

async function olvidePin() {
  const paso1 = await confirmar('¿Olvidaste tu PIN?', 'Por seguridad no hay forma de recuperarlo. Puedes borrar los datos de este dispositivo y después restaurarlos desde un respaldo descargado.', 'Continuar');
  if (!paso1) return false;
  return new Promise((resolve) => {
    hoja(`<h2>Borrar los datos de este dispositivo</h2>
      <p class="nota" style="font-size:14px;margin:0">Se borrarán cuentas, movimientos, personas y ajustes de este dispositivo. Escribe <strong>BORRAR</strong> para confirmar.</p>
      <form class="form" id="f-borrar" novalidate><label class="campo">Confirmación<input name="t" autocomplete="off" autocapitalize="characters"></label>
      <div class="acciones"><button type="button" class="btn" data-r="0">Cancelar</button><button type="submit" class="btn pri" style="background:var(--rojo);border-color:var(--rojo)">Borrar todo</button></div></form>`);
    $('#velo').addEventListener('click', (e) => { if (e.target.closest('[data-r="0"]')) { cerrarHoja(); resolve(false); } });
    $('#f-borrar').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.t.value.trim().toUpperCase() !== 'BORRAR') return;
      await db.borrarTodo();
      try { localStorage.removeItem('mf360-nombre'); } catch (err) { /* nada */ }
      cerrarHoja(); resolve(true);
    });
  });
}

// Secuencia completa de entrada: calculadora (si aplica) y PIN.
async function entrada() {
  S.bloqueado = true;
  S.secciones.clear();
  cerrarHoja();
  $('#nav').innerHTML = '';
  $('#main').innerHTML = '';
  document.body.classList.remove('privado');
  if (Sg.seg.camuflaje && Sg.seg.codigoHash) await Sg.pantallaCalculadora();
  while (Sg.tienePin()) {
    const r = await Sg.pantallaBloqueo();
    if (r === true) break;
    if (r === 'olvide' && await olvidePin()) { location.hash = '#/inicio'; location.reload(); return; }
  }
  S.bloqueado = false;
  render();
}

async function accionSeguridad(act, el) {
  const g = Sg.seg;
  if (act === 'pin-activar' || act === 'pin-cambiar') {
    const p = await Sg.capturarPinNuevo(act === 'pin-activar' ? 'Elige tu PIN' : 'Elige tu nuevo PIN');
    if (p) { await Sg.definirPin(p); S.secciones.add('seguridad'); toast(act === 'pin-activar' ? 'PIN activado' : 'PIN cambiado'); }
    render(); return;
  }
  if (act === 'pin-quitar') {
    if (await confirmar('¿Quitar el PIN?', 'También se desactivan la huella y el segundo candado. Cualquiera con tu celular podrá abrir la app.', 'Quitar')) {
      await Sg.guardarSeg({ pinHash: '', pinSalt: '', pinLen: 0, pin2Hash: '', pin2Salt: '', pin2Len: 0, bioId: '', candados: {} }); toast('PIN quitado');
    }
    render(); return;
  }
  if (act === 'pin2') { const p = await Sg.capturarPinNuevo('PIN de secciones'); if (p) { await Sg.definirPin2(p); toast('PIN de secciones guardado'); } render(); return; }
  if (act === 'pin2-quitar') { await Sg.guardarSeg({ pin2Hash: '', pin2Salt: '', pin2Len: 0 }); toast('Se usará tu PIN de acceso'); render(); return; }
  if (act === 'bio') {
    if (el.checked) {
      try { await Sg.activarBiometria(); toast('Listo: puedes entrar con huella'); } catch (e) { el.checked = false; toast('No se pudo activar en este dispositivo'); }
    } else { await Sg.guardarSeg({ bioId: '' }); toast('Huella desactivada'); }
    render(); return;
  }
  if (act === 'bloqueo-min') { await Sg.guardarSeg({ bloqueoMin: Number(el.value) }); toast('Guardado'); return; }
  if (act === 'bloquear') { await entrada(); return; }
  if (act === 'nombre') { await Sg.guardarSeg({ nombre: el.dataset.v }); aplicarNombre(el.dataset.v); toast('Nombre e icono actualizados'); render(); return; }
  if (act === 'codigo') { if (await pedirCodigo()) toast('Código guardado'); render(); return; }
  if (act === 'camuflaje') {
    if (el.checked && !g.codigoHash) { const ok = await pedirCodigo(); if (!ok) { render(); return; } }
    await Sg.guardarSeg({ camuflaje: el.checked });
    toast(el.checked ? 'La app abrirá como calculadora' : 'Entrada camuflada desactivada'); render(); return;
  }
  if (act === 'ocultar-montos') { await Sg.guardarSeg({ ocultarMontosAvisos: el.checked }); return; }
  if (act === 'candado') { await Sg.guardarSeg({ candados: { ...g.candados, [el.dataset.v]: el.checked } }); if (el.checked) S.secciones.delete(el.dataset.v); return; }
}

// ---------------------------------------------------------------- Sincronización con Google Drive
function hace(iso) {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return fechaLarga(iso.slice(0, 10));
}

function chipSync() {
  const e = Sy.estado();
  if (!e.configurado) return `<a href="#/sync" class="chip" style="min-height:36px;font-size:12.5px;color:var(--ambar-tx);border-color:#F1D9B0;background:var(--ambar-bg)">Activar respaldo</a>`;
  let color = 'var(--verde)', txt = 'Sincronizado';
  if (e.sincronizando) { color = 'var(--gris)'; txt = 'Sincronizando…'; }
  else if (e.sinRed) { color = 'var(--gris)'; txt = 'Sin conexión'; }
  else if (e.error) { color = 'var(--ambar-tx)'; txt = 'Revisar respaldo'; }
  else if (e.pendiente) { color = 'var(--gris)'; txt = 'Por subir'; }
  return `<a href="#/sync" style="display:flex;align-items:center;gap:6px;min-height:44px;font-size:12.5px;color:${color}">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3"/><path d="M4 12a8 8 0 0 1 14-5.3"/><polyline points="18 3 18 7 14 7"/><polyline points="6 21 6 17 10 17"/></svg>${txt}</a>`;
}

function nombreDispositivo() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Celular Android';
  if (/Windows/.test(ua)) return 'Laptop Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Dispositivo';
}

function vSync() {
  const e = Sy.estado();
  if (!e.enlazado) {
    return `
    ${volver('#/mas', 'Más')}
    ${tope('Respaldo en Google Drive')}
    <section class="panel panel-pad">
      <p style="margin:0;font-size:14.5px;line-height:1.5">Cada cambio se guarda solo y <strong>cifrado</strong> en tu Drive. Si pierdes o te roban el celular, instalas la app en otro, la conectas y recuperas todo.</p>
      <p class="nota" style="margin:10px 0 0">Se hace una sola vez: crear un pequeño script en tu cuenta de Google (10 minutos). Los pasos completos vienen en el archivo README.</p>
    </section>
    <details class="panel panel-pad">
      <summary style="font-weight:600;cursor:pointer;min-height:24px">Pasos para crear tu script</summary>
      <ol style="margin:12px 0 0;padding-left:20px;font-size:13.5px;line-height:1.6;color:var(--tinta-2)">
        <li>En la laptop entra a <strong>script.google.com</strong> → <em>Proyecto nuevo</em>.</li>
        <li>Borra lo que aparece y pega el contenido de <strong>apps-script/Code.gs</strong>. Guarda.</li>
        <li>Arriba elige la función <strong>configurar</strong> → <em>Ejecutar</em> → autoriza con tu cuenta. En el registro aparece tu <strong>código de enlace</strong>.</li>
        <li><em>Implementar → Nueva implementación →</em> tipo <strong>Aplicación web</strong>. Ejecutar como: <strong>Yo</strong>. Quién tiene acceso: <strong>Cualquier usuario</strong>. <em>Implementar</em>.</li>
        <li>Copia la <strong>URL de la aplicación web</strong> (termina en /exec) y pégala aquí con tu código.</li>
      </ol>
    </details>
    <form class="form" data-form="sync-enlazar" novalidate>
      <label class="campo">URL de la aplicación web<input name="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></label>
      <label class="campo">Código de enlace<input name="codigo" autocomplete="off" autocapitalize="characters" placeholder="ABCD-EFGH-JKLM"></label>
      <label class="campo">Nombre de este dispositivo<input name="nombre" value="${esc(nombreDispositivo())}" autocomplete="off"></label>
      <div id="f-error"></div>
      <button type="submit" class="btn pri bloque">Conectar</button>
    </form>`;
  }
  if (!e.configurado) {
    const crear = S.syncPaso && !S.syncPaso.hayDatos;
    const usar = S.syncPaso && S.syncPaso.hayDatos;
    return `
    ${volver('#/mas', 'Más')}
    ${tope('Respaldo en Google Drive')}
    ${!S.syncPaso ? `<section class="panel"><div class="vacio">Revisando tu Drive…</div></section>` : ''}
    ${crear ? `<section class="panel panel-pad">
        <h2 style="margin:0;font-size:16px">Crea tu clave de cifrado</h2>
        <p class="nota" style="font-size:14px;margin:6px 0 0">Con ella se cifran tus datos antes de subirlos. La pedirá cada dispositivo que conectes. Usa una frase fácil de recordar para ti, por ejemplo cuatro palabras.</p>
      </section>
      <form class="form" data-form="sync-crear" novalidate>
        <label class="campo">Clave (mínimo 10 caracteres)<input type="password" name="f1" autocomplete="new-password"></label>
        <label class="campo">Repítela<input type="password" name="f2" autocomplete="new-password"></label>
        <label class="check" style="align-items:flex-start;min-height:0"><input type="checkbox" name="entiendo" style="margin-top:2px">Entiendo que si olvido esta clave, nadie puede abrir mis datos de Drive.</label>
        <div id="f-error"></div>
        <button type="submit" class="btn pri bloque">Cifrar y subir mis datos</button>
      </form>` : ''}
    ${usar ? `<section class="panel panel-pad">
        <h2 style="margin:0;font-size:16px">Ya tienes datos en Drive</h2>
        <p class="nota" style="font-size:14px;margin:6px 0 0">Escribe tu clave de cifrado. Lo que haya en este dispositivo se combinará con lo de Drive sin perder nada.</p>
      </section>
      <form class="form" data-form="sync-usar" novalidate>
        <label class="campo">Clave de cifrado<input type="password" name="f1" autocomplete="current-password"></label>
        <div id="f-error"></div>
        <button type="submit" class="btn pri bloque">Abrir y combinar</button>
      </form>` : ''}
    <button type="button" class="btn bloque" data-act="sync-salir">Cancelar y desconectar</button>`;
  }
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Respaldo en Google Drive')}
  <section class="panel panel-pad">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="width:10px;height:10px;border-radius:50%;background:${e.error && !e.sinRed ? 'var(--ambar-tx)' : e.sinRed || e.pendiente ? 'var(--gris-claro)' : 'var(--verde)'}"></span>
      <div class="grow"><div style="font-weight:600">${e.sincronizando ? 'Sincronizando…' : e.sinRed ? 'Sin conexión' : e.error ? 'No se pudo sincronizar' : e.pendiente ? 'Hay cambios por subir' : 'Todo está respaldado'}</div>
        <div class="etq" style="margin-top:2px">Última sincronización: ${esc(hace(e.ultima))} · ${esc(e.nombre)}</div></div>
    </div>
    ${e.error ? `<p class="nota" style="margin:10px 0 0;color:${e.sinRed ? 'var(--gris)' : 'var(--ambar-tx)'}">${esc(e.error)}</p>` : ''}
    <button type="button" class="btn pri bloque" style="margin-top:14px" data-act="sync-ahora" ${e.sincronizando ? 'disabled' : ''}>Sincronizar ahora</button>
    <p class="nota" style="margin:10px 0 0">Se sincroniza solo al abrir la app, unos segundos después de cada cambio y cada 5 minutos. Los datos viajan y se guardan cifrados con tu clave.</p>
  </section>
  <section class="panel" aria-labelledby="h-disp"><div class="panel-cab"><h2 id="h-disp">Dispositivos conectados</h2></div><div id="sync-disp"><div class="vacio">Cargando…</div></div>
    <p class="nota" style="margin:0;padding:10px 16px 14px;border-top:1px solid var(--linea-2)">Si pierdes o te roban un dispositivo, desconéctalo aquí. La próxima vez que se conecte a internet con la app abierta, borrará sus datos.</p></section>
  <section class="panel" aria-labelledby="h-copias"><div class="panel-cab"><h2 id="h-copias">Copias diarias en Drive</h2></div><div id="sync-copias"><div class="vacio">Cargando…</div></div></section>
  <button type="button" class="btn bloque" data-act="sync-salir">Desconectar este dispositivo</button>
  <p class="nota">Desconectar deja de sincronizar este dispositivo, pero conserva sus datos aquí.</p>`;
}

async function cargarListasSync() {
  if (ruta().name !== 'sync' || !Sy.estado().configurado) return;
  try {
    const d = await Sy.dispositivos();
    const box = $('#sync-disp');
    if (box) box.innerHTML = d.map((x) => `<div class="fila"><span class="grow"><span class="t" style="display:block">${esc(x.nombre)}${x.yo ? ' <span class="tag ok">Este</span>' : ''}</span><span class="s" style="display:block">Última vez ${esc(hace(x.ultimo))}</span></span>
      ${x.yo ? '' : `<button type="button" class="btn peligro" style="min-height:36px;font-size:13px" data-act="sync-desconectar" data-id="${esc(x.id)}" data-n="${esc(x.nombre)}">Desconectar</button>`}</div>`).join('') || '<div class="vacio">Sin dispositivos.</div>';
  } catch (err) { const box = $('#sync-disp'); if (box) box.innerHTML = `<div class="vacio">${esc(err.message)}</div>`; }
  try {
    const c = await Sy.copias();
    const box = $('#sync-copias');
    if (box) box.innerHTML = c.slice(0, 15).map((x) => `<div class="fila"><span class="grow t">${esc(fechaLarga(x.nombre.replace('copia-', '').replace('.dat', '')))}</span><button type="button" class="btn link" data-act="sync-restaurar" data-id="${esc(x.id)}" data-n="${esc(x.nombre)}">Restaurar</button></div>`).join('') || '<div class="vacio">Aún no hay copias.</div>';
  } catch (err) { const box = $('#sync-copias'); if (box) box.innerHTML = `<div class="vacio">${esc(err.message)}</div>`; }
}

async function prepararPasoSync() {
  if (ruta().name !== 'sync') return;
  const e = Sy.estado();
  if (e.enlazado && !e.configurado && !S.syncPaso) {
    try { S.syncPaso = await Sy.infoRemota(); } catch (err) { S.syncPaso = null; toast(err.message); return; }
    render();
  }
}

async function formSync(f, form) {
  const fd = Object.fromEntries(new FormData(form).entries());
  const err = (m) => { $('#f-error').innerHTML = `<div class="error" role="alert">${esc(m)}</div>`; };
  const btn = form.querySelector('button[type=submit]');
  const txt = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un momento…';
  try {
    if (f === 'sync-enlazar') {
      if (!fd.codigo.trim()) { err('Escribe tu código de enlace.'); return; }
      S.syncPaso = await Sy.enlazar(fd.url, fd.codigo, (fd.nombre || nombreDispositivo()).trim());
      render(); return;
    }
    if (f === 'sync-crear') {
      if ((fd.f1 || '').length < 10) { err('Usa al menos 10 caracteres.'); return; }
      if (fd.f1 !== fd.f2) { err('Las claves no coinciden.'); return; }
      if (fd.entiendo !== 'on') { err('Marca la casilla para confirmar.'); return; }
      const ok = await Sy.crearClave(fd.f1);
      S.syncPaso = null; render();
      toast(ok ? 'Tus datos ya están cifrados en Drive' : 'Clave guardada; se subirá al reconectar');
      return;
    }
    if (f === 'sync-usar') {
      await Sy.usarClave(fd.f1, S.syncPaso.salt, S.syncPaso.iter);
      S.syncPaso = null; await cargar(); render(); toast('Datos combinados con Drive');
    }
  } catch (e) {
    err(e.message);
  } finally {
    if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = txt; }
  }
}

async function accionSync(act, el) {
  if (act === 'sync-ahora') { const p = Sy.sincronizar(); render(); await p; render(); toast(Sy.estado().error ? 'No se pudo sincronizar' : 'Sincronizado'); return; }
  if (act === 'sync-salir') {
    if (await confirmar('¿Desconectar este dispositivo?', 'Dejará de respaldarse en Drive. Tus datos se quedan en este dispositivo.', 'Desconectar')) { await Sy.salir(); S.syncPaso = null; toast('Desconectado'); render(); }
    return;
  }
  if (act === 'sync-desconectar') {
    if (await confirmar('¿Desconectar ' + el.dataset.n + '?', 'Dejará de sincronizar. Si alguien abre la app en ese dispositivo con internet, sus datos se borrarán de ahí. En tu Drive y en tus otros dispositivos no se pierde nada.', 'Desconectar')) {
      try { await Sy.desconectar(el.dataset.id); toast('Dispositivo desconectado'); } catch (e) { toast(e.message); }
      cargarListasSync();
    }
    return;
  }
  if (act === 'sync-restaurar') {
    if (await confirmar('¿Restaurar esta copia?', 'Todo volverá a como estaba ese día, en este y en tus otros dispositivos. Lo registrado después se perderá.', 'Restaurar')) {
      try { await Sy.restaurarCopia(el.dataset.id); await cargar(); toast('Copia restaurada'); ir('#/inicio'); } catch (e) { toast(e.message); }
    }
  }
}

// ---------------------------------------------------------------- Más y respaldo
function vMas() {
  const fila = (href, t, extra = '') => `<a class="fila" href="${href}"><span class="grow t">${esc(t)}</span>${extra}${icon('sig', 14, 2)}</a>`;
  const prox = (t, fase) => `<div class="fila" aria-disabled="true"><span class="grow t" style="color:var(--gris)">${esc(t)}</span><span class="tag">${esc(fase)}</span></div>`;
  const grupo = (t, html) => `<section style="display:flex;flex-direction:column;gap:6px"><h2 class="mini-tit" style="margin:0;padding:0 4px">${esc(t)}</h2><div class="panel">${html}</div></section>`;
  return `
  ${tope('Más')}
  ${grupo('Mi dinero', fila('#/cuentas', 'Cuentas y efectivo') + fila('#/tarjetas', 'Tarjetas de crédito'))}
  ${grupo('Personas', fila('#/personas', 'Personas, préstamos y compras') + fila('#/confianza', 'Cuentas de confianza', oculta('confianza') ? `<span style="margin-right:8px;color:var(--gris)">${iconCandado(14)}</span>` : S.R.confianza > 0 ? `<span class="etq" style="margin-right:8px">${money(S.R.confianza)}</span>` : '') + fila('#/deudas', 'Deudas personales y créditos'))}
  ${grupo('Planeación', fila('#/gastos', 'Gastos del mes') + fila('#/pagos', 'Pagos y recordatorios'))}
  ${grupo('Ajustes', fila('#/seguridad', 'Seguridad', Sg.tienePin() ? '<span class="tag ok" style="margin-right:8px">PIN activo</span>' : '<span class="tag pend" style="margin-right:8px">Sin PIN</span>') + fila('#/sync', 'Respaldo en Google Drive', Sy.estado().configurado ? '<span class="tag ok" style="margin-right:8px">Activo</span>' : '<span class="tag pend" style="margin-right:8px">Sin activar</span>') + fila('#/respaldo', 'Respaldo en archivo'))}
  ${Sg.tienePin() ? `<button type="button" class="btn bloque" data-act="bloquear">${iconCandado(16)}Bloquear ahora</button>` : ''}
  ${grupo('Próximamente', prox('Avisos en Google Calendar', 'Siguiente'))}`;
}

function vRespaldo() {
  return `
  ${volver('#/mas', 'Más')}
  ${tope('Respaldo')}
  <section class="panel panel-pad">
    <p style="margin:0;font-size:14.5px;line-height:1.5">${Sy.estado().configurado ? 'Tu respaldo automático en Google Drive está activo. Aquí además puedes descargar una copia en archivo.' : 'Tus datos viven solo en este dispositivo. <a href="#/sync" style="font-weight:600">Activa el respaldo cifrado en Google Drive</a> o descarga un respaldo de vez en cuando.'}</p>
    <p class="nota" style="margin:8px 0 0">El archivo descargado <strong>no va cifrado</strong>: guárdalo en un lugar seguro.</p>
    <p class="nota" style="margin:10px 0 0">${S.cuentas.length} cuentas · ${S.personas.length} personas · ${S.movs.length} movimientos</p>
  </section>
  <div class="form">
    <button type="button" class="btn pri bloque" data-act="exportar">Descargar respaldo completo</button>
    <button type="button" class="btn bloque" data-act="exportar-csv">Descargar movimientos para Excel</button>
    <label class="btn bloque" style="cursor:pointer">Restaurar desde un respaldo<input type="file" accept="application/json,.json" id="importar" class="sr"></label>
    <p class="nota">Restaurar reemplaza todo lo que hay en este dispositivo por el contenido del respaldo.</p>
  </div>`;
}

async function exportar() {
  const data = await db.exportAll();
  descargar('mis-finanzas-respaldo-' + hoy() + '.json', JSON.stringify(data, null, 1), 'application/json');
  toast('Respaldo descargado');
}

function exportarCSV() {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = [['Fecha', 'Tipo', 'Concepto', 'Persona', 'Sale de', 'Entra a', 'Importe', 'Categoría', 'Estado', 'Texto del banco', 'Notas']];
  for (const m of S.movs) {
    const e = S.estado[m.id];
    filas.push([m.fecha, L.TIPOS[m.tipo].label, conceptoMov(m), nomPersona(m.personaId), nomCuenta(m.origenId), nomCuenta(m.destinoId), m.importe,
      L.esGastoReal(m) ? L.categoriaGasto(m) : (m.categoria || ''), e ? (e.estado === 'pagado' ? 'Saldado' : 'Pendiente ' + e.pendiente) : '', m.referenciaBanco || '', m.notas || '']);
  }
  descargar('movimientos-' + hoy() + '.csv', '﻿' + filas.map((f) => f.map(q).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast('Archivo para Excel descargado');
}

async function importar(file) {
  try {
    const data = JSON.parse(await file.text());
    const ok = await confirmar('¿Restaurar este respaldo?', `Tiene ${(data.movimientos || []).length} movimientos. Se reemplazará todo lo que hay en este dispositivo.`, 'Restaurar');
    if (!ok) return;
    await db.importAll(data);
    await Sg.cargarSeg();
    await Sg.guardarSeg({ bioId: '', fallos: 0, esperaHasta: 0 });
    aplicarNombre(Sg.seg.nombre);
    await cargar();
    toast('Respaldo restaurado');
    ir('#/inicio');
  } catch (e) {
    toast(e.message && e.message.includes('respaldo') ? e.message : 'No se pudo leer el archivo.');
  }
}

// ---------------------------------------------------------------- Eventos
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'cerrar') { cerrarHoja(); return; }
  if (act === 'abrir-seccion') { e.preventDefault(); await abrirSeccion(el.dataset.v); return; }
  if (act === 'bloquear') { e.preventDefault(); await entrada(); return; }
  if (act && act.startsWith('sync-')) { e.preventDefault(); await accionSync(act, el); return; }
  if (['pin-activar', 'pin-cambiar', 'pin-quitar', 'pin2', 'pin2-quitar', 'nombre', 'codigo'].includes(act)) { await accionSeguridad(act, el); return; }
  if (act === 'atras') { e.preventDefault(); S.draft = null; if (history.length > 1) history.back(); else ir(el.getAttribute('href')); return; }
  if (act === 'ver-mov') { verMov(el.dataset.id); return; }
  if (act === 'borrar-mov') { e.preventDefault(); cerrarHoja(); await borrarMov(el.dataset.id); if (ruta().name === 'editar') { S.draft = null; ir('#/movimientos'); } return; }
  if (act === 'f-tipo') { S.fTipo = el.dataset.v; if (location.hash.includes('?')) { history.replaceState(null, '', '#/movimientos'); } render(); return; }
  if (act === 'filtrar-cuenta') { S.fCuenta = el.dataset.id; S.fTipo = ''; S.q = ''; return; }
  if (act === 'tipo') {
    leerForm(el.closest('form'));
    S.draft.tipo = el.dataset.v; S.error = '';
    completarDefaults(); render(); return;
  }
  if (act === 'recup') { leerForm(el.closest('form')); S.draft.recuperacion = el.dataset.v; render(); return; }
  if (act === 'exportar') { await exportar(); return; }
  if (act === 'cal-mes' || act === 'gastos-mes') {
    const k = act === 'cal-mes' ? 'mesCal' : 'mesGastos';
    const base = (S[k] || hoy().slice(0, 7)) + '-01';
    S[k] = L.sumarMeses(base, Number(el.dataset.v), 1).slice(0, 7); render(); return;
  }
  if (act === 'gasto-cat') { S.catAbierta = S.catAbierta === el.dataset.v ? '' : el.dataset.v; render(); return; }
  if (act === 'tab-deudas') { S.tabDeudas = el.dataset.v; render(); return; }
  if (act === 'rec-hecho') {
    const rec = S.recs.find((x) => x.id === el.dataset.id);
    if (rec) { await db.put('recordatorios', { ...rec, hechos: [...(rec.hechos || []), el.dataset.f] }); await cargar(); toast('Marcado como hecho'); render(); }
    return;
  }
  if (act === 'borrar-rec') {
    if (await confirmar('¿Borrar este recordatorio?', 'Dejará de aparecer en tus pagos.')) { await db.del('recordatorios', el.dataset.id); await cargar(); toast('Recordatorio borrado'); ir('#/pagos'); }
    return;
  }
  if (act === 'a-confianza') {
    const p = S.pById[el.dataset.id];
    if (p && await confirmar('¿Mover a cuentas de confianza?', `El saldo de ${p.nombre} saldrá de "Me deben" y no tendrá fechas ni avisos de cobro. Se conserva todo el historial.`, 'Mover')) {
      await db.put('personas', { ...p, confianza: true, estadoConfianza: 'sin_plazo', confianzaDesde: hoy() }); await cargar(); toast('Movido a cuentas de confianza'); render();
    }
    return;
  }
  if (act === 'quitar-confianza') {
    const p = S.pById[el.dataset.id];
    if (p && await confirmar('¿Volver a Me deben?', `${p.nombre} sale de cuentas de confianza y vuelve a "Me deben". Si acordaron fecha, agrégala editando el préstamo o la compra.`, 'Volver')) {
      await db.put('personas', { ...p, confianza: false, estadoConfianza: '' }); await cargar(); toast('Vuelve a Me deben'); render();
    }
    return;
  }
  if (act === 'estado-confianza') {
    const p = S.pById[el.dataset.id];
    if (p) { await db.put('personas', { ...p, estadoConfianza: el.dataset.v }); await cargar(); render(); }
    return;
  }
  if (act === 'regalo') {
    const p = S.pById[el.dataset.id];
    const r = p && S.R.personas[p.id];
    const monto = r ? r.pendPrestamos + r.pendCompras : 0;
    if (p && monto > 0 && await confirmar('¿Convertir en regalo?', `Se cierra el saldo de ${money(monto)} de ${p.nombre} sin que entre dinero. El historial se conserva.`, 'Convertir')) {
      await db.put('movimientos', { tipo: 'condonacion', importe: monto, fecha: hoy(), personaId: p.id, concepto: '' });
      await cargar(); toast('Saldo convertido en regalo'); render();
    }
    return;
  }
  if (act === 'exportar-csv') { exportarCSV(); return; }
  if (act === 'cerrar-persona-rapida') { cerrarHoja(); render(); return; }
  if (act === 'borrar-cuenta') {
    if (await confirmar('¿Borrar esta cuenta?', 'No tiene movimientos, así que no afecta tus saldos.')) { await db.del('cuentas', el.dataset.id); await cargar(); toast('Cuenta borrada'); ir('#/cuentas'); }
    return;
  }
  if (act === 'borrar-persona') {
    if (await confirmar('¿Borrar esta persona?', 'No tiene movimientos registrados.')) { await db.del('personas', el.dataset.id); await cargar(); toast('Persona borrada'); ir('#/personas'); }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = form.dataset.form;
  if (f === 'mov') await guardarMov(form);
  else if (f === 'cuenta') await guardarCuenta(form);
  else if (f === 'persona') await guardarPersona(form);
  else if (f === 'recordatorio') await guardarRecordatorio(form);
  else if (f.startsWith('sync-')) await formSync(f, form);
  else if (f === 'persona-rapida') {
    const p = await guardarPersona(form, true);
    if (p && S.draft) { S.draft.personaId = p.id; cerrarHoja(); render(); toast('Persona agregada'); }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; $('#lista').innerHTML = listaMovs(filtrar()); return; }
  const form = e.target.closest('form[data-form="mov"]');
  if (form && e.target.tagName !== 'SELECT') { leerForm(form); $('#f-preview').innerHTML = previewHtml(); }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'fCuenta') { S.fCuenta = e.target.value; $('#lista').innerHTML = listaMovs(filtrar()); return; }
  if (e.target.id === 'fPersona') { S.fPersona = e.target.value; $('#lista').innerHTML = listaMovs(filtrar()); return; }
  if (e.target.id === 'importar' && e.target.files[0]) { importar(e.target.files[0]); e.target.value = ''; return; }
  if (['bio', 'bloqueo-min', 'camuflaje', 'ocultar-montos', 'candado'].includes(e.target.dataset.act)) { accionSeguridad(e.target.dataset.act, e.target); return; }
  if (e.target.dataset.act === 'chip-check') { e.target.closest('.chip').classList.toggle('on', e.target.checked); return; }
  if (e.target.dataset.act === 'incluir-confianza') {
    S.ajustes = { ...S.ajustes, incluirConfianza: e.target.checked };
    db.put('meta', S.ajustes).then(cargar).then(() => { toast(e.target.checked ? 'Incluido en patrimonio' : 'Fuera de tu patrimonio'); });
    return;
  }
  if (e.target.dataset.act === 'tipo-cuenta') {
    const form = e.target.closest('form');
    const id = form.dataset.id;
    if (!id) { ir('#/cuenta-form?tipo=' + e.target.value); }
    return;
  }
  const form = e.target.closest('form[data-form="mov"]');
  if (form && e.target.tagName === 'SELECT') {
    if (e.target.name === 'personaId' && e.target.value === '__nueva') { leerForm(form); S.draft.personaId = ''; nuevaPersonaRapida(); return; }
    leerForm(form);
    if (e.target.name === 'personaId') S.draft.aplicaA = '';
    render();
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });
window.addEventListener('hashchange', () => { cerrarHoja(); render(); });

// Al salir de la app se oculta el contenido; al volver se bloquea según el tiempo elegido.
document.addEventListener('visibilitychange', () => {
  if (S.bloqueado) return;
  if (document.visibilityState === 'hidden') {
    S.ocultoDesde = Date.now();
    if (Sg.tienePin()) document.body.classList.add('privado');
  } else {
    const fuera = Date.now() - S.ocultoDesde;
    if (Sg.tienePin() && fuera >= (Number(Sg.seg.bloqueoMin) || 0) * 60000) entrada();
    else document.body.classList.remove('privado');
  }
});

// ---------------------------------------------------------------- Arranque
async function iniciar() {
  try {
    await cargar();
    if (!S.cuentas.some((c) => c.tipo === 'efectivo')) {
      await db.put('cuentas', { id: 'efectivo-caja', nombre: 'Efectivo / Caja', tipo: 'efectivo', institucion: '', saldoInicial: 0, fechaSaldoInicial: hoy(), moneda: 'MXN', activa: true, notas: '' });
      await cargar();
    }
    await Sg.cargarSeg();
    S.bioDisponible = await Sg.biometriaDisponible();
    Sy.onCambioRemoto(async () => {
      await cargar();
      if (!S.bloqueado && !['registrar', 'editar', 'cuenta-form', 'persona-form', 'recordatorio-form'].includes(ruta().name)) render();
    });
    Sy.onBorradoRemoto((motivo) => {
      if (motivo === 'borrar') { location.hash = '#/inicio'; location.reload(); }
      else if (!S.bloqueado) { toast('Este dispositivo se desconectó del respaldo'); render(); }
    });
    Sy.onEstado(() => {
      if (S.bloqueado) return;
      const n = ruta().name;
      if (n === 'sync') render();
      else if (n === 'inicio') { const t = $('#main .tope'); if (t && t.lastElementChild && t.lastElementChild.tagName === 'A') t.lastElementChild.outerHTML = chipSync(); }
    });
    await Sy.iniciar();
    await entrada();
  } catch (err) {
    $('#main').innerHTML = `<div class="error" role="alert">No se pudo abrir la base de datos local: ${esc(err.message || err)}</div>`;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
}

iniciar();
